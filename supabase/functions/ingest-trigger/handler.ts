// Pure request handler for ingest-trigger — no supabase-js / Deno.serve import, so it's
// unit-testable with plain `deno test`. index.ts wires the real deps.
//
// Signed-in retry / replace: a contributor or admin asks to (re-)run ingestion for one of
// their own pending manual versions. Deployed WITH jwt verification (default) — the caller
// is a real user, not the Storage webhook. Fires the same `ingest` workflow as
// ingest-dispatch via GitHub repository_dispatch.

const VERSION_ID_RE = /^[0-9a-fA-F-]{36}$/

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

type QueryResult<T> = Promise<{ data: T | null; error: { message: string } | null }>

export type AdminClient = {
  from(table: string): {
    select(cols: string): {
      eq(
        k: string,
        v: string,
      ): {
        maybeSingle(): QueryResult<{ id: string; status: string; created_by: string }>
      }
    }
    insert(row: Record<string, unknown>): {
      select(cols: string): { single(): QueryResult<{ id: string }> }
    }
    update(row: Record<string, unknown>): { eq(k: string, v: string): Promise<unknown> }
  }
}

export type Caller = { id: string; role: string }

export type Deps = {
  env: (k: string) => string | undefined
  admin: AdminClient
  getCaller: (req: Request) => Promise<Caller | null>
  dispatch: (repo: string, token: string, body: unknown) => Promise<number>
}

export function buildHandler(deps: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

    const caller = await deps.getCaller(req)
    if (!caller) return json(401, { error: 'invalid or missing token' })

    let body: { versionId?: unknown }
    try {
      body = await req.json()
    } catch {
      return json(400, { error: 'invalid JSON body' })
    }
    const versionId = body.versionId
    if (typeof versionId !== 'string' || !VERSION_ID_RE.test(versionId)) {
      return json(400, { error: 'versionId must be a uuid' })
    }

    const { data: version, error: vErr } = await deps.admin
      .from('manual_versions')
      .select('id, status, created_by')
      .eq('id', versionId)
      .maybeSingle()
    if (vErr) return json(500, { error: `version lookup: ${vErr.message}` })
    if (!version) return json(404, { error: `no manual_versions row for ${versionId}` })
    if (version.status !== 'pending') {
      return json(409, { error: `version is ${version.status}, not pending` })
    }
    if (version.created_by !== caller.id && caller.role !== 'admin') {
      return json(403, { error: 'not permitted to trigger ingestion for this version' })
    }

    const { data: job, error: jErr } = await deps.admin
      .from('ingest_jobs')
      .insert({ version_id: versionId, state: 'queued' })
      .select('id')
      .single()
    if (jErr || !job) return json(500, { error: `ingest_jobs insert: ${jErr?.message}` })

    const repo = deps.env('GITHUB_DISPATCH_REPO')
    const token = deps.env('GITHUB_DISPATCH_TOKEN')
    if (!repo || !token) return json(500, { error: 'GITHUB_DISPATCH_REPO / _TOKEN not set' })

    const failJob = (msg: string) =>
      deps.admin.from('ingest_jobs').update({ state: 'failed', error: msg }).eq('id', job.id)

    let status: number
    try {
      status = await deps.dispatch(repo, token, {
        event_type: 'ingest',
        client_payload: {
          job_id: job.id,
          version_id: versionId,
          object_path: `v/${versionId}/source.pdf`,
        },
      })
    } catch (e) {
      // A thrown fetch (DNS / TLS / network) would otherwise leave the job stuck at 'queued'
      const msg = `repository_dispatch threw: ${e instanceof Error ? e.message : String(e)}`
      await failJob(msg)
      return json(502, { error: msg, job_id: job.id })
    }
    if (status < 200 || status >= 300) {
      await failJob(`repository_dispatch HTTP ${status}`)
      return json(502, { error: `repository_dispatch failed: HTTP ${status}`, job_id: job.id })
    }

    return json(200, { job_id: job.id, version_id: versionId, dispatched: true })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

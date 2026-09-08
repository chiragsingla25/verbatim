// Pure request handler for ingest-dispatch — no supabase-js / Deno.serve import, so it's
// unit-testable with plain `deno test` and no node_modules. index.ts wires the real deps.
//
// Storage webhook -> GitHub repository_dispatch. Runs with --no-verify-jwt: the caller is a
// Supabase Storage webhook (pg_net), not a signed-in user, so it authenticates with a shared
// secret header (x-webhook-secret == STORAGE_WEBHOOK_SECRET).

const OBJECT_RE = /^v\/([0-9a-fA-F-]{36})\/source\.pdf$/

type StorageWebhookPayload = {
  type: string
  table: string
  schema: string
  record: { bucket_id?: string; name?: string } | null
}

type QueryResult<T> = Promise<{ data: T | null; error: { message: string } | null }>
export type AdminClient = {
  from(table: string): {
    select(cols: string): {
      eq(k: string, v: string): { maybeSingle(): QueryResult<{ id: string; status: string }> }
    }
    insert(row: Record<string, unknown>): {
      select(cols: string): { single(): QueryResult<{ id: string }> }
    }
    update(row: Record<string, unknown>): { eq(k: string, v: string): Promise<unknown> }
  }
}

export type Deps = {
  env: (k: string) => string | undefined
  admin: AdminClient
  dispatch: (repo: string, token: string, body: unknown) => Promise<number>
}

export function buildHandler(deps: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

    const secret = deps.env('STORAGE_WEBHOOK_SECRET')
    if (!secret || req.headers.get('x-webhook-secret') !== secret) {
      return json(401, { error: 'bad or missing webhook secret' })
    }

    let payload: StorageWebhookPayload
    try {
      payload = await req.json()
    } catch {
      return json(400, { error: 'invalid JSON body' })
    }

    const name = payload.record?.name ?? ''
    const bucket = payload.record?.bucket_id ?? ''
    if (bucket !== 'manuals') return json(200, { skipped: 'not the manuals bucket' })
    const m = OBJECT_RE.exec(name)
    if (!m) return json(200, { skipped: `object path not v/<uuid>/source.pdf: ${name}` })
    const versionId = m[1]

    const { data: version, error: vErr } = await deps.admin
      .from('manual_versions')
      .select('id, status')
      .eq('id', versionId)
      .maybeSingle()
    if (vErr) return json(500, { error: `version lookup: ${vErr.message}` })
    if (!version) return json(404, { error: `no manual_versions row for ${versionId}` })
    if (version.status !== 'pending') {
      return json(200, { skipped: `version ${versionId} is ${version.status}, not pending` })
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

    const objectPath = `v/${versionId}/source.pdf`
    const status = await deps.dispatch(repo, token, {
      event_type: 'ingest',
      client_payload: { job_id: job.id, version_id: versionId, object_path: objectPath },
    })
    if (status < 200 || status >= 300) {
      await deps.admin
        .from('ingest_jobs')
        .update({ state: 'failed', error: `repository_dispatch HTTP ${status}` })
        .eq('id', job.id)
      return json(502, { error: `repository_dispatch failed: HTTP ${status}`, job_id: job.id })
    }

    return json(200, { job_id: job.id, version_id: versionId, dispatched: true })
  }
}

export async function dispatchToGitHub(repo: string, token: string, body: unknown): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'verbatim-ingest-dispatch',
    },
    body: JSON.stringify(body),
  })
  return res.status
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

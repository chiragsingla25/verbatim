// deno test supabase/functions/ingest-trigger/handler.test.ts
import { assertEquals } from '@std/assert'
import { buildHandler, type Deps } from './handler.ts'

const VID = '4325b634-805c-4097-b757-22aed89f13bf'
const OWNER = 'user-owner'

function fakeAdmin(opts: {
  version?: { id: string; status: string; created_by: string } | null
  versionError?: string
  jobId?: string
  jobInsertError?: string
  onUpdate?: (table: string, row: Record<string, unknown>) => void
}) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.insert = (row: Record<string, unknown>) => {
        b._insertRow = row
        return b
      }
      b.update = (row: Record<string, unknown>) => {
        opts.onUpdate?.(table, row)
        return b
      }
      b.maybeSingle = () =>
        Promise.resolve(
          opts.versionError
            ? { data: null, error: { message: opts.versionError } }
            : { data: opts.version ?? null, error: null },
        )
      b.single = () =>
        Promise.resolve(
          opts.jobInsertError
            ? { data: null, error: { message: opts.jobInsertError } }
            : { data: { id: opts.jobId ?? 'job-1' }, error: null },
        )
      b.then = (res: (v: unknown) => void) => res({ data: null, error: null })
      return b
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

const baseEnv = (k: string) =>
  ({ GITHUB_DISPATCH_REPO: 'chiragsingla25/verbatim', GITHUB_DISPATCH_TOKEN: 'ghtok' })[k]

function req(body: unknown) {
  return new Request('http://localhost/ingest-trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const asCaller = (c: { id: string; role: string } | null) => () => Promise.resolve(c)

Deno.test('rejects non-POST', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({}),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  assertEquals((await h(new Request('http://localhost/', { method: 'GET' }))).status, 405)
})

Deno.test('401 when there is no valid caller', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'pending', created_by: OWNER } }),
    getCaller: asCaller(null),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  assertEquals((await h(req({ versionId: VID }))).status, 401)
})

Deno.test('400 on a non-uuid versionId', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({}),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  assertEquals((await h(req({ versionId: 'nope' }))).status, 400)
})

Deno.test('404 when the version is missing', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: null }),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  assertEquals((await h(req({ versionId: VID }))).status, 404)
})

Deno.test('409 when the version is not pending', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'active', created_by: OWNER } }),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  assertEquals((await h(req({ versionId: VID }))).status, 409)
})

Deno.test('403 when a non-owner non-admin triggers', async () => {
  let dispatched = false
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'pending', created_by: OWNER } }),
    getCaller: asCaller({ id: 'someone-else', role: 'contributor' }),
    dispatch: () => {
      dispatched = true
      return Promise.resolve(204)
    },
  } as Deps)
  assertEquals((await h(req({ versionId: VID }))).status, 403)
  assertEquals(dispatched, false)
})

Deno.test('admin may trigger someone else’s version', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'pending', created_by: OWNER }, jobId: 'job-7' }),
    getCaller: asCaller({ id: 'an-admin', role: 'admin' }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  const res = await h(req({ versionId: VID }))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).job_id, 'job-7')
})

Deno.test('happy path: owner inserts a queued job and dispatches', async () => {
  let dispatched: { repo: string; body: unknown } | null = null
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'pending', created_by: OWNER }, jobId: 'job-42' }),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: (repo, _t, body) => {
      dispatched = { repo, body }
      return Promise.resolve(204)
    },
  } as Deps)
  const res = await h(req({ versionId: VID }))
  assertEquals(res.status, 200)
  const out = await res.json()
  assertEquals(out.job_id, 'job-42')
  assertEquals(out.dispatched, true)
  // deno-lint-ignore no-explicit-any
  const cp = (dispatched!.body as any).client_payload
  assertEquals(cp, { job_id: 'job-42', version_id: VID, object_path: `v/${VID}/source.pdf` })
})

Deno.test('marks the job failed and returns 502 when dispatch fails', async () => {
  const updates: Array<{ table: string; row: Record<string, unknown> }> = []
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({
      version: { id: VID, status: 'pending', created_by: OWNER },
      jobId: 'job-9',
      onUpdate: (table, row) => updates.push({ table, row }),
    }),
    getCaller: asCaller({ id: OWNER, role: 'contributor' }),
    dispatch: () => Promise.resolve(403),
  } as Deps)
  const res = await h(req({ versionId: VID }))
  assertEquals(res.status, 502)
  assertEquals(updates.length, 1)
  assertEquals(updates[0].table, 'ingest_jobs')
  assertEquals(updates[0].row.state, 'failed')
})

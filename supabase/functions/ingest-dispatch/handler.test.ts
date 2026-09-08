// deno test supabase/functions/ingest-dispatch/index.test.ts
import { assertEquals } from '@std/assert'
import { buildHandler, type Deps } from './handler.ts'

const SECRET = 'test-secret'

// Minimal chainable fake of the supabase-js query builder for the calls this handler makes:
//   from(t).select(c).eq(k,v).maybeSingle()
//   from(t).insert(row).select(c).single()
//   from(t).update(row).eq(k,v)
function fakeAdmin(opts: {
  version?: { id: string; status: string } | null
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
      // update(...).eq(...) is awaited directly
      b.then = (res: (v: unknown) => void) => res({ data: null, error: null })
      return b
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

function req(body: unknown, headers: Record<string, string> = { 'x-webhook-secret': SECRET }) {
  return new Request('http://localhost/ingest-dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const baseEnv = (k: string) =>
  ({
    STORAGE_WEBHOOK_SECRET: SECRET,
    GITHUB_DISPATCH_REPO: 'chiragsingla25/verbatim',
    GITHUB_DISPATCH_TOKEN: 'ghtok',
  })[k]

const objPayload = (name: string, bucket = 'manuals') => ({
  type: 'INSERT',
  table: 'objects',
  schema: 'storage',
  record: { bucket_id: bucket, name },
})

const VID = '4325b634-805c-4097-b757-22aed89f13bf'

Deno.test('rejects non-POST', async () => {
  const h = buildHandler({ env: baseEnv, admin: fakeAdmin({}), dispatch: () => Promise.resolve(204) } as Deps)
  const res = await h(new Request('http://localhost/', { method: 'GET' }))
  assertEquals(res.status, 405)
})

Deno.test('rejects a wrong webhook secret', async () => {
  const h = buildHandler({ env: baseEnv, admin: fakeAdmin({}), dispatch: () => Promise.resolve(204) } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`), { 'x-webhook-secret': 'nope' }))
  assertEquals(res.status, 401)
})

Deno.test('skips objects outside the manuals bucket', async () => {
  const h = buildHandler({ env: baseEnv, admin: fakeAdmin({}), dispatch: () => Promise.resolve(204) } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`, 'avatars')))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).skipped !== undefined, true)
})

Deno.test('skips object paths that are not v/<uuid>/source.pdf', async () => {
  const h = buildHandler({ env: baseEnv, admin: fakeAdmin({}), dispatch: () => Promise.resolve(204) } as Deps)
  const res = await h(req(objPayload('v/not-a-uuid/other.pdf')))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).skipped !== undefined, true)
})

Deno.test('404 when the version row is missing', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: null }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`)))
  assertEquals(res.status, 404)
})

Deno.test('skips when the version is not pending', async () => {
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'active' } }),
    dispatch: () => Promise.resolve(204),
  } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`)))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).skipped !== undefined, true)
})

Deno.test('happy path: inserts a queued job and dispatches', async () => {
  let dispatched: { repo: string; body: unknown } | null = null
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({ version: { id: VID, status: 'pending' }, jobId: 'job-42' }),
    dispatch: (repo, _token, body) => {
      dispatched = { repo, body }
      return Promise.resolve(204)
    },
  } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`)))
  assertEquals(res.status, 200)
  const out = await res.json()
  assertEquals(out.job_id, 'job-42')
  assertEquals(out.dispatched, true)
  assertEquals(dispatched!.repo, 'chiragsingla25/verbatim')
  // deno-lint-ignore no-explicit-any
  const cp = (dispatched!.body as any).client_payload
  assertEquals(cp, { job_id: 'job-42', version_id: VID, object_path: `v/${VID}/source.pdf` })
})

Deno.test('marks the job failed and returns 502 when dispatch fails', async () => {
  const updates: Array<{ table: string; row: Record<string, unknown> }> = []
  const h = buildHandler({
    env: baseEnv,
    admin: fakeAdmin({
      version: { id: VID, status: 'pending' },
      jobId: 'job-9',
      onUpdate: (table, row) => updates.push({ table, row }),
    }),
    dispatch: () => Promise.resolve(403),
  } as Deps)
  const res = await h(req(objPayload(`v/${VID}/source.pdf`)))
  assertEquals(res.status, 502)
  assertEquals(updates.length, 1)
  assertEquals(updates[0].table, 'ingest_jobs')
  assertEquals(updates[0].row.state, 'failed')
})

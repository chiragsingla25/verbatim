import {
  type EmbeddedManual,
  type HistoryEntry,
  manualLabel,
  type RawHistoryRow,
  toHistoryEntry,
} from './history'
import { type AnswerResult, answerResultSchema, type AppRole } from './schema'
import { supabase } from './supabase'

export type { HistoryEntry }

// ── Ask (Phase 3) ──────────────────────────────────────────────────────────

// A minimal pointer to another manual version (for "superseded by" links).
export type VersionRef = { id: string; title: string }

export type AskVersion = {
  id: string
  title: string
  edition: string | null
  year: number | null
  publisher: string | null
  status: string
  instrument: { name: string } | null
  // The newer version that supersedes this one, if the caller can see it.
  supersededBy: VersionRef | null
}

export async function getAskVersion(versionId: string): Promise<AskVersion> {
  // Independent reads — the superseder lookup only needs versionId, not `data`.
  const [{ data, error }, { data: newer }] = await Promise.all([
    supabase
      .from('manual_versions')
      .select('id, title, edition, year, publisher, status, instrument:instruments(name)')
      .eq('id', versionId)
      .maybeSingle(),
    supabase
      .from('manual_versions')
      .select('id, title')
      .eq('supersedes_id', versionId)
      .eq('status', 'active')
      .maybeSingle(), // ≤1 row: manual_versions_supersedes_unique
  ])
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That manual version is not available.')

  return { ...(data as unknown as AskVersion), supersededBy: (newer as VersionRef | null) ?? null }
}

// POST { versionId, question } to the /ask Edge Function with the caller's JWT.
export async function ask(versionId: string, question: string): Promise<AnswerResult> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('Please sign in again.')
  const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ versionId, question }),
      signal: AbortSignal.timeout(130_000),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error('That took too long — the answer service is under load. Please try again.')
    }
    throw new Error('Could not reach the answer service. Check your connection and try again.')
  }
  if (res.status === 503) throw new Error('The answer service is busy right now — try again in a moment.')
  if (!res.ok) throw new Error(`Ask failed (${res.status})`)
  return answerResultSchema.parse(await res.json())
}

// Short-TTL signed URL to a version's source PDF (RLS: readable for an active version).
export async function sourcePdfUrl(versionId: string): Promise<string> {
  const path = `v/${versionId}/source.pdf`
  const { data, error } = await supabase.storage.from('manuals').createSignedUrl(path, 600)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open the source PDF.')
  return data.signedUrl
}

export type ManualUploadInput = {
  instrumentName: string
  slug: string
  title: string
  licenseClass: 'public_domain'
  attestation: boolean
  edition?: string
  year?: number
  publisher?: string
  supersedesId?: string
}

// 1c: create the pending manual_versions row (+ instrument, + audit_log) via the
// request_manual_upload RPC, then push the PDF through a short-TTL signed upload URL
// scoped to exactly that version's object path. RLS still governs every write.
export async function startManualUpload(input: ManualUploadInput, file: File) {
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('Please choose a PDF file.')
  }

  const { data, error } = await supabase.rpc('request_manual_upload', {
    p_instrument_name: input.instrumentName,
    p_slug: input.slug,
    p_title: input.title,
    p_license_class: input.licenseClass,
    p_attestation: input.attestation,
    p_edition: input.edition ?? null,
    p_year: input.year ?? null,
    p_publisher: input.publisher ?? null,
    p_supersedes_id: input.supersedesId ?? null,
  })
  if (error) throw new Error(error.message)

  const row = Array.isArray(data) ? data[0] : data
  const versionId: string = row.version_id
  const objectPath: string = row.object_path

  const signed = await supabase.storage.from('manuals').createSignedUploadUrl(objectPath)
  if (signed.error) throw new Error(`signed URL: ${signed.error.message}`)

  const put = await supabase.storage
    .from('manuals')
    .uploadToSignedUrl(objectPath, signed.data.token, file, { contentType: 'application/pdf' })
  if (put.error) throw new Error(`upload: ${put.error.message}`)

  return { versionId, objectPath }
}

export type LibraryVersion = {
  id: string
  title: string
  edition: string | null
  year: number | null
  publisher: string | null
  status: 'pending' | 'active' | 'archived'
  supersedesId: string | null
  instrument: { name: string; slug: string } | null
  // The newer version that supersedes this one (its supersedes_id points here), if visible.
  supersededBy: VersionRef | null
}

// ── History / "My answers" (v1.1) ──────────────────────────────────────────
// query_log stores a full AnswerResult per /ask; the /history screen re-renders it with
// no LLM call. query_log_select_self_or_admin scopes these to the caller OR an admin — so
// "My answers" MUST also filter user_id explicitly, or an admin would see every user's
// questions. The row → HistoryEntry transform (+ its types) lives in ./history so it can
// be unit-tested without the supabase client.
const HISTORY_SELECT =
  'id, question, answer, abstained, citations, version_id, at, manual_versions(title, status, instrument:instruments(name))'

async function currentUserId(): Promise<string> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('Please sign in again.')
  return uid
}

// One page of the caller's own past questions, newest first. Keyset pagination on the
// compound (at, id) cursor from the previous page's last row — `at` alone is not unique,
// so `at < before` would skip rows sharing that exact timestamp.
export async function listMyHistory(
  opts: { versionId?: string; before?: { at: string; id: string }; limit?: number } = {},
): Promise<HistoryEntry[]> {
  let q = supabase
    .from('query_log')
    .select(HISTORY_SELECT)
    .eq('user_id', await currentUserId())
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit ?? 25)
  if (opts.versionId) q = q.eq('version_id', opts.versionId)
  if (opts.before) {
    q = q.or(`at.lt.${opts.before.at},and(at.eq.${opts.before.at},id.lt.${opts.before.id})`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as RawHistoryRow[]).map(toHistoryEntry)
}

export type HistoryManual = { versionId: string; label: string }

type RawManualRow = { version_id: string; manual_versions: EmbeddedManual }

// Distinct manuals the caller has asked about, for the /history filter dropdown. Derived
// from a recent slice of their query_log (covers realistic per-user history depth).
export async function historyManuals(): Promise<HistoryManual[]> {
  const { data, error } = await supabase
    .from('query_log')
    .select('version_id, manual_versions(title, instrument:instruments(name))')
    .eq('user_id', await currentUserId())
    .order('at', { ascending: false })
    .limit(400)
  if (error) throw new Error(error.message)
  const seen = new Map<string, string>()
  for (const r of (data ?? []) as unknown as RawManualRow[]) {
    if (!seen.has(r.version_id)) seen.set(r.version_id, manualLabel(r.manual_versions))
  }
  return [...seen].map(([versionId, label]) => ({ versionId, label }))
}

type RawVersionRow = {
  id: string
  title: string
  edition: string | null
  year: number | null
  publisher: string | null
  status: LibraryVersion['status']
  supersedes_id: string | null
  instrument: { name: string; slug: string } | null
}

export async function listVisibleVersions(): Promise<LibraryVersion[]> {
  const { data, error } = await supabase
    .from('manual_versions')
    .select('id, title, edition, year, publisher, status, supersedes_id, instrument:instruments(name, slug)')
    .order('status')
    .order('title')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as RawVersionRow[]
  // "superseded by" is a reverse lookup within the visible set: some row's
  // supersedes_id points at this one (at most one, per manual_versions_supersedes_unique).
  const supersederOf = new Map<string, VersionRef>()
  for (const r of rows) {
    if (r.supersedes_id) supersederOf.set(r.supersedes_id, { id: r.id, title: r.title })
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    edition: r.edition,
    year: r.year,
    publisher: r.publisher,
    status: r.status,
    supersedesId: r.supersedes_id,
    instrument: r.instrument,
    supersededBy: supersederOf.get(r.id) ?? null,
  }))
}

export type ReviewData = {
  version: {
    id: string
    title: string
    status: string
    page_count: number | null
    source_object_path: string | null
    instrument: { name: string } | null
  }
  job: {
    state: string
    ocr_quality: number | null
    flags: string[]
    error: string | null
    startedAt: string
    updatedAt: string
  } | null
  tableChunks: { id: string; page: number | null; content: string; table_ref: string | null }[]
  totalChunks: number
  sourceUrl: string | null
}

// 1f: everything ReviewUpload needs — version, latest ingest job, the extracted table
// chunks, and a short-TTL signed URL to the source PDF (private bucket).
export async function getReviewData(versionId: string): Promise<ReviewData> {
  const { data: version, error: vErr } = await supabase
    .from('manual_versions')
    .select('id, title, status, page_count, source_object_path, instrument:instruments(name)')
    .eq('id', versionId)
    .single()
  if (vErr) throw new Error(vErr.message)

  const { data: jobRow } = await supabase
    .from('ingest_jobs')
    .select('state, ocr_quality, flags, error, created_at, updated_at')
    .eq('version_id', versionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: tables } = await supabase
    .from('document_chunks')
    .select('id, page, content, table_ref')
    .eq('version_id', versionId)
    .not('table_ref', 'is', null)
    .order('page')

  const { count } = await supabase
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', versionId)

  let sourceUrl: string | null = null
  const path = (version as { source_object_path: string | null }).source_object_path
  if (path) {
    const signed = await supabase.storage.from('manuals').createSignedUrl(path, 3600)
    sourceUrl = signed.data?.signedUrl ?? null
  }

  return {
    version: version as unknown as ReviewData['version'],
    job: jobRow
      ? {
          state: (jobRow as { state: string }).state,
          ocr_quality: (jobRow as { ocr_quality: number | null }).ocr_quality,
          flags: ((jobRow as { flags: unknown }).flags as string[]) ?? [],
          error: (jobRow as { error: string | null }).error,
          startedAt: (jobRow as { created_at: string }).created_at,
          updatedAt: (jobRow as { updated_at: string }).updated_at,
        }
      : null,
    tableChunks: (tables ?? []) as unknown as ReviewData['tableChunks'],
    totalChunks: count ?? 0,
    sourceUrl,
  }
}

export async function publishVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_manual_version', { p_version_id: versionId })
  if (error) throw new Error(error.message)
}

export async function rejectVersion(versionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_manual_version', {
    p_version_id: versionId,
    p_reason: reason || null,
  })
  if (error) throw new Error(error.message)
}

// ── Upload-lifecycle recovery (v1.1.1) — creator-or-admin, pending versions ──
// Hard-delete a pending version. Supabase forbids removing storage.objects rows from
// SQL, so the source object goes through the Storage API here first (RLS:
// manuals_delete_contrib), then the RPC drops the row + cascades document_chunks /
// ingest_jobs + writes the audit entry.
export async function deleteVersion(versionId: string): Promise<void> {
  const rm = await supabase.storage.from('manuals').remove([`v/${versionId}/source.pdf`])
  if (rm.error && !/not found/i.test(rm.error.message ?? '')) {
    throw new Error(rm.error.message || 'could not remove the source file')
  }
  const { error } = await supabase.rpc('delete_manual_version', { p_version_id: versionId })
  if (error) throw new Error(error.message)
}

// Re-run ingestion on the already-uploaded file (retry), or after a Replace upload.
export async function retryIngest(versionId: string): Promise<{ jobId: string }> {
  const { data, error } = await supabase.functions.invoke('ingest-trigger', {
    body: { versionId },
  })
  if (error) throw new Error(await functionErrorMessage(error))
  const jobId = (data as { job_id?: string } | null)?.job_id
  if (!jobId) throw new Error('ingest-trigger returned no job id')
  return { jobId }
}

// supabase.functions.invoke gives a FunctionsHttpError whose .message is generic; the
// real reason is the function's JSON body, reachable via .context (the Response).
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string }
      if (body?.error) return body.error
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : String(error)
}

// A short-TTL URL for overwriting manuals/v/<id>/source.pdf (Replace the source PDF).
export async function reuploadSourceUrl(
  versionId: string,
): Promise<{ url: string; path: string; token: string }> {
  const path = `v/${versionId}/source.pdf`
  const { data, error } = await supabase.storage
    .from('manuals')
    .createSignedUploadUrl(path, { upsert: true })
  if (error) throw new Error(error.message)
  return { url: data.signedUrl, path, token: data.token }
}

// ── Manual lifecycle (v1.1 Phase 2) — admin only, enforced in the RPC ───────
export async function archiveVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_manual_version', { p_version_id: versionId })
  if (error) throw new Error(error.message)
}

export async function republishVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('republish_manual_version', { p_version_id: versionId })
  if (error) throw new Error(error.message)
}

export async function setSupersedes(versionId: string, supersedesId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_supersedes', {
    p_version_id: versionId,
    p_supersedes_id: supersedesId,
  })
  if (error) throw new Error(error.message)
}

// ── Admin console (v1.1 Phase 3) — every RPC re-checks auth_role()='admin' ──
export type AdminUser = {
  id: string
  email: string
  role: AppRole
  createdAt: string
  lastSignInAt: string | null
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as AppRole,
    createdAt: r.created_at as string,
    lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
  }))
}

export async function adminSetRole(userId: string, role: AppRole): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', { p_user_id: userId, p_role: role })
  if (error) throw new Error(error.message)
}

export type AdminActivity = {
  id: string
  at: string
  actorEmail: string | null
  action: string
  target: string | null
  meta: Record<string, unknown>
}

export async function adminListActivity(limit = 100): Promise<AdminActivity[]> {
  const { data, error } = await supabase.rpc('admin_list_activity', { p_limit: limit })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    at: r.at as string,
    actorEmail: (r.actor_email as string | null) ?? null,
    action: r.action as string,
    target: (r.target as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
  }))
}

export type AdminVersion = {
  id: string
  title: string
  edition: string | null
  year: number | null
  status: 'pending' | 'active' | 'archived'
  supersedesId: string | null
  instrument: { id: string; name: string } | null
  ingestState: string | null
}

// Every manual version (admin RLS returns all rows) + its latest ingest job state.
export async function adminListAllVersions(): Promise<AdminVersion[]> {
  const { data, error } = await supabase
    .from('manual_versions')
    .select(
      'id, title, edition, year, status, supersedes_id, instrument:instruments(id, name), ingest_jobs(state, created_at)',
    )
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const jobs = (r.ingest_jobs as Array<{ state: string; created_at: string }> | null) ?? []
    const latest = jobs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    return {
      id: r.id as string,
      title: r.title as string,
      edition: (r.edition as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      status: r.status as AdminVersion['status'],
      supersedesId: (r.supersedes_id as string | null) ?? null,
      instrument: (r.instrument as { id: string; name: string } | null) ?? null,
      ingestState: latest?.state ?? null,
    }
  })
}

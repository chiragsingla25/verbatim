import { type AnswerResult, answerResultSchema, type Citation } from './schema'
import { supabase } from './supabase'

// ── Ask (Phase 3) ──────────────────────────────────────────────────────────
export type AskVersion = {
  id: string
  title: string
  edition: string | null
  year: number | null
  publisher: string | null
  status: string
  instrument: { name: string } | null
}

export async function getAskVersion(versionId: string): Promise<AskVersion> {
  const { data, error } = await supabase
    .from('manual_versions')
    .select('id, title, edition, year, publisher, status, instrument:instruments(name)')
    .eq('id', versionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That manual version is not available.')
  return data as unknown as AskVersion
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
  instrument: { name: string; slug: string } | null
}

// ── History / "My answers" (v1.1) ──────────────────────────────────────────
// query_log stores a full AnswerResult per /ask; the /history screen re-renders it with
// no LLM call. query_log_select_self_or_admin already scopes these to the caller.
export type HistoryEntry = {
  id: string
  question: string
  answer: string
  abstained: boolean
  citations: Citation[]
  versionId: string
  at: string
  // From the embedded manual_versions row — null when the version is no longer visible
  // to the caller (archived / removed). manualActive gates the "Re-ask" affordance.
  manualLabel: string
  manualActive: boolean
}

type RawHistoryRow = {
  id: string
  question: string
  answer: string | null
  abstained: boolean
  citations: unknown
  version_id: string
  at: string
  manual_versions: {
    title: string | null
    status: string | null
    instrument: { name: string | null } | null
  } | null
}

function toHistoryEntry(r: RawHistoryRow): HistoryEntry {
  const mv = r.manual_versions
  const label = mv
    ? `${mv.instrument?.name ?? 'Manual'} · ${mv.title ?? ''}`.replace(/ · $/, '')
    : 'Archived / removed manual'
  return {
    id: r.id,
    question: r.question,
    answer: r.answer ?? '',
    abstained: r.abstained,
    citations: Array.isArray(r.citations) ? (r.citations as Citation[]) : [],
    versionId: r.version_id,
    at: r.at,
    manualLabel: label,
    manualActive: mv?.status === 'active',
  }
}

const HISTORY_SELECT =
  'id, question, answer, abstained, citations, version_id, at, manual_versions(title, status, instrument:instruments(name))'

// One page of the caller's own past questions, newest first. `before` is the `at` cursor
// from the last row of the previous page (keyset pagination).
export async function listMyHistory(
  opts: { versionId?: string; before?: string; limit?: number } = {},
): Promise<HistoryEntry[]> {
  let q = supabase
    .from('query_log')
    .select(HISTORY_SELECT)
    .order('at', { ascending: false })
    .limit(opts.limit ?? 25)
  if (opts.versionId) q = q.eq('version_id', opts.versionId)
  if (opts.before) q = q.lt('at', opts.before)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as RawHistoryRow[]).map(toHistoryEntry)
}

export type HistoryManual = { versionId: string; label: string }

// Distinct manuals the caller has asked about, for the /history filter dropdown. Derived
// from a recent slice of their query_log (covers realistic per-user history depth).
export async function historyManuals(): Promise<HistoryManual[]> {
  const { data, error } = await supabase
    .from('query_log')
    .select('version_id, manual_versions(title, instrument:instruments(name))')
    .order('at', { ascending: false })
    .limit(400)
  if (error) throw new Error(error.message)
  const seen = new Map<string, string>()
  for (const r of (data ?? []) as unknown as RawHistoryRow[]) {
    if (seen.has(r.version_id)) continue
    const mv = r.manual_versions
    seen.set(
      r.version_id,
      mv ? `${mv.instrument?.name ?? 'Manual'} · ${mv.title ?? ''}`.replace(/ · $/, '') : 'Archived / removed manual',
    )
  }
  return [...seen].map(([versionId, label]) => ({ versionId, label }))
}

export async function listVisibleVersions(): Promise<LibraryVersion[]> {
  const { data, error } = await supabase
    .from('manual_versions')
    .select('id, title, edition, year, publisher, status, instrument:instruments(name, slug)')
    .order('status')
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LibraryVersion[]
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
  job: { state: string; ocr_quality: number | null; flags: string[]; error: string | null } | null
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
    .select('state, ocr_quality, flags, error')
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

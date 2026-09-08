import { supabase } from './supabase'

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

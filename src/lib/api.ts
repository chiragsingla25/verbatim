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

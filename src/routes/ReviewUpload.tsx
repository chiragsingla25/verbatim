import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type VersionRow = {
  id: string
  title: string
  status: string
  page_count: number | null
  source_object_path: string | null
  instrument: { name: string } | null
}
type JobRow = { state: string; ocr_quality: number | null; flags: unknown; error: string | null }

// 1c stub — shows the pending version + its ingest job state. 1f fills this in with the
// extracted-tables review UI and the publish action.
export function ReviewUpload() {
  const { versionId } = useParams()
  const [version, setVersion] = useState<VersionRow | null>(null)
  const [job, setJob] = useState<JobRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!versionId) return
    supabase
      .from('manual_versions')
      .select('id, title, status, page_count, source_object_path, instrument:instruments(name)')
      .eq('id', versionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setVersion(data as unknown as VersionRow)
      })
    supabase
      .from('ingest_jobs')
      .select('state, ocr_quality, flags, error')
      .eq('version_id', versionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setJob((data as JobRow) ?? null))
  }, [versionId])

  if (error) return <main className="wrap"><div className="msg err">{error}</div></main>
  if (!version) return <main className="wrap">Loading…</main>

  return (
    <main className="wrap">
      <h1>Review: {version.instrument?.name ?? 'manual'}</h1>
      <p style={{ color: 'var(--muted)' }}>
        {version.title} · status <strong>{version.status}</strong>
        {version.page_count ? ` · ${version.page_count} pages` : ''}
      </p>
      <div className="msg info">
        Ingestion job:{' '}
        <strong>{job?.state ?? 'not started'}</strong>
        {job?.ocr_quality != null ? ` · OCR ${(job.ocr_quality * 100).toFixed(0)}%` : ''}
        {job?.error ? ` · ${job.error}` : ''}
        <br />
        The extracted-tables review and the publish action land in Phase 1f.
      </div>
    </main>
  )
}

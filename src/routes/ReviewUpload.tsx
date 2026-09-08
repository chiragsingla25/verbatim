import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getReviewData, publishVersion, rejectVersion, type ReviewData } from '../lib/api'

// 1f: the contributor reviews what ingestion extracted (tables, OCR quality, flags) against
// the source PDF, then publishes (status -> active) or rejects. The polished slide-over
// source viewer is Phase 3; here each table links to its page in the source PDF.
export function ReviewUpload() {
  const { versionId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!versionId) return
    getReviewData(versionId).then(setData).catch((e) => setError(String(e.message ?? e)))
  }, [versionId])

  useEffect(load, [load])

  // While ingestion is running, poll until it reaches a terminal-ish state.
  useEffect(() => {
    const s = data?.job?.state
    if (!s || ['review', 'published', 'rejected', 'failed'].includes(s)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [data?.job?.state, load])

  if (error) return <main className="wrap"><div className="msg err">{error}</div></main>
  if (!data) return <main className="wrap">Loading…</main>

  const { version, job, tableChunks, totalChunks, sourceUrl } = data
  const canDecide = job?.state === 'review' && version.status === 'pending'

  async function decide(fn: () => Promise<void>, label: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      navigate('/', { replace: true })
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <main className="wrap">
      <h1>Review: {version.instrument?.name ?? 'manual'}</h1>
      <p style={{ color: 'var(--muted)' }}>
        {version.title} · status <strong>{version.status}</strong>
        {version.page_count ? ` · ${version.page_count} pages` : ''} · {totalChunks} chunks
      </p>

      <div className={`msg ${job?.state === 'failed' ? 'err' : 'info'}`}>
        Ingestion: <strong>{job?.state ?? 'not started'}</strong>
        {job?.ocr_quality != null ? ` · OCR ${(job.ocr_quality * 100).toFixed(0)}%` : ''}
        {job?.flags?.length ? ` · flags: ${job.flags.join(', ')}` : ''}
        {job?.error ? <div style={{ marginTop: '0.4rem' }}>{job.error}</div> : null}
        {job && !['review', 'published', 'rejected', 'failed'].includes(job.state) && (
          <div style={{ marginTop: '0.4rem' }}>Parsing… this page refreshes automatically.</div>
        )}
      </div>

      {sourceUrl && (
        <p>
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Open the source PDF ↗
          </a>
        </p>
      )}

      <h2 style={{ marginTop: '2rem', fontSize: '1.05rem' }}>
        Extracted tables ({tableChunks.length})
      </h2>
      {tableChunks.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          No tables were detected. Check the source — a manual with norm/cutoff tables should
          usually have some.
        </p>
      )}
      {tableChunks.map((t) => (
        <figure key={t.id} style={{ margin: '1rem 0', borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
          <figcaption style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
            page {t.page ?? '?'}
            {sourceUrl && t.page ? (
              <>
                {' · '}
                <a href={`${sourceUrl}#page=${t.page}`} target="_blank" rel="noreferrer">
                  view page in source ↗
                </a>
              </>
            ) : null}
          </figcaption>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#fff',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '0.6rem 0.75rem',
              fontSize: '0.8rem',
              overflowX: 'auto',
            }}
          >
            {t.content}
          </pre>
        </figure>
      ))}

      {canDecide && (
        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.75rem' }}>
          <button disabled={busy} onClick={() => decide(() => publishVersion(version.id), 'publish')}>
            {busy ? 'Working…' : 'Publish — make this version askable'}
          </button>
          <button
            className="link"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Reason for rejecting (optional):') ?? ''
              decide(() => rejectVersion(version.id, reason), 'reject')
            }}
          >
            reject
          </button>
        </div>
      )}
      {version.status === 'active' && (
        <div className="msg ok" style={{ marginTop: '2rem' }}>
          Published — students can now ask questions against this version.
        </div>
      )}
    </main>
  )
}

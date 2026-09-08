import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getReviewData, publishVersion, rejectVersion, type ReviewData } from '../lib/api'

// The contributor reviews what ingestion extracted (tables, OCR quality, flags) against the
// source PDF, then publishes (status -> active) or rejects.
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

  useEffect(() => {
    const s = data?.job?.state
    if (!s || ['review', 'published', 'rejected', 'failed'].includes(s)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [data?.job?.state, load])

  if (error)
    return (
      <div className="page-body">
        <div className="msg err">{error}</div>
      </div>
    )
  if (!data) return <div className="page-body">Loading…</div>

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
    <>
      <header className="page-head">
        <Link to="/" className="ask-back" style={{ marginLeft: 0 }}>
          ← Manual library
        </Link>
        <h1 style={{ marginTop: 8 }}>Review: {version.instrument?.name ?? 'manual'}</h1>
        <p className="subtitle">
          {version.title} · status <strong>{version.status}</strong>
          {version.page_count ? ` · ${version.page_count} pages` : ''} · {totalChunks} chunks
        </p>
      </header>

      <div className="page-body">
        <div
          className="card"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 26px', alignItems: 'center' }}
        >
          <span className={`pill ${job?.state === 'failed' ? 'amber' : job?.state === 'review' ? 'green' : ''}`}>
            Ingestion: {job?.state ?? 'not started'}
          </span>
          {job?.ocr_quality != null && (
            <span className="pill green">OCR quality {(job.ocr_quality * 100).toFixed(0)}%</span>
          )}
          {job?.flags?.length ? (
            <span className="pill amber">flags: {job.flags.join(', ')}</span>
          ) : (
            <span className="pill">No flags</span>
          )}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
              Open the source PDF ↗
            </a>
          )}
        </div>

        {job?.error && <div className="msg err">{job.error}</div>}
        {job && !['review', 'published', 'rejected', 'failed'].includes(job.state) && (
          <div className="msg info">Parsing… this page refreshes automatically.</div>
        )}

        <h2 style={{ marginTop: '1.75rem' }}>Extracted tables ({tableChunks.length})</h2>
        {tableChunks.length === 0 && (
          <p className="subtitle">
            No tables were detected. Check the source — a manual with norm/cutoff tables should
            usually have some.
          </p>
        )}
        {tableChunks.map((t) => (
          <figure
            key={t.id}
            style={{ margin: '1rem 0 0', borderTop: '1px solid var(--om-border-subtle)', paddingTop: '0.85rem' }}
          >
            <figcaption
              style={{ color: 'var(--om-text-tertiary)', fontSize: '12px', marginBottom: '0.4rem' }}
            >
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
                background: 'var(--om-bg-surface)',
                border: '1px solid var(--om-border-card)',
                borderRadius: 'var(--om-radius-sm)',
                padding: '0.7rem 0.85rem',
                fontSize: '12px',
                lineHeight: 1.5,
                overflowX: 'auto',
              }}
            >
              {t.content}
            </pre>
          </figure>
        ))}

        {canDecide && (
          <div style={{ marginTop: '2rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button disabled={busy} onClick={() => decide(() => publishVersion(version.id), 'publish')}>
              {busy ? 'Working…' : 'Approve & publish version'}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Reason for rejecting (optional):') ?? ''
                decide(() => rejectVersion(version.id, reason), 'reject')
              }}
            >
              Reject upload
            </button>
          </div>
        )}
        {version.status === 'active' && (
          <div className="msg ok" style={{ marginTop: '2rem' }}>
            Published — students can now ask questions against this version.
          </div>
        )}
      </div>
    </>
  )
}

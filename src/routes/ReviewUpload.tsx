import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getReviewData, publishVersion, rejectVersion, type ReviewData } from '../lib/api'

// Where the Docling ingestion job runs. A pending review is blocked on one of these.
const INGEST_RUNS_URL = 'https://github.com/chiragsingla25/verbatim/actions/workflows/ingest.yml'

function minutesSince(iso: string): number {
  const t = Date.parse(iso)
  return t > 0 ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : 0
}

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
  const running = job != null && ['queued', 'parsing'].includes(job.state)
  const elapsedMin = job ? minutesSince(job.startedAt) : 0
  const idleMin = job ? minutesSince(job.updatedAt) : 0
  // The server-side watchdog fails a wedged job, but only after its budget; flag it
  // in the UI sooner so the reviewer isn't left staring at a spinner.
  const looksStuck = job?.state === 'parsing' && idleMin >= 20

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

        {job?.state === 'failed' && (
          <div className="msg err">
            <strong>Ingestion failed.</strong> {job.error || 'No error detail was recorded.'}
            <br />
            Check the source file, then re-upload the manual from the library to try again.
          </div>
        )}
        {job?.state === 'rejected' && (
          <div className="msg info">
            This upload was rejected{job.error ? `: ${job.error}` : ''}. Its extracted data has
            been discarded.
          </div>
        )}
        {running && (
          <div className="msg info">
            {job.state === 'queued' ? 'Queued for parsing' : 'Parsing'}
            {elapsedMin >= 1 ? ` — ${elapsedMin} min elapsed` : ''}. This page refreshes itself.
            <br />
            A cold run downloads the parser models first and can take 10–15 minutes;{' '}
            <a href={INGEST_RUNS_URL} target="_blank" rel="noreferrer">
              watch the ingestion job ↗
            </a>
            .
            {looksStuck && (
              <>
                <br />
                This has run unusually long. If it doesn’t finish or fail within a few
                minutes, re-upload the manual.
              </>
            )}
          </div>
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

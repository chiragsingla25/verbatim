import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteVersion,
  getReviewData,
  publishVersion,
  rejectVersion,
  retryIngest,
  reuploadSourceUrl,
  type ReviewData,
} from '../lib/api'

// Where the Docling ingestion job runs. A pending review is blocked on one of these.
const INGEST_RUNS_URL = 'https://github.com/chiragsingla25/verbatim/actions/workflows/ingest.yml'

function minutesSince(iso: string): number {
  const t = Date.parse(iso)
  return t > 0 ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : 0
}

// The contributor reviews what ingestion extracted (tables, OCR quality, flags) against the
// source PDF, then publishes / rejects / retries / replaces the file / deletes the version.
export function ReviewUpload() {
  const { versionId } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
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
        <button className="secondary" onClick={() => navigate('/', { replace: true })}>
          ← Manual library
        </button>
      </div>
    )
  if (!data) return <div className="page-body">Loading…</div>

  const { version, job, tableChunks, totalChunks, sourceUrl } = data
  const pending = version.status === 'pending'
  const canDecide = job?.state === 'review' && pending
  const running = job != null && ['queued', 'parsing'].includes(job.state)
  const elapsedMin = job ? minutesSince(job.startedAt) : 0
  const idleMin = job ? minutesSince(job.updatedAt) : 0
  // The server-side watchdog fails a wedged job, but only after its budget; flag it
  // in the UI sooner so the reviewer isn't left staring at a spinner.
  const looksStuck = job?.state === 'parsing' && idleMin >= 20
  // Recovery actions are available on a pending version once ingestion is terminal-bad
  // (failed / rejected) or is clearly wedged.
  const canRecover =
    pending && (job == null || ['failed', 'rejected'].includes(job.state) || looksStuck)

  // Stays on the page and re-polls (retry / replace).
  async function run(fn: () => Promise<unknown>, label: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // Navigates away on success (publish / reject / delete).
  async function leave(fn: () => Promise<unknown>, label: string) {
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

  function reject() {
    const reason = window.prompt('Reason for rejecting (optional):') ?? ''
    leave(() => rejectVersion(version.id, reason), 'reject')
  }

  function del() {
    if (
      !window.confirm(
        'Delete this version, its source file, and everything ingestion extracted? This cannot be undone.',
      )
    )
      return
    leave(() => deleteVersion(version.id), 'delete')
  }

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file after an error
    if (!file) return
    await run(async () => {
      const { url } = await reuploadSourceUrl(version.id)
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' },
        body: file,
      })
      if (!put.ok) throw new Error(`upload failed (HTTP ${put.status})`)
      await retryIngest(version.id)
    }, 'replace')
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
            Fix the source file if needed, then <strong>Retry</strong> or <strong>Replace the
            PDF</strong> below.
          </div>
        )}
        {job?.state === 'rejected' && (
          <div className="msg info">
            This upload was rejected{job.error ? `: ${job.error}` : ''}. Its extracted data has
            been discarded — <strong>Retry</strong> or <strong>Delete</strong> below.
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
                This has run unusually long — use <strong>Retry</strong> or{' '}
                <strong>Delete</strong> below.
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

        {pending && (canDecide || canRecover) && (
          <div className="review-actions">
            {canDecide && (
              <button disabled={busy} onClick={() => leave(() => publishVersion(version.id), 'publish')}>
                {busy ? 'Working…' : 'Approve & publish version'}
              </button>
            )}
            {canRecover && (
              <button disabled={busy} onClick={() => run(() => retryIngest(version.id), 'retry')}>
                Retry ingestion
              </button>
            )}
            {(canDecide || canRecover) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                Replace PDF…
              </button>
            )}
            <button className="secondary" disabled={busy} onClick={reject}>
              Reject upload
            </button>
            <button className="danger" disabled={busy} onClick={del}>
              Delete version
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onFilePicked}
            />
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

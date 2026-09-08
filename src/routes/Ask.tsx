import { type FormEvent, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ask, type AskVersion, getAskVersion } from '../lib/api'
import type { AnswerResult, Citation } from '../lib/schema'

// pdf.js is heavy — only load the slide-over (and its worker) when a citation is opened.
const SourceSlideOver = lazy(() =>
  import('../components/SourceSlideOver').then((m) => ({ default: m.SourceSlideOver })),
)

type Turn = {
  id: number
  question: string
  pending: boolean
  result?: AnswerResult
  error?: string
}

// Reading-first Ask screen (Main artboard). One version per session (route param); the
// header is a non-interactive lock. Each answer is stamped with the version that produced it.
export function Ask() {
  const { versionId = '' } = useParams()
  const [version, setVersion] = useState<AskVersion | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [cite, setCite] = useState<{ page: number; quote: string } | null>(null)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getAskVersion(versionId).then(setVersion).catch((e) => setLoadErr(String(e.message ?? e)))
  }, [versionId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const q = draft.trim()
    if (!q || !version) return
    const id = nextId.current++
    setTurns((t) => [...t, { id, question: q, pending: true }])
    setDraft('')
    try {
      const result = await ask(versionId, q)
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, result } : x)))
    } catch (err) {
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? { ...x, pending: false, error: err instanceof Error ? err.message : String(err) }
            : x,
        ),
      )
    }
  }

  if (loadErr) {
    return (
      <div className="page-body">
        <div className="msg err">{loadErr}</div>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/">← Manual library</Link>
        </p>
      </div>
    )
  }
  if (!version) return <div className="page-body">Loading…</div>

  const meta = [version.edition, version.year, 'version locked'].filter(Boolean).join(' · ')

  return (
    <div className="ask-main">
      <header className="ask-lock">
        <span className="ask-lock-label">ANSWERING FROM</span>
        <span className="ask-lock-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="l-lines">
            <span className="l-title">
              {version.instrument?.name ?? 'Manual'} · {version.title}
            </span>
            <span className="l-sub">{meta}</span>
          </span>
        </span>
        <Link to="/" className="ask-back">
          ← Manuals
        </Link>
      </header>

      <div className="ask-thread">
        <div className="center-col">
          {turns.length === 0 && (
            <p className="empty">
              Ask a question about <strong>{version.instrument?.name}</strong>.
              <br />
              Answers come only from this version, with page citations — or “not found in this
              version”.
            </p>
          )}

          {turns.map((t) => (
            <section key={t.id} className="turn">
              <p className="turn-q">{t.question}</p>
              {t.pending && <p className="turn-pending">Reading the manual…</p>}
              {t.error && <div className="msg err">{t.error}</div>}
              {t.result && (
                <Answer
                  result={t.result}
                  manual={`${version.instrument?.name ?? 'Manual'} · ${version.title}`}
                  onCite={(page, quote) => setCite({ page, quote })}
                />
              )}
            </section>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composer-inner">
          <div className="composer-box">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit(e as unknown as FormEvent)
                }
              }}
              rows={1}
              placeholder={`Ask about the ${version.title}…`}
            />
            <button type="submit" className="composer-send" disabled={!draft.trim()} aria-label="Ask">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          <p className="composer-hint">
            Answers are quoted from the selected manual version only — never the open web. Always
            verify against the source before clinical use.
          </p>
        </div>
      </form>

      {cite && (
        <Suspense fallback={<div className="slideover-scrim" />}>
          <SourceSlideOver
            versionId={versionId}
            page={cite.page}
            quote={cite.quote}
            manualLabel={`${version.instrument?.name ?? 'Manual'} · ${version.title}`}
            onClose={() => setCite(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

function Answer({
  result,
  manual,
  onCite,
}: {
  result: AnswerResult
  manual: string
  onCite: (page: number, quote: string) => void
}) {
  if (result.abstained) {
    return (
      <div className="abstain-card">
        <div className="a-head">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          Not found in this version
        </div>
        <p>This version of the manual doesn’t answer that.</p>
        <Link to="/">
          <button className="btn-switch">Choose another manual →</button>
        </Link>
      </div>
    )
  }

  const pages = [...new Set(result.citations.map((c) => c.page))].sort((a, b) => a - b)
  const lead = result.citations[0]

  return (
    <div className="answer-card">
      <p className="answer-prose">{renderWithCitations(result.answer, result.citations, onCite)}</p>

      {lead && lead.quote.trim().length > 0 && (
        <blockquote className="answer-quote">“{lead.quote.trim()}”</blockquote>
      )}

      {result.citations.length > 0 && (
        <div className="cite-row">
          {result.citations.map((c, i) => (
            <button
              key={`${c.chunkId}-${i}`}
              className="cite-chip"
              onClick={() => onCite(c.page, c.quote)}
              title={c.quote}
            >
              [{i + 1}] p.{c.page}
            </button>
          ))}
        </div>
      )}

      <div className="answer-verified">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        Verified against source · {manual}
        {pages.length > 0 && `, p. ${pages.join(', ')}`}
      </div>
    </div>
  )
}

// Bold each cited quote where it appears verbatim in the answer and drop an inline chip
// right after it; citations whose quote isn't found inline still show in the trailing row.
function renderWithCitations(
  answer: string,
  citations: Citation[],
  onCite: (page: number, quote: string) => void,
): ReactNode {
  const marks: { start: number; end: number; idx: number; c: Citation }[] = []
  citations.forEach((c, idx) => {
    const q = c.quote.trim()
    if (q.length < 8) return
    const at = answer.indexOf(q)
    if (at >= 0) marks.push({ start: at, end: at + q.length, idx, c })
  })
  marks.sort((a, b) => a.start - b.start)
  if (marks.length === 0) return answer

  const out: ReactNode[] = []
  let pos = 0
  for (const m of marks) {
    if (m.start < pos) continue // overlapping quote, skip
    if (m.start > pos) out.push(answer.slice(pos, m.start))
    out.push(
      <mark key={`m${m.idx}`} className="cited">
        {answer.slice(m.start, m.end)}
      </mark>,
    )
    out.push(
      <button
        key={`c${m.idx}`}
        className="cite-sup"
        onClick={() => onCite(m.c.page, m.c.quote)}
        title={`page ${m.c.page}`}
      >
        {m.idx + 1}
      </button>,
    )
    pos = m.end
  }
  if (pos < answer.length) out.push(answer.slice(pos))
  return out
}

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

// Reading-first Ask screen. One version per session (route param); the header is a
// non-interactive lock. Each answer is stamped with the version that produced it.
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
      <main className="wrap">
        <div className="msg err">{loadErr}</div>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/">← Manuals</Link>
        </p>
      </main>
    )
  }
  if (!version) return <main className="wrap">Loading…</main>

  return (
    <>
      <div className="ask-lock">
        <div className="ask-lock-inner">
          <Link to="/" className="ask-back">
            ← Manuals
          </Link>
          <div className="ask-lock-meta">
            <strong>{version.instrument?.name ?? 'Manual'}</strong>
            <span>
              {version.title}
              {version.edition ? ` · ${version.edition}` : ''}
              {version.year ? ` · ${version.year}` : ''}
            </span>
          </div>
        </div>
      </div>

      <main className="wrap ask-column">
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
            {t.result && <Answer result={t.result} onCite={(page, quote) => setCite({ page, quote })} />}
          </section>
        ))}
        <div ref={endRef} />
      </main>

      <form className="composer" onSubmit={submit}>
        <div className="composer-inner">
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
            placeholder={`Ask ${version.instrument?.name ?? 'this manual'}…`}
          />
          <button type="submit" disabled={!draft.trim()}>
            Ask
          </button>
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
    </>
  )
}

function Answer({
  result,
  onCite,
}: {
  result: AnswerResult
  onCite: (page: number, quote: string) => void
}) {
  if (result.abstained) {
    return (
      <div className="answer">
        <div className="msg info abstain">
          <strong>Not found in this version.</strong>
          <br />
          This version of the manual doesn’t answer that.{' '}
          <Link to="/">Choose another manual →</Link>
        </div>
      </div>
    )
  }
  return (
    <div className="answer">
      <div className="answer-prose">{renderWithCitations(result.answer, result.citations, onCite)}</div>
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

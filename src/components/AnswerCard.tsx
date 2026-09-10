import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AnswerResult, Citation } from '../lib/schema'

// The rendered answer — grounded card (prose + inline citations + lead pull-quote +
// "verified against source" row) or the amber abstain card. Extracted verbatim from
// Ask.tsx so the Ask thread and the /history screen render answers identically.
export function AnswerCard({
  result,
  manual,
  onCite,
}: {
  result: Pick<AnswerResult, 'answer' | 'citations' | 'abstained'> & { kind?: AnswerResult['kind'] }
  manual: string
  onCite: (page: number, quote: string) => void
}) {
  // A "meta" answer is about the conversation itself — no manual claim, no citation.
  if (result.kind === 'meta') {
    return (
      <div className="meta-card">
        <div className="a-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          From your conversation
        </div>
        <p>{result.answer}</p>
      </div>
    )
  }

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

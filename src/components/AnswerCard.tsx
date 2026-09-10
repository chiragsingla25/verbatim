import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { type CitedChunk, citedChunkContent } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { type AnswerResult, type Citation, FACTS_CHUNK_ID } from '../lib/schema'
import { parseMarkdownTable } from '../lib/tables'

// The rendered answer — grounded card (prose + inline citations + lead pull-quote +
// "verified against source" row) or the amber abstain card. Extracted from Ask.tsx so the
// Ask thread and the /history screen render answers identically.
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
          Not in this edition
        </div>
        <p>
          This version of the manual doesn’t cover that. Try another edition from the library,
          or rephrase your question.
        </p>
        <Link to="/">
          <button className="btn-switch">Browse the library →</button>
        </Link>
      </div>
    )
  }

  return <GroundedAnswer result={result} manual={manual} onCite={onCite} />
}

function GroundedAnswer({
  result,
  manual,
  onCite,
}: {
  result: Pick<AnswerResult, 'answer' | 'citations'> & { kind?: AnswerResult['kind'] }
  manual: string
  onCite: (page: number, quote: string) => void
}) {
  // __facts__ is catalog metadata, not a manual page — no page link, no source slide-over.
  const factsCited = result.citations.some((c) => c.chunkId === FACTS_CHUNK_ID)
  const pageCites = result.citations.filter((c) => c.chunkId !== FACTS_CHUNK_ID)
  const pages = [...new Set(pageCites.map((c) => c.page))].sort((a, b) => a - b)
  const lead = pageCites[0]
  const [copied, setCopied] = useState<'idle' | 'ok' | 'hint'>('idle')

  // Cited chunks that are (or contain) a table — fetched for the in-answer table excerpt.
  const [chunks, setChunks] = useState<Record<string, CitedChunk>>({})
  const citedIds = [...new Set(pageCites.map((c) => c.chunkId))]
  const idsKey = citedIds.join(',')
  useEffect(() => {
    if (citedIds.length === 0) return
    let live = true
    citedChunkContent(citedIds)
      .then((m) => live && setChunks(m))
      .catch(() => {
        /* source display is best-effort — a fetch failure just omits the table excerpt */
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const tableChunks = citedIds
    .map((id) => ({ id, chunk: chunks[id] }))
    .filter((x): x is { id: string; chunk: CitedChunk } => !!x.chunk?.tableRef)

  async function copy() {
    const src = pageCites
      .map((c) => `— ${manual}, p.${c.page}: "${c.quote.trim()}"`)
      .join('\n')
    const text = factsCited
      ? `${result.answer}\n\nSources:\n${src}\n— ${manual} (document metadata)`
      : `${result.answer}\n\nSources:\n${src}`
    setCopied((await copyText(text)) ? 'ok' : 'hint')
    setTimeout(() => setCopied('idle'), 2500)
  }

  return (
    <div className="answer-card">
      <p className="answer-prose">{renderWithCitations(result.answer, pageCites, onCite)}</p>

      {lead && lead.quote.trim().length > 0 && (
        <blockquote className="answer-quote">“{lead.quote.trim()}”</blockquote>
      )}

      {tableChunks.map(({ id, chunk }) => (
        <TableExcerpt key={id} chunk={chunk} onView={() => onCite(chunk.page, '')} />
      ))}

      {(pageCites.length > 0 || factsCited) && (
        <div className="cite-row">
          {pageCites.map((c, i) => (
            <button
              key={`${c.chunkId}-${i}`}
              className="cite-chip"
              onClick={() => onCite(c.page, c.quote)}
              title={c.quote}
            >
              [{i + 1}] p.{c.page}
            </button>
          ))}
          {factsCited && <span className="cite-chip meta">Document metadata</span>}
          <button type="button" className="cite-chip copy" onClick={copy}>
            {copied === 'ok' ? 'Copied' : copied === 'hint' ? 'Press ⌘/Ctrl-C' : 'Copy'}
          </button>
        </div>
      )}

      <div className="answer-verified">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {pages.length > 0 ? (
          <>
            Verified against source · {manual}, p. {pages.join(', ')}
          </>
        ) : (
          <>Answered from this version’s catalog metadata</>
        )}
      </div>
    </div>
  )
}

// A cited chunk that is / contains a table. The v1 corpus stores tables flattened (not a
// grid), so this shows the excerpt text in a labelled block + a jump to the source page
// where the real table is laid out. parseMarkdownTable handles a future grid-text re-ingest.
function TableExcerpt({ chunk, onView }: { chunk: CitedChunk; onView: () => void }) {
  const parsed = parseMarkdownTable(chunk.content)
  return (
    <figure className="answer-table">
      <figcaption>
        From a table · p.{chunk.page}
        <button type="button" className="link" onClick={onView}>
          See it on the source page →
        </button>
      </figcaption>
      {parsed ? (
        <div className="answer-table-scroll">
          <table>
            <thead>
              <tr>
                {parsed.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre>{chunk.content}</pre>
      )}
    </figure>
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

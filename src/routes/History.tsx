import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnswerCard } from '../components/AnswerCard'
import { type HistoryEntry, type HistoryManual, historyManuals, listMyHistory } from '../lib/api'
import { relDate } from '../lib/format'

const SourceSlideOver = lazy(() =>
  import('../components/SourceSlideOver').then((m) => ({ default: m.SourceSlideOver })),
)

const PAGE = 25

function snippet(h: HistoryEntry): string {
  if (h.abstained) return 'Not found in this version.'
  return h.answer.length > 140 ? `${h.answer.slice(0, 140)}…` : h.answer
}

// "My answers" — the caller's past Q&A from query_log, re-rendered with no /ask call.
export function History() {
  const [filter, setFilter] = useState('') // versionId, or '' for all
  const [manuals, setManuals] = useState<HistoryManual[]>([])
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [cite, setCite] = useState<{ versionId: string; page: number; quote: string } | null>(null)
  // Bumped on every filter change; loadMore discards a response whose gen is stale.
  const gen = useRef(0)

  useEffect(() => {
    historyManuals().then(setManuals).catch(() => setManuals([]))
  }, [])

  // Fetch on mount and whenever the manual filter changes. State is only touched in the
  // async callbacks (never synchronously in the effect body); the old list stays visible
  // until the new page arrives, so no loading flash between filters.
  useEffect(() => {
    gen.current += 1
    const myGen = gen.current
    listMyHistory({ versionId: filter || undefined, limit: PAGE })
      .then((rows) => {
        if (gen.current !== myGen) return
        setEntries(rows)
        setDone(rows.length < PAGE)
        setOpenId(null)
        setError(null)
      })
      .catch((e) => gen.current === myGen && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => gen.current === myGen && setLoading(false))
  }, [filter])

  async function loadMore() {
    const last = entries[entries.length - 1]
    if (!last) return
    const myGen = gen.current
    setLoading(true)
    try {
      const rows = await listMyHistory({
        versionId: filter || undefined,
        before: { at: last.at, id: last.id },
        limit: PAGE,
      })
      if (gen.current !== myGen) return // filter changed mid-fetch — drop this page
      setEntries((e) => [...e, ...rows])
      setDone(rows.length < PAGE)
    } catch (e) {
      if (gen.current === myGen) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen.current === myGen) setLoading(false)
    }
  }

  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <h1>My answers</h1>
            <p className="subtitle">
              Every question you’ve asked, newest first — shown exactly as answered, with no new
              lookup.
            </p>
          </div>
          {manuals.length > 1 && (
            <select
              className="hist-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by manual"
            >
              <option value="">All manuals</option>
              {manuals.map((m) => (
                <option key={m.versionId} value={m.versionId}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="page-body">
        {error && <div className="msg err">{error}</div>}

        {!loading && !error && entries.length === 0 && (
          <p className="empty">
            No questions yet.
            <br />
            Open a manual from the library and ask something.
          </p>
        )}

        {entries.map((h) => {
          const open = openId === h.id
          return (
            <div key={h.id} className={open ? 'hist-row open' : 'hist-row'}>
              <button className="hist-head" onClick={() => setOpenId(open ? null : h.id)}>
                <span className="hist-q">{h.question}</span>
                {!open && <span className="hist-snip">{snippet(h)}</span>}
                <span className="hist-meta">
                  {h.manualLabel} · {relDate(h.at)}
                </span>
              </button>
              {open && (
                <div className="hist-expand">
                  <AnswerCard
                    result={h}
                    manual={h.manualLabel}
                    onCite={(page, quote) => setCite({ versionId: h.versionId, page, quote })}
                  />
                  {h.manualActive && (
                    <Link
                      className="hist-reask"
                      to={`/ask/${h.versionId}?q=${encodeURIComponent(h.question)}`}
                    >
                      Re-ask this against the current version →
                    </Link>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {loading && <p className="turn-pending">Loading…</p>}
        {!loading && !done && entries.length > 0 && (
          <button className="secondary hist-more" onClick={loadMore}>
            Load more
          </button>
        )}
      </div>

      {cite && (
        <Suspense fallback={<div className="slideover-scrim" />}>
          <SourceSlideOver
            versionId={cite.versionId}
            page={cite.page}
            quote={cite.quote}
            manualLabel={entries.find((e) => e.versionId === cite.versionId)?.manualLabel ?? 'Source'}
            onClose={() => setCite(null)}
          />
        </Suspense>
      )}
    </>
  )
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnswerCard } from '../components/AnswerCard'
import {
  type HistoryEntry,
  type HistoryManual,
  getSession,
  historyManuals,
  listMySessions,
  renameSession,
  type SessionSummary,
} from '../lib/api'
import { copyText } from '../lib/clipboard'
import { errMessage, relDate } from '../lib/format'

const SourceSlideOver = lazy(() =>
  import('../components/SourceSlideOver').then((m) => ({ default: m.SourceSlideOver })),
)

const PAGE = 25

// "My answers" — the caller's conversations, most-recently-active first. Expanding one
// re-renders its turns from query_log (no /ask call); "Resume" re-opens it in Ask.
export function History() {
  const [filter, setFilter] = useState('') // versionId, or '' for all
  const [manuals, setManuals] = useState<HistoryManual[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Record<string, HistoryEntry[]>>({})
  const [cite, setCite] = useState<{ versionId: string; page: number; quote: string } | null>(null)
  const [copyMsg, setCopyMsg] = useState<{ id: string; text: string } | null>(null)
  const [q, setQ] = useState('') // free-text filter over loaded conversations
  const gen = useRef(0)

  const needle = q.trim().toLowerCase()
  const shown = needle
    ? sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(needle) || s.manualLabel.toLowerCase().includes(needle),
      )
    : sessions

  async function rename(s: SessionSummary) {
    const next = window.prompt('Rename this conversation:', s.title)
    if (next == null || next.trim() === s.title) return
    try {
      await renameSession(s.sessionId, next)
      setSessions((rows) =>
        rows.map((r) => (r.sessionId === s.sessionId ? { ...r, title: next.trim().slice(0, 120) } : r)),
      )
    } catch (e) {
      setError(errMessage(e))
    }
  }

  async function copyConversation(s: SessionSummary, entries: HistoryEntry[]) {
    const body = entries
      .map((h) => `Q: ${h.question}\nA: ${h.abstained ? 'Not found in this version.' : h.answer}`)
      .join('\n\n')
    const text = `${s.manualLabel} — ${s.title}\n\n${body}\n`
    const ok = await copyText(text)
    setCopyMsg({ id: s.sessionId, text: ok ? 'Copied' : 'Press ⌘/Ctrl-C to copy' })
    setTimeout(() => setCopyMsg((m) => (m?.id === s.sessionId ? null : m)), 2500)
  }

  useEffect(() => {
    historyManuals().then(setManuals).catch(() => setManuals([]))
  }, [])

  useEffect(() => {
    gen.current += 1
    const myGen = gen.current
    listMySessions({ versionId: filter || undefined, limit: PAGE })
      .then((rows) => {
        if (gen.current !== myGen) return
        setSessions(rows)
        setDone(rows.length < PAGE)
        setOpenId(null)
        setError(null)
      })
      .catch((e) => gen.current === myGen && setError(errMessage(e)))
      .finally(() => gen.current === myGen && setLoading(false))
  }, [filter])

  async function loadMore() {
    const last = sessions[sessions.length - 1]
    if (!last) return
    const myGen = gen.current
    setLoading(true)
    try {
      const rows = await listMySessions({
        versionId: filter || undefined,
        before: { lastAt: last.lastAt, id: last.sessionId },
        limit: PAGE,
      })
      if (gen.current !== myGen) return
      setSessions((s) => [...s, ...rows])
      setDone(rows.length < PAGE)
    } catch (e) {
      if (gen.current === myGen) setError(errMessage(e))
    } finally {
      if (gen.current === myGen) setLoading(false)
    }
  }

  function toggle(s: SessionSummary) {
    if (openId === s.sessionId) {
      setOpenId(null)
      return
    }
    setOpenId(s.sessionId)
    if (!turns[s.sessionId]) {
      getSession(s.sessionId)
        .then((t) => setTurns((m) => ({ ...m, [s.sessionId]: t })))
        .catch((e) => setError(errMessage(e)))
    }
  }

  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <h1>My answers</h1>
            <p className="subtitle">
              Your conversations, most recent first — each shown exactly as answered, with no
              new lookup. Open one and pick up where you left off.
            </p>
          </div>
          <div className="hist-controls">
            <input
              className="hist-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
            />
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
        </div>
      </header>

      <div className="page-body">
        {error && <div className="msg err">{error}</div>}

        {!loading && !error && sessions.length === 0 && (
          <p className="empty">
            No conversations yet.
            <br />
            Open a manual from the library and ask something.
          </p>
        )}

        {!loading && sessions.length > 0 && shown.length === 0 && (
          <p className="empty">No conversations match “{q.trim()}”.</p>
        )}

        {shown.map((s) => {
          const open = openId === s.sessionId
          const t = turns[s.sessionId]
          return (
            <div key={s.sessionId} className={open ? 'hist-row open' : 'hist-row'}>
              <button className="hist-head" onClick={() => toggle(s)}>
                <span className="hist-q">{s.title}</span>
                <span className="hist-meta">
                  {s.manualLabel} · {s.turnCount} {s.turnCount === 1 ? 'question' : 'questions'} ·{' '}
                  {relDate(s.lastAt)}
                </span>
              </button>
              {open && (
                <div className="hist-expand">
                  {!t && <p className="turn-pending">Loading…</p>}
                  {t && t.length === 0 && (
                    <p className="turn-pending">This conversation has no saved answers.</p>
                  )}
                  {t?.map((h) => (
                    <section key={h.id} className="turn">
                      <p className="turn-q">{h.question}</p>
                      <AnswerCard
                        result={h}
                        manual={s.manualLabel}
                        onCite={(page, quote) =>
                          setCite({ versionId: s.versionId, page, quote })
                        }
                      />
                    </section>
                  ))}
                  {!s.manualActive && (
                    <p className="hist-retired">
                      This manual version has been retired — you can still read this
                      conversation, but not continue it.
                    </p>
                  )}
                  <div className="hist-actions">
                    <button type="button" className="link" onClick={() => rename(s)}>
                      Rename
                    </button>
                    {t && t.length > 0 && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => copyConversation(s, t)}
                      >
                        {copyMsg?.id === s.sessionId ? copyMsg.text : 'Copy conversation'}
                      </button>
                    )}
                    {s.manualActive && (
                      <Link className="hist-reask" to={`/ask/${s.versionId}?s=${s.sessionId}`}>
                        Resume this conversation →
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {loading && <p className="turn-pending">Loading…</p>}
        {!loading && !done && sessions.length > 0 && (
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
            manualLabel={
              sessions.find((s) => s.versionId === cite.versionId)?.manualLabel ?? 'Source'
            }
            onClose={() => setCite(null)}
          />
        </Suspense>
      )}
    </>
  )
}

import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AnswerCard } from '../components/AnswerCard'
import { AnswerProgress } from '../components/AnswerProgress'
import { ask, type AskVersion, getAskVersion, getSession, newSessionId } from '../lib/api'
import { instrumentBadge } from '../lib/instrument'
import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from '../lib/schema'
import type { AnswerResult } from '../lib/schema'
import { startersFor } from '../lib/starters'

// pdf.js is heavy — only load the slide-over (and its worker) when a citation is opened.
const SourceSlideOver = lazy(() =>
  import('../components/SourceSlideOver').then((m) => ({ default: m.SourceSlideOver })),
)

type TurnAnswer = Pick<AnswerResult, 'answer' | 'citations' | 'abstained'> & {
  kind?: AnswerResult['kind']
}
type Turn = {
  id: number
  question: string
  pending: boolean
  result?: TurnAnswer
  error?: string
}

// Reading-first Ask screen (Main artboard). One version per session (route param); the
// header is a non-interactive lock. The conversation id lives in ?s= so a reload rehydrates
// the thread; "New chat" starts a fresh ?s=.
export function Ask() {
  const { versionId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [version, setVersion] = useState<AskVersion | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  // Prefill the composer from ?q= (e.g. a "Re-ask" from /history). Not auto-submitted.
  const [draft, setDraft] = useState(() => searchParams.get('q') ?? '')
  const [cite, setCite] = useState<{ page: number; quote: string } | null>(null)
  // v1.5: the model selector. Doubles as preference AND status — a server-side fallback
  // updates this after an answer comes back (see runTurn), so the control always reflects
  // what actually just answered, not just what was asked for.
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const sessionId = searchParams.get('s') ?? ''
  const hydratedFor = useRef<string | null>(null)

  useEffect(() => {
    getAskVersion(versionId).then(setVersion).catch((e) => setLoadErr(String(e.message ?? e)))
  }, [versionId])

  // Ensure a session id in the URL; rehydrate its turns once.
  useEffect(() => {
    if (!sessionId) {
      setSearchParams(
        (p) => {
          p.set('s', newSessionId())
          return p
        },
        { replace: true },
      )
      return
    }
    if (hydratedFor.current === sessionId) return
    hydratedFor.current = sessionId
    getSession(sessionId)
      .then((entries) => {
        if (entries.length === 0) return
        // don't clobber a turn the user submitted while this was in flight
        setTurns((prev) =>
          prev.length > 0
            ? prev
            : entries.map((e) => ({
                id: nextId.current++,
                question: e.question,
                pending: false,
                result: {
                  answer: e.answer,
                  citations: e.citations,
                  abstained: e.abstained,
                  kind: e.kind,
                },
              })),
        )
      })
      .catch(() => {
        /* a bad ?s= just starts an empty thread */
      })
  }, [sessionId, setSearchParams])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  // "/" focuses the composer (unless the user is already typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      composerRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function newChat() {
    hydratedFor.current = null
    setTurns([])
    nextId.current = 1
    setDraft('')
    setSearchParams(
      (p) => {
        p.set('s', newSessionId())
        p.delete('q')
        return p
      },
      { replace: true },
    )
  }

  // Run (or re-run) one turn's /ask call and fold the result/error back into that turn.
  async function runTurn(id: number, q: string) {
    if (!sessionId) return
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: true, error: undefined } : x)))
    try {
      const result = await ask(versionId, q, sessionId, modelId)
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, result } : x)))
      // Reflect whichever model actually answered — a fallback flips the selector itself.
      if (result.modelId && MODEL_REGISTRY.some((m) => m.id === result.modelId)) {
        setModelId(result.modelId)
      }
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

  async function submit(e: FormEvent) {
    e.preventDefault()
    const q = draft.trim()
    if (!q || !version || !sessionId) return
    const id = nextId.current++
    setTurns((t) => [...t, { id, question: q, pending: true }])
    setDraft('')
    runTurn(id, q)
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
  const badge = instrumentBadge(version.instrument?.name)

  return (
    <div className="ask-main">
      <header className="ask-lock">
        <span className="ask-lock-label">ANSWERING FROM</span>
        <span className="ask-lock-chip">
          <span className="inst-badge sm" style={{ background: badge.tint }} aria-hidden="true">
            {badge.initials}
          </span>
          <svg className="ask-lock-pad" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        {turns.length > 0 && (
          <button type="button" className="link ask-newchat" onClick={newChat}>
            + New chat
          </button>
        )}
        <Link to="/" className="ask-back">
          ← Manuals
        </Link>
        {version.supersededBy && (
          <Link to={`/ask/${version.supersededBy.id}`} className="ask-superseded">
            Superseded by {version.supersededBy.title} →
          </Link>
        )}
      </header>

      <div className="ask-thread">
        <div className="center-col">
          {turns.length === 0 && (
            <div className="ask-welcome">
              <p className="empty">
                Ask a question about <strong>{version.instrument?.name}</strong>.
                <br />
                Answers come only from this version, with page citations — or “not found in
                this version”.
              </p>
              <div className="ask-starters">
                {startersFor(version.instrument?.slug).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ask-starter"
                    onClick={() => {
                      setDraft(s)
                      composerRef.current?.focus()
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) => (
            <section key={t.id} className="turn">
              <p className="turn-q">{t.question}</p>
              {t.pending && <AnswerProgress />}
              {t.error && (
                <div className="msg err">
                  {t.error}
                  <button type="button" className="link turn-retry" onClick={() => runTurn(t.id, t.question)}>
                    Try again
                  </button>
                </div>
              )}
              {t.result && (
                <AnswerCard
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
              ref={composerRef}
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
          <div className="composer-foot">
            <p className="composer-hint">
              Answers are quoted from the selected manual version only — never the open web.
              Always verify against the source before clinical use.
            </p>
            <select
              className="composer-model"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              aria-label="Answer model"
              title="Which model answers your questions. Switches automatically if your pick is unavailable."
            >
              {MODEL_REGISTRY.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
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

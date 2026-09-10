// The /ask pipeline, pure and dependency-injected so `deno test` needs no network or
// node_modules. index.ts wires the real embed / match_chunks / LLM / query_log.
//
//   embed(question) -> match_chunks(versionId, vec, k) -> generate (cited draft)
//   -> verify (drop unsupported claims -> revisedAnswer) -> AnswerResult -> log
//
// Invariant: the returned AnswerResult has >=1 citation OR abstained === true. Never both,
// never neither. match_chunks is RLS-enforced + version-filtered, so any valid chunkId is
// necessarily a chunk in `versionId`.
import {
  ABSTAIN_MESSAGE,
  type AnswerResult,
  answerDraftSchema,
  answerResultSchema,
  type Citation,
  verifyResultSchema,
} from '../_shared/schema.ts'
import {
  ANSWER_CONV_RULES,
  ANSWER_SYSTEM,
  answerUserPrompt,
  CONDENSE_SYSTEM,
  condenseUserPrompt,
  META_SYSTEM,
  metaUserPrompt,
  type RetrievedChunk,
  SUMMARY_SYSTEM,
  summaryUserPrompt,
  VERIFY_CONV_RULE,
  VERIFY_SYSTEM,
  verifyUserPrompt,
} from '../_shared/prompt.ts'
import { chatJson, type ChatFn } from '../_shared/llm.ts'

// Spec's k≈10–12. Kept at 12 (the Phase 2-verified value): dropping to 10 for latency
// regressed the eval suite (missed facts that sat in rank 11–12 chunks). Latency is held
// down instead by the lean verify context below.
const RETRIEVE_K = 12

// v1.2 conversation-context budgets.
const HISTORY_RECENT_CHARS = 5000 // verbatim recent turns given to the answer step
const SUMMARY_MAX_CHARS = 1500 // the rolling summary of older turns

export type PriorTurn = { turn: number; question: string; answer: string }

export type SessionHistory = {
  summary: string
  summaryThroughTurn: number
  // every turn strictly before the current one and after summaryThroughTurn, oldest first.
  priorTurns: PriorTurn[]
}

export type AskInput = { versionId: string; question: string; sessionId: string }

export type AnswerKind = 'grounded' | 'abstained' | 'meta'

export type AskDeps = {
  embed: (text: string) => Promise<number[]>
  matchChunks: (versionId: string, embedding: number[], k: number) => Promise<RetrievedChunk[]>
  chat: ChatFn
  // Start-or-advance the session; returns this turn's 1-based number.
  nextTurn: (sessionId: string, versionId: string, title: string) => Promise<number>
  // Prior turns + the rolling summary for this session.
  getHistory: (sessionId: string) => Promise<SessionHistory>
  // Persist an advanced rolling summary (best-effort — a failure must not fail the answer).
  saveSummary: (sessionId: string, summary: string, throughTurn: number) => Promise<void>
  logQuery: (row: QueryLogRow) => Promise<void>
  now: () => number
}

export type QueryLogRow = {
  session_id: string
  turn: number
  version_id: string
  question: string
  answer: string
  abstained: boolean
  kind: AnswerKind
  citations: Citation[]
  retrieved: { chunkId: string; page: number; score: number }[]
  verify: { supported: boolean; unsupportedClaims: string[]; revisedAnswer: string } | null
  latency_ms: number
}

// Split prior turns into a verbatim recent window (fits the char budget, newest-biased,
// always keeps at least the latest turn) and the older turns to fold into the summary.
export function splitHistory(
  priorTurns: PriorTurn[],
  budget = HISTORY_RECENT_CHARS,
): { recent: PriorTurn[]; toFold: PriorTurn[] } {
  if (priorTurns.length === 0) return { recent: [], toFold: [] }
  const recent: PriorTurn[] = []
  let used = 0
  for (let i = priorTurns.length - 1; i >= 0; i--) {
    const t = priorTurns[i]
    const cost = t.question.length + t.answer.length
    if (recent.length > 0 && used + cost > budget) break
    recent.unshift(t)
    used += cost
  }
  const cut = priorTurns.length - recent.length
  return { recent, toFold: priorTurns.slice(0, cut) }
}

function parseCondense(o: unknown): { standalone: string } | null {
  if (!o || typeof o !== 'object') return null
  const s = (o as Record<string, unknown>).standalone
  return typeof s === 'string' && s.trim() ? { standalone: s.trim() } : null
}
function parseSummary(o: unknown): { summary: string } | null {
  if (!o || typeof o !== 'object') return null
  const s = (o as Record<string, unknown>).summary
  return typeof s === 'string' ? { summary: s.trim() } : null
}
function parseMeta(o: unknown): { answer: string } | null {
  if (!o || typeof o !== 'object') return null
  const a = (o as Record<string, unknown>).answer
  return typeof a === 'string' && a.trim() ? { answer: a.trim() } : null
}

const META_FALLBACK =
  'I can only answer questions about the selected manual. Your full history is in “My answers”.'

// Normalise the model's loose output into the schema shape (coerce page numbers, drop
// half-formed citations), THEN validate against the zod schema — a boundary object is
// never a raw dict. A validation failure returns null -> the pipeline abstains.
function parseDraft(o: unknown) {
  if (typeof o !== 'object' || o === null) return null
  const d = o as Record<string, unknown>
  const citations = Array.isArray(d.citations)
    ? d.citations
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .filter((c) => typeof c.chunkId === 'string' && typeof c.quote === 'string')
        .map((c) => ({
          chunkId: c.chunkId as string,
          page: Number.isFinite(Number(c.page)) ? Math.trunc(Number(c.page)) : 0,
          quote: c.quote as string,
        }))
    : []
  const parsed = answerDraftSchema.safeParse({ answer: d.answer, citations, abstained: d.abstained })
  return parsed.success ? parsed.data : null
}

function parseVerify(o: unknown) {
  if (typeof o !== 'object' || o === null) return null
  const v = o as Record<string, unknown>
  const parsed = verifyResultSchema.safeParse({
    supported: v.supported,
    unsupportedClaims: Array.isArray(v.unsupportedClaims)
      ? v.unsupportedClaims.filter((x): x is string => typeof x === 'string')
      : undefined,
    revisedAnswer: typeof v.revisedAnswer === 'string' ? v.revisedAnswer : undefined,
  })
  return parsed.success ? parsed.data : null
}

function looksLikeAbstention(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t === '' || t === ABSTAIN_MESSAGE.toLowerCase() || t.startsWith('not found in this version')
}

export async function ask(input: AskInput, deps: AskDeps): Promise<AnswerResult> {
  const started = deps.now()
  const versionId = input.versionId
  const sessionId = input.sessionId
  const question = (input.question ?? '').trim()

  // Every /ask call is a turn: start-or-advance the session before anything else.
  const turn = await deps.nextTurn(sessionId, versionId, question)

  const abstain = async (
    retrieved: QueryLogRow['retrieved'],
    verify: QueryLogRow['verify'] = null,
  ): Promise<AnswerResult> => {
    const result: AnswerResult = {
      answer: ABSTAIN_MESSAGE,
      citations: [],
      abstained: true,
      kind: 'abstained',
      versionId,
      retrieved,
      sessionId,
      turn,
    }
    await safeLog(deps, {
      session_id: sessionId,
      turn,
      version_id: versionId,
      question,
      answer: ABSTAIN_MESSAGE,
      abstained: true,
      kind: 'abstained',
      citations: [],
      retrieved,
      verify,
      latency_ms: deps.now() - started,
    })
    return result
  }

  if (!question) return abstain([])

  // ── v1.2: conversation context ────────────────────────────────────────────
  // Recent turns verbatim + a rolling summary of older ones. verify never sees either.
  const hist = await deps.getHistory(sessionId)
  const { recent, toFold } = splitHistory(hist.priorTurns)
  let summary = hist.summary
  let summaryThrough = hist.summaryThroughTurn
  if (toFold.length > 0) {
    const rolled = await chatJson(
      deps.chat,
      SUMMARY_SYSTEM,
      summaryUserPrompt(summary, toFold),
      parseSummary,
    )
    if (rolled) {
      summary = rolled.summary.slice(0, SUMMARY_MAX_CHARS)
      summaryThrough = toFold[toFold.length - 1].turn
      try {
        await deps.saveSummary(sessionId, summary, summaryThrough)
      } catch (e) {
        console.error('saveSummary failed:', e instanceof Error ? e.message : e)
      }
    }
    // summariser failed -> keep the old summary; the older turns just aren't in context.
  }
  const conv = { summary, recent: recent.map((t) => ({ question: t.question, answer: t.answer })) }
  const hasHistory = conv.summary.length > 0 || conv.recent.length > 0

  // ── condense the follow-up into a standalone retrieval query, or flag it META ──
  let retrievalQuery = question
  let isMeta = false
  if (hasHistory) {
    const c = await chatJson(
      deps.chat,
      CONDENSE_SYSTEM,
      condenseUserPrompt(conv, question),
      parseCondense,
    )
    if (c) {
      if (c.standalone === '__META__') isMeta = true
      else retrievalQuery = c.standalone
    }
  }

  // ── META path: answer from the transcript, no retrieval, no verify, no citation ──
  if (isMeta) {
    const m = await chatJson(deps.chat, META_SYSTEM, metaUserPrompt(conv, question), parseMeta)
    const answer = m?.answer ?? META_FALLBACK
    const result: AnswerResult = answerResultSchema.parse({
      answer,
      citations: [],
      abstained: false,
      kind: 'meta',
      versionId,
      retrieved: [],
      sessionId,
      turn,
    })
    await safeLog(deps, {
      session_id: sessionId,
      turn,
      version_id: versionId,
      question,
      answer,
      abstained: false,
      kind: 'meta',
      citations: [],
      retrieved: [],
      verify: null,
      latency_ms: deps.now() - started,
    })
    return result
  }

  // 1. retrieve (RLS + version filter live in match_chunks) — uses the condensed query
  const qvec = await deps.embed(retrievalQuery)
  const hits = await deps.matchChunks(versionId, qvec, RETRIEVE_K)
  const retrieved = hits.map((h) => ({ chunkId: h.chunkId, page: h.page, score: h.score }))
  if (hits.length === 0) return abstain(retrieved)

  const validIds = new Set(hits.map((h) => h.chunkId))

  // 2. generate a cited draft. The conversational rules are appended ONLY when there is
  //    history — a single-turn call keeps the exact v1.1.2 prompt (no abstention drift).
  const answerSystem = hasHistory ? `${ANSWER_SYSTEM}\n\n${ANSWER_CONV_RULES}` : ANSWER_SYSTEM
  const draft = await chatJson(
    deps.chat,
    answerSystem,
    answerUserPrompt(question, hits, conv),
    parseDraft,
  )
  if (!draft || draft.abstained) return abstain(retrieved)

  const draftCitations = draft.citations.filter((c) => validIds.has(c.chunkId))
  if (draftCitations.length === 0) return abstain(retrieved) // no real support -> abstain

  // 3. verify: keep only supported claims. Send just the cited chunks (plus a couple more
  //    for context) — the whole retrieved set again would double the prompt for no gain.
  const citedIds = new Set(draftCitations.map((c) => c.chunkId))
  const verifyContext = [
    ...hits.filter((h) => citedIds.has(h.chunkId)),
    ...hits.filter((h) => !citedIds.has(h.chunkId)).slice(0, 2),
  ]
  const verifySystem = hasHistory ? `${VERIFY_SYSTEM}\n\n${VERIFY_CONV_RULE}` : VERIFY_SYSTEM
  const verify = await chatJson(
    deps.chat,
    verifySystem,
    verifyUserPrompt(draft.answer, verifyContext),
    parseVerify,
  )
  if (!verify) return abstain(retrieved) // couldn't verify -> don't ship

  let finalAnswer = draft.answer
  let finalCitations = draftCitations
  if (!verify.supported || verify.unsupportedClaims.length > 0) {
    finalAnswer = verify.revisedAnswer
    if (looksLikeAbstention(finalAnswer)) return abstain(retrieved, verify)
    // keep citations whose quote still appears in the revised answer
    const kept = draftCitations.filter((c) => finalAnswer.includes(c.quote))
    finalCitations = kept.length > 0 ? kept : draftCitations
  }

  if (finalCitations.length === 0) return abstain(retrieved, verify)

  // Validate the object that crosses the boundary back to the SPA.
  const result: AnswerResult = answerResultSchema.parse({
    answer: finalAnswer,
    citations: finalCitations,
    abstained: false,
    kind: 'grounded',
    versionId,
    retrieved,
    sessionId,
    turn,
  })
  await safeLog(deps, {
    session_id: sessionId,
    turn,
    version_id: versionId,
    question,
    answer: finalAnswer,
    abstained: false,
    kind: 'grounded',
    citations: finalCitations,
    retrieved,
    verify,
    latency_ms: deps.now() - started,
  })
  return result
}

// query_log is telemetry — a logging failure must not fail the answer.
async function safeLog(deps: AskDeps, row: QueryLogRow): Promise<void> {
  try {
    await deps.logQuery(row)
  } catch (e) {
    console.error('query_log insert failed:', e instanceof Error ? e.message : e)
  }
}

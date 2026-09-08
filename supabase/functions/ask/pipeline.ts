// The /ask pipeline, pure and dependency-injected so `deno test` needs no network or
// node_modules. index.ts wires the real embed / match_chunks / LLM / query_log.
//
//   embed(question) -> match_chunks(versionId, vec, k) -> generate (cited draft)
//   -> verify (drop unsupported claims -> revisedAnswer) -> AnswerResult -> log
//
// Invariant: the returned AnswerResult has >=1 citation OR abstained === true. Never both,
// never neither. match_chunks is RLS-enforced + version-filtered, so any valid chunkId is
// necessarily a chunk in `versionId`.
import { ABSTAIN_MESSAGE, type AnswerResult, type Citation } from '../_shared/schema.ts'
import {
  ANSWER_SYSTEM,
  VERIFY_SYSTEM,
  answerUserPrompt,
  type RetrievedChunk,
  verifyUserPrompt,
} from '../_shared/prompt.ts'
import { chatJson, type ChatFn } from '../_shared/llm.ts'

const RETRIEVE_K = 12

export type AskInput = { versionId: string; question: string }

export type AskDeps = {
  embed: (text: string) => Promise<number[]>
  matchChunks: (versionId: string, embedding: number[], k: number) => Promise<RetrievedChunk[]>
  chat: ChatFn
  logQuery: (row: QueryLogRow) => Promise<void>
  now: () => number
}

export type QueryLogRow = {
  version_id: string
  question: string
  answer: string
  abstained: boolean
  citations: Citation[]
  retrieved: { chunkId: string; page: number; score: number }[]
  verify: { supported: boolean; unsupportedClaims: string[]; revisedAnswer: string } | null
  latency_ms: number
}

type Draft = { answer: string; citations: Citation[]; abstained: boolean }

function parseDraft(o: unknown): Draft | null {
  if (typeof o !== 'object' || o === null) return null
  const d = o as Record<string, unknown>
  if (typeof d.answer !== 'string' || typeof d.abstained !== 'boolean') return null
  const citations: Citation[] = []
  if (Array.isArray(d.citations)) {
    for (const c of d.citations) {
      if (c && typeof c === 'object') {
        const cc = c as Record<string, unknown>
        if (typeof cc.chunkId === 'string' && typeof cc.quote === 'string') {
          citations.push({
            chunkId: cc.chunkId,
            page: Number.isFinite(cc.page) ? Number(cc.page) : 0,
            quote: cc.quote,
          })
        }
      }
    }
  }
  return { answer: d.answer, citations, abstained: d.abstained }
}

type Verify = { supported: boolean; unsupportedClaims: string[]; revisedAnswer: string }

function parseVerify(o: unknown): Verify | null {
  if (typeof o !== 'object' || o === null) return null
  const v = o as Record<string, unknown>
  if (typeof v.supported !== 'boolean') return null
  return {
    supported: v.supported,
    unsupportedClaims: Array.isArray(v.unsupportedClaims)
      ? v.unsupportedClaims.filter((x): x is string => typeof x === 'string')
      : [],
    revisedAnswer: typeof v.revisedAnswer === 'string' ? v.revisedAnswer : '',
  }
}

function looksLikeAbstention(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t === '' || t === ABSTAIN_MESSAGE.toLowerCase() || t.startsWith('not found in this version')
}

export async function ask(input: AskInput, deps: AskDeps): Promise<AnswerResult> {
  const started = deps.now()
  const versionId = input.versionId
  const question = (input.question ?? '').trim()

  const abstain = async (
    retrieved: QueryLogRow['retrieved'],
    verify: QueryLogRow['verify'] = null,
  ): Promise<AnswerResult> => {
    const result: AnswerResult = {
      answer: ABSTAIN_MESSAGE,
      citations: [],
      abstained: true,
      versionId,
      retrieved,
    }
    await safeLog(deps, {
      version_id: versionId,
      question,
      answer: ABSTAIN_MESSAGE,
      abstained: true,
      citations: [],
      retrieved,
      verify,
      latency_ms: deps.now() - started,
    })
    return result
  }

  if (!question) return abstain([])

  // 1. retrieve (RLS + version filter live in match_chunks)
  const qvec = await deps.embed(question)
  const hits = await deps.matchChunks(versionId, qvec, RETRIEVE_K)
  const retrieved = hits.map((h) => ({ chunkId: h.chunkId, page: h.page, score: h.score }))
  if (hits.length === 0) return abstain(retrieved)

  const validIds = new Set(hits.map((h) => h.chunkId))

  // 2. generate a cited draft
  const draft = await chatJson(
    deps.chat,
    ANSWER_SYSTEM,
    answerUserPrompt(question, hits),
    parseDraft,
  )
  if (!draft || draft.abstained) return abstain(retrieved)

  const draftCitations = draft.citations.filter((c) => validIds.has(c.chunkId))
  if (draftCitations.length === 0) return abstain(retrieved) // no real support -> abstain

  // 3. verify: keep only supported claims
  const verify = await chatJson(
    deps.chat,
    VERIFY_SYSTEM,
    verifyUserPrompt(draft.answer, hits),
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

  const result: AnswerResult = {
    answer: finalAnswer,
    citations: finalCitations,
    abstained: false,
    versionId,
    retrieved,
  }
  await safeLog(deps, {
    version_id: versionId,
    question,
    answer: finalAnswer,
    abstained: false,
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

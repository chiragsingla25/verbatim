// Answer + verify prompt templates. Both demand a single JSON object; the citation
// contract is: every factual claim is backed by a chunkId that appears in the CONTEXT.
import { ABSTAIN_MESSAGE } from './schema.ts'

export type RetrievedChunk = {
  chunkId: string
  page: number
  section: string | null
  content: string
  tableRef: string | null
  score: number
}

export const ANSWER_SYSTEM = [
  'You answer questions about ONE version of a psychological test manual, using ONLY the',
  'CONTEXT chunks provided. The CONTEXT is the whole of what this version says on the topic.',
  '',
  'Rules:',
  '- Answer ONLY the specific question asked. If the CONTEXT discusses the general topic but',
  '  does not contain the specific fact requested, abstain — do NOT answer a nearby or related',
  '  question instead.',
  '- Every factual claim in your answer must be supported by a specific CONTEXT chunk.',
  '- Quote must be a short verbatim span copied from that chunk.',
  '- If the CONTEXT does not answer the question, abstain. Do NOT use outside knowledge,',
  '  and do NOT answer from a different instrument or edition.',
  '',
  'Reply with ONE JSON object, nothing else:',
  '{"answer": string, "citations": [{"chunkId": string, "page": integer, "quote": string}],',
  ' "abstained": boolean}',
  `- To abstain: {"answer": "${ABSTAIN_MESSAGE}", "citations": [], "abstained": true}`,
].join('\n')

export const VERIFY_SYSTEM = [
  'You are checking a draft ANSWER against the CONTEXT chunks it was written from. A claim is',
  'SUPPORTED only if a chunk states it; anything not in the CONTEXT is UNSUPPORTED, even if it',
  'is true in general.',
  '',
  'Reply with ONE JSON object, nothing else:',
  '{"supported": boolean, "unsupportedClaims": [string], "revisedAnswer": string}',
  '- supported: true only if EVERY claim in the ANSWER is backed by the CONTEXT.',
  '- unsupportedClaims: the specific claims that are not backed (empty if supported).',
  '- revisedAnswer: the ANSWER re-written to keep ONLY the supported claims, verbatim where',
  `  possible. If nothing supported remains, revisedAnswer must be exactly "${ABSTAIN_MESSAGE}".`,
].join('\n')

// v1.2: appended to ANSWER_SYSTEM / VERIFY_SYSTEM ONLY when the turn has conversation
// context — a single-turn call keeps the exact v1.1.2 prompts (no abstention drift).
export const ANSWER_CONV_RULES = [
  'You are also given CONVERSATION (a running summary + recent turns) to understand what the',
  'question refers to — pronouns, "that", follow-ups. CONVERSATION is context ONLY: never cite',
  'it, and never treat anything said earlier as a fact about the manual. If a claim is only in',
  'the CONVERSATION and not in the CONTEXT, leave it out.',
].join('\n')

export const VERIFY_CONV_RULE =
  'A claim whose only backing is "the user was told this earlier" or a conversation summary is ' +
  'UNSUPPORTED — check ONLY against the CONTEXT chunks below.'

// ── conversational (v1.2) ────────────────────────────────────────────────────

export const CONDENSE_SYSTEM = [
  'You rewrite a user\'s latest question into a self-contained search query for a psychological',
  'test manual, using the CONVERSATION to resolve pronouns and ellipsis. Do NOT answer.',
  'Reply with ONE JSON object: {"standalone": string}.',
  '- If the latest question is already self-contained, return it unchanged.',
  '- If it is about the conversation itself (e.g. "what did I ask", "summarise what we covered",',
  '  "repeat that") and not about the manual, return {"standalone": "__META__"}.',
].join('\n')

export const SUMMARY_SYSTEM = [
  'You maintain a running summary of a Q&A conversation about ONE psychological test manual.',
  'Given the CURRENT SUMMARY and the NEW EXCHANGES, return an updated summary.',
  'Reply with ONE JSON object: {"summary": string}.',
  '- Record what was asked and the gist of each answer, in order.',
  '- Do NOT restate specific scores, cutoffs, percentages, sample sizes or statistics as fact.',
  '  Refer to them without the numbers — e.g. "discussed the PHQ-9 severity bands", not the',
  '  band values.',
  '- Keep it tight — a few sentences.',
].join('\n')

export const META_SYSTEM = [
  'You answer a question about THIS conversation only — what the user asked, which topics came',
  'up, in what order. You are NOT answering from the manual.',
  'Reply with ONE JSON object: {"answer": string}.',
  '- Never state a fact about a test instrument. If asked one, say it is in the answers above.',
  '- Be brief and direct.',
].join('\n')

type ConvContext = { summary: string; recent: { question: string; answer: string }[] }

function formatConversation(conv: ConvContext): string {
  const parts: string[] = []
  if (conv.summary) parts.push(`Earlier (summary): ${conv.summary}`)
  for (const t of conv.recent) parts.push(`Q: ${t.question}\nA: ${t.answer}`)
  return parts.join('\n\n')
}

// The whole retrieved chunk goes to the model — a per-chunk char cap was tried for
// latency and reverted: it clipped load-bearing facts out of prose chunks (AUDIT has
// ~15 prose chunks > 2000 chars) and regressed the eval suite. Prompt size is kept in
// check by k and by the lean verify context (cited chunks + 2), not by clipping.
export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => {
      const head = `[chunkId=${c.chunkId}] (page ${c.page}${c.section ? `, ${c.section}` : ''})`
      return `${head}\n${c.content}`
    })
    .join('\n\n')
}

export function answerUserPrompt(
  question: string,
  chunks: RetrievedChunk[],
  conv?: ConvContext,
): string {
  const convBlock =
    conv && (conv.summary || conv.recent.length > 0)
      ? `CONVERSATION (context only — not a source of facts):\n${formatConversation(conv)}\n\n`
      : ''
  return `${convBlock}QUESTION:\n${question}\n\nCONTEXT:\n${formatContext(chunks)}`
}

// verify never sees the conversation — claims are checked against the chunks only.
export function verifyUserPrompt(answer: string, chunks: RetrievedChunk[]): string {
  return `ANSWER:\n${answer}\n\nCONTEXT:\n${formatContext(chunks)}`
}

export function condenseUserPrompt(conv: ConvContext, question: string): string {
  return `CONVERSATION:\n${formatConversation(conv)}\n\nLATEST QUESTION:\n${question}`
}

export function summaryUserPrompt(
  current: string,
  newExchanges: { question: string; answer: string }[],
): string {
  const ex = newExchanges.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n')
  return `CURRENT SUMMARY:\n${current || '(none)'}\n\nNEW EXCHANGES:\n${ex}`
}

export function metaUserPrompt(conv: ConvContext, question: string): string {
  return `CONVERSATION:\n${formatConversation(conv)}\n\nQUESTION ABOUT THE CONVERSATION:\n${question}`
}

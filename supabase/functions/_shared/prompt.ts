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

export function answerUserPrompt(question: string, chunks: RetrievedChunk[]): string {
  return `QUESTION:\n${question}\n\nCONTEXT:\n${formatContext(chunks)}`
}

export function verifyUserPrompt(answer: string, chunks: RetrievedChunk[]): string {
  return `ANSWER:\n${answer}\n\nCONTEXT:\n${formatContext(chunks)}`
}

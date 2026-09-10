// MIRROR of supabase/functions/_shared/schema.ts — keep the part from `citationSchema`
// onward byte-identical. The Edge Function copy is the source of truth; the import line
// legitimately differs (npm: there, bare here).
import { z } from 'zod'

export const citationSchema = z.object({
  chunkId: z.string(),
  page: z.number().int(),
  quote: z.string(),
})

export const answerResultSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
  abstained: z.boolean(),
  versionId: z.string(),
  retrieved: z.array(
    z.object({
      chunkId: z.string(),
      page: z.number().int(),
      score: z.number(),
    }),
  ),
  // v1.2: which conversation + turn this answer belongs to.
  sessionId: z.string(),
  turn: z.number().int(),
  // grounded = >=1 citation to this version; abstained = "not found"; meta = about the
  // conversation itself (no citation, no manual claim).
  kind: z.enum(['grounded', 'abstained', 'meta']),
})

export const verifyResultSchema = z.object({
  supported: z.boolean(),
  unsupportedClaims: z.array(z.string()).default([]),
  // The answer re-emitted with unsupported claims removed. Exactly the abstention
  // message when nothing supported remains.
  revisedAnswer: z.string().default(''),
})

// The answer step's raw output (a subset of AnswerResult — no versionId/retrieved yet).
export const answerDraftSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema).default([]),
  abstained: z.boolean(),
})

export type Citation = z.infer<typeof citationSchema>
export type AnswerResult = z.infer<typeof answerResultSchema>
export type AnswerKind = AnswerResult['kind']
export type VerifyResult = z.infer<typeof verifyResultSchema>
export type AnswerDraft = z.infer<typeof answerDraftSchema>

// App-role vocabulary (mirrors the `role` CHECK on public.profiles).
export const APP_ROLES = ['student', 'contributor', 'admin'] as const
export type AppRole = (typeof APP_ROLES)[number]

// The "not found in this version" answer. Every abstention uses exactly this string.
export const ABSTAIN_MESSAGE = 'Not found in this version.'

// Reserved chunkId for the deterministic document-facts block (accuracy-mvp C1):
// catalog metadata about the version (pages, edition, year, publisher, instrument),
// not a page of the manual. A citation to it renders as "Document metadata" — no
// page link, no source slide-over.
export const FACTS_CHUNK_ID = '__facts__'

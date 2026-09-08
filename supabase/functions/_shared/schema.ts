// SOURCE OF TRUTH for the answer/verify contract that crosses the SPA <-> Edge Function
// boundary. src/lib/schema.ts is a byte-for-byte mirror — keep them identical.
//
// Anything crossing a boundary is one of these zod-validated objects, never a loose dict.
// The /ask pipeline (Phase 2) fills these in; the SPA (Phase 1+) only needs the types yet.
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
})

export const verifyResultSchema = z.object({
  supported: z.boolean(),
  unsupportedClaims: z.array(z.string()),
})

export type Citation = z.infer<typeof citationSchema>
export type AnswerResult = z.infer<typeof answerResultSchema>
export type VerifyResult = z.infer<typeof verifyResultSchema>

// App-role vocabulary (mirrors the `role` CHECK on public.profiles).
export const APP_ROLES = ['student', 'contributor', 'admin'] as const
export type AppRole = (typeof APP_ROLES)[number]

// MIRROR of supabase/functions/_shared/schema.ts — keep them identical.
// The Edge Function copy is the source of truth; this one is what the SPA imports.
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

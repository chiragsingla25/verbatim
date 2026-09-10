import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as mirror from './schema'

// The src rule: supabase/functions/_shared/schema.ts is the source of truth and
// src/lib/schema.ts is a mirror. The comment header and the `import { z }` line
// legitimately differ (npm: specifier vs bare); everything from `citationSchema`
// onward must be byte-identical. This guards against the two drifting apart.
function body(path: string) {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  return text.slice(text.indexOf('export const citationSchema'))
}

describe('schema mirror', () => {
  it('src/lib/schema.ts body matches _shared/schema.ts', () => {
    expect(body('./schema.ts')).toEqual(body('../../supabase/functions/_shared/schema.ts'))
  })

  it('parses a well-formed AnswerResult', () => {
    const ok = mirror.answerResultSchema.safeParse({
      answer: 'x',
      citations: [{ chunkId: 'c1', page: 2, quote: 'q' }],
      abstained: false,
      versionId: 'v1',
      retrieved: [{ chunkId: 'c1', page: 2, score: 0.9 }],
      sessionId: 's1',
      turn: 1,
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an AnswerResult missing citations', () => {
    const bad = mirror.answerResultSchema.safeParse({
      answer: 'x',
      abstained: true,
      versionId: 'v1',
      retrieved: [],
    })
    expect(bad.success).toBe(false)
  })
})

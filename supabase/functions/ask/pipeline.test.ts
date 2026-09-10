// deno test supabase/functions/ask/pipeline.test.ts
import { assertEquals } from '@std/assert'
import { ABSTAIN_MESSAGE } from '../_shared/schema.ts'
import { ANSWER_SYSTEM } from '../_shared/prompt.ts'
import { ask, type AskDeps, type QueryLogRow } from './pipeline.ts'

const VID = '4325b634-805c-4097-b757-22aed89f13bf'
const SID = '11111111-2222-4333-8444-555555555555'

function chunk(id: string, page = 1, content = 'the PSS is scored by summing items') {
  return { chunkId: id, page, section: null, content, tableRef: null, score: 0.9 }
}

type Overrides = Partial<AskDeps> & {
  hits?: ReturnType<typeof chunk>[]
  answerJson?: string
  verifyJson?: string
}

function makeDeps(o: Overrides = {}) {
  const logged: QueryLogRow[] = []
  const deps: AskDeps = {
    embed: () => Promise.resolve(new Array(384).fill(0)),
    matchChunks: () => Promise.resolve(o.hits ?? [chunk('c1'), chunk('c2', 2)]),
    chat: (system: string) =>
      Promise.resolve(
        system.startsWith(ANSWER_SYSTEM)
          ? (o.answerJson ??
            '{"answer":"The PSS is scored by summing items.","citations":[{"chunkId":"c1","page":1,"quote":"scored by summing items"}],"abstained":false}')
          : (o.verifyJson ??
            '{"supported":true,"unsupportedClaims":[],"revisedAnswer":"The PSS is scored by summing items."}'),
      ),
    logQuery: (row) => {
      logged.push(row)
      return Promise.resolve()
    },
    nextTurn: () => Promise.resolve(1),
    getHistory: () => Promise.resolve({ summary: '', summaryThroughTurn: 0, priorTurns: [] }),
    saveSummary: () => Promise.resolve(),
    now: () => 1000,
    ...o,
  }
  return { deps, logged }
}

Deno.test('empty question -> abstain, still logs', async () => {
  const { deps, logged } = makeDeps()
  const r = await ask({ versionId: VID, sessionId: SID, question: '   ' }, deps)
  assertEquals(r.abstained, true)
  assertEquals(r.answer, ABSTAIN_MESSAGE)
  assertEquals(r.citations, [])
  assertEquals(logged.length, 1)
  assertEquals(logged[0].abstained, true)
})

Deno.test('no retrieved chunks -> abstain', async () => {
  const { deps, logged } = makeDeps({ hits: [] })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'how is it scored?' }, deps)
  assertEquals(r.abstained, true)
  assertEquals(logged[0].retrieved, [])
})

Deno.test('happy path -> cited answer, abstained false, logged', async () => {
  const { deps, logged } = makeDeps()
  const r = await ask({ versionId: VID, sessionId: SID, question: 'how is the PSS scored?' }, deps)
  assertEquals(r.abstained, false)
  assertEquals(r.citations.length, 1)
  assertEquals(r.citations[0].chunkId, 'c1')
  assertEquals(r.versionId, VID)
  assertEquals(r.retrieved.length, 2)
  assertEquals(logged[0].abstained, false)
  assertEquals(logged[0].verify?.supported, true)
})

Deno.test('model abstains in the draft -> abstain', async () => {
  const { deps } = makeDeps({
    answerJson: `{"answer":"${ABSTAIN_MESSAGE}","citations":[],"abstained":true}`,
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'unrelated?' }, deps)
  assertEquals(r.abstained, true)
})

Deno.test('draft cites only unknown chunkIds -> abstain (no real support)', async () => {
  const { deps } = makeDeps({
    answerJson:
      '{"answer":"x","citations":[{"chunkId":"ghost","page":1,"quote":"y"}],"abstained":false}',
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'q' }, deps)
  assertEquals(r.abstained, true)
})

Deno.test('verify unparseable -> abstain (do not ship unverified)', async () => {
  const { deps } = makeDeps({ verifyJson: 'the model rambled with no json' })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'q' }, deps)
  assertEquals(r.abstained, true)
})

Deno.test('partial support -> revisedAnswer kept, citations filtered to surviving quotes', async () => {
  const { deps, logged } = makeDeps({
    answerJson:
      '{"answer":"A is 5. B is 9.","citations":[{"chunkId":"c1","page":1,"quote":"A is 5"},{"chunkId":"c2","page":2,"quote":"B is 9"}],"abstained":false}',
    verifyJson:
      '{"supported":false,"unsupportedClaims":["B is 9"],"revisedAnswer":"A is 5."}',
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'q' }, deps)
  assertEquals(r.abstained, false)
  assertEquals(r.answer, 'A is 5.')
  assertEquals(r.citations.map((c) => c.chunkId), ['c1'])
  assertEquals(logged[0].verify?.unsupportedClaims, ['B is 9'])
})

Deno.test('revised answer collapses to abstention -> abstain', async () => {
  const { deps } = makeDeps({
    verifyJson: `{"supported":false,"unsupportedClaims":["everything"],"revisedAnswer":"${ABSTAIN_MESSAGE}"}`,
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'q' }, deps)
  assertEquals(r.abstained, true)
})

Deno.test('a query_log failure does not fail the answer', async () => {
  const { deps } = makeDeps({
    logQuery: () => Promise.reject(new Error('db down')),
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'how is the PSS scored?' }, deps)
  assertEquals(r.abstained, false)
  assertEquals(r.citations.length, 1)
})

Deno.test('one retry on non-JSON draft, then succeeds', async () => {
  let calls = 0
  const { deps } = makeDeps({
    chat: (system: string) => {
      if (system.startsWith(ANSWER_SYSTEM)) {
        calls++
        return Promise.resolve(
          calls === 1
            ? 'here is your answer (no json)'
            : '{"answer":"scored by summing","citations":[{"chunkId":"c1","page":1,"quote":"summing items"}],"abstained":false}',
        )
      }
      return Promise.resolve(
        '{"supported":true,"unsupportedClaims":[],"revisedAnswer":"scored by summing"}',
      )
    },
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'q' }, deps)
  assertEquals(calls, 2)
  assertEquals(r.abstained, false)
})

// ── v1.2 conversational paths ───────────────────────────────────────────────
import {
  CONDENSE_SYSTEM,
  META_SYSTEM,
  SUMMARY_SYSTEM,
  VERIFY_SYSTEM,
} from '../_shared/prompt.ts'

const priorTurn = (turn: number, q: string, a: string) => ({ turn, question: q, answer: a })

Deno.test('follow-up: condense rewrites the query; still grounded + verified', async () => {
  let seenRetrievalQ = ''
  const { deps } = makeDeps({
    getHistory: () =>
      Promise.resolve({
        summary: '',
        summaryThroughTurn: 0,
        priorTurns: [priorTurn(1, 'What are the PSS-10 severity bands?', 'Low, moderate, high.')],
      }),
    embed: (text: string) => {
      seenRetrievalQ = text
      return Promise.resolve(new Array(384).fill(0))
    },
    chat: (system: string) => {
      if (system === CONDENSE_SYSTEM)
        return Promise.resolve('{"standalone":"PSS-10 cutoff score for the high severity band"}')
      if (system.startsWith(ANSWER_SYSTEM))
        return Promise.resolve(
          '{"answer":"The high band starts at 27.","citations":[{"chunkId":"c1","page":1,"quote":"summing items"}],"abstained":false}',
        )
      return Promise.resolve(
        '{"supported":true,"unsupportedClaims":[],"revisedAnswer":"The high band starts at 27."}',
      )
    },
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'and the cutoff for that?' }, deps)
  assertEquals(seenRetrievalQ.includes('cutoff'), true) // used the condensed query, not the raw follow-up
  assertEquals(r.abstained, false)
  assertEquals(r.kind, 'grounded')
})

Deno.test('meta: condense returns __META__ -> answered from transcript, no retrieval/verify', async () => {
  let retrievalCalled = false
  let verifyCalled = false
  const { deps, logged } = makeDeps({
    getHistory: () =>
      Promise.resolve({
        summary: '',
        summaryThroughTurn: 0,
        priorTurns: [priorTurn(1, 'How is the PSS scored?', 'By summing items.')],
      }),
    matchChunks: () => {
      retrievalCalled = true
      return Promise.resolve([])
    },
    chat: (system: string) => {
      if (system === CONDENSE_SYSTEM) return Promise.resolve('{"standalone":"__META__"}')
      if (system === META_SYSTEM)
        return Promise.resolve('{"answer":"You asked how the PSS is scored."}')
      if (system.startsWith(VERIFY_SYSTEM)) {
        verifyCalled = true
        return Promise.resolve('{"supported":true,"unsupportedClaims":[],"revisedAnswer":""}')
      }
      return Promise.resolve('{}')
    },
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'what did I just ask?' }, deps)
  assertEquals(r.kind, 'meta')
  assertEquals(r.abstained, false)
  assertEquals(r.citations, [])
  assertEquals(retrievalCalled, false)
  assertEquals(verifyCalled, false)
  assertEquals(logged[0].kind, 'meta')
})

Deno.test('no-smuggle: verify strips a transcript-only claim -> abstain', async () => {
  const { deps } = makeDeps({
    getHistory: () =>
      Promise.resolve({
        summary: '',
        summaryThroughTurn: 0,
        priorTurns: [priorTurn(1, 'PHQ-9 moderate cutoff?', 'A score of 10.')],
      }),
    chat: (system: string) => {
      if (system === CONDENSE_SYSTEM)
        return Promise.resolve('{"standalone":"GAD-7 moderate cutoff score"}')
      if (system.startsWith(ANSWER_SYSTEM))
        // model tries to reuse the PHQ-9 fact from the transcript
        return Promise.resolve(
          '{"answer":"GAD-7 moderate is 10, same as the PHQ-9.","citations":[{"chunkId":"c1","page":1,"quote":"summing items"}],"abstained":false}',
        )
      // verify (chunks only) can't support it -> nothing left
      return Promise.resolve(
        `{"supported":false,"unsupportedClaims":["GAD-7 moderate is 10"],"revisedAnswer":"Not found in this version."}`,
      )
    },
  })
  const r = await ask({ versionId: VID, sessionId: SID, question: 'and for GAD-7?' }, deps)
  assertEquals(r.abstained, true)
  assertEquals(r.kind, 'abstained')
})

Deno.test('long history: older turns fold into the summary (saveSummary called)', async () => {
  let saved: { summary: string; through: number } | null = null
  const big = 'x'.repeat(3000)
  const { deps } = makeDeps({
    getHistory: () =>
      Promise.resolve({
        summary: '',
        summaryThroughTurn: 0,
        priorTurns: [
          priorTurn(1, 'q1 ' + big, 'a1 ' + big),
          priorTurn(2, 'q2 ' + big, 'a2 ' + big),
          priorTurn(3, 'q3', 'a3'),
        ],
      }),
    saveSummary: (_sid: string, summary: string, through: number) => {
      saved = { summary, through }
      return Promise.resolve()
    },
    chat: (system: string) => {
      if (system === SUMMARY_SYSTEM) return Promise.resolve('{"summary":"Discussed q1 and q2."}')
      if (system === CONDENSE_SYSTEM) return Promise.resolve('{"standalone":"q4 standalone"}')
      if (system.startsWith(ANSWER_SYSTEM))
        return Promise.resolve(
          '{"answer":"ok.","citations":[{"chunkId":"c1","page":1,"quote":"summing items"}],"abstained":false}',
        )
      return Promise.resolve('{"supported":true,"unsupportedClaims":[],"revisedAnswer":"ok."}')
    },
  })
  await ask({ versionId: VID, sessionId: SID, question: 'q4?' }, deps)
  assertEquals(saved !== null, true)
  assertEquals(saved!.through >= 1, true) // at least turn 1 folded
})

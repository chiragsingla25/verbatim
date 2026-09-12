// deno test supabase/functions/_shared/llm.test.ts
import { assertEquals, assertRejects } from '@std/assert'
import { createChatWithFallback, isDailyQuotaBody, LlmQuotaError } from './llm.ts'
import type { ModelOption } from './schema.ts'

// Captured live from OpenRouter this session (2026-09-12) — the actual daily-cap 429 body,
// not a guessed shape. A prior version of isDailyQuotaBody's pattern looked plausible but
// never matched this real text (hyphenated "per-day", no spaced "per day" anywhere), so
// every daily-cap 429 fell through to the generic retry branch and wasted ~25s of backoff
// per call before finally giving up. This pins the fix against the real provider response.
const REAL_OPENROUTER_DAILY_CAP_BODY =
  '{"error":{"message":"Rate limit exceeded: free-models-per-day-high-balance. ","code":429,' +
  '"metadata":{"headers":{"X-RateLimit-Limit":"1000","X-RateLimit-Remaining":"0",' +
  '"X-RateLimit-Reset":"1789257600000"},"limit_source":"openrouter_free_tier_daily",' +
  '"remedy_hint":"Wait for the daily reset","provider_name":null}},"user_id":"user_x"}'

Deno.test('isDailyQuotaBody: matches the real OpenRouter daily-cap response', () => {
  assertEquals(isDailyQuotaBody(REAL_OPENROUTER_DAILY_CAP_BODY), true)
})

Deno.test('isDailyQuotaBody: matches Groq-style TPD/RPD wording too', () => {
  assertEquals(isDailyQuotaBody('Rate limit reached for TPD (tokens per day).'), true)
  assertEquals(isDailyQuotaBody('You have exceeded your RPD quota.'), true)
})

Deno.test('isDailyQuotaBody: does not false-positive on a plain burst 429', () => {
  assertEquals(isDailyQuotaBody('Rate limit exceeded. Please retry after 2 seconds.'), false)
})

const MODELS: ModelOption[] = [
  { id: 'free', label: 'Free', llmModel: 'vendor/free-model', free: true },
  { id: 'qwen', label: 'Qwen 3.7 Flash', llmModel: 'vendor/qwen', free: false },
]

// A fake "callModel" that records every attempt and fails for a configured set of model
// strings, so the fallback/stickiness logic is exercised with zero network calls — same
// dependency-injection style as pipeline.test.ts's fake AskDeps.chat.
function fakeCallModel(opts: { failing?: Set<string>; err?: () => unknown } = {}) {
  const calls: string[] = []
  const failing = opts.failing ?? new Set<string>()
  const call = (model: string, _system: string, _user: string): Promise<string> => {
    calls.push(model)
    if (failing.has(model)) return Promise.reject(opts.err?.() ?? new Error(`${model} is down`))
    return Promise.resolve(`ok from ${model}`)
  }
  return { call, calls }
}

Deno.test('createChatWithFallback: primary succeeds -> no fallback, getModelUsed stays on it', async () => {
  const { call, calls } = fakeCallModel()
  const { chat, getModelUsed } = createChatWithFallback(MODELS, 'free', call)
  const out = await chat('sys', 'user')
  assertEquals(out, 'ok from vendor/free-model')
  assertEquals(calls, ['vendor/free-model']) // qwen never touched
  assertEquals(getModelUsed(), 'free')
})

Deno.test('createChatWithFallback: primary fails -> falls forward to the next model in the chain', async () => {
  const { call, calls } = fakeCallModel({ failing: new Set(['vendor/free-model']) })
  const { chat, getModelUsed } = createChatWithFallback(MODELS, 'free', call)
  const out = await chat('sys', 'user')
  assertEquals(out, 'ok from vendor/qwen')
  assertEquals(calls, ['vendor/free-model', 'vendor/qwen'])
  assertEquals(getModelUsed(), 'qwen')
})

Deno.test('createChatWithFallback: whole-turn stickiness — a later call skips the failed model entirely', async () => {
  const { call, calls } = fakeCallModel({ failing: new Set(['vendor/free-model']) })
  const instance = createChatWithFallback(MODELS, 'free', call)
  await instance.chat('condense-sys', 'q1') // falls back here
  calls.length = 0 // reset the log; only inspect the SECOND call from here
  const out = await instance.chat('answer-sys', 'q2')
  assertEquals(out, 'ok from vendor/qwen')
  assertEquals(calls, ['vendor/qwen']) // did NOT re-try the free model that already failed
  assertEquals(instance.getModelUsed(), 'qwen')
})

Deno.test('createChatWithFallback: whole chain exhausted -> the last model\'s error propagates', async () => {
  const { call } = fakeCallModel({
    failing: new Set(['vendor/free-model', 'vendor/qwen']),
    err: () => new LlmQuotaError('daily cap hit'),
  })
  const { chat } = createChatWithFallback(MODELS, 'free', call)
  await assertRejects(() => chat('sys', 'user'), LlmQuotaError, 'daily cap hit')
})

Deno.test('createChatWithFallback: explicit start id skips earlier models even on their success', async () => {
  const { call, calls } = fakeCallModel() // nothing fails
  const { chat, getModelUsed } = createChatWithFallback(MODELS, 'qwen', call)
  await chat('sys', 'user')
  assertEquals(calls, ['vendor/qwen']) // free was never attempted — a deliberate choice
  assertEquals(getModelUsed(), 'qwen')
})

Deno.test('createChatWithFallback: unknown/missing startId resolves to the first model, not a throw', () => {
  const { getModelUsed } = createChatWithFallback(MODELS, 'not-a-real-id')
  assertEquals(getModelUsed(), 'free')
})

Deno.test('createChatWithFallback: empty model list throws immediately (no silent no-op)', () => {
  let threw = false
  try {
    createChatWithFallback([], 'free')
  } catch {
    threw = true
  }
  assertEquals(threw, true)
})

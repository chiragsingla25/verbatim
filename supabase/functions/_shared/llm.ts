// OpenAI-compatible chat + strict JSON extraction. Nothing here returns unvalidated model
// text: request JSON -> JSON.parse -> extract the first {…} -> one retry with a
// "valid JSON only" nudge -> then the caller treats a null as an abstention.
//
// The endpoint is swappable via LLM_BASE_URL / LLM_API_KEY (Groq now; OpenRouter or local
// Ollama later) — those stay constant across every model in MODEL_REGISTRY (v1.5), since
// they're all the same account/endpoint; only the model string itself varies per call. Read
// env inside the call, never at import.
import type { ModelOption } from './schema.ts'

export type ChatFn = (system: string, user: string) => Promise<string>

// Thrown when the LLM endpoint is out of quota (Groq TPD/RPD or an unreasonably long
// retry-after). The /ask handler turns this into a 503, not a hung worker.
export class LlmQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmQuotaError'
  }
}

// A single request hangs instead of failing cleanly on some outages — bound it so a stuck
// primary triggers the v1.5 fallback instead of tying up the ~150s Edge Function wall clock.
const REQUEST_TIMEOUT_MS = 30_000

// A 429 body that means "terminal for hours, don't bother retrying" rather than "clears in
// seconds." Matched against OpenRouter's REAL daily-cap response (verified live): the
// message is "free-models-per-day-high-balance" (hyphenated, not "per day") and
// "limit_source":"openrouter_free_tier_daily" — a spaced-word-only pattern never matches
// either, and OpenRouter sends no retry-after header for this case at all, so that gap left
// every daily-cap 429 falling through to the generic retry branch, wasting up to ~25s of
// backoff per call before finally giving up. Groq (this app's other OpenAI-compatible
// option) does use "TPD"/"RPD"/spaced "per day" wording, so those stay in the pattern too.
// Exported so it's covered by a real regression test — this exact bug (a regex that looks
// right but doesn't match the real provider text) is exactly what a test catches and a
// glance at the code doesn't.
export function isDailyQuotaBody(body: string): boolean {
  return /per[\s-]day|tpd|rpd|daily|"remaining"\s*:\s*"?0/i.test(body)
}

export async function llmChat(model: string, system: string, user: string): Promise<string> {
  const base = Deno.env.get('LLM_BASE_URL')?.replace(/\/$/, '')
  const key = Deno.env.get('LLM_API_KEY')
  if (!base || !key) throw new Error('LLM_BASE_URL / LLM_API_KEY not set')
  if (!model) throw new Error('llmChat: model is required')

  // Short-lived retries only. A per-minute/burst 429 clears in seconds; a daily-quota 429
  // (Groq TPD, or retry-after longer than a request has any business waiting) is terminal —
  // fail fast with a clear message rather than sleeping the worker to death.
  const MAX_BACKOFF_S = 20
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 429) {
      const body = (await res.text()).slice(0, 500)
      const retryAfter = Number(res.headers.get('retry-after'))
      if (isDailyQuotaBody(body) || retryAfter > MAX_BACKOFF_S) {
        throw new LlmQuotaError(`LLM daily quota exhausted: ${body}`)
      }
      if (attempt < 2) {
        const wait = retryAfter > 0 ? retryAfter : Math.min(2 ** attempt * 5, MAX_BACKOFF_S)
        await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      throw new LlmQuotaError(`LLM rate-limited (retries exhausted): ${body}`)
    }
    if (!res.ok) {
      throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('LLM response has no message content')
    return content
  }
  throw new Error('LLM: unreachable')
}

// Extract the first balanced {…} object from arbitrary model text (handles reasoning
// preambles / code fences / trailing prose).
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('no JSON object in model output')
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('unbalanced JSON object in model output')
}

// Request JSON, parse+validate; on failure retry once with a stricter nudge; then null
// (the pipeline turns null into an abstention).
export async function chatJson<T>(
  chat: ChatFn,
  system: string,
  user: string,
  validate: (o: unknown) => T | null,
): Promise<T | null> {
  // A null return means "the model gave unparseable output" -> the pipeline abstains.
  // An LlmQuotaError is an outage, not an abstention — let it propagate to a 503.
  try {
    const parsed = validate(firstJsonObject(await chat(system, user)))
    if (parsed !== null) return parsed
  } catch (e) {
    if (e instanceof LlmQuotaError) throw e
    // otherwise fall through to the retry
  }
  try {
    const raw = await chat(system, `${user}\n\nReturn VALID JSON only. No prose, no code fences.`)
    return validate(firstJsonObject(raw))
  } catch (e) {
    if (e instanceof LlmQuotaError) throw e
    return null
  }
}

// v1.5 model fallback. Wraps a per-model call (llmChat by default — injectable so this is
// `deno test`-able with no network, same philosophy as pipeline.ts's AskDeps) with a fixed
// chain (MODEL_REGISTRY order): each call to the returned `chat` tries the active model
// first; on ANY thrown error (quota, rate limit, timeout, a genuine 5xx) it advances through
// the rest of the chain in order, until one succeeds or the chain is exhausted. Whichever
// model succeeds becomes the active model for the life of THIS instance — build one per
// /ask call (one per turn) so condense, answer, and verify all land on the same model once a
// fallback has occurred ("whole-turn stickiness": one model answers one turn, never a mix).
export function createChatWithFallback(
  models: ModelOption[],
  startId: string,
  callModel: (model: string, system: string, user: string) => Promise<string> = llmChat,
): { chat: ChatFn; getModelUsed: () => string } {
  if (models.length === 0) throw new Error('createChatWithFallback: empty model list')
  const startIdx = models.findIndex((m) => m.id === startId)
  let activeIdx = startIdx >= 0 ? startIdx : 0

  const chat: ChatFn = async (system, user) => {
    let lastErr: unknown
    for (let i = activeIdx; i < models.length; i++) {
      try {
        const out = await callModel(models[i].llmModel, system, user)
        activeIdx = i
        return out
      } catch (e) {
        lastErr = e
        // fall through to the next model in the chain
      }
    }
    throw lastErr
  }

  return { chat, getModelUsed: () => models[activeIdx].id }
}

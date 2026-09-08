// OpenAI-compatible chat + strict JSON extraction. Nothing here returns unvalidated model
// text: request JSON -> JSON.parse -> extract the first {…} -> one retry with a
// "valid JSON only" nudge -> then the caller treats a null as an abstention.
//
// The endpoint is swappable via LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (Groq now; OpenRouter
// or local Ollama later). Read env inside the call, never at import.

export type ChatFn = (system: string, user: string) => Promise<string>

export async function llmChat(system: string, user: string): Promise<string> {
  const base = Deno.env.get('LLM_BASE_URL')?.replace(/\/$/, '')
  const key = Deno.env.get('LLM_API_KEY')
  const model = Deno.env.get('LLM_MODEL')
  if (!base || !key || !model) throw new Error('LLM_BASE_URL / LLM_API_KEY / LLM_MODEL not set')

  for (let attempt = 0; attempt < 4; attempt++) {
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
    })
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) || Math.min(2 ** attempt * 5, 30)
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      continue
    }
    if (!res.ok) {
      throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('LLM response has no message content')
    return content
  }
  throw new Error('LLM: exhausted 429 retries')
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
  try {
    const parsed = validate(firstJsonObject(await chat(system, user)))
    if (parsed !== null) return parsed
  } catch {
    // fall through to the retry
  }
  try {
    const raw = await chat(system, `${user}\n\nReturn VALID JSON only. No prose, no code fences.`)
    return validate(firstJsonObject(raw))
  } catch {
    return null
  }
}

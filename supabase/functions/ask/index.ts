// POST { versionId, question } -> AnswerResult. Deploy WITH jwt verification (default):
//   supabase functions deploy ask
// Needs LLM_BASE_URL / LLM_API_KEY / LLM_MODEL via `supabase secrets`. SUPABASE_URL /
// SUPABASE_ANON_KEY are auto-injected. Embeddings use the built-in gte-small session.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, jsonResponse, UUID_RE } from '../_shared/http.ts'
import { LlmQuotaError, llmChat } from '../_shared/llm.ts'
import type { RetrievedChunk } from '../_shared/prompt.ts'
import { ask, type QueryLogRow } from './pipeline.ts'

// Supabase edge runtime global — 384-dim gte-small, the same weights as ingest.
declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } }
}

const json = (status: number, body: unknown) => jsonResponse(status, body, { cors: true })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { error: 'missing bearer token' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return json(500, { error: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' })

  // Per-request client carrying the caller's JWT: match_chunks + query_log run under the
  // caller's RLS. A bug here cannot reach another version's chunks.
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) return json(401, { error: 'invalid token' })
  const userId = userData.user.id

  let body: { versionId?: unknown; question?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  const versionId = body.versionId
  const question = body.question
  if (typeof versionId !== 'string' || !UUID_RE.test(versionId)) {
    return json(400, { error: 'versionId must be a uuid' })
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return json(400, { error: 'question is required' })
  }

  const model = new Supabase.ai.Session('gte-small')

  try {
    const result = await ask(
      { versionId, question },
      {
        embed: (text) => model.run(text, { mean_pool: true, normalize: true }),
        matchChunks: async (vid, embedding, k): Promise<RetrievedChunk[]> => {
          const { data, error } = await supabase.rpc('match_chunks', {
            p_version_id: vid,
            p_query_embedding: embedding,
            p_k: k,
          })
          if (error) throw new Error(`match_chunks: ${error.message}`)
          return (data ?? []).map((r: Record<string, unknown>) => ({
            chunkId: String(r.chunk_id),
            page: Number(r.page ?? 0),
            section: (r.section as string | null) ?? null,
            content: String(r.content ?? ''),
            tableRef: (r.table_ref as string | null) ?? null,
            score: Number(r.score ?? 0),
          }))
        },
        chat: llmChat,
        logQuery: async (row: QueryLogRow) => {
          const { error } = await supabase.from('query_log').insert({ ...row, user_id: userId })
          if (error) throw new Error(error.message)
        },
        now: () => Date.now(),
      },
    )
    return json(200, result)
  } catch (e) {
    if (e instanceof LlmQuotaError) {
      console.warn('LLM quota:', e.message)
      return json(503, { error: 'answer service is temporarily out of capacity, try again later' })
    }
    console.error('ask pipeline error:', e instanceof Error ? e.stack : e)
    return json(502, { error: 'answer pipeline failed', detail: e instanceof Error ? e.message : String(e) })
  }
})

// POST { versionId, question, modelId? } -> AnswerResult. Deploy WITH jwt verification
// (default): supabase functions deploy ask
// Needs LLM_BASE_URL / LLM_API_KEY via `supabase secrets` — LLM_MODEL is no longer read here
// (v1.5): the model comes from MODEL_REGISTRY + createChatWithFallback instead. SUPABASE_URL /
// SUPABASE_ANON_KEY are auto-injected. Embeddings use the built-in gte-small session.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, jsonResponse, UUID_RE } from '../_shared/http.ts'
import { createChatWithFallback, LlmQuotaError } from '../_shared/llm.ts'
import type { RetrievedChunk } from '../_shared/prompt.ts'
import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from '../_shared/schema.ts'
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

  let body: { versionId?: unknown; question?: unknown; sessionId?: unknown; modelId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  const versionId = body.versionId
  const question = body.question
  const sessionId = body.sessionId
  if (typeof versionId !== 'string' || !UUID_RE.test(versionId)) {
    return json(400, { error: 'versionId must be a uuid' })
  }
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    return json(400, { error: 'sessionId must be a uuid' })
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return json(400, { error: 'question is required' })
  }

  // v1.5: an unknown/missing modelId (a stale client, a typo, someone hand-crafting a
  // request) silently resolves to the default rather than erroring — the model chain is a
  // preference, not a required field.
  const requestedModelId =
    typeof body.modelId === 'string' && MODEL_REGISTRY.some((m) => m.id === body.modelId)
      ? body.modelId
      : DEFAULT_MODEL_ID
  const { chat, getModelUsed } = createChatWithFallback(MODEL_REGISTRY, requestedModelId)

  const model = new Supabase.ai.Session('gte-small')

  try {
    const result = await ask(
      { versionId, question, sessionId },
      {
        embed: (text) => model.run(text, { mean_pool: true, normalize: true }),
        nextTurn: async (sid, vid, title) => {
          const { data, error } = await supabase.rpc('chat_session_next_turn', {
            p_session_id: sid,
            p_version_id: vid,
            p_title: title,
          })
          if (error) throw new Error(`chat_session_next_turn: ${error.message}`)
          return Number(data)
        },
        getHistory: async (sid) => {
          const [{ data: sess }, { data: rows }] = await Promise.all([
            supabase
              .from('chat_sessions')
              .select('summary, summary_through_turn')
              .eq('id', sid)
              .maybeSingle(),
            supabase
              .from('query_log')
              .select('turn, question, answer')
              .eq('session_id', sid)
              .order('turn', { ascending: true }),
          ])
          const through = Number(sess?.summary_through_turn ?? 0)
          const priorTurns = ((rows ?? []) as { turn: number; question: string; answer: string }[])
            .filter((r) => r.turn > through)
            .map((r) => ({ turn: r.turn, question: r.question, answer: r.answer ?? '' }))
          return { summary: sess?.summary ?? '', summaryThroughTurn: through, priorTurns }
        },
        saveSummary: async (sid, summary, throughTurn) => {
          const { error } = await supabase
            .from('chat_sessions')
            .update({ summary, summary_through_turn: throughTurn })
            .eq('id', sid)
          if (error) throw new Error(error.message)
        },
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
        getFacts: async (vid) => {
          // security-invoker RPC: RLS decides visibility, same as match_chunks. A
          // version the caller can't see -> 0 rows -> null -> pipeline runs without facts.
          const { data, error } = await supabase
            .rpc('version_facts', { p_version_id: vid })
            .maybeSingle()
          if (error || !data) {
            if (error) console.warn('version_facts:', error.message)
            return null
          }
          const r = data as Record<string, unknown>
          return {
            instrumentName: String(r.instrument_name ?? ''),
            title: String(r.title ?? ''),
            edition: (r.edition as string | null) ?? null,
            year: r.year == null ? null : Number(r.year),
            publisher: (r.publisher as string | null) ?? null,
            pageCount: r.page_count == null ? null : Number(r.page_count),
            sectionCount: Number(r.section_count ?? 0),
            supersededByTitle: (r.superseded_by_title as string | null) ?? null,
          }
        },
        chat,
        getModelUsed,
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

# Conventions for `src/` (SPA) and `supabase/functions/` (Edge Functions)

- **`supabase/functions/_shared/schema.ts` is the single source of truth** for `AnswerResult`,
  `Citation`, `VerifyResult`. `src/lib/schema.ts` is a mirror — keep them identical. Anything
  crossing a boundary is a `zod`-validated object, not a loose dict.
- **`_shared/llm.ts` never returns unvalidated model output.** Request JSON → `JSON.parse` →
  extract the first `{…}` block → one retry with a "valid JSON only" nudge → then return an
  abstention. Validate against the schema. Do not depend on a provider's structured-output feature —
  the endpoint is swappable (OpenRouter / Groq / local Ollama).
- **Retrieval only ever goes through `match_chunks`** (the `security invoker` RPC) called with the
  end user's Supabase client / JWT. Never query `document_chunks` from an Edge Function with the
  service-role client to answer a user question — that bypasses RLS and the version boundary.
  A metadata question may also be grounded in the deterministic `__facts__` chunk from
  `version_facts()` (also `security invoker`) — never a retriever result, excluded from
  `query_log.retrieved`.
- **The vector store is Postgres.** `document_chunks.embedding` is `vector(384)` in the same
  database as everything else. No external vector DB. Similarity is pgvector `<=>` with the HNSW
  index; access control is the table's RLS policy.
- **One embedding model, both sides:** `gte-small` (384-dim) — Supabase's built-in model at query
  time, `thenlper/gte-small` via `sentence-transformers` in the ingestion Action. Changing it means
  re-embedding the whole corpus.
- **Three trust levels, kept apart:** the SPA holds only the anon key; Edge Functions hold the LLM
  key + service-role key via `supabase secrets`; the ingestion Action holds the service-role key
  via an Actions secret. The service-role key must never reach the SPA bundle.
- **No secrets or network calls at import time.** Read env inside handlers.
- Every answer is `grounded` (≥1 citation to a chunk in the requested `versionId`, or to the
  `__facts__` metadata chunk), `abstained: true`, or `meta` (a v1.2 question about the
  conversation itself — no citation, no manual claim, verify skipped). The conversation
  transcript / rolling summary is context for understanding the question ONLY; `verify` still
  checks every claim against this turn's retrieved chunks (+ `__facts__` when cited).
- New Supabase table → its RLS policy ships in the same migration. RLS-on + no-policy = unreadable;
  that's the safe default, not something to route around with the service client.
- **No reranker in v1.** Retrieve `k≈10–12` and pass straight to the answer step. If a reranker is
  added later it runs client-side or in its own service — never assume PyTorch in an Edge Function.

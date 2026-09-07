# Conventions for `src/`

- **`src/lib/answer/schema.ts` is the single source of truth** for `AnswerResult`, `Citation`, and
  `VerifyResult`. Anything crossing a module or API boundary is a typed object validated with zod,
  not a loose dict.
- **`generate.ts` and `verify.ts` never return unvalidated LLM output.** Request structured output,
  validate against the schema, on failure retry once, then fail. No falling back to the raw model
  string.
- **The retrieval path always goes through `match_chunks`** (the `security invoker` RPC) with the
  caller's Supabase client. Never query `document_chunks` directly from an API route with the
  service-role client to answer a user question — that bypasses RLS and the version boundary.
- **Three Supabase clients, kept separate:** `lib/supabase/server.ts` (RLS, user JWT, for API
  routes and server components), `client.ts` (browser), `service.ts` (service role — ingestion
  write-back and admin ops only). `service.ts` must never be imported by anything that can reach a
  client component.
- **Embeddings must match the Modal job.** `lib/embeddings.ts` and `src/ingest/embeddings.py` use
  the same model id and dimension (`EMBEDDING_MODEL`, `EMBEDDING_DIM`). Changing one means changing
  both and re-embedding the corpus.
- **No secrets at import time; no network calls at import time.** Read env inside functions.
- Every generated answer either carries ≥1 citation to a chunk in the requested `versionId` or sets
  `abstained: true`. There is no third state.
- New Supabase table → write its RLS policy in the same migration. A table with RLS on and no
  policy is unreadable; that's the intended safe default, not a bug to work around with the service
  client.

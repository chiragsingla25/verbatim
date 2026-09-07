# CLAUDE.md — Verbatim

Version-scoped Q&A over psychological test-manual PDFs. A user picks one manual **version** and
asks questions answered **only** from that version, with page citations — or an explicit
"not found in this version". Contributors upload and version manuals; anyone self-registers as a
student. Full scope in `docs/proposal.md`; build contract in `specs/2026-09-07-verbatim.md`.

**Accuracy is the goal, not perfection.** A wrong cutoff score or a blended-edition answer is a
failure; a slow answer or an over-cautious "not found" is acceptable in v1. Every answer is
grounded in retrieved chunks from one version, or it abstains. Better retrieval / agentic patterns
come later — v1 is the deterministic baseline.

## Priorities for v1

1. **It works end to end** on free, open-source infrastructure.
2. **Correctness over speed** — 5–15 s per answer (hosted open model) or 30–90 s (local Ollama on
   CPU) is fine.
3. **Purely open-source-capable** — every model and all app code is OSS; the LLM endpoint is one
   env var away from self-hosted Ollama.

## Architecture (do not redesign without updating the spec)

RAG, single retriever, deterministic pipeline — **not** an agent:

```
query → embed (gte-small, in the Edge Function) → pgvector top-k (k≈10–12, filtered to one
      version_id, RLS-enforced via match_chunks) → answer w/ structured citations, or abstain
      → verify (2nd LLM call: every claim ↔ a retrieved chunk from the right version)
      → log to query_log
```

- **No reranker in v1** (deferred). No planner/orchestrator, no ReAct loop, no LangChain. Deferred
  features live in the spec's out-of-scope section — check it before adding anything.
- **Version isolation is enforced by Postgres RLS**, not an application `WHERE` clause. The
  `match_chunks` RPC is `security invoker` so it runs under the caller's JWT. A bug in the Edge
  Function must not be able to leak another version's chunks. Dedicated eval: `cross-version-leak`.
- **Structured output without a vendor feature:** prompt asks for JSON → `JSON.parse` → extract the
  first `{…}` → one retry → else treat as abstention. Validate with `zod`. The answer step returns
  `{ answer, citations: [{chunkId, page, quote}], abstained }`; verify returns
  `{ supported, unsupportedClaims }`.

## Stack (all OSS models + code; hosting substrate is GitHub + Supabase free tier)

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Vite + React SPA on **GitHub Pages** (`<user>.github.io/verbatim/`) | set router/bundler base path to `/verbatim/`; list the github.io URL in Supabase Auth redirect URLs |
| Backend | **Supabase free tier** — Postgres + pgvector + Auth + Storage + Edge Functions (Deno) | software is Apache-2.0 / self-hostable; no lock-in |
| Server logic | Supabase **Edge Functions** — `/ask` (pipeline) and `/ingest-dispatch` (Storage webhook → GitHub API) | hold the LLM key; ~150 s wall clock is ample for the pipeline |
| PDF parsing | **Docling** in a **GitHub Actions** workflow | OSS (MIT); no page caps; triggered via `repository_dispatch` from `/ingest-dispatch` |
| Embeddings | **`gte-small`** (384-dim) — Supabase built-in model at query time; `thenlper/gte-small` via `sentence-transformers` in the Action at ingest | same weights both sides → vectors match; 384-dim keeps DB small |
| Answer + verify LLM | **any OpenAI-compatible endpoint** via `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`. Using the existing **Groq** key (`openai/gpt-oss-120b`). Swappable to OpenRouter, or local **Ollama** for a fully-OSS deploy | temperature 0. Groq free tier ≈ 15–25 questions/day (2 calls each) — add a card or a fallback provider when it outgrows that. |
| Logging | **`query_log`** table (chunk ids, answer, verify result, latency) | the raw material for later eval + agentic work |
| Observability | Langfuse Cloud free tier — **optional**, add later if the table isn't enough | SDK is MIT; not a v1 dependency |
| Evals | RAGAS + custom abstention & cross-version-leak checks, `evals/`, run in CI | |

## Build phases — each is a HARD approval gate

0. `notebooks/mvp.ipynb` — prove parse → chunk → `gte-small` embed → pgvector version-filtered
   retrieval → answer w/ citations → verify → correct abstention, on real public-domain manuals
1. Supabase schema + RLS, self-serve signup + `role` claim, GitHub Actions + Docling ingestion,
   contributor upload → parse → review → publish flow
2. `/ask` Edge Function pipeline (retrieve → answer → verify) + `query_log` + eval suite green in CI
3. SPA UI (reading-first: single column + slide-over source) + deploy to GitHub Pages

Do not start a phase before the previous one is approved. Run a short clarify pass (≤5 questions)
at the top of each phase.

## Commands

| Task | Command |
|---|---|
| Dev server (SPA) | `pnpm dev` |
| Edge functions (local) | `supabase functions serve` |
| Unit tests | `pnpm test` |
| Eval suite | `python evals/run_evals.py` |
| Ingestion (local test) | `python -m ingest.run path/to/manual.pdf` |
| Deploy SPA | push to `main` → GitHub Pages Action |
| Deploy edge functions | `supabase functions deploy` |

*(command shapes are intended, not yet wired — confirm exact scripts as they're built)*

## Environment / setup gotchas

- Node 20+, pnpm. Python 3.11+ for the ingestion job (GitHub Actions) and evals.
- Secrets — three locations, never a committed file:
  - **`.env.local`** (SPA): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE` — all public.
  - **`supabase secrets set`** (Edge Functions): `LLM_BASE_URL` (`https://api.groq.com/openai/v1`),
    `LLM_API_KEY` (`gsk_…`), `LLM_MODEL` (`openai/gpt-oss-120b`), `STORAGE_WEBHOOK_SECRET`
    (`openssl rand -hex 32`), `GITHUB_DISPATCH_TOKEN` (fine-grained PAT, Contents: write),
    `GITHUB_DISPATCH_REPO` (`<user>/verbatim`). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
    `SUPABASE_ANON_KEY` are auto-injected.
  - **GitHub Actions repo secrets**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for `ingest.yml`;
    `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` for `ci.yml` (Phase 2 evals).
- **Embedding model must be `gte-small` on both sides** — Supabase's built-in at query time and
  `thenlper/gte-small` at ingest. Changing it means re-embedding the whole corpus.
- Every answer either carries ≥1 citation to a chunk in the requested `versionId` or sets
  `abstained: true`. No third state.
- New Supabase table → write its RLS policy in the same migration. RLS-on + no-policy = unreadable;
  that's the safe default, not a bug to route around with the service client.
- **Supabase free tier pauses a project after 7 days idle.** A scheduled GitHub Action pings a
  health route every ~3 days to keep it warm.
- **DB size is the corpus ceiling** — ~5–6 MB per manual (chunk text + 384-dim vectors) → ~80–100
  manuals on the 500 MB free tier. Supabase Pro ($25/mo) lifts this to thousands.

## Available resources

- **Supabase account** (free tier) — DB, auth, storage, pgvector, Edge Functions.
- **GitHub account** — repo, GitHub Pages hosting, GitHub Actions (ingestion + CI).
- **LLM** — existing **Groq** API key (`openai/gpt-oss-120b`); swappable to OpenRouter or local Ollama.
- **Local machine** — macOS, no local GPU. No self-hosted GPU inference.
- **No custom domain** — served at `<user>.github.io/verbatim/`.
- **Budget** — $0 through the pilot. ~$25/mo (Supabase Pro) once it's a real program tool.
- No proprietary/org APIs — no MCP server needed.

## Corpus constraint

v1 corpus is **public-domain instruments only** (PHQ-9, GAD-7, PSS, IPIP scales, etc.). Every
upload records an "I have the right to store this" attestation with the uploader's identity. No
commercial/restricted manuals in v1 — that tier is out of scope.

## Out of scope for v1

Reranker · planner/orchestrator · edition-comparison · score/CI/RCI calculators · quizzes ·
workspaces · citation export · SSO/MFA · PDF sanitisation/malware scan · two-person review ·
restricted-manual tier · instrument catalogue · batch Q&A · client-score entry · self-hosted
Langfuse. See the spec's out-of-scope section before adding anything here.

# CLAUDE.md — Verbatim

Version-scoped Q&A over psychological test-manual PDFs. A user picks one manual **version** and
asks questions answered **only** from that version, with page citations — or an explicit
"not found in this version". Contributors upload and version manuals; anyone self-registers as a
student. Full scope in `docs/proposal.md`; build contract in `specs/2026-09-07-verbatim.md`.

**Accuracy is the product.** A wrong cutoff score or a blended-edition answer is a failure, not a
rough edge. Every answer is grounded in retrieved chunks from one version, or it abstains.

## Architecture (do not redesign without updating the spec)

RAG, single retriever, wrapped in a deterministic pipeline — **not** an agent:

```
query → embed → pgvector search (filtered to one version_id, RLS-enforced)
      → rerank (hosted cross-encoder) → answer w/ structured citations, or abstain
      → verify (2nd LLM call: every claim ↔ a retrieved chunk from the right version)
```

- No planner/orchestrator, no ReAct loop, no LangChain/LangGraph. Deferred features live in the
  spec's out-of-scope section — check it before adding anything.
- **Version isolation is enforced by Postgres RLS**, not an application `WHERE` clause. The
  retrieval query runs with the caller's JWT. A bug in TS must not be able to leak another
  version's chunks. This has a dedicated eval (`cross-version-leak`).
- Structured outputs only where a decision feeds logic: the answer step returns
  `{ answer, citations: [{chunk_id, page}], abstained }`; verify returns
  `{ supported, unsupported_claims }`. Never parse free text.

## Stack

| Layer | Tool |
|---|---|
| Frontend + API | Next.js (App Router) on Vercel |
| DB / auth / storage | Supabase — Postgres + pgvector + Auth + RLS + Storage |
| PDF parsing | Docling, inside the Modal ingestion job (Python) |
| Ingestion job | Modal — serverless, triggered by a Supabase Storage webhook |
| Embeddings | Gemini embedding API — same model on ingest (Python) and query (TS) |
| Reranker | Hosted cross-encoder (Cohere Rerank or Jina), free tier |
| Answer + verify LLM | Gemini / Groq (free-tier key), temperature 0, structured output |
| Evals | RAGAS + custom abstention & cross-version-leak checks, `evals/`, run in CI |
| Tracing | Langfuse — flagged for pre-launch, not built in v1 |

## Build phases — each is a HARD approval gate

0. `notebooks/mvp.ipynb` — prove parse → chunk → embed → version-filtered retrieval → rerank →
   cited answer → verify → correct abstention, on real public-domain manuals
1. Supabase schema + RLS, self-serve signup + `role` claim, Modal ingestion job, contributor
   upload → parse → review → publish flow
2. `src/lib/answer/*` — the retrieve → rerank → answer → verify pipeline + eval suite green in CI
3. UI (reading-first: single column + slide-over source) + deploy

Do not start a phase before the previous one is approved. Run a short clarify pass (≤5 questions)
at the top of each phase.

## Commands

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Unit tests | `pnpm test` |
| Eval suite | `python evals/run_evals.py` |
| Ingestion job (local) | `modal run src/ingest/app.py` |
| Deploy | push to `main` → Vercel; `modal deploy src/ingest/app.py` for the job |

*(command shapes are intended, not yet wired — confirm exact scripts as they're built)*

## Environment / setup gotchas

- Node 20+, pnpm. Python 3.11+ for the Modal job and evals.
- Secrets in `.env.local` (Next.js) / Modal secrets (job) / Supabase dashboard (prod). Never
  commit a real key. `.env.example` lists the names.
- **The embedding model must match** between the Modal job and the TS query path — same model id,
  same dimensions — or retrieval silently degrades.
- Every generated answer carries a citation to a chunk in the selected version, or sets
  `abstained: true`. No answer without provenance.
- RLS is on for every table. A new table without a policy = nobody can read it; that's the safe
  failure. Write the policy with the table.

## Available resources

- **Supabase account** (free tier) — DB, auth, storage, pgvector.
- **LLM API key** — Gemini or Groq free tier, for embeddings + answer + verify.
- **Domain / hosting** — a domain and a Vercel (or equivalent) account on hand.
- **Local machine** — macOS, no local GPU. All model inference is via hosted APIs or Modal.
- **Budget** — near-zero. Free tiers only; no paid GPU, no per-query billing beyond free LLM quota.
- No proprietary/org APIs — no MCP server needed.

## Corpus constraint

v1 corpus is **public-domain instruments only** (PHQ-9, GAD-7, PSS, IPIP scales, etc.). Every
upload records an "I have the right to store this" attestation with the uploader's identity. No
commercial/restricted manuals in v1 — that tier is out of scope.

## Out of scope for v1

Planner/orchestrator, edition-comparison, score/CI/RCI calculators, quizzes, workspaces, citation
export, SSO/MFA, PDF sanitisation/malware scan, two-person review, restricted-manual tier,
instrument catalogue, batch Q&A, client-score entry. See the spec's out-of-scope section before
adding anything here.

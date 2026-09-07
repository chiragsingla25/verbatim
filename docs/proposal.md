# Verbatim — architecture proposal

*Approved 2026-09-07 via the app-architect consultation; revised the same day to a purely
open-source, GitHub-Pages + Supabase shape. The executable contract is
`specs/2026-09-07-verbatim.md`.*

## Problem & who it's for

Psychology students and clinicians in one program repeatedly look up the same things in test
manuals — discontinue rules, norm tables, SEM, classification labels — across editions that
quietly disagree. A plain "chat with PDF" tool blends editions into one contradictory answer and
guesses when the manual is silent. A wrong cutoff score has real consequences (APA Ethics Code
9.11; *Standards for Educational and Psychological Testing*).

**Verbatim** turns a set of manual PDFs into a version-scoped Q&A tool: pick one manual version,
ask, get an answer quoted from *that version* with page citations — or "not found in this version".
Anyone self-registers as a student; approved contributors upload and version manuals.

## Intake outcome & guiding priorities

| Question | Answer |
|---|---|
| What is it for? | Real tool for a psych program (small). |
| Corpus | **Public-domain instruments only** — no licensing blocker, hosted or self-hosted LLM both fine. |
| Resources | Supabase free tier · GitHub account · a free open-weight LLM API key · **no custom domain** (serve at `<user>.github.io`). |
| Ask layout | Direction B — reading-first (single column + slide-over source). |
| Scale | ~tens of users, low-hundreds of questions/day, < ~80 manuals. |

**Priorities, in order:** (1) works end to end on free OSS infra; (2) correctness over latency —
5–15 s/answer is fine; (3) purely-open-source-capable — every model and all code is OSS, the LLM
endpoint is one env var from self-hosted Ollama. Top-tier accuracy is explicitly *not* a v1 goal —
that comes later with agentic retrieval patterns.

## Prior art & scope rationale

| Product | Copied | Cut as overkill |
|---|---|---|
| NotebookLM | Inline per-claim citations that open the source; "answers only from sources" stance | Audio overviews, collab |
| Humata / PDF.ai | Page-level citations; multi-document library | Team seats, export formats |
| Mintlify / GitBook / ReadMe "Ask AI" | Version switcher scopes both search and chat → the locked version selector | Full docs platform |
| Harvey / CoCounsel | Answer-to-source traceability; explicit abstention; "verify against source" framing | N-questions × M-docs table (deferred batch Q&A) |
| Pearson Q-global / PARiConnect | "Qualified user" framing — not needed for a public-domain corpus with no client data | Everything else |

**Novelty:** nothing does version-scoped Q&A over psychological test manuals → the
`cross-version-leak` eval is a required, blocking check.

**Out of scope for v1:** reranker · planner–orchestrator / adaptive routing · edition-comparison ·
score / CI / RCI calculators · quizzes / study tracking · workspaces & shared annotations · APA
citation generator & export · SSO / MFA · PDF sanitisation & malware scan · two-person review ·
restricted-manual tier & per-manual grants · instrument catalogue · batch Q&A · client-score entry
· self-hosted Langfuse · commercial/licensed manuals.

## Architecture pattern — RAG (single retriever), deterministic wrapper

Fixed DAG, no dynamic routing, no reranker in v1:

```
query → embed (gte-small) → pgvector top-k (k≈10–12, filtered to one version_id, RLS-enforced)
      → answer draft w/ structured citations, or abstain
      → verify (2nd LLM call: every claim ↔ a retrieved chunk from the right version)
      → log to query_log
```

The verify step is a second deterministic LLM call, not an agent loop. Reranking and a
planner–orchestrator are recorded as deferred — the agentic-improvement pass owns them.

**Version isolation** is the load-bearing property: every chunk carries `version_id`; retrieval
goes through `match_chunks` (`security invoker`) under the caller's JWT, so Postgres RLS makes
other versions unreachable even with an application bug. Its own eval.

## Delivery model — (b) single generalist + review gates

Accuracy-critical (RLS-correctness must be exact; real students trust the answers). Not parallel
subagents — auth, schema, and the pipeline interlock. One builder end to end, fresh-context review
(`/code-review` or the `reviewer` agent) at each phase boundary.

## Stack (OSS models + code; substrate is GitHub + Supabase free tier)

| Layer | Choice |
|---|---|
| Frontend | Vite + React SPA on **GitHub Pages** at `<user>.github.io/verbatim/` (base path `/verbatim/`) |
| Backend | **Supabase free tier** — Postgres + pgvector + Auth + Storage + Edge Functions. Apache-2.0 software, self-hostable, no lock-in. |
| Server logic | Supabase **Edge Functions**: `/ask` (the pipeline) and `/ingest-dispatch` (Storage webhook → GitHub `repository_dispatch`) |
| PDF parsing | **Docling** (MIT) in a **GitHub Actions** workflow — no page caps, best table fidelity |
| Embeddings | **`gte-small`** (384-dim): Supabase built-in model at query time; `thenlper/gte-small` via `sentence-transformers` in the Action at ingest |
| Answer + verify LLM | **any OpenAI-compatible endpoint** (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`). Default: a free open-weight API (OpenRouter free / Groq). Fully-OSS deploy: local **Ollama** (`qwen2.5:7b` / `llama3.1:8b`). Structured output via prompt + parse + retry + `zod`, not a vendor feature. |
| Logging | **`query_log`** table (retrieved chunk ids, answer, verify result, latency) |
| Observability | Langfuse Cloud free tier — optional, added later if `query_log` isn't enough |
| Evals | RAGAS + custom abstention & cross-version-leak checks, CI-gated |

## Verification strategy

- Structured outputs at every decision boundary (`AnswerResult`, `VerifyResult` via `zod`).
- Grounding + citation contract: no claim without a chunk id; verify drops unsupported claims or
  forces abstention.
- Golden dataset — `evals/golden_dataset.jsonl`: `question → expected page / answer / should_abstain`
  for 2–3 seed manuals.
- Eval suite in CI (`--fail-under`): RAGAS faithfulness / answer-relevancy / context-precision;
  abstention accuracy; **cross-version-leak** (ask a v-A session a v-B-only question → assert
  abstention) — hard gate.
- Adversarial review at each phase boundary.
- Human-in-the-loop: the contributor table-review gate before a version goes `active`.

## Cost / limits (free tier)

- **Cost:** $0/mo through the pilot. ~$25/mo (Supabase Pro) once it's a real program tool — for
  no 7-day pause, backups, and DB headroom.
- **Latency:** ~5–15 s/answer on a free open-model API; ~30–90 s on local Ollama (CPU). Ingestion
  is async, ~2–10 min per manual.
- **Capacity:** ~750 questions/day on a friendly free API (2 calls each); ~tens/day on the
  tightest free tiers. Corpus ceiling ~80–100 manuals (500 MB DB). 50k MAU. Supabase pauses after
  7 days idle → a cron Action keeps it warm.

## Phased build plan

Each phase is a hard approval gate — implement fully, report what was verified, stop for go-ahead.

**Phase 0 — MVP notebook** (`notebooks/mvp.ipynb`). Docling parse → chunk → `gte-small` embed →
pgvector version-filtered retrieval → answer w/ citations → verify → correct abstention on an
out-of-version question, on a real public-domain manual set.
*Checkpoint:* runs top to bottom; one good cited answer + one correct "not found".

**Phase 1 — Data model, auth, ingestion.** Supabase schema (`instruments`, `manual_versions`,
`document_chunks` w/ `version_id` + `embedding`, `ingest_jobs`, append-only `audit_log`); RLS;
self-serve signup + email verification + `role` claim; GitHub Actions + Docling ingestion triggered
by `/ingest-dispatch`; contributor upload → parse → review → publish flow.
*Checkpoint:* a contributor uploads a real public-domain PDF, reviews extracted tables, publishes;
a fresh student sees it; a direct read of a `pending` version is refused by RLS.

**Phase 2 — `/ask` pipeline + evals.** Edge Function pipeline (retrieve → answer → verify) with
the `zod` schemas; `query_log`; golden dataset for 2–3 manuals; RAGAS + abstention +
cross-version-leak suite green in CI.
*Checkpoint:* eval suite passes thresholds; cross-version-leak passes with zero leaks.

**Phase 3 — SPA UI + ship.** Signup / signin, manual library, upload + review, and the
reading-first Ask screen (single column, slide-over source on citation click); deploy the SPA to
GitHub Pages and the Edge Functions to Supabase; CI gate on `main`; keep-warm cron Action.
*Checkpoint:* a student and a contributor each complete their full path on the live github.io URL.

## Reference material

- Verbatim v1 PRD — https://claude.ai/code/artifact/b7e2a975-2846-4f2b-b07a-513aa93a24e4
- Verbatim UI design canvas — https://claude.ai/code/artifact/78070b67-9ad0-401f-a6c2-2eeb4a736f9d

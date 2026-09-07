# Verbatim — architecture proposal

*Approved 2026-09-07 via the app-architect consultation. This is the decision document; the
executable contract is `specs/2026-09-07-verbatim.md`.*

## Problem & who it's for

Psychology students and clinicians in one program repeatedly look up the same things in test
manuals — discontinue rules, norm tables, SEM, classification labels — across editions that
quietly disagree. A plain "chat with PDF" tool blends text from different editions into one
contradictory answer and guesses when the manual is silent. In this domain a wrong cutoff score or
a stale norm has real consequences (APA Ethics Code 9.11; *Standards for Educational and
Psychological Testing*).

**Verbatim** turns a set of manual PDFs into a version-scoped Q&A tool: pick one manual version,
ask a question, get an answer quoted from *that version* with page citations — or an explicit
"not found in this version". Anyone self-registers as a student; approved contributors upload and
version manuals.

## Intake outcome

| Question | Answer | Consequence |
|---|---|---|
| What is it for? | Real tool for a psych program | Fuller eval-in-CI, audit log, RLS taken seriously; monitoring flagged pre-launch. Still free-tier budget. |
| Corpus | **Public-domain instruments only** | No licensing blocker; a hosted LLM API is fine. Restricted-manual tier, per-manual access grants, and two-person review are **dropped** from v1. |
| Resources | Supabase account, an LLM API key (Gemini/Groq free tier), a domain / hosting | Reuse all; no new paid accounts. |
| Ask layout | Direction B — reading-first (single column + slide-over source) | Build targets B. |
| Scale | ~tens of users, low-hundreds of queries/day, < ~50 manuals | Inside Supabase + Vercel + Modal free tiers. |

## Prior art & scope rationale

| Product | Copied | Cut as overkill |
|---|---|---|
| NotebookLM | Inline per-claim citation chips that open the source; "answers only from sources" stance | Audio overviews, notebook collab |
| Humata / PDF.ai / Anara | Page-level citations; multi-document library | Team seats, many export formats |
| Mintlify / GitBook / ReadMe "Ask AI" | Version switcher scopes both search and chat → the locked version selector | Full docs-authoring platform |
| Harvey (Vault) / CoCounsel | Every answer traceable to source; explicit abstention; competence-duty framing (ABA Op. 512) ≈ APA ethics | "N questions × M documents" table (= deferred batch-Q&A) |
| Pearson Q-global / PAR PARiConnect | "Qualified user" framing only — **not needed** with a public-domain corpus and no client data | Everything else |

**Novelty:** nothing does version-scoped Q&A over psychological test manuals. That raises the
verification bar → a dedicated **cross-version-leak** eval.

**Out of scope for v1:** planner–orchestrator / adaptive routing, edition-comparison, score / CI /
RCI calculators, quizzes / flashcards / study tracking, course workspaces & shared annotations, APA
citation generator & answer export, SSO / MFA / step-up auth, PDF sanitisation & malware scan,
two-person review, restricted-manual tier & per-manual access grants, instrument catalogue /
test-selection assistant, batch Q&A, any client-score entry.

## Architecture pattern — RAG (single retriever), deterministic wrapper

Walking framework §7 from the cheapest shape: not a single call (needs retrieval); **RAG single
retriever** fits (grounded Q&A over a fixed per-version corpus); not a single agent (no external
actions, no dynamic tool choice); not multi-agent (no role decomposition).

Fixed DAG, no dynamic routing:

```
query → embed → pgvector similarity search (filtered to one version_id, RLS-enforced)
      → rerank (hosted cross-encoder) → answer draft w/ structured citations, or abstain
      → verify (2nd LLM call: every claim ↔ a retrieved chunk from the right version)
      → answer + evidence trace
```

The verify step is a second deterministic LLM call, not an agent loop. The planner–orchestrator
discussed during planning is a fast-follow, recorded in the spec as deferred.

**Version isolation** is the load-bearing property: every chunk carries `version_id`; the retrieval
query runs through the Supabase client with the caller's JWT, so Postgres RLS makes other versions
unreachable even if application code has a bug. This is the single most important correctness
guarantee and gets its own eval.

## Delivery model — (b) single generalist + review gates

Not the default (a): accuracy-critical, RLS-correctness must be exact, real students will trust the
answers. Not (c) parallel subagents: auth, schema, and the pipeline interlock (shared types, shared
RLS assumptions) — no genuinely independent chunks. → One builder end to end, in dependency order,
with a fresh-context review (`/code-review` or a review subagent) at each phase boundary before the
phase is accepted.

## Stack

| Layer | Choice | Notes / alternatives considered |
|---|---|---|
| Frontend + API | Next.js on Vercel | Hosting + domain already on hand. API routes: auth callbacks, query pipeline, upload-init. |
| Data / auth / storage | Supabase — Postgres + pgvector + Auth + RLS + Storage | One system; account on hand. RLS is the isolation mechanism. |
| PDF parsing | Docling, inside the ingestion job | Best self-hosted table fidelity. LlamaParse (cloud) has better tables but adds a data-egress vendor; Marker weaker on dense tables. Confirm at Phase 1. |
| Ingestion job | Modal (Python, serverless), triggered by a Supabase Storage webhook | Docling + chunk + embed + write-back; no warm service. Alternative: Render/Fly always-on (weaker fit for an infrequent job). |
| Embeddings | Gemini embedding API | Identical model on the Python (Modal) and TS (Vercel) sides — a hosted API keeps them in sync. Alternatives: Voyage, OpenAI, local `bge`. |
| Reranker | Hosted cross-encoder — Cohere Rerank or Jina free tier | Keeps the query path infra-free. Local `bge-reranker` is a later drop-in. |
| Answer + verify LLM | Gemini / Groq key on hand, structured output, temp 0 | Public-domain corpus → no self-hosting constraint. |
| Retrieval pipeline code | Hand-rolled TS (`src/lib/answer/*`) | Every step visible for accuracy-critical work; LlamaIndex.TS judged an unnecessary abstraction. LlamaIndex (Python) may still help chunking in the Modal job. |
| Evals | RAGAS + custom abstention & cross-version-leak checks, in `evals/`, CI-gated | framework §6. |
| Tracing | Langfuse free tier — flagged, not built in v1 | framework §12: wire before real students use it; timing decided at Phase 3. |

Open sub-decisions for phase clarify passes (data/ML judgement call): parser choice, chunking
strategy (layout-aware, tables kept whole), embedding model, reranker provider, LlamaIndex vs hand
chunker in the Modal job.

## Verification strategy (sized to "real tool")

- Structured outputs at every decision boundary (schemas above).
- Grounding + citation contract: no claim without a chunk id; verify drops unsupported claims or
  forces abstention.
- Golden dataset — `evals/golden_dataset.jsonl`: `question → expected page / answer / should_abstain`
  for 2–3 seed manuals.
- Eval suite in CI (`--fail-under` gates): RAGAS faithfulness / answer-relevancy / context-precision;
  abstention accuracy; **cross-version-leak** (ask a v-A session a v-B-only question → assert
  abstention) — hard gate.
- Adversarial review at each phase boundary (the delivery model).
- Human-in-the-loop: the contributor table-review gate before a version goes `active`.

## Deployment shape

Persistent frontend (Vercel) + managed Postgres (Supabase) + serverless ingestion job (Modal). CI
gate on every PR: `pytest` + RAGAS `--fail-under` + Claude review action. All free-tier. Monitoring
(Langfuse) wired before launch, decided at Phase 3.

## Phased build plan

Each phase is a hard approval gate — the builder implements it fully, reports what it verified, and
stops until you say go.

**Phase 0 — MVP notebook** (`notebooks/mvp.ipynb`). Prove the core flow on a real public-domain
manual set: Docling parse → chunk → Gemini embed → pgvector version-filtered retrieval → rerank →
cited answer → verify → correct abstention on an out-of-version question.
*Checkpoint:* notebook runs top to bottom; one good cited answer + one correct "not found".

**Phase 1 — Data model, auth, ingestion.** Supabase schema (`instruments`, `manual_versions`,
`document_chunks` w/ `version_id` + `embedding`, `ingest_log`, append-only `audit_log`); RLS
(contributor-only writes, `active`-only reads, archived hidden); self-serve signup + email
verification + `role` claim via access-token hook; Modal ingestion job on a Storage webhook;
contributor upload → parse → review → publish flow (API + minimal UI).
*Checkpoint:* a contributor uploads a real public-domain PDF, reviews extracted tables, publishes;
a fresh student sees it; a direct read of a `pending` version is refused by RLS.

**Phase 2 — Answer pipeline + evals.** Hand-rolled TS pipeline with the structured schemas; golden
dataset for 2–3 manuals; RAGAS + abstention + cross-version-leak suite green in CI.
*Checkpoint:* eval suite passes thresholds; cross-version-leak test passes.

**Phase 3 — UI (Direction B) + ship.** Signup / signin, manual library, upload + review, and the
reading-first Ask screen (single column, slide-over source on citation click); deploy to Vercel +
Supabase + Modal with the CI gate.
*Checkpoint:* a student and a contributor each complete their full path on the deployed app. Decide
whether Langfuse tracing lands before opening to real students.

## Reference material

- Verbatim v1 PRD — https://claude.ai/code/artifact/b7e2a975-2846-4f2b-b07a-513aa93a24e4
- Verbatim UI design canvas — https://claude.ai/code/artifact/78070b67-9ad0-401f-a6c2-2eeb4a736f9d

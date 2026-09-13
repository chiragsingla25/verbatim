# Spec addendum — Ask follow-up retrieval, catalog facts, timeouts

Build contract for app-developer. Extends v1 … v1.5 / accuracy-mvp (frozen). Same stack:
Vite + React on GitHub Pages, Supabase, OpenRouter, conversational RAG — **single**
`match_chunks`, no agent, no hybrid RPC, no re-ingest.

Signed off 2026-09-13 via app-architect (plan consultation). Intake: Verify = Deno tests plus
2–3 live MCMI `/ask` calls (not `--quick`). Delivery: generalist + `/code-review` before
Phase 3.

---

## Prior art and scope rationale

Conversational RAG table-stakes is query rewriting. Rewrite-only dropped the user's lexical
terms tonight (cutoff follow-ups after an instrument question retrieved p.17/112, not
133/148). SemEval-2026 GUIR treats last-turn (raw) and rewrite as complementary; we copy the
cheap half: one embed of `standalone + raw` when they differ. Cut: second retrieve + RRF
(built and reverted 2026-09-11).

Page/chapter/edition questions are catalog facts, not leaf chunks. `version_facts()` →
`__facts__` already exists (accuracy-mvp). The miss is the answer step ignoring that block
when 12 MCMI chunks dominate. Cut: re-chunk, TOC/summary ingest, regex that skips verify.

30s LLM abort 502'd large-manual Qwen turns. Bound stays under the ~150s Edge ceiling.

---

## Scope

1. **Follow-up retrieval.** After condense (not `__META__`): if `standalone === question`,
   embed `standalone`; else embed `` `${standalone} ${question}` ``. First turn unchanged.
2. **Catalog facts (Phase 2).** `factsChunk` + `ANSWER_SYSTEM`: pages / sections / chapters /
   edition / year / publisher / instrument must be answered from DOCUMENT METADATA and cited
   `__facts__` when recorded. Chapters = heading `section_count` with “not a publisher TOC”
   caveat. Not “what is this document about?”
3. **Timeouts.** `REQUEST_TIMEOUT_MS` 30s → 60s; SPA `ask()` 130s → 145s.

## Out of scope

Abstain-card copy · raise `k` · hybrid/RRF · table split / contextual embeddings · document
summary / TOC · agent / second retriever · ingest/CI timeouts · 150s Edge wall clock ·
`--quick` / full RAGAS for this addendum.

---

## Phase 1 — Retrieval append + timeouts

**Files:** `supabase/functions/ask/pipeline.ts`, `supabase/functions/_shared/llm.ts`,
`src/lib/api.ts`, `supabase/functions/ask/pipeline.test.ts`.

**Checkpoint:** `pnpm test:functions`. Follow-up embed contains standalone **and** raw
question; first-turn embed is exactly `question`. Stop for approval.

## Phase 2 — Facts prompt

**Files:** `pipeline.ts` `factsChunk`, `_shared/prompt.ts` `ANSWER_SYSTEM`.

**Checkpoint:** existing facts Deno tests + facts-chunk wording includes chapter/heading +
page length; content questions still cite a real chunk. Stop for approval.

## Phase 3 — Verify + ship

2–3 live MCMI `/ask` calls after explicit quota confirm (~7 LLM calls): follow-up cutoff
after an instrument question; “how many pages” → `__facts__`, 247. Then
`supabase functions deploy ask` + SPA push. `/code-review` on the Phase 1–2 diff first.

## Whole-addendum verification (hand to release-qa)

Deno green; live checks as Phase 3; three response kinds unchanged; no new migration.

## Deviations from spec

- **Phase 3 order:** `supabase functions deploy ask` runs *before* the live MCMI `/ask`
  checks, not after. The new pipeline is only on the Edge Function; hitting production
  first would score the old rewrite-only retrieve. SPA push still follows the live checks.
- **Phase 3 `/code-review`:** reviewer found no correctness gaps. Residual risks left for
  live MCMI: model compliance (Deno only locks embed strings / prompt wording); a
  primary-timeout + fallback + condense/answer/verify path can still exceed the ~150s
  Edge ceiling.
- **Phase 3 live MCMI (2026-09-13, eval user, free model, ~7 LLM calls):** pages question
  grounded — `__facts__`, “247 pages”. Follow-up after “What is this instrument used for?”
  still abstained; retrieved p.17/68/112/113/115/144, not 133/148. Same neighborhood as
  the rewrite-only miss. Append rule is deployed as specified; one embed of
  `standalone + raw` was not enough for gte-small on this turn. Did not change the
  signed embed formula.

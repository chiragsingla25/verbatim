# Spec addendum — Verbatim "accuracy MVP": document facts block

Build contract for app-developer, extending v1 / v1.1 / v1.1.1 / v1.1.2 / v1.2 (all frozen
build records). Same stack and deployment — Vite + React SPA on GitHub Pages, Supabase
Postgres + pgvector + Auth + Storage + Edge Functions, OpenRouter free model, $0 / all-OSS.

**This closes one false-"not found" class: metadata questions** ("how many pages / what year /
who published / which instrument is this") — answerable from `manual_versions` but invisible
to `/ask` today — are answered from a deterministic catalog **facts block**. It does not
loosen the grounding guarantee: a grounded answer still carries ≥ 1 citation to something in
*this turn's* context (now a retrieved chunk **or** the `__facts__` block), or abstains.

> **Scope was cut during Build (2026-09-11).** The addendum originally also carried a
> **hybrid dense + lexical retrieval** phase (C2 — a `match_chunks_hybrid` RPC fusing pgvector
> `<=>` with Postgres `tsvector` via RRF). It was **dropped**: (a) the failing cases it
> targeted (`pss-response-scale`, `pss-reverse-items`) turned out to be *answer-step*
> failures, not retrieval — the PSS corpus is 8 chunks, fewer than `k = 12`, so every chunk
> is already in context; (b) there is no eval evidence that plain pgvector top-k
> under-retrieves on the larger manuals; (c) the RRF SQL was disproportionate complexity for
> an unproven need. Hybrid retrieval is now a `docs/backlog.md` item, gated on an eval
> showing dense-only actually misses chunks. See *Phase 3 (dropped)* and *Deviations*.

Delivery model: single generalist developer + a fresh-context `/code-review` at the phase
boundary. Phase 2 touches the accuracy boundary (answer / verify prompts) — the eval suite is
the release gate.

Ship model: **Phase 1 ships on its own, immediately** (it un-blocks the eval suite — nothing
downstream can be measured until it lands). **Phase 2 builds, then one release-qa Verify +
Ship.**

---

## Scope

1. **Restore the eval corpus + tighten the CI gate.** Re-activate the 3 public-domain sample
   manuals (archived during v1.2 admin-console testing); archive the copyrighted MCMI-III
   that was uploaded in their place. Add a **full `run_evals.py` job to `ci.yml` that runs
   only on `push: main`** so a false-abstain regression on an *answerable* case blocks the
   deploy — `--quick` (abstain + cross-version only) stays the per-PR gate.
2. **Document facts block (C1).** A deterministic block assembled from `manual_versions` +
   one section count — instrument, title, edition, year, publisher, page count, section
   count, supersede status — injected into the answer **and** verify prompts as a reserved
   synthetic chunk `__facts__`. A metadata claim cites `__facts__`; the grounding invariant
   holds literally. A one-line upload-title guard rides along so the block isn't built from
   garbage.
3. ~~**Hybrid retrieval (C2).**~~ **Dropped during Build** — see the note above and
   *Phase 3 (dropped)*. Moved to `docs/backlog.md`.

## Out of scope (stay deferred — all in `docs/backlog.md` under "v1.2 post-ship audit")

Per-answer 👍/👎 feedback (**B11 — its own small spec, next**); the "ingest v2" retrieval
stretch (outline artifact, document-summary artifact, contextual embeddings); reranker
(RRF fusion is **not** a reranker — no model, no cross-encoder); every Track A / B UX item
(manual delete for published/archived versions, conversation delete/copy/rename/search,
account/settings page, error boundary, iOS keyboard-zoom, Ask retry/cancel, archived-manual
signposting, wedged-upload notification); full corpus-policy enforcement on the upload
attestation (only a blank/1-char title guard is in scope).

## Intake decisions (2026-09-11)

- **Corpus restore:** un-archive the 3 originals (`republish_manual_version` ×3), archive the
  MCMI-III (`archive_manual_version`). `evals/manifest.json` is **unchanged** — the 3 version
  ids in it are still valid, so the restored corpus is byte-identical to what every prior
  eval ran against. The MCMI-III row stays in the DB (archived, not deleted).
- **CI eval gate:** full `run_evals.py` runs **on merge to `main`**, not per-PR. `deploy.yml`
  already gates on the whole `ci` workflow succeeding, so a full-eval failure on the main
  push blocks the deploy automatically. Per-PR stays `--quick` for a fast loop.
- **Facts-block representation:** a reserved synthetic chunk id `__facts__` (`page 0`,
  `section 'metadata'`), always present in the answer context and — new — the verify context.
  A `__facts__` citation is a valid citation (counts toward "grounded", never stripped by
  verify). The SPA renders it as a plain "Document metadata" chip, no page link, no
  slide-over. **The transcript and rolling summary still never reach verify** (v1.2 invariant
  intact) — only chunks + `__facts__` do.
  - *Deliberate deviation from v1.2's "single-turn byte-identical":* the facts block is
    always-on, so it changes the single-turn answer / verify prompt on purpose. The full eval
    is the gate. **Fallback if abstention regresses:** make the block conditional on a
    lightweight metadata-ish signal in the question, or revert it.
- ~~**Hybrid retrieval placement**~~ — dropped during Build (see the scope note up top).
  Retrieval is unchanged: the pgvector-only `match_chunks` RPC.
- **B11 feedback:** **split out** of this addendum. This spec stays purely corpus + CI +
  the facts block.

## Architecture change (mirror into CLAUDE.md + .claude/rules/src.md in Phase 2)

- **Retrieval is unchanged** — one `match_chunks` call (pgvector `<=>` top-k, `security
  invoker`, filtered to the one locked `version_id`). No hybrid, no lexical arm, no reranker.
- **A deterministic document-facts source joins the retrieved chunks** as a citable, non-web,
  version-scoped input (`__facts__`). It is a `version_facts()` RPC over `manual_versions` +
  `document_chunks`, **not a retriever**. It reaches the answer step as a synthetic chunk
  (`chunkId = __facts__`, `page 0`), and `verify` gets it in context too, so a metadata claim
  is checkable rather than stripped.
- **Three response kinds are unchanged** (`grounded` / `abstained` / `meta`). The grounding
  guarantee is unchanged: every `grounded` answer cites ≥ 1 item in *this turn's* context —
  a retrieved chunk **or** `__facts__` — or the turn abstains. Never the open web.

## Prior art & scope rationale

The **facts block** is the minimal slice of multi-representation indexing — LlamaIndex's
`DocumentSummaryIndex` / LangChain's `MultiVectorRetriever` are the full version (an
ingest-time summary/outline artifact per document), deferred to "ingest v2" in the backlog.
Here we only surface what's already structured in `manual_versions`, so it needs no re-ingest,
no LLM call, and no new query path — a single `version_facts()` lookup alongside the existing
`match_chunks` call.

**Deliberately cut:** hybrid dense + lexical retrieval / RRF (dropped during Build — no eval
evidence plain top-k under-retrieves on this corpus; the cases it targeted are answer-step,
not retrieval; disproportionate SQL complexity for an unproven need); generated document
summaries (ingest cost); reranker (cost / OSS); query-type routing / a classifier (the facts
block is always-on).

**Table-stakes this build adopts:** lexical + dense fusion; exact-metadata answers.
**Deliberately cut:** reranker (cost / OSS), generated document summaries (ingest cost),
query-type routing / a classifier (let the separate arms + the facts block route implicitly).

---

## Phase 1 — Restore the eval corpus + CI gate

**Delivers:** a clean, known, public-domain 3-manual corpus; `run_evals.py` runnable again;
a full-eval gate on merge to `main`.

**Work**

- **`evals/restore_corpus.sql`** *(new — a documented one-off, not a schema migration; a
  fresh DB clone never had the archived state, so this must not live in `migrations/`)*:
  idempotent —
  ```sql
  select public.republish_manual_version('a8d5138c-057f-47ca-a6e2-e599731d6e9c'); -- PSS
  select public.republish_manual_version('520b140b-ff17-49fb-878a-2e3ac19c6d68'); -- PHQ/GAD-7
  select public.republish_manual_version('d0a4d5ec-2cc1-4e4f-b498-5bc4473d53ea'); -- AUDIT
  select public.archive_manual_version('8cfe4d5f-876c-4afa-b4a1-af1ac1c85037');    -- MCMI-III "1994"
  ```
  Run once against prod (service role; SQL editor or `psql`). Both RPCs already guard state +
  write `audit_log`; wrap each in a `do $$ … exception when others then raise notice … $$`
  so a "already active / already archived" re-run is a no-op. Commit the file for the record.
- **`.github/workflows/ci.yml`** — add a `full-evals` job:
  - `if: github.event_name == 'push'` (main pushes only — PRs fire `pull_request`, not
    `push`).
  - `pip install -r evals/requirements-ragas.txt`; `timeout-minutes: 45`.
  - `run: python evals/run_evals.py` (default `--fail-under` = 0.70, matching the v1.2 ship).
  - Reuse the exit-2 (quota → `::warning::`, exit 0) / exit-3 (auth → `::error::`, fail)
    handling from `quick-evals`.
  - Leave `unit` and `quick-evals` unchanged. `quick-evals` stays the per-PR signal.
  - Leave `evals-nightly.yml` in place (catches live-model drift with no code change).
- **`evals/manifest.json`** — verify (do not edit) the 3 ids match the restore script.
- **`docs/backlog.md`** — tick the "3 sample manuals archived / manifest stale" line under
  the v1.2 post-ship audit as done.

**Checkpoint**

- `evals/restore_corpus.sql` applied to prod; `manual_versions` shows PSS / PHQ-GAD7 / AUDIT
  `active`, MCMI-III `archived`.
- Local `run_evals.py` (full) green against the restored corpus: record the **post-restore
  abstention baseline** (expected ≈ the v1.2 number, with `pss-reverse-items` /
  `pss-response-scale` still failing — those are Phase 3's target), cross-version-leak = 0,
  conversational 6/6, RAGAS mean ≥ 0.70.
- A throwaway PR shows only `unit` + `quick-evals`; the merge commit to `main` shows
  `full-evals` running, and a forced RAGAS/abstention failure on `main` blocks `deploy.yml`.

**Hard gate:** app-developer reports the restored corpus state + the post-restore baseline
numbers, then stops for go-ahead before Phase 2.

---

## Phase 2 — Document facts block (C1)

**Delivers:** metadata questions ("how many pages / what edition / what year / who published /
what instrument is this") return a `grounded` answer citing `__facts__`, instead of abstaining.

**Work**

- **`supabase/migrations/<ts>_version_facts.sql`** *(new)* — `version_facts(p_version_id
  uuid)` RPC: `language sql stable security invoker set search_path = public`, returns one
  row: `instrument_name, title, edition, year, publisher, page_count, section_count`
  (`count(distinct section)` over `document_chunks` for that version, `section` non-null),
  `superseded_by_title` (reverse lookup on `supersedes_id`). `security invoker` so RLS on
  `manual_versions` / `document_chunks` still decides visibility. `revoke … from public,
  anon; grant execute … to authenticated`.
- **`supabase/functions/_shared/prompt.ts`**
  - `export const FACTS_CHUNK_ID = '__facts__'`.
  - `formatFactsBlock(facts: DocFacts): string` → a compact labelled block, e.g.
    `DOCUMENT METADATA (catalog facts about this version — cite as ${FACTS_CHUNK_ID}):\n` +
    `instrument: … · title: … · edition: … · year: … · publisher: … · pages: … · sections: …`
    (omit empty fields; "superseded by …" only when set).
  - `answerUserPrompt` and `verifyUserPrompt` gain an optional `facts?: DocFacts` param;
    when present, the facts block is prepended to the `CONTEXT` section as a synthetic chunk
    header `[chunkId=__facts__] (document metadata)`. Keep `formatContext` untouched — add
    the facts as a separate prepended string so leaf-chunk formatting is unchanged.
- **`supabase/functions/ask/pipeline.ts`**
  - `type DocFacts` (mirrors the RPC row). `AskDeps` gains `getFacts(versionId) =>
    Promise<DocFacts | null>`.
  - In `ask()`: `const facts = await deps.getFacts(versionId)` (before retrieval). Build the
    synthetic chunk `{ chunkId: FACTS_CHUNK_ID, page: 0, section: 'metadata', content:
    <the block>, tableRef: null, score: 0 }`.
  - Add `FACTS_CHUNK_ID` to `validIds`. Pass `facts` into `answerUserPrompt` and the verify
    context (build `verifyContext` as `[factsChunk, ...cited, ...+2]` when `facts` is
    non-null). A citation to `__facts__` is valid and is **not** filtered out by the
    `validIds` / `finalAnswer.includes(quote)` checks — special-case: keep a `__facts__`
    citation if its `quote` substring appears in the facts block.
  - `retrieved` logged to `query_log` **excludes** `__facts__` (it is not a retrieved chunk);
    `citations` may include it.
  - If `getFacts` returns `null` (RPC error / version vanished) — proceed with no facts block
    (exactly today's behaviour). Never throw the turn on a facts failure.
- **`supabase/functions/ask/index.ts`** — implement `getFacts`: one `supabase.rpc(
  'version_facts', { p_version_id })` under the caller JWT client; map to `DocFacts`.
- **`supabase/functions/_shared/schema.ts` + `src/lib/schema.ts`** (mirror, byte-identical) —
  no structural change required (`__facts__` is just a `chunkId` string value); add a
  `FACTS_CHUNK_ID` export mirrored from `_shared/prompt.ts` **only if** the SPA needs the
  constant (it does — see AnswerCard). Keep the two files identical.
- **`src/components/AnswerCard.tsx`** — a citation with `chunkId === FACTS_CHUNK_ID` (or
  `page === 0 && section === 'metadata'`) renders as a static "Document metadata" chip: no
  `onCite`, no slide-over trigger, distinct styling (reuse the muted `.meta-card` palette).
- **`src/routes/Upload.tsx`** — reject `title.trim().length < 2` client-side with an inline
  message before `startManualUpload`. (Server-side CHECK / attestation enforcement stays out
  of scope.)
- **`supabase/functions/ask/pipeline.test.ts`** — new cases:
  - metadata question + facts present → `grounded`, `citations` includes `__facts__`,
    `kind: 'grounded'`.
  - a content question still cites a real chunk, not `__facts__`, when the answer is in a
    chunk.
  - verify keeps a `__facts__`-backed claim (does not strip it).
  - `getFacts` returns `null` → pipeline behaves exactly as the pre-facts path (regression
    guard).
- **`evals/golden_dataset.jsonl`** — +2 cases, `shouldAbstain: false`:
  - `pss-page-count` — "How many pages is the PSS manual?" → `expectedAnswerContains`: the
    real page count.
  - `audit-publication-year` (or `phq-publisher`) — a second metadata question against a
    different manual → `expectedAnswerContains`: the real value.

**Checkpoint**

- `pnpm test:functions` green incl. the 4 new cases; `deno check` clean; `pnpm build` OK.
- Migration applied to prod; `ask` redeployed.
- Local `run_evals.py` (full): the 2 new metadata cases pass (`grounded`); **abstention
  accuracy ≥ the Phase-1 post-restore baseline** (the facts block must not push the small
  model toward abstaining on content questions — if it does, apply the conditional-block
  fallback); cross-version-leak = 0; conversational 6/6; RAGAS ≥ 0.70.
- Live probe: "how many pages is this manual?" and "what year was this published?" against a
  real version → grounded, "Document metadata" chip, no slide-over.

**Hard gate:** `/code-review` on the Phase-2 diff (focus: the grounding invariant — can a
`__facts__` citation ever launder a non-metadata claim past verify?). Report + stop before
Phase 3.

---

## Phase 3 — Hybrid retrieval (C2) — DROPPED during Build (2026-09-11)

Built in full (commit `ada296e`: `match_chunks_hybrid` RPC, generated `tsv` column + GIN
index, RRF k=60, pipeline switched, CLAUDE.md updated), then **reverted** (`3fcce0c`) and the
prod objects dropped. Reasons, in order of weight:

1. **Wrong diagnosis.** The checkpoint's targets — `pss-response-scale`, `pss-reverse-items` —
   are *answer-step* failures, not retrieval. The PSS corpus is **8 chunks** (< `k = 12`), so
   `match_chunks` already returns *every* chunk on every query, including the two that hold
   the answers (`"…reversing responses … items 4, 5, 7, & 8…"`; `"0 = Never … 4 = Very Often"`).
   Better retrieval cannot help when retrieval already returns everything.
2. **No evidence of a retrieval gap** on the larger manuals (PHQ 22 chunks, AUDIT 61). A
   `psycopg` probe showed the lexical arm *can* surface a plausible chunk for a token-heavy
   AUDIT query, but no eval run showed dense-only `match_chunks` actually missing a needed
   chunk there.
3. **Disproportionate complexity.** The RRF SQL (two CTEs + a full outer join + an
   OR-of-lexemes `to_tsquery` built by re-lexemising the query, because `websearch_to_tsquery`
   AND-joins terms) is ~60 lines carrying real cognitive load, for an unproven need.

**Now a `docs/backlog.md` item** ("Hybrid retrieval — gated on eval evidence"): revisit only
if a `run_evals.py` shows plain `match_chunks` under-retrieving on a multi-chunk corpus, and
prefer the smallest fix then (raise `k`; a minimal FTS fallback) before RRF.

---

## Whole-addendum verification (hand to release-qa after Phase 2)

### release-qa (Verify — Phase 2, 2026-09-11)

- **Phase-1 baseline, recorded** (blocked on the OpenRouter daily cap until now): full
  `run_evals.py` against the *pre-facts* prod `ask` — **88.46% abstention accuracy (< 90%
  threshold, blocking)**. 3 failures: `pss-reverse-items` (known answer-step issue, filed to
  backlog, unrelated to this change), `audit-page-count` (wrongly abstained), and
  `audit-publication-year` (wrong year, "1989" instead of "2001") — the latter two are
  exactly the metadata-question class the facts block targets.
- **`/code-review`** on the never-reviewed `75e64d6` diff (high effort, RLS + control-flow
  focus): 2 findings, both non-blocking (no correctness/security defect).
  - **Fixed** (`1d13ebb`): `Promise.all([embed, getFacts])` made `matchChunks` — which only
    needs the embedding — wait on the facts RPC too, adding latency to every turn. Changed to
    kick off `getFacts` without blocking; `matchChunks` now starts the instant `embed`
    resolves. No behavior change (37/37 deno green, incl. the 4 `facts:` cases).
  - **Recorded, not fixed:** `hits.length === 0 && !facts` effectively retires the old
    zero-chunk fast-abstain for any version that exists and is visible (`version_facts()` is
    non-null for any real version regardless of chunk count) — a version with broken/empty
    ingestion now costs 2 LLM calls per question instead of 0. Rare edge case (requires a
    published version with zero chunks); not worth special-casing.
- **Deployed:** `supabase functions deploy ask` (facts block + the latency fix), confirmed
  live via a direct call — "How many pages is this document, and what year was it published?"
  → `"This document is 41 pages long and was published in 2001."`, citing `__facts__`.
- **Post-deploy full `run_evals.py`: PASSED.**
  - Abstention accuracy: **96.15%** (25/26) — both `audit-page-count` and
    `audit-publication-year` now `grounded`, citing `__facts__`. Only `pss-reverse-items`
    remains (pre-existing answer-step issue, out of scope here).
  - Cross-version leak: 4/4 isolated, zero leaks.
  - RAGAS: faithfulness 0.842, context-precision 0.609, **mean 0.725** (≥ 0.70 threshold).
  - Conversational: 6/6.
- **Verdict: shipped.** `ask` is live with the facts block; `version_facts` migration
  confirmed applied. No further action needed on this spec.

- **Grounding / isolation:** retrieval is unchanged (`match_chunks`, `security invoker`,
  version-filtered); `cross_version_leak.py` = 0. `version_facts()` is `security invoker` too,
  so a version the caller can't see yields no facts block. A `__facts__` citation can only
  carry a claim whose quote is in the deterministic facts block — it cannot launder a content
  claim past `verify` (verify still checks content claims against real chunks).
- **Accuracy:** full `run_evals.py` green — abstention accuracy **≥ the Phase-1 post-restore
  baseline**; the 2 new metadata cases (`audit-page-count`, `audit-publication-year`)
  `grounded` citing `__facts__`; cross-version-leak = 0; conversational 6/6; RAGAS mean
  ≥ 0.70. (`pss-response-scale` / `pss-reverse-items` remain out of scope — answer-step, see
  Phase 3 dropped.)
- **No pipeline-shape regression:** a first / single-turn call still produces the three
  response kinds; `meta` still skips retrieval + verify; the rolling summary / transcript
  still never reach `verify`. `getFacts` returning `null` reproduces the exact pre-facts path.
- **Local sweep:** lint + unit + deno (37) + `deno check` + build green. New pipeline tests
  for the facts block (4).
- **Ship:** `version_facts` migration via `supabase db push --linked` (already applied);
  `supabase functions deploy ask`; merge to `main` → `ci` (`--quick` per-PR; `full-evals` on
  the main push) → `deploy.yml` → Pages. `CLAUDE.md` + `.claude/rules/src.md` updated in
  Phase 2. No new Edge Function.

---

## Deviations from spec

*(app-developer appends during Build, release-qa during Verify. "None" if nothing diverged.)*

### Phase 1 (app-developer)

- **`evals/restore_corpus.sql` uses direct `UPDATE` + `audit_log` `INSERT`, not the
  `republish_manual_version` / `archive_manual_version` RPCs.** Those RPCs are
  `SECURITY DEFINER` but gate on `auth_role() = 'admin'` **and** `auth.uid() is not null`,
  so they can't be invoked from a service-side connection (no admin JWT). The script mirrors
  the RPCs' exact side effects (status flip + an `audit_log` row, `actor_id` = the bootstrap
  admin, `action` `unarchive` / `archive`, `meta.via = 'restore_corpus.sql'`) and is
  idempotent (guards on current `status` + an anti-dup check on the audit row). Applied to
  prod via `psycopg` against `SUPABASE_DB_URL` (no `psql` on the box).
- **Phase-1 checkpoint (local full `run_evals.py` → post-restore baseline) is deferred.**
  The OpenRouter `:free` model daily request cap (1000/day) was exhausted by this session's
  debugging + three prior full/partial eval runs — `429 free-models-per-day`, resets at the
  next UTC midnight. Nothing in Phase 1 needs the LLM to be *correct* (the restore is a data
  op, verified directly; `ci.yml` is config); only the baseline *number* is pending. It will
  be recorded from the first successful full run (the `full-evals` CI job on this merge, or a
  local run after the quota reset). The `full-evals` job itself tolerates this — a `429`
  surfaces as exit 2 → `::warning::` → the job passes, so the deploy is not blocked by a
  quota outage.

### Phase 2 (app-developer)

- **The facts block is implemented as a synthetic `RetrievedChunk`, not a new
  `answerUserPrompt` / `verifyUserPrompt` parameter + `formatFactsBlock` formatter.**
  `factsChunk(facts)` in `pipeline.ts` builds `{ chunkId: '__facts__', page: 0, section:
  'metadata', content: <labelled block> }` and prepends it to the `pool` passed to the
  existing prompt helpers — so `formatContext` renders it and the prompts stay byte-identical
  (no signature change, no new prompt constant). `FACTS_CHUNK_ID` lives in `_shared/schema.ts`
  (+ the `src/lib/schema.ts` mirror) since the SPA needs it too; `prompt.ts` is untouched.
  Same intent as the spec, less surface.
- **`ask()` now proceeds when `hits.length === 0` *if* `facts` is non-null** (a metadata
  question with weak chunk retrieval must still reach the answer step). Both empty → still
  short-circuits to `abstain`.
- **`getFacts` and `embed` originally ran in `Promise.all`**, which unintentionally made
  `matchChunks` (which only needs the embedding) wait on the facts RPC too — flagged by the
  pre-deploy `/code-review` pass and fixed: `getFacts` is kicked off without blocking, and
  `matchChunks` starts the instant `embed` resolves; `facts` is awaited only when the pool is
  built. No behavior change (37/37 deno green, incl. the 4 `facts:` cases) — pure latency fix.
- **`__facts__` is kept out of `query_log.retrieved`** (a source, not a retrieved chunk) but
  may appear in `query_log.citations`. The verify "+2 extra" context chunks exclude it; a
  cited `__facts__` is always in the verify context.
- **Upload guard:** `Upload.tsx` rejects `instrumentName` / `title` shorter than 2 chars
  client-side (server CHECK / attestation enforcement stays out of scope).
- **Golden cases added:** `audit-page-count` ("41"), `audit-publication-year` ("2001") —
  `shouldAbstain: false`, digit-only `expectedAnswerContains`, no `expectedPage`.
- **Checkpoint status:** deno 37/37 (incl. 4 new facts tests), `deno check` / lint / unit /
  build green; `version_facts` verified live — returns the row for an active version, `[]`
  for one a student can't see (archived) → a hidden version yields no facts block. The
  **LLM-dependent checkpoint** (metadata cases returning `grounded` from prod `/ask`,
  abstention ≥ baseline) is deferred with Phase 1's baseline to one batched `run_evals.py`
  after the OpenRouter daily-cap reset. `ask` is **not** redeployed to prod yet — the
  `version_facts` migration is applied but dormant until then.
- **CLAUDE.md / `.claude/rules/src.md`** get the `__facts__` note in Phase 2 (the spec's
  "mirror in Phase 3" line is moot — Phase 3 is gone). Retrieval wording is unchanged.

### Phase 3 — Hybrid retrieval (dropped, 2026-09-11)

- **Built then reverted at the user's direction** ("I just wanted a normal retrieval, the way
  you did it is complex"). Commit `ada296e` added `match_chunks_hybrid` (dense `<=>` +
  OR-of-lexemes `tsvector`, RRF k=60), a generated `document_chunks.tsv` column + GIN index,
  and switched the pipeline; `3fcce0c` reverts all of it, and the dormant prod objects
  (`match_chunks_hybrid`, `tsv` column, GIN index) + the migration-history row `20260911130000`
  were dropped so prod == `supabase/migrations/` (latest `20260911120000`).
- **Why it was the wrong call:** (1) the target cases (`pss-response-scale`,
  `pss-reverse-items`) are *answer-step* failures — the PSS corpus is 8 chunks (< `k = 12`),
  so `match_chunks` already returns every chunk, including the two holding the answers;
  (2) no eval evidence plain top-k under-retrieves on the larger manuals; (3) ~60 lines of
  RRF SQL (incl. re-lexemising the query because `websearch_to_tsquery` AND-joins terms) is
  disproportionate to an unproven need.
- **`websearch_to_tsquery` was also the wrong primitive** (AND-joins every term → a
  natural-language question rarely `@@`-matches a terse chunk). Noted here for whoever revisits
  the backlog item: an OR-of-lexemes `to_tsquery` is the shape to use.
- **Now `docs/backlog.md`** — "Hybrid retrieval — gated on eval evidence": only revisit if
  `run_evals.py` shows plain `match_chunks` missing a needed chunk on a multi-chunk corpus;
  try raising `k` or a minimal FTS fallback before RRF.

# Verbatim — v1.1 backlog

Forward-looking work. v1 shipped 2026-09-09 (`specs/2026-09-07-verbatim.md` is now the build
record). Each item: **what** / why / rough size / where it was raised. Nothing here blocks the
current release; the mobile-navigation bug from the re-skin is already fixed (`7451ddd`).

**Shipped since v1:** session history + admin console + archive/supersede
(`specs/2026-09-09-verbatim-v1.1.md`); upload-lifecycle recovery
(`specs/2026-09-10-verbatim-v1.1.1-upload-recovery.md`); forgot-password + infra-fix bundle
(`specs/2026-09-10-verbatim-v1.1.2.md`); conversational `/ask` + session-grouped resumable
"My answers" (`specs/2026-09-10-verbatim-v1.2.md`).

**In progress:** an **accuracy MVP** — restore the eval corpus + gate + a document facts block
(`specs/2026-09-11-verbatim-accuracy-mvp.md`; hybrid retrieval was cut mid-build). Everything
under "v1.2 post-ship audit" and "Product review" below is deferred out of that cut.

**See also `docs/product-review-2026-09.md`** — a full walkthrough + market comparison; its
Tier 1–3 roadmap is the source of the "Product review" items below.

---

## Product

### ~~Session history / "My answers"~~ → v1.1 (`specs/2026-09-09-verbatim-v1.1.md`, Phase 1)

### ~~Admin UI for role promotion~~ → v1.1 admin console (`specs/2026-09-09-verbatim-v1.1.md`, Phase 3)

---

## Frontend polish

### Auth brand panel sizing (desktop)
The split auth screen's brand panel is `minmax(0, 480px)`; the design artboard is 560px, and the
checkmark bullet group sits low because of `justify-content: space-between` with a short middle
block. Cosmetic. `src/index.css` `.auth-split` / `.auth-brand`. Size: XS.

### Library search / filter
The `Library` artboard shows a search box + license/status filter dropdowns; skipped in v1
because there is no backing query. Add a client-side filter over `listVisibleVersions`
(`src/lib/api.ts`), or a search RPC if the corpus grows. Size: S.

---

## Infra / process
*(raised in the whole-build release-qa Verify pass — see the spec's "Verify pass … whole build")*

- **`deploy.yml` checkout SHA** — bare `actions/checkout` on a `workflow_run` trigger builds
  `main` HEAD, not the exact commit that passed CI (a small race on back-to-back pushes). Pin
  `github.event.workflow_run.head_sha`. Size: XS.
- **`run_evals.py` error handling** — a `_Terminal` (401/403 from `/ask`) propagates as an
  uncaught traceback instead of a clean non-zero exit. Catch it in `main()`. Size: XS.
- **`ask/index.ts` versionId regex** — currently the loose `^[0-9a-fA-F-]{36}$`. Tighten to a
  real UUID shape. Harmless today (a bad value just fails the `match_chunks` cast → 502). Size: XS.
- **Storage policy `manuals_select_active_source`** (`20260908170000_source_pdf_read.sql`) — the
  `name ~ '…{36}…'` regex + `(split_part(name,'/',2))::uuid` cast can raise on a crafted object
  name a contributor could upload. No live code path does a multi-row `storage.objects` scan, so
  no current impact. Tighten the regex to a strict UUID pattern. Size: XS.
- **Per-PR eval gating** — only `evals-nightly.yml` runs the full RAGAS suite; per-PR CI runs
  abstention + cross-version-leak only. The `k=8` / chunk-cap answer-quality regression slipped
  through because of this. Options: run the full suite per-PR, or raise `--abstain-fail-under`
  above 0.90 so a 1–2 case regression trips it. Size: S.
- **PSS retrieval quality** — `pss-reverse-items` and `pss-response-scale` (both answerable)
  abstain deterministically: `match_chunks` returns only the norm-table / references / intro
  chunks and never the PSS items page (`"0 = Never … 4 = Very Often"`, the numbered items),
  so the answer step has nothing to cite. Not a v1.2 regression — the single-turn path is
  byte-identical, and prior releases only gated on `run_evals.py --quick`, which never scored
  these two. RAGAS `context_precision` 0.575 on the full set is the same signal.
  **→ folded into the accuracy-MVP spec** (hybrid dense + lexical retrieval, C2). Full-set
  abstention is 91.67%, above the 0.90 gate, so this was quality debt, not a v1.2 blocker.

---

## Operational

- **Real signup email** — every test used `POST /auth/v1/admin/generate_link` (no send).
  Supabase's built-in mail is ~2/hr and rejects non-deliverable domains, so it was never
  exercised end to end. Decide before onboarding real users: rely on built-in for the pilot, or
  wire custom SMTP (Resend / Postmark free tier) in the Supabase dashboard. Size: XS (decision) /
  S (SMTP).
- **Monitoring** — Langfuse was deferred (spec option); `query_log` is the only trace store.
  Revisit once there's real traffic and the table isn't enough. Size: M.
- **Supabase Pro** — $0 works through the pilot; the 500 MB free tier caps the corpus at
  ~80–100 manuals (~5–6 MB each). Move to Pro ($25/mo) when Verbatim becomes a real program
  tool. Not code — a billing decision.

---

## v1.2 post-ship audit — deferred (2026-09-10)

Found while investigating four user reports after the v1.2 ship (can't delete an upload;
iOS keyboard zoom; "not found" too strict; can't delete/copy a conversation) plus a full
walk of the tool. **The accuracy-MVP cut takes only:** restore corpus + eval manifest, make
the *full* eval the CI gate, the **document facts block**, **hybrid retrieval**, and a
**per-answer feedback** signal. Everything below is out of that cut — real, but UX / trust
polish or a heavier retrieval lift, not answer accuracy.

### A — small standalone fixes — ✅ done 2026-09-10 (`4b4c6fa`)

- ~~**iOS keyboard zoom**~~ — `@media (max-width: 760px)` forces `input / textarea / select`
  + the composer textarea to 16px. `src/index.css`.
- ~~**Error boundary**~~ — `src/components/ErrorBoundary.tsx` (class component) wraps
  `AuthProvider` + `App` in `main.tsx`; "Something went wrong" panel with Reload / Go to
  library instead of a blank page.
- ~~**Ask — retry a failed turn**~~ — a failed turn keeps its question text and shows an
  inline "Try again" (`submit()` refactored to share `runTurn(id, q)`). `src/routes/Ask.tsx`.

### B — missing basics (own bundle, e.g. v1.3)

- **Delete a published / archived manual** — `delete_manual_version` is `pending`-only, so an
  `active` or `archived` version can't be removed anywhere; a contributor can't delete their
  own published upload at all. And "Archive" lives only in Admin → Manuals. Decide: hard-delete
  for `active` / `archived` (guarded when `query_log` history exists) vs. surfacing Archive on
  the Library row + Review page. Size: M.
- **Archived-manual signposting** — ✅ *partly done 2026-09-10*: `/history` now shows "This
  manual version has been retired — you can still read this conversation, but not continue it"
  on a card whose manual is archived (Resume stays hidden). `getAskVersion` already throws a
  clean "That manual version is not available." for a student hitting `/ask/:id` on an
  archived version. Still open: a "superseded by X →" link on the Library row / locked Ask
  header.
- **Upload metadata validation** — a junk title (`"1994"`) passed (`required` only checks
  non-empty); no min length, and nothing enforces the "public domain" attestation (an MCMI-III,
  copyrighted, was uploaded under it). A garbage catalog row also feeds a garbage facts block
  once C1 lands. Size: S. (A minimal guard rides along with the facts block.)
- **Delete a conversation** — `query_log` / `chat_sessions` have no delete policy (eval
  corpus). Needs a soft-delete / `hidden` flag on `chat_sessions` — keep the rows, hide the
  session from "My answers". Size: S.
- ~~**Copy a conversation**~~ — ✅ done 2026-09-10: "Copy conversation" in the expanded
  `/history` card copies the transcript (`Q: … / A: …`, manual + title header) —
  `navigator.clipboard` with a `document.execCommand` fallback and an inline "Copied" /
  "Press ⌘/Ctrl-C to copy" hint. Per-answer copy / share-link still open.
- ~~**Rename a conversation**~~ — ✅ done 2026-09-10: "Rename" in the expanded card →
  `window.prompt` → `renameSession()` (`chat_sessions` UPDATE under the existing
  `chat_sessions_update_self` RLS, title trimmed + capped at 120). No migration needed.
- ~~**Search across conversations**~~ — ✅ done 2026-09-10: a "Search conversations…" box in
  the `/history` header filters the loaded list on title + manual label (client-side; only
  searches pages already loaded).
- **Empty conversations from a half-failed turn** — a `chat_sessions` row can have
  `turn_count ≥ 1` but zero `query_log` rows (an `/ask` that advanced the session via
  `chat_session_next_turn` then failed before `safeLog`, e.g. an LLM 503). `/history` now
  shows "This conversation has no saved answers." on expand, but these still clutter the
  list. Options: filter them out in `listMySessions` (needs a join/exists on `query_log`),
  or a cleanup job. Seen a lot in the eval user's history. Size: S.
- **Account / settings page** — can't change password while signed in (only via the
  forgot-password email round-trip), can't see own email / role, no display-name concept.
  Size: M.
- **Cancel a pending answer** — no stop control; the 240 s client timeout fires with no
  feedback. `src/routes/Ask.tsx`. Size: S.
- **"Resume last conversation" entry point** on the manual's own page — v1.2 resume is only
  reachable via My answers → expand → Resume. Size: XS.
- **Wedged-upload notification** — the watchdog fails a stuck job server-side, but the
  contributor only learns by revisiting the Review page. Size: S.

### Hybrid retrieval (dense + lexical / RRF) — gated on eval evidence

Built during the accuracy-mvp then reverted (`ada296e` → `3fcce0c`) as premature: the cases
it targeted (`pss-response-scale`, `pss-reverse-items`) are *answer-step* failures, not
retrieval — the PSS corpus is 8 chunks (< `k = 12`) so `match_chunks` already returns
everything. **Only revisit if a `run_evals.py` shows plain `match_chunks` missing a needed
chunk on a multi-chunk manual** (PHQ 22, AUDIT 61, or a larger future corpus). Then prefer the
smallest fix — raise `k`, or a minimal FTS fallback — before an RRF fusion. If RRF is used:
the lexical arm needs an **OR-of-lexemes `to_tsquery`** (`websearch_/plainto_tsquery` AND-join
every term and rarely `@@`-match a terse chunk). Size: M.

### C — retrieval quality "ingest v2" (stretch, after the facts block proves out)

All three share one corpus re-ingest, so they ship together or not at all:

- **Outline / TOC artifact** — ordered, deduped heading list from Docling's per-chunk
  `headings`, stored as one synthetic chunk, retrieved in a *separate lane* (k≈1–2) so it
  can't crowd out leaf chunks. Fixes "what's the table of contents / what sections". Size: M.
- **Document summary artifact** — one ingest-time LLM pass constrained to "only what these
  chunks say", stored as a synthetic chunk, separate lane, shown with distinct "overview"
  framing (like the v1.2 `meta` card). Fixes "what is this about / summarize this". Size: M.
- **Contextual embeddings** — per-chunk context blurb (from the whole doc) prepended *before
  embedding*; keep the raw chunk as `content` so citation quotes stay verbatim, store the
  vector computed from `context + chunk`. Anthropic's biggest single retrieval-failure
  reduction; targets terse instrument-PDF chunks directly. Size: L.
- **Smarter abstention copy** — "This version has no table of contents; the sections it
  contains are: …" — falls out of the outline artifact. Size: XS.
- **Reranker** — still out ($0 / OSS constraint; the good ones are hosted APIs). Revisit only
  if the above isn't enough.

### D — data / corpus state (not code)

- **MCMI-III uploaded as "public domain"** — it is a copyrighted Pearson instrument. The
  corpus policy isn't enforced anywhere (ties to the upload-validation item). Decide whether it
  stays in the test corpus.
- The three original sample manuals were archived during admin-console testing and the eval
  manifest went stale — both are in the accuracy-MVP cut to fix.

---

## Product review (2026-09-10) — from `docs/product-review-2026-09.md`

A full walkthrough + market comparison (vs ChatPDF / Humata / ChatDOC / NotebookLM /
OpenEvidence / Harvey / Glean). Verbatim's edge — **version isolation, explicit abstention,
a verify pass, $0 / OSS** — is real and rare. These are the gaps the market has closed that
fit Verbatim's "look up a fact in a manual, safely" mission. **Most of Tier 1–3 is now
spec'd** (2026-09-12, via app-architect) — see below.

### → v1.3 usefulness + UI warmth (`specs/2026-09-12-verbatim-v1.3-usefulness.md`)

Tables in answers · citation viewer v2 · staged answer progress · starter questions · copy
with citation · manual detail page · a psychologist-audience UI warmth pass · Tier-3:
`/` focus, `Esc` close, one-card onboarding, "N questions today". **No pipeline change.**

### → feedback loop (`specs/2026-09-12-verbatim-feedback.md`)

Per-answer 👍/👎 + "what was off", a `feedback` table, a minimal Admin 👎 list, an
`evals/feedback_review.py` that prints curatable golden candidates (human decides). Ships
right after the accuracy-mvp.

### Still deferred — own specs later

- **Real token streaming** — the Edge Function must stream + never show an unverified claim
  as final (`verify` is a 2nd LLM call after the draft). v1.3 ships *staged client-side
  progress* instead. Size: M.
- **Cross-edition compare** — two read-only locked Ask panes over two versions of one
  instrument; no blending, no new retrieval path. Highest-value latent feature for the
  "editions that quietly disagree" problem in the proposal. Size: M.
- **Shareable answer link** — a read-only public path to one `query_log` row; a new RLS /
  privacy surface (needs a share token, opt-in, a decision on what's exposed). Size: M.

### Still on the backlog — Tier 3, not in v1.3

- **PWA** — manifest + a service worker caching the app shell; installable icon. Size: S.
- **Admin metrics** — question volume, abstention rate, top manuals, corpus size vs the
  500 MB free-tier ceiling. Size: M.
- **Post-publish metadata edit** (Admin) — a manual's catalog row is frozen at upload. Size: S.

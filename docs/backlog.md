# Verbatim — v1.1 backlog

Forward-looking work. v1 shipped 2026-09-09 (`specs/2026-09-07-verbatim.md` is now the build
record). Each item: **what** / why / rough size / where it was raised. Nothing here blocks the
current release; the mobile-navigation bug from the re-skin is already fixed (`7451ddd`).

**Shipped since v1:** session history + admin console + archive/supersede
(`specs/2026-09-09-verbatim-v1.1.md`); upload-lifecycle recovery
(`specs/2026-09-10-verbatim-v1.1.1-upload-recovery.md`); forgot-password + infra-fix bundle
(`specs/2026-09-10-verbatim-v1.1.2.md`); conversational `/ask` + session-grouped resumable
"My answers" (`specs/2026-09-10-verbatim-v1.2.md`).

**In progress:** an **accuracy MVP** — restore the eval corpus + gate, a document facts block,
and hybrid (dense + lexical) retrieval — going through app-architect. Everything under
"v1.2 post-ship audit" below is explicitly **deferred out of that cut** and unscheduled.

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

### A — small standalone fixes

- **iOS keyboard zoom** — `font-size: 14px` on `input / textarea / select` and the Ask
  composer triggers Safari's focus auto-zoom, which never restores. Add
  `@media (max-width: 760px) { input, textarea, select { font-size: 16px } }` (not
  `maximum-scale=1` — that kills pinch-zoom a11y). `src/index.css`. Size: XS.
- **Error boundary** — any render throw is an unrecoverable blank screen. Add a top-level
  boundary in `src/App.tsx` with a reload / go-home fallback. Size: S.
- **Ask — retry a failed turn** — an errored turn shows the message but drops the question
  text; the user retypes. Keep the text, add "Try again". `src/routes/Ask.tsx`. Size: S.

### B — missing basics (own bundle, e.g. v1.3)

- **Delete a published / archived manual** — `delete_manual_version` is `pending`-only, so an
  `active` or `archived` version can't be removed anywhere; a contributor can't delete their
  own published upload at all. And "Archive" lives only in Admin → Manuals. Decide: hard-delete
  for `active` / `archived` (guarded when `query_log` history exists) vs. surfacing Archive on
  the Library row + Review page. Size: M.
- **Archived-manual signposting** — a student following a link to a now-archived manual gets a
  bare "not found". Show "this version was retired / superseded by X". Size: S.
- **Upload metadata validation** — a junk title (`"1994"`) passed (`required` only checks
  non-empty); no min length, and nothing enforces the "public domain" attestation (an MCMI-III,
  copyrighted, was uploaded under it). A garbage catalog row also feeds a garbage facts block
  once C1 lands. Size: S. (A minimal guard rides along with the facts block.)
- **Delete a conversation** — `query_log` / `chat_sessions` have no delete policy (eval
  corpus). Needs a soft-delete / `hidden` flag on `chat_sessions` — keep the rows, hide the
  session from "My answers". Size: S.
- **Copy / share a conversation or answer** — doesn't exist; pure client-side. Size: XS.
- **Rename a conversation** — the title is auto-derived from the first question, not editable.
  Size: XS.
- **Search across conversations** in "My answers". Size: S.
- **Account / settings page** — can't change password while signed in (only via the
  forgot-password email round-trip), can't see own email / role, no display-name concept.
  Size: M.
- **Cancel a pending answer** — no stop control; the 240 s client timeout fires with no
  feedback. `src/routes/Ask.tsx`. Size: S.
- **"Resume last conversation" entry point** on the manual's own page — v1.2 resume is only
  reachable via My answers → expand → Resume. Size: XS.
- **Wedged-upload notification** — the watchdog fails a stuck job server-side, but the
  contributor only learns by revisiting the Review page. Size: S.

### C — retrieval quality "ingest v2" (stretch, after the facts block + hybrid retrieval prove out)

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

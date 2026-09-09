# Verbatim — v1.1 backlog

Forward-looking work. v1 shipped 2026-09-09 (`specs/2026-09-07-verbatim.md` is now the build
record). Each item: **what** / why / rough size / where it was raised. Nothing here blocks the
current release; the mobile-navigation bug from the re-skin is already fixed (`7451ddd`).

---

## Product

### Session history / "My answers"
There is no UI to see past Q&A. Every `/ask` **is** persisted to `query_log` (question, answer,
citations, retrieved chunks, verify result, latency, `at`, `user_id`, `version_id`) and RLS
already allows self-read (`query_log_select_self_or_admin` in
`supabase/migrations/20260908120000_phase1_schema.sql`) — no client reads it.
- *Smallest useful:* a `/history` route listing the caller's rows, filterable by manual, each row
  opening the existing citation slide-over.
- *Larger:* re-hydrate a row into an Ask thread so the user can keep asking against that version.
- The design canvas's "My answers" rail item was deferred here. It's in the current
  out-of-scope list, so it needs a spec entry + a short clarify pass first.
- Size: S (read-only list) to M (thread re-hydration).

### Admin UI for role promotion
Promoting a student to `contributor` is a manual `profiles.role` UPDATE by an admin today (RLS:
`profiles_update_admin`, admin-only) — there is no screen. A minimal admin page (list users,
toggle role) removes the DB step. Size: S.

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

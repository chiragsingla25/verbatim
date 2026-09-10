# Spec addendum — Verbatim: per-answer feedback (the accuracy instrument)

Build contract for app-developer, extending v1 … the accuracy-mvp. Same stack and deployment.
Small, self-contained. **Belongs right after the accuracy-mvp ships** — it is how the "high
accuracy" claim gets *measured* in the wild and how the golden set grows past its 24 seeded
cases.

**Not** part of v1.3 usefulness (`specs/2026-09-12-verbatim-v1.3-usefulness.md`) — that's UI;
this is a data-capture loop with its own small migration.

---

## Scope

1. **A `feedback` table.** One row per rating: `id`, `query_log_id` (FK → `query_log.id`),
   `user_id`, `verdict` (`'up' | 'down'`), `note` (nullable text, ≤ 1000 chars), `at`.
   RLS: **self insert**; **self-or-admin select**; **no update, no delete** (same posture as
   `query_log` — it's evidence). One rating per `(query_log_id, user_id)` — a unique index;
   a re-vote is an insert that violates it, so the client sends `upsert`-by-deleting? No —
   no delete policy. Resolve in intake: either allow update-of-own-row (a narrow update
   policy on `verdict` + `note` only) **or** accept "first vote wins" and hide the control
   after voting. Recommendation: a **narrow self-update policy** (own row, `verdict`/`note`
   only) so a user can change their mind — this is feedback, not the eval corpus itself.
2. **The control.** On every **grounded** and **abstained** answer in `Ask` (and the same
   `AnswerCard` in `/history`): a quiet 👍 / 👎 pair. 👎 opens a one-line "What was off?"
   (optional). `meta` answers get no control (they make no manual claim). After voting, the
   control shows a small "thanks" and the chosen state.
3. **`src/lib/api.ts`** — `rateAnswer(queryLogId, verdict, note?)`. Needs `query_log.id` on
   the client: it is already on `HistoryEntry` (`getSession` / `listMyHistory` select it);
   the live Ask turn needs it too — the `/ask` response **already** carries enough to log,
   but not the row id. **Intake decision needed:** either (a) `/ask` returns the inserted
   `query_log.id` in `AnswerResult` (a schema mirror change + a pipeline change — the
   sensitive files), or (b) the client re-fetches the just-logged row by
   `(session_id, turn)` after the answer lands (an extra round-trip, no pipeline change).
   Recommendation: **(a)** — `AnswerResult.queryLogId` — it's one field, and the client
   already handles the schema mirror; the round-trip in (b) is fragile against the
   fire-and-forget `safeLog`.
4. **Admin surface (minimal).** A read-only list in the Admin console (or a new "Feedback"
   tab): recent 👎 with the question, the answer, the note, and a link to the `query_log`
   row. No triage workflow in this spec — just visibility.
5. **`evals/` — a 👎-to-candidate helper.** `evals/feedback_review.py`: pull 👎 rows since a
   date, print each as a candidate golden-dataset line (`{id, version, question,
   shouldAbstain?, expectedAnswerContains: []}`) for a human to curate into
   `golden_dataset.jsonl`. **Not** automated — a person decides what's a real miss vs a user
   disagreeing with a correct abstention.

## Out of scope

Automated golden-set growth · a public/anonymous rating path · rating `meta` answers ·
sentiment analysis of notes · a full triage/resolution workflow · surfacing aggregate
scores to end users.

## Architecture

No pipeline change **if** intake picks option (b) for the row id. Option (a) adds one field
to `AnswerResult` (`_shared/schema.ts` + `src/lib/schema.ts` mirror) and one line to the
pipeline (return the inserted id from `logQuery`). Retrieval, verify, the three response
kinds, and the eval suite are otherwise untouched. `--quick` stays green.

## Phases

1. **Table + API + control** — the migration (`feedback` table + RLS + unique index +
   the narrow self-update policy), `rateAnswer`, the `query_log.id` plumbing (per the intake
   decision), the 👍/👎 control in `AnswerCard` with the 👎 note. Checkpoint: rate a live
   answer 👍 then change to 👎 with a note; the row is in `feedback` with correct RLS
   (another user can't read it; admin can); re-rating updates in place.
2. **Admin visibility + eval helper** — the read-only 👎 list in Admin; `feedback_review.py`
   prints curatable candidates. Checkpoint: a 👎 with a note shows in Admin; the script
   emits a well-formed golden-dataset line.

`/code-review` at each boundary; then release-qa Verify + Ship (migration via `supabase db
push`; `supabase functions deploy ask` only if intake picks option (a); SPA via CI →
`deploy.yml`).

## Whole-addendum verification

- RLS: a non-owner non-admin cannot read another user's `feedback` row; nobody can delete
  one; the self-update policy only allows `verdict` / `note` on the caller's own row.
- The control never appears on a `meta` answer.
- No eval regression (`--quick` green; full run only if option (a) touched the pipeline).
- Local sweep green; a unit test for the `rateAnswer` payload shape and the re-vote path.

## Deviations from spec

- _(none yet)_

"""Eval orchestrator.

    python evals/run_evals.py --smoke            # CI gate on every PR/push: 2 /ask calls
    python evals/run_evals.py --quick            # abstention + cross-version-leak + conversational
    python evals/run_evals.py                    # full: + RAGAS faithfulness / context-precision
    python evals/run_evals.py --fail-under 0.70  # RAGAS mean threshold (full only)

/ask is called EXACTLY ONCE per scored case; every check consumes the same responses.

Exit codes:
  0  passed
  1  ran and failed (a leak, low abstention accuracy, or RAGAS below threshold)
  2  could not run (LLM daily quota exhausted) — CI treats this as a non-blocking warning
  3  could not run (/ask rejected auth — bad SUPABASE_* / eval-user creds)
"""

from __future__ import annotations

import argparse
import sys

import httpx

from common import AskResponse, QuotaExhausted, _Terminal, call_ask, load_config, load_golden
from abstention import score_abstention
from conversational import load_conversational, run_conversational
from cross_version_leak import score_cross_version_leak

# --smoke: the automatic gate on every PR/push (see ci.yml). Exactly 2 /ask calls, picked
# for the two failure modes worth catching on EVERY change without spending real quota:
# one representative grounded case ("the pipeline answers at all") and one cross-version-
# leak case ("no version's content leaks into another's answer" — the single worst failure
# mode this app can have). Named explicitly rather than picked by dataset order, so the
# choice stays stable if golden_dataset.jsonl is reordered or edited later. No RAGAS, no
# conversational, no full 26-case sweep — those live in evals-nightly.yml (cron + manual
# `gh workflow run evals-nightly.yml`), not on every push.
SMOKE_CASE_IDS = {"phq9-mod-severe", "pss-vs-audit-leak"}


def _cant_run(e: Exception) -> int:
    print(f"\nEVALS COULD NOT RUN — {e}")
    print("/ask or the eval-user token grant returned 401/403: check SUPABASE_URL /")
    print("SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / the eval user credentials.")
    print("Not a pipeline regression.")
    return 3


def main(argv: list[str] | None = None) -> int:
    try:
        return _run(argv)
    except QuotaExhausted as e:
        print(f"\nEVALS SKIPPED — {e}")
        print("The /ask pipeline is deployed and healthy; the LLM endpoint is out of daily")
        print("tokens. Re-run after the quota resets, or point LLM_* at a funded endpoint.")
        return 2
    except _Terminal as e:
        return _cant_run(e)
    except httpx.HTTPStatusError as e:
        # only auth failures — a 5xx or other HTTP error is a real problem, let it surface
        if e.response.status_code not in (401, 403):
            raise
        return _cant_run(e)


def _run(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="run_evals.py")
    ap.add_argument("--smoke", action="store_true", help="CI gate: 2 hand-picked cases, no RAGAS/conversational")
    ap.add_argument("--quick", action="store_true", help="skip RAGAS + only score abstention cases")
    ap.add_argument("--fail-under", type=float, default=0.70, help="RAGAS mean threshold (full run)")
    ap.add_argument("--abstain-fail-under", type=float, default=0.90, help="abstention accuracy threshold")
    args = ap.parse_args(argv)

    cfg = load_config()
    cases = load_golden()

    if args.smoke:
        scored = [c for c in cases if c.id in SMOKE_CASE_IDS]
        missing = SMOKE_CASE_IDS - {c.id for c in scored}
        if missing:
            raise SystemExit(f"--smoke case id(s) not found in golden_dataset.jsonl: {sorted(missing)}")
    elif args.quick:
        # quick mode scores only the abstention cases (fast, no verify call); full scores all.
        scored = [c for c in cases if c.should_abstain]
    else:
        scored = cases
    mode = ' [smoke]' if args.smoke else (' [quick]' if args.quick else '')
    print(f"loaded {len(cases)} golden cases; scoring {len(scored)} "
          f"({sum(c.should_abstain for c in scored)} abstain, "
          f"{sum(c.is_cross_version_leak for c in scored)} cross-version)"
          f"{mode}")

    # ── the only place /ask is called ──────────────────────────────────────
    responses: dict[str, AskResponse] = {}
    for c in scored:
        responses[c.id] = call_ask(cfg, c.version_id, c.question)

    failed = False

    # ── cross-version leak (always blocking) ───────────────────────────────
    leak_rows, leak_ok = score_cross_version_leak(cases, responses)
    print("\n== cross-version leak ==")
    for r in leak_rows:
        print(f"  [{'LEAK' if r['leaked'] else 'ok  '}] {r['case_id']:24} {r['answer']}")
    if not leak_ok:
        print("  >>> CROSS-VERSION LEAK DETECTED — blocking")
        failed = True
    elif leak_rows:
        print(f"  {len(leak_rows)}/{len(leak_rows)} isolated, zero leaks")

    # ── abstention / answerability ────────────────────────────────────────
    abst_rows, accuracy = score_abstention(cases, responses)
    print(f"\n== abstention / answerability (accuracy {accuracy:.2%}, {len(abst_rows)} cases) ==")
    for r in abst_rows:
        print(f"  [{'ok  ' if r.ok else 'FAIL'}] {r.case_id:24} {r.detail}")
    if accuracy < args.abstain_fail_under:
        print(f"  >>> accuracy {accuracy:.2%} < {args.abstain_fail_under:.0%} — blocking")
        failed = True

    # ── RAGAS (full only) ────────────────────────────────────────────────
    # Caught locally (not left to main()'s top-level QuotaExhausted handler): a total judge
    # outage shouldn't discard the abstention/cross-version/conversational results already
    # gathered above, or force the whole run's exit code to "couldn't run" when everything
    # else genuinely passed. RAGAS alone degrades to "skipped, not blocking" — the same
    # non-blocking treatment /ask's own quota exhaustion already gets, just scoped to this
    # one section instead of the entire run.
    if not args.quick and not args.smoke:
        from ragas_suite import run_ragas  # lazy: heavy deps

        print("\n== RAGAS ==")
        try:
            ragas_scores = run_ragas(cfg, cases, responses)
        except QuotaExhausted as e:
            print(f"  SKIPPED — {e}")
            print("  (the LLM judge is out of quota; not counted against this run)")
            ragas_scores = None
        if ragas_scores is not None:
            for metric, score in ragas_scores.items():
                print(f"  {metric:34} {score:.3f}")
            mean = sum(ragas_scores.values()) / len(ragas_scores) if ragas_scores else 0.0
            print(f"  {'mean':34} {mean:.3f}  (threshold {args.fail_under})")
            if mean < args.fail_under:
                print(f"  >>> RAGAS mean {mean:.3f} < {args.fail_under} — blocking")
                failed = True

    # ── conversational (v1.2, always blocking — grounding must survive history) ──
    # Skipped entirely in --smoke: 21 sequential /ask turns across 6 cases is exactly the
    # cost --smoke exists to avoid on every push/PR. Still runs for --quick and full.
    conv_cases = [] if args.smoke else load_conversational()
    if conv_cases:
        conv_rows, conv_ok = run_conversational(cfg, conv_cases)
        print(f"\n== conversational ({len(conv_rows)} multi-turn cases) ==")
        for r in conv_rows:
            print(f"  [{'ok  ' if r.ok else 'FAIL'}] {r.category:9} {r.case_id:34} {r.detail}")
        if not conv_ok:
            print("  >>> conversational failure (follow-up / no-smuggle / meta) — blocking")
            failed = True

    print("\n" + ("EVALS FAILED" if failed else "EVALS PASSED"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

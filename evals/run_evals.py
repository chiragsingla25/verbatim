"""Eval orchestrator.

    python evals/run_evals.py --quick            # PR gate: abstention + cross-version-leak
    python evals/run_evals.py                    # full: + RAGAS faithfulness / relevancy / precision
    python evals/run_evals.py --fail-under 0.85  # RAGAS mean threshold (full only)

Exit code is non-zero if any hard gate fails:
  - any cross-version leak (always blocking)
  - abstention accuracy below --abstain-fail-under (default 0.90)
  - (full) RAGAS mean below --fail-under (default 0.80)
"""

from __future__ import annotations

import argparse
import sys

from common import QuotaExhausted, load_config, load_golden
from abstention import run_abstention
from cross_version_leak import run_cross_version_leak


def main(argv: list[str] | None = None) -> int:
    try:
        return _run(argv)
    except QuotaExhausted as e:
        # exit 2 == "could not run" (LLM daily quota), distinct from exit 1 == "ran and failed".
        print(f"\nEVALS SKIPPED — {e}")
        print("The /ask pipeline is deployed and healthy; the LLM endpoint is out of daily")
        print("tokens. Re-run after the quota resets, or point LLM_* at a funded endpoint.")
        return 2


def _run(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="run_evals.py")
    ap.add_argument("--quick", action="store_true", help="skip RAGAS (PR gate)")
    ap.add_argument("--fail-under", type=float, default=0.80, help="RAGAS mean threshold (full run)")
    ap.add_argument("--abstain-fail-under", type=float, default=0.90, help="abstention accuracy threshold")
    args = ap.parse_args(argv)

    cfg = load_config()
    cases = load_golden()
    print(f"loaded {len(cases)} golden cases "
          f"({sum(c.should_abstain for c in cases)} abstain, "
          f"{sum(c.is_cross_version_leak for c in cases)} cross-version)")

    failed = False

    # ── cross-version leak (always) ──────────────────────────────────────────
    leak_rows, leak_ok = run_cross_version_leak(cfg, cases)
    print("\n== cross-version leak ==")
    for r in leak_rows:
        mark = "LEAK" if r["leaked"] else "ok  "
        print(f"  [{mark}] {r['case_id']:24} {r['answer']}")
    if not leak_ok:
        print("  >>> CROSS-VERSION LEAK DETECTED — blocking")
        failed = True
    else:
        print(f"  {len(leak_rows)}/{len(leak_rows)} isolated, zero leaks")

    # ── abstention accuracy ─────────────────────────────────────────────────
    abst_rows, accuracy = run_abstention(cfg, cases, quick=args.quick)
    print(f"\n== abstention / answerability (accuracy {accuracy:.2%}, "
          f"{len(abst_rows)} cases) ==")
    for r in abst_rows:
        mark = "ok  " if r.ok else "FAIL"
        print(f"  [{mark}] {r.case_id:24} {r.detail}")
    if accuracy < args.abstain_fail_under:
        print(f"  >>> accuracy {accuracy:.2%} < {args.abstain_fail_under:.0%} — blocking")
        failed = True

    # ── RAGAS (full only) ──────────────────────────────────────────────────
    if not args.quick:
        from ragas_suite import run_ragas  # imported lazily; heavy deps

        ragas_scores = run_ragas(cfg, cases)
        print("\n== RAGAS ==")
        for metric, score in ragas_scores.items():
            print(f"  {metric:22} {score:.3f}")
        mean = sum(ragas_scores.values()) / len(ragas_scores) if ragas_scores else 0.0
        print(f"  {'mean':22} {mean:.3f}  (threshold {args.fail_under})")
        if mean < args.fail_under:
            print(f"  >>> RAGAS mean {mean:.3f} < {args.fail_under} — blocking")
            failed = True

    print("\n" + ("EVALS FAILED" if failed else "EVALS PASSED"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

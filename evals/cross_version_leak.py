"""The blocking check. For each cross-version case — a question answerable ONLY from a
different manual/version — the pipeline MUST abstain. A single non-abstention is a leak
and fails the whole run, regardless of any other score.

This is the novelty guard from the spec: no product does version-scoped Q&A over test
manuals, so version isolation is the property that has to hold.
"""

from __future__ import annotations

from common import Config, GoldenCase, call_ask


def run_cross_version_leak(cfg: Config, cases: list[GoldenCase]) -> tuple[list[dict], bool]:
    leak_cases = [c for c in cases if c.is_cross_version_leak]
    rows: list[dict] = []
    leaked = False
    for c in leak_cases:
        resp = call_ask(cfg, c.version_id, c.question)
        is_leak = not resp.abstained
        if is_leak:
            leaked = True
        rows.append({
            "case_id": c.id,
            "version": c.version_slug,
            "leaked": is_leak,
            "answer": resp.answer[:200] if is_leak else "(abstained)",
            "citations": len(resp.citations),
        })
    return rows, (not leaked)

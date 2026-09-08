"""The blocking check, scored over pre-fetched /ask responses. For each cross-version case
— a question answerable ONLY from a different manual/version — the pipeline MUST have
abstained. A single non-abstention is a leak and fails the whole run.
"""

from __future__ import annotations

from common import AskResponse, GoldenCase


def score_cross_version_leak(
    cases: list[GoldenCase], responses: dict[str, AskResponse]
) -> tuple[list[dict], bool]:
    rows: list[dict] = []
    leaked = False
    for c in cases:
        if not c.is_cross_version_leak:
            continue
        resp = responses.get(c.id)
        if resp is None:
            continue
        is_leak = not resp.abstained
        leaked = leaked or is_leak
        rows.append({
            "case_id": c.id,
            "version": c.version_slug,
            "leaked": is_leak,
            "answer": resp.answer[:200] if is_leak else "(abstained)",
        })
    return rows, (not leaked)

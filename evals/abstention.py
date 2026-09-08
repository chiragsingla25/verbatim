"""Abstention accuracy over pre-fetched /ask responses: every `shouldAbstain` case must
have come back `abstained: true`; every answerable case must have an answer containing the
expected substrings and >=1 citation. No /ask calls here — run_evals owns those.
"""

from __future__ import annotations

from dataclasses import dataclass

from common import AskResponse, GoldenCase


@dataclass
class CaseResult:
    case_id: str
    ok: bool
    detail: str


def score_abstention(
    cases: list[GoldenCase], responses: dict[str, AskResponse]
) -> tuple[list[CaseResult], float]:
    results: list[CaseResult] = []
    for c in cases:
        resp = responses.get(c.id)
        if resp is None:
            continue  # not scored this run (e.g. --quick skips answerable cases)
        if c.should_abstain:
            ok = resp.abstained is True and len(resp.citations) == 0
            detail = "abstained" if ok else f"expected abstention, got: {resp.answer[:120]!r}"
        else:
            missing = [s for s in c.expected_contains if s.lower() not in resp.answer.lower()]
            ok = (resp.abstained is False) and len(resp.citations) >= 1 and not missing
            if resp.abstained:
                detail = "wrongly abstained"
            elif not resp.citations:
                detail = "answer has no citation"
            elif missing:
                detail = f"answer missing {missing}: {resp.answer[:120]!r}"
            else:
                detail = "ok"
        results.append(CaseResult(c.id, ok, detail))
    accuracy = sum(r.ok for r in results) / len(results) if results else 1.0
    return results, accuracy

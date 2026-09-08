"""Abstention accuracy: every `shouldAbstain` case must come back `abstained: true`, and
every answerable case must come back with an answer that contains the expected substrings
and >=1 citation. Fast — one /ask call per case, no RAGAS.

`quick=True` (the PR gate) runs every abstention case plus a small answerable smoke set,
to keep the Groq call count low; the full nightly run scores every case.
"""

from __future__ import annotations

from dataclasses import dataclass

from common import Config, GoldenCase, call_ask

@dataclass
class CaseResult:
    case_id: str
    ok: bool
    detail: str


def run_abstention(
    cfg: Config, cases: list[GoldenCase], *, quick: bool = False
) -> tuple[list["CaseResult"], float]:
    # In quick mode (the PR gate) only the abstention cases are scored — they return fast
    # (no verify call) and don't burn the Groq quota. Answerable-case correctness + RAGAS
    # are the nightly run's job, where latency budget isn't a constraint.
    if quick:
        cases = [c for c in cases if c.should_abstain]
    results: list[CaseResult] = []
    for c in cases:
        resp = call_ask(cfg, c.version_id, c.question)
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

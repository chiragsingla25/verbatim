"""Multi-turn eval: replay a scripted conversation against the deployed /ask (one fixed
session_id per case) and score the FINAL turn. Categories:

  followup  — the last question only resolves via an earlier turn; must stay grounded + cited.
  nosmuggle — the last question asks for something the manual does NOT contain; must abstain,
              and must NOT reuse a fact from an earlier turn (incl. one folded into the
              rolling summary in the long case). Zero tolerance.
  meta      — a question about the conversation; must come back kind == 'meta', no citation.

run_evals owns the call budget; this module makes the /ask calls for its own cases only.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path

from common import Config, call_ask, slug_to_version_id

EVALS_DIR = Path(__file__).resolve().parent


@dataclass
class ConvCase:
    id: str
    category: str
    version_id: str
    turns: list[str]
    final: dict


def load_conversational() -> list[ConvCase]:
    mapping = slug_to_version_id()
    out: list[ConvCase] = []
    path = EVALS_DIR / "conversational_dataset.jsonl"
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r["version"] not in mapping:
            raise SystemExit(f"conversational case {r['id']}: unknown version {r['version']!r}")
        out.append(ConvCase(
            id=r["id"], category=r["category"], version_id=mapping[r["version"]],
            turns=list(r["turns"]), final=dict(r["final"]),
        ))
    return out


@dataclass
class ConvResult:
    case_id: str
    category: str
    ok: bool
    detail: str


def run_conversational(cfg: Config, cases: list[ConvCase]) -> tuple[list[ConvResult], bool]:
    results: list[ConvResult] = []
    for c in cases:
        sid = str(uuid.uuid4())
        resp = None
        for q in c.turns:
            resp = call_ask(cfg, c.version_id, q, session_id=sid)
        assert resp is not None
        f = c.final
        kind = resp.raw.get("kind")

        if c.category == "meta":
            ok = kind == "meta" and resp.abstained is False and len(resp.citations) == 0
            for s in f.get("expectedAnswerContains", []):
                ok = ok and s.lower() in resp.answer.lower()
            detail = "kind=meta, no citation" if ok else (
                f"expected meta w/o citation, got kind={kind} abst={resp.abstained} "
                f"cites={len(resp.citations)}: {resp.answer[:120]!r}"
            )
        elif f.get("shouldAbstain"):
            ok = resp.abstained is True and len(resp.citations) == 0
            detail = "abstained (no smuggle)" if ok else (
                f"MUST abstain — reused an earlier fact? got: {resp.answer[:160]!r}"
            )
        else:  # followup — must be grounded and cite
            missing = [s for s in f.get("expectedAnswerContains", [])
                       if s.lower() not in resp.answer.lower()]
            ok = (resp.abstained is False and kind == "grounded"
                  and len(resp.citations) >= f.get("minCitations", 1) and not missing)
            detail = "grounded + cited" if ok else (
                f"kind={kind} abst={resp.abstained} cites={len(resp.citations)} "
                f"missing={missing}: {resp.answer[:140]!r}"
            )
        results.append(ConvResult(c.id, c.category, ok, detail))

    all_ok = all(r.ok for r in results)
    return results, all_ok

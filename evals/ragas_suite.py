"""RAGAS over the pre-fetched /ask responses for the answerable golden cases — nightly only
(heavy deps). No /ask calls here; run_evals owns those. Uses the same OpenAI-compatible
endpoint as the app (OpenRouter) as the judge LLM.

Metrics kept small to limit judge calls:
  - faithfulness              : is every claim in the answer grounded in the retrieved context?
  - LLMContextPrecisionWithoutReference : are the retrieved chunks relevant to the question?
"""

from __future__ import annotations

import os
import re

import httpx

from common import AskResponse, Config, GoldenCase, QuotaExhausted, fetch_chunk_contents

# Mirrors supabase/functions/_shared/schema.ts's MODEL_REGISTRY (Python can't import the
# Deno module directly, so this is a deliberate, kept-in-sync copy — same two ids, same
# order, same fallback chain the app itself uses). Only `llm_model` matters here.
MODEL_REGISTRY = [
    {"id": "free", "llm_model": "inclusionai/ling-3.0-flash-sante:free"},
    {"id": "qwen", "llm_model": "qwen/qwen3.7-flash"},
]

# Daily-vs-burst classification for a 429 body — a burst limit clears in seconds and is
# worth a short retry; a daily cap won't clear for hours, so retrying it (let alone
# LangChain's default max_retries=4 per call) is pure waste. Matched against OpenRouter's
# REAL error shape (verified against a live 429 this session), not the hyphen-free "per day"
# guess _shared/llm.ts's own regex uses — that one doesn't actually match OpenRouter's
# "free-models-per-day-high-balance" (hyphenated) or "openrouter_free_tier_daily" text
# either, a pre-existing gap there worth fixing separately; not touched here since it's out
# of this fix's scope (the whole-chain fallback still catches it regardless of the label).
_DAILY_RE = re.compile(r"per[\s-]day|tpd|rpd|daily|\"remaining\"\s*:\s*\"?0", re.I)

# Populated once per process by _pick_judge_model() and reused for the rest of this run —
# a single eval run makes ~38 judge calls; there is no reason to rediscover "the free model
# is exhausted today" 38 separate times when the first call already told us.
_judge_model_cache: str | None = None


def _pick_judge_model() -> str:
    """One cheap, no-retry ping per model in MODEL_REGISTRY order, cached for the process.
    A confirmed daily-quota 429 skips straight to the next model in the chain — the same
    fallback the app's own answer pipeline gets via createChatWithFallback — instead of
    either burning minutes on blind per-call retries (the bug this replaces) or letting the
    whole RAGAS section go dark whenever the free tier is tight."""
    global _judge_model_cache
    if _judge_model_cache is not None:
        return _judge_model_cache

    base = os.environ["LLM_BASE_URL"].rstrip("/")
    key = os.environ["LLM_API_KEY"]
    for m in MODEL_REGISTRY:
        try:
            r = httpx.post(
                f"{base}/chat/completions",
                headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
                json={
                    "model": m["llm_model"],
                    "temperature": 0,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}],
                },
                timeout=30,
            )
            if r.status_code == 429:
                reason = "daily-exhausted" if _DAILY_RE.search(r.text) else "rate-limited"
                print(f"  judge preflight: '{m['id']}' {reason}, trying next in chain")
                continue
            r.raise_for_status()
        except httpx.HTTPError as e:
            print(f"  judge preflight: '{m['id']}' unreachable ({e}), trying next in chain")
            continue
        print(f"  RAGAS judge model: {m['id']}")
        _judge_model_cache = m["llm_model"]
        return _judge_model_cache

    # Every model in the chain failed the preflight — fall through with the first one
    # anyway; run_ragas's existing "zero scores -> QuotaExhausted" catch handles this exact
    # case (the whole chain being down) as a graceful skip rather than a false 0.000.
    print("  judge preflight: every model in MODEL_REGISTRY failed — RAGAS will likely skip")
    _judge_model_cache = MODEL_REGISTRY[0]["llm_model"]
    return _judge_model_cache


def _judge_llm():
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    return LangchainLLMWrapper(ChatOpenAI(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        model=_pick_judge_model(),
        temperature=0,
        timeout=120,
        # Lower than before (was 4): the preflight above already filters out a confirmed
        # daily exhaustion before this client is even constructed, so what's left to retry
        # here is only genuine per-call transience during the real evaluate() run.
        max_retries=2,
    ))


def run_ragas(
    cfg: Config, cases: list[GoldenCase], responses: dict[str, AskResponse]
) -> dict[str, float]:
    from ragas import EvaluationDataset, evaluate
    from ragas.metrics import Faithfulness, LLMContextPrecisionWithoutReference

    # full text of every chunk any answerable case retrieved (one bulk fetch)
    all_ids = sorted({
        r.get("chunkId")
        for c in cases if not c.should_abstain
        for r in (responses.get(c.id).retrieved if responses.get(c.id) else [])
        if r.get("chunkId")
    })
    chunk_text = fetch_chunk_contents(cfg, all_ids)

    samples = []
    for c in cases:
        if c.should_abstain:
            continue
        resp = responses.get(c.id)
        if resp is None:
            continue
        contexts = [chunk_text[r["chunkId"]] for r in resp.retrieved if r.get("chunkId") in chunk_text]
        samples.append({
            "user_input": c.question,
            "response": resp.answer if not resp.abstained else "(abstained)",
            "retrieved_contexts": contexts or ["(no context returned)"],
        })
    if not samples:
        return {}

    dataset = EvaluationDataset.from_list(samples)
    llm = _judge_llm()
    result = evaluate(
        dataset=dataset,
        metrics=[Faithfulness(llm=llm), LLMContextPrecisionWithoutReference(llm=llm)],
        show_progress=True,
    )
    df = result.to_pandas()
    scores: dict[str, float] = {}
    for col in df.columns:
        if col in ("user_input", "response", "retrieved_contexts", "reference"):
            continue
        series = df[col].dropna()
        if len(series):
            scores[col] = float(series.mean())

    # We had real samples to judge (unlike the `if not samples` early return above), but
    # NOT ONE of them produced a score across EITHER metric — with max_retries=4 per call,
    # that isn't noise, it's the judge endpoint itself unreachable (the same daily-quota
    # exhaustion /ask already signals via a 503 -> QuotaExhausted). Surface it the same way
    # so run_evals.py treats "RAGAS couldn't run" as inconclusive, not as a real 0.000 score
    # against the fail_under threshold.
    if not scores:
        raise QuotaExhausted(
            f"RAGAS judge produced zero scores across {len(samples)} samples "
            "(every judge call failed — likely the LLM endpoint's daily quota)"
        )
    return scores

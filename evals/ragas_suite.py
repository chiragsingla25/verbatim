"""RAGAS over the pre-fetched /ask responses for the answerable golden cases — nightly only
(heavy deps). No /ask calls here; run_evals owns those. Uses the same OpenAI-compatible
endpoint as the app (OpenRouter) as the judge LLM.

Metrics kept small to limit judge calls:
  - faithfulness              : is every claim in the answer grounded in the retrieved context?
  - LLMContextPrecisionWithoutReference : are the retrieved chunks relevant to the question?
"""

from __future__ import annotations

import os

from common import AskResponse, GoldenCase


def _judge_llm():
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    return LangchainLLMWrapper(ChatOpenAI(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        model=os.environ["LLM_MODEL"],
        temperature=0,
        timeout=120,
        max_retries=4,
    ))


def _contexts(resp: AskResponse) -> list[str]:
    # The pipeline returns citation quotes, not full chunks — enough signal for
    # faithfulness / precision. Fall back to a placeholder so RAGAS can still score.
    quotes = [c.get("quote", "") for c in resp.citations if c.get("quote")]
    return quotes or ["(no context returned)"]


def run_ragas(cases: list[GoldenCase], responses: dict[str, AskResponse]) -> dict[str, float]:
    from ragas import EvaluationDataset, evaluate
    from ragas.metrics import Faithfulness, LLMContextPrecisionWithoutReference

    samples = []
    for c in cases:
        if c.should_abstain:
            continue
        resp = responses.get(c.id)
        if resp is None:
            continue
        samples.append({
            "user_input": c.question,
            "response": resp.answer if not resp.abstained else "(abstained)",
            "retrieved_contexts": _contexts(resp),
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
    return scores

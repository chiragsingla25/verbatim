"""RAGAS over the pre-fetched /ask responses for the answerable golden cases — nightly only
(heavy deps). No /ask calls here; run_evals owns those. Uses the same OpenAI-compatible
endpoint as the app (OpenRouter) as the judge LLM.

Metrics kept small to limit judge calls:
  - faithfulness              : is every claim in the answer grounded in the retrieved context?
  - LLMContextPrecisionWithoutReference : are the retrieved chunks relevant to the question?
"""

from __future__ import annotations

import os

from common import AskResponse, Config, GoldenCase, fetch_chunk_contents


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
    return scores

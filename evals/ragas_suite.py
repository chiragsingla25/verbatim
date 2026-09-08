"""RAGAS metrics for the answerable golden cases — nightly only (heavy deps + many LLM
calls). Uses the same OpenAI-compatible endpoint as the app (Groq now) as the judge LLM.

Metrics kept deliberately small to stay inside free-tier rate limits:
  - faithfulness             : is every claim in the answer grounded in the retrieved chunks?
  - context precision (no-ref): are the retrieved chunks actually relevant to the question?

answer_relevancy is skipped (needs an embeddings model + extra calls); the abstention /
expected-substring checks in abstention.py already cover "did it answer the right thing".
"""

from __future__ import annotations

import os

from common import Config, GoldenCase, call_ask


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


def run_ragas(cfg: Config, cases: list[GoldenCase]) -> dict[str, float]:
    from ragas import EvaluationDataset, evaluate
    from ragas.metrics import Faithfulness, LLMContextPrecisionWithoutReference

    answerable = [c for c in cases if not c.should_abstain]
    samples = []
    for c in answerable:
        resp = call_ask(cfg, c.version_id, c.question)
        if resp.abstained:
            # a wrongly-abstained answerable case: RAGAS can't score an empty answer;
            # record it as a 0 by injecting a stub the metrics will fail.
            samples.append({
                "user_input": c.question,
                "response": "(abstained)",
                "retrieved_contexts": [x.get("quote", "") for x in resp.citations] or ["(none)"],
            })
            continue
        contexts = _contexts_for(cfg, c, resp)
        samples.append({
            "user_input": c.question,
            "response": resp.answer,
            "retrieved_contexts": contexts,
        })

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


def _contexts_for(cfg: Config, c: GoldenCase, resp) -> list[str]:
    # The pipeline returns citation quotes, not full chunks. For faithfulness/precision that
    # is enough signal; fall back to the quote list.
    quotes = [x.get("quote", "") for x in resp.citations if x.get("quote")]
    return quotes or ["(no context returned)"]

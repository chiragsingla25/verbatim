"""Verbatim ingestion package.

Runs in GitHub Actions (``.github/workflows/ingest.yml``) on a ``repository_dispatch``
of type ``ingest``. Pipeline: download the source PDF from the ``manuals`` Storage
bucket (service role) -> validate (magic bytes + not encrypted) -> Docling parse ->
layout-aware chunk (tables kept whole) -> ``thenlper/gte-small`` embed (float32) ->
insert ``document_chunks`` -> advance the ``ingest_jobs`` row to ``review``.

Logic is promoted from ``notebooks/mvp.ipynb`` (cells 2-4). The parent
``manual_versions`` row stays ``pending`` throughout -- publish is a human step (1f).
"""

__all__ = ["parse", "chunk", "embed", "run"]

"""Embeddings: ``thenlper/gte-small`` (384-dim), the SAME model as the query side.

Promoted from ``notebooks/mvp.ipynb`` cell 4. ``normalize_embeddings=True`` so cosine
== dot and the vectors line up with pgvector's ``<=>`` operator / Supabase's built-in
``gte-small`` at query time. Changing this model means re-embedding the whole corpus.

**Phase 0 deviation #3 fix:** ``sentence-transformers`` emits float16 on this hardware;
pgvector stores it without complaint but we cast to float32 before returning for
determinism and headroom.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer

EMBED_MODEL_ID = "thenlper/gte-small"
EMBED_DIM = 384

_model: Optional[SentenceTransformer] = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBED_MODEL_ID)
    return _model


def embed_texts(texts: list[str], batch_size: int = 32) -> np.ndarray:
    """Return an ``(len(texts), 384)`` float32 array of L2-normalised embeddings."""
    if not texts:
        return np.empty((0, EMBED_DIM), dtype=np.float32)
    vectors = _get_model().encode(
        texts,
        normalize_embeddings=True,
        batch_size=batch_size,
        show_progress_bar=False,
    )
    vectors = np.asarray(vectors, dtype=np.float32)  # deviation #3: float16 -> float32
    if vectors.shape[1] != EMBED_DIM:
        raise ValueError(f"expected {EMBED_DIM}-dim embeddings, got {vectors.shape[1]}")
    return vectors

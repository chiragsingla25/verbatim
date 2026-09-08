"""Layout-aware chunking with Docling's ``HybridChunker`` (tables kept whole).

Promoted from ``notebooks/mvp.ipynb`` cell 3. Tokenizer ``thenlper/gte-small``,
``max_tokens=512``, ``merge_peers=True`` -- same budget as the embedder's context.

**Phase 0 deviation #2 fix:** a chunk's ``page`` is its FIRST/DOMINANT body item's
``prov.page_no`` -- never ``min()`` across all merged items' pages. ``HybridChunker``
can merge a trailing paragraph on page N with a table that starts on page N+1; taking
the min mis-attributes the citation (and the norm/cutoff table it points at) to the
earlier page. Rule: if the chunk contains a table, the table is the dominant item --
use its page (this is exactly Docling's ``table.prov.page_no``, which Phase 0 found
correct); otherwise use the first body item that carries provenance.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional, TypedDict

from docling.chunking import HybridChunker
from transformers import AutoTokenizer

TOKENIZER_ID = "thenlper/gte-small"
MAX_TOKENS = 512


class ChunkRecord(TypedDict):
    page: Optional[int]
    section: Optional[str]
    content: str
    table_ref: Optional[str]
    ocr_confidence: Optional[float]


def _is_table_item(item: Any) -> bool:
    self_ref = getattr(item, "self_ref", "") or ""
    label = str(getattr(item, "label", "")).lower()
    return "/tables/" in self_ref or label == "table"


def _item_page(item: Any) -> Optional[int]:
    prov = getattr(item, "prov", None) or []
    return int(prov[0].page_no) if prov else None


def _dominant_page(doc_items: list[Any]) -> Optional[int]:
    """The chunk's anchor page. Table chunks -> the first table item's page (Docling's
    ``table.prov.page_no``). Otherwise the first body item that carries provenance.
    Never ``min()`` across all merged items."""
    for item in doc_items:
        if _is_table_item(item):
            page = _item_page(item)
            if page is not None:
                return page
    for item in doc_items:
        page = _item_page(item)
        if page is not None:
            return page
    return None


def _table_ref(doc_items: list[Any]) -> Optional[str]:
    """Non-null when the chunk is / contains a table: the first table item's
    Docling ``self_ref`` (e.g. ``#/tables/0``), else ``None``."""
    for idx, item in enumerate(doc_items):
        if _is_table_item(item):
            return (getattr(item, "self_ref", "") or "") or f"table:{idx}"
    return None


def chunk_document(
    document: Any,
    page_confidence: Optional[dict[int, float]] = None,
) -> Iterator[ChunkRecord]:
    """Yield one :class:`ChunkRecord` per Docling hybrid chunk, in document order."""
    page_confidence = page_confidence or {}
    tokenizer = AutoTokenizer.from_pretrained(TOKENIZER_ID)
    chunker = HybridChunker(tokenizer=tokenizer, max_tokens=MAX_TOKENS, merge_peers=True)

    for chunk in chunker.chunk(document):
        doc_items = list(chunk.meta.doc_items)
        page = _dominant_page(doc_items)
        headings = getattr(chunk.meta, "headings", None) or []
        yield ChunkRecord(
            page=page,
            section=" > ".join(headings) or None,
            # heading-prefixed text -- exactly what gets embedded (matches the notebook)
            content=chunker.contextualize(chunk=chunk),
            table_ref=_table_ref(doc_items),
            ocr_confidence=page_confidence.get(page) if page is not None else None,
        )

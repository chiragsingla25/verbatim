"""Docling parse: a PDF path -> a ``DoclingDocument`` plus the bits ``run.py`` needs.

Promoted from ``notebooks/mvp.ipynb`` cell 2. Keep this thin -- the ``DoclingDocument``
itself already exposes ``.texts`` and ``.tables``; this module just runs the converter
once and pulls out the page count, table count, and per-page confidence scores (used to
derive each chunk's ``ocr_confidence`` downstream).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from docling.document_converter import DocumentConverter


@dataclass
class ParseResult:
    """What the rest of the pipeline consumes from a parse."""

    document: Any  # docling_core.types.doc.DoclingDocument
    page_count: int
    num_tables: int
    # page_no (1-based) -> confidence in [0, 1]; empty when Docling reports none.
    page_confidence: dict[int, float]

    @property
    def tables(self) -> list[Any]:
        return list(self.document.tables)

    @property
    def texts(self) -> list[Any]:
        return list(self.document.texts)


def _page_confidence(result: Any) -> dict[int, float]:
    """Per-page confidence: OCR score when present, else the page's mean quality score.

    Digital PDFs report ``ocr_score = nan`` (no OCR ran), so we fall back to
    ``mean_score`` -- a parse/layout quality proxy in the same 0-1 range. Missing or
    NaN on both -> the page is simply omitted (chunk gets ``ocr_confidence = None``).
    """
    report = getattr(result, "confidence", None)
    if report is None:
        return {}
    pages = getattr(report, "pages", None) or {}
    out: dict[int, float] = {}
    for page_no, scores in pages.items():
        value = getattr(scores, "ocr_score", None)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            value = getattr(scores, "mean_score", None)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            continue
        out[int(page_no)] = float(value)
    return out


def parse_pdf(pdf_path: str | Path) -> ParseResult:
    """Convert ``pdf_path`` with Docling. Raises on an unreadable / unconvertible file."""
    converter = DocumentConverter()
    result = converter.convert(str(pdf_path))
    document = result.document
    return ParseResult(
        document=document,
        page_count=document.num_pages(),
        num_tables=len(document.tables),
        page_confidence=_page_confidence(result),
    )

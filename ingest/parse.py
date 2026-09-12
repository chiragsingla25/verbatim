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

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

# RapidOcrOptions' own default OCR language is Chinese ("lang": ["chinese"]) — verified
# against the pinned docling==2.126.0 package directly, not assumed. Every manual in this
# corpus is English. Running an English page through a Chinese-trained recognition model
# is a very plausible explanation for exactly the symptom observed in production: a 247-
# page manual logged "RapidOCR returned empty result!" 8 times over 25 minutes before the
# ingest watchdog killed the job — the pass wasn't necessarily slow because the page needed
# OCR and got it wrong, it may have been OCR'd with the wrong language model entirely and
# come back with nothing to show for it. (`force_full_page_ocr` — the first fix attempted
# here — turned out to be a no-op: it's deprecated in this version AND already defaults to
# False, i.e. bitmap-region-only OCR, not full-page. Left out rather than kept as dead
# configuration.) Table-structure recognition is left at its accurate default
# (do_cell_matching=True) — that's the actual reason this project uses Docling over a
# lighter text-only extractor (norm/cutoff tables are the highest-value content), so it's
# not a place to trade accuracy for speed. Docling doesn't (yet) support skipping OCR only
# on pages that already have a usable text layer — open upstream request:
# https://github.com/docling-project/docling/issues/3464.
_PIPELINE_OPTIONS = PdfPipelineOptions()
_PIPELINE_OPTIONS.do_ocr = True
_PIPELINE_OPTIONS.do_table_structure = True
_PIPELINE_OPTIONS.table_structure_options.do_cell_matching = True
_PIPELINE_OPTIONS.ocr_options = RapidOcrOptions(lang=["en"])


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
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=_PIPELINE_OPTIONS)}
    )
    result = converter.convert(str(pdf_path))
    document = result.document
    return ParseResult(
        document=document,
        page_count=document.num_pages(),
        num_tables=len(document.tables),
        page_confidence=_page_confidence(result),
    )

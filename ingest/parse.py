"""Docling parse: a PDF path -> a ``DoclingDocument`` plus the bits ``run.py`` needs.

Promoted from ``notebooks/mvp.ipynb`` cell 2. Keep this thin -- the ``DoclingDocument``
itself already exposes ``.texts`` and ``.tables``; this module just runs the converter
once and pulls out the page count, table count, and per-page confidence scores (used to
derive each chunk's ``ocr_confidence`` downstream).
"""

from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

# Pages per Docling `convert(..., page_range=...)` call when batching (see parse_pdf).
# Small enough that a slow/OCR-heavy document logs progress every few minutes rather
# than going silent for the whole run; large enough that per-batch overhead (each call
# re-walks the PDF backend for its slice) stays negligible next to actual page work.
BATCH_SIZE = 10

# RapidOcrOptions' own default OCR language is Chinese ("lang": ["chinese"]) — verified
# against the pinned docling==2.126.0 package directly, not assumed. Every manual in this
# corpus is English. Running an English page through a Chinese-trained recognition model
# is a plausible explanation for a real production symptom: a 247-page manual logged
# "RapidOCR returned empty result!" 8 times over 25 minutes before the ingest watchdog
# killed the job. (`force_full_page_ocr` — the first fix attempted here — turned out to be
# a no-op: it's deprecated in this version AND already defaults to False. A second
# candidate, `bitmap_area_threshold`, doesn't exist anywhere in this package at all —
# grepped the installed source, not just the docs; the field/mechanism a web search
# surfaced for it doesn't match this actual library. Neither is in this config.)
#
# What actually governs which regions get OCR'd (read from base_ocr_model.py directly):
# OcrMode.DEFAULT already excludes any layout cluster that overlaps ONLY programmatic PDF
# text cells — a page that's mostly real digital text does NOT get blindly re-OCR'd. Only
# clusters with no embedded text at all, or a mix of text + a bitmap/shape, become OCR
# candidates. So "Docling ignores the text layer and OCRs everything" isn't what's
# happening; the remaining candidates are page REGIONS that plausibly still need OCR
# either way (a stamp, a scanned insert, a photocopied section). Table-structure
# recognition is left at its accurate default (do_cell_matching=True) — that's the actual
# reason this project uses Docling over a lighter text-only extractor (norm/cutoff tables
# are the highest-value content), so it's not a place to trade accuracy for speed.
#
# document_timeout is real (verified against the installed package, not the docs alone):
# Docling itself aborts a stuck/slow conversion and returns ConversionStatus.PARTIAL_SUCCESS
# rather than running forever — a genuine internal bound the external ingest watchdog (25
# min, hard-kills the whole process) can't provide, since a Python thread/process-based
# timeout can't cleanly interrupt Docling's own CPU-bound native OCR/inference calls.
# NOT ENABLED YET, deliberately: setting it (tried 600s here) reproducibly crashed at
# process teardown on this Mac — "libc++abi: terminating due to uncaught exception ...
# recursive_mutex lock failed" — every time, isolated by re-running the identical parse
# with document_timeout simply omitted, which then exits 0 cleanly. That crash signature is
# a known ONNX Runtime-on-macOS shutdown issue (seen in unrelated projects — ONNX Runtime's
# own repo, transformers.js), and this pipeline's OCR backend is onnxruntime. The actual
# ingestion runs on Linux (ubuntu-latest), which uses a different C++ runtime and shouldn't
# hit this — but that's inference, not verification, and no Docker/Linux env was available
# here to confirm it directly. Given a crash reproduced firsthand, shipping it on an
# unconfirmed guess isn't worth it — revisit with a real Linux test (e.g. a throwaway
# GitHub Actions dispatch against a small manual) before enabling.
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


def parse_pdf(pdf_path: str | Path, total_pages: Optional[int] = None) -> ParseResult:
    """Convert ``pdf_path`` with Docling. Raises on an unreadable / unconvertible file.

    ``total_pages`` (from ``run.py``'s cheap pypdf sniff, done before this is ever
    called) switches on batched conversion: Docling is called once per ``BATCH_SIZE``
    page slice via its own ``page_range`` param, logging progress after each batch
    (page range done, this batch's time, elapsed total) so a slow document is visible
    in the Actions log instead of going dark for the whole run — this was the actual
    ask that motivated batching, not just a nice-to-have. Verified for real against the
    pinned docling==2.126.0 before relying on it here (a scratch-venv test against
    ``data/manuals/audit.pdf``, non-contiguous batches merged): a page-ranged
    ``convert()`` call reports REAL absolute page numbers (batch pages 21-30 come back
    tagged page_no 21-30, not reset to 1-10) in both ``item.prov[0].page_no`` and
    ``confidence.pages`` — and ``DoclingDocument.add_document()`` (a real public method,
    not a workaround) preserves those page numbers and table associations correctly
    when folding one batch's document into another's. Without ``total_pages`` (e.g. a
    direct/local call), falls back to the original single-shot behavior unchanged.

    If ``document_timeout`` is ever enabled above, add back a check here BEFORE reading
    a result's ``.document`` — a timeout doesn't raise, it returns normally with
    ``ConversionStatus.PARTIAL_SUCCESS`` (``result.has_timeout_errors()``), and an
    incomplete clinical manual (missing pages, possibly a scoring table) must never be
    silently ingested as if it were complete."""
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=_PIPELINE_OPTIONS)}
    )

    if not total_pages or total_pages <= BATCH_SIZE:
        result = converter.convert(str(pdf_path))
        document = result.document
        return ParseResult(
            document=document,
            page_count=document.num_pages(),
            num_tables=len(document.tables),
            page_confidence=_page_confidence(result),
        )

    merged_document: Any = None
    merged_confidence: dict[int, float] = {}
    t_start = time.time()
    start = 1
    while start <= total_pages:
        end = min(start + BATCH_SIZE - 1, total_pages)
        t_batch = time.time()
        result = converter.convert(str(pdf_path), page_range=(start, end))
        merged_confidence.update(_page_confidence(result))
        if merged_document is None:
            merged_document = result.document
        else:
            merged_document.add_document(result.document)
        print(
            f"docling: pages {start}-{end} of {total_pages} done "
            f"({time.time() - t_batch:.1f}s this batch, "
            f"{time.time() - t_start:.1f}s elapsed)",
            file=sys.stderr,
            flush=True,
        )
        start = end + 1

    return ParseResult(
        document=merged_document,
        page_count=total_pages,  # NOT merged_document.num_pages() -- that only reflects
        # the first batch's slice; add_document() merges body content (text/tables),
        # not the whole-document page-count metadata. total_pages is the real, already-
        # verified count from run.py's pypdf sniff.
        num_tables=len(merged_document.tables),
        page_confidence=merged_confidence,
    )

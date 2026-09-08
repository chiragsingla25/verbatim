"""Ingestion orchestrator -- the entry point GitHub Actions calls.

    python -m ingest.run --job-id <uuid> --version-id <uuid> --object-path v/<version_id>/source.pdf

Order of operations (authoritative contract in specs/2026-09-07-verbatim.md, "Phase 1
sub-step delivery"):

  1. read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL from env
     (Actions secrets in CI; .env.local locally)
  2. ingest_jobs.state = 'parsing'
  3. download <object-path> from the 'manuals' bucket (service role)
  4. magic-bytes check (%PDF-) + encrypted check (pypdf). On failure:
     ingest_jobs.state = 'failed', error set, flags += "not_a_pdf" | "encrypted_pdf",
     exit non-zero.
  5. Docling parse -> chunk -> embed (gte-small, float32)
  6. insert document_chunks (parent manual_versions.status stays 'pending')
  7. manual_versions.page_count = Docling page count
  8. ingest_jobs: state = 'review', ocr_quality = mean chunk confidence (or null),
     flags += "no_tables_found" (0 tables) / "low_ocr" (ocr_quality < 0.8)
  9. any exception in 5-8 -> ingest_jobs.state = 'failed', error = repr(exc), re-raise.

Writes go straight to Postgres via psycopg with the service role (RLS bypassed --
legitimate for ingestion; document_chunks / ingest_jobs have no write policy by design).
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import httpx
import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from psycopg.types.json import Jsonb
from pypdf import PdfReader

from ingest.chunk import chunk_document
from ingest.embed import embed_texts
from ingest.parse import parse_pdf

BUCKET = "manuals"
LOW_OCR_THRESHOLD = 0.8


# ─────────────────────────────────────────────────────────────────────────────
# config
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Config:
    supabase_url: str
    service_role_key: str
    db_url: str


def load_config() -> Config:
    """Env first (CI Actions secrets); fall back to repo-root .env.local for local runs."""
    env_file = Path(__file__).resolve().parent.parent / ".env.local"
    if env_file.exists():
        load_dotenv(env_file, override=False)  # real env always wins

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    db_url = os.environ.get("SUPABASE_DB_URL")
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", url),
            ("SUPABASE_SERVICE_ROLE_KEY", key),
            ("SUPABASE_DB_URL", db_url),
        )
        if not value
    ]
    if missing:
        raise SystemExit(f"missing required env: {', '.join(missing)}")
    return Config(supabase_url=url.rstrip("/"), service_role_key=key, db_url=db_url)


# ─────────────────────────────────────────────────────────────────────────────
# ingest_jobs helpers
# ─────────────────────────────────────────────────────────────────────────────
def update_job(
    conn: psycopg.Connection,
    job_id: str,
    *,
    state: Optional[str] = None,
    ocr_quality: Optional[float] = None,
    error: Optional[str] = None,
    flags: Optional[Sequence[str]] = None,
) -> None:
    sets: list[str] = []
    vals: list[object] = []
    if state is not None:
        sets.append("state = %s")
        vals.append(state)
    if ocr_quality is not None:
        sets.append("ocr_quality = %s")
        vals.append(ocr_quality)
    if error is not None:
        sets.append("error = %s")
        vals.append(error)
    if flags is not None:
        sets.append("flags = %s")
        vals.append(Jsonb(list(flags)))
    sets.append("updated_at = now()")
    vals.append(job_id)
    conn.execute(f"update public.ingest_jobs set {', '.join(sets)} where id = %s", vals)


def fail_job(
    conn: psycopg.Connection, job_id: str, error: str, extra_flags: Sequence[str] = ()
) -> None:
    row = conn.execute(
        "select flags from public.ingest_jobs where id = %s", (job_id,)
    ).fetchone()
    existing = list(row[0]) if row and row[0] else []
    merged = list(dict.fromkeys([*existing, *extra_flags]))  # dedupe, keep order
    update_job(conn, job_id, state="failed", error=error[:4000], flags=merged)


# ─────────────────────────────────────────────────────────────────────────────
# storage
# ─────────────────────────────────────────────────────────────────────────────
def download_object(cfg: Config, object_path: str) -> bytes:
    url = f"{cfg.supabase_url}/storage/v1/object/{BUCKET}/{object_path.lstrip('/')}"
    resp = httpx.get(
        url,
        headers={
            "Authorization": f"Bearer {cfg.service_role_key}",
            "apikey": cfg.service_role_key,
        },
        timeout=60.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    return resp.content


# ─────────────────────────────────────────────────────────────────────────────
# db writes
# ─────────────────────────────────────────────────────────────────────────────
def insert_chunks(
    conn: psycopg.Connection, version_id: str, records: list, vectors
) -> int:
    with conn.cursor() as cur:
        cur.executemany(
            "insert into public.document_chunks "
            "(version_id, page, section, content, embedding, table_ref, ocr_confidence) "
            "values (%s, %s, %s, %s, %s, %s, %s)",
            [
                (
                    version_id,
                    rec["page"],
                    rec["section"],
                    rec["content"],
                    vectors[i],
                    rec["table_ref"],
                    rec["ocr_confidence"],
                )
                for i, rec in enumerate(records)
            ],
        )
    return len(records)


# ─────────────────────────────────────────────────────────────────────────────
# pipeline
# ─────────────────────────────────────────────────────────────────────────────
def run(job_id: str, version_id: str, object_path: str) -> None:
    cfg = load_config()

    with psycopg.connect(cfg.db_url, autocommit=True) as conn:
        register_vector(conn)

        # 2. parsing
        update_job(conn, job_id, state="parsing")

        # 3. download
        pdf_bytes = download_object(cfg, object_path)

        # 4. validate: magic bytes, then encryption
        if pdf_bytes[:5] != b"%PDF-":
            fail_job(conn, job_id, "not a PDF: missing %PDF- magic bytes", ["not_a_pdf"])
            sys.exit(1)
        try:
            encrypted = PdfReader(io.BytesIO(pdf_bytes)).is_encrypted
        except Exception as exc:  # unreadable / truncated PDF
            fail_job(conn, job_id, f"pypdf could not read the file: {exc!r}", ["not_a_pdf"])
            sys.exit(1)
        if encrypted:
            fail_job(conn, job_id, "encrypted PDF cannot be ingested", ["encrypted_pdf"])
            sys.exit(1)

        # 5-8. parse -> chunk -> embed -> insert -> job to review
        tmp_path: Optional[str] = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name

            parsed = parse_pdf(tmp_path)
            records = list(chunk_document(parsed.document, parsed.page_confidence))
            if not records:
                raise RuntimeError("chunker produced 0 chunks")

            vectors = embed_texts([r["content"] for r in records])
            # Idempotent re-ingest: clear any chunks from a previous run of this version
            # before inserting, so a re-upload of a still-pending version doesn't duplicate.
            conn.execute(
                "delete from public.document_chunks where version_id = %s", (version_id,)
            )
            insert_chunks(conn, version_id, records, vectors)

            # 7. page_count on the parent version (status stays 'pending')
            conn.execute(
                "update public.manual_versions set page_count = %s where id = %s",
                (parsed.page_count, version_id),
            )

            # 8. job -> review
            confidences = [
                r["ocr_confidence"] for r in records if r["ocr_confidence"] is not None
            ]
            ocr_quality = (
                float(sum(confidences) / len(confidences)) if confidences else None
            )
            flags: list[str] = []
            if parsed.num_tables == 0:
                flags.append("no_tables_found")
            if ocr_quality is not None and ocr_quality < LOW_OCR_THRESHOLD:
                flags.append("low_ocr")

            update_job(
                conn, job_id, state="review", ocr_quality=ocr_quality, flags=flags
            )
            print(
                f"ingest ok: version={version_id} chunks={len(records)} "
                f"pages={parsed.page_count} tables={parsed.num_tables} "
                f"ocr_quality={ocr_quality} flags={flags}"
            )
        except SystemExit:
            raise
        except Exception as exc:
            # 9. any failure in 5-8 -> failed + error, then re-raise (non-zero exit)
            fail_job(conn, job_id, repr(exc))
            raise
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass


def main(argv: Optional[Sequence[str]] = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m ingest.run")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--version-id", required=True)
    parser.add_argument("--object-path", required=True)
    args = parser.parse_args(argv)
    run(args.job_id, args.version_id, args.object_path)


if __name__ == "__main__":
    main()

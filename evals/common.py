"""Shared helpers for the eval suite: config, corpus manifest, golden cases, and a
thin client for the deployed /ask Edge Function.

The suite calls the *deployed* pipeline (not a local reimplementation) so it exercises
exactly what ships. It authenticates as a dedicated student user minted via the GoTrue
admin API.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv

EVALS_DIR = Path(__file__).resolve().parent
REPO = EVALS_DIR.parent
EVAL_USER_EMAIL = "chiragsingla25+eval@gmail.com"
EVAL_USER_PW = "verbatim-eval-fixed-12345"


@dataclass
class Config:
    supabase_url: str
    anon_key: str
    service_role_key: str

    @property
    def ask_url(self) -> str:
        return f"{self.supabase_url}/functions/v1/ask"


def load_config() -> Config:
    env_file = REPO / ".env.local"
    if env_file.exists():
        load_dotenv(env_file, override=False)
    url = os.environ.get("SUPABASE_URL")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_ANON_KEY", anon),
                              ("SUPABASE_SERVICE_ROLE_KEY", svc)) if not v]
    if missing:
        raise SystemExit(f"missing env: {', '.join(missing)}")
    return Config(supabase_url=url.rstrip("/"), anon_key=anon, service_role_key=svc)


def load_manifest() -> dict[str, dict]:
    data = json.loads((EVALS_DIR / "manifest.json").read_text())
    return data["versions"]


def slug_to_version_id() -> dict[str, str]:
    return {slug: v["versionId"] for slug, v in load_manifest().items()}


@dataclass
class GoldenCase:
    id: str
    version_slug: str
    version_id: str
    question: str
    should_abstain: bool
    expected_contains: list[str]
    expected_page: int | None
    rationale: str | None

    @property
    def is_cross_version_leak(self) -> bool:
        # A leak case asks something answerable only from a *different* manual/version.
        return self.should_abstain and ("leak" in self.id or "version" in (self.rationale or "").lower())


def load_golden() -> list[GoldenCase]:
    mapping = slug_to_version_id()
    cases: list[GoldenCase] = []
    for line in (EVALS_DIR / "golden_dataset.jsonl").read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        slug = r["version"]
        if slug not in mapping:
            raise SystemExit(f"golden case {r['id']}: unknown version slug {slug!r}")
        cases.append(GoldenCase(
            id=r["id"],
            version_slug=slug,
            version_id=mapping[slug],
            question=r["question"],
            should_abstain=bool(r.get("shouldAbstain", False)),
            expected_contains=list(r.get("expectedAnswerContains", [])),
            expected_page=r.get("expectedPage"),
            rationale=r.get("rationale"),
        ))
    return cases


# ── deployed /ask client ─────────────────────────────────────────────────────
_token_cache: dict[str, str] = {}


def _password_grant(cfg: Config) -> httpx.Response:
    return httpx.post(f"{cfg.supabase_url}/auth/v1/token", headers={"apikey": cfg.anon_key},
                      params={"grant_type": "password"},
                      json={"email": EVAL_USER_EMAIL, "password": EVAL_USER_PW}, timeout=30)


def eval_user_token(cfg: Config) -> str:
    if "t" in _token_cache:
        return _token_cache["t"]
    # Try to sign in first. Only touch the admin API if that fails — resetting the password
    # on every call invalidates sessions held by a concurrent eval run (local + CI).
    r = _password_grant(cfg)
    if r.status_code != 200:
        admin = {"apikey": cfg.service_role_key, "Authorization": f"Bearer {cfg.service_role_key}"}
        users = httpx.get(f"{cfg.supabase_url}/auth/v1/admin/users", headers=admin,
                          params={"per_page": 200}, timeout=30).json().get("users", [])
        uid = next((u["id"] for u in users if u["email"] == EVAL_USER_EMAIL), None)
        if uid is None:
            httpx.post(f"{cfg.supabase_url}/auth/v1/admin/users", headers=admin,
                       json={"email": EVAL_USER_EMAIL, "password": EVAL_USER_PW,
                             "email_confirm": True}, timeout=30).raise_for_status()
        else:
            httpx.put(f"{cfg.supabase_url}/auth/v1/admin/users/{uid}", headers=admin,
                      json={"password": EVAL_USER_PW}, timeout=30).raise_for_status()
        r = _password_grant(cfg)
    r.raise_for_status()
    _token_cache["t"] = r.json()["access_token"]
    return _token_cache["t"]


class QuotaExhausted(RuntimeError):
    """The deployed /ask is up but the LLM endpoint is out of daily quota (503). The eval
    suite can't run — this is distinct from an eval failure."""


class _Terminal(RuntimeError):
    """A non-retryable /ask failure (bad auth, bad request)."""


@dataclass
class AskResponse:
    answer: str
    abstained: bool
    citations: list[dict]
    retrieved: list[dict]
    latency_ms: int
    raw: dict


def call_ask(cfg: Config, version_id: str, question: str, *, retries: int = 3) -> AskResponse:
    token = eval_user_token(cfg)
    last: Exception | None = None
    for attempt in range(retries):
        t0 = time.time()
        try:
            r = httpx.post(cfg.ask_url, headers={
                "Authorization": f"Bearer {token}",
                "apikey": cfg.anon_key,
                "content-type": "application/json",
            }, json={"versionId": version_id, "question": question}, timeout=240)
            if r.status_code == 429:
                time.sleep(min(2 ** attempt * 10, 60))
                continue
            if r.status_code == 503:
                raise QuotaExhausted(f"/ask 503 (LLM out of quota): {r.text[:200]}")
            if r.status_code in (401, 403):
                raise _Terminal(
                    f"/ask {r.status_code}: {r.text[:200]} (url={cfg.ask_url})"
                )
            r.raise_for_status()
            d = r.json()
            return AskResponse(
                answer=d.get("answer", ""),
                abstained=bool(d.get("abstained")),
                citations=d.get("citations", []),
                retrieved=d.get("retrieved", []),
                latency_ms=int((time.time() - t0) * 1000),
                raw=d,
            )
        except (QuotaExhausted, _Terminal):
            raise  # not retryable
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(min(2 ** attempt * 5, 30))
    raise RuntimeError(f"/ask failed after {retries} attempts: {last!r}")

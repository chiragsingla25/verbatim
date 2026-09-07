# Verbatim

Version-scoped Q&A over psychological test-manual PDFs. Pick one manual **version**, ask a
question, get an answer quoted from *that version* with page citations — or an explicit
"not found in this version". Contributors upload and version manuals; anyone self-registers as a
student.

Grounded, not perfect: every answer is backed by retrieved passages from one version or it
abstains. Version isolation is enforced by Postgres row-level security, not application code.
Latency and top-tier accuracy are traded away in v1 — agentic retrieval comes later.

## Status

Scaffolded 2026-09-07. Not yet implemented — see the phased build plan.

- Decision doc: [`docs/proposal.md`](docs/proposal.md)
- Build contract: [`specs/2026-09-07-verbatim.md`](specs/2026-09-07-verbatim.md)
- Working context for Claude: [`CLAUDE.md`](CLAUDE.md)

## Stack — purely open source (models + code); free hosting substrate

| Layer | Choice |
|---|---|
| Frontend | Vite + React SPA on **GitHub Pages** (`<user>.github.io/verbatim/`) |
| Backend | **Supabase free tier** — Postgres + pgvector + Auth + Storage + Edge Functions |
| Vector store | pgvector **inside the same Postgres** — no separate vector DB |
| Server logic | Supabase Edge Functions — `/ask` pipeline, `/ingest-dispatch` webhook |
| PDF parsing | **Docling** (MIT) in a **GitHub Actions** workflow |
| Embeddings | **`gte-small`** (384-dim) — Supabase built-in at query time, `thenlper/gte-small` at ingest |
| Answer + verify | any OpenAI-compatible endpoint (OpenRouter free / Groq / local **Ollama**) |
| Evals | RAGAS + abstention + cross-version-leak, run in CI |

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill VITE_SUPABASE_* — never commit .env.local
pnpm dev
```

Server secrets (LLM key, service-role key) go in Supabase Edge Function secrets and GitHub Actions
secrets, not `.env.local`. The corpus is **public-domain instruments only** for v1.

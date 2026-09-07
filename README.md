# Verbatim

Version-scoped Q&A over psychological test-manual PDFs. Pick one manual **version**, ask a
question, get an answer quoted from *that version* with page citations — or an explicit
"not found in this version". Contributors upload and version manuals; anyone self-registers as a
student.

**Accuracy is the product.** Every answer is grounded in retrieved passages from one version, or it
abstains. Version isolation is enforced by Postgres row-level security, not application code.

## Status

Scaffolded 2026-09-07. Not yet implemented — see the phased build plan.

- Decision doc: [`docs/proposal.md`](docs/proposal.md)
- Build contract: [`specs/2026-09-07-verbatim.md`](specs/2026-09-07-verbatim.md)
- Working context for Claude: [`CLAUDE.md`](CLAUDE.md)

## Stack

Next.js (Vercel) · Supabase (Postgres + pgvector + Auth + RLS + Storage) · Docling parsing in a
Modal ingestion job · Gemini embeddings · hosted reranker · Gemini/Groq for answer + verify ·
RAGAS evals in CI.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in real values — never commit .env.local
pnpm dev
```

The corpus is **public-domain instruments only** for v1 (PHQ-9, GAD-7, PSS, IPIP, …).

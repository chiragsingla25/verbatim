# Verbatim — product review

*2026-09-10. A full walkthrough of the shipped app (v1.2 + the UX batch), what's missing,
how it compares to the market, and a ranked improvement roadmap. Companion to
`docs/backlog.md` — the backlog is the task list; this is the reasoning behind it.*

---

## 1. State of the app, screen by screen

| Area | State | Gaps |
|---|---|---|
| **Auth** (sign in / up, forgot / reset password) | Complete, solid — neutral account-enumeration, recovery-context gating (`HAD_RECOVERY_HASH`), "check your email" pattern | No "change password while signed in", no display name, no SSO (deliberate) |
| **Library** | A flat list: instrument · title · edition/year · license · status. Contributor sees own in-review uploads. | No search / filter / sort (backlogged); no manual **detail page** (you jump straight into Ask); no description / abstract / "what's in this manual"; page count + section list not surfaced |
| **Ask** | Conversational (v1.2): version-locked header, session persisted in `?s=`, follow-ups, meta questions, three response kinds (`grounded` / `abstained` / `meta`), citations with a highlighted source-page slide-over, resume from history, "Try again" on a failed turn | **No streaming** (static "Reading the manual…" for 5–15 s); no **cancel**; no **suggested questions**; no **answer export / copy-with-citation / share**; answers are **prose only — no rendered tables**; no "select text in the manual → ask about it" |
| **Citation viewer** (`SourceSlideOver`) | Renders the *cited page* with pdf.js, highlights the quoted span, graceful fallback when the span can't be pinpointed | Single page only — no prev / next, no **zoom**, no **search within the manual**, no "open the full PDF", no copy-the-quote |
| **My answers / History** | Conversation list, keyset-paginated; **search**, **rename**, **copy conversation**, resume, retired-manual note | **No delete** (`query_log` has no delete policy by design — needs a soft-delete flag on `chat_sessions`); no favorites / pins / tags; search covers only loaded pages; half-failed sessions (turn advanced, log failed) clutter the list |
| **Upload → Review → Publish** | Full lifecycle (v1.1.1): metadata + rights attestation → signed-URL upload → async Docling parse → review extracted tables / OCR / flags → publish / reject / retry / replace / delete; watchdog for wedged jobs | Delete is **pending-only** (a published manual can only be *archived*, and only from Admin); no server-side title / policy validation; parsing progress is a spinner, not a %; no email when a job wedges |
| **Admin** | Three tabs — Users (full role control incl. granting admin, self-lockout guard), Manuals (archive / republish / supersede / delete / review), Activity (audit feed) | No metrics (question volume, abstention rate, popular manuals, corpus headroom vs the 500 MB free tier); no per-user activity; can't edit a manual's metadata after publish |
| **Cross-cutting** | Responsive SPA, light / dark, stale-tab auto-reload, top-level error boundary | No **PWA / installable**; no keyboard shortcuts; no onboarding / first-run; no usage / quota indicator |

---

## 2. Market comparison

**Comparable products, by category**

- **Consumer "chat with PDF"** — ChatPDF, PDF.ai, AskYourPDF, Humata, ChatDOC
- **Research assistants** — Google NotebookLM, Claude Projects, ChatGPT Projects / files, SciSpace, Elicit
- **Enterprise knowledge QA** — Glean, Hebbia, Guru, Dashworks
- **Domain-specialised grounded QA** — OpenEvidence / UpToDate (medical), Harvey / CoCounsel (legal), Perplexity (citation-first UX)

Verbatim's actual niche — *version-scoped Q&A over psychological test-manual PDFs for a
clinical-training program* — is narrow enough that no single product is a direct competitor.
The closest analogue is "chat with your uploaded PDF" **plus edition isolation plus
abstention discipline**.

### What Verbatim already does better than the market

| Differentiator | Why it matters | Who else does it |
|---|---|---|
| **Version / edition isolation** — every answer scoped to one locked manual version | A blended "PHQ-9 vs PHQ-9 (modified)" cutoff is a clinical error. No consumer tool does this. | ~Nobody |
| **Explicit abstention** ("not found in this version") | ChatPDF / Humata / ChatDOC confabulate a plausible cutoff rather than say "I don't know". Verbatim refuses. | Perplexity partially; some legal tools |
| **Independent verify pass** (2nd LLM checks every claim against the retrieved chunks) | More rigorous grounding than any consumer tool | Some enterprise tools |
| **Provenance** — upload rights-attestation + an audit log of who published what | Matters for a shared program corpus | Enterprise tools only |
| **$0 / all-OSS / self-hostable**, LLM endpoint one env var from local Ollama | No competitor offers this | ~Nobody |

### What the market has that Verbatim is missing (ranked by fit)

1. **Rendered tables in answers.** Norm tables, cutoff bands, RCI / SEM tables *are* the
   content clinicians look up. ChatDOC and Humata return structured tables; Verbatim keeps
   tables whole in chunks but the answer step flattens them to prose. Biggest content gap
   for the stated persona.
2. **Streaming responses.** Every comparable tool streams. On a 5–15 s model a static
   spinner reads as broken. Token streaming transforms perceived speed at zero accuracy cost.
3. **Full-document navigation in the citation viewer.** NotebookLM / ChatDOC let you click a
   citation and *land in the doc*, then scroll / zoom / search. Verbatim shows one frozen
   page.
4. **Search *within* a manual** — a plain ctrl-F over the manual text, not just semantic QA.
   Trivial with the chunks already in Postgres.
5. **Suggested / starter questions** per manual on the empty state. The difference between
   "I don't know what to ask" and engagement.
6. **Answer export / copy-with-citation / shareable link.** Clinicians paste a cited answer
   into case notes or a supervision discussion. NotebookLM has share; legal tools have
   citation export. Verbatim has neither (the new "copy conversation" is a start).
7. **Cross-edition questions** — "how does the PHQ-9 cutoff differ between these two
   editions?" Verbatim *deliberately* forbids this (version lock), but for the "editions that
   quietly disagree" problem in the proposal, a **read-only comparison view** (two locked
   panes, no blending) is the highest-value latent feature.
8. **Per-answer feedback + correction loop** (👍 / 👎, "this is wrong"). Already planned
   (backlog B11). For a product whose whole pitch is accuracy, having no signal for *whether
   it's accurate in the wild* is the biggest process gap.
9. **PWA / installable + cached shell.** Clinicians on ward wifi; an installable icon and an
   offline-ish shell would help adoption.
10. **Usage transparency** — "you've asked 12 questions today", and for admins a dashboard
    (volume, abstention rate, top manuals, corpus headroom).

### What Verbatim should deliberately not copy

Audio overviews (NotebookLM), agentic multi-step research, web-search fallback, workspaces /
real-time collab, image generation, "summarize the internet". These pull the tool away from
*"look up a fact in a manual, safely"* — which is the whole point and the reason to trust it.

---

## 3. Recommended roadmap

### Tier 1 — accuracy & trust (the core mission)

| Item | Note |
|---|---|
| **Document facts block** | In flight (`specs/2026-09-11-verbatim-accuracy-mvp.md`) — metadata questions stop abstaining. |
| **Render tables in answers** | When a cited chunk is a table (`document_chunks.table_ref` set), carry it through as Markdown and render a real table in the answer card. Highest content ROI. |
| **Per-answer feedback + correction** (B11) | `feedback` table, 👍/👎 + optional note; a weekly job turns 👎 into candidate golden cases. This is how the "high accuracy" claim gets *earned* over time. Its own small spec. |
| **Citation viewer v2** | Full-doc scroll, zoom, prev / next, "search this manual". |

### Tier 2 — usefulness

| Item | Note |
|---|---|
| **Streaming** | Token-by-token answer render. |
| **Starter questions** per manual | Author 3–5 per instrument, or derive from the outline once ingest-v2 lands. |
| **Export a cited answer** | "Copy with citation" per answer (text + `Manual · p.N` + quote); a read-only shareable answer link. |
| **Cross-edition compare** | Two-pane read-only view; each pane is a normal locked Ask; no blending, no new retrieval risk. |

### Tier 3 — polish & retention

Delete a conversation (B4) · account / settings page (B8) · first-run onboarding · PWA
manifest + service worker · admin metrics dashboard · streaming / `k` tuning.

### Delivery

Tier 1's *tables* + *citation viewer v2*, plus all of Tier 2, are a coherent **"v1.3 —
usefulness"** addendum for app-architect once the accuracy-mvp ships. *Feedback* (B11) is its
own small spec. Tier 3 is opportunistic. None of this changes the architecture — RAG, single
retriever, deterministic — it's UI + one small table.

# Approving a new manual — contributor guide

**Verbatim** — version-scoped Q&A over psychological test-manual PDFs.
App: https://chiragsingla25.github.io/verbatim/

This guide covers **reviewing and publishing** a manual that has been uploaded. Uploading a
manual is a separate step; this picks up once a manual version exists and is waiting for review.

---

## Who can do this

Only a **contributor** or **admin** account. New sign-ups are *students* (read and ask only);
an administrator grants contributor access. If `/upload` or a review page shows
**"Not available"**, your account is not a contributor yet.

## Before you start

Someone has uploaded a manual. Its version shows status **`pending`** and an ingestion job is
running (Docling parses the PDF, extracts tables, and builds the search index). A warm run
takes 2–4 minutes; the first run after a while re-downloads the parser models and can take
10–15. The review screen shows elapsed time and links to the running job. If a job runs far
past that, it is failed automatically and you re-upload.

---

## Step 1 — Open the review screen

1. Sign in at **https://chiragsingla25.github.io/verbatim/**.
2. Go to **Manual library** (the default screen).
3. Find the pending version:
   - If **you** uploaded it, it appears under **"Your uploads in progress"** with a
     **`pending · Review →`** link.
   - Otherwise (an admin, or another contributor's upload) open it directly at
     `…/verbatim/review/<version-id>`.

## Step 2 — Wait for ingestion to finish

The review screen refreshes itself while parsing. It is ready to review when the **Ingestion**
pill reads **`review`**.

| Pill says | Meaning |
|---|---|
| `queued` / `parsing` | Still working — wait, the page updates on its own. |
| **`review`** | Ready. Proceed to Step 3. |
| `failed` | Parsing failed — the error is shown. Usually the PDF is encrypted or not a real PDF. Fix the file and re-upload; there is nothing to approve. |

## Step 3 — Check the extraction against the source

This is the important part. **A wrong number in a norm or cut-off table becomes a wrong
answer** for every student who asks about it.

1. **OCR quality** — shown as a percentage. Higher is better. A **`low_ocr`** flag (below 80%)
   means scanned or poor-quality pages — spot-check those closely.
2. **Flags** — investigate any of:
   - `encrypted_pdf` — the file is protected; it cannot be indexed.
   - `no_tables_found` — no tables detected. For a manual with norm / cut-off tables, that is
     suspicious — check the source.
   - `low_ocr` — see above.
3. **Extracted tables** — the screen lists every table block the parser found. Click
   **"Open the source PDF ↗"** (and the per-table *"view page in source ↗"* links) and compare
   each extracted block to the actual page:
   - Norm tables — every mean / SD / percentile cell.
   - Score cut-offs and severity / classification bands.
   - Row and column labels line up with the source.

If anything is wrong, **Reject** (Step 4) and ask the uploader to fix and re-upload — you
cannot edit cells in v1.

## Step 4 — Decide

- **Approve & publish version** →
  - the version flips to **`active`**;
  - it appears in every user's library and in the Ask version list **immediately**;
  - students can ask questions against it right away;
  - an entry is written to the audit log under **your** identity.
- **Reject upload** →
  - you are prompted for a reason (optional);
  - the version is marked **`rejected`** and stays unpublished.

---

## After publishing

- The manual is live for everyone. No further action is needed.
- **There is no un-publish or archive in v1.** To correct a published manual, upload a **new
  version** of it — the old one stays for the audit trail.
- **One PDF per version.** A different edition, printing, or corrected scan is a new version,
  uploaded separately.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Job stuck in `parsing` for more than ~5 minutes | The ingestion GitHub Action may have failed. Check the repo's **Actions → ingest** run. Re-uploading the PDF re-triggers it. |
| No **`Review →`** link on a pending version | You are neither the uploader nor an admin. Ask the uploader or an admin to review it. |
| **"Not available"** on `/upload` or `/review` | Your account is a *student*. An administrator must promote it to *contributor*. |
| `failed` with "encrypted" or "not a PDF" | The source file is protected or corrupt. Get an unprotected PDF and re-upload. |

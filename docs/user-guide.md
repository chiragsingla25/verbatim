# How to use Verbatim — user guide

**Verbatim** — version-scoped Q&A over psychological test-manual PDFs.
App: https://chiragsingla25.github.io/verbatim/

Verbatim answers questions about a psychological test manual using **only that one manual
version**, and shows you the page it came from. If the manual doesn't say, it tells you
"not found in this version" — it never guesses and never uses the open web.

---

## 1. Create an account and sign in

1. Open **https://chiragsingla25.github.io/verbatim/**.
2. Choose **Create account**. Everyone starts as a **student** — read and ask.
3. Open the confirmation link Verbatim emails you (check spam if it doesn't arrive in a minute).
4. Come back and **Sign in**.

### What each role can do

| Role | Can do |
|---|---|
| **Student** | Pick a manual version, ask questions, read answers with citations, see their own history. This is every new account. |
| **Contributor** | Everything a student can, plus upload new manuals and review/publish them. An admin grants this. |
| **Admin** | Everything, plus the **Admin** console: manage roles, archive / re-publish / supersede manuals, read the activity log. |

If **Upload manual** or **Admin** shows "Not available", your account doesn't have that role yet —
ask an administrator.

---

## 2. Ask a question

**Step 1 — Pick a manual version.** The **Manual library** is the default screen. Each row is one
version of one instrument (edition and year matter). Click **Ask →**.

**Step 2 — You are locked to that version.** The header shows **ANSWERING FROM** with the manual
name. Every answer in this session comes only from that version — there is no cross-edition
blending, by design.

**Step 3 — Type your question** in the box at the bottom and send it. You'll see
"Reading the manual…" while it works (usually 5–15 seconds).

**Step 4 — Read the answer.** A grounded answer has:

- a short answer paragraph, then a **verbatim quote** from the manual;
- **citation chips** like `[1] p.20` — click one to open the **source page** beside the answer,
  with the quoted passage highlighted;
- a **"Verified against source"** line — the answer passed a second automatic check that every
  claim traces to a retrieved passage from this version.

**Step 5 — "Not found in this version."** This means the manual genuinely doesn't contain the
answer. It is a deliberate, correct response — not an error. Verbatim would rather say nothing
than guess.

**Superseded editions.** If a newer version of the same manual has been published, a
**"Superseded by … →"** link appears in the header. The current version still works; the link
just points you to the newer one.

---

## 3. Write good questions

Verbatim is at its best with **specific, factual questions the manual actually answers**:

- cut-off / threshold scores and severity bands ("What PHQ-9 score indicates moderately severe
  depression?");
- norm-table values — means, SDs, percentiles for a stated group;
- administration and scoring rules, time to administer;
- reliability / validity figures (Cronbach's alpha, sensitivity, specificity).

Tips:

- **Name the term the way the manual does.** "hazardous drinking cut-off", not "the risky number".
- **One question at a time.** Ask a follow-up as its own question.
- **Pick the right edition first.** A value from the 1st edition won't be found if you're asking
  the 2nd.

It deliberately **won't**: give clinical or treatment advice, interpret a particular client's
scores, compare two manuals or editions, or answer anything not written in the version you chose.

---

## 4. My answers (history)

**My answers** in the sidebar lists every question you've asked, newest first.

- **Filter by manual** with the dropdown; **Load more** pages back through older questions.
- **Click a row** to reopen the exact answer as it was first given — same wording, same
  citations, no new lookup.
- **"Re-ask this against the current version →"** runs the question again from scratch against the
  same manual version. It appears only when that version still exists and is active.
- Your history is **private to you**. No one else — not even an admin — sees it on this screen.

---

## 5. For contributors — adding a manual

1. **+ Upload manual** from the library.
2. Enter the instrument name, the version's title / edition / year, the licence class, and tick
   the attestation that you have the right to store the file.
3. Upload the PDF. Parsing (text, tables, search index) takes about **2–3 minutes**.
4. The version sits at **pending** until a contributor or admin reviews the extracted tables
   against the source and **publishes** it. Full steps are in
   **`approve-manual-guide.pdf`**.

v1 corpus is **public-domain instruments only** (PHQ-9, GAD-7, PSS, AUDIT, IPIP scales, and the
like). No commercial or restricted manuals.

---

## 6. For admins — the console

Open **Admin** in the sidebar (`/admin`). Three tabs:

- **Users** — everyone who has signed up, with a role dropdown per person
  (student / contributor / admin). A role change takes effect on that person's next page load.
  **You cannot change your own role** (self-lockout protection).
- **Manuals** — every version and its status. **Archive** takes an active version offline;
  **Re-publish** brings it back. The **Supersedes** dropdown links an older version of the same
  instrument to this one.
- **Activity** — a read-only feed of role changes, publishes, rejections, archives, and
  supersede links, newest first, with who did each.

**Archiving** a version removes it from students immediately — it drops out of the library, can't
be asked against, and its source PDF stops being downloadable. Students' existing **history**
entries for it still render. Archiving is fully reversible with **Re-publish**.

---

## 7. Limits and safety

- Answers are **decision support, not clinical judgement**. Always verify against the source
  before clinical use — every answer links the page so you can.
- Each answer is **scoped to one version**. Editions are never blended.
- v1 has **no score calculators, no edition comparison, and no open-web knowledge** — those are
  out of scope on purpose.
- A slow answer or an over-cautious "not found" is acceptable; a wrong number is not. If an
  answer looks wrong, open the cited page and check.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Not available" on **Upload manual** or **Admin** | Your account doesn't have that role. Ask an administrator to promote it. |
| Answer says "not found" but you're sure it's in the manual | Check you picked the right **edition**; phrase the term as the manual does; it may be in a table that didn't extract cleanly — tell an admin so it can be re-reviewed. |
| The source page won't render ("Couldn't render the source page") | Usually a very old browser. Update to a current Chrome / Firefox / Safari and hard-refresh. |
| No confirmation email after Create account | Check spam. If it's still missing after a few minutes, try Create account again with the same address. |
| A manual you used has disappeared | It was probably **archived** or **superseded**. Your **My answers** history still shows the answers you already got from it. |
| You're asked to sign in again mid-session | Your session expired. Sign in again; your history is unaffected. |

---

*Pilot deployment — public-domain instruments only. Questions and manual requests go to the
project owner.*

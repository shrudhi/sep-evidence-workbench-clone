# Submission checklist — LexNorm

## Included in this repo

| Deliverable | Location |
|---|---|
| One-page PRD | [`docs/PRD.md`](PRD.md) |
| One-page user flow (+ 2 failure branches) | [`docs/USER_FLOW.md`](USER_FLOW.md) |
| Eval failure modes + production plan | [`docs/EVAL_FAILURE_MODES.md`](EVAL_FAILURE_MODES.md) |
| Deliverable 4 half-page + workbook | [`submission/Deliverable4_SUMMARY.md`](../submission/Deliverable4_SUMMARY.md) · [`submission/Deliverable4_Evaluation.xlsx`](../submission/Deliverable4_Evaluation.xlsx) |
| Working prototype | this workbench (`README.md` run steps) |
| Expected chart / gold pack | `evaluation_data/Expected_Claim1_Reference_Pack/` |
| Loom / video script (by screen) | [below](#loom--video-script--5-min) |

## Live demo artifacts (local run `a4d4d0c4-…`)

- Chart: H.265 V10 Claim 1, status `complete` after Accept-all
- Challenge: 1[a] remapped to revision `7964c100-…`
- Word: draft + final DOCX via SEP Report / `/api/runs/{id}/export`
- Trace: `submission/run_trace.json` (+ `/api/runs/{id}/trace`)
- Eval pack: C01–C05 **3/3 Pass**; C06 **0/3 Fail** on fine-split (locked workbook) — product now ships fine-split Pass policy for re-runs

## Still for you to publish

1. **Public repo / hosted demo URL** (GitHub + optional Railway/Fly/Render)
2. **&lt;5 min Loom/video** — follow the script below
3. Paste public links into the recruiter form

---

## Loom / video script (~5 min)

Record desktop at 1080p. Speak calmly; show the mouse. Product name on screen: **LexNorm**.

### 0:00–0:20 · Open & framing

- Show Matter **Setup** with LexNorm shell.
- Say: “LexNorm charts Claim 1 of US10063856B2 against three indexed standards. Path A: select → confirm → map → AI Review → Accept/Reject → SEP Report export. Evaluation is internal.”

### 0:20–1:10 · Setup — patent + recommend

1. **Patent** — Select Existing US10063856B2; briefly open Preview / claims (Claim 1).
2. Optional flash: **Upload PDF** — say SHA-256 match binds prepared claims; other PDFs are retained without invented claim text.
3. **Candidate standards** — G.722.2, H.265 V10, TS 136 211 checked (all indexed).
4. Click **Recommend Standard**.
5. Show AI recommendation: **H.265 recommended**, G.722.2 + TS rejected with short reasons / proofs.
6. Confirm H.265 → **Start Chart Preparation**.

### 1:10–2:20 · Claim charts — evidence integrity

1. Open **Claim charts** (workflow stepper: Setup → Claim Charts → Report).
2. Show the **3-column** table: Claim element · Standard evidence · Rationale and mapping.
3. Click a Partial row → **Evidence** tab: PDF page + quote highlight / screenshot.
4. Enlarge screenshot / page so the original standard is visible.
5. Say: “Quotes and pages are tied to the indexed PDF — not pasted prose.”

### 2:20–3:20 · Judge + HITL

1. Switch inspector to **Judge** (or click **AI review** / Analysis report).
2. Show Passed / sent-back / flagged style outcome + criteria or AI Review checks.
3. Show **Ask agent** or **Edit claim** briefly (do not digress).
4. Open **Notes** tab — add one short analyst note; say notes persist on the server.
5. Click **Accept** on a clean row; **Reject** (optional reason) on one if useful, or Accept remaining.
6. Optional: **Challenge** one row earlier in the recording if you already have a revise clip — otherwise skip to keep under 5 min.

### 3:20–4:00 · SEP Report

1. Stepper → **Report** (SEP Report).
2. Show **Standard comparison** (recommended vs rejected vs charted).
3. Show **Unresolved** list if any — click a deep link back to Claim Charts, then return.
4. **Download draft claim chart (.docx)**; mention reviewed final unlocks only after every Accept/Reject.
5. Optional: open delivery bundle (.zip).

### 4:00–4:45 · Evaluation (internal)

1. Open **Evaluation** (internal nav).
2. Show reference pack + generated/agent chart path (or frozen H.265 dashboard).
3. Scoreboard: **C01–C05 Pass**; **C06** — say locked pack failed on claim-split; product now grades fine Partial+No-map bundles as Pass under documented policy; attorney-ready still **No / Conditional Go**.
4. Mention failure-modes doc: cite drift + encoder/decoder overclaim remain human gates.

### 4:45–5:00 · Close

- “Working code, README, genuine run trace, exported chart, and Deliverable 4 workbook are in the repo. Automated Pass is not a legal essentiality determination.”
- Stop recording.

### What not to show

- Fake credentials, invented colleagues, or “100% attorney-ready.”
- Blended single quality % score.
- Long Settings / Observability digressions (optional 5-second flash only).

### Backup B-roll (if a live run is slow)

Keep ready: `submission/claim1_h265_chart.docx`, `submission/Deliverable4_Evaluation.xlsx`, `submission/run_trace.json`, and a paused Claim Charts screenshot with Accept visible.

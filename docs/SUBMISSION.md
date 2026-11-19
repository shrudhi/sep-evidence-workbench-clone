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

## Loom / video script (~5 min) — Deliverable 3

Record desktop at 1080p. Speak calmly; show the mouse. Product name on screen: **LexNorm**.  
**Preferred live run:** H.265 chart `4a7f982a` (3 elements). Challenge→revise on **1[b]** is required (not optional).

### 0:00–0:20 · Open & framing — Setup

- Show LexNorm **Setup**.
- Say: “LexNorm charts Claim 1 of US10063856B2 against three indexed standards. Path: recommend → confirm → map → AI Review → **challenge / revise** → Accept/Reject → export + run trace.”

### 0:20–0:55 · Setup — recommend

1. Patent = US10063856B2 (Claim 1).
2. Show G.722.2 · H.265 V10 · TS 36.211 indexed.
3. Recommendations: **H.265 Recommended**; G.722.2 + TS **Rejected** with rationales.
4. Say: “Selection is runtime-evidenced, not hardcoded.”
5. If chart already built: open the completed H.265 run (don’t wait on a cold Create Chart in the video). CTA name is **Create Chart**.

### 0:55–1:40 · Claim Charts — evidence

1. Stepper → **Claim Charts** (3-column table; rows `1[a]`–`1[c]`).
2. Open a Partial row → Proof / View in Doc / screenshot.
3. Say: “Quotes and pages are locked to the indexed PDF.”

### 1:40–3:10 · **REQUIRED** Challenge → agent revises → Accept/Reject

This beat is mandatory for Deliverable 3.

1. Select row **1[b]** (or any Partial row).
2. Open **⋯ → Re-run element**, or inspector **AI Review → Request revision**.
3. Say: “I’m challenging this row — the agent must revise with my note, not invent a new quote.”
4. Wait for remap (~30–60s). Show the **new revision** (revision number increments; Accept/Reject reset).
5. Spot-check evidence/rationale briefly.
6. **Accept** the revised result → badge **Reviewed · Accepted**.  
   (Optional 10s: Reject on another row → confirm modal → greyed / excluded from Word.)
7. Say: “Analyst owns the final disposition after the agent revises.”

### 3:10–3:50 · SEP Report — export

1. Stepper → **Report**.
2. Unresolved list if any (deep link back).
3. **Download draft** (DRAFT watermark) anytime.
4. **Download reviewed final** only when every row is Accept/Reject.
5. **Download run trace (JSON)**.

Do **not** show a standard-comparison table on this screen.

### 3:50–4:35 · Observability — run trace

1. Nav → **Observability**; confirm same run id as Claim Charts.
2. Timeline: `run_created` → `decompose_claim` → `map_claim_element` → `review_mapping` → judge / challenge revise events.
3. Say: “Saved run trace — each step, tool call, and decision.”

### 4:35–5:00 · Close (optional Evaluation flash)

- Optional: Evaluation C01–C06b, attorney-ready = No / Conditional Go.
- Close: “Working prototype, Word chart, challenge/revise HITL, and genuine run trace are in the repo. Automated Pass is not a legal essentiality determination.”

### What not to show

- Fake credentials, invented colleagues, or “100% attorney-ready.”
- Blended single quality % score.
- The old 8-row fine-split chart as the main story.
- Skipping challenge/revise.

### Backup B-roll (if a live remap is slow)

Keep ready: `submission/claim1_h265_chart.docx`, `submission/Deliverable4_Evaluation.xlsx`, `submission/run_trace.json`, and a paused Claim Charts screenshot mid-challenge.

---

## Loom / video script (~4–5 min) — Deliverable 4

**Purpose:** Prove quality gates against a **frozen 3-row gold pack**, show **per-criterion** scores (no blended %), walk failure modes + production plan, and download the **Deliverable 4 workbook**.  
**Tone:** Calm, precise, engineering honesty. Never say “attorney-ready” or “100% accurate.”  
**Preferred path on screen:** LexNorm → **Evaluation** (Internal) → New run → Scorecard → Failure modes → Production plan → Download D4.  
**Preferred inputs:** Reference `expected-claim1-v1` · Agent chart run H.265 (`4a7f982a…` or your latest completed Claim-1 H.265 run).  
**Locked fallback (if live eval is slow):** open `submission/Deliverable4_Evaluation.xlsx` + read from `submission/Deliverable4_SUMMARY.md`.

### Prep (before Record)

1. API + UI running; at least one **completed** H.265 Claim-1 chart run visible.
2. Evaluation datasets list includes **`expected-claim1-v1`**.
3. Have these open in tabs (do not screen-share secrets):  
   - LexNorm Evaluation  
   - `submission/Deliverable4_SUMMARY.md` (for close)  
   - Optional: Excel workbook already generated once

---

### 0:00–0:25 · Framing — Evaluation (Internal)

| Cue | Do / Say |
|---|---|
| **CLICK** | Left nav → **Evaluation** (under *Internal only*) |
| **SHOW** | Red/amber gate pill: *BLOCKED — Not Ready for Attorney Review* (or Conditional Go) |
| **SAY** | “Deliverable 4 is our **evaluation pack** — frozen labelled gold versus the agent chart. We score **C01 through C06 separately**. There is **no blended quality percent**. Automated Pass is **not** a legal essentiality determination.” |

---

### 0:25–1:20 · Configure a new evaluation run

| Cue | Do / Say |
|---|---|
| **CLICK** | **+ New Evaluation Run** |
| **SHOW** | Drawer: *Reference* + *Agent output* |
| **CLICK** | Reference → **Existing** |
| **CLICK / SELECT** | Dataset → **`expected-claim1-v1`** (frozen gold, 3 Claim-1 rows) |
| **OPTIONAL CLICK** | **Preview** — show 3 claim elements, H.265 target |
| **SAY** | “This reference pack is **CONSTANT** — three attorney-labelled Claim-1 elements. It never enters production retrieval.” |
| **CLICK** | Agent output → **Generated** |
| **CLICK / SELECT** | Chart run → your **H.265** completed run (e.g. `H.265 · 4a7f982a`) |
| **SELECT** | Snapshot → **Latest** |
| **TYPE** (Change note) | `D4 demo — Claim 1 H.265 vs expected-claim1-v1` |
| **CLICK** | **Start evaluation** |
| **SHOW** | Progress: *Scoring C01–C06…* → *Building Deliverable 4 workbook…* |
| **SAY** | “We export the generated chart, score each criterion per claim element, and build the nine-tab workbook.” |

*If Start is disabled:* confirm reference + chart run both selected; wait for a completed chart run.*

---

### 1:20–2:40 · Scorecard & row audit (the heart of D4)

| Cue | Do / Say |
|---|---|
| **CLICK** | Tab **Scorecard & Row Audit** (default) |
| **SHOW** | Context strip: 🔒 `expected-claim1-v1` · Run `########` |
| **SAY** | “Per-criterion readiness — not one vanity score.” |
| **POINT** | Walk the criterion cards / table in order: |

**Talk track (use live numbers; fallback from half-page if needed):**

| Criterion | What to say |
|---|---|
| **C01 Right standard** | “Same edition as gold — H.265 V10. Gate ready.” |
| **C02 Quote verbatim** | “Quotes must exist on the cited PDF page. We fail closed on invention.” |
| **C03 Citation / section+page** | “Section and page must resolve. If this is low, call out *section n/a* or mis-parse — human adjudication.” |
| **C04 Screenshot** | “Screenshot present and **page-linked**. Crop-vs-quote OCR is roadmap — do not overclaim vision Pass.” |
| **C05 Rationale / cite drift** | “Rationale must support the label; flag CABAC or recycled-span drift vs gold crops.” |
| **C06a Over-claim guard** | “No Full map when support is only Partial or missing.” |
| **C06b Mapping label match** | “After 3-element decompose, labels align with gold. Call the improvement vs the old 8-fragment baseline if asked.” |

| Cue | Do / Say |
|---|---|
| **CLICK** | Expand **one failing or Needs review row** (prefer `1[a]` cite drift or weak C03) |
| **SHOW** | Reference vs agent quote / label / page side-by-side |
| **SAY** | “This is why gates are necessary but not sufficient — Partial map and cite drift still need a human.” |

---

### 2:40–3:25 · Failure modes

| Cue | Do / Say |
|---|---|
| **CLICK** | Scorecard sub-nav / section → **Failure modes** (or scroll to *Failure modes & corrective actions*) |
| **SHOW** | Top failure types with corrective actions |
| **SAY** | “Top modes for this pack: **FM-01** section parse / n/a; **FM-02** cite drift vs gold spans; **FM-03** crop truncation. The old C06b under-map from 8-fragment decompose is **closed** by deterministic 3-element split.” |
| **DO NOT** | Invent failure modes that are not on screen. |

---

### 3:25–4:00 · Production plan

| Cue | Do / Say |
|---|---|
| **CLICK** | Section → **Production plan** |
| **SAY** | “Production quality has two lanes. **Automated:** edition lock, verbatim PDF match, non-null section+page, page-linked screenshots, Full-map over-claim guard, span dedupe. **Human:** Partial map, remaining cite drift, visual crops. **CI:** freeze the 3-row gold; re-eval on prompt or model change; **per-criterion gates only**.” |

---

### 4:00–4:35 · Download the Deliverable 4 workbook

| Cue | Do / Say |
|---|---|
| **CLICK** | Header → **Download D4 (.xlsx)** |
| **SHOW** | Progress *Preparing spreadsheet…* then open Excel (or Finder) |
| **SAY** | “Nine tabs: Instructions · 0 Summary · **1 Rubric CONSTANT** · **2 Labelled expected chart CONSTANT** · 2b Agent chart with XLOOKUP · 3 Run scores · 4 Failure modes · 5 Production plan · **6 Run history** with trend.” |
| **CLICK** (in Excel, ~15s) | Briefly flash tabs **1 Rubric**, **2 Labelled expected**, **3 Run scores**, **6 Run history** |
| **SAY** | “Rubric and gold stay frozen so iteration history is comparable.” |

---

### 4:35–5:00 · Close — half-page honesty

| Cue | Do / Say |
|---|---|
| **OPTIONAL SHOW** | `submission/Deliverable4_SUMMARY.md` or Summary tab |
| **SAY** | “Attorney-ready? **No — Conditional Go.** Critical gates can Pass while High/Medium criteria still block unsupervised delivery. LexNorm ships a working eval pack, workbook, and regression plan — expert sign-off remains required. This is **not** a FRAND or essentiality opinion.” |
| **STOP** | End recording on Evaluation scorecard or workbook Summary. |

---

### Deliverable 4 checklist (what reviewers expect)

| Artifact | Where |
|---|---|
| Half-page summary | `submission/Deliverable4_SUMMARY.md` |
| Workbook (.xlsx) | `submission/Deliverable4_Evaluation.xlsx` (or freshly downloaded D4) |
| Failure modes + plan note | `docs/EVAL_FAILURE_MODES.md` |
| Frozen gold pack | `evaluation_data/Expected_Claim1_Reference_Pack/` |
| Working Evaluation UI | LexNorm → Evaluation |

### What not to say / show (D4)

- “Attorney-ready” / “production certified” / blended single % score  
- Treating Evaluation as attorney-facing (banner says **Internal only**)  
- Hardcoding H.265 as the winner on Setup (selection is runtime)  
- Skipping the workbook download or the frozen-gold story  
- Claiming OCR proves screenshot text equals the quote (C04 is page-link Pass today)

### Backup if live Start evaluation fails

1. Open locked `submission/Deliverable4_Evaluation.xlsx`.  
2. Narrate tabs 0 → 3 → 4 → 5 → 6 using numbers from `Deliverable4_SUMMARY.md`.  
3. Show Evaluation UI scorecard for a **prior** completed eval id if listed in the context strip.  
4. Still state: Conditional Go; human review required.

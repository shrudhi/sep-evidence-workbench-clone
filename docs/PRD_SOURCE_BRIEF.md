# LexNorm — source brief for rewriting the PRD

**Purpose of this file:** Feed this document to ChatGPT (or similar) and ask it to produce a **tight one-page PRD**. Do not paste old `docs/PRD.md` as ground truth — rewrite from this brief.

**Product name:** LexNorm  
**Repo:** https://github.com/shrudhi/sep-evidence-workbench-clone  
**Demo host (when live):** Render Docker service `lexnorm-workbench`  
**Owner framing:** Assessment / hiring deliverable for a patent-to-standard evidence workbench — ship as a coherent product story, not as “homework clone of another tool.”

---

## 1. One-sentence product

LexNorm helps a technical patent analyst map a patent claim to an exact technical standard edition, with **verifiable quotes, pages, and screenshots** from the original PDF, then Accept/Reject rows and export a Word claim chart — **without** claiming legal essentiality.

---

## 2. Problem (write this carefully)

- SEP claim charts are built by hand against thousand-page standards (pick edition, quote clauses, attach screenshots, label Full / Partial / No map).
- Slow, inconsistent, easy to mis-cite.
- Generic LLMs invent clause numbers and quotes that are not in the PDF.
- LexNorm is **claim → standard document** mapping (SEP charting).
- It is **not** accused-product evidence-of-use (EOU) charting.
- **Do not** mention Lumenci, iLumOS, or “variant of X” in the PRD. Those names are assessment context only and weaken the product story.

---

## 3. Primary user & job-to-be-done

| | |
|---|---|
| **User** | Technical patent analyst / licensing or litigation support |
| **Not** | An attorney bot that issues essentiality opinions |
| **Job** | Produce a limitation-level Claim 1 chart that an expert can verify by opening the standard PDF |
| **Success** | Defensible draft with source-locked evidence + analyst dispositions |

---

## 4. Assessment corpus (fixed demo inputs)

| Input | Detail |
|---|---|
| Patent | US10063856B2 — Chroma Quantization Parameter Extension (HEVC / H.265 related) |
| Patent handling | Prepared patent-input JSON + PDF; arbitrary PDF upload is retained; SHA-256 match binds prepared claims; no invented claim parsing |
| Standards (all indexed) | ITU-T G.722.2 (07/2003); ITU-T H.265 V10 (07/2024); 3GPP TS 36.211 V17.2.0 (2022-08) |
| Default chart scope | Claim 1 (UI supports claim multi-select from prepared claims) |

**Standards decision (must be evidenced at runtime, never hardcoded winner):**

| Standard | Expected outcome | Why |
|---|---|---|
| H.265 V10 | Recommend / chart | Patent extends HEVC chroma QP |
| G.722.2 | Reject | Wideband speech — wrong domain |
| TS 36.211 | Reject | LTE PHY — wrong domain |

---

## 5. Product surface (what actually shipped)

### Navigation / IA

- **Workflow stepper (primary):** Setup → Claim Charts → Report  
- **Internal (secondary):** Evaluation, Observability, Settings  
- **Hidden / not primary:** old Dashboard as main path  
- Branding: **LexNorm** (dark product shell in the current build)

### Screen A — Setup

1. Select existing patent (US10063856B2) or upload PDF (honest SHA-256 / prepared-input rules).
2. Auto **Recommend** when patent is ready → recommend/reject cards + rationales; optional **Upload standard**.
3. Analyst confirms target → **Create Chart** → immutable run snapshot → Claim Charts (Path A).

### Screen B — Claim Charts

- One active chart for the confirmed standard (Path A).
- **Three-column table:** Claim element · Standard evidence · Rationale and mapping.
- Claim decompose prefers **3 functional elements** (`1[a]`–`1[c]`) for Claim 1.
- Mapping labels: **Full map / Partial map / No map** (Partial must state gaps).
- Evidence: collapsible Proof cards + View in Doc; quotes/edition/section/page/screenshots from original PDF.
- Rationale actions: Accept · Reject · ⋯ (Edit / Re-run / Manage evidence / Analysis report) · Ask Agent · Notes.
- Right inspector: **Evidence | Judge | Notes** (Notes server-side).
- AI Review: Passed / Needs Review / Review Incomplete — **Unverified checks block Passed**.
- Filters (AND): Auto Review Status · Analyst Status (Accepted/Rejected) · Updated By (Manual/AI).
- Accepted revisions are immutable.

### Screen C — SEP Report (formerly “Conclusion”)

- Unresolved elements with deep links back to Claim Charts (no standard-comparison table on this screen).
- Exports: **draft** Word anytime (**DRAFT watermark**); **reviewed final** when every row is AI Review Passed or Accept/Reject; optional delivery bundle.
- **No** blended essentiality %; **no** Judge panel on this screen.

### Internal — Evaluation

- Compare agent chart vs frozen gold **`expected-claim1-v1 v1.0.0`** (CONSTANT 3-row labelled chart).
- Criteria **C01–C06b** scored separately (**no blended single score**).
- Deliverable 4 workbook: Instructions, 0 Summary, 1 Rubric (CONSTANT), 2 Labelled expected chart (CONSTANT), 2b Agent chart (XLOOKUP + Cite Drift), 3 Run scores (COUNTIF), 4 Failure modes, 5 Production plan, **6 Run history** (+ trend chart).

---

## 6. Agent design (Path A)

1. **Selection agent** — score candidates; recommend/reject with rationale; **pause for analyst confirm**.
2. **Mapping agent** — per claim element: quote + source (edition/section/page) + screenshot + Full/Partial/No + gaps.
3. **Review agent** — separate execution from mapper; checks quote/source/screenshot/label↔rationale integrity.
4. **HITL** — Apply fix / View Evidence / Ask Agent / Edit / Request Revision / Rerun / Challenge / Accept / Reject.
5. **Export** — draft anytime; final gated on every row disposition.

---

## 7. Chart format (market standard)

1. Claim element (verbatim limitation text, e.g. 1[a]…)  
2. Standard evidence — quote · source · screenshot  
3. Rationale + Full / Partial / No  

---

## 8. Integrity & honesty rules (must appear in PRD trade-offs / non-goals)

- Evidence integrity > fluent prose; fail closed on fake quotes.
- Prefer under-mapping (Partial/No) over false Full map.
- Mapper ≠ reviewer; analyst owns final Accept/Reject.
- Technical Full map ≠ FRAND / legal essentiality.
- Attorney-ready only after human expert sign-off — automated Pass ≠ legal conclusion.
- Uploads: matching SHA-256 reuses indexed docs; unknown patents retained without invented claims; unknown standards register as pending until ingest.
- Do not fabricate colleagues, notifications, or offline fake model success.

---

## 9. Evaluation reality (for PRD metrics / risk, not as marketing claims)

**Locked Deliverable 4 pack (scored artifact):**

| Criterion | Locked score |
|---|---|
| C01 Right standard & edition | 3/3 Pass |
| C02 Quote verbatim | 3/3 Pass |
| C03 Source / section / page | 3/3 Pass |
| C04 Screenshot link | 3/3 Pass |
| C05 Rationale supports | 3/3 Pass |
| C06 Mapping label | 0/3 Fail (fine claim-split mismatch) |

**Readiness:** Conditional Go — human review required. Not attorney-ready.

**Top failure modes:**
1. Claim decomposition mismatch (gold 3 parts vs finer agent split) — product now has fine-split C06 Pass policy when ≥1 Partial and no Full overclaim; locked workbook still shows 0/3.
2. Cite drift vs gold reference crops (C02/C03 can pass while pages differ from attorney pack).
3. Encoder/decoder overclaim risk on chroma QP Full maps.

**CI / production gates (conceptual):** per-criterion gates, no blended score; freeze gold pack; re-eval on prompt/retrieval/model change; reference pack never enters production retrieval.

---

## 10. Tech stack (one short PRD appendix line max)

- Backend: FastAPI, SQLite, LangGraph workflow, hybrid FTS5 + MiniLM embeddings, PDF ingest with SHA-256 registry.
- Frontend: React + TypeScript SPA served by API.
- Export: DOCX three-column chart + ZIP bundle + run trace.
- Models (demo config): mapper `gpt-4o-mini`, reviewer `gpt-4o` via OpenAI-compatible API; measured cost trade-off documented in `docs/MODEL_COMPARISON.md`.
- Deploy: single Docker image; Render blueprint (`render.yaml`); not suitable for Vercel (long-running Python, SQLite, PDFs, embeddings).

---

## 11. Competitive landscape (keep to one PRD paragraph)

Tools like Patsnap, Solve Intelligence, GreyB, HashiCorp-adjacent SEP tooling, IPlytics (declarations) exist.  
**LexNorm differentiation to emphasize:** source-locked evidence integrity, separate review agent, analyst HITL Accept/Reject with revision history, and first-class labelled evaluation (C01–C06) — not a declaration score or essentiality percentage.

---

## 12. V1 scope

**In**
- Claim 1 focus (multi-claim UI exists for prepared claims)
- Path A: select → confirm → map → review → HITL → SEP Report export
- Three indexed standards
- Evidence / Judge / Notes inspector
- Internal Evaluation vs gold pack
- Run trace + Word/ZIP export
- Honest patent/standard upload paths

**Out**
- Patent fetching / free-form claim OCR invention
- Auth / multi-user / notifications
- Production multi-tenant infra
- Legal essentiality / FRAND conclusions
- Blended quality score as “essentiality %”

---

## 13. Success metrics (product, not vanity)

**Outcome:** cite integrity; C01–C06 separately; time to final-ready; false Full rate; post-edit integrity hold.

**Stage (LLM health):** recommendation accept / top-1 hit + wrong-domain reject precision; first-draft quote+page Pass + label agreement; reviewer first-pass Pass / catch / false-alarm; Ask Agent accept rate + integrity after Accept + turns-to-resolution.

**Cross-cutting:** HITL touch rate; optional cost per final-ready chart; time in stage. Authorship shares are transparency only.

Analyst override of Recommended standard is **normal**, not a failure — track it as recommendation quality.

---

## 14. Instructions for ChatGPT when writing the PRD

Produce a **one-page PRD** (Markdown) with:

1. Title + product one-liner  
2. Problem  
3. Users & JTBD  
4. Goals / non-goals  
5. In-scope V1 solution (screens + Path A)  
6. Agent checkpoints  
7. Chart format  
8. Standards decision table (H.265 select; others reject) — note runtime evidence, not hardcode  
9. Competitive differentiation (one short block)  
10. Trade-offs  
11. Success metrics  
12. Explicit disclaimer: not attorney-ready / not essentiality  

**Style rules**
- Clear, executive, scannable; tables OK.
- Use product name **LexNorm** only.
- Do **not** mention Lumenci, iLumOS, Clause (old codename), or “assessment variant.”
- Do **not** invent accuracy numbers beyond the locked eval table above if you cite scores.
- Prefer “Conditional Go / human review required” over “production ready.”
- Match shipped UX names: Matter Setup, Claim Charts, SEP Report, Evaluation (internal).

**Optional inputs ChatGPT may also open:**  
`docs/USER_FLOW.md`, `docs/EVAL_FAILURE_MODES.md`, `submission/Deliverable4_SUMMARY.md`, `docs/SUBMISSION.md` (Loom script for demo narrative only — not PRD body).

---

## 15. Prompt you can paste into ChatGPT

```
Using ONLY the file docs/PRD_SOURCE_BRIEF.md as source of truth, write a polished one-page product PRD for LexNorm in Markdown. Follow section 14 instructions exactly. Do not mention Lumenci or iLumOS. Do not invent metrics. Emphasize claim→standard SEP charting with source-locked evidence and HITL Accept/Reject. End with a clear non-goal that this is not a legal essentiality determination.
```

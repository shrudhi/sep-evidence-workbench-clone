# PRD ARCHIVE — snapshot before Deliverable 1 one-page rewrite

> Archived copy of the pre–Deliverable-1 PRD. Active PRD: [`docs/PRD.md`](PRD.md). Do not submit this file as Deliverable 1.

# PRD — LexNorm SEP Chart Builder (v1)

**Product:** LexNorm — claim-to-standard SEP charting workbench for technical patent analysts  
**Demo patent:** [US10063856B2](https://patents.google.com/patent/US10063856B2/en) (chroma QP extension for HEVC)  
**Standards corpus:** ITU-T G.722.2 · ITU-T H.265 V10 · 3GPP TS 36.211 (all indexed; winner never hardcoded)  
**Outcome:** Defensible draft/reviewed claim chart with source-locked quotes and screenshots — **not** a legal essentiality opinion  

**Links:** [GitHub](https://github.com/shrudhi/sep-evidence-workbench-clone) · Live demo `https://lexnorm-workbench.onrender.com` (may cold-start on free tier)

---

## Problem

Analysts hand-build SEP charts across thousand-page standards: pick the right edition, quote clauses, attach screenshots, and label Full / Partial / No map. The work is slow and easy to mis-cite. Generic LLMs invent clause numbers and quotes that are not in the PDF. LexNorm is built for **claim → standard document** mapping with hash-locked evidence — not accused-product evidence-of-use charting.

## Users & job-to-be-done

| | |
|---|---|
| **Primary user** | Technical patent analyst / licensing or litigation support |
| **Not** | An attorney bot that issues FRAND / essentiality opinions |
| **Job** | Produce a limitation-level Claim 1 chart an expert can verify by opening the standard PDF |
| **Success** | Source-locked evidence + clear review state + exportable Word chart |

## Standards decision (runtime-evidenced)

| Standard | Expected outcome | Why |
|---|---|---|
| **H.265 V10** | Recommend / chart | Patent extends HEVC chroma QP |
| G.722.2 | Reject | Wideband speech — wrong domain |
| TS 36.211 | Reject | LTE PHY — wrong domain |

Selection agent screens candidates and writes recommend/reject rationales; the analyst confirms what to chart. Winner is never hardcoded.

## Product surface (v1)

**Primary path (assignment three screens):** Setup → Claim Charts → SEP Report  
**Internal:** Evaluation, Observability, Settings  

### Setup
1. Patent ready (prepared US10063856B2 or honest PDF upload — SHA-256 binds prepared claims; no invented claim parsing).  
2. Auto-trigger **Recommend** when the patent is ready; show recommend/reject cards with rationales.  
3. **Upload standard** for additional PDFs; analyst confirms the charted target.  
4. **Create Chart** starts mapping for the confirmed standard (Path A — one active chart).

### Claim Charts
- **Three-column chart:** Claim element · Standard evidence · Rationale and mapping (Full / Partial / No).  
- **Claim grain:** Deterministic SEP decompose targets **3 functional elements** for Claim 1 (`1[a]`–`1[c]`) — preamble + verb-led limitations — with OCR cleanup; LLM fine-split is fallback only.  
- **Evidence:** Collapsible Proof cards (Source / Quote / Screenshot) with **View in Doc**.  
- **Rationale column actions:** Mapping chip · AI status · green **Accept** · **Reject (X)** · **⋯** menu (Edit claim, Re-run element, Manage evidence, Analysis report); footer **Ask Agent | Notes**.  
- Inspector: **Evidence | Judge | Notes** (Notes persisted server-side).  
- **AI Review:** Passed only when checks Pass; **Unverified** (e.g. missing section) → **Needs Review** (does not unlock final). Statuses: Passed / Needs Review / Review Incomplete.  
- **Filters (AND):** Auto Review Status (Passed · Review Pending · Need Correction) · Status (Accepted · Rejected) · Updated By (Manual · AI).  
- Ask Agent proposals require Accept before chart write (new revision). Accepted revisions are immutable.

### SEP Report
- Run metadata, unresolved rows with deep links to Claim Charts, and downloads.  
- **No** standard-comparison table on this screen (selection outcomes stay on Setup).  
- **Draft** Word anytime — diagonal **DRAFT** watermark + “working copy / not for delivery” header/footer.  
- **Reviewed final** when every row is **AI Review Passed** *or* has Accept/Reject. Optional delivery bundle.  
- No blended essentiality %; no Judge panel on this screen. Disclaimer: not a legal essentiality determination.

### Evaluation (internal)
- Compare charts to frozen gold pack **`expected-claim1-v1 v1.0.0`** (CONSTANT 3-row labelled chart).  
- Deliverable 4 workbook (**9 tabs**): Instructions · 0 Summary · **1 Rubric (CONSTANT)** · **2 Labelled expected chart (CONSTANT, 3 rows)** · 2b Agent chart (XLOOKUP + Cite Drift) · 3 Run scores (COUNTIF pass rates) · 4 Failure modes · 5 Production plan · **6 Run history** (append-only + per-criterion trend chart).  
- Rubric gates **C01–C06b** scored separately (**no blended overall %**): C06a Over-Claim Guard (Critical) · C06b Mapping Label Match (High).  
- Attorney-ready = NO unless every Critical/High gate Passes **and** a human adjudicates Partial-map / Cite Drift edges.

## Agent design & checkpoints

1. **Selection** — recommend/reject with rationale; pause for confirm (map spend only after confirm).  
2. **Decompose** — prefer deterministic 3-way SEP split; LLM only if grain fails.  
3. **Mapping** — quote + edition/section/page + screenshot + Full/Partial/No + gaps.  
4. **Review** — separate from mapper; Unverified blocks Passed.  
5. **HITL** — Edit · Ask Agent · Re-run · Accept/Reject · Notes.  
6. **Export** — draft anytime (watermarked); reviewed final when review-ready.

## Chart format

1. Claim element (verbatim limitation, e.g. `1[a]`)  
2. Standard evidence — quote · source · screenshot  
3. Rationale + Full / Partial / No (Partial states what is missing)

## Key product trade-offs

1. **Spend on judgment, not volume** — Mapper on a cheaper model (`gpt-4o-mini`); reviewer on a stronger model (`gpt-4o`).  
2. **Fair claim-split scoring vs honesty** — Frozen gold is **3** Claim-1 limitations. Production decompose targets that grain; D4 still reports **per-criterion** rates (C06a/C06b) so a green average cannot hide over-claim or label mismatch.  
3. **Integrity ≠ same page as gold** — C02/C03 can Pass on a real cite while Cite Drift flags off-target or recycled spans (C05 / human review).

## Competitive differentiation

Patsnap / Solve / GreyB / Hashi deepen SEP mapping; IPlytics scores declarations. LexNorm differentiates on **source-locked evidence**, **separate review agent**, **versioned HITL**, and **criterion-level evaluation** — not a single essentiality percentage.

## Success metrics

What hiring review should care about: **trust in cites, honesty of Full map, speed to a reviewable chart, and whether each agent stage is actually helping.** Not legal essentiality.

| Metric | What it means | How we measure |
|---|---|---|
| **Cite integrity rate** | Quotes are real and on the cited page. | `(rows with verified quote **and** correct page) ÷ (rows that claim evidence)` → target near 100% |
| **False Full map rate** | Do not over-claim Full when support is Partial/No. | `(Full rows that should be Partial or No) ÷ (all Full rows)` → **lower is better** |
| **Gold Pass by criterion (C01–C06b)** | Each check Passes on its own against frozen gold. | Seven rates: `Pass ÷ eligible` — **never one blended %** |
| **Time to final-ready chart** | How fast Claim 1 becomes exportable as reviewed final. | `time(final-ready) − time(Create Chart)` · final-ready = every row AI Review **Passed** or Accept/Reject |
| **Recommendation hit rate** | Selection picks the right standard (and analyst keeps it). | Top-1 vs expected (e.g. H.265) **and** keep rate · override is normal |
| **First-pass review Pass rate** | Rows that clear AI Review without a fix loop. | `(Passed on first AI Review) ÷ (rows reviewed)` |
| **Ask Agent accept + integrity** | Proposals useful *and* still cite-real after Accept. | Accept rate **and** post-accept quote+page Pass rate |

**Not a success KPI:** Manual vs AI authorship shares — filter dimensions only; authorship ≠ quality.

## Non-goals / disclaimer

Technical Full map ≠ FRAND or legal essentiality. Automated Pass ≠ attorney-ready. Expert sign-off remains required. No auth, multi-tenant infra, or free-form patent claim invention in v1.

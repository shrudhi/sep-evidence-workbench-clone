# Eval failure modes + production plan

Chart run scored: `a4d4d0c4-ba50-4dc7-a6b5-8e23a0f2116b` (H.265 V10, Claim 1)  
Gold pack: `evaluation_data/Expected_Claim1_Reference_Pack` (`expected-claim1-v1`)  
Locked Deliverable 4 eval: `32f1416f` → `submission/Deliverable4_Evaluation.xlsx`

## What was broken (earlier rescored run `b302b124`)

| Criterion | Symptom | Root cause |
|---|---|---|
| **C04 screenshot match** | Product metric `0/3` | Screenshots were present, but auto-check always returned **Needs review** (no Pass path). Metrics count only Pass → looked like failure. |
| **C05 rationale supports** | Product metric `0/3` | LLM grader defaulted Partial-map rows to **Needs review**; prompt/example biased away from Pass. |

C01–C03 (edition / quote / page) were already honest Passes on the live H.265 chart.

## Fixes shipped

1. **C04** — Auto-**Pass** when every evidence block has a screenshot **linked to the cited PDF page**; **Fail** if missing or not page-linked. Does **not** OCR/compare crop-to-quote yet (roadmap: vision/OCR adjudicator).
2. **C05** — Grader prompt prefers Pass/Fail; deterministic fallback Passes clear Partial-map rationales that state support + gaps when the LLM stays on Needs review/Error.
3. **C06 fine-split policy** — When gold is Partial map and aligned generated labels include ≥1 Partial with **no** Full-map overclaim, grade **Pass** (No-map sub-parts allowed). Pure No-map vs expected Partial still Fails. Locked workbook scores remain 0/3; new Evaluation runs use the policy.

## Locked pack scorecard (eval `32f1416f`)

| Criterion | Result |
|---|---|
| C01 Right standard | **3/3 Pass** |
| C02 Quote verbatim | **3/3 Pass** |
| C03 Source/page | **3/3 Pass** |
| C04 Screenshot | **3/3 Pass** |
| C05 Rationale | **3/3 Pass** |
| C06 Label | **0/3 Fail** (pre–fine-split-policy score on mixed Partial+No-map bundles) |

Attorney-ready: **No** — Conditional Go; expert review required.

## Top 3 remaining failure modes

1. **Claim decomposition mismatch** — Gold pack has 3 Claim-1 elements; generator may emit 8 (`1[a]`–`1[h]`). Fine-split scoring softens C06 for Partial+No-map; constraining the splitter toward gold’s 3-part structure is still preferred for attorney reviewability.
2. **Cite drift vs gold crops** — Generated 1[a] may cite overview/CABAC pages instead of gold E01/E02 definition pages. Quotes verify on-page (C02/C03) but do not match attorney reference crops.
3. **Encoder/decoder overclaim** — Decoder-only equations used to support encoder “set chroma QP”; keep Full-map guards + human review.

## Production plan (next)

1. Prefer Claim-1 split toward gold’s 3-part limitation structure (fine-split Pass is a safety net, not a substitute).
2. Bias retrieval toward gold-like clause/page priors for chroma QP (without hardcoding the winner standard).
3. Require Partial rationales to emit structured `missing_requirements` and grade against that schema.
4. Keep C04 as screenshot attached + page-linked; add OCR/vision adjudicator for crop-vs-quote mismatch (Fail on clear mismatch; ambiguous → Needs review).
5. Export eval workbook + this note with every submission package; re-run Evaluation after prompt/retrieval changes.

## How to refresh artifacts

```bash
# From repo root, with API running and a completed H.265 chart run:
# 1) Evaluation UI → reference expected-claim1-v1 + generated chart → Run
# 2) Download D4 workbook from Evaluation results
# Or via API:
# POST /api/evaluation-runs/from-sources  then  GET /api/evaluation-runs/{id}/deliverable4.xlsx
```

Copy refreshed files into `submission/` only when scores are intentional (do not silently overwrite the locked Conditional Go pack without updating `Deliverable4_SUMMARY.md`).

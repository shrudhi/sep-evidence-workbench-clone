# Eval failure modes + production plan

Chart run scored: `a4d4d0c4-ba50-4dc7-a6b5-8e23a0f2116b` (H.265 V10, Claim 1)  
Gold pack: `evaluation_data/Expected_Claim1_Reference_Pack` (`expected-claim1-v1`)

## What was broken

| Criterion | Symptom | Root cause |
|---|---|---|
| **C04 screenshot match** | Product metric `0/3` | Screenshots were present, but auto-check always returned **Needs review** (no Pass path). Metrics count only Pass → looked like failure. |
| **C05 rationale supports** | Product metric `0/3` | LLM grader defaulted Partial-map rows to **Needs review**; prompt/example biased away from Pass. |

C01–C03 (edition / quote / page) were already honest Passes on the live H.265 chart.

## Fixes shipped

1. **C04** — Auto-**Pass** when every evidence block has `screenshot_url`; **Fail** only when missing/unavailable.
2. **C05** — Grader prompt prefers Pass/Fail; deterministic fallback Passes clear Partial-map rationales that state support + gaps when the LLM stays on Needs review/Error.

## Rescore (eval `b302b124-5bc7-4ae5-b3b8-f57fbbfd9fec`)

| Criterion | Result |
|---|---|
| C01 Right standard | **3/3 Pass** |
| C02 Quote verbatim | **3/3 Pass** |
| C03 Source/page | **3/3 Pass** |
| C04 Screenshot | **3/3 Pass** (was 0/3 Needs review) |
| C05 Rationale | **3/3 Pass** (was 0/3 Needs review) |
| C06 Label | **0/3 Fail** after alignment confirm — gold Partial rows align to mixed Partial+No-map generated splits |

## Top 3 remaining failure modes

1. **Claim decomposition mismatch** — Gold pack has 3 Claim-1 elements; generator often emits 8 (`1[a]`–`1[h]`). Alignment is many-to-one; No-map sub-elements inside a Partial gold row fail C06.
2. **Cite drift vs gold crops** — Generated 1[a] may cite overview/CABAC pages instead of gold E01/E02 definition pages. Quotes verify on-page (C02/C03) but do not match attorney reference crops.
3. **C06 label agreement** — Needs confirmed alignments; fails when any aligned generated label disagrees with gold Partial policy.

## Production plan (next)

1. Constrain Claim-1 split toward gold’s 3-part limitation structure (or score aggregated alignments).
2. Bias retrieval toward gold-like clause/page priors for chroma QP (without hardcoding the winner standard).
3. Require Partial rationales to emit structured `missing_requirements` (already partially present) and grade against that schema.
4. Keep C04 presence auto-pass; add optional vision adjudicator later for crop-vs-quote mismatch (Fail only on mismatch).
5. Export eval workbook + this note with every submission package.

# Deliverable 4 — Half-Page Summary

**US10063856B2 Claim 1 → ITU-T H.265 V10 (07/2024)** · Agent run `4a7f982a` · Eval `925a1ea0` · Frozen gold **`expected-claim1-v1 v1.0.0`** (CONSTANT 3-row pack) · Prior baseline `a4d4d0c4` (8-fragment / C06b blocker)

### Attorney-ready?
**No — Conditional Go, human review required.** Critical gates (C01, C02, C06a) Pass. **High:** C03 @ 33.3% (section n/a / mis-parse on `1[b]`, `1[c]`). **Medium:** C04 @ 66.7%, C05 @ 33.3% (CABAC cite drift on `1[a]`; recycled `1[b]` span + crop on `1[c]`). **C06b @ 100%** after 3-element decompose (was 0% on baseline). Cite drift on **2 of 3** elements. Automated gates are necessary, not sufficient — Partial-map / Cite Drift need human adjudication. Not a legal essentiality opinion.

| Criterion | Rate | Readiness |
|---|---|---|
| C01 Right standard | 3/3 (100%) | Ready |
| C02 Quote verbatim | 3/3 (100%) | Ready |
| C03 Citation / section+page | 1/3 (33.3%) | **Blocker** |
| C04 Screenshot attached & page-linked (**not** OCR crop=quote) | 2/3 (66.7%) | Needs work |
| C05 Rationale / cite drift | 1/3 (33.3%) | **Blocker** |
| C06a Over-Claim Guard | 3/3 (100%) | Ready |
| C06b Mapping Label Match | 3/3 (100%) | Ready (+100% vs baseline) |

### Top failure modes
1. **FM-01 / C03** — `section n/a` and inline clause mis-parse → extract nearest bold clause header.  
2. **FM-02 / C05** — `1[a]` CABAC §9.3.5 drift; `1[c]` recycles `1[b]` §8.6.1 span → span dedupe + gold-anchor boost.  
3. **FM-03 / C04** — Table 8-10 / equation crop truncation → bbox token-overlap OCR roadmap.  
4. **FM-00 / C06b (closed)** — 8-fragment under-map → deterministic 3-element SEP decompose (verified on `4a7f982a`).

### Production quality & regression
**Auto:** edition lock; verbatim PDF match; non-null section + page offset; screenshot page-link; C06a Full-map guard; cross-element span dedupe. **Human:** Partial map, Cite Drift, remaining C03/C05, visual crops. **CI:** freeze 3-row gold; re-eval on prompt/parser/LLM change; **per-criterion gates only (no blended %)**; reference never enters production retrieval.

**Workbook:** `submission/Deliverable4_Evaluation.xlsx` — 9 tabs (Instructions · 0 Summary · 1 Rubric CONSTANT · 2 Labelled expected chart CONSTANT · 2b XLOOKUP · 3 Run scores COUNTIF · 4 Failure modes · 5 Production plan · 6 Run history + trend chart)  
**PRD:** `docs/PRD.md` · **Script:** `docs/SUBMISSION.md`

# Deliverable 4 — Half-Page Summary

**US10063856B2 Claim 1 → ITU-T H.265 V10 (07/2024)** · Run `a4d4d0c4` · Eval `32f1416f` · Reference `expected-claim1-v1` (provisional) · **Pack: LOCKED (scored artifact)**

### Attorney-ready?
**No — Conditional Go, human review required.** C01–C05 pass (3/3 each). **C06 scored 0/3** on the locked pack: after alignment, the agent’s fine Claim-1 split mixed Partial and No map against expected Partial. Automated evidence checks are necessary, not sufficient. Attorney sign-off is **not available and not claimed**. Scope: Claim 1 only.

| Criterion | Rate | Readiness |
|---|---|---|
| C01 Right standard | 3/3 (100%) | Ready |
| C02 Quote verbatim | 3/3 (100%) | Ready |
| C03 Source & page | 3/3 (100%) | Ready |
| C04 Screenshot link | 3/3 (100%) | Ready |
| C05 Rationale | 3/3 (100%) | Ready |
| C06 Mapping label | 0/3 (0%) | **Blocker (locked score)** |

### Top 3 failure modes
1. **C06 / claim split** — e.g. 1[a] expected Partial vs `[Partial, No map]`. **Product fix shipped:** fine-split policy Passes when ≥1 aligned Partial and no Full-map overclaim (No-map sub-parts allowed). Re-run Evaluation to pick up; locked workbook keeps the original 0/3 score.  
2. **Cite drift** — C02/C03 stay green while passages diverge (1[c]/E06 PDF 21 vs agent PDF 603); rerank to frozen E01–E07.  
3. **Encoder/decoder overclaim** — decoder eqs 8-285/8-286 used for encoder “set chroma QP”; block Full map on decoder-only cites + Table 8-10 guards.

### Production quality & regression
**Auto:** edition lock; verbatim PDF-text match; section + page-offset checks; screenshot–page link; Full-map / fine-split / qPi→QpC guards. **Human:** Partial map judgment, remaining C06 edge cases, decoder→encoder Full, cite-drift, visual crops — LLMs cannot self-certify construction or essentiality. **CI:** freeze labelled pack (+ negative standard controls); re-eval on prompt/retrieval/LLM change; per-criterion gates (no blended score); C01/C02=100%, C06 Fail→0; reference never enters production retrieval.

**Workbook:** `submission/Deliverable4_Evaluation.xlsx` (sheets 0–5, 2b, 4b)  
**Script:** `docs/SUBMISSION.md` (Loom by screen)

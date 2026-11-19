# LexNorm — Product Requirements Document (v1)

**LexNorm** helps technical patent analysts map a patent claim to an exact standard edition with source-locked quotes, pages, and screenshots, then disposition rows and export a Word claim chart — without issuing a legal essentiality opinion.

**Demo matter:** [US10063856B2](https://patents.google.com/patent/US10063856B2/en) (HEVC chroma QP) · Corpus: ITU-T G.722.2 · ITU-T H.265 V10 · 3GPP TS 36.211 (all indexed; selection never hardcoded)

## Problem

**User:** Technical patent analyst supporting licensing or litigation. **Today:** Analysts hand-build SEP claim charts against thousand-page standards — pick the edition, quote clauses, attach screenshots, label Full / Partial / No map. The work is slow, inconsistent, and easy to mis-cite; generic LLMs invent clause numbers and quotes absent from the PDF. **Job:** Produce a limitation-level Claim 1 chart an expert can verify in the original standard PDF. LexNorm is **claim → standard** mapping, not accused-product evidence-of-use charting.

## Standards landscape

| Standard | Decision | Why |
|---|---|---|
| **ITU-T H.265 V10 (07/2024)** | Chart | Patent extends HEVC chroma QP; matching technical domain and edition |
| ITU-T G.722.2 (07/2003) | Reject | Wideband speech codec — wrong domain |
| 3GPP TS 36.211 V17.2.0 | Reject | LTE physical layer — wrong domain |

Selection agent recommends/rejects with rationales at runtime; analyst confirms. Winner is never hardcoded.

## Competitive landscape

| Offering | Does well | Falls short | LexNorm difference |
|---|---|---|---|
| Patsnap / Solve Intelligence | Broad AI patent search & drafting assist | Cite integrity and row disposition secondary | Hash-locked quote · page · screenshot as first-class chart cells |
| GreyB / boutique SEP services | Deep human essentiality analysis | Slow, costly, hard to audit mid-draft | Agent draft + versioned Accept/Reject so experts review, not retype |
| IPlytics / declaration DBs | Portfolio & declaration scoring | Not claim-to-clause charts with PDF evidence | Limitation-level chart — not a declaration or essentiality score |

## Scope

| v1 does | v1 does not |
|---|---|
| Setup → Claim Charts → SEP Report for Claim 1 | Patent fetching / free-form claim invention |
| Runtime selection across three indexed standards | Auth, multi-tenant infra, notifications |
| 3-column chart; deterministic `1[a]`–`1[c]` decompose | Legal essentiality / FRAND conclusions |
| Separate AI Review (Unverified → Needs Review); AND filters; Ask Agent | Blended “essentiality %”; Judge on SEP Report |
| Draft Word anytime (**DRAFT** watermark); reviewed final when every row is Accept/Reject | Standard-comparison table on SEP Report |

## Agent design

| Step | How it runs | Human check-in | Justification |
|---|---|---|---|
| **Selection** | **Model** on retrieved candidates — recommend/reject with rationale | Confirm charted standard(s) | Judgment across domains; override expected |
| **Decompose** | **Deterministic** SEP grain first (preamble + major limitations → `1[a]`–`1[c]`); **model fallback** if rules fail | Edit claim if needed | Stable, reviewable grain; avoid fine-split churn |
| **Retrieval** | **Deterministic** search over the locked PDF (FTS; embeddings in analysis workers) | — | Candidate passages only — no invented text |
| **Mapping** | **Model** drafts label / rationale / cited span IDs from retrieved spans; quote · page · screenshot come from corpus / PDF render | Re-run / manage evidence on miss | Language judgment on support and gaps |
| **Integrity checks** | **Deterministic** — quote-on-page, edition/source lock, page-linked screenshot, Full-map over-claim guard | — | Fail closed; models do not self-certify cites |
| **Review** | **Model** reviewer (≠ mapper) after each mapped row + deterministic gates | Fix when Needs Review | Quality signal on the draft; Unverified ≠ Passed |
| **HITL** | Accept / Reject / Edit / Ask Agent / Notes | Required before reviewed-final | Commercial risk stays with the analyst |
| **Export** | **Deterministic** DOCX (+ optional bundle) | Unlock final only when every row dispositioned | Draft for iteration; final for delivery |

## Key decisions

1. **Integrity over fluency** — Prefer Partial/No over a false Full map; fail closed on unverifiable quotes. Automated Pass ≠ attorney-ready.
2. **Deterministic where truth is checkable; model where judgment is required** — Rules/search for claim split, PDF retrieval, quote-on-page, edition lock, screenshot page-link, and export. Model for standard recommendation, mapping rationale/labels, AI Review, and Ask Agent. Tradeoff: lower hallucination and stable eval grain vs. less free-form claim parsing; LLM decompose is fallback only.
3. **Analyst Accept/Reject on every row before reviewed-final** — Commercial risk stays with the human; AI Review Passed alone never unlocks delivery. Tradeoff: slower ship vs. no silent “model said Passed” export. **AI Review** audits each mapped row (best-effort Passed / Needs Review) so analysts know where to look — not a substitute for disposition. Doing both now builds a row-level performance signal (where AI Review and analysts agree or diverge) so autonomy can be added in phases later — expand trust where the signal is strong, keep HITL where it is not.
4. **Split models by role** — Mapper vs reviewer via `MAPPER_MODEL` / `REVIEWER_MODEL` (demo ops: `gpt-4o-mini` / `gpt-4o`) so spend follows judgment risk.
5. **No blended quality score** — Frozen 3-row gold; criteria scored separately so averages cannot hide over-claim or label mismatch.

## Success metrics

v1 works for real users when an analyst can **trust the cites, finish a Claim 1 chart faster than by hand, and ship a reviewed Word chart without inventing evidence.**

| Signal (real-user outcome) | How we know |
|---|---|
| **Analysts trust the evidence** | Spot-check: opening View in Doc finds the quoted text on the cited page for ≥95% of rows that claim evidence |
| **Charts finish in hours, not days** | Median time from Create Chart → reviewed-final export for Claim 1 drops vs the team’s current manual baseline |
| **Wrong-domain standards are not charted by default** | Analysts keep the recommended standard most of the time; when they override, they leave a reason (override is normal, not failure) |
| **Over-claiming is rare** | False Full map rate stays low in expert review (Full rows that experts reclassify as Partial/No) |
| **Review is usable, not noisy** | Most rows clear AI Review or Accept/Reject in one pass; Ask Agent accepts that still pass quote+page checks |
| **Export is delivery-ready** | Reviewed-final Word is used in the next internal review cycle without retyping quotes from the PDF |

**Disclaimer:** LexNorm does not determine FRAND obligations or legal essentiality. Expert sign-off remains required for attorney use.

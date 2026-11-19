# PRD — LexNorm SEP Chart Builder (v1)

**Product:** LexNorm — Claim-1 SEP charting workbench for technical patent analysts  
**Demo patent:** [US10063856B2](https://patents.google.com/patent/US10063856B2/en) (Sony chroma QP extension for HEVC)  
**Standards in corpus:** ITU-T G.722.2 · ITU-T H.265 V10 · 3GPP TS 36.211  
**Owner outcome:** Defensible draft chart with verifiable quotes/screenshots — not a legal essentiality opinion

## Problem

Analysts hand-build SEP charts across thousand-page standards: pick the right standard/version, quote clauses, attach screenshots, and label Full / Partial / No. Slow, error-prone; LLMs invent clause numbers and quotes. Lumenci’s iLumOS already does evidence-of-use charts; this assessment is the **SEP-to-standard** variant.

## Users & job

- **Primary:** technical patent analyst / licensing or litigation support (not an attorney bot)
- **Job:** produce a limitation-level chart for Claim 1 that an expert can verify by opening the PDF

## Standards decision (must be evidenced, not hardcoded)

| Standard | Decision | Why |
|---|---|---|
| **H.265 V10** | **Select** | Patent extends HEVC chroma QP (0–51), picture/slice offsets |
| G.722.2 | Reject | Wideband speech / AMR-WB — wrong domain |
| TS 36.211 | Reject | LTE PHY — wrong domain |

Runtime still searches all three and writes recommend/reject rationales.

## Competitive landscape (one line each)

Patsnap / Solve / GreyB / Hashi ship SEP mapping depth; IPlytics scores declarations. **Differentiation here:** evidence integrity gates + separate review agent + analyst challenge/revise + evals as a first-class deliverable.

## V1 scope

In: Claim 1 only; Path A select→confirm→3-col chart; Evidence/Judge/Notes inspector; review agent; challenge/accept/reject; SEP Report comparison + Word export; run trace; internal evals vs labelled gold.  
Out: patent fetchers, auth, production infra, multi-claim portfolios, legal conclusions.

## Agent design & checkpoints

1. **Selection agent** — scores three standards; pauses for analyst confirm  
2. **Mapping agent** — element → quote + source (edition/clause/page) + screenshot + Full/Partial/No + gaps  
3. **Review agent** — before analyst review: quote verbatim, screenshot match, version/section, label↔rationale. Statuses: Passed · Needs Review - Correction · Review Incomplete · Needs Review - Ambiguous  
4. **HITL** — Apply recommended fix (one click, versioned + analyst audit) / View Evidence / Ask Agent / Edit / Request Revision / Rerun; Challenge / Accept / Reject; export draft anytime

## Chart format (market standard)

1. Claim element (verbatim, 1[a]…)  
2. Standard evidence — quote · source · screenshot  
3. Rationale + Full / Partial / No (Partial must state what is missing)

## Trade-offs

1. **Evidence integrity > fluent prose** — fail closed on fake quotes  
2. **Always-Partial bias safer than false Full** — under-mapping preferred to over-declaration  
3. **Mapper ≠ reviewer** — separate execution; analyst owns final disposition  
4. **Gold pack is 3 limitations; generator may split finer** — alignment/evals absorb mismatch (C06)  
5. **Reviewer on gpt-4o, mapper on gpt-4o-mini** — measured ~13× reviewer LLM unit cost vs mini (~+$0.025 / Claim-1 chart, ~$2.55 / 100 charts at OpenAI list rates). Absolute delta is small; quality gain (clearer Partial gaps, named No-map failures vs vague “unverified”) justifies it. Mapping volume stays on mini. Details: `docs/MODEL_COMPARISON.md` + `docs/model_compare/cost_measure.json`

## Success metrics

- % rows with verified quote + correct page  
- Per-criterion eval Pass vs gold (C01–C06)  
- Analyst time to first defensible draft / accept all Claim-1 rows  
- False Full rate (guardrail)  
- Challenge → successful revise without invented cites

## Non-goals / disclaimer

Technical Full map ≠ FRAND / essentiality conclusion. Attorney-ready only after expert sign-off.

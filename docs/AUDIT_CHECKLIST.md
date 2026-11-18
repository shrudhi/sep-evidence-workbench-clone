# Clause audit vs Updated brief (17 Nov 2026)

## Evidence failure — root cause (traced)

| Stage | Finding |
|---|---|
| Retrieval | Spans returned with valid IDs (logged in `integrity_json.checks`) |
| Mapper | Cited those IDs and wrote a support-style rationale |
| Integrity | Mix of pass/fail (`quote/offset mismatch` on some spans) |
| Persistence | **On any integrity failure, code cleared ALL `evidence_ids_json`** and set `Abstain` |
| API | Returned empty `evidence_ids` while rationale still described evidence |
| Frontend | Rendered “No linked passages yet” from empty `evidence_ids` |

**Repair:** keep only source-verified span IDs; do not wipe passing citations because a sibling failed; Abstain no longer strips IDs in the validator; API resolves `evidence_blocks` with quote/source/section/pages/screenshot URL.

## Requirement checklist (re-verified 17 Nov)

| Requirement | Status | How verified |
|---|---|---|
| 3-column chart with quotes/citations/screenshots in cell | **Verified** (H.265, TS 136 211) | Browser Claim charts shows Quote/Source/Reference + screenshot URLs; Word export `7511ee50-…-draft.docx` has 3 cols, Quote/Source/Reference, 14 embedded images |
| Element IDs 1[a]/1[b] | **Verified** | Chart API + UI + Word claim cell `1[a] \| An encoding apparatus` |
| Mapping vs review vs decision separated | **Verified** | Abstain → `analysis_status_label` “Analysis incomplete”; mapping badges Full/Partial/No map; review + analyst shown separately |
| Evidence never asserted without accessible IDs | **Verified** | Integrity keeps passing IDs; empty support cannot stay Full/Partial map |
| One chart per selected standard | **Verified** | `POST /api/runs` returned 3 ids; independent statuses; document-specific `/retry` |
| Human statuses | **Verified** | UI “Ready for analyst review”; API `status_label` |
| Split Evidence/Judge/Notes | **Verified** | Tabs live; notes persisted via `/api/elements/{id}/threads` |
| Challenge → real revision | **Verified** | Challenged H.265 `1[a]` → new revision `0e8bd07e-…` |
| Conclusion from real results | **Partial** | Per-document statuses; no hardcoded winner; comparison still manual |
| Word export with embedded screenshots | **Verified** | Landscape 3-col export with images for H.265 |
| Claim 1 across 3 standards fresh run | **Partial** | H.265 + TS 136 211 ready; G.722.2 still failing on decompose/provider intermittency after retries |

## Fresh run IDs (claim 1)

| Standard | Run | Status |
|---|---|---|
| H.265 | `7511ee50-830c-460c-914c-40f1c2afadc1` | Ready for analyst review (22 evidence blocks) |
| TS 136 211 | `8d55e12d-2e8c-47fb-935e-b0213741b48a` | Ready for analyst review (11 evidence blocks) |
| G.722.2 | latest retries failed | Provider timeout / JSON / decompose coverage — retry endpoint available |

## Remaining limitations

- G.722.2 chart not yet successfully completed in this session (provider timeouts then decompose gaps). Other charts remain usable.
- Screenshot highlight uses page bbox overlay (render-v2); visual QA of crop sufficiency is still manual.
- Evaluation workbook / criterion scores not generated in this repair pass.
- Max run budget raised to $1.50; model timeout to 180s in `.env`.

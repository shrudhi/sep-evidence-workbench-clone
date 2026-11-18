# Submission checklist

## Included in this repo

| Deliverable | Location |
|---|---|
| One-page PRD | [`docs/PRD.md`](PRD.md) |
| One-page user flow (+ 2 failure branches) | [`docs/USER_FLOW.md`](USER_FLOW.md) |
| Eval failure modes + production plan | [`docs/EVAL_FAILURE_MODES.md`](EVAL_FAILURE_MODES.md) |
| Working prototype | this workbench (`README.md` run steps) |
| Expected chart / gold pack | `evaluation_data/Expected_Claim1_Reference_Pack/` |

## Live demo artifacts (local run `a4d4d0c4-…`)

- Chart: H.265 V10 Claim 1, status `complete` after Accept-all
- Challenge: 1[a] remapped to revision `7964c100-…`
- Word: draft + final DOCX via `/api/runs/{id}/export`
- Trace: `/api/runs/{id}/trace` (100+ events)
- Eval rescore: C01–C05 **3/3 Pass**; C06 Fail on decomposition mismatch (documented)

## Still for you to publish

1. **Public repo / hosted demo URL** (GitHub + optional Railway/Fly/Render)
2. **&lt;5 min Loom/video** — Setup → recommend H.265 → chart → enlarge screenshot → challenge → accept → export
3. **Eval spreadsheet export** — Evaluations UI → export xlsx for eval `b302b124-…` (or re-run)
4. Paste public links into the recruiter form

## Suggested video script (~4 min)

1. Setup: three standards, Start → Recommended H.265 / Rejected G.722.2 & TS  
2. Confirm H.265 → Claim charts 3-col table  
3. Open AI Review on a row → show Passed/Sent back/Flagged, criterion cards, requirement class vs mapping label  
4. Use View Evidence / Ask Agent / Request Revision or Edit; Rerun Review  
5. Challenge or Accept remaining → Word export + trace (`ai_review_completed` events)  
6. Evaluations: show C01–C05 Pass, mention C06 / failure-modes doc  

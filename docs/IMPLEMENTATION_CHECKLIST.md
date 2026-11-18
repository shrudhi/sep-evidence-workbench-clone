# Clause implementation checklist

Derived from `docs/Clause_Cursor_Implementation_Brief.md` against the recovered
SEP Evidence Workbench (17 Nov 2026). Preserve working pipeline code; rebuild the
product shell and missing contracts toward the three-screen Clause UX.

## Assumptions

- Supplied H.265 file `T-REC-H.265-202407-S!!PDF-E.pdf` is the V10 (07/2024)
  edition; registered on disk as `sources/T-REC-H.265-202407-I.pdf` per README.
- Patent US10063856B2 remains the prepared assessment input (no free-form patent
  parsing in this slice).
- Provider credentials remain unset until the operator fills `.env`; retrieval and
  UI work continue without fake offline model results.
- UI references live in `docs/ui-references/`; mockup wording is not runtime data.

## Existing assets to keep

| Area | Status |
|---|---|
| FastAPI + SQLite + ingest/retrieval/workflow/export | Working prototype |
| Hybrid FTS5 + MiniLM embeddings + graph edges | Working |
| LangGraph run, challenge, decision, DOCX export | Working (provider-gated) |
| One-service Docker + README | Working |
| React single-page workbench | Functional but not Clause shell |

## Milestone checklist

### M0 — Inspect & corpus complete
- [x] Read brief + inspect FE/BE/config
- [x] Attach H.265 PDF + SHA-256 + manifest `available`
- [x] Re-ingest; health shows 3 indexed standards (H.265 728p / 3128 spans)
- [x] Local server health green after restart

### M1 — Shared shell + Setup
- [x] Design tokens (forest / ivory / sage / amber)
- [x] Persistent shell: logo, workspace, Setup / Claim charts / Conclusion, analyst
- [x] Setup: patent adapter (prepared US10063856B2), standards registry, suggestions
- [x] Claim scope All / Select (actual claims from input record)
- [x] Start analysis → immutable run snapshot; navigate to Claim charts
- [x] Persist selections server-side across refresh
- [ ] Notes backend persistence (stub empty state on Claim charts)
- [ ] Per-document parallel charts (current run still selects one target via workflow)

### M2 — Three-standard ingestion & retrieval verified
- [ ] All three standards indexed with screenshots/page labels
- [ ] Search returns H.265 / G.722.2 / TS 136 211 candidates
- [ ] Pending/unavailable handling remains honest

### M3 — Claim-1 headless prove-out (blocked without provider)
- [ ] Configure `MODEL_API_KEY`, `MAPPER_MODEL`, `REVIEWER_MODEL`
- [ ] One real claim-1 run across all three standards
- [ ] Separate reviewer + integrity checks + screenshots in trace

### M4 — Claim charts + Evidence / Judge / Notes
- [ ] Per-document chart tabs + status (Queued…Complete/Failed)
- [ ] Three-column chart with visible excerpts
- [ ] Mapping label ≠ automated review ≠ analyst decision
- [ ] Evidence tab: passages, pages, screenshots, coverage, challenge
- [ ] Judge tab: checks, assessment, score as triage only
- [ ] Notes tab: threads, local assignment, no fake notifications

### M5 — Decisions, revisions, multi-claim
- [ ] Accept/reject with history; challenge → new revision
- [ ] Additional claims / dependency context via same pipeline

### M6 — Conclusion & report + export
- [ ] Comparison table + conclusion from persisted evidence (no hardcoded winner)
- [ ] Unresolved findings → deep links to rows
- [ ] Word bundle + run trace; draft vs reviewed-final gating
- [ ] No Judge panel on screen 3

### M7 — Verify & harden
- [ ] Integrity failure tests (quote/edition/page/screenshot)
- [ ] Restart persistence; Dockerfile/README/health
- [ ] Milestone reports with measured usage only when available

## AI Review (simplified) — 2026-11-18

### What the review agent checks
1. Quote exists verbatim in the cited source  
2. Screenshot matches the quote  
3. Standard version and section are right  
4. Mapping label is consistent with the rationale  

### Overall statuses (exactly four)
| Status | Meaning |
|---|---|
| **Passed** | Mapping + evidence satisfy the checks |
| **Needs Review - Correction** | Specific fix recommended (label / rationale / remove cite) — **Apply recommended fix** one-click |
| **Review Incomplete** | Tech/model error; review did not finish |
| **Needs Review - Ambiguous** | Evidence needs human judgment |

### Completed
- [x] Four statuses above (+ compact four checks)
- [x] One-click `POST /api/rows/{id}/ai-review/apply-fix` → new revision, `ops_audit_events` + trace with analyst name
- [x] Versioned `ai_review_runs` / history; auto-run after map/challenge/edit; manual rerun
- [x] Panel: View Evidence, Ask Agent, Edit, Request Revision, Apply fix, Rerun
- [x] Unit tests: `backend/tests/test_ai_review.py`

### Remaining limitations
- [ ] Screenshot “match” is link/highlight based (not always-on vision OCR)
- [ ] Notes/threads tab still secondary on Path A charts

## Current blockers

1. **Public demo / video / form links** — still external to the repo.
2. **Notes/threads** — stub; not required for AI Review completion criteria above.

## Next concrete step after M0

Build shared shell + Setup against real `/api/documents` and patent-input adapter,
while keeping the existing ingest/retrieval/workflow modules.

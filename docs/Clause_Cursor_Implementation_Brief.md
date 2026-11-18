# Clause — complete Cursor implementation brief

Owner: Shrudhi Satya  
Project: Lumenci assessment  
Version: 17 November 2026 — incorporates the final three-screen decisions

## Instructions to Cursor

Read this entire document before implementation. Inspect the existing repository, dependencies, available source documents and attached UI references. Preserve useful existing work. Make routine implementation choices autonomously and document assumptions. Build the product, connect real behavior, verify it, and report results after each milestone.

This document defines implementation requirements, not completed functionality or measured accuracy. Do not reproduce illustrative scores, claim wording, sample comments, citations or mappings from the mockups as real results.

## 1. Product and scope

Build **Clause**, a patent-to-standard evidence workbench. An analyst selects a supplied patent, chooses claims and candidate standards, generates a separate chart for each standard, inspects original-source evidence, challenges mappings, records decisions, and exports the charts and comparison report.

Exactly three main menu screens:

1. **Setup**
2. **Claim charts**
3. **Conclusion & report**

The Claim charts screen has three tabs in its right-side inspector: **Evidence**, **Judge**, and **Notes**. These are states of screen 2, not additional menu screens. Do not add a standalone quality dashboard or LLM judge panel to screen 3.

### Assessment inputs

- Patent: US10063856B2, downloaded patent document and supplied claim text.
- H.265 V10, July 2024.
- G.722.2, July 2003.
- ETSI TS 136 211 V17.2.0, August 2022.

Use all three supplied standards in the default assessment run. The system must reach its selection from real searches and evidence; never hardcode the winner.

Treat patent acquisition and authoritative claim text as provided inputs. The assessment excludes patent fetching/parsing, authentication, user management and production infrastructure. A patent-input adapter should supply patent identity, document reference, claim numbers, exact claim text and dependencies. The upload UI can accept the supplied PDF and load its prepared input record. If an arbitrary patent has no prepared claim record, explain that limitation rather than pretending it was parsed. Make the adapter replaceable later.

Prioritize a complete genuine run for claim 1 across all three standards. Build the all-claims and multi-select controls to use actual available claims, and support additional selected claims through the same pipeline. Never silently replace an All claims request with claim 1 or fabricate unavailable claims.

## 2. Visual design and shared behavior

Follow the approved screenshots: forest-green navigation, warm ivory page background, white panels, fine gray-green borders, sage selected states, restrained amber warnings, readable body typography and an elegant editorial headline style.

Suggested design tokens:

| Token | Value / guidance |
|---|---|
| Navigation / primary | Deep forest, approximately #153E35 |
| Canvas | Warm ivory, approximately #F8F9F6 |
| Panels | White |
| Main text | Dark charcoal |
| Selected state | Pale sage with visible border |
| Review warning | Pale amber plus icon and text |
| Spacing | Consistent 4px/8px-based scale |
| Corners | Restrained 8–12px |

Build shared components and tokens; do not style every screen independently. Use thin consistent icons, visible keyboard focus and accessible labels. Do not communicate state through color alone. Keep text legible and control labels short. Avoid decorative charts, gradients, glass effects and excessive cards.

Persistent shell: logo/wordmark, project selector or current workspace, three navigation items, current analyst display identity, top project breadcrumb and save status. Do not add account-management functionality.

Target desktop document review first. At narrower widths, retain a usable table and allow the inspector to become a drawer/full-width panel. Keep chart and inspector independently scrollable, headers sticky and split width adjustable.

Provide loading, empty, failed, retrying, stale and completed states. Every button must have real behavior or clearly state why it is unavailable. Do not show fake success messages. Persist important work on the backend; local browser state alone is insufficient.

## 3. Screen 1 — Setup

### Layout

Left/main area: patent input, suggested/available standards and standard upload. Right: Analysis scope, populated after the patent input is ready. Bottom: selection summary and **Start analysis** button.

### Patent input

1. Show an upload/browse area or the preloaded assessment patent.
2. After input is ready, show filename, patent identifier and readiness, plus Replace.
3. Populate the right-side scope from the authoritative patent-input record.
4. Replacing the patent must warn before invalidating incompatible selections, while preserving completed historical runs.
5. If loading fails, show a useful error and retry action.

### Suggested standards

Maintain a standard registry: name, exact edition, description, source reference, file hash and index status.

Use patent subject/description and each available standard's description to suggest candidates. A suggestion is preliminary relevance, not the final standard recommendation. Show **Suggested** with a short reason, while keeping non-suggested standards selectable.

Support:

- Search by standard name, edition and description.
- Multi-select checkboxes.
- Selecting suggested and non-suggested documents together.
- Uploading additional standard PDFs.
- Upload/indexing/ready/error states and retry.
- Duplicate detection by source hash; different editions stay distinct.

Select the three supplied standards in the default assessment setup. Do not force a single selection. Explain: “Suggestions are preliminary. You control the selection.”

### Analysis scope

Appear after the patent record is ready. Show patent identity, claim scope, selected standards and expected output.

Provide **All claims** or **Select claims**. Selecting individual claims reveals a searchable multi-select list with claim number, short preview and access to full text. Show actual selected counts. All claims must include all claims exposed by the supplied input record.

For dependent claims, resolve inherited limitations recursively with provenance. Show the inherited context distinctly. Prevent dependency cycles or missing parent claims from being silently ignored.

### Start action

Enable only when the patent is ready, at least one claim and one standard are selected, and documents are indexed. Show a summary such as “4 claims · 3 standards”. Do not invent claim counts.

On click, persist an immutable run snapshot of claims and exact document editions, create a job, navigate to screen 2 and display real progress. Prevent accidental duplicate submissions. Changes to Setup affect a new run, not an existing run's evidence.

### Acceptance

Selections survive refresh. New standard uploads become searchable after ingestion. A run uses exactly the selected claims and source versions. Unavailable patent parsing is not disguised as successful analysis.

## 4. Screen 2 — Claim charts

### Main layout

Document tabs at top, claim selector and filters underneath, required chart on the left and resizable/collapsible inspector on the right. The inspector has **Evidence**, **Judge** and **Notes** tabs.

Create one chart per selected standard. Show real document status: Queued, Searching, Mapping, Reviewing, Complete or Failed. Charts become available as each document finishes. A failed document must not discard completed charts; allow document-specific retry without overwriting analyst work.

### Required chart

Exactly three principal columns:

| Claim element | Standard evidence | Rationale & mapping |
|---|---|---|
| Identifier and exact claim text | Verbatim excerpts, source citations, screenshots/preview access and linked passages | Explanation, missing conditions, Full map / Partial map / No map |

Show actual evidence excerpts in the chart; do not hide all evidence behind the inspector. Long text can expand. Keep full claim text available. Include a source screenshot thumbnail or compact preview that opens the original passage.

Separate these concepts in both data and UI:

- **Mapping label:** Full map, Partial map, No map.
- **Automated review:** Pending, Passed, Rework, Needs review, Failed.
- **Analyst decision:** Unreviewed, In review, Accepted, Rejected.

Accept means agreeing with the row's analysis; a justified No map can be accepted. Automated pass never means analyst acceptance. A retrieval failure is not automatically No map.

### Filters

All rows, Needs review, Unreviewed, Accepted, Rejected, mapping label, claim number, priority, and text search across claim/evidence/rationale. Counts must reflect the current document and filters. A Needs review filter should expose the reason on every row.

### Row interactions

- Click row: select it and open inspector.
- Review: set In review and open the relevant evidence/findings.
- Accept: save a decision for that exact revision.
- Reject: collect a brief reason; retain history.
- Edit: modify rationale/label through a clear edit action; semantic edits trigger review again.
- Comment: open Notes anchored to that element.

Save revisions and decisions transactionally. Preserve selected document, claim, row, filters and tab across navigation. Do not silently replace accepted revisions. Priority must be analyst-set or based on transparent rules, not invented legal importance.

## 5. Screen 2A — Evidence inspector

### Source details

Show exact standard/edition, section/clause, PDF page ordinal, printed page label, verbatim quote, original-page screenshot with highlight, and **Open full page**. PDF and printed page numbers are different fields.

Render evidence images from the actual document. Never use generated imagery or manually invented technical text as source evidence.

### Multiple passages and references

A row may depend on multiple pages, sections, tables or equations. Provide numbered passage chips, Previous/Next passage, “Passage 1 of N”, clickable cross-references and Back to previous passage. Explain the role of a passage: definition, condition, operation, table, equation or scope.

Distinguish passage navigation from next/previous physical PDF page. Preserve selected row and navigation history. Open unresolved references with an explicit unavailable state rather than linking to an invented section.

### Requirement coverage

Break the element into requirements: actor, operation, inputs, relationships, ranges and conditions. Show Supported, Partially supported or Not established, with linked evidence. Full map is not allowed when a required condition remains unsupported.

### Challenge workflow

Input: **Challenge this mapping**. The analyst can question a passage, ask for more support, challenge the label, point to indexed documents or add supplementary documents.

On submit:

1. Persist the challenge.
2. Run real search/tool calls.
3. Propose a new row revision.
4. Run source checks and a separate reviewer.
5. Show old/new evidence, rationale, label and outstanding gaps.
6. Let the analyst accept the revision or keep the previous version.

Supplementary documents stay separately attributed; they cannot silently replace normative standard evidence. If no adequate evidence is found, show searched/rejected candidates and limitations. No map must not contain fabricated support. A failed search should produce an explicit unresolved search state.

## 6. Screen 2B — Judge inspector

Show row-specific automated review, not a general dashboard. Use a separate reviewer execution with original claim/source inputs. It may share a provider with the mapper initially, but disclose correlated-error limitations in engineering/evaluation notes.

### Visible sections

1. Outcome: Passed, Rework, Needs review or Failed.
2. Optional **Estimated judge score**, 0–100, derived from an explicit rubric with visible criterion results. This measures analysis quality, not mapping strength or essentiality probability. A correct No map may score highly.
3. **Source checks**, performed by code where possible: quote presence, edition, section/page and screenshot provenance/alignment.
4. **Judge assessment**: requirement coverage, actor/operation correctness, conditions/ranges, rationale support, label correctness and contradictory/missing evidence.
5. Why review is needed; missing support; recommended next action; evidence links.

Use configurable provisional thresholds. Never claim an uncalibrated score is a probability. Before sufficient evaluation, the score is a triage aid, not a gate proving correctness.

### Actions and rules

- Inspect evidence switches to the relevant Evidence passage.
- Re-run review creates a new review record for the current row revision.
- Search again opens the challenge workflow.
- Accept/Reject records the analyst decision.
- Any failed integrity check triggers review regardless of score.
- Low estimated quality or material ambiguity triggers review.
- High-priority uncertain rows sort first in the queue.
- Maximum two automatic reworks per row; then flag unresolved findings.

Every review binds to a specific revision. Show timestamp and model ID in expandable details. Semantic/evidence changes invalidate previous review and require renewed analyst acceptance; simple notes do not invalidate the analysis.

## 7. Screen 2C — Notes inspector

Provide anchored document-review threads, not a chatbot. Each thread records author/display identity, timestamp, element anchor, optional evidence anchor, comments/replies, optional reviewer assignment and Open/Resolved status.

Support add note, reply, edit/delete current author's comment, resolve/reopen, open/all filter and jumping to anchored evidence. Show thread counts on chart rows. Preserve original anchors and revision references after the chart changes; mark outdated anchors.

Resolving a thread does not accept the row. Keep human discussion distinct from generated analysis.

For this single-user assessment prototype, save reviewer-name assignment locally on the backend. Do not fabricate colleagues, replies or delivered notifications. Real @mentions, notifications, user identities and shared access are a later extension; do not build full authentication for this submission. Display that assignment has been saved, not that somebody was notified.

Persist notes and threads across refresh/restart. Empty state: “Add the first note for this claim element.” If no attachment handling is implemented, do not render a dead attachment control.

## 8. Screen 3 — Conclusion & report

This screen contains comparison, final conclusion, unresolved findings and export. **No LLM judge evaluation panel or quality dashboard.**

### Comparison table

For every selected standard show exact name/edition, completion status, Recommended target / Not recommended / Inconclusive, explanation, analyzed-claim coverage, important limitations and View chart.

An unfinished/failed run is Incomplete/Failed, not Not recommended. Let the analyst open or retry that document. Conclusions may be provisional while selected documents remain incomplete.

### Final conclusion

Generate from actual persisted evidence, chart revisions and analyst decisions. Explain which target is strongest, why, why alternatives were rejected, and what remains unresolved. Do not average judge scores into an essentiality percentage. A relevant standard does not establish that every limitation fully maps.

Link unresolved findings to the exact document, claim and element on screen 2. If source analyses change, mark the report Out of date and offer Regenerate conclusion. Snapshot/version exports so current reports never silently contain stale content.

### Export chart bundle

Let users choose individual standard charts, comparison/conclusion and optional analyst notes. Retain the three-column skeleton, exact claim text, quotes, citations/edition, real screenshots, mapping labels/rationales and analyst disposition.

Provide **Download Word bundle** and **Download run trace**. A single Word document can contain a section per chosen standard plus the comparison and disposition appendix; no unnecessary zip requirement. Draft export is allowed with visible unresolved findings. Reviewed-final export requires explicit disposition of all included rows, with rejected/excluded rows preserved in an appendix.

Show progress, filename and actionable export failure. Generate from current persistent revisions. Test long text, repeated headings, image sizing and page breaks in the actual exported document.

## 9. Architecture and retrieval

Recommended starting stack; preserve equivalent working choices already in the repository:

| Layer | Direction |
|---|---|
| Frontend | React + TypeScript; shared components/design tokens |
| API | FastAPI + Pydantic |
| Workflow | LangGraph or explicit persisted state machine |
| Persistence | SQLite; transactions; WAL; persistent deployment disk |
| Retrieval | SQLite FTS5 + vector search + document-relationship expansion |
| PDF | pdfplumber + pypdfium2; selective Docling fallback |
| Embeddings | Local short-span embedding model; precomputed corpus vectors |
| Models | Configurable server-side provider/model adapter |
| Export | python-docx |
| Deployment | Docker, one service serving API and built frontend where feasible |

Verify dependencies, licenses and model input limits at implementation. Example reusable upstreams: https://github.com/jsvine/pdfplumber, https://github.com/pypdfium2-team/pypdfium2, https://github.com/docling-project/docling, https://github.com/langchain-ai/langgraph, https://github.com/python-openxml/python-docx. Preserve required notices and inspect bundled PDF/model licenses.

### Ingestion

Preserve immutable originals, SHA-256, exact edition, raw page text, text offsets, bounding boxes, heading hierarchy, tables/equations/figures, PDF ordinal and printed label. Create separate search-normalized text without overwriting canonical raw evidence. Precompute expensive ingestion outside user-facing HTTP requests.

### Document graph

Store Section, Definition, Table, Equation, Figure and EvidenceSpan nodes, with explicit CONTAINS, REFERENCES, DEFINES and ordering relationships. A relational edge table is sufficient; no dedicated graph server is required. Extract authoritative edges from document structure/explicit references. Record unresolved edges and provenance; LLM guesses must not become authoritative links.

### Retrieval

1. Keyword and vector retrieval; merge candidate ranks.
2. Use short section-aware windows within the selected embedding model's token limit.
3. Preserve parent section IDs so windows can expand to relevant context.
4. Follow definitions, parent scope, tables and explicit cross-references with bounded hops/context.
5. Search for counterevidence and optional conditions, not only apparent support.
6. Return canonical span IDs; resolve citations/screenshots through code.

If using all-MiniLM-L6-v2, account for its default 256-word-piece truncation; do not embed a multi-page section as one unbounded input. Measure retrieval performance; do not assume graph use alone improves accuracy.

### Mapping policy

- Full map: evidence supports every requirement without an unstated implementation assumption.
- Partial map: identify exactly what is missing or conditional.
- No map: no adequate mapping established after a documented search; do not assert universal absence.
- Retrieval/extraction failure: separate unresolved state.

Keep normative/informative/optional status separate from mapping labels. Similar equations are not enough if the actor, processing direction, range or condition differs. Mathematically significant characters must not disappear in quote normalization. Flag unreliable extraction and inspect original page crops.

## 10. Persistence and API contracts

Minimum records: Project, PatentInput, Claim, ClaimDependency, DocumentVersion, Section, EvidenceSpan, GraphEdge, Run, RunDocument, ClaimElement, Requirement, RowRevision, ReviewResult, AnalystDecision, CommentThread, Comment, ReportRevision, Export and TraceEvent.

Bind evidence to source hash/edition and reviews/decisions to row revisions. Evidence records need raw span offsets, page and bounding boxes. A changed source version invalidates dependent evidence; do not carry acceptance forward silently.

Suggested endpoints, adapt naming to the repository:

- GET /standards; POST /sources; GET /sources/{id}/status
- POST /projects/{id}/patent-input; GET /projects/{id}/claims
- POST /runs; GET /runs/{id}; GET /runs/{id}/events
- GET /runs/{id}/charts; GET /evidence/{id}
- POST /rows/{id}/challenge; POST /rows/{id}/review
- POST /rows/{id}/decision; GET /rows/{id}/revisions
- GET/POST /rows/{id}/threads; POST /threads/{id}/replies
- PATCH /threads/{id}; POST /runs/{id}/report
- POST /runs/{id}/exports; GET /exports/{id}
- GET /runs/{id}/trace

Use stable IDs, typed schemas and consistent errors. Use polling or server events for jobs, not a single long blocking browser request. Prevent duplicate start/challenge submissions. Background work must expose failures and recover interruption honestly.

## 11. Model calls, cost and traces

Make real model/tool calls. Keep provider/model IDs configurable; choose the active model only after availability and structured-output checks. API keys stay server-side and out of logs. Do not claim the model ran if credentials are unavailable.

Separate selector, mapper and reviewer responsibilities. Persist concise decision explanations, tool inputs/results, evidence IDs, prompt/model versions, usage, latency, retries and errors; do not request or store hidden chain-of-thought.

Cache ingestion, vectors and page images by hash. Send bounded evidence bundles rather than whole standards. Recompute the challenged row and dependent report state, not the whole project. Bound tool calls/rework and enforce conservative per-run/global token budgets. Show actual measured usage instead of fictional cost estimates. Make cached runs visibly historical; support a genuine fresh run.

For a public prototype, limit uploads and concurrent runs, isolate session data, redact secrets and cap API consumption. Treat source documents as data, not instructions. Avoid unrestricted URL fetching; pointing to indexed documents meets the immediate workflow. Keep demo data public/non-confidential; full collaboration/auth is out of scope.

## 12. Implementation sequence

1. Inspect repository and source availability; create a concise implementation checklist.
2. Build shared shell and Setup with persistence.
3. Implement canonical standard ingestion and retrieval for all three documents.
4. Prove one real claim-1 analysis, including separate review and screenshots, headlessly.
5. Connect screen 2 and its three inspector tabs.
6. Implement real challenge/revision, decisions and notes.
7. Enable additional available claims/dependency context through the same pipeline.
8. Implement screen 3, current-version reports and Word/trace export.
9. Verify persistence, deployment and end-to-end behavior; refine visual layout.
10. Run labelled evaluations and prepare submission artifacts outside the main navigation.

Do not spend all available effort polishing mock screens before the real pipeline works. If blocked, identify the exact missing input or credential and continue independent work. Do not silently cut agreed features; report what is working, partial or blocked.

## 13. Definition of done and verification

### Functional

- Setup suggestions use descriptions and remain editable.
- Actual all-claims/multi-claim selection and three-standard run snapshots are honored.
- Every selected document has an independent chart/status.
- Decomposed elements preserve selected claim text and inherited requirements.
- Quotes, citations and images resolve to actual source editions/pages.
- Evidence links, next/previous passage and back navigation work.
- The Judge tab shows actual revision-specific checks and findings.
- A real challenge creates a reviewed revision with visible differences.
- Analyst decisions and notes survive refresh/restart.
- Report recommendations cite actual analysis and do not disguise failures as rejection.
- Word exports preserve quotes/screenshots/labels and all dispositions.
- No judge panel appears on screen 3.
- No fake notifications, fabricated replies or hardcoded charts.

### Failure tests

Test altered quote/number/sign, wrong edition, PDF/printed-page mismatch, unrelated screenshot, optional-as-mandatory interpretation, decoder-as-encoder interpretation, unresolved cross-reference, document prompt injection and provider timeout. Deterministic checks should visibly fail or flag corrupt evidence. Semantic tests require explicit expected reasoning, not merely matching schema.

### Evaluations

The assessment's evaluation work remains required even without a quality menu. Keep independent expected labels outside runtime. Report correct standard, verbatim quotation, source/page, screenshot match, rationale support and label correctness separately. Include failures, abstentions and sample-size limitations. Self-labelled claim 1 is provisional, not attorney-validated gold.

### Deployment

Pin tested dependencies, include Dockerfile and setup instructions, environment example without secrets, source manifest, build-time ingestion command, runtime command and health/readiness checks. Use persistent storage for SQLite/revisions/artifacts. Verify restart behavior and a fresh run through the live URL. Do not claim deployment without observing it.

### Milestone reports

After each stage state: changes, checks actually run, results, measured usage where available, remaining limitations and next step. Final delivery includes working code, README, genuine run trace, actual exported chart, reproducible evaluation commands/results and deployment details. Never invent accuracy, performance or completeness.

## 14. UI references and precedence

Attach the latest approved Setup and Conclusion screenshots and the separate Evidence, Judge and Notes screenshots if available. References define visual style/layout, not authoritative technical evidence. This brief defines behavior and resolves differences between mockups. If images are unavailable, implement from this self-contained specification rather than blocking.

Latest decisions to preserve: three menus only; standard suggestions before analysis remain user-editable; all-claims/multi-select scope; separate charts per document; two-pane chart with linked evidence; row review/accept/reject; local notes/assignment; Judge only on screen 2; final standard comparison and export on screen 3.

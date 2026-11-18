# SEP Evidence Workbench

A runnable, source-grounded prototype for comparing patent claim 1 against every
indexed technical standard, preserving evidence lineage, independently reviewing
each mapping, and exporting analyst-dispositioned Word charts.

The workbench does **not** make a legal essentiality determination. Automated
review and integrity checks do not equal analyst acceptance.

## What works

- Immutable source registry with SHA-256 verification, exact editions, pending-source
  state, page ordinals, inferred printed labels, word bounding boxes, and raw text.
- Deterministic heading graph with `CONTAINS`, `NEXT`, and explicit `REFERENCES`
  edges. Unresolved references remain visible.
- SQLite FTS5 and local `sentence-transformers/all-MiniLM-L6-v2` embeddings,
  NumPy cosine scoring, reciprocal-rank fusion, and bounded graph context.
- LangGraph workflow that evaluates **all currently indexed standards**, decomposes
  exact claim 1 with offset/coverage validation, maps each element, runs
  deterministic evidence checks, and makes a separate reviewer model call.
- At most two mapper reworks after the first proposal. Unresolved rows are flagged
  and the run pauses for explicit analyst review.
- Revision-preserving challenge flow, immutable accepted revisions, accept/reject
  decisions, trace records, and draft/final export rules.
- Per-call token reservation against a configurable per-run cost cap, one-active-run
  concurrency, a persistent global run quota, provider timeout, and bounded output.
- DOCX chart with the required three columns, citations, source-page screenshots,
  screenshot lineage, independent review findings, and disposition appendix.
- One-service Docker image: FastAPI serves the built React/TypeScript frontend.

Only G.722.2 (07/2003) and TS 36.211 V17.2.0 are currently attached as standards.
H.265 V10 (07/2024) has a clean `pending` entry in `sources/manifest.json`; it is
excluded from target selection until its exact PDF and SHA-256 are supplied.
Partial-corpus runs are explicitly recorded as non-final, and reviewed-final
export is blocked unless the run snapshot included every manifest standard.

## Run locally

Requires Python 3.12 and Node 22.

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
(cd frontend && npm install && npm run build)
.venv/bin/python -m backend.app.ingest
.venv/bin/uvicorn backend.app.api:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Ingestion is deliberately a build/preparation step,
not an HTTP request. It verifies every source hash before indexing.

For frontend hot reload, run `npm run dev` in `frontend/`; Vite proxies `/api` to
the API on port 8000.

## Configure real model calls

No chart or target is hardcoded and there is no fabricated offline-model mode.
Without credentials, retrieval remains live and the run button reports the exact
missing configuration.

```bash
cp .env.example .env
# Set these server-side; never put them in frontend variables:
MODEL_API_KEY=...
MODEL_API_BASE=https://generativelanguage.googleapis.com/v1beta/openai
MAPPER_MODEL=<an available structured-output model ID>
REVIEWER_MODEL=<an available structured-output model ID>
```

The adapter uses the OpenAI-compatible `/chat/completions` contract with JSON
output. The reviewer call is a separate HTTP execution and can use a distinct
model ID. Verify the chosen provider/model IDs with a structured-output smoke test
before a substantive run. Provider credentials are never written to traces.

## Docker

```bash
docker build -t sep-evidence-workbench .
docker run --rm -p 8000:8000 \
  --env-file .env \
  -v sep-workbench-data:/app/data \
  sep-evidence-workbench
```

The image precomputes the source index and local embeddings once. On first startup
it seeds the persistent volume. SQLite uses WAL and the API runs one worker.

## Add the pending H.265 source

1. Place the exact ITU-T H.265 V10 (07/2024) PDF at
   `sources/T-REC-H.265-202407-I.pdf`.
2. Compute its SHA-256 and place that value in the existing H.265 manifest entry.
3. Change only that entry's status from `pending` to `available`.
4. Run `.venv/bin/python -m backend.app.ingest`.

The next run will select among all three indexed standards. No code or prompt
change is required.

## API highlights

- `GET /api/health` — registry, index, embedding, and provider readiness.
- `POST /api/search` — hybrid retrieval over chosen/all indexed documents.
- `POST /api/runs` — create a bounded model run.
- `GET /api/runs/{id}/chart` and `/events` — chart revisions and trace.
- `POST /api/rows/{revision}/challenge` — fresh retrieval, mapping, and review.
- `POST /api/rows/{revision}/decision` — accept or reject.
- `GET /api/evidence/{span}/screenshot` — canonical original-PDF page render.
- `POST /api/runs/{id}/export?final=false` — DOCX; final requires every decision.

Interactive API documentation is at `/docs`.

## Verification

```bash
.venv/bin/ruff check backend tests
.venv/bin/pytest
(cd frontend && npm run build)
```

The tests cover manifest hashes, wrong-edition/cross-document evidence, altered
quotes and offsets, page/bounding-box integrity, Full-map completeness, and final
export gating. Provider timeout behavior is isolated in the adapter and reported
as a failed trace event; live provider calls require the configuration above.

## Current limitations

- H.265 V10 is not attached, so a compliant three-standard live selection cannot
  be demonstrated yet.
- This environment contains no provider credential; no live model call, model
  usage, mapping result, cost, or accuracy metric is claimed.
- Printed page labels and heading hierarchy are deterministic heuristics and may
  need analyst correction for unusual layouts. Equations are flagged for visual
  inspection.
- Page screenshots are canonical full-page renders rather than highlighted crops.
- Session-scoped analyst PDF upload/pointers are not implemented in this slice.
- Cost accounting uses configurable token rates and provider-reported usage; it is
  an engineering guard, not a provider billing guarantee.
- Public deployment should be reviewed for source redistribution terms before
  exposing full-page standards images.
- The corpus is too small to support accuracy claims; expert-adjudicated labels
  must remain outside runtime and are not included here.

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import get_settings

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('patent','standard')),
  family TEXT NOT NULL,
  title TEXT NOT NULL,
  edition TEXT NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('available','pending','indexed','failed')),
  page_count INTEGER,
  extraction_version TEXT,
  indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_ordinal INTEGER NOT NULL,
  printed_label TEXT,
  raw_text TEXT NOT NULL,
  width REAL,
  height REAL,
  extraction_status TEXT NOT NULL DEFAULT 'ok',
  UNIQUE(document_id, page_ordinal)
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK(node_type IN
    ('DocumentVersion','Section','Definition','Table','Figure','Equation','EvidenceSpan')),
  label TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  parent_id TEXT REFERENCES nodes(id),
  provenance TEXT NOT NULL DEFAULT 'deterministic'
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('CONTAINS','REFERENCES','DEFINES','NEXT')),
  target_label TEXT,
  provenance TEXT NOT NULL,
  resolution_status TEXT NOT NULL CHECK(resolution_status IN ('resolved','unresolved')),
  UNIQUE(from_id, to_id, edge_type, target_label)
);

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES nodes(id),
  page_ordinal INTEGER NOT NULL,
  printed_label TEXT,
  raw_text TEXT NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  bbox_json TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  embedding_hash TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS spans_fts USING fts5(
  span_id UNINDEXED,
  document_id UNINDEXED,
  section_label,
  raw_text,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_run_id TEXT REFERENCES runs(id),
  target_challenge TEXT,
  status TEXT NOT NULL,
  target_document_id TEXT REFERENCES documents(id),
  target_decision_json TEXT,
  claim_text TEXT,
  claim_start INTEGER,
  claim_end INTEGER,
  model_config_json TEXT NOT NULL,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_elements (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  label TEXT NOT NULL,
  exact_text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  requirements_json TEXT NOT NULL,
  UNIQUE(run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS row_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL REFERENCES claim_elements(id) ON DELETE CASCADE,
  prior_revision_id TEXT REFERENCES row_revisions(id),
  revision_number INTEGER NOT NULL,
  mapping_label TEXT NOT NULL CHECK(mapping_label IN ('Full map','Partial map','No map','Abstain')),
  evidence_ids_json TEXT NOT NULL,
  counterevidence_ids_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  missing_requirements_json TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  integrity_json TEXT NOT NULL,
  model_name TEXT,
  prompt_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_results (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES row_revisions(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK(disposition IN ('pass','rework','flag')),
  checks_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  model_name TEXT,
  prompt_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyst_decisions (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES row_revisions(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK(disposition IN ('accept','reject')),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY,
  run_id TEXT,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL,
  tool_name TEXT,
  arguments_json TEXT,
  result_summary_json TEXT,
  model_name TEXT,
  prompt_hash TEXT,
  latency_ms INTEGER,
  usage_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spans_document ON spans(document_id);
CREATE INDEX IF NOT EXISTS idx_spans_page ON spans(page_id);
CREATE INDEX IF NOT EXISTS idx_nodes_document ON nodes(document_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_trace_run ON trace_events(run_id, id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_label TEXT NOT NULL,
  analyst_display_name TEXT NOT NULL,
  patent_input_id TEXT,
  claim_scope TEXT NOT NULL DEFAULT 'all'
    CHECK(claim_scope IN ('all','select')),
  selected_claim_numbers_json TEXT NOT NULL DEFAULT '[]',
  selected_standard_ids_json TEXT NOT NULL DEFAULT '[]',
  active_run_id TEXT,
  save_status TEXT NOT NULL DEFAULT 'saved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  patent_input_id TEXT NOT NULL,
  patent_identifier TEXT NOT NULL,
  claim_scope TEXT NOT NULL,
  selected_claims_json TEXT NOT NULL,
  selected_standard_ids_json TEXT NOT NULL,
  document_editions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comment_threads (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES claim_elements(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES row_revisions(id),
  evidence_id TEXT,
  author_display_name TEXT NOT NULL,
  assigned_reviewer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('element','standard')),
  document_id TEXT NOT NULL,
  element_id TEXT REFERENCES claim_elements(id),
  claim_number INTEGER,
  scope_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  intent TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  progress_json TEXT,
  evidence_refs_json TEXT,
  base_revision_id TEXT,
  proposal_id TEXT,
  usage_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL REFERENCES claim_elements(id),
  base_revision_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','stale')),
  challenge TEXT NOT NULL,
  current_mapping_label TEXT,
  proposed_mapping_label TEXT,
  proposed_payload_json TEXT NOT NULL,
  review_json TEXT,
  explanation TEXT,
  rejection_reason TEXT,
  accepted_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or get_settings().database_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def init_db(path: Path | None = None) -> None:
    with connect(path) as connection:
        connection.executescript(SCHEMA)


@contextmanager
def transaction(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    connection = connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def add_trace(
    connection: sqlite3.Connection,
    *,
    run_id: str | None,
    event_type: str,
    state: str,
    tool_name: str | None = None,
    arguments: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    model_name: str | None = None,
    prompt_hash: str | None = None,
    latency_ms: int | None = None,
    usage: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO trace_events(
          run_id,event_type,state,tool_name,arguments_json,result_summary_json,
          model_name,prompt_hash,latency_ms,usage_json,error,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            run_id,
            event_type,
            state,
            tool_name,
            dumps(arguments) if arguments is not None else None,
            dumps(result) if result is not None else None,
            model_name,
            prompt_hash,
            latency_ms,
            dumps(usage) if usage is not None else None,
            error,
            utcnow(),
        ),
    )

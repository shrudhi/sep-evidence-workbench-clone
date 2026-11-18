"""Operational tables: automation policy, review tasks, exports, email delivery."""

from __future__ import annotations

from .database import connect, init_db

OPS_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_automation (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'review_before_send'
    CHECK(mode IN ('review_before_send','send_when_checks_pass')),
  recipients_json TEXT NOT NULL DEFAULT '[]',
  notify_review_required INTEGER NOT NULL DEFAULT 1,
  notify_analysis_completed INTEGER NOT NULL DEFAULT 1,
  attach_word_bundle INTEGER NOT NULL DEFAULT 1,
  additional_formats_json TEXT NOT NULL DEFAULT '[]',
  require_human_approval INTEGER NOT NULL DEFAULT 1,
  max_repair_attempts INTEGER NOT NULL DEFAULT 1,
  policy_summary TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_automation_overrides (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_automation_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT,
  mode TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  notify_review_required INTEGER NOT NULL,
  notify_analysis_completed INTEGER NOT NULL,
  attach_word_bundle INTEGER NOT NULL,
  additional_formats_json TEXT NOT NULL,
  require_human_approval INTEGER NOT NULL,
  max_repair_attempts INTEGER NOT NULL,
  policy_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT,
  element_id TEXT REFERENCES claim_elements(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES row_revisions(id),
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','resolved','dismissed')),
  assigned_reviewer TEXT,
  resolution_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS attention_items (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','resolved','dismissed')),
  action_hint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_exports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  revision_fingerprint TEXT NOT NULL,
  path TEXT NOT NULL,
  designation TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('generating','current','stale','failed')),
  human_reviewed INTEGER NOT NULL DEFAULT 0,
  automated_checks_passed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  report_export_id TEXT REFERENCES report_exports(id),
  kind TEXT NOT NULL CHECK(kind IN ('review_notification','completion','updated_report')),
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN (
      'queued','sending','provider_accepted','delivered','failed','unknown','not_configured'
    )),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT,
  provider_message_id TEXT,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  coalesced_task_ids_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS delivery_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  eligible INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  policy_mode TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  element_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_excluded INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ops_audit_events (
  id INTEGER PRIMARY KEY,
  run_id TEXT,
  project_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_tasks_run ON review_tasks(run_id, status);
CREATE INDEX IF NOT EXISTS idx_attention_open ON attention_items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_email_run ON email_deliveries(run_id, kind, status);
"""


def ensure_ops_schema() -> None:
    init_db()
    with connect() as connection:
        connection.executescript(OPS_SCHEMA)
        # Extend runs with operational status columns if missing
        cols = {row[1] for row in connection.execute("PRAGMA table_info(runs)").fetchall()}
        alterations = []
        if "verification_status" not in cols:
            alterations.append(
                "ALTER TABLE runs ADD COLUMN verification_status TEXT DEFAULT 'pending'"
            )
        if "human_review_status" not in cols:
            alterations.append(
                "ALTER TABLE runs ADD COLUMN human_review_status TEXT DEFAULT 'not_required'"
            )
        if "export_status" not in cols:
            alterations.append(
                "ALTER TABLE runs ADD COLUMN export_status TEXT DEFAULT 'not_generated'"
            )
        if "delivery_status" not in cols:
            alterations.append(
                "ALTER TABLE runs ADD COLUMN delivery_status TEXT DEFAULT 'not_requested'"
            )
        if "review_ready_at" not in cols:
            alterations.append("ALTER TABLE runs ADD COLUMN review_ready_at TEXT")
        for sql in alterations:
            connection.execute(sql)
        connection.commit()

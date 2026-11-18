"""Analyst chart-row edits: manual evidence, authorship labels, change logs, revert."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from .database import connect, dumps, transaction, utcnow

Origin = Literal["ai", "human", "ai_fix", "agent"]

CHANGE_LOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS row_change_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  prior_revision_id TEXT,
  origin TEXT NOT NULL,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_row_change_logs_element
  ON row_change_logs(element_id, created_at);
CREATE INDEX IF NOT EXISTS idx_row_change_logs_revision
  ON row_change_logs(revision_id);
"""


def ensure_chart_edit_schema() -> None:
    with connect() as connection:
        connection.executescript(CHANGE_LOG_SCHEMA)


def revision_origin(model_name: str | None, *, edit_meta: dict[str, Any] | None = None) -> Origin:
    if edit_meta and edit_meta.get("origin") in {"ai", "human", "ai_fix", "agent"}:
        # Analyst-accepted Ask agent updates are treated as manual/human-controlled.
        if edit_meta["origin"] == "agent":
            return "human"
        return edit_meta["origin"]  # type: ignore[return-value]
    name = (model_name or "").lower()
    # Ask agent proposals are applied only after analyst Accept → Manual.
    if "ask-agent" in name or name.startswith("agent") or "analyst" in name or name.startswith("human"):
        return "human"
    if "ai-review" in name or "ai_review" in name:
        return "ai_fix"
    return "ai"


def origin_label(origin: Origin | str | None) -> str:
    return {
        "ai": "AI",
        "human": "Manual",
        "ai_fix": "AI fix applied",
        "agent": "Manual",
    }.get(str(origin or "ai"), "AI")


def empty_edit_meta(*, origin: Origin = "human", actor: str = "Analyst") -> dict[str, Any]:
    return {
        "origin": origin,
        "actor": actor,
        "manual_evidence": [],
        "evidence_overrides": {},
    }


def edit_meta_from_checks(checks: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(checks, dict):
        return empty_edit_meta(origin="ai", actor="mapper")
    meta = checks.get("chart_edit")
    if not isinstance(meta, dict):
        return empty_edit_meta(origin="ai", actor="mapper")
    return {
        "origin": meta.get("origin")
        if meta.get("origin") in {"ai", "human", "ai_fix", "agent"}
        else "ai",
        "actor": str(meta.get("actor") or "mapper"),
        "manual_evidence": list(meta.get("manual_evidence") or []),
        "evidence_overrides": dict(meta.get("evidence_overrides") or {}),
    }


def apply_edit_meta_to_blocks(
    blocks: list[dict[str, Any]],
    meta: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Apply human overrides and append manual evidence for chart display."""
    meta = meta or empty_edit_meta(origin="ai")
    overrides = meta.get("evidence_overrides") or {}
    out: list[dict[str, Any]] = []
    for index, block in enumerate(blocks, start=1):
        eid = str(block.get("evidence_id") or "")
        patched = {**block, "evidence_number": index, "authorship": "ai"}
        override = overrides.get(eid) if isinstance(overrides, dict) else None
        if isinstance(override, dict):
            patched = _apply_override(patched, override)
            patched["authorship"] = "human"
        out.append(patched)

    for manual in meta.get("manual_evidence") or []:
        if not isinstance(manual, dict):
            continue
        out.append(_manual_block(manual, evidence_number=len(out) + 1))
    return out


def _apply_override(block: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    patched = {**block}
    if override.get("quote"):
        patched["quote"] = str(override["quote"])
    if override.get("section") is not None:
        section = str(override.get("section") or "").strip()
        patched["section_ref"] = section or patched.get("section_ref")
        patched["section_label"] = section or patched.get("section_label")
    if override.get("printed_page") is not None:
        patched["printed_label"] = str(override.get("printed_page") or "") or None
    if override.get("pdf_page") not in (None, ""):
        try:
            patched["page_ordinal"] = int(override["pdf_page"])
        except (TypeError, ValueError):
            pass
    if override.get("standard_edition"):
        source = dict(patched.get("source") or {})
        source["edition"] = str(override["standard_edition"])
        source["title"] = str(override.get("standard_edition"))
        source["short_label"] = str(override["standard_edition"])
        patched["source"] = source
    if override.get("screenshot_data_url"):
        patched["screenshot_url"] = str(override["screenshot_data_url"])
        patched["highlight_available"] = True
    return patched


def _manual_block(manual: dict[str, Any], *, evidence_number: int) -> dict[str, Any]:
    eid = str(manual.get("evidence_id") or f"manual-{uuid.uuid4()}")
    edition = str(manual.get("standard_edition") or "Manual entry")
    section = str(manual.get("section") or "").strip()
    printed = str(manual.get("printed_page") or "").strip() or None
    pdf_page = manual.get("pdf_page")
    try:
        page_ordinal = int(pdf_page) if pdf_page not in (None, "") else None
    except (TypeError, ValueError):
        page_ordinal = None
    screenshot = manual.get("screenshot_data_url")
    return {
        "evidence_number": evidence_number,
        "evidence_id": eid,
        "available": True,
        "quote": str(manual.get("quote") or ""),
        "source": {
            "document_id": manual.get("document_id") or "manual",
            "family": manual.get("family") or "Manual",
            "title": edition,
            "edition": edition,
            "sha256": None,
            "short_label": edition,
        },
        "section_label": section or None,
        "section_ref": section or None,
        "citation_heading": " · ".join(
            p for p in [edition, f"§{section}" if section else None, f"p. {printed}" if printed else None] if p
        ),
        "page_ordinal": page_ordinal,
        "printed_label": printed,
        "screenshot_url": screenshot,
        "highlight_available": bool(screenshot),
        "role": "supporting",
        "authorship": "human",
        "manual": True,
    }


def build_edit_meta_from_entries(
    *,
    prior_meta: dict[str, Any],
    entries: list[dict[str, Any]],
    actor: str,
    target_document_id: str | None,
) -> tuple[list[str], dict[str, Any]]:
    """Return (corpus evidence_ids, chart_edit meta) from modal entries."""
    corpus_ids: list[str] = []
    overrides: dict[str, Any] = {}
    manual: list[dict[str, Any]] = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("removed"):
            continue
        eid = str(entry.get("evidence_id") or "").strip()
        is_manual = (not eid) or eid.startswith("manual-") or bool(entry.get("manual"))
        payload = {
            "standard_edition": str(entry.get("standard_edition") or "").strip(),
            "section": str(entry.get("section") or "").strip(),
            "printed_page": str(entry.get("printed_page") or "").strip(),
            "pdf_page": entry.get("pdf_page"),
            "quote": str(entry.get("quote") or "").strip(),
            "screenshot_data_url": entry.get("screenshot_data_url"),
            "document_id": target_document_id,
        }
        if is_manual:
            mid = eid if eid.startswith("manual-") else f"manual-{uuid.uuid4()}"
            manual.append({**payload, "evidence_id": mid, "manual": True})
        else:
            corpus_ids.append(eid)
            # Only store override fields that differ / were provided.
            overrides[eid] = {k: v for k, v in payload.items() if v not in (None, "")}

    meta = {
        "origin": "human",
        "actor": actor or "Analyst",
        "manual_evidence": manual,
        "evidence_overrides": overrides,
    }
    return corpus_ids, meta


def snapshot_from_revision(row: Any, *, checks: dict[str, Any] | None) -> dict[str, Any]:
    meta = edit_meta_from_checks(checks)
    return {
        "mapping_label": row["mapping_label"],
        "rationale": row["rationale"],
        "evidence_ids": json.loads(row["evidence_ids_json"] or "[]"),
        "match_strength": row["match_strength"] if "match_strength" in row.keys() else None,
        "requirement_applicability": (
            row["requirement_applicability"] if "requirement_applicability" in row.keys() else None
        ),
        "requirement_condition": (
            row["requirement_condition"] if "requirement_condition" in row.keys() else ""
        ),
        "chart_edit": meta,
    }


def record_change_log(
    *,
    run_id: str,
    element_id: str,
    revision_id: str,
    prior_revision_id: str | None,
    origin: Origin,
    actor: str,
    summary: str,
    snapshot: dict[str, Any],
) -> str:
    ensure_chart_edit_schema()
    log_id = str(uuid.uuid4())
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO row_change_logs(
              id, run_id, element_id, revision_id, prior_revision_id,
              origin, actor, summary, snapshot_json, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                log_id,
                run_id,
                element_id,
                revision_id,
                prior_revision_id,
                origin,
                actor,
                summary[:500],
                dumps(snapshot),
                utcnow(),
            ),
        )
    return log_id


def list_change_logs(element_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    ensure_chart_edit_schema()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM row_change_logs
            WHERE element_id=?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (element_id, limit),
        ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["snapshot"] = json.loads(item.pop("snapshot_json") or "{}")
        item["origin_label"] = origin_label(item.get("origin"))
        out.append(item)
    return out


def merge_chart_edit_into_checks(
    checks: dict[str, Any] | None,
    meta: dict[str, Any],
) -> dict[str, Any]:
    base = dict(checks) if isinstance(checks, dict) else {}
    base["chart_edit"] = meta
    return base

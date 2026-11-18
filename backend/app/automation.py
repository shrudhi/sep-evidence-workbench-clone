"""Workspace automation defaults, per-analysis draft overrides, and run snapshots."""

from __future__ import annotations

import json
import re
from typing import Any

from .database import connect, dumps, transaction, utcnow
from .ops_schema import ensure_ops_schema

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

DEFAULT_AUTOMATION = {
    "mode": "review_before_send",
    "recipients": [],
    "notify_review_required": True,
    "notify_analysis_completed": True,
    "attach_word_bundle": True,
    "additional_formats": [],
    "max_repair_attempts": 1,
}


def normalize_recipients(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace(";", ",").split(",")]
    elif isinstance(value, list):
        parts = [str(part).strip() for part in value]
    else:
        raise ValueError("Recipients must be a list or comma-separated string")
    return [part for part in parts if part]


def validate_recipients(recipients: list[str]) -> list[str]:
    invalid = [addr for addr in recipients if not EMAIL_RE.match(addr)]
    if invalid:
        raise ValueError(f"Invalid recipient email address(es): {', '.join(invalid)}")
    return recipients


def requires_explicit_approval(mode: str) -> bool:
    """Review-before-sending always requires explicit approval before report delivery."""
    return (mode or "review_before_send") != "send_when_checks_pass"


def policy_summary(settings: dict[str, Any]) -> str:
    mode = settings.get("mode") or "review_before_send"
    repairs = int(settings.get("max_repair_attempts") or 1)
    recipients = list(settings.get("recipients") or [])
    recip = ", ".join(recipients) if recipients else "no recipients configured"
    repair_phrase = f"{repairs} repair" if repairs == 1 else f"{repairs} repairs"
    notify_bits = []
    if settings.get("notify_review_required", True):
        notify_bits.append("review notifications enabled")
    if settings.get("notify_analysis_completed", True):
        notify_bits.append("analysis-ready notifications enabled")
    notify = f" ({'; '.join(notify_bits)})" if notify_bits else ""
    attach = (
        " Attach the Word bundle only when a completed deliverable is authorized."
        if settings.get("attach_word_bundle", True)
        else " Do not attach the Word bundle to emails."
    )
    if mode == "send_when_checks_pass":
        return (
            f"Analyse the selected claims and standards. Attempt {repair_phrase} for failed rows. "
            f"Email the Word bundle to {recip} only when mandatory checks pass and no required "
            f"reviews or processing failures remain{notify}.{attach}"
        )
    return (
        f"Analyse the selected claims and standards. Attempt {repair_phrase} for failed rows. "
        f"Hold report delivery for explicit human approval before emailing to {recip}{notify}."
        f"{attach}"
    )


def normalize_settings(raw: dict[str, Any]) -> dict[str, Any]:
    settings = {
        "mode": raw.get("mode") or "review_before_send",
        "recipients": validate_recipients(normalize_recipients(raw.get("recipients"))),
        "notify_review_required": bool(raw.get("notify_review_required", True)),
        "notify_analysis_completed": bool(raw.get("notify_analysis_completed", True)),
        "attach_word_bundle": bool(raw.get("attach_word_bundle", True)),
        "additional_formats": list(raw.get("additional_formats") or []),
        "max_repair_attempts": max(0, min(int(raw.get("max_repair_attempts") or 1), 3)),
    }
    if settings["mode"] not in ("review_before_send", "send_when_checks_pass"):
        raise ValueError("Invalid automation mode")
    settings["require_human_approval"] = requires_explicit_approval(settings["mode"])
    settings["policy_summary"] = policy_summary(settings)
    settings["email_delivery_enabled"] = bool(settings["recipients"])
    return settings


def _row_to_settings(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return normalize_settings(dict(DEFAULT_AUTOMATION))
    return normalize_settings(
        {
            "mode": row["mode"],
            "recipients": json.loads(row["recipients_json"] or "[]"),
            "notify_review_required": bool(row["notify_review_required"]),
            "notify_analysis_completed": bool(row["notify_analysis_completed"]),
            "attach_word_bundle": bool(row["attach_word_bundle"]),
            "additional_formats": json.loads(row["additional_formats_json"] or "[]"),
            "max_repair_attempts": int(row["max_repair_attempts"]),
        }
    )


def get_workspace_defaults(project_id: str) -> dict[str, Any]:
    ensure_ops_schema()
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM project_automation WHERE project_id=?", (project_id,)
        ).fetchone()
    settings = _row_to_settings(dict(row) if row else None)
    settings["scope"] = "workspace_defaults"
    return settings


# Back-compat alias
def get_project_automation(project_id: str) -> dict[str, Any]:
    return get_effective_automation(project_id)


def update_workspace_defaults(project_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    ensure_ops_schema()
    current = get_workspace_defaults(project_id)
    merged = {**current, **{k: v for k, v in patch.items() if v is not None}}
    next_settings = normalize_settings(merged)
    now = utcnow()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO project_automation(
              project_id,mode,recipients_json,notify_review_required,notify_analysis_completed,
              attach_word_bundle,additional_formats_json,require_human_approval,
              max_repair_attempts,policy_summary,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(project_id) DO UPDATE SET
              mode=excluded.mode,
              recipients_json=excluded.recipients_json,
              notify_review_required=excluded.notify_review_required,
              notify_analysis_completed=excluded.notify_analysis_completed,
              attach_word_bundle=excluded.attach_word_bundle,
              additional_formats_json=excluded.additional_formats_json,
              require_human_approval=excluded.require_human_approval,
              max_repair_attempts=excluded.max_repair_attempts,
              policy_summary=excluded.policy_summary,
              updated_at=excluded.updated_at
            """,
            (
                project_id,
                next_settings["mode"],
                dumps(next_settings["recipients"]),
                1 if next_settings["notify_review_required"] else 0,
                1 if next_settings["notify_analysis_completed"] else 0,
                1 if next_settings["attach_word_bundle"] else 0,
                dumps(next_settings.get("additional_formats") or []),
                1 if next_settings["require_human_approval"] else 0,
                next_settings["max_repair_attempts"],
                next_settings["policy_summary"],
                now,
            ),
        )
    return get_workspace_defaults(project_id)


def update_project_automation(project_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Legacy path used by ProjectPatch — updates workspace defaults only."""
    return update_workspace_defaults(project_id, patch)


def get_analysis_override(project_id: str) -> dict[str, Any] | None:
    ensure_ops_schema()
    with connect() as connection:
        row = connection.execute(
            "SELECT payload_json FROM analysis_automation_overrides WHERE project_id=?",
            (project_id,),
        ).fetchone()
    if not row:
        return None
    return normalize_settings(json.loads(row["payload_json"] or "{}"))


def set_analysis_override(project_id: str, patch: dict[str, Any] | None) -> dict[str, Any]:
    """Save per-analysis override (does not change workspace defaults). None clears override."""
    ensure_ops_schema()
    if patch is None:
        with transaction() as connection:
            connection.execute(
                "DELETE FROM analysis_automation_overrides WHERE project_id=?",
                (project_id,),
            )
        return get_effective_automation(project_id)

    defaults = get_workspace_defaults(project_id)
    merged = {**defaults, **{k: v for k, v in patch.items() if v is not None}}
    # Drop computed keys from merge source
    for key in ("policy_summary", "require_human_approval", "email_delivery_enabled", "scope", "using_defaults"):
        merged.pop(key, None)
    settings = normalize_settings(merged)
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO analysis_automation_overrides(project_id,payload_json,updated_at)
            VALUES(?,?,?)
            ON CONFLICT(project_id) DO UPDATE SET
              payload_json=excluded.payload_json,
              updated_at=excluded.updated_at
            """,
            (project_id, dumps(settings), utcnow()),
        )
    return get_effective_automation(project_id)


def clear_analysis_override(project_id: str) -> dict[str, Any]:
    return set_analysis_override(project_id, None)


def get_effective_automation(project_id: str) -> dict[str, Any]:
    defaults = get_workspace_defaults(project_id)
    override = get_analysis_override(project_id)
    if not override:
        return {
            **defaults,
            "using_defaults": True,
            "scope": "workspace_defaults",
        }
    return {
        **override,
        "using_defaults": False,
        "scope": "analysis_override",
        "workspace_defaults": defaults,
    }


def compact_automation_label(settings: dict[str, Any]) -> str:
    mode = (
        "Review before sending"
        if settings.get("mode") == "review_before_send"
        else "Send automatically when all required checks pass"
    )
    bits = [mode]
    if settings.get("notify_review_required", True):
        bits.append("Review notifications enabled")
    if settings.get("attach_word_bundle", True):
        bits.append("Word bundle")
    return " · ".join(bits)


def snapshot_automation_for_run(
    run_id: str,
    project_id: str,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Freeze effective automation onto the run. Later defaults/overrides do not alter it."""
    ensure_ops_schema()
    if settings is None:
        settings = get_effective_automation(project_id)
    frozen = normalize_settings(settings)
    now = utcnow()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO run_automation_snapshots(
              run_id,project_id,mode,recipients_json,notify_review_required,
              notify_analysis_completed,attach_word_bundle,additional_formats_json,
              require_human_approval,max_repair_attempts,policy_summary,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(run_id) DO NOTHING
            """,
            (
                run_id,
                project_id,
                frozen["mode"],
                dumps(frozen["recipients"]),
                1 if frozen["notify_review_required"] else 0,
                1 if frozen["notify_analysis_completed"] else 0,
                1 if frozen["attach_word_bundle"] else 0,
                dumps(frozen.get("additional_formats") or []),
                1 if frozen["require_human_approval"] else 0,
                frozen["max_repair_attempts"],
                frozen["policy_summary"],
                now,
            ),
        )
    return get_run_automation(run_id) or frozen


def get_run_automation(run_id: str) -> dict[str, Any] | None:
    ensure_ops_schema()
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM run_automation_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
    if not row:
        return None
    settings = normalize_settings(
        {
            "mode": row["mode"],
            "recipients": json.loads(row["recipients_json"] or "[]"),
            "notify_review_required": bool(row["notify_review_required"]),
            "notify_analysis_completed": bool(row["notify_analysis_completed"]),
            "attach_word_bundle": bool(row["attach_word_bundle"]),
            "additional_formats": json.loads(row["additional_formats_json"] or "[]"),
            "max_repair_attempts": int(row["max_repair_attempts"]),
        }
    )
    return {
        **settings,
        "run_id": run_id,
        "project_id": row["project_id"],
        "created_at": row["created_at"],
        "scope": "run_snapshot",
    }


def audit(
    event_type: str,
    *,
    run_id: str | None = None,
    project_id: str | None = None,
    payload: dict | None = None,
) -> None:
    ensure_ops_schema()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO ops_audit_events(run_id,project_id,event_type,payload_json,created_at)
            VALUES(?,?,?,?,?)
            """,
            (run_id, project_id, event_type, dumps(payload or {}), utcnow()),
        )

"""Run observability: execution timeline, tool/model usage, errors, ops audit.

Independent of Evaluation scoring — this answers what happened during a run.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from .database import connect
from .ops_schema import ensure_ops_schema


def _load_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def list_trace_events(run_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM trace_events WHERE run_id=? ORDER BY id", (run_id,)
        ).fetchall()
    events: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["arguments"] = _load_json(item.pop("arguments_json", None))
        item["result"] = _load_json(item.pop("result_summary_json", None))
        item["usage"] = _load_json(item.pop("usage_json", None))
        events.append(item)
    return events


def list_ops_audit(run_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
    ensure_ops_schema()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, run_id, project_id, event_type, payload_json, created_at
            FROM ops_audit_events
            WHERE run_id=?
            ORDER BY id DESC
            LIMIT ?
            """,
            (run_id, limit),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["payload"] = _load_json(item.pop("payload_json", None))
        out.append(item)
    return out


def _classify_event(event: dict[str, Any]) -> str:
    et = (event.get("event_type") or "").lower()
    if event.get("error"):
        return "error"
    if "error" in et or "fail" in et:
        return "error"
    if et == "model_call" or event.get("model_name"):
        return "model"
    if et in ("state_transition", "run_created") or et.endswith("_transition"):
        return "handoff"
    if event.get("tool_name") or et in (
        "judge_verified_mapping",
        "judge_requested_rework",
        "ai_review_completed",
        "agent_proposal_accepted",
    ):
        return "tool"
    return "other"


def build_observability_report(run_id: str) -> dict[str, Any]:
    """Aggregate timeline + measured usage for one chart/selection run."""
    with connect() as connection:
        run = connection.execute(
            """
            SELECT r.*, d.family, d.edition
            FROM runs r
            LEFT JOIN documents d ON d.id = r.target_document_id
            WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
    if not run:
        raise KeyError(f"Unknown run {run_id}")

    events = list_trace_events(run_id)
    audit = list_ops_audit(run_id)

    timeline: list[dict[str, Any]] = []
    for event in events:
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
        timeline.append(
            {
                "id": event.get("id"),
                "created_at": event.get("created_at"),
                "event_type": event.get("event_type"),
                "state": event.get("state"),
                "category": _classify_event(event),
                "tool_name": event.get("tool_name"),
                "model_name": event.get("model_name") or usage.get("model_name"),
                "prompt_hash": event.get("prompt_hash"),
                "latency_ms": event.get("latency_ms"),
                "error": event.get("error"),
                "prompt_tokens": (usage or {}).get("prompt_tokens"),
                "completion_tokens": (usage or {}).get("completion_tokens"),
                "total_tokens": (usage or {}).get("total_tokens"),
                "estimated_cost_usd": (usage or {}).get("estimated_cost_usd"),
                "actual_cost_usd": (usage or {}).get("actual_cost_usd"),
                "arguments": event.get("arguments"),
                "result": event.get("result"),
            }
        )

    latencies = [e["latency_ms"] for e in timeline if isinstance(e.get("latency_ms"), int)]
    prompt_tokens = sum(e["prompt_tokens"] or 0 for e in timeline)
    completion_tokens = sum(e["completion_tokens"] or 0 for e in timeline)
    total_tokens = sum(e["total_tokens"] or 0 for e in timeline)
    cost_actual = sum(float(e["actual_cost_usd"] or 0) for e in timeline)
    cost_est = sum(float(e["estimated_cost_usd"] or 0) for e in timeline)
    errors = [e for e in timeline if e.get("category") == "error" or e.get("error")]

    by_type = Counter(e.get("event_type") or "unknown" for e in timeline)
    by_state = Counter(e.get("state") or "unknown" for e in timeline)
    by_tool = Counter(e.get("tool_name") for e in timeline if e.get("tool_name"))
    by_model = Counter(e.get("model_name") for e in timeline if e.get("model_name"))
    by_category = Counter(e.get("category") for e in timeline)

    handoffs = [
        e
        for e in timeline
        if e.get("category") == "handoff"
        or e.get("event_type")
        in (
            "state_transition",
            "run_created",
            "judge_requested_rework",
            "judge_verified_mapping",
            "agent_proposal_accepted",
            "ai_review_completed",
        )
    ]

    run_dict = dict(run)
    for field in ("target_decision_json", "model_config_json", "error"):
        if field.endswith("_json") and field in run_dict:
            key = field.removesuffix("_json")
            run_dict[key] = _load_json(run_dict.pop(field))

    return {
        "run": {
            "id": run_dict.get("id"),
            "status": run_dict.get("status"),
            "family": run_dict.get("family"),
            "edition": run_dict.get("edition"),
            "target_document_id": run_dict.get("target_document_id"),
            "created_at": run_dict.get("created_at"),
            "updated_at": run_dict.get("updated_at"),
            "error": run_dict.get("error"),
            "verification_status": run_dict.get("verification_status"),
            "human_review_status": run_dict.get("human_review_status"),
            "model_config": run_dict.get("model_config"),
        },
        "summary": {
            "event_count": len(timeline),
            "error_count": len(errors),
            "model_calls": by_category.get("model", 0),
            "tool_events": by_category.get("tool", 0),
            "handoff_events": len(handoffs),
            "latency_ms_total": sum(latencies) if latencies else 0,
            "latency_ms_max": max(latencies) if latencies else None,
            "latency_ms_avg": round(sum(latencies) / len(latencies), 1) if latencies else None,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "actual_cost_usd": round(cost_actual, 6),
            "estimated_cost_usd": round(cost_est, 6),
            "by_event_type": dict(by_type),
            "by_state": dict(by_state),
            "by_tool": dict(by_tool),
            "by_model": dict(by_model),
            "by_category": dict(by_category),
            "audit_event_count": len(audit),
        },
        "timeline": timeline,
        "errors": errors,
        "handoffs": handoffs[-80:],
        "ops_audit": audit,
        "independence_note": (
            "Observability explains execution (tools, models, latency, errors). "
            "Evaluation scores agent output against a human reference and stays separate."
        ),
    }

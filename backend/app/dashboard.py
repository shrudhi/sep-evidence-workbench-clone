"""Analyst Dashboard aggregates derived from persisted events."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from .automation import get_project_automation
from .database import connect
from .delivery import REASON_LABELS
from .email_provider import email_configured
from .ops_schema import ensure_ops_schema


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _period_start(period: str) -> datetime | None:
    now = datetime.now(UTC)
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    return now - timedelta(days=7)


def build_dashboard(period: str = "7d", project_id: str | None = None) -> dict[str, Any]:
    ensure_ops_schema()
    start = _period_start(period)
    start_iso = start.isoformat() if start else None

    with connect() as connection:
        runs = [
            dict(row)
            for row in connection.execute(
                """
                SELECT r.*, d.family, d.edition,
                       s.patent_identifier, s.project_id, s.selected_standard_ids_json
                FROM runs r
                LEFT JOIN documents d ON d.id=r.target_document_id
                LEFT JOIN run_snapshots s ON s.run_id=r.id
                ORDER BY r.created_at DESC
                """
            )
        ]
        if project_id:
            runs = [r for r in runs if r.get("project_id") == project_id]

        open_tasks = [
            dict(row)
            for row in connection.execute(
                """
                SELECT t.*, ce.label AS element_label, ce.exact_text,
                       d.family, d.edition, s.patent_identifier, s.project_id AS snap_project_id
                FROM review_tasks t
                LEFT JOIN claim_elements ce ON ce.id=t.element_id
                LEFT JOIN runs r ON r.id=t.run_id
                LEFT JOIN documents d ON d.id=r.target_document_id
                LEFT JOIN run_snapshots s ON s.run_id=t.run_id
                WHERE t.status='open'
                ORDER BY t.priority DESC, t.created_at ASC
                """
            )
        ]
        attention = [
            dict(row)
            for row in connection.execute(
                """
                SELECT * FROM attention_items WHERE status='open'
                ORDER BY created_at ASC
                """
            )
        ]
        proposals = connection.execute(
            """
            SELECT status, COUNT(*) AS n FROM agent_proposals GROUP BY status
            """
        ).fetchall()
        proposal_counts = {row["status"]: row["n"] for row in proposals}

        # First-pass verification: integrity pass on revision_number=1
        first_pass = connection.execute(
            """
            SELECT
              SUM(CASE WHEN json_extract(integrity_json,'$.pass')=1 THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN json_extract(integrity_json,'$.pass')=0 THEN 1 ELSE 0 END) AS failed,
              COUNT(*) AS total
            FROM row_revisions WHERE revision_number=1
            """
        ).fetchone()

        deliveries = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM email_deliveries ORDER BY created_at DESC LIMIT 50"
            )
        ]

    # Headline metrics
    awaiting_review = len(open_tasks)
    needing_attention = len(attention)
    completed_in_period = 0
    review_ready_durations: list[float] = []
    for run in runs:
        created = _parse_dt(run.get("created_at"))
        ready = _parse_dt(run.get("review_ready_at")) or (
            created if run.get("status") in ("analyst_review", "complete") else None
        )
        if (
            run.get("status") in ("analyst_review", "complete")
            and created
            and start
            and created >= start
        ):
            completed_in_period += 1
        if created and ready and run.get("status") in ("analyst_review", "complete"):
            review_ready_durations.append((ready - created).total_seconds())

    median_ready = None
    if review_ready_durations:
        ordered = sorted(review_ready_durations)
        mid = len(ordered) // 2
        median_ready = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2

    # Group review queue by run
    by_run: dict[str, list[dict[str, Any]]] = {}
    for task in open_tasks:
        by_run.setdefault(task["run_id"], []).append(task)
    review_queue = []
    for run_id, tasks in by_run.items():
        run = next((r for r in runs if r["id"] == run_id), {})
        review_queue.append(
            {
                "run_id": run_id,
                "project_id": tasks[0].get("project_id")
                or tasks[0].get("snap_project_id")
                or run.get("project_id"),
                "patent": tasks[0].get("patent_identifier") or run.get("patent_identifier"),
                "family": tasks[0].get("family") or run.get("family"),
                "edition": tasks[0].get("edition") or run.get("edition"),
                "waiting_since": min(t["created_at"] for t in tasks),
                "priority": max(t["priority"] for t in tasks),
                "issue_count": len(tasks),
                "issues": [
                    {
                        "id": t["id"],
                        "element_id": t["element_id"],
                        "element_label": t.get("element_label"),
                        "reason_code": t["reason_code"],
                        "reason_label": REASON_LABELS.get(t["reason_code"], t["reason_code"]),
                        "reason_text": t["reason_text"],
                        "priority": t["priority"],
                        "waiting_since": t["created_at"],
                        "assigned_reviewer": t.get("assigned_reviewer"),
                        "deep_link": (
                            f"/?project={t.get('project_id') or t.get('snap_project_id') or 'lumenci-assessment'}"
                            f"&run={run_id}&row={t['element_id']}&view=review"
                        ),
                    }
                    for t in tasks
                ],
            }
        )
    review_queue.sort(key=lambda item: item["waiting_since"])

    # Analysis table
    analysis_rows = []
    for run in runs[:40]:
        with connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) AS n FROM claim_elements WHERE run_id=?", (run["id"],)
            ).fetchone()["n"]
            processed = connection.execute(
                """
                SELECT COUNT(DISTINCT element_id) AS n FROM row_revisions WHERE run_id=?
                """,
                (run["id"],),
            ).fetchone()["n"]
            pending = connection.execute(
                "SELECT COUNT(*) AS n FROM review_tasks WHERE run_id=? AND status='open'",
                (run["id"],),
            ).fetchone()["n"]
            approved = connection.execute(
                """
                SELECT COUNT(*) AS n FROM claim_elements ce
                JOIN row_revisions rr ON rr.element_id=ce.id
                JOIN analyst_decisions ad ON ad.revision_id=rr.id
                WHERE ce.run_id=? AND ad.disposition='accept'
                  AND rr.revision_number=(
                    SELECT MAX(revision_number) FROM row_revisions x WHERE x.element_id=ce.id
                  )
                """,
                (run["id"],),
            ).fetchone()["n"]
        created = _parse_dt(run.get("created_at"))
        updated = _parse_dt(run.get("updated_at"))
        duration = (
            (updated - created).total_seconds() if created and updated else None
        )
        standards = json.loads(run.get("selected_standard_ids_json") or "[]")
        analysis_rows.append(
            {
                "run_id": run["id"],
                "project_id": run.get("project_id"),
                "patent": run.get("patent_identifier"),
                "family": run.get("family"),
                "edition": run.get("edition"),
                "selected_standard_ids": standards,
                "processing_stage": run.get("status"),
                "rows_processed": processed,
                "rows_total": total,
                "pending_review_count": pending,
                "verification_status": run.get("verification_status") or "pending",
                "human_review_status": run.get("human_review_status") or "not_required",
                "started_at": run.get("created_at"),
                "processing_duration_seconds": duration,
                "delivery_status": run.get("delivery_status") or "not_requested",
                "export_status": run.get("export_status") or "not_generated",
                "error": run.get("error"),
                "actions": {
                    "open": f"/?run={run['id']}&view=charts",
                    "review": f"/?run={run['id']}&view=review",
                    "report": f"/?run={run['id']}&view=conclusion",
                    "download": f"/api/runs/{run['id']}/export-bundle",
                },
                "human_approved_rows": approved,
            }
        )

    accepted = proposal_counts.get("accepted", 0)
    rejected = proposal_counts.get("rejected", 0)
    pending_prop = proposal_counts.get("pending", 0)
    revision_denom = accepted + rejected

    # Cost for completed analyses in period
    costs = [
        float(r["actual_cost_usd"])
        for r in runs
        if r.get("actual_cost_usd") is not None
        and r.get("status") in ("analyst_review", "complete")
        and _parse_dt(r.get("created_at"))
        and start
        and _parse_dt(r.get("created_at")) >= start
    ]
    median_cost = None
    if costs:
        costs_sorted = sorted(costs)
        mid = len(costs_sorted) // 2
        median_cost = (
            costs_sorted[mid]
            if len(costs_sorted) % 2
            else (costs_sorted[mid - 1] + costs_sorted[mid]) / 2
        )

    oldest_pending = open_tasks[0]["created_at"] if open_tasks else None
    # Prefer true oldest
    if open_tasks:
        oldest_pending = min(t["created_at"] for t in open_tasks)

    fp_total = int(first_pass["total"] or 0) if first_pass else 0
    fp_passed = int(first_pass["passed"] or 0) if first_pass else 0
    fp_failed = int(first_pass["failed"] or 0) if first_pass else 0

    return {
        "period": period,
        "period_start": start_iso,
        "email": email_configured(),
        "automation": get_project_automation(project_id or "lumenci-assessment"),
        "metrics": {
            "rows_awaiting_review": {
                "value": awaiting_review,
                "definition": "Open review tasks requiring analyst action.",
            },
            "analyses_needing_attention": {
                "value": needing_attention,
                "definition": "Open operational failures (indexing, model, export, email) — not mapping interpretation.",
            },
            "analyses_completed": {
                "value": completed_in_period,
                "definition": "Runs that reached review-ready or complete within the selected period.",
            },
            "median_time_to_review_ready_seconds": {
                "value": median_ready,
                "definition": "Median duration from analysis start to first reviewable chart (review_ready_at).",
            },
        },
        "review_queue": review_queue,
        "needs_attention": [
            {
                "id": item["id"],
                "run_id": item.get("run_id"),
                "kind": item["kind"],
                "reason": item["reason"],
                "action_hint": item.get("action_hint"),
                "created_at": item["created_at"],
            }
            for item in attention
        ],
        "analyses": analysis_rows,
        "supporting_metrics": {
            "first_pass_verification_rate": {
                "passed": fp_passed,
                "eligible": fp_total,
                "failed": fp_failed,
                "display": f"{fp_passed}/{fp_total}" if fp_total else "—",
                "definition": "Rows whose first revision passed all required automatic integrity checks / rows with completed first-pass checks.",
            },
            "median_active_human_review_time_seconds": {
                "value": None,
                "label": "Elapsed review duration (instrumented active sessions not yet available)",
                "definition": "Accumulated instrumented review sessions excluding idle. Currently unavailable — use waiting-since on queue items.",
            },
            "completed_analyses_in_period": completed_in_period,
            "revision_acceptance_rate": {
                "accepted": accepted,
                "rejected": rejected,
                "pending_excluded": pending_prop,
                "display": f"{accepted}/{revision_denom}" if revision_denom else "—",
                "definition": "Accepted revision proposals / (accepted + rejected). Pending excluded.",
            },
            "median_model_cost_per_completed_analysis_usd": {
                "value": median_cost,
                "definition": "Median actual_cost_usd for completed analyses in the selected period, when usage was recorded.",
            },
            "oldest_pending_review_at": oldest_pending,
        },
        "recent_deliveries": [
            {
                "id": d["id"],
                "run_id": d["run_id"],
                "kind": d["kind"],
                "status": d["status"],
                "subject": d["subject"],
                "error": d.get("error"),
                "created_at": d["created_at"],
            }
            for d in deliveries[:10]
        ],
        "empty": awaiting_review == 0 and needing_attention == 0 and not runs,
    }

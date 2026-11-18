"""Delivery eligibility, report versioning, review tasks and email queue."""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from .automation import audit, get_run_automation
from .config import get_settings
from .database import connect, dumps, transaction, utcnow
from .email_provider import email_configured, get_email_provider
from .exporter import export_docx
from .ops_schema import ensure_ops_schema


REASON_LABELS = {
    "mapping_uncertainty": "Mapping uncertainty",
    "reviewer_disagreement": "Reviewer disagreement",
    "evidence_verification": "Evidence verification issue",
    "analyst_challenge": "Analyst challenge",
    "integrity_failure": "Evidence verification issue",
    "flagged_by_reviewer": "Reviewer disagreement",
    "incomplete_analysis": "Mapping uncertainty",
    "judge_failed": "Judge failed checks",
    "judge_needs_review": "Judge needs review",
    "judge_incomplete": "Judge review incomplete",
}


def _latest_rows(connection, run_id: str) -> list[dict[str, Any]]:
    elements = connection.execute(
        "SELECT * FROM claim_elements WHERE run_id=? ORDER BY ordinal", (run_id,)
    ).fetchall()
    rows = []
    for element in elements:
        revision = connection.execute(
            """
            SELECT rr.*, rv.disposition AS review_disposition, rv.reasons_json,
                   rv.checks_json AS review_checks_json,
                   ad.disposition AS analyst_disposition
            FROM row_revisions rr
            LEFT JOIN review_results rv ON rv.id=(
              SELECT id FROM review_results x
              WHERE x.revision_id=rr.id
              ORDER BY x.created_at DESC LIMIT 1
            )
            LEFT JOIN analyst_decisions ad ON ad.id=(
              SELECT id FROM analyst_decisions x WHERE x.revision_id=rr.id
              ORDER BY x.created_at DESC LIMIT 1
            )
            WHERE rr.element_id=?
            ORDER BY rr.revision_number DESC, rr.created_at DESC LIMIT 1
            """,
            (element["id"],),
        ).fetchone()
        item = dict(element)
        item["revision"] = dict(revision) if revision else None
        rows.append(item)
    return rows


def chart_fingerprint(run_id: str) -> str:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT rr.id, rr.revision_number, rr.mapping_label, rr.evidence_ids_json
            FROM row_revisions rr
            JOIN claim_elements ce ON ce.id=rr.element_id
            WHERE rr.run_id=? AND rr.id IN (
              SELECT id FROM row_revisions r2
              WHERE r2.element_id=rr.element_id
              ORDER BY r2.revision_number DESC LIMIT 1
            )
            ORDER BY ce.ordinal
            """,
            (run_id,),
        ).fetchall()
        # SQLite subquery LIMIT per-group is unreliable; compute in Python
        elements = connection.execute(
            "SELECT id FROM claim_elements WHERE run_id=? ORDER BY ordinal", (run_id,)
        ).fetchall()
        parts = []
        for element in elements:
            rev = connection.execute(
                """
                SELECT id,revision_number,mapping_label,evidence_ids_json
                FROM row_revisions WHERE element_id=?
                ORDER BY revision_number DESC LIMIT 1
                """,
                (element["id"],),
            ).fetchone()
            if rev:
                parts.append(
                    f"{rev['id']}:{rev['revision_number']}:{rev['mapping_label']}:{rev['evidence_ids_json']}"
                )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def evaluate_delivery_eligibility(run_id: str) -> dict[str, Any]:
    ensure_ops_schema()
    policy = get_run_automation(run_id)
    reasons: list[str] = []
    with connect() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            raise KeyError(f"Unknown run {run_id}")
        if run["status"] == "failed":
            reasons.append("Processing failed; delivery blocked")
        if run["status"] not in ("analyst_review", "complete"):
            reasons.append(f"Run status is {run['status']}; chart not review-ready")
        rows = _latest_rows(connection, run_id)
        if not rows:
            reasons.append("Required claim elements are not accounted for")
        open_tasks = connection.execute(
            "SELECT COUNT(*) AS n FROM review_tasks WHERE run_id=? AND status='open'",
            (run_id,),
        ).fetchone()["n"]
        open_attention = connection.execute(
            "SELECT COUNT(*) AS n FROM attention_items WHERE run_id=? AND status='open'",
            (run_id,),
        ).fetchone()["n"]
        if open_attention:
            reasons.append(f"{open_attention} unresolved processing issue(s) remain")
        if open_tasks:
            reasons.append(f"{open_tasks} required review task(s) remain")

        for row in rows:
            rev = row.get("revision")
            if not rev:
                reasons.append(f"Element {row['label']} has no completed revision")
                continue
            integrity = json.loads(rev.get("integrity_json") or "{}")
            if integrity and integrity.get("pass") is False:
                reasons.append(
                    f"Element {row['label']}: evidence integrity failed and cannot be overridden"
                )
            # Mapping label Partial/No is allowed — not a delivery failure by itself
            if rev.get("review_disposition") == "rework":
                reasons.append(f"Element {row['label']}: review-agent requested rework")
            if rev.get("mapping_label") == "Abstain":
                reasons.append(f"Element {row['label']}: analysis incomplete (no mapping label)")

        if not run["target_document_id"]:
            reasons.append("Source standard / exact edition not identified on the run")

        # Review-before-sending always requires explicit analyst approval on every row.
        if policy and policy.get("mode") == "review_before_send":
            undecided = [
                row["label"]
                for row in rows
                if row.get("revision") and not row["revision"].get("analyst_disposition")
            ]
            if undecided:
                reasons.append(
                    "Explicit human approval required before delivery for: "
                    + ", ".join(undecided[:8])
                )

    eligible = len(reasons) == 0
    decision = {
        "run_id": run_id,
        "eligible": eligible,
        "reasons": reasons,
        "policy_mode": (policy or {}).get("mode"),
        "require_human_approval": (policy or {}).get("require_human_approval"),
        "fingerprint": chart_fingerprint(run_id),
    }
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO delivery_decisions(id,run_id,eligible,reasons_json,policy_mode,created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4()),
                run_id,
                1 if eligible else 0,
                dumps(reasons),
                decision["policy_mode"],
                utcnow(),
            ),
        )
        connection.execute(
            """
            UPDATE runs SET delivery_status=?, verification_status=?, updated_at=?
            WHERE id=?
            """,
            (
                "queued" if eligible else "blocked",
                "passed" if eligible else ("failed" if any("integrity" in r.lower() for r in reasons) else "unresolved"),
                utcnow(),
                run_id,
            ),
        )
    audit("delivery_eligibility", run_id=run_id, payload=decision)
    return decision


def create_review_tasks_for_run(run_id: str) -> list[dict[str, Any]]:
    ensure_ops_schema()
    created: list[dict[str, Any]] = []
    with transaction() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            return []
        snap = connection.execute(
            "SELECT project_id FROM run_automation_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
        project_id = snap["project_id"] if snap else None
        # Clear prior open auto tasks then recreate from current revisions
        connection.execute(
            "UPDATE review_tasks SET status='dismissed',updated_at=? WHERE run_id=? AND status='open'",
            (utcnow(), run_id),
        )
        rows = _latest_rows(connection, run_id)
        for row in rows:
            rev = row.get("revision")
            if not rev:
                continue
            reasons: list[tuple[str, str, int]] = []
            integrity = json.loads(rev.get("integrity_json") or "{}")
            checks = json.loads(rev.get("review_checks_json") or "{}")
            overall = checks.get("overall_decision") if isinstance(checks, dict) else None
            issue_count = int(checks.get("issue_count") or 0) if isinstance(checks, dict) else 0
            summary = (
                (checks.get("summary") if isinstance(checks, dict) else None)
                or ""
            )
            if integrity and integrity.get("pass") is False:
                reasons.append(
                    (
                        "evidence_verification",
                        "Source quote/page/screenshot verification failed",
                        90,
                    )
                )
            disposition = rev.get("review_disposition")
            structured = (
                isinstance(checks, dict)
                and str(checks.get("rubric_version") or "").startswith("judge-v")
                and isinstance(checks.get("criteria"), list)
                and len(checks.get("criteria") or []) >= 7
            )
            if not structured:
                review_reasons = json.loads(rev.get("reasons_json") or "[]")
                raw = "; ".join(str(r) for r in review_reasons if r)
                if "omitted disposition" in raw.lower() or not raw:
                    text = "Judge rubric incomplete — Recheck this revision for the full scorecard"
                else:
                    text = raw
                    if "omitted disposition" in text.lower():
                        text = "Judge rubric incomplete — Recheck this revision for the full scorecard"
                reasons.append(("judge_incomplete", text, 85))
            elif overall in {"Failed checks", "Failed"}:
                reasons.append(
                    (
                        "judge_failed",
                        summary or "Judge failed required checks",
                        95,
                    )
                )
            elif overall == "Review incomplete":
                reasons.append(
                    (
                        "judge_incomplete",
                        summary or "Judge review incomplete — criteria Not run",
                        85,
                    )
                )
            elif overall in {"Needs analyst review", "Needs review"} or (
                issue_count > 0 and overall != "Passed checks"
            ):
                reasons.append(
                    (
                        "judge_needs_review",
                        summary or "Judge reported issues requiring analyst attention",
                        75,
                    )
                )
            elif disposition == "flag":
                reasons.append(
                    (
                        "reviewer_disagreement",
                        summary or "Judge flagged this row for analyst review",
                        70,
                    )
                )
            elif disposition == "rework":
                reasons.append(
                    ("mapping_uncertainty", "Reviewer requested rework / additional evidence", 80)
                )
            if rev.get("mapping_label") == "Abstain":
                reasons.append(("mapping_uncertainty", "Analysis incomplete — mapping undetermined", 75))
            if not rev.get("analyst_disposition") and disposition in ("flag", "rework"):
                # already covered by flag/rework reasons
                pass
            elif not rev.get("analyst_disposition") and disposition == "pass":
                policy = get_run_automation(run_id)
                # Only review-before-send creates approval queue items for clean pass rows.
                if policy and policy.get("mode") == "review_before_send":
                    reasons.append(
                        (
                            "mapping_uncertainty",
                            "Human approval required before delivery (checks passed)",
                            40,
                        )
                    )

            for code, text, priority in reasons:
                task_id = str(uuid.uuid4())
                now = utcnow()
                connection.execute(
                    """
                    INSERT INTO review_tasks(
                      id,run_id,project_id,element_id,revision_id,reason_code,reason_text,
                      priority,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        task_id,
                        run_id,
                        project_id,
                        row["id"],
                        rev["id"],
                        code,
                        text,
                        priority,
                        "open",
                        now,
                        now,
                    ),
                )
                created.append(
                    {
                        "id": task_id,
                        "element_id": row["id"],
                        "label": row["label"],
                        "reason_code": code,
                        "reason_text": text,
                        "priority": priority,
                    }
                )

        open_count = connection.execute(
            "SELECT COUNT(*) AS n FROM review_tasks WHERE run_id=? AND status='open'",
            (run_id,),
        ).fetchone()["n"]
        human_status = "pending" if open_count else "not_required"
        connection.execute(
            """
            UPDATE runs SET human_review_status=?, review_ready_at=COALESCE(review_ready_at, ?), updated_at=?
            WHERE id=?
            """,
            (human_status, utcnow(), utcnow(), run_id),
        )
    return created


def open_attention(
    *,
    run_id: str | None,
    project_id: str | None,
    kind: str,
    reason: str,
    action_hint: str = "Open issue",
) -> str:
    ensure_ops_schema()
    item_id = str(uuid.uuid4())
    now = utcnow()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO attention_items(id,run_id,project_id,kind,reason,status,action_hint,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (item_id, run_id, project_id, kind, reason, "open", action_hint, now, now),
        )
    return item_id


def generate_report_export(run_id: str, *, requested_final: bool = False) -> dict[str, Any]:
    ensure_ops_schema()
    fingerprint = chart_fingerprint(run_id)
    # Mark older current exports stale
    with transaction() as connection:
        connection.execute(
            "UPDATE report_exports SET status='stale', updated_at=? WHERE run_id=? AND status='current'",
            (utcnow(), run_id),
        )
        connection.execute(
            "UPDATE runs SET export_status='generating', updated_at=? WHERE id=?",
            (utcnow(), run_id),
        )
    try:
        path = export_docx(run_id, requested_final=requested_final)
    except Exception as exc:
        with transaction() as connection:
            connection.execute(
                "UPDATE runs SET export_status='failed', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
        open_attention(
            run_id=run_id,
            project_id=None,
            kind="export_failed",
            reason=str(exc)[:500],
            action_hint="Retry export",
        )
        raise

    decision = evaluate_delivery_eligibility(run_id)
    # Re-evaluate after export path known — eligibility shouldn't require export presence for checks
    # but we record automated/human flags on the export
    with connect() as connection:
        rows = _latest_rows(connection, run_id)
    all_approved = bool(rows) and all(
        (row.get("revision") or {}).get("analyst_disposition") == "accept" for row in rows
    )
    export_id = str(uuid.uuid4())
    now = utcnow()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO report_exports(
              id,run_id,revision_fingerprint,path,designation,status,
              human_reviewed,automated_checks_passed,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                export_id,
                run_id,
                fingerprint,
                str(path),
                "REVIEWED FINAL" if all_approved else "AI-generated; automated checks passed.",
                "current",
                1 if all_approved else 0,
                1 if decision["eligible"] or not decision["reasons"] else 0,
                now,
                now,
            ),
        )
        connection.execute(
            "UPDATE runs SET export_status='current', updated_at=? WHERE id=?",
            (now, run_id),
        )
    return {
        "id": export_id,
        "path": str(path),
        "fingerprint": fingerprint,
        "human_reviewed": all_approved,
        "designation": "Human reviewed" if all_approved else "AI-generated; automated checks passed.",
        "download_url": f"/api/runs/{run_id}/export-bundle",
    }


def _deep_link(project_id: str | None, run_id: str, element_id: str | None = None) -> str:
    base = get_settings().app_public_base_url.rstrip("/")
    project_id = project_id or "lumenci-assessment"
    if element_id:
        return f"{base}/?project={project_id}&run={run_id}&row={element_id}&view=review"
    return f"{base}/?project={project_id}&run={run_id}&view=dashboard"


def queue_or_send_email(
    *,
    run_id: str,
    kind: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    report_export_id: str | None = None,
    attach_path: Path | None = None,
    coalesced_task_ids: list[str] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    ensure_ops_schema()
    policy = get_run_automation(run_id) or {}
    recipients = list(policy.get("recipients") or [])
    fingerprint = chart_fingerprint(run_id)
    idempotency_key = f"{run_id}:{kind}:{fingerprint}:{','.join(sorted(recipients))}"
    if force:
        idempotency_key += f":force:{uuid.uuid4()}"

    delivery_id = str(uuid.uuid4())
    now = utcnow()
    with transaction() as connection:
        existing = connection.execute(
            "SELECT * FROM email_deliveries WHERE idempotency_key=?",
            (idempotency_key,),
        ).fetchone()
        if existing:
            return dict(existing) | {"deduped": True}
        connection.execute(
            """
            INSERT INTO email_deliveries(
              id,run_id,report_export_id,kind,recipients_json,subject,status,
              idempotency_key,attempt_count,coalesced_task_ids_json,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                delivery_id,
                run_id,
                report_export_id,
                kind,
                dumps(recipients),
                subject,
                "queued",
                idempotency_key,
                0,
                dumps(coalesced_task_ids or []),
                now,
                now,
            ),
        )

    if not recipients:
        with transaction() as connection:
            connection.execute(
                """
                UPDATE email_deliveries SET status='failed', error=?, updated_at=? WHERE id=?
                """,
                ("No recipients in run automation snapshot", utcnow(), delivery_id),
            )
        return {"id": delivery_id, "status": "failed", "error": "No recipients configured"}

    cfg = email_configured()
    if not cfg["configured"]:
        with transaction() as connection:
            connection.execute(
                """
                UPDATE email_deliveries
                SET status='not_configured', error=?, provider='none', updated_at=?
                WHERE id=?
                """,
                (cfg["message"], utcnow(), delivery_id),
            )
            connection.execute(
                "UPDATE runs SET delivery_status='failed', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
        open_attention(
            run_id=run_id,
            project_id=policy.get("project_id"),
            kind="email_failed",
            reason="Email not configured — message was not sent",
            action_hint="Configure EMAIL_PROVIDER",
        )
        return {"id": delivery_id, "status": "not_configured", "error": cfg["message"]}

    attachments = []
    if attach_path and attach_path.exists():
        attachments.append(
            (
                attach_path.name,
                attach_path.read_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        )

    with transaction() as connection:
        connection.execute(
            "UPDATE email_deliveries SET status='sending', attempt_count=attempt_count+1, updated_at=? WHERE id=?",
            (utcnow(), delivery_id),
        )

    result = get_email_provider().send(
        to=recipients,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachments=attachments,
    )
    with transaction() as connection:
        connection.execute(
            """
            UPDATE email_deliveries
            SET status=?, provider=?, provider_message_id=?, error=?, sent_at=?, updated_at=?
            WHERE id=?
            """,
            (
                result.status,
                result.provider,
                result.message_id,
                result.error,
                utcnow() if result.status in ("provider_accepted", "delivered") else None,
                utcnow(),
                delivery_id,
            ),
        )
        if result.status == "provider_accepted":
            connection.execute(
                "UPDATE runs SET delivery_status='accepted', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
        elif result.status == "delivered":
            connection.execute(
                "UPDATE runs SET delivery_status='delivered', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
        elif result.status in ("failed", "not_configured"):
            connection.execute(
                "UPDATE runs SET delivery_status='failed', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
            open_attention(
                run_id=run_id,
                project_id=policy.get("project_id"),
                kind="email_failed",
                reason=result.error or "Email delivery failed",
                action_hint="Retry send",
            )
        elif result.status == "unknown":
            connection.execute(
                "UPDATE runs SET delivery_status='unknown', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
    audit(
        "email_send",
        run_id=run_id,
        payload={"delivery_id": delivery_id, "status": result.status, "kind": kind},
    )
    return {
        "id": delivery_id,
        "status": result.status,
        "provider": result.provider,
        "message_id": result.message_id,
        "error": result.error,
        "idempotency_key": idempotency_key,
    }


def maybe_notify_and_deliver(run_id: str) -> dict[str, Any]:
    """After analysis or review changes: create tasks, decide eligibility, notify/deliver."""
    ensure_ops_schema()
    policy = get_run_automation(run_id) or {}
    tasks = create_review_tasks_for_run(run_id)
    decision = evaluate_delivery_eligibility(run_id)
    outcome: dict[str, Any] = {"tasks": tasks, "decision": decision, "email": None, "export": None}

    project_id = policy.get("project_id")
    with connect() as connection:
        run = connection.execute(
            """
            SELECT r.*, d.family, d.edition FROM runs r
            LEFT JOIN documents d ON d.id=r.target_document_id WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
        snap = connection.execute(
            "SELECT patent_identifier FROM run_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
    patent = (snap["patent_identifier"] if snap else None) or "Patent"

    # Review / "analysis ready" notifications never attach an unapproved report.
    if tasks and policy.get("notify_review_required"):
        reasons = sorted({t["reason_text"] for t in tasks})[:5]
        subject = f"Review required: {patent} — {len(tasks)} items need attention"
        link = _deep_link(project_id, run_id, tasks[0].get("element_id"))
        dash = _deep_link(project_id, run_id)
        text = (
            f"Project review required for {patent}.\n"
            f"Pending issues: {len(tasks)}\n"
            f"Reasons:\n- " + "\n- ".join(reasons) + "\n\n"
            f"Review flagged rows: {link}\n"
            f"Dashboard: {dash}\n"
            "No report attachment is included with this notification.\n"
        )
        html = (
            f"<p>Project review required for <strong>{patent}</strong>.</p>"
            f"<p>{len(tasks)} items need attention.</p><ul>"
            + "".join(f"<li>{r}</li>" for r in reasons)
            + f"</ul><p><a href=\"{link}\">Review flagged rows</a> · "
            f"<a href=\"{dash}\">Open Dashboard</a></p>"
            "<p>No report attachment is included with this notification.</p>"
        )
        outcome["email"] = queue_or_send_email(
            run_id=run_id,
            kind="review_notification",
            subject=subject,
            text_body=text,
            html_body=html,
            coalesced_task_ids=[t["id"] for t in tasks],
        )
    elif (
        not decision["eligible"]
        and policy.get("notify_analysis_completed")
        and run
        and run["status"] in ("analyst_review", "complete")
    ):
        # Analysis ready for review — never send the Word bundle as a completed deliverable.
        subject = f"Analysis ready for review: {patent}"
        text = (
            f"Analysis is ready for review for {patent}.\n"
            f"Standard: {run['family']} {run['edition']}\n"
            f"Pending required reviews or checks remain — the report was not sent as a completed deliverable.\n"
            f"Dashboard: {_deep_link(project_id, run_id)}\n"
        )
        outcome["email"] = queue_or_send_email(
            run_id=run_id,
            kind="review_notification",
            subject=subject,
            text_body=text,
        )

    if decision["eligible"]:
        if policy.get("mode") == "review_before_send":
            # Downloadable draft only; report email waits for Approve and send.
            export = generate_report_export(run_id, requested_final=False)
            outcome["export"] = export
            with transaction() as connection:
                connection.execute(
                    "UPDATE runs SET delivery_status='blocked', updated_at=? WHERE id=?",
                    (utcnow(), run_id),
                )
        elif policy.get("mode") == "send_when_checks_pass":
            export = generate_report_export(run_id, requested_final=False)
            outcome["export"] = export
            if policy.get("recipients"):
                subject = f"Analysis complete: {patent} — {run['family'] or 'standard'}"
                text = (
                    f"Patent: {patent}\n"
                    f"Standard: {run['family']} {run['edition']}\n"
                    f"Status: AI-generated; automated checks passed.\n"
                    f"Important: Selecting a target standard does not prove patent essentiality.\n"
                    f"View report: {_deep_link(project_id, run_id)}\n"
                )
                outcome["email"] = queue_or_send_email(
                    run_id=run_id,
                    kind="completion",
                    subject=subject,
                    text_body=text,
                    report_export_id=export["id"],
                    attach_path=Path(export["path"]) if policy.get("attach_word_bundle") else None,
                )
    else:
        # Draft saved; do not send as completed deliverable
        try:
            outcome["export"] = generate_report_export(run_id, requested_final=False)
        except Exception as exc:  # noqa: BLE001
            outcome["export_error"] = str(exc)

    return outcome


def approve_and_send(run_id: str) -> dict[str, Any]:
    """Human gate: generate current bundle and send to snapshotted recipients."""
    decision = evaluate_delivery_eligibility(run_id)
    if not decision["eligible"]:
        raise ValueError("Delivery not eligible: " + "; ".join(decision["reasons"]))
    # Check no newer open tasks vs fingerprint
    export = generate_report_export(run_id, requested_final=True)
    if export["fingerprint"] != decision["fingerprint"]:
        raise ValueError("Chart changed while approving; re-evaluate before send")
    policy = get_run_automation(run_id) or {}
    with connect() as connection:
        run = connection.execute(
            """
            SELECT r.*, d.family, d.edition FROM runs r
            LEFT JOIN documents d ON d.id=r.target_document_id WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
        snap = connection.execute(
            "SELECT patent_identifier FROM run_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
    patent = (snap["patent_identifier"] if snap else None) or "Patent"
    designation = "Human reviewed" if export["human_reviewed"] else "AI-generated; automated checks passed."
    subject = f"Analysis complete: {patent} — {run['family'] or 'standard'}"
    text = (
        f"Patent: {patent}\n"
        f"Standard: {run['family']} {run['edition']}\n"
        f"Status: {designation}\n"
        f"Attachment revision: {export['fingerprint'][:12]}\n"
        f"Important: Selecting a target standard does not prove patent essentiality.\n"
        f"View report: {_deep_link(policy.get('project_id'), run_id)}\n"
    )
    email = queue_or_send_email(
        run_id=run_id,
        kind="completion",
        subject=subject,
        text_body=text,
        report_export_id=export["id"],
        attach_path=Path(export["path"]) if policy.get("attach_word_bundle") else None,
        force=False,
    )
    return {"export": export, "email": email, "decision": decision}


def send_updated_report(run_id: str) -> dict[str, Any]:
    """Explicit action after a version was already sent — never unsolicited."""
    export = generate_report_export(run_id, requested_final=False)
    policy = get_run_automation(run_id) or {}
    with connect() as connection:
        run = connection.execute(
            "SELECT r.*, d.family, d.edition FROM runs r LEFT JOIN documents d ON d.id=r.target_document_id WHERE r.id=?",
            (run_id,),
        ).fetchone()
        snap = connection.execute(
            "SELECT patent_identifier FROM run_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
    patent = (snap["patent_identifier"] if snap else None) or "Patent"
    email = queue_or_send_email(
        run_id=run_id,
        kind="updated_report",
        subject=f"Updated report: {patent} — {run['family'] or 'standard'}",
        text_body=(
            f"Updated Word bundle for {patent} / {run['family']} {run['edition']}.\n"
            f"Revision: {export['fingerprint'][:12]}\n"
            "This send was explicitly requested.\n"
        ),
        report_export_id=export["id"],
        attach_path=Path(export["path"]) if policy.get("attach_word_bundle") else None,
        force=True,
    )
    return {"export": export, "email": email}


def mark_exports_stale(run_id: str) -> None:
    ensure_ops_schema()
    with transaction() as connection:
        connection.execute(
            "UPDATE report_exports SET status='stale', updated_at=? WHERE run_id=? AND status='current'",
            (utcnow(), run_id),
        )
        connection.execute(
            "UPDATE runs SET export_status='stale', updated_at=? WHERE id=?",
            (utcnow(), run_id),
        )


def finalize_run_operations(run_id: str) -> dict[str, Any]:
    """Called when a run reaches analyst_review or failed."""
    ensure_ops_schema()
    with connect() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if not run:
        return {}
    if run["status"] == "failed":
        open_attention(
            run_id=run_id,
            project_id=None,
            kind="model_or_retrieval_failed",
            reason=run["error"] or "Analysis failed",
            action_hint="Retry",
        )
        with transaction() as connection:
            connection.execute(
                "UPDATE runs SET verification_status='failed', human_review_status='not_required', delivery_status='blocked', updated_at=? WHERE id=?",
                (utcnow(), run_id),
            )
        return {"status": "failed"}
    return maybe_notify_and_deliver(run_id)


def after_row_change(run_id: str) -> dict[str, Any]:
    mark_exports_stale(run_id)
    return maybe_notify_and_deliver(run_id)

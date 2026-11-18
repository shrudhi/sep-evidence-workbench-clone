import json
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import get_settings
from .database import connect, init_db, transaction, utcnow
from .exporter import export_docx, render_page_screenshot
from .ingest import load_manifest, register_manifest
from .model_provider import OpenAICompatibleProvider
from .projects import (
    DEFAULT_PROJECT_ID,
    build_run_snapshot,
    ensure_default_project,
    get_project,
    get_snapshot,
    setup_bundle,
    update_project,
)
from .retrieval import search
from .agent_ask import (
    accept_proposal,
    ensure_conversation,
    get_conversation,
    list_conversations,
    process_message,
    reject_proposal,
    submit_message,
)
from .citations import sanitize_missing_requirements
from .evidence import (
    human_status,
    mapping_display,
    resolve_evidence_blocks,
    review_status_display,
)
from .judge import (
    checks_dict_from_report,
    judge_display_from_checks,
    recheck_revision,
    recheck_run,
)
from .automation import (
    clear_analysis_override,
    compact_automation_label,
    get_effective_automation,
    get_workspace_defaults,
    normalize_settings,
    set_analysis_override,
    update_workspace_defaults,
)
from .dashboard import build_dashboard
from .delivery import (
    after_row_change,
    approve_and_send,
    evaluate_delivery_eligibility,
    generate_report_export,
    send_updated_report,
)
from .document_viewer import (
    document_pdf_path,
    document_viewer_meta,
    render_document_page,
    span_anchor,
)
from .email_provider import email_configured
from .evaluation import (
    adjudicate_criterion,
    attach_default_chart_pdf,
    compare_evaluation_runs,
    confirm_alignments,
    create_evaluation_run,
    empty_not_run_template,
    ensure_evaluation_schema,
    export_evaluation_bundle,
    get_dataset,
    get_evaluation_run,
    get_reference_file,
    import_default_reference_pack,
    list_datasets,
    list_evaluation_runs,
    list_reference_files,
    remove_reference_file,
    upload_reference_file,
)
from .ai_review import ai_review_from_checks, review_revision
from .chart_schema import enrich_mapping_tags, ensure_chart_schema
from .ops_schema import ensure_ops_schema
from .product_evidence import (
    delete_accused_product,
    delete_product_evidence,
    delete_supplemental_document,
    list_accused_products,
    list_product_evidence,
    list_supplemental_documents,
    upsert_accused_product,
    upsert_product_evidence,
    upsert_supplemental_document,
)
from .run_worker import spawn_project_runs, spawn_single_run
from .workflow import (
    challenge_revision,
    confirm_target_documents,
    create_project_runs,
    create_run,
    create_target_challenge_run,
    revise_mapping_fields,
)

settings = get_settings()
app = FastAPI(
    title="Clause API",
    version="0.2.0",
    description="Patent-to-standard evidence workbench",
)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    document_ids: list[str] | None = None
    limit: int = Field(default=12, ge=1, le=30)


class RunRequest(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=3, max_length=100)
    project_id: str = Field(default=DEFAULT_PROJECT_ID, min_length=3, max_length=100)
    automation: dict[str, Any] | None = None


class ProjectPatch(BaseModel):
    patent_input_id: str | None = None
    claim_scope: Literal["all", "select"] | None = None
    selected_claim_numbers: list[int] | None = None
    selected_standard_ids: list[str] | None = None
    automation: dict[str, Any] | None = None


class AutomationPatch(BaseModel):
    mode: Literal["review_before_send", "send_when_checks_pass"] | None = None
    recipients: list[str] | str | None = None
    notify_review_required: bool | None = None
    notify_analysis_completed: bool | None = None
    attach_word_bundle: bool | None = None
    additional_formats: list[str] | None = None
    max_repair_attempts: int | None = Field(default=None, ge=0, le=3)


class ChallengeRequest(BaseModel):
    challenge: str = Field(min_length=3, max_length=3000)


class ConfirmTargetsRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1)
    project_id: str = Field(default=DEFAULT_PROJECT_ID, min_length=3, max_length=100)


class DecisionRequest(BaseModel):
    disposition: Literal["accept", "reject"]
    comment: str = Field(default="", max_length=3000)
    overrides_judge: bool = False
    judge_override_reason: str = Field(default="", max_length=3000)


class MappingEditRequest(BaseModel):
    rationale: str | None = Field(default=None, max_length=8000)
    mapping_label: Literal["Full map", "Partial map", "No map", "Abstain"] | None = None
    match_strength: (
        Literal[
            "direct support",
            "inference",
            "partial support",
            "no supporting passage",
        ]
        | None
    ) = None
    requirement_applicability: (
        Literal[
            "required",
            "required only under condition",
            "optional",
            "described only",
            "unclear",
        ]
        | None
    ) = None
    requirement_condition: str | None = Field(default=None, max_length=2000)
    edit_reason: str = Field(default="Analyst direct edit", max_length=3000)


class AccusedProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    model: str = Field(default="", max_length=300)
    software_version: str = Field(default="", max_length=300)
    configuration: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=3000)
    product_id: str | None = None


class ProductEvidenceRequest(BaseModel):
    product_id: str
    element_id: str
    finding: str = Field(min_length=1, max_length=4000)
    evidence_text: str = Field(default="", max_length=8000)
    evidence_source: str = Field(default="", max_length=1000)
    source_link: str = Field(default="", max_length=2000)
    unverified_notes: str = Field(default="", max_length=4000)


class SupplementalDocumentRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    kind: Literal["link", "upload", "note"] = "link"
    url_or_path: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=4000)


def startup() -> None:
    init_db()
    ensure_ops_schema()
    ensure_chart_schema()
    ensure_evaluation_schema()
    manifest_path = settings.source_dir / "manifest.json"
    if manifest_path.exists():
        with connect() as connection:
            register_manifest(connection, load_manifest(settings.source_dir))
            connection.commit()
    ensure_default_project()
    # Fail interrupted in-flight runs left behind by native process crashes.
    with transaction() as connection:
        connection.execute(
            """
            UPDATE runs
            SET status='failed',
                error=COALESCE(error, 'Interrupted by server restart'),
                updated_at=?
            WHERE status IN ('queued','selecting','searching','decomposing','mapping','reviewing')
            """,
            (utcnow(),),
        )
    try:
        import_default_reference_pack()
    except Exception as exc:  # noqa: BLE001 — Evaluations screen still loads as Not run
        print(f"evaluation reference import deferred: {exc}")
    # Keep embeddings out of the API process (native crashes). Analysis workers load them.
    # Agent ask uses FTS-only search in-process.


startup()


@app.get("/api/health")
def health() -> dict[str, Any]:
    with connect() as connection:
        documents = [
            dict(row)
            for row in connection.execute(
                """
                SELECT id,kind,family,edition,status,page_count,sha256,indexed_at
                FROM documents ORDER BY kind,family
                """
            )
        ]
        span_count = connection.execute("SELECT COUNT(*) AS count FROM spans").fetchone()["count"]
        embedding_count = connection.execute(
            "SELECT COUNT(*) AS count FROM spans WHERE embedding IS NOT NULL"
        ).fetchone()["count"]
    indexed_standards = sum(
        document["kind"] == "standard" and document["status"] == "indexed" for document in documents
    )
    return {
        "status": "ready" if span_count else "needs_ingestion",
        "documents": documents,
        "indexed_standard_count": indexed_standards,
        "expected_standard_count": 3,
        "spans": span_count,
        "embeddings": embedding_count,
        "provider": OpenAICompatibleProvider().readiness(),
    }


@app.get("/api/documents")
def documents() -> list[dict[str, Any]]:
    with connect() as connection:
        return [
            dict(row)
            for row in connection.execute(
                """
                SELECT d.*,
                  (SELECT COUNT(*) FROM spans s WHERE s.document_id=d.id) AS span_count,
                  (SELECT COUNT(*) FROM edges e WHERE e.document_id=d.id
                    AND e.resolution_status='unresolved') AS unresolved_references
                FROM documents d ORDER BY d.kind,d.family
                """
            )
        ]


@app.get("/api/projects/{project_id}")
def project_detail(project_id: str) -> dict[str, Any]:
    try:
        return get_project(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/setup")
def project_setup(project_id: str) -> dict[str, Any]:
    try:
        return setup_bundle(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: str, request: ProjectPatch) -> dict[str, Any]:
    patch = request.model_dump(exclude_none=True)
    automation_patch = patch.pop("automation", None)
    try:
        project = update_project(project_id, patch) if patch else get_project(project_id)
        # Project PATCH automation updates the analysis override only (not workspace defaults).
        if automation_patch is not None:
            automation = set_analysis_override(project_id, automation_patch)
        else:
            automation = get_effective_automation(project_id)
        return {
            **project,
            "automation": {
                **automation,
                "compact_label": compact_automation_label(automation),
                "workspace_defaults": get_workspace_defaults(project_id),
            },
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/automation")
def read_automation(project_id: str) -> dict[str, Any]:
    effective = get_effective_automation(project_id)
    return {
        **effective,
        "compact_label": compact_automation_label(effective),
        "workspace_defaults": get_workspace_defaults(project_id),
    }


@app.patch("/api/projects/{project_id}/automation")
def patch_automation(project_id: str, request: AutomationPatch) -> dict[str, Any]:
    """Update workspace defaults (Settings panel)."""
    try:
        defaults = update_workspace_defaults(project_id, request.model_dump(exclude_none=True))
        effective = get_effective_automation(project_id)
        return {
            **effective,
            "compact_label": compact_automation_label(effective),
            "workspace_defaults": defaults,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.put("/api/projects/{project_id}/automation/override")
def put_automation_override(project_id: str, request: AutomationPatch) -> dict[str, Any]:
    """Per-analysis override — does not change workspace defaults."""
    try:
        effective = set_analysis_override(project_id, request.model_dump(exclude_none=True))
        return {
            **effective,
            "compact_label": compact_automation_label(effective),
            "workspace_defaults": get_workspace_defaults(project_id),
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/projects/{project_id}/automation/override")
def delete_automation_override(project_id: str) -> dict[str, Any]:
    effective = clear_analysis_override(project_id)
    return {
        **effective,
        "compact_label": compact_automation_label(effective),
        "workspace_defaults": get_workspace_defaults(project_id),
    }


@app.get("/api/dashboard")
def dashboard(
    period: Literal["today", "7d", "30d"] = Query(default="7d"),
    project_id: str | None = None,
) -> dict[str, Any]:
    return build_dashboard(period=period, project_id=project_id)


@app.get("/api/email/status")
def email_status() -> dict[str, Any]:
    return email_configured()


@app.post("/api/search")
def hybrid_search(request: SearchRequest) -> list[dict[str, Any]]:
    try:
        return search(
            request.query,
            document_ids=request.document_ids,
            limit=request.limit,
            expand_graph=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/runs", status_code=202)
def start_run(request: RunRequest) -> dict[str, Any]:
    try:
        if request.automation is not None:
            automation = normalize_settings(request.automation)
        else:
            automation = get_effective_automation(request.project_id)
        snapshot = build_run_snapshot(request.project_id)
        run_ids = create_project_runs(
            request.session_id,
            project_id=request.project_id,
            snapshot=snapshot,
            automation=automation,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    spawn_project_runs(run_ids)
    return {
        "id": run_ids[0],
        "ids": run_ids,
        "status": "queued",
        "document_count": len(run_ids),
        "automation": {
            "mode": automation.get("mode"),
            "recipients": automation.get("recipients") or [],
            "policy_summary": automation.get("policy_summary"),
            "require_human_approval": automation.get("require_human_approval"),
        },
    }


@app.get("/api/runs")
def list_runs(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT r.id,r.status,r.target_document_id,r.created_at,r.updated_at,r.error,
                       d.family,d.edition
                FROM runs r LEFT JOIN documents d ON d.id=r.target_document_id
                ORDER BY r.created_at DESC LIMIT ?
                """,
                (limit,),
            )
        ]
    for row in rows:
        row["status_label"] = human_status(row["status"])
    return rows


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT r.*,d.family,d.edition FROM runs r
            LEFT JOIN documents d ON d.id=r.target_document_id WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Unknown run")
    result = dict(row)
    for field in ("target_decision_json", "model_config_json"):
        result[field.removesuffix("_json")] = json.loads(result.pop(field) or "null")
    result["snapshot"] = get_snapshot(run_id)
    # Attach proof excerpts for Setup standard cards (rationale + source quotes).
    decision = result.get("target_decision")
    if isinstance(decision, dict) and decision.get("candidates"):
        enriched = []
        for candidate in decision["candidates"]:
            span_ids = list(candidate.get("evidence_span_ids") or [])
            proofs = []
            for block in resolve_evidence_blocks(span_ids, refine=False):
                if not block.get("quote") or not block.get("available", True):
                    continue
                section = (
                    block.get("section_ref")
                    or block.get("section_label")
                    or block.get("citation_heading")
                    or "Source"
                )
                page = block.get("printed_label") or block.get("page_ordinal")
                proofs.append(
                    {
                        "span_id": block.get("evidence_id"),
                        "section": section,
                        "page": page,
                        "quote": block.get("quote"),
                    }
                )
            enriched.append({**candidate, "proofs": proofs})
        result["target_decision"] = {**decision, "candidates": enriched}
    return result


@app.get("/api/runs/{run_id}/events")
def run_events(run_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM trace_events WHERE run_id=? ORDER BY id", (run_id,)
        ).fetchall()
    events = []
    for row in rows:
        item = dict(row)
        for field in ("arguments_json", "result_summary_json", "usage_json"):
            item[field.removesuffix("_json")] = json.loads(item.pop(field) or "null")
        events.append(item)
    return events


@app.get("/api/runs/{run_id}/trace")
def run_trace(run_id: str) -> dict[str, Any]:
    return {"run": get_run(run_id), "events": run_events(run_id), "chart": chart(run_id)}


@app.post("/api/runs/{run_id}/retry", status_code=202)
def retry_run(run_id: str) -> dict[str, Any]:
    """Document-specific retry: new run for the same target; preserves failed history."""
    with connect() as connection:
        row = connection.execute(
            "SELECT id,status,session_id,target_document_id,model_config_json FROM runs WHERE id=?",
            (run_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Unknown run")
    if row["status"] != "failed":
        raise HTTPException(
            status_code=422,
            detail=f"Only failed runs can be retried (status={row['status']})",
        )
    if not row["target_document_id"]:
        raise HTTPException(status_code=422, detail="Run has no target document to retry")
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    snapshot = get_snapshot(run_id)
    if not snapshot:
        raise HTTPException(status_code=422, detail="Run snapshot missing; start a new analysis")
    model_config = json.loads(row["model_config_json"] or "{}")
    project_id = model_config.get("project_id") or DEFAULT_PROJECT_ID
    try:
        new_id = create_run(
            row["session_id"],
            project_id=project_id,
            snapshot=snapshot,
            target_document_id=row["target_document_id"],
            allow_queue_when_active=True,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    spawn_single_run(new_id)
    return {
        "id": new_id,
        "status": "queued",
        "parent_run_id": run_id,
        "target_document_id": row["target_document_id"],
        "retried": True,
    }


@app.post("/api/runs/{run_id}/target-challenge", status_code=202)
def challenge_target(run_id: str, request: ChallengeRequest) -> dict[str, str]:
    try:
        branch_id = create_target_challenge_run(run_id, request.challenge)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    spawn_single_run(branch_id)
    return {"id": branch_id, "status": "queued", "parent_run_id": run_id}


@app.post("/api/runs/{run_id}/confirm-targets", status_code=202)
def confirm_targets(run_id: str, request: ConfirmTargetsRequest) -> dict[str, Any]:
    """Analyst confirms which standard(s) to chart after selection pause."""
    try:
        chart_ids = confirm_target_documents(
            run_id,
            document_ids=request.document_ids,
            project_id=request.project_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    spawn_project_runs(chart_ids)
    return {
        "selection_run_id": run_id,
        "ids": chart_ids,
        "id": chart_ids[0],
        "document_count": len(chart_ids),
        "status": "queued",
        "warning": (
            f"Creating {len(chart_ids)} separate claim chart"
            f"{'' if len(chart_ids) == 1 else 's'} — one per selected standard."
            if len(chart_ids) > 1
            else None
        ),
    }


@app.get("/api/runs/{run_id}/chart")
def chart(run_id: str) -> dict[str, Any]:
    with connect() as connection:
        run = connection.execute(
            """
            SELECT r.id,r.status,r.target_document_id,r.error,r.created_at,r.updated_at,
                   d.family,d.edition,d.title
            FROM runs r LEFT JOIN documents d ON d.id=r.target_document_id
            WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Unknown run")
        elements = connection.execute(
            "SELECT * FROM claim_elements WHERE run_id=? ORDER BY ordinal", (run_id,)
        ).fetchall()
        result_rows = []
        for element in elements:
            revisions = connection.execute(
                """
                SELECT rr.*,rv.disposition AS review_disposition,rv.checks_json,rv.reasons_json,
                       rv.model_name AS review_model_name,rv.created_at AS review_created_at,
                       rv.id AS review_id,
                       ad.disposition AS analyst_disposition,ad.comment AS analyst_comment,
                       ad.overrides_judge AS analyst_overrides_judge,
                       ad.judge_override_reason AS analyst_judge_override_reason
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
                WHERE rr.element_id=? ORDER BY rr.revision_number,rr.created_at
                """,
                (element["id"],),
            ).fetchall()
            thread_count = connection.execute(
                "SELECT COUNT(*) AS count FROM comment_threads WHERE element_id=?",
                (element["id"],),
            ).fetchone()["count"]
            rendered_revisions = []
            latest_revision_id = revisions[-1]["id"] if revisions else None
            for revision in revisions:
                item = dict(revision)
                for field in (
                    "evidence_ids_json",
                    "counterevidence_ids_json",
                    "missing_requirements_json",
                    "integrity_json",
                    "checks_json",
                    "reasons_json",
                ):
                    item[field.removesuffix("_json")] = json.loads(item.pop(field) or "null")
                evidence_ids = item.get("evidence_ids") or []
                counter_ids = item.get("counterevidence_ids") or []
                # Only the latest revision needs full highlight refinement for the UI.
                is_latest = revision["id"] == latest_revision_id
                item["evidence_blocks"] = resolve_evidence_blocks(
                    evidence_ids, role="supporting", refine=is_latest
                )
                item["candidate_blocks"] = resolve_evidence_blocks(
                    [span_id for span_id in counter_ids if span_id not in evidence_ids],
                    role="candidate",
                    refine=is_latest,
                )
                item.update(mapping_display(item.get("mapping_label")))
                tags = enrich_mapping_tags(
                    {
                        "mapping_label": item.get("mapping_label"),
                        "evidence_status": item.get("evidence_status"),
                        "match_strength": item.get("match_strength"),
                        "requirement_applicability": item.get(
                            "requirement_applicability"
                        ),
                        "requirement_condition": item.get("requirement_condition") or "",
                    }
                )
                item["match_strength"] = tags["match_strength"]
                item["requirement_applicability"] = tags["requirement_applicability"]
                item["requirement_condition"] = tags.get("requirement_condition") or ""
                element_requirements = json.loads(element["requirements_json"] or "[]")
                item["missing_requirements"] = sanitize_missing_requirements(
                    item.get("missing_requirements") or [],
                    requirements=element_requirements,
                    rationale=item.get("rationale"),
                )
                judge_view = judge_display_from_checks(
                    item.get("checks") if isinstance(item.get("checks"), dict) else {},
                    disposition=item.get("review_disposition"),
                    reasons=item.get("reasons") or [],
                    integrity=item.get("integrity")
                    if isinstance(item.get("integrity"), dict)
                    else None,
                )
                item["judge"] = judge_view.get("judge")
                # Prefer structured Judge labels; fall back to disposition helper.
                if judge_view.get("judge") and not judge_view["judge"].get("legacy"):
                    item["mapping_review_status"] = judge_view.get("mapping_review_status")
                    item["mapping_review_incomplete"] = judge_view.get(
                        "mapping_review_incomplete"
                    )
                    item["reasons"] = [
                        reason
                        for reason in (item.get("reasons") or [])
                        if "exact unresolved requirements" not in str(reason).lower()
                    ] or (item.get("reasons") or [])
                else:
                    item.update(
                        review_status_display(
                            disposition=item.get("review_disposition"),
                            reasons=item.get("reasons") or [],
                        )
                    )
                    item["judge"] = judge_view.get("judge")
                checks_obj = (
                    item.get("checks") if isinstance(item.get("checks"), dict) else {}
                )
                item["ai_review"] = ai_review_from_checks(checks_obj)
                rendered_revisions.append(item)
            element_item = dict(element)
            element_item["requirements"] = json.loads(element_item.pop("requirements_json"))
            element_item["revisions"] = rendered_revisions
            element_item["thread_count"] = thread_count
            element_item["product_evidence"] = list_product_evidence(
                run_id, element_id=element["id"]
            )
            result_rows.append(element_item)
    run_payload = dict(run)
    run_payload["status_label"] = human_status(run_payload["status"])
    return {
        "run": run_payload,
        "rows": result_rows,
        "accused_products": list_accused_products(run_id),
        "supplemental_documents": list_supplemental_documents(run_id),
    }


class AgentConversationRequest(BaseModel):
    run_id: str = Field(min_length=3, max_length=100)
    scope_type: Literal["element", "standard"]
    document_id: str = Field(min_length=3, max_length=200)
    element_id: str | None = None


class AgentMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    force_intent: Literal["question", "investigation", "revision"] | None = None


class ProposalRejectRequest(BaseModel):
    reason: str = Field(default="", max_length=2000)


@app.get("/api/runs/{run_id}/agent/conversations")
def agent_conversations(run_id: str) -> list[dict[str, Any]]:
    return list_conversations(run_id)


@app.post("/api/agent/conversations", status_code=201)
def create_agent_conversation(request: AgentConversationRequest) -> dict[str, Any]:
    try:
        return ensure_conversation(
            run_id=request.run_id,
            scope_type=request.scope_type,
            document_id=request.document_id,
            element_id=request.element_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/agent/conversations/{conversation_id}")
def read_agent_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return get_conversation(conversation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/agent/conversations/{conversation_id}/messages", status_code=202)
def post_agent_message(
    conversation_id: str,
    request: AgentMessageRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    try:
        created = submit_message(
            conversation_id, request.body, force_intent=request.force_intent
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    background_tasks.add_task(
        process_message,
        conversation_id,
        created["user_message_id"],
        created["assistant_message_id"],
    )
    return {**created, "status": "queued"}


@app.post("/api/agent/proposals/{proposal_id}/accept")
def accept_agent_proposal(proposal_id: str) -> dict[str, Any]:
    try:
        result = accept_proposal(proposal_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run_id = result.get("run_id")
    if run_id:
        result["delivery"] = after_row_change(run_id)
    return result


@app.post("/api/agent/proposals/{proposal_id}/reject")
def reject_agent_proposal(
    proposal_id: str, request: ProposalRejectRequest
) -> dict[str, Any]:
    try:
        return reject_proposal(proposal_id, request.reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/rows/{revision_id}/challenge", status_code=202)
def challenge(revision_id: str, request: ChallengeRequest) -> dict[str, Any]:
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    try:
        new_revision_id = challenge_revision(revision_id, request.challenge)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with connect() as connection:
        run_row = connection.execute(
            "SELECT run_id FROM row_revisions WHERE id=?", (new_revision_id,)
        ).fetchone()
    if run_row:
        after_row_change(run_row["run_id"])
    return {"revision_id": new_revision_id, "status": "reviewed"}


@app.post("/api/rows/{revision_id}/recheck")
def recheck_judge(revision_id: str) -> dict[str, Any]:
    """Re-run Judge on this revision; remapping when remappable issues are found.

    Soft screenshot/folio Needs review alone updates the review record only.
    Failures, semantic J05–J07 issues, or incomplete Judge review trigger a
    bounded remap→re-judge loop and persist a new latest revision for the UI.
    """
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    try:
        report = recheck_revision(revision_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    from .judge import build_rework_feedback, should_auto_rework
    from .workflow import map_element_with_judge_loop

    latest_revision_id = revision_id
    remapped = False
    if should_auto_rework(report):
        with connect() as connection:
            row = connection.execute(
                """
                SELECT rr.*,ce.label,ce.exact_text,ce.start_offset,ce.end_offset,
                       ce.requirements_json,r.target_document_id
                FROM row_revisions rr
                JOIN claim_elements ce ON ce.id=rr.element_id
                JOIN runs r ON r.id=rr.run_id
                WHERE rr.id=?
                """,
                (revision_id,),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Unknown revision")
        element = {
            "id": row["element_id"],
            "label": row["label"],
            "exact_text": row["exact_text"],
            "start_offset": row["start_offset"],
            "end_offset": row["end_offset"],
            "requirements": json.loads(row["requirements_json"] or "[]"),
        }
        try:
            latest_revision_id, _, _ = map_element_with_judge_loop(
                run_id=row["run_id"],
                element=element,
                target_document_id=row["target_document_id"],
                revision_number=int(row["revision_number"]) + 1,
                prior_revision_id=revision_id,
                review_feedback=build_rework_feedback(report),
            )
            remapped = latest_revision_id != revision_id
            # Load the Judge report bound to the latest revision for the response.
            with connect() as connection:
                latest_review = connection.execute(
                    """
                    SELECT checks_json, disposition, reasons_json, id
                    FROM review_results
                    WHERE revision_id=?
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (latest_revision_id,),
                ).fetchone()
            if latest_review:
                latest_checks = json.loads(latest_review["checks_json"] or "{}")
                report = {
                    **report,
                    **latest_checks,
                    "disposition": latest_review["disposition"],
                    "reasons": json.loads(latest_review["reasons_json"] or "[]"),
                    "review_id": latest_review["id"],
                    "revision_id": latest_revision_id,
                }
        except Exception as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    with connect() as connection:
        run_row = connection.execute(
            "SELECT run_id FROM row_revisions WHERE id=?", (latest_revision_id,)
        ).fetchone()
    if run_row:
        after_row_change(run_row["run_id"])
    return {
        "revision_id": latest_revision_id,
        "prior_revision_id": revision_id if remapped else None,
        "review_id": report.get("review_id"),
        "status": "remapped" if remapped else "rechecked",
        "remapped": remapped,
        "judge": checks_dict_from_report(report) | {"legacy": False},
        "disposition": report.get("disposition"),
    }


@app.post("/api/runs/{run_id}/recheck")
def recheck_run_judge(run_id: str, only_incomplete: bool = True) -> dict[str, Any]:
    """Backfill Judge rubric for every latest revision lacking judge-v2 results."""
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    with connect() as connection:
        run = connection.execute("SELECT id FROM runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Unknown run")
    try:
        summary = recheck_run(run_id, only_incomplete=only_incomplete)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    after_row_change(run_id)
    return summary


class AiReviewRequest(BaseModel):
    """Adapted Worker contract: identify the row revision to review."""

    revision_id: str = Field(min_length=3, max_length=100)


@app.post("/api/review")
def ai_review(request: AiReviewRequest) -> dict[str, Any]:
    """AI Review for one chart row (attachment contract: POST /api/review)."""
    try:
        result = review_revision(request.revision_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@app.post("/api/rows/{revision_id}/ai-review")
def ai_review_row(revision_id: str) -> dict[str, Any]:
    """Alias for POST /api/review keyed by revision path."""
    try:
        result = review_revision(revision_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@app.post("/api/rows/{revision_id}/search-again")
def search_again(revision_id: str) -> dict[str, Any]:
    """Explicit analyst action: re-search evidence and remapping this row."""
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    challenge_text = (
        "Search again for supporting and counterevidence passages for this claim element. "
        "Prefer previously missed sections, definitions, tables, figures, annexes, and "
        "cross-references. Update match_strength and requirement_applicability from the "
        "fresh evidence."
    )
    try:
        new_revision_id = challenge_revision(revision_id, challenge_text)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with connect() as connection:
        run_row = connection.execute(
            "SELECT run_id FROM row_revisions WHERE id=?", (new_revision_id,)
        ).fetchone()
    if run_row:
        after_row_change(run_row["run_id"])
    return {
        "revision_id": new_revision_id,
        "prior_revision_id": revision_id,
        "status": "searched",
    }


@app.post("/api/rows/{revision_id}/edit")
def edit_mapping(revision_id: str, request: MappingEditRequest) -> dict[str, Any]:
    """Analyst direct edit of rationale / mapping tags (creates a new revision)."""
    if not OpenAICompatibleProvider().readiness()["ready"]:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    try:
        new_revision_id = revise_mapping_fields(
            revision_id,
            {
                "rationale": request.rationale,
                "mapping_label": request.mapping_label,
                "match_strength": request.match_strength,
                "requirement_applicability": request.requirement_applicability,
                "requirement_condition": request.requirement_condition,
                "edit_reason": request.edit_reason,
            },
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with connect() as connection:
        run_row = connection.execute(
            "SELECT run_id FROM row_revisions WHERE id=?", (new_revision_id,)
        ).fetchone()
    if run_row:
        after_row_change(run_row["run_id"])
    ai_review = None
    try:
        ai_review = review_revision(new_revision_id)
    except Exception:
        ai_review = None
    return {
        "revision_id": new_revision_id,
        "prior_revision_id": revision_id,
        "status": "edited",
        "ai_review": ai_review,
    }


@app.get("/api/runs/{run_id}/accused-products")
def get_accused_products(run_id: str) -> dict[str, Any]:
    return {"items": list_accused_products(run_id)}


@app.post("/api/runs/{run_id}/accused-products")
def post_accused_product(run_id: str, request: AccusedProductRequest) -> dict[str, Any]:
    try:
        item = upsert_accused_product(run_id, request.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return item


@app.delete("/api/runs/{run_id}/accused-products/{product_id}")
def remove_accused_product(run_id: str, product_id: str) -> dict[str, str]:
    delete_accused_product(run_id, product_id)
    return {"status": "deleted"}


@app.get("/api/runs/{run_id}/product-evidence")
def get_product_evidence(run_id: str, element_id: str | None = None) -> dict[str, Any]:
    return {"items": list_product_evidence(run_id, element_id=element_id)}


@app.post("/api/runs/{run_id}/product-evidence")
def post_product_evidence(run_id: str, request: ProductEvidenceRequest) -> dict[str, Any]:
    try:
        return upsert_product_evidence(run_id, request.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/runs/{run_id}/product-evidence/{evidence_id}")
def remove_product_evidence(run_id: str, evidence_id: str) -> dict[str, str]:
    delete_product_evidence(run_id, evidence_id)
    return {"status": "deleted"}


@app.get("/api/runs/{run_id}/supplemental-documents")
def get_supplemental_documents(run_id: str) -> dict[str, Any]:
    return {"items": list_supplemental_documents(run_id)}


@app.post("/api/runs/{run_id}/supplemental-documents")
def post_supplemental_document(
    run_id: str, request: SupplementalDocumentRequest
) -> dict[str, Any]:
    return upsert_supplemental_document(run_id, request.model_dump())


@app.delete("/api/runs/{run_id}/supplemental-documents/{document_id}")
def remove_supplemental_document(run_id: str, document_id: str) -> dict[str, str]:
    delete_supplemental_document(run_id, document_id)
    return {"status": "deleted"}


@app.post("/api/rows/{revision_id}/decision")
def decide(revision_id: str, request: DecisionRequest) -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute(
            "SELECT run_id FROM row_revisions WHERE id=?", (revision_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Unknown revision")
        accepted = connection.execute(
            """
            SELECT id FROM analyst_decisions
            WHERE revision_id=? AND disposition='accept' ORDER BY created_at DESC LIMIT 1
            """,
            (revision_id,),
        ).fetchone()
        if accepted:
            raise HTTPException(
                status_code=409,
                detail="Accepted revisions are immutable; challenge to create a new revision",
            )
        if request.overrides_judge and not (
            request.judge_override_reason or request.comment
        ).strip():
            raise HTTPException(
                status_code=422,
                detail="Judge override requires a recorded reason",
            )
        comment = request.comment.strip()
        if request.overrides_judge:
            reason = (request.judge_override_reason or request.comment).strip()
            comment = (
                f"[Override Judge] {reason}"
                if not comment.startswith("[Override Judge]")
                else comment
            )
        connection.execute(
            """
            INSERT INTO analyst_decisions(
              id,revision_id,disposition,comment,created_at,overrides_judge,judge_override_reason
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4()),
                revision_id,
                request.disposition,
                comment,
                utcnow(),
                1 if request.overrides_judge else 0,
                (request.judge_override_reason or "").strip(),
            ),
        )
        undecided = connection.execute(
            """
            SELECT COUNT(*) AS count FROM claim_elements ce
            WHERE ce.run_id=? AND NOT EXISTS (
              SELECT 1 FROM row_revisions rr JOIN analyst_decisions ad ON ad.revision_id=rr.id
              WHERE rr.id=(SELECT id FROM row_revisions latest
                WHERE latest.element_id=ce.id ORDER BY latest.revision_number DESC LIMIT 1)
            )
            """,
            (row["run_id"],),
        ).fetchone()["count"]
        if undecided == 0:
            connection.execute(
                "UPDATE runs SET status='complete',updated_at=? WHERE id=?",
                (utcnow(), row["run_id"]),
            )
    ops = after_row_change(row["run_id"])
    return {
        "revision_id": revision_id,
        "disposition": request.disposition,
        "overrides_judge": request.overrides_judge,
        "delivery": ops.get("decision"),
        "export": ops.get("export"),
    }


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    author_display_name: str = Field(default="Shrudhi Satya", max_length=120)
    assigned_reviewer_name: str | None = Field(default=None, max_length=120)
    evidence_id: str | None = None
    revision_id: str | None = None


class NoteReply(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    author_display_name: str = Field(default="Shrudhi Satya", max_length=120)


class ThreadPatch(BaseModel):
    status: Literal["open", "resolved"] | None = None
    assigned_reviewer_name: str | None = None


@app.get("/api/elements/{element_id}/threads")
def list_threads(element_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        threads = connection.execute(
            """
            SELECT * FROM comment_threads WHERE element_id=? ORDER BY created_at DESC
            """,
            (element_id,),
        ).fetchall()
        result = []
        for thread in threads:
            item = dict(thread)
            item["comments"] = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM comments
                    WHERE thread_id=? AND deleted=0 ORDER BY created_at
                    """,
                    (thread["id"],),
                )
            ]
            result.append(item)
    return result


@app.post("/api/elements/{element_id}/threads", status_code=201)
def create_thread(element_id: str, request: NoteCreate) -> dict[str, Any]:
    with transaction() as connection:
        element = connection.execute(
            "SELECT id FROM claim_elements WHERE id=?", (element_id,)
        ).fetchone()
        if not element:
            raise HTTPException(status_code=404, detail="Unknown claim element")
        thread_id = str(uuid.uuid4())
        comment_id = str(uuid.uuid4())
        now = utcnow()
        connection.execute(
            """
            INSERT INTO comment_threads(
              id,element_id,revision_id,evidence_id,author_display_name,
              assigned_reviewer_name,status,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                thread_id,
                element_id,
                request.revision_id,
                request.evidence_id,
                request.author_display_name,
                request.assigned_reviewer_name,
                "open",
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO comments(id,thread_id,author_display_name,body,created_at,updated_at,deleted)
            VALUES(?,?,?,?,?,?,0)
            """,
            (comment_id, thread_id, request.author_display_name, request.body, now, now),
        )
    threads = list_threads(element_id)
    return next(thread for thread in threads if thread["id"] == thread_id)


@app.post("/api/threads/{thread_id}/replies", status_code=201)
def reply_thread(thread_id: str, request: NoteReply) -> dict[str, Any]:
    with transaction() as connection:
        thread = connection.execute(
            "SELECT * FROM comment_threads WHERE id=?", (thread_id,)
        ).fetchone()
        if not thread:
            raise HTTPException(status_code=404, detail="Unknown thread")
        comment_id = str(uuid.uuid4())
        now = utcnow()
        connection.execute(
            """
            INSERT INTO comments(id,thread_id,author_display_name,body,created_at,updated_at,deleted)
            VALUES(?,?,?,?,?,?,0)
            """,
            (comment_id, thread_id, request.author_display_name, request.body, now, now),
        )
        connection.execute(
            "UPDATE comment_threads SET updated_at=? WHERE id=?",
            (now, thread_id),
        )
    return {"id": comment_id, "thread_id": thread_id}


@app.patch("/api/threads/{thread_id}")
def patch_thread(thread_id: str, request: ThreadPatch) -> dict[str, Any]:
    with transaction() as connection:
        thread = connection.execute(
            "SELECT * FROM comment_threads WHERE id=?", (thread_id,)
        ).fetchone()
        if not thread:
            raise HTTPException(status_code=404, detail="Unknown thread")
        status = request.status or thread["status"]
        assignee = (
            request.assigned_reviewer_name
            if request.assigned_reviewer_name is not None
            else thread["assigned_reviewer_name"]
        )
        connection.execute(
            """
            UPDATE comment_threads
            SET status=?, assigned_reviewer_name=?, updated_at=?
            WHERE id=?
            """,
            (status, assignee, utcnow(), thread_id),
        )
        updated = connection.execute(
            "SELECT * FROM comment_threads WHERE id=?", (thread_id,)
        ).fetchone()
    result = dict(updated)
    if request.assigned_reviewer_name is not None:
        result["assignment_message"] = (
            "Assignment saved locally. Live notifications are not enabled in this prototype."
        )
    return result


def _screenshot_response(span_id: str) -> FileResponse:
    try:
        path, lineage = render_page_screenshot(span_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    headers = {
        "X-Evidence-Lineage": lineage["lineage_hash"],
        "X-Evidence-Highlight": "1" if lineage.get("highlight") else "0",
        "Cache-Control": "private, max-age=3600",
    }
    if lineage.get("highlight_warning"):
        headers["X-Evidence-Highlight-Warning"] = str(lineage["highlight_warning"])[:240]
    # Absolute path avoids FileResponse relative-path edge cases.
    # Do not set filename=… — that forces Content-Disposition: attachment and
    # breaks <img> display in the browser.
    return FileResponse(
        path.resolve(),
        media_type="image/png",
        headers=headers,
    )


@app.api_route("/api/evidence/screenshot", methods=["GET", "HEAD"])
def screenshot_by_query(span_id: str):
    """Stable screenshot URL for colon-bearing span IDs (safe for <img src>)."""
    return _screenshot_response(span_id)


@app.api_route("/api/evidence/{span_id}/screenshot", methods=["GET", "HEAD"])
def screenshot(span_id: str):
    return _screenshot_response(span_id)


@app.get("/api/evidence/{span_id}")
def evidence(span_id: str) -> dict[str, Any]:
    try:
        return span_anchor(span_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/documents/{document_id}/viewer")
def document_viewer(document_id: str) -> dict[str, Any]:
    try:
        return document_viewer_meta(document_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/documents/{document_id}/pdf")
def document_pdf(document_id: str):
    try:
        path, record = document_pdf_path(document_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=record["filename"],
        headers={
            "Content-Disposition": f'inline; filename="{record["filename"]}"',
            "X-Document-Sha256": record.get("sha256") or "",
            "X-Document-Edition": record.get("edition") or "",
        },
    )


@app.get("/api/documents/{document_id}/pages/{page_ordinal}")
def document_page(
    document_id: str,
    page_ordinal: int,
    scale: float = Query(default=1.5, ge=0.5, le=3.0),
):
    try:
        path, meta = render_document_page(document_id, page_ordinal, scale=scale)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — PDFium races surface as opaque failures
        raise HTTPException(
            status_code=503,
            detail=f"Could not render PDF page {page_ordinal}: {exc}",
        ) from exc
    return FileResponse(
        path,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Page-Ordinal": str(meta["page_ordinal"]),
            "X-Page-Width": str(meta.get("page_width") or ""),
            "X-Page-Height": str(meta.get("page_height") or ""),
            "X-Render-Scale": str(meta["scale"]),
            "X-Document-Edition": meta.get("edition") or "",
            "X-Cache-Key": meta.get("cache_key") or "",
        },
    )


@app.get("/api/documents/{document_id}/pages/{page_ordinal}/meta")
def document_page_meta(
    document_id: str,
    page_ordinal: int,
    scale: float = Query(default=1.5, ge=0.5, le=3.0),
) -> dict[str, Any]:
    try:
        _path, meta = render_document_page(document_id, page_ordinal, scale=scale)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Could not render PDF page {page_ordinal}: {exc}",
        ) from exc
    cache = meta.get("cache_key") or "v2"
    return {
        **meta,
        "image_url": (
            f"/api/documents/{document_id}/pages/{page_ordinal}"
            f"?scale={scale}&v={cache}"
        ),
    }


@app.get("/api/runs/{run_id}/export")
@app.post("/api/runs/{run_id}/export")
def export(run_id: str, final: bool = False):
    try:
        path = export_docx(run_id, requested_final=final)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
    )


@app.get("/api/runs/{run_id}/export-bundle")
def export_bundle(run_id: str):
    """Server-side Word bundle download for Dashboard / Conclusion."""
    try:
        created = generate_report_export(run_id, requested_final=False)
        path = Path(created["path"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
        headers={
            "X-Report-Fingerprint": created["fingerprint"],
            "X-Report-Designation": created["designation"],
        },
    )


@app.get("/api/runs/{run_id}/delivery")
def run_delivery(run_id: str) -> dict[str, Any]:
    try:
        return evaluate_delivery_eligibility(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/approve-and-send")
def run_approve_and_send(run_id: str) -> dict[str, Any]:
    try:
        return approve_and_send(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/send-updated-report")
def run_send_updated(run_id: str) -> dict[str, Any]:
    try:
        return send_updated_report(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


class EvaluationCreateRequest(BaseModel):
    run_id: str = Field(min_length=3, max_length=100)
    dataset_id: str = Field(default="expected-claim1-v1", min_length=3, max_length=100)


class AlignmentConfirmRequest(BaseModel):
    alignments: list[dict[str, Any]] | None = None


class AdjudicationRequest(BaseModel):
    status: Literal["Pass", "Fail", "Needs review", "Not applicable"]
    reason: str = Field(min_length=3, max_length=3000)
    adjudicator: str = Field(default="Analyst", max_length=200)


@app.post("/api/evaluation-datasets/import")
def evaluation_dataset_import() -> dict[str, Any]:
    try:
        return import_default_reference_pack()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/evaluation-datasets")
def evaluation_datasets() -> list[dict[str, Any]]:
    return list_datasets()


@app.get("/api/evaluation-datasets/{dataset_id}")
def evaluation_dataset(dataset_id: str) -> dict[str, Any]:
    try:
        return get_dataset(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/evaluations/template")
def evaluation_not_run_template() -> dict[str, Any]:
    return empty_not_run_template()


@app.post("/api/evaluation-runs", status_code=201)
def start_evaluation(request: EvaluationCreateRequest) -> dict[str, Any]:
    try:
        return create_evaluation_run(
            run_id=request.run_id,
            dataset_id=request.dataset_id,
            output_stage="latest_chart",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/evaluation-datasets/{dataset_id}/files")
def evaluation_reference_files(dataset_id: str) -> list[dict[str, Any]]:
    try:
        return list_reference_files(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/evaluation-datasets/{dataset_id}/files/attach-default")
def evaluation_attach_default_pdf(dataset_id: str) -> dict[str, Any]:
    try:
        return attach_default_chart_pdf(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/evaluation-datasets/{dataset_id}/files")
async def evaluation_upload_reference_file(
    dataset_id: str, file: UploadFile = File(...)
) -> dict[str, Any]:
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=422, detail="Empty file")
        kind = "chart_pdf" if (file.filename or "").lower().endswith(".pdf") else "other"
        return upload_reference_file(
            dataset_id,
            filename=file.filename or "reference.bin",
            content=content,
            content_type=file.content_type,
            kind=kind,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/evaluation-datasets/{dataset_id}/files/{file_id}")
def evaluation_remove_reference_file(dataset_id: str, file_id: str) -> dict[str, Any]:
    try:
        return remove_reference_file(dataset_id, file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/evaluation-datasets/{dataset_id}/files/{file_id}/download")
def evaluation_download_reference_file(dataset_id: str, file_id: str):
    try:
        item = get_reference_file(dataset_id, file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = Path(item["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Reference file missing on disk")
    return FileResponse(
        path,
        filename=item["filename"],
        media_type=item.get("content_type") or "application/octet-stream",
    )


@app.get("/api/evaluation-runs")
def evaluation_runs(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    return list_evaluation_runs(limit)


@app.get("/api/evaluation-runs/compare")
def evaluation_compare(
    baseline: str = Query(min_length=3), candidate: str = Query(min_length=3)
) -> dict[str, Any]:
    try:
        return compare_evaluation_runs(baseline, candidate)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/evaluation-runs/{evaluation_id}")
def read_evaluation(evaluation_id: str) -> dict[str, Any]:
    try:
        return get_evaluation_run(evaluation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/evaluation-runs/{evaluation_id}/rows/{row_id}")
def evaluation_row(evaluation_id: str, row_id: str) -> dict[str, Any]:
    detail = get_evaluation_run(evaluation_id)
    for case in detail["cases"]:
        if case["id"] == row_id or case["case_key"] == row_id:
            return case
    raise HTTPException(status_code=404, detail="Unknown evaluation case")


@app.post("/api/evaluation-runs/{evaluation_id}/alignments")
def evaluation_alignments(
    evaluation_id: str, request: AlignmentConfirmRequest
) -> dict[str, Any]:
    try:
        return confirm_alignments(evaluation_id, request.alignments)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/evaluation-results/{result_id}/adjudications")
def evaluation_adjudicate(result_id: str, request: AdjudicationRequest) -> dict[str, Any]:
    try:
        return adjudicate_criterion(
            result_id,
            status=request.status,
            reason=request.reason,
            adjudicator=request.adjudicator,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/evaluation-runs/{evaluation_id}/export")
def evaluation_export(evaluation_id: str):
    try:
        path = export_evaluation_bundle(evaluation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/zip",
        filename=path.name,
    )


frontend = settings.frontend_dir
if frontend.exists():
    app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")

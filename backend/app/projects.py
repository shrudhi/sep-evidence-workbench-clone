"""Persistent LexNorm workspace / project setup state."""

from __future__ import annotations

import json
from typing import Any

from .database import connect, dumps, transaction, utcnow
from .patent_input import (
    DEFAULT_PATENT_INPUT_ID,
    load_patent_input,
    resolve_claims,
    suggest_standards,
)

DEFAULT_PROJECT_ID = "lumenci-assessment"


def ensure_default_project() -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute(
            "SELECT * FROM projects WHERE id=?", (DEFAULT_PROJECT_ID,)
        ).fetchone()
        if row:
            item = dict(row)
            # Rebrand legacy workspace labels without wiping other project state.
            if item.get("workspace_label") in (None, "", "Lumenci assessment", "clause", "Clause"):
                connection.execute(
                    "UPDATE projects SET workspace_label=?, updated_at=? WHERE id=?",
                    ("LexNorm", utcnow(), DEFAULT_PROJECT_ID),
                )
                item["workspace_label"] = "LexNorm"
            return _project_dict(connection, item)
        now = utcnow()
        standards = [
            item["id"]
            for item in connection.execute(
                "SELECT id FROM documents WHERE kind='standard' AND status='indexed' ORDER BY family"
            )
        ]
        # Default assessment selects all indexed standards when present.
        connection.execute(
            """
            INSERT INTO projects(
              id,name,workspace_label,analyst_display_name,patent_input_id,claim_scope,
              selected_claim_numbers_json,selected_standard_ids_json,active_run_id,
              save_status,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                DEFAULT_PROJECT_ID,
                "US10063856B2",
                "LexNorm",
                "Shrudhi Satya",
                DEFAULT_PATENT_INPUT_ID,
                "all",
                dumps([1]),
                dumps(standards),
                None,
                "saved",
                now,
                now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM projects WHERE id=?", (DEFAULT_PROJECT_ID,)
        ).fetchone()
        return _project_dict(connection, dict(row))


def get_project(project_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM projects WHERE id=?", (project_id,)
        ).fetchone()
    if not row:
        if project_id == DEFAULT_PROJECT_ID:
            return ensure_default_project()
        raise KeyError(f"Unknown project {project_id}")
    with connect() as connection:
        return _project_dict(connection, dict(row))


def update_project(project_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute(
            "SELECT * FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        if not row:
            raise KeyError(f"Unknown project {project_id}")
        current = dict(row)
        claim_scope = patch.get("claim_scope", current["claim_scope"])
        selected_claims = patch.get(
            "selected_claim_numbers",
            json.loads(current["selected_claim_numbers_json"]),
        )
        selected_standards = patch.get(
            "selected_standard_ids",
            json.loads(current["selected_standard_ids_json"]),
        )
        patent_input_id = patch.get("patent_input_id", current["patent_input_id"])
        if patent_input_id:
            patent = load_patent_input(patent_input_id)
            resolve_claims(
                patent,
                claim_scope=claim_scope,
                selected_numbers=list(selected_claims),
            )
        connection.execute(
            """
            UPDATE projects SET
              patent_input_id=?,
              claim_scope=?,
              selected_claim_numbers_json=?,
              selected_standard_ids_json=?,
              save_status='saved',
              updated_at=?
            WHERE id=?
            """,
            (
                patent_input_id,
                claim_scope,
                dumps(list(selected_claims)),
                dumps(list(selected_standards)),
                utcnow(),
                project_id,
            ),
        )
        updated = connection.execute(
            "SELECT * FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        return _project_dict(connection, dict(updated))


def setup_bundle(project_id: str) -> dict[str, Any]:
    from .document_catalog import enrich_document

    project = get_project(project_id)
    patent = None
    patent_error = None
    if project.get("patent_input_id"):
        try:
            patent = load_patent_input(project["patent_input_id"])
            # Default assessment scope: Claim 1 only (analyst may expand after opening claims).
            if patent:
                available = [int(claim["number"]) for claim in patent.get("claims", [])]
                selected = [
                    int(n) for n in (project.get("selected_claim_numbers") or []) if int(n) in available
                ]
                default = [1] if 1 in available else available[:1]
                if default and selected != default and (
                    not selected or selected == available
                ):
                    # Reset empty or "all claims" selections back to Claim 1 default.
                    project = update_project(
                        project_id,
                        {
                            "claim_scope": "select",
                            "selected_claim_numbers": default,
                        },
                    )
                elif not selected and default:
                    project = update_project(
                        project_id,
                        {
                            "claim_scope": "select",
                            "selected_claim_numbers": default,
                        },
                    )
                patent = enrich_document({**patent, "id": patent.get("id") or patent.get("document_id")})
        except (FileNotFoundError, ValueError) as exc:
            patent_error = str(exc)
    with connect() as connection:
        documents = [
            dict(row)
            for row in connection.execute(
                """
                SELECT id,kind,family,title,edition,filename,sha256,status,page_count
                FROM documents ORDER BY kind,family
                """
            )
        ]
    standards = [doc for doc in documents if doc["kind"] == "standard"]
    # Keep the analyst's screening pool; only drop IDs that are no longer indexed.
    indexed_ids = [item["id"] for item in standards if item.get("status") == "indexed"]
    selected_ids = [
        item_id
        for item_id in (project.get("selected_standard_ids") or [])
        if item_id in indexed_ids
    ]
    if selected_ids != (project.get("selected_standard_ids") or []):
        project = update_project(project_id, {"selected_standard_ids": selected_ids})
    suggestions = suggest_standards(patent or {}, standards) if patent else []
    suggestion_map = {item["document_id"]: item for item in suggestions}
    enriched = []
    for standard in standards:
        meta = suggestion_map.get(standard["id"], {"suggested": False, "reason": None})
        enriched.append(enrich_document({**standard, **meta}))
    from .automation import (
        compact_automation_label,
        get_effective_automation,
        get_workspace_defaults,
    )

    automation = get_effective_automation(project_id)
    return {
        "project": project,
        "patent": patent,
        "patent_error": patent_error,
        "standards": enriched,
        "automation": {
            **automation,
            "compact_label": compact_automation_label(automation),
            "workspace_defaults": get_workspace_defaults(project_id),
        },
        "suggestion_disclaimer": (
            "Select which indexed standards to evaluate, then Get recommendations. "
            "Each selected option returns accepted or rejected. Confirm which "
            "standard(s) to chart next — default is the accepted target only."
        ),
        "flow": {
            "path": "select_then_confirm",
            "claim_scope": "claim_1",
            "next_step": (
                "Select standards to evaluate, review accepted / rejected outcomes, "
                "then confirm which document(s) to chart."
            ),
        },
    }


def build_run_snapshot(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    if not project.get("patent_input_id"):
        raise ValueError("Patent input is not ready")
    patent = load_patent_input(project["patent_input_id"])
    claims = resolve_claims(
        patent,
        claim_scope=project["claim_scope"],
        selected_numbers=project["selected_claim_numbers"],
    )
    standard_ids = project["selected_standard_ids"]
    if not standard_ids:
        raise ValueError("Select at least one standard")
    with connect() as connection:
        editions = []
        for document_id in standard_ids:
            row = connection.execute(
                """
                SELECT id,family,edition,sha256,status,filename FROM documents WHERE id=?
                """,
                (document_id,),
            ).fetchone()
            if not row:
                raise ValueError(f"Unknown standard {document_id}")
            if row["status"] != "indexed":
                raise ValueError(
                    f"{row['family']} is not indexed yet (status={row['status']})"
                )
            editions.append(dict(row))
        patent_doc = connection.execute(
            "SELECT id,filename,sha256,status FROM documents WHERE id=?",
            (patent["document_id"],),
        ).fetchone()
    if not patent_doc or patent_doc["status"] != "indexed":
        raise ValueError("Patent document is not indexed")
    return {
        "project_id": project_id,
        "patent_input_id": patent["id"],
        "patent_identifier": patent["identifier"],
        "claim_scope": project["claim_scope"],
        "selected_claims": claims,
        "selected_standard_ids": standard_ids,
        "document_editions": editions,
        "patent_document": dict(patent_doc),
    }


def attach_snapshot(connection, run_id: str, snapshot: dict[str, Any]) -> None:
    connection.execute(
        """
        INSERT INTO run_snapshots(
          run_id,project_id,patent_input_id,patent_identifier,claim_scope,
          selected_claims_json,selected_standard_ids_json,document_editions_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            run_id,
            snapshot["project_id"],
            snapshot["patent_input_id"],
            snapshot["patent_identifier"],
            snapshot["claim_scope"],
            dumps(snapshot["selected_claims"]),
            dumps(snapshot["selected_standard_ids"]),
            dumps(snapshot["document_editions"]),
            utcnow(),
        ),
    )
    connection.execute(
        "UPDATE projects SET active_run_id=?, updated_at=? WHERE id=?",
        (run_id, utcnow(), snapshot["project_id"]),
    )


def get_snapshot(run_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM run_snapshots WHERE run_id=?", (run_id,)
        ).fetchone()
    if not row:
        return None
    data = dict(row)
    data["selected_claims"] = json.loads(data.pop("selected_claims_json"))
    data["selected_standard_ids"] = json.loads(data.pop("selected_standard_ids_json"))
    data["document_editions"] = json.loads(data.pop("document_editions_json"))
    return data


def _project_dict(connection, row: dict[str, Any]) -> dict[str, Any]:
    project = dict(row)
    project["selected_claim_numbers"] = json.loads(
        project.pop("selected_claim_numbers_json")
    )
    project["selected_standard_ids"] = json.loads(
        project.pop("selected_standard_ids_json")
    )
    return project

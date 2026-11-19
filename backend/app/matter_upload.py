"""Matter Setup patent / standard PDF upload helpers.

Honesty contract:
- Matching a known assessment PDF by SHA-256 binds the prepared workspace record.
- Unknown patents are retained on disk but cannot invent claim text without a prepared input.
- Unknown standards are registered as pending (not indexed) until a full ingest run.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any

from .config import get_settings
from .database import connect, transaction
from .ingest import load_manifest
from .patent_input import DEFAULT_PATENT_INPUT_ID, load_patent_input


def _uploads_root() -> Path:
    root = get_settings().artifact_dir / "matter_uploads"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _safe_filename(name: str) -> str:
    base = Path(name or "upload.pdf").name
    cleaned = re.sub(r"[^\w.\-]+", "_", base).strip("._") or "upload.pdf"
    if not cleaned.lower().endswith(".pdf"):
        cleaned = f"{cleaned}.pdf"
    return cleaned[:180]


def _manifest_documents() -> list[dict[str, Any]]:
    settings = get_settings()
    path = settings.source_dir / "manifest.json"
    if not path.exists():
        return []
    return list(load_manifest(settings.source_dir).get("documents") or [])


def upload_patent_pdf(
    *,
    content: bytes,
    filename: str,
    project_id: str,
) -> dict[str, Any]:
    if not content:
        raise ValueError("Empty PDF upload")
    sha = _sha256_bytes(content)
    dest_dir = _uploads_root() / "patents"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{uuid.uuid4().hex}_{_safe_filename(filename)}"
    dest.write_bytes(content)

    matched = next(
        (
            doc
            for doc in _manifest_documents()
            if doc.get("kind") == "patent" and doc.get("sha256") == sha
        ),
        None,
    )
    if matched:
        patent = load_patent_input(matched.get("id") or DEFAULT_PATENT_INPUT_ID)
        with transaction() as connection:
            connection.execute(
                """
                UPDATE projects
                SET patent_input_id=?, updated_at=datetime('now')
                WHERE id=?
                """,
                (matched["id"], project_id),
            )
        return {
            "status": "matched",
            "matched_document_id": matched["id"],
            "sha256": sha,
            "stored_path": str(dest),
            "filename": filename,
            "patent_input_id": matched["id"],
            "patent_identifier": patent.get("identifier") or matched.get("family"),
            "claim_count": len(patent.get("claims") or []),
            "message": (
                f"Upload matched assessment patent {matched.get('family')} by SHA-256. "
                "Bound the prepared patent-input record for charting."
            ),
        }

    meta = {
        "id": f"upload-patent-{uuid.uuid4().hex[:12]}",
        "filename": filename,
        "sha256": sha,
        "stored_path": str(dest),
        "project_id": project_id,
        "status": "retained_unparsed",
    }
    (dest.with_suffix(".json")).write_text(json.dumps(meta, indent=2))
    return {
        "status": "retained_unparsed",
        "matched_document_id": None,
        "sha256": sha,
        "stored_path": str(dest),
        "filename": filename,
        "patent_input_id": None,
        "message": (
            "PDF retained on the server, but arbitrary patent claim parsing is not implemented. "
            "Provide a prepared patent-input JSON (or upload the assessment patent PDF that "
            "matches the workspace SHA-256) to chart claims. Demo sample patents remain display-only."
        ),
    }


def upload_standard_pdf(
    *,
    content: bytes,
    filename: str,
    family: str | None = None,
    edition: str | None = None,
) -> dict[str, Any]:
    if not content:
        raise ValueError("Empty PDF upload")
    sha = _sha256_bytes(content)
    matched = next(
        (
            doc
            for doc in _manifest_documents()
            if doc.get("kind") == "standard" and doc.get("sha256") == sha
        ),
        None,
    )
    if matched:
        return {
            "status": "matched",
            "document_id": matched["id"],
            "sha256": sha,
            "filename": filename,
            "family": matched.get("family"),
            "edition": matched.get("edition"),
            "indexed": True,
            "message": (
                f"Upload matched indexed standard {matched.get('family')} by SHA-256. "
                "Use it from the candidate list — no re-ingest required."
            ),
        }

    settings = get_settings()
    dest_dir = settings.source_dir / "uploads"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = _safe_filename(filename)
    dest = dest_dir / f"{uuid.uuid4().hex}_{safe}"
    dest.write_bytes(content)

    doc_id = f"standard-upload-{uuid.uuid4().hex[:10]}"
    label_family = (family or Path(filename).stem or "Uploaded standard").strip()[:120]
    label_edition = (edition or f"Upload · {safe}").strip()[:200]
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO documents(id,kind,family,title,edition,filename,sha256,status)
            VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              filename=excluded.filename,
              sha256=excluded.sha256,
              status=excluded.status,
              family=excluded.family,
              edition=excluded.edition,
              title=excluded.title
            """,
            (
                doc_id,
                "standard",
                label_family,
                label_family,
                label_edition,
                str(dest.relative_to(settings.source_dir)),
                sha,
                "pending",
            ),
        )

    return {
        "status": "pending",
        "document_id": doc_id,
        "sha256": sha,
        "filename": filename,
        "stored_path": str(dest),
        "family": label_family,
        "edition": label_edition,
        "indexed": False,
        "message": (
            "Standard PDF stored and registered as pending. It appears in the registry but is "
            "not searchable until a full ingest/index pass. Recommendation still requires an "
            "indexed candidate — select an indexed standard to proceed with charting."
        ),
    }


def list_pending_uploads() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id,kind,family,title,edition,filename,sha256,status
            FROM documents
            WHERE status='pending' AND kind='standard'
            ORDER BY family
            """
        ).fetchall()
    return [dict(row) for row in rows]

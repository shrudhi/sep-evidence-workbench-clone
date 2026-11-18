"""Serve original PDF bytes and page geometry for the Claim Charts document viewer."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium

from .config import get_settings
from .database import connect


def get_document_record(document_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT id, kind, family, title, edition, filename, sha256, status, page_count
            FROM documents WHERE id=?
            """,
            (document_id,),
        ).fetchone()
    if not row:
        raise KeyError(f"Unknown document {document_id}")
    return dict(row)


def document_pdf_path(document_id: str) -> tuple[Path, dict[str, Any]]:
    record = get_document_record(document_id)
    path = get_settings().source_dir / record["filename"]
    if not path.exists():
        raise FileNotFoundError(f"PDF missing for {document_id}: {record['filename']}")
    return path, record


def document_viewer_meta(document_id: str) -> dict[str, Any]:
    path, record = document_pdf_path(document_id)
    with connect() as connection:
        pages = connection.execute(
            """
            SELECT page_ordinal, printed_label, width, height
            FROM pages WHERE document_id=? ORDER BY page_ordinal
            """,
            (document_id,),
        ).fetchall()
    page_count = record.get("page_count") or len(pages)
    if not page_count:
        pdf = pdfium.PdfDocument(path)
        page_count = len(pdf)
        pdf.close()
    return {
        "id": record["id"],
        "family": record["family"],
        "title": record["title"],
        "edition": record["edition"],
        "filename": record["filename"],
        "sha256": record["sha256"],
        "page_count": page_count,
        "pdf_url": f"/api/documents/{document_id}/pdf",
        "pages": [
            {
                "page_ordinal": row["page_ordinal"],
                "printed_label": row["printed_label"],
                "width": row["width"],
                "height": row["height"],
            }
            for row in pages
        ],
    }


def render_document_page(
    document_id: str,
    page_ordinal: int,
    *,
    scale: float = 1.5,
) -> tuple[Path, dict[str, Any]]:
    """Rasterize one page of the original PDF without burned-in highlights."""
    import hashlib
    import time

    from PIL import Image

    path, record = document_pdf_path(document_id)
    path = path.resolve()
    if page_ordinal < 1:
        raise ValueError("page_ordinal must be >= 1")
    if not path.is_file() or path.stat().st_size < 8:
        raise FileNotFoundError(f"PDF unreadable for {document_id}: {path}")
    settings = get_settings()
    output_dir = (settings.artifact_dir / "page_renders").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    lineage = f"{record.get('sha256') or record['id']}:page:{page_ordinal}:scale:{scale}:clean-v2"
    digest = hashlib.sha256(lineage.encode()).hexdigest()
    output = output_dir / f"{digest}.png"
    with connect() as connection:
        page_row = connection.execute(
            """
            SELECT width, height, printed_label FROM pages
            WHERE document_id=? AND page_ordinal=?
            """,
            (document_id, page_ordinal),
        ).fetchone()
    if not output.exists():
        last_error: Exception | None = None
        for attempt in range(3):
            pdf = None
            page = None
            try:
                pdf = pdfium.PdfDocument(str(path))
                if page_ordinal > len(pdf):
                    raise KeyError(f"Page {page_ordinal} out of range for {document_id}")
                page = pdf[page_ordinal - 1]
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil().convert("RGB")
                tmp = output.with_suffix(f".{attempt}.tmp.png")
                image.save(tmp, format="PNG")
                tmp.replace(output)
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001 — retry transient PDFium open races
                last_error = exc
                time.sleep(0.05 * (attempt + 1))
            finally:
                if page is not None:
                    try:
                        page.close()
                    except Exception:  # noqa: BLE001
                        pass
                if pdf is not None:
                    try:
                        pdf.close()
                    except Exception:  # noqa: BLE001
                        pass
        if last_error is not None:
            raise last_error
    with Image.open(output) as image:
        width, height = image.size
    return output, {
        "document_id": document_id,
        "page_ordinal": page_ordinal,
        "printed_label": page_row["printed_label"] if page_row else None,
        "page_width": page_row["width"] if page_row else None,
        "page_height": page_row["height"] if page_row else None,
        "render_width": width,
        "render_height": height,
        "scale": scale,
        "sha256": record.get("sha256"),
        "edition": record.get("edition"),
        "family": record.get("family"),
        "title": record.get("title"),
        "cache_key": digest,
    }


def span_anchor(span_id: str) -> dict[str, Any]:
    """Return citation geometry for highlighting. Never invents a bbox."""
    with connect() as connection:
        row = connection.execute(
            """
            SELECT s.id, s.document_id, s.page_ordinal, s.printed_label, s.bbox_json,
                   s.raw_text, d.family, d.title, d.edition, d.sha256,
                   p.width AS page_width, p.height AS page_height,
                   n.label AS section_label
            FROM spans s
            JOIN documents d ON d.id=s.document_id
            JOIN pages p ON p.id=s.page_id
            LEFT JOIN nodes n ON n.id=s.section_id
            WHERE s.id=?
            """,
            (span_id,),
        ).fetchone()
    if not row:
        raise KeyError(f"Unknown evidence span {span_id}")
    bbox = json.loads(row["bbox_json"] or "[]")
    highlight_available = isinstance(bbox, list) and len(bbox) == 4
    return {
        "evidence_id": row["id"],
        "document_id": row["document_id"],
        "family": row["family"],
        "title": row["title"],
        "edition": row["edition"],
        "sha256": row["sha256"],
        "section_label": row["section_label"],
        "page_ordinal": row["page_ordinal"],
        "printed_label": row["printed_label"],
        "page_width": row["page_width"],
        "page_height": row["page_height"],
        "bbox": bbox if highlight_available else None,
        "highlight_available": highlight_available,
        "highlight_warning": (
            None
            if highlight_available
            else "Highlight unavailable — citation location requires verification"
        ),
        "quote": row["raw_text"],
        "coordinate_system": "page_top_left",
    }

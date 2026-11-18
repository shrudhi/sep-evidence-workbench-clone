"""Resolve canonical evidence IDs into chart/inspector/export blocks."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from .citations import (
    bbox_is_reliable,
    citation_heading,
    clip_bbox_to_page,
    refine_quote_bboxes,
    resolve_printed_page,
    resolve_section_citation,
    short_standard_label,
)
from .database import connect


def resolve_evidence_blocks(
    span_ids: list[str],
    *,
    role: str = "supporting",
    refine: bool = True,
) -> list[dict[str, Any]]:
    if not span_ids:
        return []
    with connect() as connection:
        placeholders = ",".join("?" for _ in span_ids)
        rows = connection.execute(
            f"""
            SELECT s.id,s.raw_text,s.page_ordinal,s.printed_label,s.bbox_json,s.document_id,
                   d.family,d.title,d.edition,d.sha256,n.label AS section_label,
                   p.raw_text AS page_text,p.width AS page_width,p.height AS page_height
            FROM spans s
            JOIN documents d ON d.id=s.document_id
            JOIN pages p ON p.id=s.page_id
            LEFT JOIN nodes n ON n.id=s.section_id
            WHERE s.id IN ({placeholders})
            """,
            span_ids,
        ).fetchall()
    by_id = {row["id"]: dict(row) for row in rows}
    blocks: list[dict[str, Any]] = []
    for index, span_id in enumerate(span_ids, start=1):
        row = by_id.get(span_id)
        if not row:
            blocks.append(
                {
                    "evidence_number": index,
                    "evidence_id": span_id,
                    "available": False,
                    "error": "Unknown evidence ID — not present in the index",
                    "role": role,
                }
            )
            continue
        bbox = json.loads(row["bbox_json"] or "[]")
        context_bbox = bbox if isinstance(bbox, list) and len(bbox) == 4 else None
        page_width = float(row.get("page_width") or 0)
        page_height = float(row.get("page_height") or 0)
        section = resolve_section_citation(
            document_id=row["document_id"],
            section_label=row["section_label"],
            quote=row["raw_text"],
            page_text=row.get("page_text"),
        )
        printed = resolve_printed_page(
            document_id=row["document_id"],
            page_ordinal=row["page_ordinal"],
            stored_printed=row["printed_label"],
            page_text=row.get("page_text"),
        )
        highlights: dict[str, Any] = {}
        quote_line_bboxes: list[list[float]] = []
        quote_bbox = None
        if refine:
            highlights = refine_quote_bboxes(
                document_id=row["document_id"],
                page_ordinal=row["page_ordinal"],
                quote=row["raw_text"],
                context_bbox=context_bbox,
            )
            for box in highlights.get("quote_line_bboxes") or []:
                clipped = clip_bbox_to_page(
                    box, page_width=page_width, page_height=page_height
                )
                if clipped and bbox_is_reliable(
                    clipped, page_width=page_width, page_height=page_height
                ):
                    quote_line_bboxes.append(clipped)
            quote_bbox = clip_bbox_to_page(
                highlights.get("quote_bbox"),
                page_width=page_width,
                page_height=page_height,
            )
            if quote_bbox and not bbox_is_reliable(
                quote_bbox, page_width=page_width, page_height=page_height
            ):
                quote_bbox = None
            if not quote_bbox and quote_line_bboxes:
                quote_bbox = [
                    min(box[0] for box in quote_line_bboxes),
                    min(box[1] for box in quote_line_bboxes),
                    max(box[2] for box in quote_line_bboxes),
                    max(box[3] for box in quote_line_bboxes),
                ]
        else:
            quote_bbox = clip_bbox_to_page(
                context_bbox, page_width=page_width, page_height=page_height
            )
        context_clipped = clip_bbox_to_page(
            context_bbox, page_width=page_width, page_height=page_height
        )
        highlight_available = bool(quote_line_bboxes or quote_bbox)
        heading = citation_heading(
            family=row["family"],
            edition=row["edition"],
            section_ref=section.get("section_ref"),
            page_ordinal=row["page_ordinal"],
            printed_page=printed,
        )
        section_label = section.get("section_label")
        blocks.append(
            {
                "evidence_number": index,
                "evidence_id": span_id,
                "available": True,
                "quote": row["raw_text"],
                "source": {
                    "document_id": row["document_id"],
                    "family": row["family"],
                    "title": row["title"],
                    "edition": row["edition"],
                    "sha256": row["sha256"],
                    "short_label": short_standard_label(row["family"], row["edition"]),
                },
                "section_label": section_label,
                "section_ref": section.get("section_ref"),
                "citation_heading": heading,
                "page_ordinal": row["page_ordinal"],
                "printed_label": printed,
                "page_width": page_width or None,
                "page_height": page_height or None,
                "bbox": quote_bbox,
                "quote_bbox": quote_bbox,
                "quote_line_bboxes": quote_line_bboxes,
                "context_bbox": context_clipped,
                "highlight_available": highlight_available,
                "highlight_warning": None
                if highlight_available
                else (
                    highlights.get("highlight_warning")
                    or "Highlight unavailable — citation location requires verification"
                ),
                # Query form avoids colon-bearing span IDs breaking <img src> in browsers.
                "screenshot_url": f"/api/evidence/screenshot?span_id={quote(span_id, safe='')}",
                "inspect_url": f"/api/evidence/{quote(span_id, safe='')}",
                "role": role,
            }
        )
    return blocks


STATUS_LABELS = {
    "queued": "Queued",
    "selecting": "Selecting standard",
    "searching": "Searching",
    "awaiting_target_confirm": "Confirm standard to chart",
    "decomposing": "Mapping",
    "mapping": "Mapping",
    "reviewing": "Reviewing",
    "analyst_review": "Ready for analyst review",
    "complete": "Complete",
    "selection_confirmed": "Standards confirmed",
    "failed": "Failed",
}


def human_status(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def mapping_display(label: str | None) -> dict[str, Any]:
    """Separate assignment mapping labels from incomplete analysis."""
    if not label or label == "Abstain":
        return {
            "mapping_label": None,
            "analysis_status": "incomplete",
            "analysis_status_label": "Analysis incomplete",
        }
    return {
        "mapping_label": label,
        "analysis_status": "complete",
        "analysis_status_label": None,
    }


INCOMPLETE_REVIEW_REASON = "Mapping review: Incomplete"


def review_status_display(
    *,
    disposition: str | None,
    reasons: list[str] | None,
) -> dict[str, Any]:
    reasons = list(reasons or [])
    incomplete = disposition in {None, "", "flag", "rework"} and any(
        "omitted disposition" in reason.lower()
        or reason == INCOMPLETE_REVIEW_REASON
        or "mapping review: incomplete" in reason.lower()
        for reason in reasons
    )
    if disposition == "pass" and not incomplete:
        label = "Passed"
    elif incomplete:
        label = "Could not assess"
    elif disposition == "rework":
        label = "Sent back"
    elif disposition == "flag":
        label = "Flagged"
    elif not disposition:
        label = "Pending"
    else:
        label = disposition
    cleaned_reasons = [
        INCOMPLETE_REVIEW_REASON
        if "omitted disposition" in reason.lower()
        else reason
        for reason in reasons
    ]
    return {
        "mapping_review_status": label,
        "mapping_review_incomplete": label == "Could not assess",
        "reasons": cleaned_reasons,
    }

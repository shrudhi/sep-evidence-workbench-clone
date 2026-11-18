import hashlib
import json
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_BREAK
from docx.shared import Inches, Pt

from .config import get_settings
from .database import connect, utcnow
from .evidence import mapping_display, resolve_evidence_blocks


def resolve_export_designation(
    *, requested_final: bool, all_decided: bool, corpus: dict[str, Any]
) -> str:
    corpus_complete = corpus.get("complete") is True
    if requested_final and not corpus_complete:
        missing = ", ".join(corpus.get("missing_standard_ids") or ["unknown standard"])
        raise ValueError(
            f"Final export is blocked until the run includes the full corpus: {missing}"
        )
    if requested_final and not all_decided:
        raise ValueError("Final export requires an analyst decision for every row")
    if requested_final:
        return "REVIEWED FINAL"
    if corpus_complete:
        return "DRAFT — UNRESOLVED ROWS MAY REMAIN"
    return "DRAFT — INCOMPLETE STANDARDS CORPUS"


def render_page_screenshot(span_id: str) -> tuple[Path, dict[str, Any]]:
    from PIL import Image, ImageDraw

    from .citations import (
        bbox_is_reliable,
        clip_bbox_to_page,
        refine_quote_bboxes,
    )

    settings = get_settings()
    with connect() as connection:
        row = connection.execute(
            """
            SELECT s.id,s.document_id,s.page_ordinal,s.bbox_json,s.content_hash,s.raw_text,
                   d.filename,d.sha256,p.width AS page_width,p.height AS page_height
            FROM spans s
            JOIN documents d ON d.id=s.document_id
            JOIN pages p ON p.id=s.page_id
            WHERE s.id=?
            """,
            (span_id,),
        ).fetchone()
    if not row:
        raise KeyError("Unknown evidence span")
    source = settings.source_dir / row["filename"]
    output_dir = settings.artifact_dir / "screenshots"
    output_dir.mkdir(parents=True, exist_ok=True)
    scale = 1.5
    page_width = float(row["page_width"] or 0)
    page_height = float(row["page_height"] or 0)
    span_bbox = json.loads(row["bbox_json"] or "[]")
    context = span_bbox if isinstance(span_bbox, list) and len(span_bbox) == 4 else None
    highlights = refine_quote_bboxes(
        document_id=row["document_id"],
        page_ordinal=row["page_ordinal"],
        quote=row["raw_text"] or "",
        context_bbox=context,
    )
    line_boxes = [
        clipped
        for box in (highlights.get("quote_line_bboxes") or [])
        if (
            clipped := clip_bbox_to_page(
                box, page_width=page_width, page_height=page_height
            )
        )
        and bbox_is_reliable(clipped, page_width=page_width, page_height=page_height)
    ]
    if not line_boxes:
        quote_box = clip_bbox_to_page(
            highlights.get("quote_bbox"),
            page_width=page_width,
            page_height=page_height,
        )
        if bbox_is_reliable(quote_box, page_width=page_width, page_height=page_height):
            line_boxes = [quote_box]
    highlight_ok = bool(line_boxes)
    # Crop to the cited passage (reference-chart style), not the full page.
    lineage = hashlib.sha256(
        f"{row['sha256']}:{row['page_ordinal']}:{row['content_hash']}:"
        f"{json.dumps(line_boxes, sort_keys=True)}:render-v5-quote-crop".encode()
    ).hexdigest()
    output = output_dir / f"{lineage}.png"
    if not output.exists():
        pdf = None
        page = None
        try:
            pdf = pdfium.PdfDocument(str(source))
            page = pdf[row["page_ordinal"] - 1]
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil().convert("RGBA")
            img_w, img_h = image.size
            if highlight_ok:
                # Transparent overlay + alpha composite keeps source text readable.
                overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)
                for box in line_boxes:
                    x0, y0, x1, y1 = [float(value) * scale for value in box]
                    pad = 2 * scale
                    rect = [
                        max(0, x0 - pad),
                        max(0, y0 - pad),
                        min(img_w - 1, x1 + pad),
                        min(img_h - 1, y1 + pad),
                    ]
                    if rect[2] - rect[0] < 2 or rect[3] - rect[1] < 2:
                        continue
                    # ~20% fill opacity so the original glyphs remain visible.
                    draw.rectangle(
                        rect,
                        fill=(255, 214, 102, 51),
                        outline=(196, 140, 20, 140),
                        width=max(1, int(round(scale))),
                    )
                image = Image.alpha_composite(image, overlay)
                # Crop tightly around the union of quote line boxes (+ reading context).
                xs0 = [float(b[0]) * scale for b in line_boxes]
                ys0 = [float(b[1]) * scale for b in line_boxes]
                xs1 = [float(b[2]) * scale for b in line_boxes]
                ys1 = [float(b[3]) * scale for b in line_boxes]
                pad_x = 18 * scale
                pad_y = 14 * scale
                crop = [
                    max(0, int(min(xs0) - pad_x)),
                    max(0, int(min(ys0) - pad_y)),
                    min(img_w, int(max(xs1) + pad_x)),
                    min(img_h, int(max(ys1) + pad_y)),
                ]
                if crop[2] - crop[0] >= 24 and crop[3] - crop[1] >= 16:
                    image = image.crop(tuple(crop))
            image.convert("RGB").save(output, format="PNG")
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
    return output, {
        "source_sha256": row["sha256"],
        "page_ordinal": row["page_ordinal"],
        "bbox": line_boxes[0] if line_boxes else None,
        "quote_line_bboxes": line_boxes,
        "span_content_hash": row["content_hash"],
        "screenshot_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "lineage_hash": lineage,
        "highlight": highlight_ok,
        "cropped_to_quote": highlight_ok,
        "highlight_warning": None
        if highlight_ok
        else (
            highlights.get("highlight_warning")
            or "Highlight unavailable — citation location requires verification"
        ),
    }


def _latest_rows(connection, run_id: str):
    return connection.execute(
        """
        SELECT ce.ordinal,ce.label,ce.exact_text,rr.*,rev.disposition AS review_disposition,
               rev.reasons_json,ad.disposition AS analyst_disposition,ad.comment
        FROM claim_elements ce
        JOIN row_revisions rr ON rr.id=(
          SELECT id FROM row_revisions x WHERE x.element_id=ce.id
          ORDER BY x.revision_number DESC,x.created_at DESC LIMIT 1
        )
        LEFT JOIN review_results rev ON rev.revision_id=rr.id
        LEFT JOIN analyst_decisions ad ON ad.id=(
          SELECT id FROM analyst_decisions y WHERE y.revision_id=rr.id
          ORDER BY y.created_at DESC LIMIT 1
        )
        WHERE ce.run_id=? ORDER BY ce.ordinal
        """,
        (run_id,),
    ).fetchall()


def _write_evidence_cell(
    cell,
    evidence_ids: list[str],
    *,
    role: str = "supporting",
    preamble: str | None = None,
) -> None:
    cell.text = preamble or ""
    blocks = resolve_evidence_blocks(evidence_ids, role=role)
    if not blocks:
        if not preamble:
            cell.text = "No supporting quote claimed. See rationale and checked candidates."
        return
    for index, block in enumerate(blocks):
        paragraph = cell.add_paragraph()
        if not block.get("available"):
            paragraph.add_run(
                f"Evidence {block['evidence_number']}: {block.get('error') or 'unavailable'}"
            )
            continue
        source = block.get("source") or {}
        section = block.get("section_ref") or block.get("section_label") or "section n/a"
        page = block.get("page_ordinal")
        quote = (block.get("quote") or "").strip().replace("\n", " ")
        quote_preview = quote if len(quote) <= 72 else f"{quote[:69]}…"
        heading = f"{section} · PDF p.{page} — {quote_preview}"
        head = paragraph.add_run(f"{heading}\n")
        head.bold = True
        paragraph.add_run(f"(Evidence {block['evidence_number']} · id {block['evidence_id']})\n")
        paragraph.add_run(f"Quote: “{block.get('quote') or ''}”\n")
        paragraph.add_run(
            f"Source: {source.get('family') or 'unknown'} — {source.get('edition') or 'n/a'}\n"
        )
        paragraph.add_run(
            f"Reference: {section}, "
            f"printed p. {block.get('printed_label') or 'n/a'}, "
            f"PDF p. {page}\n"
        )
        if role == "candidate":
            paragraph.add_run("Role: rejected / contextual candidate\n")
        try:
            screenshot, lineage = render_page_screenshot(block["evidence_id"])
            paragraph.add_run().add_picture(str(screenshot), width=Inches(2.8))
            if lineage.get("highlight"):
                paragraph.add_run(
                    f"\nScreenshot lineage: {lineage['lineage_hash'][:16]}… · translucent line highlight"
                )
            else:
                paragraph.add_run(
                    f"\nScreenshot lineage: {lineage['lineage_hash'][:16]}… · Highlight unavailable"
                )
                if lineage.get("highlight_warning"):
                    paragraph.add_run(f"\n{lineage['highlight_warning']}")
        except Exception as exc:  # noqa: BLE001 — export must continue with visible failure
            paragraph.add_run(f"\nScreenshot failed: {exc}")
        if index < len(blocks) - 1:
            paragraph.add_run().add_break(WD_BREAK.LINE)


def export_docx(run_id: str, requested_final: bool = False) -> Path:
    settings = get_settings()
    with connect() as connection:
        run = connection.execute(
            """
            SELECT r.*,d.family,d.edition,d.sha256 FROM runs r
            LEFT JOIN documents d ON d.id=r.target_document_id WHERE r.id=?
            """,
            (run_id,),
        ).fetchone()
        if not run:
            raise KeyError("Unknown run")
        rows = _latest_rows(connection, run_id)
    model_config = json.loads(run["model_config_json"])
    corpus = model_config.get("corpus") or {}
    corpus_complete = corpus.get("complete") is True
    all_decided = bool(rows) and all(row["analyst_disposition"] for row in rows)
    designation = resolve_export_designation(
        requested_final=requested_final, all_decided=all_decided, corpus=corpus
    )

    document = Document()
    section = document.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    styles = document.styles
    styles["Normal"].font.name = "Aptos"
    styles["Normal"].font.size = Pt(9)
    document.add_heading("Clause — SEP Evidence Workbench", level=0)
    document.add_paragraph(designation)
    if not corpus_complete:
        missing = ", ".join(corpus.get("missing_standard_ids") or ["unknown"])
        document.add_paragraph(
            f"NON-FINAL CORPUS: This run did not include every expected standard. Missing: {missing}."
        )
    document.add_paragraph(
        f"Run {run_id}\nTarget document: {run['family']} — {run['edition']}\n"
        f"Source SHA-256: {run['sha256']}\nGenerated: {utcnow()}"
    )
    document.add_paragraph(
        "This is technical evidence work product, not a legal determination of essentiality."
    )

    table = document.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    for cell, text in zip(
        table.rows[0].cells,
        ["Claim element", "Standard evidence", "Rationale and mapping"],
        strict=True,
    ):
        cell.text = text
    for row in rows:
        cells = table.add_row().cells
        cells[0].text = f"{row['label']}\n{row['exact_text']}"
        evidence_ids = json.loads(row["evidence_ids_json"] or "[]")
        counter_ids = json.loads(row["counterevidence_ids_json"] or "[]")
        display = mapping_display(row["mapping_label"])
        if evidence_ids:
            _write_evidence_cell(cells[1], evidence_ids, role="supporting")
        elif row["mapping_label"] == "No map" and counter_ids:
            _write_evidence_cell(
                cells[1],
                counter_ids,
                role="candidate",
                preamble=(
                    "No supporting passage established after documented search.\n"
                    "Checked candidates (not support):"
                ),
            )
        elif not evidence_ids and counter_ids:
            _write_evidence_cell(
                cells[1],
                counter_ids,
                role="candidate",
                preamble="Analysis incomplete — candidate passages only:",
            )
        else:
            cells[1].text = (
                "No supporting quote claimed. See rationale and checked candidates."
                if row["mapping_label"] == "No map"
                else "No linked passages available for this revision."
            )
        missing = [
            str(item).strip()
            for item in (json.loads(row["missing_requirements_json"] or "[]") or [])
            if str(item).strip()
        ]
        mapping_line = (
            display["mapping_label"]
            if display["mapping_label"]
            else display["analysis_status_label"] or "Analysis incomplete"
        )
        from .chart_schema import enrich_mapping_tags

        tags = enrich_mapping_tags(
            {
                "mapping_label": row["mapping_label"],
                "evidence_status": row["evidence_status"],
                "match_strength": row["match_strength"]
                if "match_strength" in row.keys()
                else None,
                "requirement_applicability": row["requirement_applicability"]
                if "requirement_applicability" in row.keys()
                else None,
                "requirement_condition": row["requirement_condition"]
                if "requirement_condition" in row.keys()
                else "",
            }
        )
        # Reference-chart style: label → tags → rationale → Not established bullets.
        rationale_parts = [
            mapping_line,
            (
                f"Match: {tags['match_strength']} · Requirement: "
                f"{tags['requirement_applicability']}"
                + (
                    f" ({tags['requirement_condition']})"
                    if tags.get("requirement_condition")
                    else ""
                )
            ),
            (row["rationale"] or "").strip() or "No rationale recorded.",
        ]
        if missing or mapping_line in {"Partial map", "No map"}:
            rationale_parts.append("Not established")
            if missing:
                rationale_parts.extend(f"• {item}" for item in missing)
            elif mapping_line == "No map":
                rationale_parts.append(
                    "• No supporting requirements established after documented search."
                )
            else:
                rationale_parts.append(
                    "• Complete claimed requirements not established from cited text alone."
                )
        cells[2].text = "\n".join(rationale_parts)

    from .product_evidence import list_accused_products, list_product_evidence

    product_rows = list_product_evidence(run_id)
    products = list_accused_products(run_id)
    if products or product_rows:
        document.add_heading("Accused product evidence", level=1)
        document.add_paragraph(
            "Litigation section keyed to claim element and accused product or process. "
            "Standard evidence remains in the three-column chart above."
        )
        for product in products:
            identity = product["name"]
            if product.get("model"):
                identity += f" · model {product['model']}"
            if product.get("software_version"):
                identity += f" · software {product['software_version']}"
            document.add_paragraph(identity, style="List Bullet")
            if product.get("configuration"):
                document.add_paragraph(f"Configuration: {product['configuration']}")
        if product_rows:
            prod_table = document.add_table(rows=1, cols=3)
            prod_table.style = "Table Grid"
            for cell, text in zip(
                prod_table.rows[0].cells,
                ["Claim element", "Product", "Product finding"],
                strict=True,
            ):
                cell.text = text
            for item in product_rows:
                cells = prod_table.add_row().cells
                cells[0].text = item.get("element_label") or item.get("element_id") or ""
                product_line = item.get("product_name") or ""
                if item.get("product_model"):
                    product_line += f" ({item['product_model']})"
                if item.get("product_software_version"):
                    product_line += f" · {item['product_software_version']}"
                cells[1].text = product_line
                finding_parts = [
                    f"Product evidence: {item.get('evidence_source') or '—'}",
                    (item.get("evidence_text") or "").strip(),
                    f"Finding: {(item.get('finding') or '').strip()}",
                ]
                if item.get("source_link"):
                    finding_parts.append(f"Link: {item['source_link']}")
                if item.get("unverified_notes"):
                    finding_parts.append(f"Unverified: {item['unverified_notes']}")
                cells[2].text = "\n".join(part for part in finding_parts if part)

    document.add_heading("Disposition appendix", level=1)
    for row in rows:
        document.add_paragraph(
            f"{row['ordinal']}. {row['label']}: analyst "
            f"{row['analyst_disposition'] or 'unresolved'}; review "
            f"{row['review_disposition'] or 'pending'}; revision {row['revision_number']}."
        )
    document.add_heading("Source manifest", level=1)
    document.add_paragraph(f"{run['family']} | {run['edition']} | SHA-256 {run['sha256']}")

    output_dir = settings.artifact_dir / "exports"
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = "final" if requested_final else "draft"
    path = output_dir / f"{run_id}-{suffix}.docx"
    document.save(path)
    return path

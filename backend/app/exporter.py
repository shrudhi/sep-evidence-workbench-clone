import hashlib
import json
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from .config import get_settings
from .database import connect, utcnow
from .evidence import mapping_display, resolve_evidence_blocks


def _enable_background_shapes(document: Document) -> None:
    """Required so Word draws header watermarks behind body/table text."""
    from docx.oxml import parse_xml

    settings = document.settings.element
    if settings.find(qn("w:displayBackgroundShape")) is None:
        settings.append(parse_xml('<w:displayBackgroundShape xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))


def _draft_watermark_shape(text: str = "DRAFT") -> OxmlElement:
    """Diagonal background watermark — sits behind table text, lightly visible."""
    # Escape for attribute context; watermark text is fixed/controlled.
    safe = (
        text.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    # Classic Word watermark: VML textpath in the header, negative z-index.
    xml = f"""
    <w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
         xmlns:v="urn:schemas-microsoft-com:vml"
         xmlns:o="urn:schemas-microsoft-com:office:office"
         xmlns:w10="urn:schemas-microsoft-com:office:word">
      <w:rPr><w:noProof/></w:rPr>
      <w:pict>
        <v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136"
          adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">
          <v:formulas>
            <v:f eqn="sum #0 0 10800"/>
            <v:f eqn="prod #0 2 1"/>
            <v:f eqn="sum 21600 0 @1"/>
            <v:f eqn="sum 0 0 @2"/>
            <v:f eqn="sum 21600 0 @3"/>
            <v:f eqn="if @0 @3 0"/>
            <v:f eqn="if @0 21600 @1"/>
            <v:f eqn="if @0 0 @2"/>
            <v:f eqn="if @0 @4 21600"/>
            <v:f eqn="mid @5 @6"/>
            <v:f eqn="mid @8 @5"/>
            <v:f eqn="mid @7 @8"/>
            <v:f eqn="mid @6 @7"/>
            <v:f eqn="sum @6 0 @5"/>
          </v:formulas>
          <v:path textpathok="t" o:connecttype="custom"
            o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/>
          <v:textpath on="t" fitshape="t"/>
          <v:handles>
            <v:h position="#0,bottomRight" xrange="6629,14971"/>
          </v:handles>
          <o:lock v:ext="edit" text="t" shapetype="t"/>
        </v:shapetype>
        <v:shape id="PowerPlusWaterMarkObject" o:spid="_x0000_s2049" type="#_x0000_t136"
          style="position:absolute;margin-left:0;margin-top:0;width:540pt;height:135pt;
                 rotation:315;z-index:-251658240;mso-position-horizontal:center;
                 mso-position-horizontal-relative:margin;mso-position-vertical:center;
                 mso-position-vertical-relative:margin"
          o:allowincell="f" fillcolor="#bfbfbf" stroked="f">
          <v:fill opacity=".35"/>
          <v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt;font-weight:bold"
            string="{safe}"/>
          <w10:wrap anchorx="margin" anchory="margin"/>
        </v:shape>
      </w:pict>
    </w:r>
    """
    from docx.oxml import parse_xml

    return parse_xml(xml)


def _apply_draft_markings(document: Document, designation: str) -> None:
    """Background watermark + header/footer so draft copies are unmistakable."""
    _enable_background_shapes(document)
    banner = "DRAFT — WORKING COPY · NOT FOR DELIVERY"
    for section in document.sections:
        header = section.header
        header.is_linked_to_previous = False
        # Clear default empty paragraph content, then rebuild.
        for paragraph in list(header.paragraphs):
            p = paragraph._element
            p.getparent().remove(p)
        # Watermark paragraph first (behind body); banner stays in the header band.
        mark = header.add_paragraph()
        mark.alignment = WD_ALIGN_PARAGRAPH.CENTER
        mark._p.append(_draft_watermark_shape("DRAFT"))
        title = header.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title.add_run(banner)
        run.bold = True
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)

        footer = section.footer
        footer.is_linked_to_previous = False
        for paragraph in list(footer.paragraphs):
            p = paragraph._element
            p.getparent().remove(p)
        foot = footer.add_paragraph()
        foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
        foot_run = foot.add_run(f"{designation}  ·  Page ")
        foot_run.font.size = Pt(8)
        foot_run.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
        # PAGE field
        fld_begin = OxmlElement("w:fldChar")
        fld_begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = " PAGE "
        fld_sep = OxmlElement("w:fldChar")
        fld_sep.set(qn("w:fldCharType"), "separate")
        fld_end = OxmlElement("w:fldChar")
        fld_end.set(qn("w:fldCharType"), "end")
        page_run = foot.add_run()
        page_run._r.append(fld_begin)
        page_run._r.append(instr)
        page_run._r.append(fld_sep)
        page_run._r.append(fld_end)
        page_run.font.size = Pt(8)
        page_run.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)


def resolve_export_designation(
    *,
    requested_final: bool,
    all_decided: bool,
    corpus: dict[str, Any],
    all_review_ready: bool | None = None,
) -> str:
    """Designate draft vs reviewed final.

    ``all_review_ready`` is the preferred gate (AI Review Passed or Accept/Reject).
    ``all_decided`` remains for older callers/tests; if ``all_review_ready`` is
    omitted, fall back to ``all_decided``.
    """
    corpus_complete = corpus.get("complete") is True
    ready = all_decided if all_review_ready is None else all_review_ready
    if requested_final and not corpus_complete:
        missing = ", ".join(corpus.get("missing_standard_ids") or ["unknown standard"])
        raise ValueError(
            f"Final export is blocked until the run includes the full corpus: {missing}"
        )
    if requested_final and not ready:
        raise ValueError(
            "Final export requires every row to be AI Review Passed "
            "or to have an analyst Accept/Reject disposition"
        )
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
               rev.reasons_json,rev.checks_json AS review_checks_json,
               ad.disposition AS analyst_disposition,ad.comment
        FROM claim_elements ce
        JOIN row_revisions rr ON rr.id=(
          SELECT id FROM row_revisions x WHERE x.element_id=ce.id
          ORDER BY x.revision_number DESC,x.created_at DESC LIMIT 1
        )
        LEFT JOIN review_results rev ON rev.id=(
          SELECT id FROM review_results y WHERE y.revision_id=rr.id
          ORDER BY y.created_at DESC LIMIT 1
        )
        LEFT JOIN analyst_decisions ad ON ad.id=(
          SELECT id FROM analyst_decisions y WHERE y.revision_id=rr.id
          ORDER BY y.created_at DESC LIMIT 1
        )
        WHERE ce.run_id=? ORDER BY ce.ordinal
        """,
        (run_id,),
    ).fetchall()


def _citation_heading(block: dict[str, Any]) -> str:
    """Assignment/gold-chart citation line: E0x | edition | section | printed / PDF."""
    source = block.get("source") or {}
    section = block.get("section_ref") or block.get("section_label") or "section n/a"
    family = (source.get("family") or "").strip()
    edition = (source.get("edition") or "").strip()
    # Prefer edition alone (matches gold “ITU-T H.265 (V10)…”) when present.
    doc_id = edition or family or "unknown standard"
    printed = block.get("printed_label") or "n/a"
    page = block.get("page_ordinal")
    evid = block.get("evidence_number")
    prefix = f"E{evid:02d} | " if isinstance(evid, int) else ""
    return f"{prefix}{doc_id} | {section} | printed {printed} / PDF {page}"


def _write_evidence_cell(
    cell,
    evidence_ids: list[str],
    *,
    role: str = "supporting",
    preamble: str | None = None,
) -> None:
    """Fill the Standard evidence column: quote · source citation · screenshot."""
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
                f"Evidence {block.get('evidence_number') or '?'}: "
                f"{block.get('error') or 'unavailable'}"
            )
            continue
        head = paragraph.add_run(f"{_citation_heading(block)}\n")
        head.bold = True
        quote = (block.get("quote") or "").strip()
        paragraph.add_run(f"Quote: {quote}\n" if quote else "Quote: (empty)\n")
        if role == "candidate":
            paragraph.add_run("Role: checked candidate (not claimed as support)\n")
        try:
            screenshot, lineage = render_page_screenshot(block["evidence_id"])
            paragraph.add_run().add_picture(str(screenshot), width=Inches(2.8))
            if not lineage.get("highlight"):
                warning = lineage.get("highlight_warning") or "Highlight unavailable"
                paragraph.add_run(f"\n{warning}")
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
    from .ai_review import ai_review_from_checks, row_ready_for_final

    model_config = json.loads(run["model_config_json"])
    corpus = model_config.get("corpus") or {}
    all_decided = bool(rows) and all(row["analyst_disposition"] for row in rows)
    ready_flags = []
    for row in rows:
        checks_raw = row["review_checks_json"] if "review_checks_json" in row.keys() else None
        checks = json.loads(checks_raw or "{}") if checks_raw else {}
        review = ai_review_from_checks(checks if isinstance(checks, dict) else {})
        ready_flags.append(
            row_ready_for_final(
                analyst_disposition=row["analyst_disposition"],
                ai_review=review,
            )
        )
    all_review_ready = bool(rows) and all(ready_flags)
    designation = resolve_export_designation(
        requested_final=requested_final,
        all_decided=all_decided,
        all_review_ready=all_review_ready,
        corpus=corpus,
    )
    corpus_complete = corpus.get("complete") is True

    document = Document()
    section = document.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    section.left_margin = Inches(0.6)
    section.right_margin = Inches(0.6)
    section.top_margin = Inches(0.55)
    section.bottom_margin = Inches(0.55)
    styles = document.styles
    styles["Normal"].font.name = "Calibri"
    styles["Normal"].font.size = Pt(9)
    is_draft = designation != "REVIEWED FINAL"
    if is_draft:
        _apply_draft_markings(document, designation)
    family = run["family"] or "Standard"
    edition = run["edition"] or ""
    document.add_heading(f"Claim chart: {family} {edition}".strip(), level=0)
    designation_para = document.add_paragraph()
    designation_run = designation_para.add_run(designation)
    designation_run.bold = True
    designation_run.font.size = Pt(12)
    if is_draft:
        designation_run.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
        note = document.add_paragraph()
        note_run = note.add_run(
            "This is a DRAFT working copy. Do not treat as the reviewed final deliverable."
        )
        note_run.italic = True
        note_run.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
    document.add_paragraph(
        f"Granted Claim 1 | {family} {edition} | Generated {utcnow()[:10]}\n"
        f"Run {run_id} · Source SHA-256 {run['sha256']}"
    )
    if not corpus_complete:
        missing = ", ".join(corpus.get("missing_standard_ids") or ["unknown"])
        document.add_paragraph(
            f"NON-FINAL CORPUS: This run did not include every expected standard. Missing: {missing}."
        )
    document.add_paragraph(
        "Technical evidence work product only — not a legal determination of essentiality. "
        "Three-column format: claim element · standard evidence (quote / source / screenshot) · "
        "rationale with Full map / Partial map / No map."
    )

    export_rows = [
        row for row in rows if (row["analyst_disposition"] or "").lower() != "reject"
    ]
    omitted_rejected = len(rows) - len(export_rows)
    if omitted_rejected:
        omit_note = document.add_paragraph()
        omit_run = omit_note.add_run(
            f"{omitted_rejected} claim element(s) were Rejected by the analyst and are "
            "omitted from this chart (element + standard evidence removed from delivery)."
        )
        omit_run.italic = True

    table = document.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    for cell, text in zip(
        table.rows[0].cells,
        ["Claim element", "Standard evidence", "Rationale and mapping"],
        strict=True,
    ):
        cell.text = text
        for paragraph in cell.paragraphs:
            for run_obj in paragraph.runs:
                run_obj.bold = True

    for row in export_rows:
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
        # Assignment/gold-chart style: mapping label → rationale → Not established bullets.
        rationale_parts = [mapping_line]
        tag_bits = []
        if tags.get("match_strength"):
            tag_bits.append(f"Match: {tags['match_strength']}")
        if tags.get("requirement_applicability"):
            req = f"Requirement: {tags['requirement_applicability']}"
            if tags.get("requirement_condition"):
                req += f" ({tags['requirement_condition']})"
            tag_bits.append(req)
        if tag_bits:
            rationale_parts.append(" · ".join(tag_bits))
        rationale_parts.append((row["rationale"] or "").strip() or "No rationale recorded.")
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
        analyst = row["analyst_disposition"]
        if analyst:
            rationale_parts.append(f"Analyst disposition: {analyst}")
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
        disposition = row["analyst_disposition"] or "unresolved"
        omit = " — omitted from chart table" if str(disposition).lower() == "reject" else ""
        document.add_paragraph(
            f"{row['ordinal']}. {row['label']}: analyst {disposition}{omit}; review "
            f"{row['review_disposition'] or 'pending'}; revision {row['revision_number']}."
        )
    document.add_heading("Source manifest", level=1)
    document.add_paragraph(f"{run['family']} | {run['edition']} | SHA-256 {run['sha256']}")

    output_dir = settings.artifact_dir / "exports"
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = "final" if requested_final else "draft"
    family_slug = "".join(
        ch if ch.isalnum() else "_" for ch in (run["family"] or "chart")
    ).strip("_") or "chart"
    path = output_dir / f"Claim1_{family_slug}_{suffix}.docx"
    document.save(path)
    return path

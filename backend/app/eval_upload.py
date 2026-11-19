"""Ingest uploaded reference + agent-output documents for Deliverable-4 evaluation.

Supports structured JSON/CSV/XLSX and freeform PDF/DOCX (LLM extract).
Never loads labelled reference text into the production retrieval corpus.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import uuid
from pathlib import Path
from typing import Any

from .config import get_settings
from .database import connect, dumps, transaction, utcnow
from .evaluation import (
    CRITERIA,
    confirm_alignments,
    create_evaluation_run,
    ensure_evaluation_schema,
    get_evaluation_run,
)
from .model_provider import OpenAICompatibleProvider, ProviderResponseError, ProviderUnavailable

H265_TARGET = {
    "family": "H.265",
    "edition": "ITU-T H.265 V10 (07/2024)",
    "document_id": "standard-h265-v10",
    "document_edition_label": "ITU-T H.265 (V10) (07/2024)",
    "sha256": "d61a67af3ad1fba39a6b6910ff81f78a214871df41f76e94a96b7ca941c61222",
}

_MAX_EXTRACT_CHARS = 120_000


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name or "upload.bin")[:180]


def extract_plain_text(filename: str, content: bytes) -> str:
    """Pull plain text from PDF/DOCX/TXT/MD uploads."""
    name = (filename or "").lower()
    if name.endswith((".txt", ".md", ".csv")):
        return content.decode("utf-8-sig", errors="replace")
    if name.endswith(".docx"):
        from docx import Document

        doc = Document(io.BytesIO(content))
        parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
                if cells:
                    parts.append(" | ".join(cells))
        return "\n".join(parts)
    if name.endswith(".pdf"):
        import pdfplumber

        chunks: list[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for index, page in enumerate(pdf.pages, start=1):
                text = (page.extract_text() or "").strip()
                if text:
                    chunks.append(f"[PDF page {index}]\n{text}")
        return "\n\n".join(chunks)
    raise ValueError(f"Cannot extract text from {filename}; use PDF/DOCX/TXT or structured JSON/CSV/XLSX")


def _norm_header(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _mapping_norm(value: str) -> str:
    raw = (value or "").strip()
    low = raw.lower()
    if "full" in low:
        return "Full map"
    if "partial" in low:
        return "Partial map"
    if "no" in low:
        return "No map"
    return raw or "Partial map"


def _row_from_flat(data: dict[str, Any], index: int) -> dict[str, Any]:
    """Map flexible spreadsheet/CSV headers into a reference or agent element row."""
    headers = {_norm_header(k): v for k, v in data.items()}

    def g(*keys: str) -> str:
        for key in keys:
            if key in headers and headers[key] not in (None, ""):
                return str(headers[key]).strip()
        return ""

    claim_id = g(
        "claim element id",
        "id",
        "label",
        "element",
        "aligned to expected claim element",
        "agent element label",
    ) or f"row-{index}"
    mapping = _mapping_norm(
        g("expected mapping label (full / partial / no)", "expected mapping label", "mapping_label", "expected_label", "agent mapping label")
    )
    exact = g("exact claim text", "exact_text", "claim_text", "agent claim / element text")
    rationale = g("how we decided this label", "rationale", "agent rationale", "how we decided")
    gaps_raw = g("what is still missing (gaps)", "gaps")
    gaps = [x.strip() for x in re.split(r"[;\n|]", gaps_raw) if x.strip()]
    evidence_id = g("evidence id", "evidence_id", "evidence id (span)") or f"E{index:02d}"
    edition = g("standard edition") or H265_TARGET["edition"]
    section = g("section")
    printed = g("printed page in the standard", "printed page", "printed_label")
    pdf_page = g("pdf file page", "pdf page", "page_ordinal", "page")
    quote = g("complete expected quote", "complete agent quote", "quote", "complete quote")
    screenshot = g("screenshot file path", "screenshot", "screenshot_url")
    block_num = g("evidence block number")
    agent_row_id = g("agent row id")

    try:
        page_ordinal = int(float(pdf_page)) if pdf_page else None
    except ValueError:
        page_ordinal = None

    block = {
        "evidence_id": evidence_id,
        "available": bool(quote),
        "quote": quote,
        "source": {
            "document_id": H265_TARGET["document_id"] if "h.265" in edition.lower() or "h265" in edition.lower() else None,
            "family": H265_TARGET["family"] if "h.265" in edition.lower() or "h265" in edition.lower() else "",
            "edition": edition,
            "sha256": H265_TARGET["sha256"] if "h.265" in edition.lower() or "h265" in edition.lower() else None,
        },
        "section_label": section or None,
        "page_ordinal": page_ordinal,
        "printed_label": printed or None,
        "screenshot_url": screenshot or None,
        "bbox": None,
        "block_number": block_num or None,
    }
    return {
        "id": claim_id,
        "label": claim_id,
        "exact_text": exact,
        "mapping_label": mapping,
        "rationale": rationale,
        "gaps": gaps,
        "evidence_ids": [evidence_id] if evidence_id else [],
        "evidence_blocks": [block] if quote or evidence_id else [],
        "agent_row_id": agent_row_id or None,
    }


def _merge_element_rows(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse one-row-per-evidence-block sheets into one row per claim element."""
    ordered: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    for item in items:
        eid = item["id"]
        if eid not in by_id:
            by_id[eid] = {
                "id": eid,
                "label": item.get("label") or eid,
                "exact_text": item.get("exact_text") or "",
                "mapping_label": item.get("mapping_label") or "Partial map",
                "rationale": item.get("rationale") or "",
                "gaps": list(item.get("gaps") or []),
                "evidence_ids": [],
                "evidence_blocks": [],
                "agent_row_id": item.get("agent_row_id"),
            }
            ordered.append(eid)
        row = by_id[eid]
        if item.get("exact_text") and not row["exact_text"]:
            row["exact_text"] = item["exact_text"]
        if item.get("rationale") and not row["rationale"]:
            row["rationale"] = item["rationale"]
        if item.get("gaps") and not row["gaps"]:
            row["gaps"] = list(item["gaps"])
        if item.get("mapping_label"):
            row["mapping_label"] = item["mapping_label"]
        if item.get("agent_row_id"):
            row["agent_row_id"] = item["agent_row_id"]
        for block in item.get("evidence_blocks") or []:
            bid = block.get("evidence_id")
            if bid and bid not in row["evidence_ids"]:
                row["evidence_ids"].append(bid)
            if block.get("quote") or bid:
                row["evidence_blocks"].append(block)
    return [by_id[i] for i in ordered]


def _parse_xlsx_rows(content: bytes, preferred_sheets: list[str] | None = None) -> list[dict[str, Any]]:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = None
    if preferred_sheets:
        lower = {name.lower(): name for name in wb.sheetnames}
        for want in preferred_sheets:
            if want.lower() in lower:
                sheet = wb[lower[want.lower()]]
                break
            for name in wb.sheetnames:
                if want.lower() in name.lower():
                    sheet = wb[name]
                    break
            if sheet is not None:
                break
    if sheet is None:
        sheet = wb.active
    rows_iter = sheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration as exc:
        raise ValueError("Spreadsheet is empty") from exc
    headers = [_norm_header(h) for h in header_row]
    # Skip legend rows with no useful headers
    if not any(headers):
        header_row = next(rows_iter, None)
        if not header_row:
            raise ValueError("Spreadsheet has no header row")
        headers = [_norm_header(h) for h in header_row]
    items: list[dict[str, Any]] = []
    for index, excel_row in enumerate(rows_iter, start=2):
        data = {headers[i]: excel_row[i] for i in range(min(len(headers), len(excel_row)))}
        if not any(v not in (None, "") for v in data.values()):
            continue
        # Skip footer / legend / instruction lines
        first = str(next(iter(data.values())) or "").strip()
        first_l = first.lower()
        if first_l.startswith(
            (
                "how to read",
                "label policy",
                "class distribution",
                "honesty",
                "scope",
                "qc ",
                "agent chart for",
                "one row =",
            )
        ):
            continue
        if len(first) > 80 and not re.match(r"^\d+\[[a-z]\]$", first_l):
            # Long prose in the ID column is a legend, not a claim element id
            continue
        items.append(_row_from_flat(data, index))
    if not items:
        raise ValueError("Spreadsheet contained no data rows")
    return _merge_element_rows(items)


def _parse_csv_rows(content: bytes) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    items = []
    for index, row in enumerate(reader, start=1):
        items.append(_row_from_flat(row, index))
    if not items:
        raise ValueError("CSV contained no data rows")
    return _merge_element_rows(items)


def _reference_payload_from_rows(rows: list[dict[str, Any]], *, source_label: str) -> dict[str, Any]:
    dataset_id = f"upload-ref-{uuid.uuid4().hex[:8]}"
    return {
        "dataset_id": dataset_id,
        "version": "1.0.0-upload",
        "status": f"Uploaded reference — {source_label} (provisional)",
        "provisional": True,
        "expert_signoff": False,
        "patent": {"id": "US10063856B2"},
        "recommended_target": dict(H265_TARGET),
        "label_policy": (
            "Uploaded labelled expected chart. Treat Full/Partial/No labels as human expected results. "
            "Attorney sign-off is not claimed unless explicitly recorded."
        ),
        "class_distribution": {},
        "criteria": [
            {"id": cid, "key": key, "name": name, "pass_condition": name} for cid, key, name in CRITERIA
        ],
        "rows": [
            {
                "id": row["id"],
                "label": row.get("label") or row["id"],
                "exact_text": row.get("exact_text") or "",
                "mapping_label": row.get("mapping_label") or "Partial map",
                "rationale": row.get("rationale") or "",
                "gaps": row.get("gaps") or [],
                "evidence_ids": row.get("evidence_ids") or [],
                "evidence_blocks": row.get("evidence_blocks") or [],
            }
            for row in rows
        ],
        "requirements": [],
        "target_selection_controls": [],
    }


def _agent_chart_from_rows(rows: list[dict[str, Any]], *, run_id: str) -> dict[str, Any]:
    chart_rows = []
    for ordinal, row in enumerate(rows, start=1):
        element_id = row.get("agent_row_id") or str(uuid.uuid4())
        blocks = []
        for block in row.get("evidence_blocks") or []:
            b = dict(block)
            b.setdefault("available", bool(b.get("quote")))
            b.setdefault("role", "supporting")
            source = dict(b.get("source") or {})
            if not source.get("document_id") and "h.265" in str(source.get("edition") or "").lower():
                source.update(
                    {
                        "document_id": H265_TARGET["document_id"],
                        "family": H265_TARGET["family"],
                        "sha256": H265_TARGET["sha256"],
                    }
                )
            b["source"] = source
            blocks.append(b)
        if not blocks and row.get("exact_text"):
            blocks = [
                {
                    "evidence_id": f"upload:{row['id']}:0",
                    "available": False,
                    "quote": "",
                    "source": {
                        "document_id": H265_TARGET["document_id"],
                        "family": H265_TARGET["family"],
                        "edition": H265_TARGET["edition"],
                        "sha256": H265_TARGET["sha256"],
                    },
                    "error": "No evidence quote extracted from upload",
                    "screenshot_url": None,
                    "bbox": None,
                }
            ]
        revision = {
            "id": str(uuid.uuid4()),
            "run_id": run_id,
            "element_id": element_id,
            "revision_number": 1,
            "mapping_label": row.get("mapping_label") or "Partial map",
            "rationale": row.get("rationale") or "",
            "evidence_ids": [b.get("evidence_id") for b in blocks if b.get("evidence_id")],
            "evidence_blocks": blocks,
            "candidate_blocks": [],
            "missing_requirements": row.get("gaps") or [],
        }
        chart_rows.append(
            {
                "id": element_id,
                "run_id": run_id,
                "ordinal": ordinal,
                "label": row.get("label") or row["id"],
                "exact_text": row.get("exact_text") or "",
                "requirements": [],
                "revisions": [revision],
                "latest_revision_number": 1,
                "aligned_reference_hint": row["id"],
            }
        )
    return {
        "run": {
            "id": run_id,
            "status": "complete",
            "status_label": "Uploaded agent chart",
            "target_document_id": H265_TARGET["document_id"],
            "family": H265_TARGET["family"],
            "edition": H265_TARGET["edition"],
            "title": "Uploaded agent output",
            "upload_sourced": True,
        },
        "rows": chart_rows,
    }


def _llm_extract_rows(text: str, *, role: str) -> list[dict[str, Any]]:
    provider = OpenAICompatibleProvider()
    if not provider.readiness()["ready"]:
        raise ProviderUnavailable(
            "Model provider is not configured; cannot LLM-extract freeform PDF/DOCX. "
            "Upload JSON/CSV/XLSX instead, or set MODEL_API_KEY / REVIEWER_MODEL."
        )
    clipped = text[:_MAX_EXTRACT_CHARS]
    result = provider.structured(
        purpose=f"evaluation_upload_extract_{role}",
        system=(
            "You extract SEP claim-chart rows for evaluation. Respond with JSON only: "
            '{"rows":[{"id":"1[a]","exact_text":"...","mapping_label":"Partial map",'
            '"rationale":"...","gaps":["..."],"evidence_blocks":[{"evidence_id":"E01",'
            '"quote":"...","section":"3.53","printed_page":"7","pdf_page":25,'
            '"edition":"ITU-T H.265 V10 (07/2024)","screenshot_path":null}]}]}. '
            "Use Full map / Partial map / No map only. Prefer Claim-1 limitation ids 1[a],1[b],1[c] when possible. "
            "Do not invent quotes that are not in the document. If pages are unknown, omit pdf_page."
        ),
        payload={
            "role": role,
            "document_text": clipped,
            "target_standard_hint": H265_TARGET,
            "instructions": (
                "Reference role: labelled expected chart. "
                "Agent role: generated claim chart under test. "
                "One row per claim element; multiple evidence_blocks allowed."
            ),
        },
        reviewer=True,
        run_id=None,
        max_output_tokens=4000,
    )
    data = result.data if isinstance(result.data, dict) else {}
    raw_rows = data.get("rows")
    if not isinstance(raw_rows, list) or not raw_rows:
        raise ValueError(f"LLM extract for {role} returned no rows")
    items: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_rows, start=1):
        if not isinstance(raw, dict):
            continue
        blocks_in = raw.get("evidence_blocks") or []
        flat_blocks = []
        for b_index, block in enumerate(blocks_in, start=1):
            if not isinstance(block, dict):
                continue
            edition = str(block.get("edition") or H265_TARGET["edition"])
            try:
                page_ordinal = int(block["pdf_page"]) if block.get("pdf_page") not in (None, "") else None
            except (TypeError, ValueError):
                page_ordinal = None
            flat_blocks.append(
                {
                    "evidence_id": str(block.get("evidence_id") or f"E{index:02d}-{b_index}"),
                    "available": bool(block.get("quote")),
                    "quote": str(block.get("quote") or ""),
                    "source": {
                        "document_id": H265_TARGET["document_id"],
                        "family": H265_TARGET["family"],
                        "edition": edition,
                        "sha256": H265_TARGET["sha256"],
                    },
                    "section_label": block.get("section"),
                    "page_ordinal": page_ordinal,
                    "printed_label": str(block.get("printed_page") or "") or None,
                    "screenshot_url": block.get("screenshot_path") or block.get("screenshot_url"),
                    "bbox": None,
                }
            )
        items.append(
            {
                "id": str(raw.get("id") or f"row-{index}"),
                "label": str(raw.get("id") or f"row-{index}"),
                "exact_text": str(raw.get("exact_text") or ""),
                "mapping_label": _mapping_norm(str(raw.get("mapping_label") or "Partial map")),
                "rationale": str(raw.get("rationale") or ""),
                "gaps": [str(g) for g in (raw.get("gaps") or []) if str(g).strip()],
                "evidence_ids": [b["evidence_id"] for b in flat_blocks],
                "evidence_blocks": flat_blocks,
            }
        )
    if not items:
        raise ValueError(f"LLM extract for {role} produced no usable rows")
    return items


def ingest_reference_upload(*, filename: str, content: bytes, content_type: str | None = None) -> dict[str, Any]:
    name = (filename or "reference").lower()
    if name.endswith(".json"):
        payload = json.loads(content.decode("utf-8"))
        if not isinstance(payload, dict) or not payload.get("rows"):
            raise ValueError("Reference JSON must include a non-empty rows array")
        payload = dict(payload)
        payload.setdefault("dataset_id", f"upload-ref-{uuid.uuid4().hex[:8]}")
        payload.setdefault("version", "1.0.0-upload")
        payload.setdefault("provisional", True)
        payload.setdefault("recommended_target", dict(H265_TARGET))
        payload.setdefault(
            "criteria",
            [{"id": cid, "key": key, "name": n, "pass_condition": n} for cid, key, n in CRITERIA],
        )
        return payload
    if name.endswith(".csv"):
        return _reference_payload_from_rows(_parse_csv_rows(content), source_label="CSV")
    if name.endswith((".xlsx", ".xls")):
        rows = _parse_xlsx_rows(
            content,
            preferred_sheets=["2 Labelled expected chart", "Expected chart", "Labelled expected chart"],
        )
        return _reference_payload_from_rows(rows, source_label="XLSX")
    if name.endswith((".pdf", ".docx", ".txt", ".md")):
        text = extract_plain_text(filename, content)
        if len(text.strip()) < 40:
            raise ValueError("Uploaded reference document has too little extractable text")
        try:
            rows = _llm_extract_rows(text, role="reference")
        except ProviderUnavailable:
            raise
        except ProviderResponseError as exc:
            raise ValueError(f"LLM extract failed for reference upload: {exc}") from exc
        return _reference_payload_from_rows(rows, source_label=f"LLM extract from {Path(filename).suffix}")
    raise ValueError("Supported reference uploads: .json .csv .xlsx .pdf .docx .txt")


def ingest_agent_output_upload(*, filename: str, content: bytes, run_id: str) -> dict[str, Any]:
    name = (filename or "output").lower()
    if name.endswith(".json"):
        data = json.loads(content.decode("utf-8"))
        if isinstance(data, dict) and data.get("rows") and data.get("run"):
            chart = data
            chart["run"] = {**(chart.get("run") or {}), "id": run_id, "upload_sourced": True}
            chart["run"].setdefault("family", H265_TARGET["family"])
            chart["run"].setdefault("edition", H265_TARGET["edition"])
            return chart
        if isinstance(data, dict) and data.get("rows"):
            rows = []
            for index, raw in enumerate(data["rows"], start=1):
                if not isinstance(raw, dict):
                    continue
                rows.append(
                    _row_from_flat(
                        {
                            "id": raw.get("id") or raw.get("label"),
                            "exact_text": raw.get("exact_text"),
                            "mapping_label": raw.get("mapping_label"),
                            "rationale": raw.get("rationale"),
                            "gaps": "; ".join(raw.get("gaps") or []),
                        },
                        index,
                    )
                )
                # Prefer nested evidence if present
                if raw.get("evidence_blocks"):
                    rows[-1]["evidence_blocks"] = raw["evidence_blocks"]
                    rows[-1]["evidence_ids"] = [
                        b.get("evidence_id") for b in raw["evidence_blocks"] if isinstance(b, dict)
                    ]
            return _agent_chart_from_rows(_merge_element_rows(rows), run_id=run_id)
        raise ValueError("Agent JSON must include rows (chart snapshot or labelled rows)")
    if name.endswith(".csv"):
        return _agent_chart_from_rows(_parse_csv_rows(content), run_id=run_id)
    if name.endswith((".xlsx", ".xls")):
        rows = _parse_xlsx_rows(
            content,
            preferred_sheets=["2b Agent chart (as tested)", "2b Agent chart", "Actual Agent Results", "Agent chart"],
        )
        return _agent_chart_from_rows(rows, run_id=run_id)
    if name.endswith((".pdf", ".docx", ".txt", ".md")):
        text = extract_plain_text(filename, content)
        if len(text.strip()) < 40:
            raise ValueError("Uploaded agent output has too little extractable text")
        try:
            rows = _llm_extract_rows(text, role="agent")
        except ProviderUnavailable:
            raise
        except ProviderResponseError as exc:
            raise ValueError(f"LLM extract failed for agent-output upload: {exc}") from exc
        return _agent_chart_from_rows(rows, run_id=run_id)
    raise ValueError("Supported agent-output uploads: .json .csv .xlsx .pdf .docx .txt")


def _persist_dataset(payload: dict[str, Any], *, filename: str, content: bytes, content_type: str | None) -> str:
    ensure_evaluation_schema()
    dataset_id = str(payload.get("dataset_id") or f"upload-ref-{uuid.uuid4().hex[:8]}")
    payload["dataset_id"] = dataset_id
    now = utcnow()
    dest_dir = Path("evaluation_data") / "uploads" / dataset_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _safe_name(filename)
    dest.write_bytes(content)
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO evaluation_datasets(id,version,status_label,provisional,payload_json,pack_path,imported_at)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              version=excluded.version,
              status_label=excluded.status_label,
              provisional=excluded.provisional,
              payload_json=excluded.payload_json,
              pack_path=excluded.pack_path,
              imported_at=excluded.imported_at
            """,
            (
                dataset_id,
                str(payload.get("version") or "1.0.0-upload"),
                str(payload.get("status") or "Uploaded reference"),
                1 if payload.get("provisional", True) else 0,
                dumps(payload),
                str(dest),
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO evaluation_reference_files(
              id,dataset_id,filename,content_type,size_bytes,sha256,path,kind,attached_at,removed
            ) VALUES(?,?,?,?,?,?,?,?,?,0)
            """,
            (
                str(uuid.uuid4()),
                dataset_id,
                filename or dest.name,
                content_type,
                len(content),
                hashlib.sha256(content).hexdigest(),
                str(dest),
                "upload_reference",
                now,
            ),
        )
    return dataset_id


def _persist_synthetic_run_and_snapshot(
    chart: dict[str, Any],
    *,
    output_filename: str,
    output_content: bytes,
) -> tuple[str, str]:
    ensure_evaluation_schema()
    run_id = str(uuid.uuid4())
    snapshot_id = str(uuid.uuid4())
    now = utcnow()
    chart = dict(chart)
    chart["run"] = {
        **(chart.get("run") or {}),
        "id": run_id,
        "status": "complete",
        "status_label": "Uploaded agent chart",
        "family": H265_TARGET["family"],
        "edition": H265_TARGET["edition"],
        "target_document_id": H265_TARGET["document_id"],
        "upload_sourced": True,
    }
    for row in chart.get("rows") or []:
        row["run_id"] = run_id
        for rev in row.get("revisions") or []:
            rev["run_id"] = run_id
    chart_json = dumps(chart)
    chart_hash = hashlib.sha256(chart_json.encode()).hexdigest()
    dest_dir = Path("evaluation_data") / "uploads" / f"agent-{run_id[:8]}"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _safe_name(output_filename)
    dest.write_bytes(output_content)
    metadata = {
        "output_stage": "uploaded_chart",
        "run_status": "complete",
        "target_document_id": H265_TARGET["document_id"],
        "family": H265_TARGET["family"],
        "edition": H265_TARGET["edition"],
        "upload_path": str(dest),
        "upload_filename": output_filename,
        "code_note": "Synthetic run created from uploaded agent output for D4 evaluation only",
    }
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO runs(
              id,session_id,status,target_document_id,claim_text,claim_start,claim_end,
              model_config_json,estimated_cost_usd,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id,
                "evaluation-upload",
                "complete",
                H265_TARGET["document_id"],
                "Uploaded agent claim chart (evaluation only)",
                0,
                0,
                dumps({"source": "evaluation_upload", "adapter": "upload"}),
                0,
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO chart_snapshots(id,run_id,output_stage,chart_json,chart_hash,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                snapshot_id,
                run_id,
                "uploaded_chart",
                chart_json,
                chart_hash,
                dumps(metadata),
                now,
            ),
        )
    return run_id, snapshot_id


def preview_reference_dataset(dataset_id: str) -> dict[str, Any]:
    """Document preview for choosing among multiple reference datasets."""
    from .evaluation import get_dataset, list_reference_files

    dataset = get_dataset(dataset_id)
    payload = dataset.get("payload") or {}
    rows = []
    for row in payload.get("rows") or []:
        blocks_out = []
        for block in row.get("evidence_blocks") or []:
            source = block.get("source") or {}
            blocks_out.append(
                {
                    "evidence_id": block.get("evidence_id"),
                    "section": block.get("section_label") or block.get("section"),
                    "printed_page": block.get("printed_label") or block.get("printed_page"),
                    "pdf_page": block.get("page_ordinal") or block.get("pdf_page"),
                    "edition": source.get("edition"),
                    "quote": str(block.get("quote") or "")[:500],
                    "screenshot": block.get("screenshot_url") or block.get("screenshot_path"),
                }
            )
        if not blocks_out:
            for eid in row.get("evidence_ids") or []:
                blocks_out.append({"evidence_id": eid, "quote": ""})
        rows.append(
            {
                "id": row.get("id"),
                "mapping_label": row.get("mapping_label"),
                "exact_text": row.get("exact_text") or "",
                "rationale": (row.get("rationale") or "")[:500],
                "gaps": row.get("gaps") or [],
                "evidence_count": len(blocks_out),
                "evidence_blocks": blocks_out,
                "sample_quote": (blocks_out[0].get("quote") if blocks_out else "")[:220],
            }
        )
    files = []
    try:
        files = list_reference_files(dataset_id)
    except Exception:  # noqa: BLE001
        files = []

    pack_path = dataset.get("pack_path")
    source_name = Path(pack_path).name if pack_path else None
    enriched_files = []
    for item in files:
        name = str(item.get("filename") or "")
        lower = name.lower()
        content_type = str(item.get("content_type") or "")
        if lower.endswith(".pdf") or "pdf" in content_type:
            kind = "pdf"
        elif lower.endswith((".xlsx", ".xls", ".csv")):
            kind = "spreadsheet"
        elif lower.endswith(".json"):
            kind = "json"
        elif lower.endswith((".docx", ".txt", ".md")):
            kind = "text"
        else:
            kind = item.get("kind") or "other"
        enriched_files.append(
            {
                **item,
                "preview_kind": kind,
                "size_kb": round((item.get("size_bytes") or 0) / 1024, 1),
            }
        )

    # Prefer human-readable docs for default preview: PDF first, then sheet/json
    default_file = next(
        (f for f in enriched_files if f.get("preview_kind") == "pdf"),
        None,
    ) or next(
        (f for f in enriched_files if f.get("preview_kind") in ("spreadsheet", "json")),
        enriched_files[0] if enriched_files else None,
    )

    return {
        "id": dataset["id"],
        "version": dataset.get("version"),
        "status_label": dataset.get("status_label"),
        "provisional": dataset.get("provisional"),
        "imported_at": dataset.get("imported_at"),
        "pack_path": pack_path,
        "source_filename": source_name,
        "display_name": source_name or dataset["id"],
        "row_count": len(rows),
        "rows": rows,
        "recommended_target": payload.get("recommended_target"),
        "label_policy": (payload.get("label_policy") or "")[:600],
        "files": enriched_files,
        "default_file_id": default_file.get("id") if default_file else None,
        "download_url": (default_file or {}).get("download_url")
        or (enriched_files[0]["download_url"] if enriched_files else None),
    }


def create_evaluation_run_from_uploads(
    *,
    reference_filename: str,
    reference_content: bytes,
    reference_content_type: str | None,
    output_filename: str,
    output_content: bytes,
    output_content_type: str | None,
    auto_confirm_alignments: bool = True,
) -> dict[str, Any]:
    """Parse uploads → score with existing engine → write D4 workbook."""
    if not reference_content or not output_content:
        raise ValueError("Both reference and agent-output files are required")

    reference_payload = ingest_reference_upload(
        filename=reference_filename,
        content=reference_content,
        content_type=reference_content_type,
    )
    dataset_id = _persist_dataset(
        reference_payload,
        filename=reference_filename,
        content=reference_content,
        content_type=reference_content_type,
    )

    # Temporary run id for chart construction; replaced when persisted
    draft_run_id = str(uuid.uuid4())
    chart = ingest_agent_output_upload(
        filename=output_filename,
        content=output_content,
        run_id=draft_run_id,
    )
    run_id, snapshot_id = _persist_synthetic_run_and_snapshot(
        chart,
        output_filename=output_filename,
        output_content=output_content,
    )

    detail = create_evaluation_run(
        run_id=run_id,
        dataset_id=dataset_id,
        snapshot_id=snapshot_id,
        output_stage="uploaded_chart",
    )
    if auto_confirm_alignments and not detail.get("alignments_confirmed"):
        try:
            detail = confirm_alignments(detail["id"], None)
        except Exception:  # noqa: BLE001
            # Keep automated_complete result even if confirm fails
            detail = get_evaluation_run(detail["id"])

    from .eval_d4_export import write_deliverable4_workbook

    d4_path = write_deliverable4_workbook(detail["id"])
    detail = get_evaluation_run(detail["id"])
    detail["d4_export_path"] = str(d4_path)
    detail["start_mode"] = "upload_pair"
    return detail


def create_evaluation_run_from_sources(
    *,
    reference_dataset_id: str | None = None,
    reference_filename: str | None = None,
    reference_content: bytes | None = None,
    reference_content_type: str | None = None,
    output_filename: str | None = None,
    output_content: bytes | None = None,
    output_content_type: str | None = None,
    agent_run_id: str | None = None,
    snapshot_id: str | None = None,
    auto_confirm_alignments: bool = True,
) -> dict[str, Any]:
    """Start evaluation from existing reference dataset and/or uploads / generated chart.

    Agent output modes:
    - uploaded file (PDF/DOCX/XLSX/…)
    - generated chart run → export sheet-2b XLSX, store it, score against live snapshot
    """
    from .eval_d4_export import export_agent_chart_xlsx, write_deliverable4_workbook
    from .evaluation import get_dataset

    agent_export_meta: dict[str, Any] | None = None

    # Resolve reference dataset
    if reference_dataset_id:
        get_dataset(reference_dataset_id)
        dataset_id = reference_dataset_id
    elif reference_content and reference_filename:
        payload = ingest_reference_upload(
            filename=reference_filename,
            content=reference_content,
            content_type=reference_content_type,
        )
        dataset_id = _persist_dataset(
            payload,
            filename=reference_filename,
            content=reference_content,
            content_type=reference_content_type,
        )
    else:
        raise ValueError("Select an existing reference dataset or upload a new reference file")

    # Resolve agent output
    if agent_run_id:
        agent_export_meta = export_agent_chart_xlsx(agent_run_id, snapshot_id=snapshot_id)
        # Prefer live snapshot scoring (accurate); XLSX is stored for review/reuse
        detail = create_evaluation_run(
            run_id=agent_run_id,
            dataset_id=dataset_id,
            snapshot_id=agent_export_meta.get("snapshot_id") or snapshot_id,
            output_stage="latest_chart",
        )
        start_mode = "generated_chart_xlsx"
    elif output_content and output_filename:
        draft_run_id = str(uuid.uuid4())
        chart = ingest_agent_output_upload(
            filename=output_filename,
            content=output_content,
            run_id=draft_run_id,
        )
        run_id, snap_id = _persist_synthetic_run_and_snapshot(
            chart,
            output_filename=output_filename,
            output_content=output_content,
        )
        detail = create_evaluation_run(
            run_id=run_id,
            dataset_id=dataset_id,
            snapshot_id=snap_id,
            output_stage="uploaded_chart",
        )
        start_mode = "upload_agent_file"
    else:
        raise ValueError("Upload an agent-output file or select a generated chart run")

    if auto_confirm_alignments and not detail.get("alignments_confirmed"):
        try:
            detail = confirm_alignments(detail["id"], None)
        except Exception:  # noqa: BLE001
            detail = get_evaluation_run(detail["id"])

    d4_path = write_deliverable4_workbook(detail["id"])
    detail = get_evaluation_run(detail["id"])
    detail["d4_export_path"] = str(d4_path)
    detail["start_mode"] = start_mode
    detail["reference_dataset_id"] = dataset_id
    if agent_export_meta:
        detail["agent_chart_export"] = agent_export_meta
    return detail

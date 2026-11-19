"""Write Deliverable-4 shaped evaluation workbook from a scored evaluation run."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from .config import get_settings
from .evaluation import get_evaluation_run

CORE = ["C01", "C02", "C03", "C04", "C05", "C06"]
CRITERION_NAMES = {
    "C01": "Right Standard & Edition",
    "C02": "Quote Real and Verbatim",
    "C03": "Source, Section & Page Correct",
    "C04": "Screenshot Matches Quote",
    "C05": "Rationale Supports Element",
    "C06": "Full / Partial / No Label Correct",
}


def _status(crit: dict[str, Any]) -> str:
    return crit.get("adjudicated_status") or crit.get("automatic_status") or "Not run"


def _reason(crit: dict[str, Any]) -> str:
    return crit.get("adjudicated_reason") or crit.get("automatic_reason") or ""


def _short(text: str | None, n: int = 90) -> str:
    raw = (text or "").strip()
    return raw if len(raw) <= n else raw[: n - 1] + "…"


AGENT_CHART_HEADERS = [
    "Aligned to expected claim element",
    "Agent row id",
    "Agent element label",
    "Agent claim / element text",
    "Agent mapping label",
    "Agent rationale",
    "Evidence block number",
    "Evidence ID (span)",
    "Standard edition",
    "Section",
    "Printed page in the standard",
    "PDF file page",
    "Complete agent quote",
    "Screenshot file path",
]


def export_agent_chart_xlsx(
    run_id: str,
    *,
    snapshot_id: str | None = None,
) -> dict[str, Any]:
    """Freeze/load chart for a run, write sheet-2b XLSX, store under evaluation_data/uploads."""
    from openpyxl import Workbook

    from .evaluation import freeze_snapshot, _load_chart
    from .database import connect, dumps, utcnow
    import hashlib
    import uuid

    chart: dict[str, Any]
    used_snapshot_id = snapshot_id
    if snapshot_id:
        with connect() as connection:
            snap = connection.execute(
                "SELECT * FROM chart_snapshots WHERE id=?", (snapshot_id,)
            ).fetchone()
        if not snap:
            raise KeyError(f"Unknown snapshot {snapshot_id}")
        if snap["run_id"] != run_id:
            raise ValueError("Snapshot does not belong to the selected chart run")
        chart = json.loads(snap["chart_json"])
    else:
        # Prefer freeze when run is ready; otherwise load live chart
        try:
            frozen = freeze_snapshot(run_id, output_stage="latest_chart")
            used_snapshot_id = frozen["id"]
            with connect() as connection:
                snap = connection.execute(
                    "SELECT chart_json FROM chart_snapshots WHERE id=?",
                    (used_snapshot_id,),
                ).fetchone()
            chart = json.loads(snap["chart_json"])
        except Exception:  # noqa: BLE001
            chart = _load_chart(run_id)
            for row in chart.get("rows") or []:
                revisions = row.get("revisions") or []
                if revisions:
                    row["revisions"] = [revisions[-1]]

    wb = Workbook()
    ws = wb.active
    ws.title = "2b Agent chart (as tested)"
    ws.append(AGENT_CHART_HEADERS)
    for row in chart.get("rows") or []:
        rev = (row.get("revisions") or [{}])[-1]
        blocks = rev.get("evidence_blocks") or []
        if not blocks:
            blocks = [{}]
        total = len(blocks)
        for index, block in enumerate(blocks, start=1):
            source = block.get("source") or {}
            ws.append(
                [
                    row.get("aligned_reference_hint") or row.get("label") or "",
                    row.get("id"),
                    row.get("label"),
                    row.get("exact_text"),
                    rev.get("mapping_label"),
                    rev.get("rationale"),
                    f"{index} of {total}",
                    block.get("evidence_id"),
                    source.get("edition"),
                    block.get("section_label"),
                    block.get("printed_label"),
                    block.get("page_ordinal"),
                    block.get("quote"),
                    block.get("screenshot_url"),
                ]
            )

    out_dir = Path("evaluation_data") / "uploads" / "agent-exports" / run_id[:8]
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"agent_chart_{run_id[:8]}_{uuid.uuid4().hex[:6]}.xlsx"
    path = out_dir / filename
    wb.save(path)
    content = path.read_bytes()
    return {
        "run_id": run_id,
        "snapshot_id": used_snapshot_id,
        "path": str(path),
        "filename": filename,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "download_url": f"/api/runs/{run_id}/agent-chart.xlsx"
        + (f"?snapshot_id={used_snapshot_id}" if used_snapshot_id else ""),
        "created_at": utcnow(),
        "row_count": len(chart.get("rows") or []),
    }


def write_deliverable4_workbook(evaluation_run_id: str) -> Path:
    detail = get_evaluation_run(evaluation_run_id)
    settings = get_settings()
    out_dir = settings.artifact_dir / "evaluation_exports" / evaluation_run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "Deliverable4_Evaluation.xlsx"

    summary = detail.get("summary") or {}
    readiness = summary.get("release_readiness") or {}
    ref = detail.get("reference_payload") or {}
    snap_meta = (detail.get("snapshot") or {}).get("metadata") or {}
    if isinstance(snap_meta, str):
        try:
            snap_meta = json.loads(snap_meta)
        except Exception:  # noqa: BLE001
            snap_meta = {}

    # Load chart rows from snapshot for sheet 2b
    chart_rows: list[dict[str, Any]] = []
    try:
        from .database import connect

        with connect() as connection:
            crow = connection.execute(
                "SELECT chart_json FROM chart_snapshots WHERE id=?",
                (detail["snapshot"]["id"],),
            ).fetchone()
        if crow:
            chart_rows = (json.loads(crow["chart_json"]).get("rows") or [])
    except Exception:  # noqa: BLE001
        chart_rows = []

    row_cases = [c for c in detail.get("cases") or [] if c.get("case_type") == "reference_row"]
    criteria_summary = {
        item.get("criterion_id"): item for item in (summary.get("criteria") or []) if item.get("criterion_id")
    }

    wb = Workbook()

    # 0 Summary
    ws0 = wb.active
    ws0.title = "0 Summary"
    rec = summary.get("release_recommendation") or readiness.get("recommendation") or "Conditional Go — Human Review Required"
    pairs = [
        ("Deliverable 4 — Evaluation & Quality Improvement", None),
        ("Patent", (ref.get("patent") or {}).get("id") or "US10063856B2"),
        ("Claim", 1),
        ("Target standard", (ref.get("recommended_target") or {}).get("edition") or "ITU-T H.265 V10 (07/2024)"),
        ("Reference dataset", f"{detail.get('dataset', {}).get('id')} v{detail.get('dataset', {}).get('version')}"),
        ("Reference status", ref.get("status") or detail.get("dataset", {}).get("status_label")),
        ("Agent chart run", detail.get("run_id")),
        ("Evaluation run", evaluation_run_id),
        ("Snapshot hash", (detail.get("snapshot") or {}).get("chart_hash")),
        ("Alignments confirmed", bool(detail.get("alignments_confirmed"))),
        ("Release recommendation", rec),
        ("Attorney-ready?", "YES" if summary.get("attorney_ready") or readiness.get("attorney_ready") else "NO"),
        ("Critical failures", summary.get("critical_failures") or 0),
        ("High failures", summary.get("high_failures") or 0),
        ("Start mode", "upload_pair" if snap_meta.get("upload_filename") else "chart_run"),
        ("Blocks attorney-ready?", "YES" if not (summary.get("attorney_ready") or readiness.get("attorney_ready")) else "NO"),
    ]
    for row in pairs:
        ws0.append(list(row))

    # 1 Rubric
    ws1 = wb.create_sheet("1 Rubric")
    ws1.append(["Criterion ID", "Name", "What is checked", "Pass (score 1.0)", "Fail (score 0.0)", "Severity if Fail", "Notes"])
    rubric_rows = [
        ("C01", "Right standard", "Selected standard/edition matches the human reference.", "Evidence/target is intended edition.", "Wrong family/edition.", "Critical", "Required"),
        ("C02", "Quote real and verbatim", "Every emitted quote appears in the cited original.", "Quote found on cited PDF page text.", "Mutated/invented quote.", "Critical", "Required"),
        ("C03", "Source and page correct", "Document identity, section, PDF/printed page match.", "Pages correspond.", "Wrong page system/section.", "High", "Required"),
        ("C04", "Screenshot matches quote", "Screenshot/crop linked to cited page.", "Screenshot linked.", "Missing screenshot.", "Medium", "Required"),
        ("C05", "Rationale supports element", "Rationale explains support and gaps.", "Supports label policy.", "Unsupported / contradictions.", "Medium", "Required"),
        ("C06", "Full / Partial / No label correct", "Mapping label matches expected after alignment.", "Labels agree.", "Any aligned label disagrees.", "High", "Required"),
    ]
    for row in rubric_rows:
        ws1.append(list(row))

    # 2 Labelled expected chart
    ws2 = wb.create_sheet("2 Labelled expected chart")
    ws2.append(
        [
            "Claim element ID",
            "Exact claim text",
            "Expected mapping label (Full / Partial / No)",
            "How we decided this label",
            "What is still missing (gaps)",
            "Evidence block number",
            "Evidence ID",
            "Standard edition",
            "Section",
            "Printed page in the standard",
            "PDF file page",
            "Complete expected quote",
            "Screenshot file path",
        ]
    )
    for ref_row in ref.get("rows") or []:
        blocks = ref_row.get("evidence_blocks") or []
        if not blocks:
            blocks = [{"evidence_id": eid} for eid in (ref_row.get("evidence_ids") or [None])]
        total = max(len(blocks), 1)
        for index, block in enumerate(blocks, start=1):
            source = block.get("source") or {}
            ws2.append(
                [
                    ref_row.get("id"),
                    ref_row.get("exact_text"),
                    ref_row.get("mapping_label"),
                    ref_row.get("rationale"),
                    "; ".join(ref_row.get("gaps") or []),
                    f"{index} of {total}",
                    block.get("evidence_id"),
                    source.get("edition") or (ref.get("recommended_target") or {}).get("edition"),
                    block.get("section_label") or block.get("section"),
                    block.get("printed_label") or block.get("printed_page"),
                    block.get("page_ordinal") or block.get("pdf_page"),
                    block.get("quote"),
                    block.get("screenshot_url") or block.get("screenshot_path"),
                ]
            )

    # 2b Agent chart
    ws2b = wb.create_sheet("2b Agent chart (as tested)")
    ws2b.append(
        [
            "Aligned to expected claim element",
            "Agent row id",
            "Agent element label",
            "Agent claim / element text",
            "Agent mapping label",
            "Agent rationale",
            "Evidence block number",
            "Evidence ID (span)",
            "Standard edition",
            "Section",
            "Printed page in the standard",
            "PDF file page",
            "Complete agent quote",
            "Screenshot file path",
        ]
    )
    alignments = {a.get("reference_row_id"): a for a in (detail.get("alignments") or [])}
    gen_to_ref: dict[str, str] = {}
    for a in detail.get("alignments") or []:
        for gid in a.get("generated_element_ids") or []:
            gen_to_ref[gid] = a.get("reference_row_id")
    for row in chart_rows:
        rev = (row.get("revisions") or [{}])[-1]
        blocks = rev.get("evidence_blocks") or []
        if not blocks:
            blocks = [{}]
        total = len(blocks)
        aligned = gen_to_ref.get(row.get("id")) or row.get("aligned_reference_hint") or ""
        for index, block in enumerate(blocks, start=1):
            source = block.get("source") or {}
            ws2b.append(
                [
                    aligned,
                    row.get("id"),
                    row.get("label"),
                    row.get("exact_text"),
                    rev.get("mapping_label"),
                    rev.get("rationale"),
                    f"{index} of {total}",
                    block.get("evidence_id"),
                    source.get("edition"),
                    block.get("section_label"),
                    block.get("printed_label"),
                    block.get("page_ordinal"),
                    block.get("quote"),
                    block.get("screenshot_url"),
                ]
            )

    # 3 Run scores
    ws3 = wb.create_sheet("3 Run scores")
    ws3.append(
        [
            "Claim element ID",
            "Claim text (short)",
            "Aligned agent row id(s)",
            "C01 Right standard",
            "C02 Quote verbatim",
            "C03 Source and page",
            "C04 Screenshot",
            "C05 Rationale",
            "C06 Label (Full/Partial/No)",
            "Specific Audit Notes (all failed criteria: ID, name, and rationale)",
        ]
    )
    pass_counts = {cid: {"pass": 0, "eligible": 0} for cid in CORE}
    for case in row_cases:
        by_id = {c.get("criterion_id"): c for c in case.get("criteria") or []}
        statuses = []
        notes = []
        for cid in CORE:
            crit = by_id.get(cid) or {}
            st = _status(crit)
            statuses.append("Pass" if st == "Pass" else ("Fail" if st in ("Fail", "Error") else st))
            if st in ("Pass", "Fail", "Error"):
                pass_counts[cid]["eligible"] += 1
                if st == "Pass":
                    pass_counts[cid]["pass"] += 1
            if st in ("Fail", "Error"):
                notes.append(f"{cid} {CRITERION_NAMES.get(cid, cid)}: {_reason(crit)}")
        aligned_ids = case.get("generated_element_ids") or []
        ws3.append(
            [
                case.get("reference_row_id") or case.get("case_key"),
                _short(case.get("payload", {}).get("reference_text") or case.get("reference_label") or "", 100),
                ", ".join(aligned_ids),
                *statuses,
                " | ".join(f"({i}) {n}" for i, n in enumerate(notes, start=1))
                if notes
                else "No failed criteria on this claim element.",
            ]
        )

    ws3.append([])
    ws3.append(["Aggregated Results Per Rubric Criterion"])
    ws3.append(["Rubric Criterion", "Pass Count", "Total Rows", "Pass Rate", "Readiness Verdict"])
    ready_fill = PatternFill("solid", fgColor="ECFDF3")
    block_fill = PatternFill("solid", fgColor="FEF3F2")
    for cid in CORE:
        stats = pass_counts[cid]
        # Prefer summary counts when present
        summary_item = criteria_summary.get(cid) or {}
        p = int(summary_item.get("automatic_pass") if summary_item.get("automatic_pass") is not None else stats["pass"])
        e = int(summary_item.get("automatic_eligible") if summary_item.get("automatic_eligible") is not None else stats["eligible"])
        rate = f"{(100.0 * p / e):.1f}%" if e else "—"
        if e and p == e:
            verdict = f"Ready — {CRITERION_NAMES[cid]} passed on all scored claim elements."
            fill = ready_fill
        elif e and p == 0:
            verdict = f"Blocker — {CRITERION_NAMES[cid]} failed on all scored claim elements."
            fill = block_fill
        elif e:
            verdict = f"Watch — {CRITERION_NAMES[cid]} partial ({p}/{e})."
            fill = PatternFill("solid", fgColor="FFFAEB")
        else:
            verdict = "Not scored."
            fill = PatternFill()
        r = [
            f"{cid}: {CRITERION_NAMES[cid]}",
            p,
            e,
            rate,
            verdict,
        ]
        ws3.append(r)
        for col in range(1, 6):
            ws3.cell(ws3.max_row, col).fill = fill
            ws3.cell(ws3.max_row, col).alignment = Alignment(wrap_text=True, vertical="top")

    ws3.append([])
    ws3.append(["Blocks attorney-ready?", "YES" if not (summary.get("attorney_ready") or readiness.get("attorney_ready")) else "NO"])
    ws3.append(["Verdict", rec])

    # 4 Failure modes (compact)
    ws4 = wb.create_sheet("4 Failure modes")
    ws4.append(
        [
            "Rank",
            "Failure Mode Name & Affected Criterion",
            "Root-Cause Mechanism",
            "Concrete Test-Run Example",
            "Actionable Fix",
            "Severity / Why attorney-facing",
            "Verification after fix",
        ]
    )
    actions = detail.get("failure_actions") or summary.get("failure_actions") or []
    observed = [f for f in (summary.get("observed_failures") or []) if f.get("count")]
    top = observed[:3] or actions[:3]
    for rank, item in enumerate(top, start=1):
        if "recommended_fix" in item or "problem" in item:
            ws4.append(
                [
                    rank,
                    f"{item.get('criterion_id')} — {item.get('category') or item.get('failure_mode')}",
                    item.get("problem") or item.get("root_cause_hypothesis") or "",
                    ", ".join(item.get("cases") or []) if isinstance(item.get("cases"), list) else item.get("cases"),
                    item.get("recommended_fix") or "",
                    item.get("severity") or "",
                    "Re-run evaluation on same reference pack.",
                ]
            )
        else:
            ws4.append(
                [
                    rank,
                    f"{item.get('criterion_id') or item.get('name')} (n={item.get('count')})",
                    item.get("name") or item.get("failure_mode") or "",
                    item.get("example") or "",
                    item.get("recommended_action") or "See production plan.",
                    item.get("severity") or "High",
                    "Re-run evaluation; Fail count should drop.",
                ]
            )
    if not top:
        ws4.append([1, "None observed as Hard Fail cluster", "C01–C06 clean or pending", "", "Maintain gates", "Info", ""])

    # 4b detail
    ws4b = wb.create_sheet("4b Failure mode detail")
    ws4b["A1"] = "Failure Mode Analysis — How the agent should run this"
    ws4b["A1"].font = Font(bold=True, size=13)
    rates = []
    for cid in CORE:
        item = criteria_summary.get(cid) or {}
        rates.append(f"{cid} {item.get('automatic_display') or '—'}")
    ws4b["A2"] = (
        "Cluster Specific Audit Notes + Aggregated Results by root cause (not row number); "
        "rank by lowest pass rate and attorney-misleading severity; emit Top 3 with mechanism, example, deterministic fix."
    )
    ws4b["A3"] = "Per-criterion rates"
    ws4b["B3"] = "; ".join(rates)
    ws4b["A5"] = "Open failure actions"
    ws4b.append([])
    ws4b.append(["Failure ID", "Criterion", "Cases", "Category", "Severity", "Problem", "Recommended fix", "Status"])
    for action in actions:
        ws4b.append(
            [
                action.get("id"),
                action.get("criterion_id"),
                ", ".join(action.get("cases") or []) if isinstance(action.get("cases"), list) else action.get("cases"),
                action.get("category") or action.get("failure_mode"),
                action.get("severity"),
                action.get("problem"),
                action.get("recommended_fix"),
                action.get("status"),
            ]
        )

    # 5 Production plan
    ws5 = wb.create_sheet("5 Production plan")
    ws5.append(["Lane", "What we check", "How", "Blocks attorney-ready?"])
    for row in [
        ("Automated", "C01 edition lock", "document_id/family/edition vs pinned target", "Yes — Critical"),
        ("Automated", "C02 verbatim", "Whitespace-normalized substring on cited PDF text", "Yes — Critical"),
        ("Automated", "C03 page/section", "Section + PDF↔printed offset consistency", "Yes — High"),
        ("Automated", "C04/C06 guards", "Screenshot link; block decoder-only Full map; split constraint", "Yes if Critical"),
        ("Expert review", "Partial map / C06 Fail / cite drift / visual crops", "Human adjudication", "Required for Go"),
        ("Regression", "Frozen labelled pack", "Re-eval on prompt/retrieval/LLM change; per-criterion gates", "Gate release"),
        ("Quality gates", "No blended score; reference never in retrieval corpus", "Hard policy", "Hard block"),
    ]:
        ws5.append(list(row))
    ws5.append([])
    ws5.append(["Current recommendation for this run", rec])

    wb.save(path)
    return path


def write_h265_claim_chart_evaluation_xlsx() -> Path:
    """Materialize the locked H.265 Claim Chart evaluation dashboard as XLSX."""
    settings = get_settings()
    out_dir = settings.artifact_dir / "evaluation_exports" / "h265-dashboard"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "H265_Claim_Chart_Evaluation.xlsx"

    criteria = [
        ("C01", "Right Standard & Edition", 8, 8, 100.0, "Ready", "Locked onto H.265 V10 (07/2024)."),
        ("C02", "Quote Real & Verbatim", 8, 8, 100.0, "Ready", "Zero hallucinated text; 100% substring match."),
        ("C03", "Source, Section & Page", 0, 8, 0.0, "Blocker", "+18 PDF page offset bug & missing section IDs."),
        ("C04", "Screenshot Match", 3, 8, 37.5, "Blocker", "Bounding boxes drift or truncate referenced tables."),
        ("C05", "Rationale Supports Element", 0, 8, 0.0, "Blocker", "Confuses CABAC/SEI passages & misreads bounds."),
        ("C06", "Mapping Label Correct", 5, 8, 62.5, "Needs Work", "3 false No-maps; 2 accidental Partial-maps."),
    ]
    rows = [
        ("1[a]", "1[a]", "Partial map", "Partial map", "C03, C04, C05", "Accidental Match / Wrong Citation",
         "Cites Tone Mapping SEI (§D.2.15) instead of §3.53; printed/PDF page mismatch.", "Yes"),
        ("1[b]", "1[b]", "No map", "Partial map", "C03, C04, C05, C06", "False Negative",
         "Retrieves Eq. 8-287/288 but falsely outputs No map; missing section IDs.", "No"),
        ("1[c]", "1[b]", "Partial map", "Partial map", "C03, C04, C05", "Crop & Bounds Error",
         "Screenshot cuts off Table 8-10; claims lower bound 0 is missing.", "Yes"),
        ("1[d]", "1[b]", "No map", "Partial map", "C03, C05, C06", "False Negative",
         "Cites §8.6.2 (actually §7.4.7.1) and misses luma QpY range.", "No"),
        ("1[e]", "1[b]", "Partial map", "Partial map", "C03, C04, C05", "Crop Drift & Self-Contradiction",
         "Screenshot highlights wrong paragraph; contradicts Eq. 8-285 quote.", "Yes"),
        ("1[f]", "1[c]", "No map", "Partial map", "C03, C04, C05, C06", "False Negative",
         "Misses §0.7/§8.6.2 transform passages; cites wrong section headers.", "No"),
        ("1[g]", "1[c]", "Partial map", "Partial map", "C03, C05", "Wrong Equation Cited",
         "Retrieves Eq. 8-287 instead of §8.6.2 Eq. 8-292/293.", "Yes"),
        ("1[h]", "1[c]", "Partial map", "Partial map", "C03, C05", "Accidental Match / Domain Confusion",
         "Confuses CABAC arithmetic quantization (§9.3) with transform quantization.", "Yes"),
    ]

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="0F172A")
    ready_fill = PatternFill("solid", fgColor="D1FAE5")
    needs_fill = PatternFill("solid", fgColor="FEF3C7")
    blocker_fill = PatternFill("solid", fgColor="FEE2E2")

    def style_header(ws) -> None:
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")

    wb = Workbook()

    ws0 = wb.active
    ws0.title = "0 Summary"
    for pair in [
        ("H.265 Claim Chart Evaluation", None),
        ("Source filename", "H265_Claim_Chart_Evaluation.xlsx"),
        ("Patent", "US10063856B2 (Claim 1)"),
        ("Target standard", "ITU-T H.265 V10 (07/2024)"),
        ("Evaluated elements", 8),
        ("Ground-truth compound elements", 3),
        ("Release status", "BLOCKED — NOT READY FOR ATTORNEY REVIEW"),
        ("False Full-Maps", "0 (Safe from Over-Claiming)"),
        ("Blended accuracy score", "Not reported — use per-criterion gates"),
        ("Ready criteria", "C01, C02"),
        ("Blocker criteria", "C03, C04, C05"),
        ("Needs work", "C06"),
    ]:
        ws0.append(list(pair))

    ws1 = wb.create_sheet("1 Scorecard C01-C06")
    ws1.append(["Criterion ID", "Name", "Pass", "Total", "Pass rate %", "Status", "Diagnostic note"])
    style_header(ws1)
    for row in criteria:
        ws1.append(list(row))
        status_cell = ws1.cell(ws1.max_row, 6)
        if row[5] == "Ready":
            status_cell.fill = ready_fill
        elif row[5] == "Needs Work":
            status_cell.fill = needs_fill
        else:
            status_cell.fill = blocker_fill

    ws2 = wb.create_sheet("2 Failure modes")
    ws2.append(["Failure mode", "Count", "Total", "Share %"])
    style_header(ws2)
    for label, count, total in [
        ("Page/Section Metadata Errors", 8, 8),
        ("Technical Retrieval/Rationale Errors", 8, 8),
        ("Screenshot Bounding-Box Drift", 5, 8),
        ("False Negative Labels", 3, 8),
    ]:
        ws2.append([label, count, total, round(100 * count / total, 1)])

    ws3 = wb.create_sheet("3 Label alignment")
    ws3.append(["Bucket", "Count", "Notes"])
    style_header(ws3)
    for row in [
        ("Ground truth", 8, "All 8 aligned to Partial map"),
        ("Valid Partial", 3, "Agent label matches expected Partial map without accidental citation"),
        ("Accidental Partial", 2, "Partial map with wrong citation / domain confusion"),
        ("False No-Map", 3, "Expected Partial map; agent emitted No map"),
        ("False Full-Map", 0, "Safe from over-claiming"),
    ]:
        ws3.append(list(row))

    ws4 = wb.create_sheet("4 Row triage")
    ws4.append(
        [
            "Element ID",
            "Aligned Ref",
            "Agent label",
            "Expected label",
            "Failed criteria",
            "Root cause",
            "Audit note",
            "Needs attorney review",
        ]
    )
    style_header(ws4)
    for row in rows:
        ws4.append(list(row))

    wb.save(path)
    return path

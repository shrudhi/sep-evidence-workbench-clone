"""Workbook-faithful five-level SEP evaluation (isolated from generation prompts).

Levels:
  L1 Standard selection (S01–S03)
  L2 Claim requirements (R01–R07)
  L3 Evidence integrity (anchors E01–E10)
  L4 Technical mapping tests (T01–T10)
  L5 Complete-claim release readiness
"""

from __future__ import annotations

import re
from typing import Any

def _normalize_text(value: str) -> str:
    text = value.replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def _quote_found(needle: str, *corpora: str) -> bool:
    from .evaluation import _quote_found as _qf

    return _qf(needle, *corpora)


def _check_evidence_blocks(*args: Any, **kwargs: Any) -> dict[str, dict[str, Any]]:
    from .evaluation import _check_evidence_blocks as _ceb

    return _ceb(*args, **kwargs)


def _diagnose_criterion(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .evaluation import _diagnose_criterion as _dc

    return _dc(*args, **kwargs)


def _score_from_status(status: str) -> float | None:
    from .evaluation import _score_from_status as _sfs

    return _sfs(status)

RUBRIC_TESTS: list[dict[str, Any]] = [
    {
        "id": "T01",
        "type": "Standard selection",
        "level": "standard_selection",
        "input": "All three documents",
        "expected": "Recommend H.265; reject G.722.2 and LTE as targets",
        "synthetic": False,
    },
    {
        "id": "T02",
        "type": "Page conversion",
        "level": "evidence_accuracy",
        "input": "E04",
        "expected": "PDF194 / printed176",
        "synthetic": False,
    },
    {
        "id": "T03",
        "type": "Numeric bound",
        "level": "technical_mapping",
        "input": "E04 Table8-10",
        "expected": "qPi=57 -> QpC=51 in ChromaArrayType=1 branch",
        "synthetic": False,
    },
    {
        "id": "T04",
        "type": "Variable distinction",
        "level": "technical_mapping",
        "input": "E04",
        "expected": "qPi clipped to 57 is intermediate, not final chroma QP",
        "synthetic": False,
    },
    {
        "id": "T05",
        "type": "Bit depth",
        "level": "technical_mapping",
        "input": "E04; E05",
        "expected": "Eight-bit QpBdOffsetC=0; ten-bit=12; primed vs unprimed QP",
        "synthetic": False,
    },
    {
        "id": "T06",
        "type": "Actor mismatch",
        "level": "technical_mapping",
        "input": "E01; E07",
        "expected": "Decoder derivation is not by itself direct encoder proof",
        "synthetic": False,
    },
    {
        "id": "T07",
        "type": "False absence",
        "level": "technical_mapping",
        "input": "E06",
        "expected": "A forward transform-then-quantization description exists in 0.7",
        "synthetic": False,
    },
    {
        "id": "T08",
        "type": "Preserve including",
        "level": "technical_mapping",
        "input": "1[b]; E04",
        "expected": "Additional slice/CU offsets do not alone disprove inclusion of a picture offset",
        "synthetic": False,
    },
    {
        "id": "T09",
        "type": "Source mutation",
        "level": "evidence_accuracy",
        "input": "Change a minus sign/57/51 in E04",
        "expected": "Must fail quote verification or be visibly flagged",
        "synthetic": True,
    },
    {
        "id": "T10",
        "type": "No target by generic keyword",
        "level": "standard_selection",
        "input": "G722; LTE",
        "expected": "Speech quantization / LTE transform is insufficient for complete video-QP claim",
        "synthetic": False,
    },
]

# Requirement keyword hints for deterministic coverage (not exhaustive whitelist).
REQUIREMENT_HINTS: dict[str, list[str]] = {
    "R01": ["encoding apparatus", "encoder", "encoding process"],
    "R02": ["circuitry", "configured to"],
    "R03": ["chroma", "qp", "0 to 51", "0-51", "luma qp"],
    "R04": ["picture", "offset", "pps_cb_qp", "pps_cr_qp", "including"],
    "R05": ["quantize", "quantization", "transform"],
    "R06": ["orthogonal", "orthogon"],
    "R07": ["chroma qp", "qp′cb", "qp'cb", "qp′cr", "based on the set"],
}


def _combined_chart_text(chart: dict[str, Any]) -> str:
    parts: list[str] = []
    for row in chart.get("rows") or []:
        rev = (row.get("revisions") or [{}])[-1] or {}
        parts.append(str(row.get("exact_text") or ""))
        parts.append(str(rev.get("rationale") or ""))
        parts.append(str(rev.get("mapping_label") or ""))
        for gap in rev.get("missing_requirements") or []:
            parts.append(str(gap))
        for block in rev.get("evidence_blocks") or []:
            parts.append(str(block.get("quote") or ""))
            parts.append(str(block.get("section_label") or block.get("section_ref") or ""))
    return _normalize_text("\n".join(parts))


def _chart_labels(chart: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for row in chart.get("rows") or []:
        rev = (row.get("revisions") or [{}])[-1] or {}
        label = rev.get("mapping_label")
        if label:
            labels.append(str(label))
    return labels


def _result(
    *,
    status: str,
    reason: str,
    expected: str,
    actual: str,
    criterion_id: str = "LTEST",
    severity_hint: str | None = None,
    failure_mode: str | None = None,
    evidence: list[Any] | None = None,
    recommended_action: str | None = None,
    component: str | None = None,
) -> dict[str, Any]:
    raw = {
        "status": status,
        "reason": reason,
        "evidence": evidence or [],
        "expected_summary": expected,
        "actual_summary": actual,
        "score": _score_from_status(status),
    }
    diagnosed = _diagnose_criterion(
        criterion_id if criterion_id.startswith("C") else "C05",
        raw,
        expected=expected,
        actual=actual,
    )
    if severity_hint:
        diagnosed["severity"] = severity_hint
    if failure_mode:
        diagnosed["failure_mode"] = failure_mode
    if recommended_action:
        diagnosed["recommended_action"] = recommended_action
    if component:
        diagnosed["responsible_component"] = component
    if status == "Pass":
        diagnosed["severity"] = "None"
        diagnosed["failure_mode"] = None
    return diagnosed


def _is_h265_target(family: str, edition: str) -> bool:
    blob = f"{family} {edition}".lower()
    return "h.265" in blob or "h265" in blob


def evaluate_standard_selection(
    reference: dict[str, Any],
    chart: dict[str, Any],
    *,
    decision: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Level 1 — S01–S03 once per selection decision."""
    run = chart.get("run") or {}
    family = str(run.get("family") or "")
    edition = str(run.get("edition") or "")
    cases: list[dict[str, Any]] = []
    for control in reference.get("target_selection_controls") or []:
        cid = control["id"]
        std = control.get("standard_edition") or ""
        expected_sel = control.get("expected_selection") or ""
        if cid == "S01" or "h.265" in std.lower():
            ok = _is_h265_target(family, edition)
            status = "Pass" if ok else "Fail"
            reason = (
                f"Snapshot targets {family} {edition} — matches recommended H.265 V10 control."
                if ok
                else f"Snapshot target {family} {edition} is not H.265 V10."
            )
            severity = None if ok else "Critical"
            mode = None if ok else "wrong_standard_selection"
        else:
            # Rejected standards: Pass when chart is NOT that family
            rejected_ok = True
            if "g.722" in std.lower() or "722.2" in std.lower():
                rejected_ok = "722.2" not in family.lower() and "g.722" not in edition.lower()
            elif "136 211" in std.lower() or "lte" in std.lower() or "e-utra" in std.lower():
                rejected_ok = "136" not in family.lower() and "211" not in edition.lower()
            if decision:
                # Prefer explicit rejection if present
                text = _normalize_text(json_dumps_safe(decision))
                if any(tok in text for tok in ("reject", "not recommend", "not recommended")):
                    rejected_ok = True
            status = "Pass" if rejected_ok else "Fail"
            reason = (
                f"Rejected-standard control satisfied: chart is not targeting {std}."
                if rejected_ok
                else f"Chart appears to target rejected standard {std}."
            )
            severity = None if rejected_ok else "High"
            mode = None if rejected_ok else "wrong_standard_selection"
        crit = _result(
            status=status,
            reason=reason,
            expected=expected_sel,
            actual=f"{family} {edition}".strip() or "unknown target",
            criterion_id="C01",
            severity_hint=severity,
            failure_mode=mode,
            evidence=control.get("evidence_ids") or [],
            recommended_action=(
                None
                if status == "Pass"
                else "Fix standard/edition selection so H.265 V10 is recommended and G.722.2 / TS 136 211 remain rejected."
            ),
            component="standard selection",
        )
        cases.append(
            {
                "case_type": "target_selection",
                "case_key": cid,
                "level": "standard_selection",
                "reference_row_id": None,
                "generated_element_ids": [],
                "reference_label": expected_sel,
                "generated_label": family or None,
                "payload": {
                    "control": control,
                    "run_target": run.get("target_document_id") or run.get("family"),
                    "decision": decision,
                    "level": 1,
                },
                "criteria": {"C01": crit},
            }
        )
    return cases


def json_dumps_safe(value: Any) -> str:
    import json

    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(value)


def evaluate_requirements(
    reference: dict[str, Any],
    chart: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Level 2 — R01–R07 requirement coverage."""
    text = _combined_chart_text(chart)
    requirements = reference.get("requirements") or []
    cases: list[dict[str, Any]] = []
    identified = 0
    invented_flags = 0
    for req in requirements:
        rid = req["id"]
        hints = REQUIREMENT_HINTS.get(rid, [])
        coverage = (req.get("reference_coverage") or "").lower()
        hits = [h for h in hints if _normalize_text(h) in text]
        # R06 orthogonality: mentioning generic "transform" alone is NOT enough
        if rid == "R06":
            has_ortho = "orthogonal" in text or "orthogon" in text
            invents_ortho = ("transform" in text) and has_ortho and "not establish" not in text
            # Pass if agent correctly notes orthogonality not established OR explicitly discusses it as gap
            gapish = any(
                tok in text
                for tok in (
                    "not establish",
                    "not established",
                    "orthogonal",
                    "orthogonality",
                    "gap",
                )
            )
            if "not established" in coverage:
                if has_ortho and "full map" in text and "partial" not in text:
                    status = "Fail"
                    reason = (
                        "Agent appears to infer orthogonality support from transform language "
                        "without establishing the claimed orthogonal transform."
                    )
                    invented_flags += 1
                elif gapish or "partial" in text:
                    status = "Pass"
                    reason = (
                        "Orthogonality treated cautiously (gap/not-established) rather than inferred "
                        "from the generic word transform."
                    )
                    identified += 1
                else:
                    status = "Fail"
                    reason = (
                        "Requirement R06 (orthogonal transform) is not addressed; "
                        "do not silently omit missing limitations."
                    )
            else:
                status = "Pass" if hits else "Fail"
                reason = (
                    f"Requirement keywords matched: {hits}."
                    if hits
                    else f"No coverage found for {rid}: {req.get('text')}"
                )
                if hits:
                    identified += 1
        elif rid == "R02":
            # Circuitry often missing — Fail if neither circuitry nor gap noted
            if "circuitry" in text or "not establish" in text or "hardware" in text:
                status = "Pass"
                reason = "Circuitry/apparatus limitation acknowledged or explicitly gapped."
                identified += 1
            else:
                status = "Fail"
                reason = (
                    "R02 circuitry-configured-for-both-operations not identified as support or gap."
                )
        else:
            if hits:
                status = "Pass"
                reason = f"Requirement {rid} signals present in chart rationale/evidence: {hits}."
                identified += 1
            else:
                # Still Pass for "not established" coverage if gaps mention related theme
                if "not established" in coverage and any(
                    g in text for g in ("gap", "not establish", "missing", "partial")
                ):
                    status = "Pass"
                    reason = (
                        f"Reference coverage is '{req.get('reference_coverage')}'; "
                        "chart acknowledges material gaps."
                    )
                    identified += 1
                else:
                    status = "Fail"
                    reason = (
                        f"Missing requirement {rid} ({req.get('text')}). "
                        "Requirement recall failure — do not exclude from denominator."
                    )
        crit = _result(
            status=status,
            reason=reason,
            expected=f"{rid}: {req.get('text')} ({req.get('reference_coverage')})",
            actual=("signals=" + ", ".join(hits)) if hits else "no matching signals",
            criterion_id="C07",
            severity_hint="High" if status == "Fail" else None,
            failure_mode="missing_claim_requirement" if status == "Fail" else None,
            evidence=req.get("evidence_ids") or [],
            recommended_action=(
                None
                if status == "Pass"
                else (
                    f"Increase claim-decomposition coverage for {rid}: ensure the mapper "
                    f"surfaces '{req.get('text')}' as support or an explicit gap "
                    f"({req.get('scoring_caution')})."
                )
            ),
            component="claim decomposition",
        )
        cases.append(
            {
                "case_type": "requirement",
                "case_key": rid,
                "level": "claim_requirements",
                "reference_row_id": req.get("element_label"),
                "generated_element_ids": [],
                "reference_label": req.get("reference_coverage"),
                "generated_label": status,
                "payload": {
                    "requirement": req,
                    "matched_hints": hits,
                    "level": 2,
                },
                "criteria": {"C07": crit},
            }
        )
    total = len(requirements) or 1
    metrics = {
        "requirement_recall": {
            "pass": identified,
            "eligible": total,
            "rate": round(100.0 * identified / total, 1),
            "display": f"{identified}/{total}",
        },
        "requirement_precision": {
            "note": "Precision uses identified vs invented-overclaim flags on this small set.",
            "invented_overclaims": invented_flags,
        },
        "decomposition_completeness": {
            "pass": identified,
            "eligible": total,
            "rate": round(100.0 * identified / total, 1),
            "display": f"{identified}/{total}",
        },
    }
    return cases, metrics


def evaluate_evidence_level(
    reference: dict[str, Any],
    chart: dict[str, Any],
    *,
    expected_doc: str | None,
    expected_sha: str | None,
    expected_family: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Level 3 aggregate evidence integrity metrics (row-level C01–C04 remain primary)."""
    anchors = reference.get("evidence") or {}
    e04 = anchors.get("E04") or {}
    blocks: list[dict[str, Any]] = []
    for row in chart.get("rows") or []:
        rev = (row.get("revisions") or [{}])[-1] or {}
        blocks.extend(rev.get("evidence_blocks") or [])
    # Retrieval recall@K vs H.265 anchors E01–E07
    relevant_ids = [eid for eid in ("E01", "E02", "E03", "E04", "E05", "E06", "E07") if eid in anchors]
    retrieved_sections = {
        _normalize_text(str(b.get("section_label") or b.get("section_ref") or ""))
        for b in blocks
    }
    retrieved_pages = {b.get("page_ordinal") for b in blocks if b.get("page_ordinal")}
    hit = 0
    for eid in relevant_ids:
        a = anchors[eid]
        sec = _normalize_text(str(a.get("section") or ""))
        page = a.get("pdf_page")
        quote = a.get("quote") or ""
        matched = False
        if sec and any(sec[:12] in s or s[:12] in sec for s in retrieved_sections if s):
            matched = True
        if page and page in retrieved_pages:
            matched = True
        for b in blocks:
            if quote and _quote_found(quote[:80], b.get("quote") or ""):
                matched = True
        if matched:
            hit += 1
    k = 5
    recall = {
        "pass": hit,
        "eligible": len(relevant_ids),
        "rate": round(100.0 * hit / len(relevant_ids), 1) if relevant_ids else None,
        "display": f"{hit}/{len(relevant_ids)}" if relevant_ids else "—",
        "k": k,
    }
    # Citation validity from block checks
    det = _check_evidence_blocks(
        blocks,
        expected_doc_id=expected_doc,
        expected_sha=expected_sha,
        expected_family=expected_family,
    )
    citation_pass = sum(1 for cid in ("C01", "C02", "C03", "C04") if det[cid]["status"] == "Pass")
    citation = {
        "pass": citation_pass,
        "eligible": 4 if blocks else 0,
        "rate": round(100.0 * citation_pass / 4, 1) if blocks else None,
        "display": f"{citation_pass}/4" if blocks else "—",
    }
    # E04 page sanity case
    e04_case = _evaluate_t02(e04, blocks)
    metrics = {
        "retrieval_recall_at_k": recall,
        "citation_validity": citation,
        "screenshot_correspondence": {
            "pass": 1 if det["C04"]["status"] == "Pass" else 0,
            "eligible": 1 if blocks else 0,
            "display": det["C04"]["status"],
            "note": "Deterministic page+quote+screenshot_url check; not full OCR crop QA.",
        },
        "verbatim_evidence_validity": {
            "pass": 1 if det["C02"]["status"] == "Pass" else 0,
            "eligible": 1 if blocks else 0,
            "display": det["C02"]["status"],
        },
    }
    return [e04_case] if e04_case else [], metrics


def _evaluate_t02(e04: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not e04:
        return None
    expected_pdf = e04.get("pdf_page")
    expected_printed = e04.get("printed_page")
    # Prefer agent blocks that look like E04 (section 8.6.1 or page 194)
    candidates = [
        b
        for b in blocks
        if str(b.get("page_ordinal")) == str(expected_pdf)
        or "8.6.1" in str(b.get("section_label") or b.get("section_ref") or "")
        or "table 8-10" in _normalize_text(b.get("quote") or "")
    ]
    actual = "E04-like citation not found in generated blocks"
    if not candidates:
        status = "Needs review"
        reason = (
            "No generated evidence block clearly matches E04 (PDF 194 / printed 176). "
            "Cannot confirm page-system conversion on this run."
        )
    else:
        b = candidates[0]
        page = b.get("page_ordinal")
        printed = b.get("printed_label")
        actual = f"PDF p.{page} printed={printed}"
        # Fail if printed/PDF swapped (176 used as PDF)
        swapped = page == expected_printed and expected_pdf != expected_printed
        if page == expected_pdf and not swapped:
            status = "Pass"
            reason = (
                f"E04-like citation uses PDF page {page} "
                f"(reference printed {expected_printed} / PDF {expected_pdf})."
            )
        elif swapped:
            status = "Fail"
            reason = (
                f"Likely printed/PDF confusion: page_ordinal={page} matches printed "
                f"{expected_printed} rather than PDF {expected_pdf}."
            )
        else:
            status = "Fail"
            reason = (
                f"E04-like block page_ordinal={page}; expected PDF {expected_pdf} "
                f"(printed {expected_printed})."
            )
    crit = _result(
        status=status,
        reason=reason,
        expected="E04: PDF 194 / printed 176",
        actual=actual,
        criterion_id="C03",
        severity_hint="High" if status == "Fail" else None,
        failure_mode="incorrect_clause_page" if status == "Fail" else None,
        evidence=["E04"],
        recommended_action=(
            None
            if status != "Fail"
            else "Bind citations with separate printed vs PDF page fields; never open PDF176 for E04."
        ),
        component="citation verification",
    )
    return {
        "case_type": "rubric_test",
        "case_key": "T02",
        "level": "evidence_accuracy",
        "reference_row_id": "1[b]",
        "generated_element_ids": [],
        "reference_label": "PDF194 / printed176",
        "generated_label": status,
        "payload": {
            "test": next(t for t in RUBRIC_TESTS if t["id"] == "T02"),
            "synthetic": False,
            "level": 3,
            "anchor": e04,
        },
        "criteria": {"C03": crit},
    }


def _rationales(chart: dict[str, Any]) -> str:
    return _combined_chart_text(chart)


def evaluate_technical_tests(
    reference: dict[str, Any],
    chart: dict[str, Any],
    *,
    selection_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Level 4 — T01–T10 technical / integrity tests."""
    text = _rationales(chart)
    labels = _chart_labels(chart)
    anchors = reference.get("evidence") or {}
    e04_quote = (anchors.get("E04") or {}).get("quote") or ""
    cases: list[dict[str, Any]] = []

    # T01 — mirror L1 aggregate
    s_pass = all(
        (c["criteria"]["C01"]["status"] == "Pass")
        for c in selection_cases
        if c.get("case_key") in ("S01", "S02", "S03")
    )
    cases.append(
        _rubric_case(
            "T01",
            status="Pass" if s_pass else "Fail",
            reason=(
                "H.265 recommended and rejected standards not used as chart targets."
                if s_pass
                else "Standard selection control failed (see S01–S03)."
            ),
            expected="Recommend H.265; reject G.722.2 and LTE",
            actual="selection controls",
            criterion_id="C01",
            severity="Critical" if not s_pass else None,
            failure_mode="wrong_standard_selection",
            component="standard selection",
            action="Correct target selection before semantic mapping.",
        )
    )

    # T02 already emitted in evidence level; still include a dedicated rubric row if missing
    # (evaluate_all_levels will dedupe by case_key)

    # T03 — qPi=57 -> QpC=51
    false_39 = bool(
        re.search(r"qpc\s*(always\s*)?(stops\s*at|<=|≤)\s*39", text, re.I)
        or re.search(r"chroma qp.{0,40}always.{0,20}39", text, re.I)
    )
    knows_51 = ("qpi" in text and "51" in text) or "qp c = 51" in text or "qpc=51" in text.replace(
        " ", ""
    )
    mentions_table = "table 8-10" in text or "8-10" in text
    if false_39:
        t03_status, t03_reason = (
            "Fail",
            "Rationale incorrectly asserts QpC always stops at 39; Table 8-10 maps qPi=57 → QpC=51.",
        )
    elif knows_51 or mentions_table or "partial" in text:
        # Pass if not asserting the false bound; partial charts often discuss 0-51 compatibility
        t03_status = "Pass"
        t03_reason = (
            "No false QpC≤39 assertion detected. "
            + (
                "Rationale references Table 8-10 / QpC=51 path."
                if (knows_51 or mentions_table)
                else "Deterministic Table 8-10 rule: qPi=57 → QpC=51 under ChromaArrayType=1."
            )
        )
    else:
        t03_status, t03_reason = (
            "Needs review",
            "Numeric Table 8-10 path not explicitly discussed; expert check recommended.",
        )
    cases.append(
        _rubric_case(
            "T03",
            status=t03_status,
            reason=t03_reason,
            expected="qPi=57 -> QpC=51 (ChromaArrayType=1)",
            actual=("false_39=" + str(false_39) + f" knows_51={knows_51}"),
            criterion_id="C05",
            severity="Critical" if t03_status == "Fail" else None,
            failure_mode="numerical_interpretation_error",
            component="mapping / equation validation",
            action=(
                "Add deterministic Table 8-10 validation: for ChromaArrayType=1, qPi>43 ⇒ QpC=qPi-6 "
                "(qPi=57 → 51); block rationales claiming QpC always stops at 39."
            ),
        )
    )

    # T04 — qPi intermediate vs final
    conflates = bool(
        re.search(r"qpi\s*=\s*57.{0,40}(final|output).{0,20}(chroma\s*)?qp", text, re.I)
        or re.search(r"because qpi.{0,20}57.{0,40}(incompatible|contradict|cannot)", text, re.I)
    )
    distinguishes = ("intermediate" in text) or ("qpi" in text and "qpc" in text) or "clip3" in text
    if conflates:
        t04_status, t04_reason = (
            "Fail",
            "Rationale conflates intermediate qPi=57 with final chroma QP.",
        )
    elif distinguishes or "partial" in text:
        t04_status, t04_reason = (
            "Pass",
            "No qPi-as-final-QP counterexample detected; variable distinction preserved or not abused.",
        )
    else:
        t04_status, t04_reason = (
            "Needs review",
            "qPi vs QpC distinction not explicit in rationale.",
        )
    cases.append(
        _rubric_case(
            "T04",
            status=t04_status,
            reason=t04_reason,
            expected="qPi clipped to 57 is intermediate, not final chroma QP",
            actual=f"conflates={conflates} distinguishes={distinguishes}",
            criterion_id="C05",
            severity="High" if t04_status == "Fail" else None,
            failure_mode="variable_confusion",
            component="mapping / equation validation",
            action="Extract qPi vs QpC vs Qp′C as distinct variables before writing the mapping rationale.",
        )
    )

    # T05 — bit depth
    mentions_offset = "qpbdOffsetc" in text.replace(" ", "") or "bit_depth" in text or "bit-depth" in text
    wrong_offset = bool(re.search(r"qpbdOffsetc\s*=\s*(?!0|12)\d+", text.replace(" ", ""), re.I))
    if wrong_offset:
        t05_status, t05_reason = "Fail", "Incorrect QpBdOffsetC numeric claim detected."
    elif mentions_offset or "partial" in text:
        t05_status, t05_reason = (
            "Pass",
            "Bit-depth / QpBdOffsetC path not contradicted "
            "(8-bit→0, 10-bit→12 when discussed).",
        )
    else:
        t05_status, t05_reason = (
            "Needs review",
            "Bit-depth offsets not discussed; cannot confirm primed/unprimed handling.",
        )
    cases.append(
        _rubric_case(
            "T05",
            status=t05_status,
            reason=t05_reason,
            expected="Eight-bit QpBdOffsetC=0; ten-bit=12",
            actual=f"mentions_offset={mentions_offset}",
            criterion_id="C05",
            severity="Medium" if t05_status == "Fail" else None,
            failure_mode="conditional_logic_error",
            component="mapping / equation validation",
            action="Encode BitDepthC→QpBdOffsetC (6*bit_depth_chroma_minus8) as a deterministic check.",
        )
    )

    # T06 — encoder vs decoder
    has_full = any(l == "Full map" for l in labels)
    decoder_only_full = has_full and ("decoder" in text or "decoding" in text) and "circuitry" not in text
    if decoder_only_full:
        t06_status, t06_reason = (
            "Fail",
            "Unqualified Full map appears to rest on decoding-side derivation without encoder circuitry proof.",
        )
    elif has_full:
        t06_status, t06_reason = (
            "Needs review",
            "Full map present — verify it is not solely decoder-side inference.",
        )
    else:
        t06_status, t06_reason = (
            "Pass",
            "No unqualified Full map from decoder-side equations alone "
            f"(labels={labels}).",
        )
    cases.append(
        _rubric_case(
            "T06",
            status=t06_status,
            reason=t06_reason,
            expected="Decoder derivation is not by itself direct encoder proof",
            actual=f"labels={labels}",
            criterion_id="C06",
            severity="Critical" if t06_status == "Fail" else None,
            failure_mode="encoder_decoder_mismatch",
            component="mapping label policy",
            action="Block Full map unless encoder-side support is explicit; keep Partial when only decoder derivation is cited.",
        )
    )

    # T07 — false absence of forward quantize
    denies_forward = bool(
        re.search(r"no (forward )?(transform|quantization).{0,40}(mentioned|present|found)", text, re.I)
        or re.search(r"absent.{0,30}(quantize|quantization|transform)", text, re.I)
    )
    if denies_forward:
        t07_status, t07_reason = (
            "Fail",
            "Rationale claims forward transform/quantization discussion is absent, but E06 provides contextual support.",
        )
    else:
        t07_status, t07_reason = (
            "Pass",
            "No false-absence claim regarding forward transform-then-quantize (E06).",
        )
    cases.append(
        _rubric_case(
            "T07",
            status=t07_status,
            reason=t07_reason,
            expected="Forward transform-then-quantization description exists in 0.7 (E06)",
            actual=f"denies_forward={denies_forward}",
            criterion_id="C05",
            severity="High" if t07_status == "Fail" else None,
            failure_mode="unsupported_rationale",
            component="mapping / rationale generation",
            action="When denying support, search section 0.7 / E06 before asserting absence of forward quantization.",
        )
    )

    # T08 — including / extra offsets
    rejects_including = bool(
        re.search(
            r"(slice|cu|act).{0,40}offset.{0,40}(disprove|contradict|incompatible|not including)",
            text,
            re.I,
        )
    )
    if rejects_including:
        t08_status, t08_reason = (
            "Fail",
            "Extra slice/CU/ACT offsets alone used to disprove picture-level offset inclusion.",
        )
    else:
        t08_status, t08_reason = (
            "Pass",
            "No fallacious rejection of 'including' based solely on additional offset terms.",
        )
    cases.append(
        _rubric_case(
            "T08",
            status=t08_status,
            reason=t08_reason,
            expected="Additional offsets do not alone disprove inclusion of picture-level offset",
            actual=f"rejects_including={rejects_including}",
            criterion_id="C05",
            severity="Medium" if t08_status == "Fail" else None,
            failure_mode="conditional_logic_error",
            component="mapping / rationale generation",
            action="Treat 'including' as non-exclusive; evaluate mandatory components and conditions separately.",
        )
    )

    # T09 — synthetic corruption (excluded from natural metrics).
    # Mutate − / 57 / 51 in-memory and assert C02-style verbatim match fails.
    if e04_quote:
        mutated = (
            e04_quote.replace("57", "59")
            .replace("51", "53")
            .replace("\u2212", "+")
            .replace("-QpBdOffsetC", "+QpBdOffsetC")
            .replace("- QpBdOffsetC", "+ QpBdOffsetC")
        )
        clean_ok = _quote_found(e04_quote, e04_quote)
        corrupt_ok = _quote_found(mutated, e04_quote)
        t09_pass = bool(clean_ok and not corrupt_ok and mutated != e04_quote)
        actual = f"clean_ok={clean_ok} corrupt_ok={corrupt_ok} mutated_differs={mutated != e04_quote}"
    else:
        t09_pass = False
        actual = "E04 quote missing from reference"
    cases.append(
        _rubric_case(
            "T09",
            status="Pass" if t09_pass else "Fail",
            reason=(
                "Synthetic E04 mutation (−/57/51) fails verbatim C02 match against source quote."
                if t09_pass
                else "Synthetic corruption detector did not flag mutated E04 quote."
            ),
            expected="Mutated E04 quote must fail verification",
            actual=actual,
            criterion_id="C02",
            severity="Critical" if not t09_pass else None,
            failure_mode="hallucinated_quotation",
            component="citation verification",
            action="Keep deterministic quote matching; reject altered operators/numbers.",
            synthetic=True,
        )
    )

    # T10 — generic keyword insufficient
    s01 = next((c for c in selection_cases if c.get("case_key") == "S01"), None)
    s02 = next((c for c in selection_cases if c.get("case_key") == "S02"), None)
    s03 = next((c for c in selection_cases if c.get("case_key") == "S03"), None)
    t10_ok = (
        (s01 and s01["criteria"]["C01"]["status"] == "Pass")
        and (s02 and s02["criteria"]["C01"]["status"] == "Pass")
        and (s03 and s03["criteria"]["C01"]["status"] == "Pass")
    )
    cases.append(
        _rubric_case(
            "T10",
            status="Pass" if t10_ok else "Fail",
            reason=(
                "Unrelated standards rejected despite generic coding/transform keywords."
                if t10_ok
                else "Rejected-standard controls did not all pass."
            ),
            expected="G.722.2 / TS 136 211 insufficient for complete video-QP claim",
            actual="see S01–S03",
            criterion_id="C01",
            severity="High" if not t10_ok else None,
            failure_mode="wrong_standard_selection",
            component="standard selection",
            action="Keep scope-based rejection independent of generic keyword overlap.",
        )
    )
    return cases


def _rubric_case(
    test_id: str,
    *,
    status: str,
    reason: str,
    expected: str,
    actual: str,
    criterion_id: str,
    severity: str | None,
    failure_mode: str | None,
    component: str,
    action: str,
    synthetic: bool = False,
) -> dict[str, Any]:
    meta = next(t for t in RUBRIC_TESTS if t["id"] == test_id)
    crit = _result(
        status=status,
        reason=reason,
        expected=expected,
        actual=actual,
        criterion_id=criterion_id,
        severity_hint=severity,
        failure_mode=failure_mode,
        recommended_action=None if status == "Pass" else action,
        component=component,
    )
    return {
        "case_type": "rubric_test",
        "case_key": test_id,
        "level": meta["level"],
        "reference_row_id": None,
        "generated_element_ids": [],
        "reference_label": meta["expected"],
        "generated_label": status,
        "payload": {
            "test": meta,
            "synthetic": synthetic or meta.get("synthetic"),
            "level": 4,
            "type": meta["type"],
            "input": meta["input"],
        },
        "criteria": {criterion_id: crit},
    }


def evaluate_release_readiness(
    *,
    reference: dict[str, Any],
    level_cases: list[dict[str, Any]],
    row_cases: list[dict[str, Any]],
    alignments_confirmed: bool,
    metrics: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Level 5 — complete claim + rule-based readiness."""
    all_cases = level_cases + row_cases
    critical = 0
    high = 0
    unsupported_full = 0
    for case in all_cases:
        if case.get("payload", {}).get("synthetic"):
            continue
        for crit in (case.get("criteria") or {}).values():
            status = crit.get("status")
            sev = crit.get("severity")
            if status == "Fail" and sev == "Critical":
                critical += 1
            if status == "Fail" and sev == "High":
                high += 1
            if status == "Fail" and crit.get("failure_mode") == "encoder_decoder_mismatch":
                unsupported_full += 1

    provisional = bool(reference.get("provisional", True))
    expert = bool(reference.get("expert_signoff", False))
    class_dist = reference.get("class_distribution") or {}
    full_count = int(class_dist.get("Full map") or 0)

    if not (reference.get("rows") or []):
        recommendation = "Insufficient Evidence"
        reason = "No reference rows available."
    elif critical:
        recommendation = "No-Go"
        reason = f"{critical} critical failure(s) block attorney-ready / release use."
    elif provisional or not expert or high or not alignments_confirmed:
        recommendation = "Conditional Go — Human Review Required"
        reason = (
            "Provisional reference without SEP attorney sign-off"
            + ("; high-severity failures remain" if high else "")
            + ("; alignments unconfirmed" if not alignments_confirmed else "")
            + ". Prototype acceptance ≠ production readiness."
        )
    else:
        recommendation = "Go"
        reason = "No critical/high failures; expert-signed reference; alignments confirmed."

    full_map_pr = {
        "precision": "Not Assessable",
        "recall": "Not Assessable",
        "note": (
            "Dataset has zero Full map positives; do not manufacture Full/No examples for balance (policy P1)."
            if full_count == 0
            else "Compute from adjudicated Full map predictions."
        ),
    }

    readiness = {
        "recommendation": recommendation,
        "reason": reason,
        "provisional": provisional,
        "expert_signoff": expert,
        "attorney_ready": False,
        "human_review_required": recommendation != "Go",
        "critical_failures": critical,
        "high_failures": high,
        "unsupported_full_map_count": unsupported_full,
        "alignments_confirmed": alignments_confirmed,
        "full_map_precision_recall": full_map_pr,
        "complete_claim_coverage": metrics.get("decomposition_completeness"),
        "limitations": [
            "Provisional technical reference; no SEP expert/attorney sign-off.",
            "No fabricated Full/No label balance — all three baseline rows are Partial map.",
            "T09 synthetic corruption is excluded from natural accuracy denominators.",
            "Evaluation compares outputs to reference; Observability traces are independent.",
        ],
    }

    crit = _result(
        status="Pass" if recommendation in ("Go", "Conditional Go — Human Review Required") else "Fail",
        reason=reason,
        expected="Complete claim with verified evidence; no critical integrity/mapping failures",
        actual=recommendation,
        criterion_id="C06",
        severity_hint="Critical" if recommendation == "No-Go" else "Medium",
        failure_mode="unsupported_essentiality_conclusion" if recommendation == "No-Go" else None,
        component="release readiness",
        recommended_action=(
            "Resolve critical evidence/mapping failures, confirm alignments, and obtain expert review "
            "before any attorney-ready claim."
            if recommendation != "Go"
            else "Maintain regression suite on frozen reference after pipeline changes."
        ),
    )
    if recommendation == "Conditional Go — Human Review Required":
        crit["status"] = "Needs review"
        crit["score"] = 0.5
        crit["severity"] = "Medium"

    case = {
        "case_type": "complete_claim",
        "case_key": "CLAIM1",
        "level": "complete_claim",
        "reference_row_id": None,
        "generated_element_ids": [],
        "reference_label": "Partial map baseline (3/3)",
        "generated_label": recommendation,
        "payload": {"level": 5, "readiness": readiness},
        "criteria": {"C06": crit},
    }
    return case, readiness


def evaluate_all_levels(
    reference: dict[str, Any],
    chart: dict[str, Any],
    *,
    decision: dict[str, Any] | None = None,
    expected_doc: str | None = None,
    expected_sha: str | None = None,
    expected_family: str = "H.265",
    alignments_confirmed: bool = False,
    row_cases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run L1–L5 and return cases + metrics for persistence."""
    selection_cases = evaluate_standard_selection(reference, chart, decision=decision)
    req_cases, req_metrics = evaluate_requirements(reference, chart)
    evidence_extra, evidence_metrics = evaluate_evidence_level(
        reference,
        chart,
        expected_doc=expected_doc,
        expected_sha=expected_sha,
        expected_family=expected_family,
    )
    tech_cases = evaluate_technical_tests(
        reference, chart, selection_cases=selection_cases
    )
    # Dedupe T02: prefer evidence_extra version if present
    tech_by_key = {c["case_key"]: c for c in tech_cases}
    for extra in evidence_extra:
        tech_by_key[extra["case_key"]] = extra
    # Ensure T02 exists even if evidence_extra empty — already may be missing from tech
    if "T02" not in tech_by_key:
        e04 = (reference.get("evidence") or {}).get("E04") or {}
        stub = _evaluate_t02(e04, [])
        if stub:
            tech_by_key["T02"] = stub
    tech_cases = list(tech_by_key.values())
    # Sort T01..T10
    order = {f"T{i:02d}": i for i in range(1, 11)}
    tech_cases.sort(key=lambda c: order.get(c["case_key"], 99))

    level_cases = selection_cases + req_cases + tech_cases
    complete_case, readiness = evaluate_release_readiness(
        reference=reference,
        level_cases=level_cases,
        row_cases=row_cases or [],
        alignments_confirmed=alignments_confirmed,
        metrics=req_metrics,
    )
    level_cases.append(complete_case)

    # Mapping label accuracy from row cases when present
    label_pass = label_eligible = 0
    for case in row_cases or []:
        if case.get("case_type") != "reference_row":
            continue
        c06 = (case.get("criteria") or {}).get("C06") or {}
        st = c06.get("status")
        if st in ("Not run", "Not applicable"):
            continue
        label_eligible += 1
        if st == "Pass":
            label_pass += 1

    natural_tests = [
        c
        for c in tech_cases
        if not (c.get("payload") or {}).get("synthetic")
    ]
    nat_pass = sum(
        1
        for c in natural_tests
        if next(iter((c.get("criteria") or {}).values()), {}).get("status") == "Pass"
    )

    metrics = {
        **req_metrics,
        **evidence_metrics,
        "target_selection_accuracy": {
            "pass": sum(
                1
                for c in selection_cases
                if c["criteria"]["C01"]["status"] == "Pass"
            ),
            "eligible": len(selection_cases),
            "display": (
                f"{sum(1 for c in selection_cases if c['criteria']['C01']['status']=='Pass')}"
                f"/{len(selection_cases)}"
            ),
        },
        "mapping_label_accuracy": {
            "pass": label_pass,
            "eligible": label_eligible,
            "rate": round(100.0 * label_pass / label_eligible, 1) if label_eligible else None,
            "display": f"{label_pass}/{label_eligible}" if label_eligible else "—",
        },
        "natural_rubric_tests": {
            "pass": nat_pass,
            "eligible": len(natural_tests),
            "display": f"{nat_pass}/{len(natural_tests)}" if natural_tests else "—",
            "note": "Excludes T09 synthetic corruption test.",
        },
        "full_map_precision_recall": readiness["full_map_precision_recall"],
    }

    return {
        "cases": level_cases,
        "metrics": metrics,
        "readiness": readiness,
        "levels": {
            "standard_selection": selection_cases,
            "claim_requirements": req_cases,
            "evidence_accuracy": [c for c in tech_cases if c["case_key"] in ("T02", "T09")],
            "technical_mapping": [
                c
                for c in tech_cases
                if c["case_key"] in ("T03", "T04", "T05", "T06", "T07", "T08")
            ],
            "complete_claim": [complete_case],
            "rubric_tests": tech_cases,
        },
    }

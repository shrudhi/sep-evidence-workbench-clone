"""Edge-case coverage for the operational Judge rubric (assessment §4–5)."""

from __future__ import annotations

from backend.app.judge import (
    assemble_judge_report,
    build_rework_feedback,
    remappable_judge_issues,
    run_deterministic_checks,
    run_judge,
    should_auto_rework,
)


def _meta_pts():
    return None


def test_no_map_empty_evidence_scorecard_matches_screenshot_pattern():
    det = run_deterministic_checks(
        evidence_blocks=[],
        target_document_id="standard-h265-v10",
        target_family="H.265",
        target_edition="ITU-T H.265 V10 (07/2024)",
        integrity={"pass": True, "checks": []},
        mapping_label="No map",
    )
    assert det["J01"]["status"] == "Not applicable"
    assert det["J01"]["finding"] == "No supporting quote asserted"
    assert det["J01"]["earned_points"] is None
    assert det["J02"]["status"] == "Not applicable"
    assert det["J02"]["finding"] == "No supporting screenshot asserted"
    assert det["J03"]["status"] == "Pass"
    assert det["J03"]["finding"] == "Selected edition verified"
    assert det["J03"]["earned_points"] == 10
    assert det["J04"]["status"] == "Pass"
    assert det["J04"]["finding"] == "Search-record citations verified"

    report = run_judge(
        element={
            "id": "e1",
            "label": "1[x]",
            "exact_text": "a non-existent widget",
            "requirements": [{"text": "a non-existent widget"}],
        },
        mapping={
            "mapping_label": "No map",
            "rationale": (
                "Documented search across H.265 did not locate apparatus or process text that "
                "meets this element; No map is therefore asserted."
            ),
            "missing_requirements": ["a non-existent widget"],
            "evidence_status": "none",
            "evidence_span_ids": [],
            "counterevidence_span_ids": [],
        },
        target_document_id="standard-h265-v10",
        target_family="H.265",
        target_edition="ITU-T H.265 V10 (07/2024)",
        integrity={"pass": True, "checks": []},
        evidence_blocks=[],
    )
    by = {c["criterion_id"]: c for c in report["criteria"]}
    assert by["J01"]["status"] == "Not applicable"
    assert by["J02"]["status"] == "Not applicable"
    assert by["J05"]["status"] == "Pass"
    assert "No adequate support" in by["J05"]["finding"]
    assert by["J07"]["status"] == "Pass"
    assert "No map is consistent" in by["J07"]["finding"]
    assert report["overall_decision"] == "Passed checks"
    assert report["scorecard_note"]
    assert report["review_status"] == "done"
    assert report["critical"] is False


def test_full_map_without_evidence_fails_required_checks():
    det = run_deterministic_checks(
        evidence_blocks=[],
        target_document_id="standard-h265-v10",
        target_family="H.265",
        target_edition="ITU-T H.265 V10 (07/2024)",
        integrity={"pass": True, "checks": []},
        mapping_label="Full map",
    )
    assert det["J01"]["status"] == "Fail"
    assert det["J03"]["status"] == "Fail"


def test_quote_mismatch_fails_and_is_critical():
    blocks = [
        {
            "available": True,
            "evidence_id": "span:test:1",
            "quote": "this quote is not on the page at all XYZ123",
            "page_ordinal": 1,
            "printed_label": "1",
            "section_ref": "§1.1",
            "section_label": "1.1 General",
            "screenshot_url": "/api/evidence/span:test:1/screenshot",
            "source": {
                "document_id": "standard-h265-v10",
                "family": "H.265",
                "edition": "ITU-T H.265 V10 (07/2024)",
            },
            "role": "supporting",
        }
    ]
    # Force page text empty so quote cannot match.
    det = run_deterministic_checks(
        evidence_blocks=blocks,
        target_document_id="standard-h265-v10",
        target_family="H.265",
        target_edition="ITU-T H.265 V10 (07/2024)",
        integrity={
            "pass": False,
            "checks": [
                {
                    "span_id": "span:test:1",
                    "pass": False,
                    "reasons": ["quote not found on page"],
                }
            ],
        },
        mapping_label="Full map",
    )
    assert det["J01"]["status"] == "Fail"
    report = assemble_judge_report(
        deterministic=det,
        semantic={
            "J05": {
                **det["J01"],
                "criterion_id": "J05",
                "status": "Needs review",
                "earned_points": 10,
                "max_points": 20,
                "finding": "Support uncertain because quote failed.",
                "required": False,
            },
            "J06": {
                **det["J01"],
                "criterion_id": "J06",
                "status": "Needs review",
                "earned_points": 10,
                "max_points": 20,
                "finding": "Rationale cites a failed quote.",
                "required": False,
            },
            "J07": {
                **det["J01"],
                "criterion_id": "J07",
                "status": "Fail",
                "earned_points": 0,
                "max_points": 10,
                "finding": "Full map unjustified.",
                "required": False,
                "tags": ["label_disagreement"],
            },
        },
        semantic_meta={
            "summary": "Quote mismatch",
            "next_action": "Replace the evidence.",
            "what_passed": "Edition check",
            "what_needs_attention": "Quote mismatch",
        },
        semantic_error=None,
        integrity={"pass": False},
        mapping_label="Full map",
        missing_requirements=[],
        element={"label": "1[a]", "exact_text": "An encoding apparatus"},
        target_family="H.265",
        target_edition="ITU-T H.265 V10 (07/2024)",
    )
    assert report["overall_decision"] == "Failed checks"
    assert report["critical"] is True
    assert any(r["severity"] == "critical" for r in report["recommendations"])


def test_incomplete_semantic_never_defaults_to_pass():
    from backend.app.judge import _blank_criterion

    det = {
        "J01": _blank_criterion("J01", "quote_verbatim", "Quote", 15, status="Pass", finding="ok", required=True),
        "J02": _blank_criterion(
            "J02", "screenshot_match", "Screenshot", 15, status="Needs review", finding="visual", required=True
        ),
        "J03": _blank_criterion("J03", "edition", "Edition", 10, status="Pass", finding="ok", required=True),
        "J04": _blank_criterion("J04", "section", "Section", 10, status="Pass", finding="ok", required=True),
    }
    report = assemble_judge_report(
        deterministic=det,
        semantic={
            "J05": _blank_criterion(
                "J05", "evidence_supports", "Evidence", 20, status="Not run", finding="Not assessed", semantic=True
            ),
            "J06": _blank_criterion(
                "J06", "rationale_accuracy", "Rationale", 20, status="Error", finding="timeout", semantic=True
            ),
            "J07": _blank_criterion(
                "J07", "mapping_label", "Label", 10, status="Not run", finding="Not assessed", semantic=True
            ),
        },
        semantic_meta=None,
        semantic_error="timeout",
        integrity={"pass": True},
        mapping_label="Partial map",
        missing_requirements=[],
    )
    assert report["overall_decision"] == "Review incomplete"
    assert report["review_status"] == "incomplete"
    assert report["overall_decision"] != "Passed checks"
    assert report["disposition"] == "rework"
    assert should_auto_rework(report) is True


def test_screenshot_and_section_pass_when_quote_matches_document():
    from backend.app.judge import _blank_criterion

    det = {
        "J01": _blank_criterion(
            "J01", "quote_verbatim", "Quote", 15, status="Pass", finding="ok", required=True
        ),
        "J02": _blank_criterion(
            "J02",
            "screenshot_match",
            "Screenshot",
            15,
            status="Pass",
            finding="Screenshot linked; quote verified on page.",
            required=True,
        ),
        "J03": _blank_criterion(
            "J03", "edition", "Edition", 10, status="Pass", finding="ok", required=True
        ),
        "J04": _blank_criterion(
            "J04", "section", "Section", 10, status="Pass", finding="ok", required=True
        ),
    }
    semantic = {
        "J05": _blank_criterion(
            "J05",
            "evidence_supports",
            "Evidence",
            20,
            status="Pass",
            finding="Requirements supported.",
            semantic=True,
        ),
        "J06": _blank_criterion(
            "J06",
            "rationale_accuracy",
            "Rationale",
            20,
            status="Pass",
            finding="Rationale accurate.",
            semantic=True,
        ),
        "J07": _blank_criterion(
            "J07",
            "mapping_label",
            "Label",
            10,
            status="Pass",
            finding="Partial map justified.",
            semantic=True,
        ),
    }
    report = assemble_judge_report(
        deterministic=det,
        semantic=semantic,
        semantic_meta={"summary": "All matched", "next_action": "None"},
        semantic_error=None,
        integrity={"pass": True},
        mapping_label="Partial map",
        missing_requirements=["optional circuitry detail"],
    )
    assert report["overall_decision"] == "Passed checks"
    assert remappable_judge_issues(report["criteria"], integrity={"pass": True}) == []
    assert report["disposition"] == "pass"
    assert should_auto_rework(report) is False


def test_llm_not_called_status_is_not_run():
    from backend.app.judge import _blank_criterion

    det = {
        "J01": _blank_criterion("J01", "q", "Quote", 15, status="Pass", finding="ok", required=True),
        "J02": _blank_criterion("J02", "s", "Shot", 15, status="Pass", finding="ok", required=True),
        "J03": _blank_criterion("J03", "e", "Edition", 10, status="Pass", finding="ok", required=True),
        "J04": _blank_criterion("J04", "p", "Page", 10, status="Pass", finding="ok", required=True),
    }
    report = assemble_judge_report(
        deterministic=det,
        semantic={
            "J05": _blank_criterion(
                "J05",
                "evidence_supports",
                "Evidence",
                20,
                status="Not run",
                finding="LLM not called — this criterion has not been assessed yet.",
                semantic=True,
            ),
            "J06": _blank_criterion(
                "J06",
                "rationale_accuracy",
                "Rationale",
                20,
                status="Not run",
                finding="LLM not called — this criterion has not been assessed yet.",
                semantic=True,
            ),
            "J07": _blank_criterion(
                "J07",
                "mapping_label",
                "Label",
                10,
                status="Not run",
                finding="LLM not called — this criterion has not been assessed yet.",
                semantic=True,
            ),
        },
        semantic_meta=None,
        semantic_error="provider_not_ready",
        integrity={"pass": True},
        mapping_label="Partial map",
        missing_requirements=[],
    )
    assert report["overall_decision"] == "Review incomplete"
    by = {c["criterion_id"]: c for c in report["criteria"]}
    assert by["J05"]["status"] == "Not run"
    assert "LLM not called" in by["J05"]["finding"]


def test_semantic_fail_triggers_auto_rework_and_feedback():
    from backend.app.judge import _blank_criterion

    det = {
        "J01": _blank_criterion(
            "J01", "quote_verbatim", "Quote", 15, status="Pass", finding="ok", required=True
        ),
        "J02": _blank_criterion(
            "J02",
            "screenshot_match",
            "Screenshot",
            15,
            status="Needs review",
            finding="visual",
            required=True,
        ),
        "J03": _blank_criterion(
            "J03", "edition", "Edition", 10, status="Pass", finding="ok", required=True
        ),
        "J04": _blank_criterion(
            "J04", "section", "Section", 10, status="Pass", finding="ok", required=True
        ),
    }
    semantic = {
        "J05": _blank_criterion(
            "J05",
            "evidence_supports",
            "Evidence",
            20,
            status="Fail",
            finding="Chroma QP text does not establish speech quantization.",
            gap="speech quantization requirement unsupported",
            tags=["unsupported_requirement"],
            semantic=True,
        ),
        "J06": _blank_criterion(
            "J06",
            "rationale_accuracy",
            "Rationale",
            20,
            status="Needs review",
            finding="Rationale overstates support.",
            semantic=True,
        ),
        "J07": _blank_criterion(
            "J07",
            "mapping_label",
            "Label",
            10,
            status="Fail",
            finding="Full map unjustified.",
            label_recommendation="Partial map",
            tags=["label_disagreement"],
            semantic=True,
        ),
    }
    report = assemble_judge_report(
        deterministic=det,
        semantic=semantic,
        semantic_meta={
            "summary": "Label and support fail",
            "next_action": "Replace evidence or downgrade label",
        },
        semantic_error=None,
        integrity={"pass": True},
        mapping_label="Full map",
        missing_requirements=["speech quantization"],
    )
    assert report["disposition"] == "rework"
    assert report["auto_rework"] is True
    assert should_auto_rework(report) is True
    feedback = build_rework_feedback(report)
    assert any("NON-NEGOTIABLE" in line for line in feedback)
    assert any("J05" in line for line in feedback)
    assert any("Partial map" in line for line in feedback)

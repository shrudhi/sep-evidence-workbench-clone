"""Unit tests for verified, actionable AI Review recommendations."""

from __future__ import annotations

from typing import Any

import pytest

from backend.app import ai_review


class _FakeResult:
    def __init__(self, data: dict[str, Any]):
        self.data = data


class _FakeProvider:
    def __init__(self, ready: bool = True, data: dict[str, Any] | None = None):
        self._ready = ready
        self._data = data or {}

    def readiness(self) -> dict[str, Any]:
        return {"ready": self._ready}

    def structured(self, **_: Any) -> _FakeResult:
        return _FakeResult(self._data)


GOOD_BLOCK = {
    "available": True,
    "evidence_id": "ev-1",
    "source": {
        "document_id": "doc-1",
        "family": "H.265",
        "edition": "V10",
        "title": "High efficiency video coding",
    },
    "section_ref": "8.7.1",
    "printed_label": "221",
    "page_ordinal": 10,
    "quote": "verbatim quote text here",
    "screenshot_url": "/shot.png",
    "highlight_available": True,
}


@pytest.fixture(autouse=True)
def _stub_page_helpers(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ai_review, "_page_text", lambda *_a, **_k: "verbatim quote text here")
    monkeypatch.setattr(
        ai_review, "_quote_on_page", lambda quote, _text: (quote == "verbatim quote text here", 0, 0)
    )


def test_no_recommendations_when_everything_passes(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ai_review,
        "OpenAICompatibleProvider",
        lambda: _FakeProvider(
            data={
                "outcome": "needs_correction",
                "label_check": {
                    "status": "pass",
                    "reason": "Label matches rationale.",
                    "recommended_label": "Partial map",
                },
                "rationale_check": {
                    "status": "pass",
                    "reason": "Rationale matches quotes.",
                },
                "gap_finding": "Search for evidence that describes an encoding apparatus.",
                "recommendations": [
                    {
                        "action": "add",
                        "target": "evidence",
                        "title": "Add apparatus",
                        "finding": "Search for evidence that explicitly describes an encoding apparatus.",
                        "detail": "Look for sections detailing architecture.",
                    }
                ],
            }
        ),
    )
    monkeypatch.setattr(ai_review, "_research_passages", lambda **_k: [])
    result = ai_review.assemble_review(
        label="Partial map",
        claim_text="apparatus…",
        rationale="Partial — apparatus gap remains.",
        blocks=[GOOD_BLOCK],
        target_document_id="doc-1",
        target_family="H.265",
        target_edition="V10",
        target_title="High efficiency video coding",
    )
    assert result["status"] == "passed"
    assert result["recommendations"] == []


def test_actionable_update_remove_and_retrieved_add(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ai_review,
        "OpenAICompatibleProvider",
        lambda: _FakeProvider(
            data={
                "outcome": "needs_correction",
                "label_check": {
                    "status": "fail",
                    "reason": "Evidence supports Partial map, not Full map.",
                    "recommended_label": "Partial map",
                },
                "rationale_check": {
                    "status": "fail",
                    "reason": "Cited quotes do not define an encoding apparatus.",
                    "corrected_rationale": "Offset supported; apparatus not shown.",
                },
                "gap_finding": "Search for encoding apparatus definitions.",
                "recommendations": [
                    {
                        "action": "add",
                        "target": "evidence",
                        "title": "Add apparatus",
                        "finding": "Search for evidence that explicitly describes an encoding apparatus.",
                        "detail": "Look for sections…",
                    }
                ],
            }
        ),
    )
    monkeypatch.setattr(
        ai_review,
        "_research_passages",
        lambda **_k: [
            {
                "evidence_id": "ev-new",
                "quote": "An encoding apparatus configured to encode…",
                "section": "3.1",
                "page": "12",
            }
        ],
    )
    bad = {**GOOD_BLOCK, "quote": "not on page", "evidence_id": "ev-bad"}
    result = ai_review.assemble_review(
        label="Full map",
        claim_text="apparatus…",
        rationale="Fully supported.",
        blocks=[bad],
        target_document_id="doc-1",
        target_family="H.265",
        target_edition="V10",
        target_title="High efficiency video coding",
    )
    assert result["status"] == "needs_correction"
    assert result["recommendations"]
    assert all(not ai_review._is_search_advice(r.get("finding")) for r in result["recommendations"])
    actions = {s["action"] for s in result["recommendations"]}
    assert "remove" in actions
    assert "update" in actions
    assert "add" in actions
    add = next(s for s in result["recommendations"] if s["action"] == "add")
    assert add["researched_quote"]
    assert add["evidence_id"] == "ev-new"
    assert "search for" not in add["finding"].lower()


def test_failed_criterion_is_needs_review_with_update(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ai_review,
        "OpenAICompatibleProvider",
        lambda: _FakeProvider(
            data={
                "outcome": "needs_correction",
                "label_check": {
                    "status": "fail",
                    "reason": "Evidence supports Partial map, not Full map.",
                    "recommended_label": "Partial map",
                },
                "rationale_check": {
                    "status": "pass",
                    "reason": "Rationale matches the cited quotes.",
                },
                "recommendations": [],
            }
        ),
    )
    monkeypatch.setattr(ai_review, "_research_passages", lambda **_k: [])
    result = ai_review.assemble_review(
        label="Full map",
        claim_text="apparatus…",
        rationale="Partial coverage only.",
        blocks=[GOOD_BLOCK],
        target_document_id="doc-1",
        target_family="H.265",
        target_edition="V10",
        target_title="High efficiency video coding",
    )
    assert result["status"] == "needs_correction"
    assert result["status_label"] == "Needs Review"
    assert "Partial map" in (result.get("reason") or "") or any(
        c.get("status") == "fail" for c in result["claim_checks"]
    )
    updates = [r for r in result["recommendations"] if r["action"] == "update"]
    assert updates
    assert any(r.get("mapping_label") == "Partial map" for r in updates)


def test_no_map_without_evidence_is_not_correction(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ai_review,
        "OpenAICompatibleProvider",
        lambda: _FakeProvider(
            data={
                "outcome": "needs_correction",
                "label_check": {
                    "status": "pass",
                    "reason": "No map is consistent with absence of support.",
                    "recommended_label": "No map",
                },
                "rationale_check": {
                    "status": "pass",
                    "reason": "Rationale correctly states no supporting clause was found.",
                },
                "gap_finding": "Search for circuitry configured to set chroma QP.",
                "recommendations": [],
            }
        ),
    )
    monkeypatch.setattr(ai_review, "_research_passages", lambda **_k: [])
    result = ai_review.assemble_review(
        label="No map",
        claim_text="comprising : circuitry configured to :",
        rationale="No section of the standard meets this element.",
        blocks=[],
        target_document_id="doc-1",
        target_family="H.265",
        target_edition="V10",
        target_title="High efficiency video coding",
    )
    assert result["status"] == "passed"
    assert result["status_label"] == "Passed"
    assert result["recommendations"] == []


def test_incomplete_without_model(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ai_review,
        "OpenAICompatibleProvider",
        lambda: _FakeProvider(ready=False),
    )
    result = ai_review.assemble_review(
        label="Partial map",
        claim_text="apparatus…",
        rationale="Partial.",
        blocks=[GOOD_BLOCK],
        target_document_id="doc-1",
        target_family="H.265",
        target_edition="V10",
        target_title="High efficiency video coding",
    )
    assert result["status"] == "incomplete"
    assert result["recommendations"] == []

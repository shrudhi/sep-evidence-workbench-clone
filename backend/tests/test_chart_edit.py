"""Unit tests for chart edit authorship + manual evidence merge."""

from __future__ import annotations

from backend.app import chart_edit


def test_build_edit_meta_keeps_corpus_and_manual():
    ids, meta = chart_edit.build_edit_meta_from_entries(
        prior_meta=chart_edit.empty_edit_meta(),
        entries=[
            {
                "evidence_id": "ev-1",
                "standard_edition": "H.265 V10",
                "section": "8.7",
                "printed_page": "221",
                "pdf_page": 10,
                "quote": "updated quote",
                "removed": False,
            },
            {
                "evidence_id": None,
                "standard_edition": "Manual standard",
                "section": "3.1",
                "printed_page": "12",
                "pdf_page": 20,
                "quote": "manual quote text",
                "manual": True,
                "removed": False,
            },
            {"evidence_id": "ev-gone", "removed": True, "quote": "x"},
        ],
        actor="Analyst",
        target_document_id="doc-1",
    )
    assert ids == ["ev-1"]
    assert meta["origin"] == "human"
    assert meta["evidence_overrides"]["ev-1"]["quote"] == "updated quote"
    assert len(meta["manual_evidence"]) == 1
    assert meta["manual_evidence"][0]["quote"] == "manual quote text"
    assert str(meta["manual_evidence"][0]["evidence_id"]).startswith("manual-")


def test_apply_edit_meta_to_blocks_appends_manual():
    blocks = [
        {
            "evidence_id": "ev-1",
            "available": True,
            "quote": "original",
            "source": {"edition": "V10", "family": "H.265", "title": "t", "document_id": "d", "sha256": None},
        }
    ]
    meta = {
        "origin": "human",
        "actor": "Analyst",
        "evidence_overrides": {"ev-1": {"quote": "patched", "section": "1.2"}},
        "manual_evidence": [
            {
                "evidence_id": "manual-1",
                "standard_edition": "Manual",
                "section": "9",
                "printed_page": "3",
                "pdf_page": 4,
                "quote": "added by analyst",
            }
        ],
    }
    merged = chart_edit.apply_edit_meta_to_blocks(blocks, meta)
    assert len(merged) == 2
    assert merged[0]["quote"] == "patched"
    assert merged[0]["authorship"] == "human"
    assert merged[1]["manual"] is True
    assert merged[1]["quote"] == "added by analyst"

import pytest

from backend.app.exporter import resolve_export_designation


def test_incomplete_corpus_is_always_draft():
    corpus = {
        "complete": False,
        "missing_standard_ids": ["standard-h265-v10"],
    }
    assert (
        resolve_export_designation(
            requested_final=False,
            all_decided=True,
            corpus=corpus,
        )
        == "DRAFT — INCOMPLETE STANDARDS CORPUS"
    )


def test_incomplete_corpus_blocks_reviewed_final():
    corpus = {
        "complete": False,
        "missing_standard_ids": ["standard-h265-v10"],
    }
    with pytest.raises(ValueError, match="standard-h265-v10"):
        resolve_export_designation(
            requested_final=True,
            all_decided=True,
            corpus=corpus,
        )


def test_complete_corpus_still_requires_review_ready_rows():
    with pytest.raises(ValueError, match="AI Review Passed"):
        resolve_export_designation(
            requested_final=True,
            all_decided=False,
            all_review_ready=False,
            corpus={"complete": True, "missing_standard_ids": []},
        )


def test_final_allowed_when_review_ready_even_if_not_all_decided():
    assert (
        resolve_export_designation(
            requested_final=True,
            all_decided=False,
            all_review_ready=True,
            corpus={"complete": True, "missing_standard_ids": []},
        )
        == "REVIEWED FINAL"
    )

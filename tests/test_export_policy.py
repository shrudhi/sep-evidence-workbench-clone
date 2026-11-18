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


def test_complete_corpus_still_requires_all_decisions():
    with pytest.raises(ValueError, match="analyst decision"):
        resolve_export_designation(
            requested_final=True,
            all_decided=False,
            corpus={"complete": True, "missing_standard_ids": []},
        )

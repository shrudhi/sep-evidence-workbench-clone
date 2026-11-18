import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.database import init_db
from backend.app.ingest import heading_lines
from backend.app.workflow import MappingOutput, verify_integrity


def _connection(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "test.db"
    init_db(path)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    source = Path("sources/US10063856.pdf")
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    connection.execute(
        """
        INSERT INTO documents(
          id,kind,family,title,edition,filename,sha256,status,page_count
        ) VALUES('standard-a','standard','A','A title','A v1','US10063856.pdf',?,'indexed',1)
        """,
        (source_hash,),
    )
    page_text = "The exact value is 51 and this sentence is authoritative."
    page_id = connection.execute(
        """
        INSERT INTO pages(
          document_id,page_ordinal,printed_label,raw_text,width,height
        ) VALUES('standard-a',1,'7',?,600,800)
        """,
        (page_text,),
    ).lastrowid
    quote = "exact value is 51"
    start = page_text.index(quote)
    connection.execute(
        """
        INSERT INTO spans(
          id,document_id,page_id,page_ordinal,printed_label,raw_text,start_char,end_char,
          bbox_json,word_count,content_hash
        ) VALUES('span-1','standard-a',?,1,'7',?,?,?,?,?,?)
        """,
        (
            page_id,
            quote,
            start,
            start + len(quote),
            json.dumps([10, 20, 200, 50]),
            5,
            hashlib.sha256(quote.encode()).hexdigest(),
        ),
    )
    connection.commit()
    return connection


def test_integrity_accepts_exact_hash_pinned_span(tmp_path: Path):
    connection = _connection(tmp_path)
    result = verify_integrity(connection, ["span-1"], "standard-a")
    assert result["pass"] is True


def test_integrity_rejects_altered_number(tmp_path: Path):
    connection = _connection(tmp_path)
    connection.execute("UPDATE spans SET raw_text='exact value is 50' WHERE id='span-1'")
    connection.commit()
    result = verify_integrity(connection, ["span-1"], "standard-a")
    assert result["pass"] is False
    assert "quote/offset mismatch" in result["checks"][0]["reasons"]


def test_integrity_rejects_wrong_document(tmp_path: Path):
    connection = _connection(tmp_path)
    result = verify_integrity(connection, ["span-1"], "standard-b")
    assert result["pass"] is False
    assert "wrong document" in result["checks"][0]["reasons"]


def test_integrity_rejects_bbox_outside_page(tmp_path: Path):
    connection = _connection(tmp_path)
    connection.execute("UPDATE spans SET bbox_json='[0,0,999,900]' WHERE id='span-1'")
    connection.commit()
    result = verify_integrity(connection, ["span-1"], "standard-a")
    assert result["pass"] is False
    assert "bounding box outside page" in result["checks"][0]["reasons"]


def test_full_map_cannot_have_missing_requirement():
    with pytest.raises(ValidationError):
        MappingOutput(
            mapping_label="Full map",
            evidence_span_ids=["span-1"],
            rationale="Incomplete proposal",
            missing_requirements=["claimed actor"],
            evidence_status="normative",
        )


def test_no_map_cannot_fabricate_supporting_quote():
    with pytest.raises(ValidationError):
        MappingOutput(
            mapping_label="No map",
            evidence_span_ids=["span-1"],
            rationale="No adequate mapping established",
            evidence_status="unresolved",
        )


def test_heading_parser_uses_explicit_numbering_only():
    text = "7.3 Quantization parameters\nordinary explanatory text\n8 NEXT TOPIC"
    headings = heading_lines(text)
    assert headings[0][0] == "7.3"
    assert all("ordinary" not in heading for _, heading in headings)

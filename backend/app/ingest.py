import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pdfplumber

from .config import get_settings
from .database import connect, init_db, utcnow

EXTRACTION_VERSION = "pdfplumber-words-v2"
# Require at least one dotted segment for numeric section headings so page
# folios like "176 Rec. ITU-T H.265…" are not ingested as sections.
HEADING_RE = re.compile(
    r"^(?:(\d+(?:\.\d+){1,5})\s+|(?:ANNEX|APPENDIX)\s+[A-Z]\b)([A-Z][^\n]{2,160})?$",
    re.IGNORECASE,
)
REFERENCE_RE = re.compile(
    r"\b(?:clause|section|table|figure|annex)\s+([A-Z]?\d+(?:\.\d+){0,5}|[A-Z])\b",
    re.IGNORECASE,
)
PAGE_FOLIO_RE = re.compile(
    r"^(?P<printed>\d{1,4})\s+Rec\.\s+",
    re.IGNORECASE | re.MULTILINE,
)
PAGE_NUMBER_RE = re.compile(
    r"^(?:Page\s+)?(?P<printed>[A-Z]?-?\d{1,4})$",
    re.IGNORECASE,
)
# Genuine Roman page numbers only (not lone letters like C/L/i/m).
ROMAN_PAGE_RE = re.compile(
    r"^(?=[ivxlcdm]{2,8}$)(?!.*([ivxlcdm])\1{3})[ivxlcdm]+$",
    re.IGNORECASE,
)
FOLIO_NOISE_RE = re.compile(
    r"\b(?:Rec\.|ITU-T|ETSI|3GPP|Recommendation)\b",
    re.IGNORECASE,
)


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_id(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:24]


def printed_label(text: str, ordinal: int) -> str:
    folio = PAGE_FOLIO_RE.search(text[:400] or "")
    if folio:
        return folio.group("printed")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    candidates = lines[:3] + lines[-3:]
    for candidate in reversed(candidates):
        if FOLIO_NOISE_RE.search(candidate):
            continue
        match = PAGE_NUMBER_RE.fullmatch(candidate)
        if match:
            return match.group("printed")
        if ROMAN_PAGE_RE.fullmatch(candidate):
            return candidate.lower()
    return str(ordinal)


def heading_lines(text: str) -> list[tuple[str, str]]:
    headings: list[tuple[str, str]] = []
    for line in text.splitlines():
        clean = " ".join(line.split())
        if FOLIO_NOISE_RE.search(clean) and not re.match(r"^\d+\.\d+", clean):
            continue
        match = HEADING_RE.match(clean)
        if not match or len(clean) > 180:
            continue
        number = match.group(1) or clean.split(maxsplit=2)[0:2][-1]
        # Skip bare integers and Rec./ITU folio lines.
        if number.isdigit() and "." not in str(number):
            continue
        headings.append((str(number).upper(), clean))
    return headings


def _bbox(words: list[dict[str, Any]]) -> list[float]:
    if not words:
        return [0, 0, 0, 0]
    return [
        min(float(word["x0"]) for word in words),
        min(float(word["top"]) for word in words),
        max(float(word["x1"]) for word in words),
        max(float(word["bottom"]) for word in words),
    ]


def _window_words(words: list[dict[str, Any]], size: int = 170, overlap: int = 30):
    start = 0
    while start < len(words):
        end = min(start + size, len(words))
        yield start, end, words[start:end]
        if end == len(words):
            break
        start = end - overlap


def load_manifest(source_dir: Path) -> dict[str, Any]:
    return json.loads((source_dir / "manifest.json").read_text())


def register_manifest(connection, manifest: dict[str, Any]) -> None:
    for document in manifest["documents"]:
        connection.execute(
            """
            INSERT INTO documents(id,kind,family,title,edition,filename,sha256,status)
            VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              kind=excluded.kind,family=excluded.family,title=excluded.title,
              edition=excluded.edition,filename=excluded.filename,sha256=excluded.sha256,
              status=CASE WHEN documents.status='indexed' AND excluded.status='available'
                          THEN documents.status ELSE excluded.status END
            """,
            (
                document["id"],
                document["kind"],
                document["family"],
                document["title"],
                document["edition"],
                document["filename"],
                document["sha256"],
                document["status"],
            ),
        )


def ingest_document(connection, source_dir: Path, document: dict[str, Any]) -> dict[str, Any]:
    if document["status"] != "available":
        return {"id": document["id"], "status": "pending"}
    path = source_dir / document["filename"]
    actual_hash = file_hash(path)
    if actual_hash != document["sha256"]:
        raise ValueError(f"Hash mismatch for {document['filename']}")

    doc_id = document["id"]
    connection.execute("DELETE FROM pages WHERE document_id=?", (doc_id,))
    connection.execute("DELETE FROM nodes WHERE document_id=?", (doc_id,))
    connection.execute("DELETE FROM spans_fts WHERE document_id=?", (doc_id,))
    doc_node = f"doc:{doc_id}"
    connection.execute(
        "INSERT INTO nodes(id,document_id,node_type,label,provenance) VALUES(?,?,?,?,?)",
        (doc_node, doc_id, "DocumentVersion", document["edition"], "manifest"),
    )

    section_by_number: dict[str, str] = {}
    current_section = doc_node
    prior_section: str | None = None
    span_count = 0
    page_count = 0
    references: list[tuple[str, str]] = []

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for ordinal, page in enumerate(pdf.pages, start=1):
            extracted_text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            words = page.extract_words(
                x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=True
            )
            raw_text = " ".join(str(word["text"]) for word in words)
            label = printed_label(extracted_text, ordinal)
            cursor = connection.execute(
                """
                INSERT INTO pages(
                  document_id,page_ordinal,printed_label,raw_text,width,height,extraction_status
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (doc_id, ordinal, label, raw_text, float(page.width), float(page.height), "ok"),
            )
            page_id = int(cursor.lastrowid)

            for number, heading in heading_lines(extracted_text):
                section_id = f"section:{doc_id}:{stable_id(number, heading)}"
                if number not in section_by_number:
                    section_by_number[number] = section_id
                    connection.execute(
                        """
                        INSERT INTO nodes(
                          id,document_id,node_type,label,page_start,page_end,parent_id,provenance
                        ) VALUES(?,?,?,?,?,?,?,?)
                        """,
                        (
                            section_id,
                            doc_id,
                            "Section",
                            heading,
                            ordinal,
                            ordinal,
                            doc_node,
                            "heading",
                        ),
                    )
                    connection.execute(
                        """
                        INSERT INTO edges(
                          document_id,from_id,to_id,edge_type,provenance,resolution_status
                        ) VALUES(?,?,?,?,?,?)
                        """,
                        (doc_id, doc_node, section_id, "CONTAINS", "heading hierarchy", "resolved"),
                    )
                    if prior_section:
                        connection.execute(
                            """
                            INSERT OR IGNORE INTO edges(
                              document_id,from_id,to_id,edge_type,provenance,resolution_status
                            ) VALUES(?,?,?,?,?,?)
                            """,
                            (
                                doc_id,
                                prior_section,
                                section_id,
                                "NEXT",
                                "document order",
                                "resolved",
                            ),
                        )
                    prior_section = section_id
                current_section = section_by_number[number]

            offset = 0
            section_label = connection.execute(
                "SELECT label FROM nodes WHERE id=?", (current_section,)
            ).fetchone()["label"]
            for window_index, (_, _, window) in enumerate(_window_words(words)):
                span_text = " ".join(str(word["text"]) for word in window)
                start_char = raw_text.find(span_text, offset)
                if start_char < 0:
                    start_char = max(0, offset)
                end_char = start_char + len(span_text)
                offset = max(start_char, end_char - 200)
                content_hash = hashlib.sha256(span_text.encode()).hexdigest()
                span_id = f"span:{doc_id}:{ordinal}:{window_index}:{content_hash[:10]}"
                bbox = _bbox(window)
                connection.execute(
                    """
                    INSERT INTO spans(
                      id,document_id,page_id,section_id,page_ordinal,printed_label,
                      raw_text,start_char,end_char,bbox_json,word_count,content_hash
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        span_id,
                        doc_id,
                        page_id,
                        current_section,
                        ordinal,
                        label,
                        span_text,
                        start_char,
                        end_char,
                        json.dumps(bbox),
                        len(window),
                        content_hash,
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO spans_fts(span_id,document_id,section_label,raw_text)
                    VALUES(?,?,?,?)
                    """,
                    (span_id, doc_id, section_label, span_text),
                )
                connection.execute(
                    """
                    INSERT INTO nodes(
                      id,document_id,node_type,label,page_start,page_end,parent_id,provenance
                    ) VALUES(?,?,?,?,?,?,?,?)
                    """,
                    (
                        span_id,
                        doc_id,
                        "EvidenceSpan",
                        f"p. {label} window {window_index + 1}",
                        ordinal,
                        ordinal,
                        current_section,
                        "pdfplumber",
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO edges(
                      document_id,from_id,to_id,edge_type,provenance,resolution_status
                    ) VALUES(?,?,?,?,?,?)
                    """,
                    (doc_id, current_section, span_id, "CONTAINS", "extraction", "resolved"),
                )
                for target in REFERENCE_RE.findall(span_text):
                    references.append((current_section, target.upper()))
                span_count += 1

    for from_id, target in references:
        to_id = section_by_number.get(target)
        connection.execute(
            """
            INSERT OR IGNORE INTO edges(
              document_id,from_id,to_id,edge_type,target_label,provenance,resolution_status
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                doc_id,
                from_id,
                to_id,
                "REFERENCES",
                target,
                "explicit text reference",
                "resolved" if to_id else "unresolved",
            ),
        )
    connection.execute(
        """
        UPDATE documents SET status='indexed',page_count=?,extraction_version=?,indexed_at=?
        WHERE id=?
        """,
        (page_count, EXTRACTION_VERSION, utcnow(), doc_id),
    )
    return {"id": doc_id, "status": "indexed", "pages": page_count, "spans": span_count}


def embed_missing(connection) -> int:
    from sentence_transformers import SentenceTransformer

    settings = get_settings()
    rows = connection.execute(
        "SELECT id,raw_text,content_hash FROM spans WHERE embedding IS NULL ORDER BY id"
    ).fetchall()
    if not rows:
        return 0
    model = SentenceTransformer(settings.embedding_model)
    texts = [row["raw_text"] for row in rows]
    vectors = model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=True)
    for row, vector in zip(rows, vectors, strict=True):
        packed = np.asarray(vector, dtype=np.float32).tobytes()
        connection.execute(
            """
            UPDATE spans SET embedding=?,embedding_model=?,embedding_hash=? WHERE id=?
            """,
            (packed, settings.embedding_model, row["content_hash"], row["id"]),
        )
    return len(rows)


def ingest_all(*, with_embeddings: bool = True) -> list[dict[str, Any]]:
    settings = get_settings()
    init_db()
    manifest = load_manifest(settings.source_dir)
    results: list[dict[str, Any]] = []
    with connect() as connection:
        register_manifest(connection, manifest)
        for document in manifest["documents"]:
            results.append(ingest_document(connection, settings.source_dir, document))
            connection.commit()
        if with_embeddings:
            count = embed_missing(connection)
            connection.commit()
            results.append({"embeddings": count})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Index immutable source PDFs")
    parser.add_argument("--skip-embeddings", action="store_true")
    args = parser.parse_args()
    print(json.dumps(ingest_all(with_embeddings=not args.skip_embeddings), indent=2))


if __name__ == "__main__":
    main()

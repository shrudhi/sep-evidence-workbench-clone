import json
import os
import re
import threading
from functools import lru_cache
from typing import Any

import numpy as np

from .config import get_settings
from .database import connect

# Avoid OpenMP / tokenizer native crashes when encoding from FastAPI background tasks.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

_EMBED_LOCK = threading.Lock()


def _fts_query(query: str) -> str:
    terms = re.findall(r"[A-Za-z0-9_]{2,}", query)[:24]
    return " OR ".join(f'"{term}"' for term in terms)


@lru_cache(maxsize=1)
def embedding_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(get_settings().embedding_model)


def preload_embedding_model() -> None:
    """Load the encoder on the main thread before serving requests."""
    with _EMBED_LOCK:
        embedding_model()


def encode_query(query: str):
    with _EMBED_LOCK:
        return embedding_model().encode(
            [query], normalize_embeddings=True, show_progress_bar=False
        )[0]


def _metadata(connection, span_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not span_ids:
        return {}
    placeholders = ",".join("?" for _ in span_ids)
    rows = connection.execute(
        f"""
        SELECT s.*,d.family,d.edition,n.label AS section_label
        FROM spans s
        JOIN documents d ON d.id=s.document_id
        LEFT JOIN nodes n ON n.id=s.section_id
        WHERE s.id IN ({placeholders})
        """,
        span_ids,
    ).fetchall()
    return {
        row["id"]: {
            "id": row["id"],
            "document_id": row["document_id"],
            "family": row["family"],
            "edition": row["edition"],
            "page_ordinal": row["page_ordinal"],
            "printed_label": row["printed_label"],
            "section_id": row["section_id"],
            "section_label": row["section_label"],
            "quote": row["raw_text"],
            "bbox": json.loads(row["bbox_json"]),
            "content_hash": row["content_hash"],
        }
        for row in rows
    }


def search(
    query: str,
    *,
    document_ids: list[str] | None = None,
    limit: int = 12,
    expand_graph: bool = True,
) -> list[dict[str, Any]]:
    """Hybrid FTS + cosine search, fused using reciprocal rank fusion."""
    with connect() as connection:
        params: list[Any] = [_fts_query(query)]
        doc_filter = ""
        if document_ids:
            placeholders = ",".join("?" for _ in document_ids)
            doc_filter = f" AND document_id IN ({placeholders})"
            params.extend(document_ids)
        lexical = connection.execute(
            f"""
            SELECT span_id,bm25(spans_fts) AS score
            FROM spans_fts WHERE spans_fts MATCH ? {doc_filter}
            ORDER BY score LIMIT 60
            """,
            params,
        ).fetchall()

        embed_params: list[Any] = []
        embed_filter = "embedding IS NOT NULL"
        if document_ids:
            placeholders = ",".join("?" for _ in document_ids)
            embed_filter += f" AND document_id IN ({placeholders})"
            embed_params.extend(document_ids)
        candidates = connection.execute(
            f"SELECT id,embedding FROM spans WHERE {embed_filter}", embed_params
        ).fetchall()
        semantic: list[tuple[str, float]] = []
        # Semantic encoding uses native libs that have segfaulted inside the API process.
        # Enable it only in isolated analysis workers (or when explicitly forced).
        use_semantic = os.environ.get("CLAUSE_ANALYSIS_WORKER") == "1" or os.environ.get(
            "CLAUSE_FORCE_SEMANTIC"
        ) == "1"
        if candidates and use_semantic:
            try:
                query_vector = encode_query(query)
                for row in candidates:
                    vector = np.frombuffer(row["embedding"], dtype=np.float32)
                    semantic.append((row["id"], float(np.dot(query_vector, vector))))
                semantic.sort(key=lambda item: item[1], reverse=True)
                semantic = semantic[:60]
            except Exception:
                semantic = []


        fused: dict[str, float] = {}
        channels: dict[str, list[str]] = {}
        for rank, row in enumerate(lexical, start=1):
            fused[row["span_id"]] = fused.get(row["span_id"], 0) + 1 / (60 + rank)
            channels.setdefault(row["span_id"], []).append("fts")
        for rank, (span_id, _) in enumerate(semantic, start=1):
            fused[span_id] = fused.get(span_id, 0) + 1 / (60 + rank)
            channels.setdefault(span_id, []).append("semantic")

        ranked = sorted(fused, key=fused.get, reverse=True)[:limit]
        metadata = _metadata(connection, ranked)
        results = []
        for rank, span_id in enumerate(ranked, start=1):
            item = metadata[span_id]
            item.update({"rank": rank, "rrf_score": fused[span_id], "channels": channels[span_id]})
            results.append(item)

        if expand_graph and results:
            section_ids = [item["section_id"] for item in results if item["section_id"]]
            if section_ids:
                placeholders = ",".join("?" for _ in section_ids)
                edges = connection.execute(
                    f"""
                    SELECT from_id,to_id,edge_type,target_label,resolution_status
                    FROM edges
                    WHERE from_id IN ({placeholders})
                      AND edge_type IN ('REFERENCES','NEXT')
                    LIMIT 24
                    """,
                    section_ids,
                ).fetchall()
                graph_by_section: dict[str, list[dict[str, Any]]] = {}
                for edge in edges:
                    graph_by_section.setdefault(edge["from_id"], []).append(dict(edge))
                for item in results:
                    item["graph_context"] = graph_by_section.get(item["section_id"], [])
        return results


def available_standard_ids() -> list[str]:
    with connect() as connection:
        return [
            row["id"]
            for row in connection.execute(
                "SELECT id FROM documents WHERE kind='standard' AND status='indexed' ORDER BY id"
            )
        ]

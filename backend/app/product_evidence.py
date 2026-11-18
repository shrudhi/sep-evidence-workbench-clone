"""Accused-product evidence and supplemental document helpers (§8 / analyst upload)."""

from __future__ import annotations

import uuid
from typing import Any

from .chart_schema import ensure_chart_schema
from .database import connect, transaction, utcnow


def list_accused_products(run_id: str) -> list[dict[str, Any]]:
    ensure_chart_schema()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM accused_products
            WHERE run_id=? ORDER BY created_at, name
            """,
            (run_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_accused_product(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_chart_schema()
    product_id = payload.get("product_id") or str(uuid.uuid4())
    now = utcnow()
    with transaction() as connection:
        existing = connection.execute(
            "SELECT id FROM accused_products WHERE id=? AND run_id=?",
            (product_id, run_id),
        ).fetchone()
        if existing:
            connection.execute(
                """
                UPDATE accused_products
                SET name=?, model=?, software_version=?, configuration=?, notes=?, updated_at=?
                WHERE id=? AND run_id=?
                """,
                (
                    payload["name"],
                    payload.get("model") or "",
                    payload.get("software_version") or "",
                    payload.get("configuration") or "",
                    payload.get("notes") or "",
                    now,
                    product_id,
                    run_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO accused_products(
                  id,run_id,name,model,software_version,configuration,notes,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    product_id,
                    run_id,
                    payload["name"],
                    payload.get("model") or "",
                    payload.get("software_version") or "",
                    payload.get("configuration") or "",
                    payload.get("notes") or "",
                    now,
                    now,
                ),
            )
    products = {item["id"]: item for item in list_accused_products(run_id)}
    return products[product_id]


def delete_accused_product(run_id: str, product_id: str) -> None:
    ensure_chart_schema()
    with transaction() as connection:
        connection.execute(
            "DELETE FROM accused_products WHERE id=? AND run_id=?",
            (product_id, run_id),
        )


def list_product_evidence(run_id: str, *, element_id: str | None = None) -> list[dict[str, Any]]:
    ensure_chart_schema()
    with connect() as connection:
        if element_id:
            rows = connection.execute(
                """
                SELECT pe.*, ap.name AS product_name, ap.model AS product_model,
                       ap.software_version AS product_software_version,
                       ce.label AS element_label
                FROM product_evidence pe
                JOIN accused_products ap ON ap.id=pe.product_id
                JOIN claim_elements ce ON ce.id=pe.element_id
                WHERE pe.run_id=? AND pe.element_id=?
                ORDER BY ap.name, ce.ordinal
                """,
                (run_id, element_id),
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT pe.*, ap.name AS product_name, ap.model AS product_model,
                       ap.software_version AS product_software_version,
                       ce.label AS element_label, ce.ordinal AS element_ordinal
                FROM product_evidence pe
                JOIN accused_products ap ON ap.id=pe.product_id
                JOIN claim_elements ce ON ce.id=pe.element_id
                WHERE pe.run_id=?
                ORDER BY ce.ordinal, ap.name
                """,
                (run_id,),
            ).fetchall()
    return [dict(row) for row in rows]


def upsert_product_evidence(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_chart_schema()
    now = utcnow()
    with transaction() as connection:
        product = connection.execute(
            "SELECT id FROM accused_products WHERE id=? AND run_id=?",
            (payload["product_id"], run_id),
        ).fetchone()
        if not product:
            raise KeyError("Unknown accused product")
        element = connection.execute(
            "SELECT id FROM claim_elements WHERE id=? AND run_id=?",
            (payload["element_id"], run_id),
        ).fetchone()
        if not element:
            raise KeyError("Unknown claim element")
        existing = connection.execute(
            """
            SELECT id FROM product_evidence
            WHERE element_id=? AND product_id=?
            """,
            (payload["element_id"], payload["product_id"]),
        ).fetchone()
        evidence_id = existing["id"] if existing else str(uuid.uuid4())
        if existing:
            connection.execute(
                """
                UPDATE product_evidence
                SET finding=?, evidence_text=?, evidence_source=?, source_link=?,
                    unverified_notes=?, updated_at=?
                WHERE id=?
                """,
                (
                    payload["finding"],
                    payload.get("evidence_text") or "",
                    payload.get("evidence_source") or "",
                    payload.get("source_link") or "",
                    payload.get("unverified_notes") or "",
                    now,
                    evidence_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO product_evidence(
                  id,run_id,element_id,product_id,finding,evidence_text,evidence_source,
                  source_link,unverified_notes,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    evidence_id,
                    run_id,
                    payload["element_id"],
                    payload["product_id"],
                    payload["finding"],
                    payload.get("evidence_text") or "",
                    payload.get("evidence_source") or "",
                    payload.get("source_link") or "",
                    payload.get("unverified_notes") or "",
                    now,
                    now,
                ),
            )
    items = {
        item["id"]: item
        for item in list_product_evidence(run_id, element_id=payload["element_id"])
    }
    return items[evidence_id]


def delete_product_evidence(run_id: str, evidence_id: str) -> None:
    ensure_chart_schema()
    with transaction() as connection:
        connection.execute(
            "DELETE FROM product_evidence WHERE id=? AND run_id=?",
            (evidence_id, run_id),
        )


def list_supplemental_documents(run_id: str) -> list[dict[str, Any]]:
    ensure_chart_schema()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM supplemental_documents
            WHERE run_id=? ORDER BY created_at DESC
            """,
            (run_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_supplemental_document(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_chart_schema()
    doc_id = str(uuid.uuid4())
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO supplemental_documents(
              id,run_id,title,kind,url_or_path,notes,created_at,created_by
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                doc_id,
                run_id,
                payload["title"],
                payload.get("kind") or "link",
                payload.get("url_or_path") or "",
                payload.get("notes") or "",
                utcnow(),
                "analyst",
            ),
        )
    docs = {item["id"]: item for item in list_supplemental_documents(run_id)}
    return docs[doc_id]


def delete_supplemental_document(run_id: str, document_id: str) -> None:
    ensure_chart_schema()
    with transaction() as connection:
        connection.execute(
            "DELETE FROM supplemental_documents WHERE id=? AND run_id=?",
            (document_id, run_id),
        )

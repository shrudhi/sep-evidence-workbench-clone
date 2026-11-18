"""Schema extensions for claim-chart assignment fields and product evidence."""

from __future__ import annotations

from typing import Any, Literal

from .database import connect, init_db

MATCH_STRENGTHS = (
    "direct support",
    "inference",
    "partial support",
    "no supporting passage",
)

REQUIREMENT_APPLICABILITIES = (
    "required",
    "required only under condition",
    "optional",
    "described only",
    "unclear",
)

MatchStrength = Literal[
    "direct support",
    "inference",
    "partial support",
    "no supporting passage",
]
RequirementApplicability = Literal[
    "required",
    "required only under condition",
    "optional",
    "described only",
    "unclear",
]

CHART_SCHEMA = """
CREATE TABLE IF NOT EXISTS accused_products (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  software_version TEXT,
  configuration TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL REFERENCES claim_elements(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES accused_products(id) ON DELETE CASCADE,
  finding TEXT NOT NULL,
  evidence_text TEXT NOT NULL DEFAULT '',
  evidence_source TEXT NOT NULL DEFAULT '',
  source_link TEXT NOT NULL DEFAULT '',
  unverified_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(element_id, product_id)
);

CREATE TABLE IF NOT EXISTS supplemental_documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link'
    CHECK(kind IN ('link','upload','note')),
  url_or_path TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'analyst'
);

CREATE INDEX IF NOT EXISTS idx_accused_products_run ON accused_products(run_id);
CREATE INDEX IF NOT EXISTS idx_product_evidence_run ON product_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_product_evidence_element ON product_evidence(element_id);
CREATE INDEX IF NOT EXISTS idx_supplemental_docs_run ON supplemental_documents(run_id);
"""


def derive_match_strength(
    mapping_label: str | None,
    *,
    evidence_status: str | None = None,
) -> MatchStrength:
    label = (mapping_label or "").strip()
    if label == "Full map":
        return "direct support"
    if label == "Partial map":
        if evidence_status == "informative":
            return "inference"
        return "partial support"
    if label == "No map":
        return "no supporting passage"
    return "no supporting passage"


def derive_requirement_applicability(
    evidence_status: str | None,
    *,
    mapping_label: str | None = None,
) -> RequirementApplicability:
    status = (evidence_status or "").strip()
    if status == "normative":
        return "required"
    if status == "conditional":
        return "required only under condition"
    if status == "informative":
        return "optional"
    if status == "unresolved" or mapping_label in {None, "", "Abstain", "No map"}:
        return "unclear"
    return "unclear"


def normalize_match_strength(value: Any, *, mapping_label: str | None = None,
                             evidence_status: str | None = None) -> MatchStrength:
    text = str(value or "").strip().lower()
    aliases = {
        "direct": "direct support",
        "direct support": "direct support",
        "inference": "inference",
        "requires inference": "inference",
        "support that requires an inference": "inference",
        "partial": "partial support",
        "partial support": "partial support",
        "no support": "no supporting passage",
        "no supporting passage": "no supporting passage",
        "no supporting passage found": "no supporting passage",
    }
    if text in aliases:
        return aliases[text]  # type: ignore[return-value]
    return derive_match_strength(mapping_label, evidence_status=evidence_status)


def normalize_requirement_applicability(
    value: Any,
    *,
    evidence_status: str | None = None,
    mapping_label: str | None = None,
) -> RequirementApplicability:
    text = str(value or "").strip().lower()
    aliases = {
        "required": "required",
        "required for the selected scope": "required",
        "required only under a condition": "required only under condition",
        "required only under condition": "required only under condition",
        "conditional": "required only under condition",
        "optional": "optional",
        "described only": "described only",
        "described": "described only",
        "unclear": "unclear",
    }
    if text in aliases:
        return aliases[text]  # type: ignore[return-value]
    return derive_requirement_applicability(
        evidence_status, mapping_label=mapping_label
    )


def enrich_mapping_tags(mapping: dict[str, Any]) -> dict[str, Any]:
    """Fill match_strength / requirement_applicability when missing."""
    label = mapping.get("mapping_label")
    status = mapping.get("evidence_status")
    mapping["match_strength"] = normalize_match_strength(
        mapping.get("match_strength"),
        mapping_label=label,
        evidence_status=status,
    )
    mapping["requirement_applicability"] = normalize_requirement_applicability(
        mapping.get("requirement_applicability"),
        evidence_status=status,
        mapping_label=label,
    )
    condition = str(mapping.get("requirement_condition") or "").strip()
    mapping["requirement_condition"] = condition
    return mapping


def ensure_chart_schema() -> None:
    init_db()
    with connect() as connection:
        connection.executescript(CHART_SCHEMA)
        cols = {
            row[1]
            for row in connection.execute("PRAGMA table_info(row_revisions)").fetchall()
        }
        alterations: list[str] = []
        if "match_strength" not in cols:
            alterations.append(
                "ALTER TABLE row_revisions ADD COLUMN match_strength TEXT"
            )
        if "requirement_applicability" not in cols:
            alterations.append(
                "ALTER TABLE row_revisions ADD COLUMN requirement_applicability TEXT"
            )
        if "requirement_condition" not in cols:
            alterations.append(
                "ALTER TABLE row_revisions ADD COLUMN requirement_condition TEXT DEFAULT ''"
            )
        for sql in alterations:
            connection.execute(sql)
        # analyst_decisions: optional override of Judge finding
        ad_cols = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(analyst_decisions)"
            ).fetchall()
        }
        if "overrides_judge" not in ad_cols:
            connection.execute(
                "ALTER TABLE analyst_decisions ADD COLUMN overrides_judge INTEGER NOT NULL DEFAULT 0"
            )
        if "judge_override_reason" not in ad_cols:
            connection.execute(
                "ALTER TABLE analyst_decisions ADD COLUMN judge_override_reason TEXT DEFAULT ''"
            )
        connection.commit()

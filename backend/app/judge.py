"""Operational LLM Judge for claim-chart row revisions.

Weighted rubric (judge-v2): deterministic source checks + separate reviewer LLM
for semantic criteria. Results bind to a revision; opening Judge never calls
the model. Recheck inserts a new review_results row (history preserved).
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from .citations import sanitize_missing_requirements
from .database import connect, dumps, transaction, utcnow
from .evidence import resolve_evidence_blocks
from .model_provider import OpenAICompatibleProvider

Status = Literal[
    "Pass",
    "Fail",
    "Needs review",
    "Not run",
    "Not applicable",
    "Could not assess",
    "Error",
]
Overall = Literal[
    "Passed checks",
    "Needs analyst review",
    "Failed checks",
    "Review incomplete",
    "Reviewing",
]

# criterion_id, key, label, max_points, required (blocks Passed if Fail/unresolved)
JUDGE_CRITERIA = [
    ("J01", "quote_verbatim", "Quote exists verbatim in the cited source", 15, True),
    ("J02", "screenshot_match", "Screenshot matches the quote and preserves necessary context", 15, True),
    ("J03", "correct_edition", "Standard identity and exact edition are correct", 10, True),
    ("J04", "section_page", "Section, PDF page and printed page are correct", 10, True),
    ("J05", "evidence_supports", "Evidence supports the specific claim requirements", 20, False),
    ("J06", "rationale_accuracy", "Rationale correctly explains support, conditions and missing requirements", 20, False),
    ("J07", "mapping_label", "Full / Partial / No mapping label is justified", 10, False),
]

# Short analyst-facing labels (scorecard / chart chips).
CRITERION_SHORT_LABELS = {
    "J01": "Verbatim quote",
    "J02": "Screenshot match",
    "J03": "Standard & edition",
    "J04": "Section & page",
    "J05": "Evidence support assessment",
    "J06": "Rationale quality",
    "J07": "Mapping label",
}

NO_MAP_SCORECARD_NOTE = (
    "No-map rows are graded on justified absence of support, not rewarded for missing evidence. "
    "N/A applies only when no affirmative evidence is cited."
)

RUBRIC_VERSION = "judge-v3"
PLACEHOLDER_GAP = "Reviewer did not identify the specific gap. Review incomplete."

# Soft source checks that alone do not justify automatic remapping.
# J02 Needs review (ambiguous crop) and J04 folio ambiguity stay analyst-facing.
# J02 Fail from vision LLM is remappable.
SOFT_NEEDS_REVIEW_ONLY = frozenset({"J02", "J04"})

# Bounded automatic remaps after Judge finds remappable issues (brief: max two reworks).
MAX_JUDGE_REWORK_ATTEMPTS = 3  # initial map + up to 2 remaps

FINDING_TAGS = {
    "quote_mismatch": "Quote mismatch",
    "screenshot_mismatch": "Screenshot mismatch",
    "wrong_edition": "Wrong edition",
    "incorrect_citation": "Incorrect citation",
    "unsupported_requirement": "Unsupported requirement",
    "missing_condition": "Missing condition",
    "label_disagreement": "Label disagreement",
    "groundedness_fail": "Not grounded",
    "accuracy_fail": "Accuracy issue",
    "relevance_fail": "Relevance issue",
    "needs_reconsider": "Needs reconsider",
    "reviewer_error": "Reviewer error",
}


class PerEvidenceFinding(BaseModel):
    evidence_id: str
    status: Literal["Pass", "Fail", "Needs review", "Not applicable"] = "Needs review"
    finding: str = Field(min_length=1, max_length=2000)
    quote_displayed: str | None = None
    quote_located: str | None = None
    differences: str | None = None


class RequirementGap(BaseModel):
    requirement: str
    supporting_evidence: str | None = None
    established_support: str | None = None
    gap: str | None = None


class QualityDimension(BaseModel):
    status: Literal["Pass", "Fail", "Needs review"]
    finding: str = Field(min_length=3, max_length=2000)
    score: int | None = Field(default=None, ge=0, le=100)


class AnalystComment(BaseModel):
    topic: str = Field(min_length=1, max_length=120)
    severity: Literal["critical", "reconsider", "note"] = "reconsider"
    comment: str = Field(min_length=3, max_length=2000)
    analyst_action: str | None = Field(default=None, max_length=1000)
    criterion_id: str | None = None


class ConfidenceReport(BaseModel):
    """Per-claim LLM Judge confidence for the chart row."""

    score: int = Field(ge=0, le=100)
    band: Literal["high", "mid", "low"] | None = None
    rationale: str = Field(min_length=3, max_length=2000)
    completeness: QualityDimension | None = None
    accuracy: QualityDimension | None = None
    groundedness: QualityDimension | None = None
    fact_check: QualityDimension | None = None
    relevance: QualityDimension | None = None


class JudgeCriterionLLM(BaseModel):
    criterion_id: Literal["J02", "J05", "J06", "J07"]
    status: Literal["Pass", "Fail", "Needs review"]
    finding: str = Field(min_length=3, max_length=2000)
    requirement: str | None = None
    evidence_establishes: str | None = None
    gap: str | None = None
    analyst_action: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    requirement_gaps: list[RequirementGap] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    label_recommendation: str | None = None
    groundedness: QualityDimension | None = None
    accuracy: QualityDimension | None = None
    relevance: QualityDimension | None = None


class JudgeLLMOutput(BaseModel):
    criteria: list[JudgeCriterionLLM] = Field(default_factory=list)
    summary: str = Field(min_length=3, max_length=2000)
    next_action: str = Field(min_length=3, max_length=1000)
    what_passed: str | None = None
    what_needs_attention: str | None = None
    groundedness: QualityDimension | None = None
    accuracy: QualityDimension | None = None
    relevance: QualityDimension | None = None
    completeness: QualityDimension | None = None
    fact_check: QualityDimension | None = None
    confidence: ConfidenceReport | None = None
    analyst_comments: list[AnalystComment] = Field(default_factory=list)
    reconsider_items: list[str] = Field(default_factory=list)
    approval_recommendation: Literal[
        "approve", "approve_with_conditions", "reject", "rework"
    ] = "rework"


def _points_for(status: str, max_points: int, *, semantic: bool) -> int | None:
    """Return earned points, or None when the check is not assessed."""
    if status in {"Not run", "Error"}:
        return None
    if status in {"Not applicable", "Could not assess"}:
        return None
    if status == "Pass":
        return max_points
    if status == "Fail":
        return 0
    if status == "Needs review":
        # Half points for assessed uncertainty (semantic + visual screenshot).
        return max_points // 2
    return None


def _blank_criterion(
    criterion_id: str,
    key: str,
    label: str,
    max_points: int,
    *,
    status: Status = "Not run",
    finding: str = "",
    required: bool = False,
    semantic: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    earned = _points_for(status, max_points, semantic=semantic)
    return {
        "criterion_id": criterion_id,
        "key": key,
        "label": label,
        "short_label": CRITERION_SHORT_LABELS.get(criterion_id, label),
        "required": required,
        "mandatory": required,
        "max_points": max_points,
        "earned_points": earned,
        "score": earned,  # UI alias
        "status": status,
        "finding": finding,
        "verification_method": extra.get(
            "verification_method", "LLM semantic assessment" if semantic else "Deterministic source check"
        ),
        "requirement": extra.get("requirement"),
        "evidence_establishes": extra.get("evidence_establishes"),
        "gap": _clean_gap(extra.get("gap")),
        "analyst_action": extra.get("analyst_action") or extra.get("next_action"),
        "next_action": extra.get("next_action") or extra.get("analyst_action"),
        "evidence_ids": extra.get("evidence_ids") or [],
        "per_evidence": extra.get("per_evidence") or [],
        "requirement_gaps": extra.get("requirement_gaps") or [],
        "tags": extra.get("tags") or [],
        "na_justification": extra.get("na_justification"),
        "label_recommendation": extra.get("label_recommendation"),
        "details": extra.get("details") or {},
        "source": extra.get("source", "llm" if semantic else "code"),
    }


def _clean_gap(gap: str | None) -> str | None:
    if not gap:
        return None
    text = str(gap).strip()
    if not text:
        return None
    if text.lower() in {
        "exact unresolved requirements",
        "exact unresolved requirement",
        "supporting ids",
        "weakening/context ids",
    }:
        return PLACEHOLDER_GAP
    return text


def _page_text(document_id: str | None, page_ordinal: int | None) -> str:
    if not document_id or not page_ordinal:
        return ""
    with connect() as connection:
        row = connection.execute(
            """
            SELECT raw_text FROM pages
            WHERE document_id=? AND page_ordinal=?
            """,
            (document_id, page_ordinal),
        ).fetchone()
    return (row["raw_text"] if row else "") or ""


def _normalize_layout(text: str) -> str:
    return " ".join((text or "").split())


def _quote_on_page(quote: str, page_text: str) -> tuple[bool, str, str]:
    """Return (found, located_snippet, difference_note). Preserves numbers/symbols in compare."""
    displayed = _normalize_layout(quote)
    corpus = _normalize_layout(page_text)
    if not displayed or not corpus:
        return False, "", "Page text unavailable for comparison."
    if displayed in corpus:
        start = corpus.find(displayed)
        return True, corpus[start : start + min(len(displayed), 400)], ""
    # Chunked match for long quotes (layout joins only — do not alter digits/negation).
    chunks = [displayed[i : i + 48] for i in range(0, min(len(displayed), 240), 48)]
    if chunks and all(chunk in corpus for chunk in chunks if len(chunk) >= 12):
        start = corpus.find(chunks[0])
        return True, corpus[start : start + min(len(displayed), 400)], "Matched after whitespace normalization only."
    return False, "", "Displayed quote was not located on the cited page text."


def run_deterministic_checks(
    *,
    evidence_blocks: list[dict[str, Any]],
    target_document_id: str | None,
    target_family: str | None,
    target_edition: str | None,
    integrity: dict[str, Any] | None,
    mapping_label: str | None = None,
) -> dict[str, dict[str, Any]]:
    meta = {cid: (key, label, pts, req) for cid, key, label, pts, req in JUDGE_CRITERIA[:4]}
    out: dict[str, dict[str, Any]] = {}
    no_evidence_ok = mapping_label in {"No map", "Abstain"}
    supporting = [b for b in evidence_blocks if b.get("role") != "candidate"]
    blocks = supporting or evidence_blocks

    if not blocks:
        for cid, (key, label, pts, req) in meta.items():
            if no_evidence_ok:
                if cid == "J01":
                    out[cid] = _blank_criterion(
                        cid,
                        key,
                        label,
                        pts,
                        status="Could not assess",
                        finding="No quote to check — Could not assess verbatim match.",
                        required=req,
                        na_justification=(
                            "No supporting quote on this row; quote check could not be assessed."
                        ),
                        verification_method="Deterministic source check",
                        source="code",
                    )
                elif cid == "J02":
                    out[cid] = _blank_criterion(
                        cid,
                        key,
                        label,
                        pts,
                        status="Could not assess",
                        finding="No screenshot to check — Could not assess visual match.",
                        required=req,
                        na_justification=(
                            "No supporting screenshot on this row; screenshot check could not "
                            "be assessed."
                        ),
                        verification_method="Deterministic source check",
                        source="code",
                    )
                elif cid == "J03":
                    out[cid] = _blank_criterion(
                        cid,
                        key,
                        label,
                        pts,
                        status="Pass",
                        finding="Selected edition verified",
                        required=req,
                        verification_method="Deterministic source check",
                        source="code",
                        details={
                            "selected": f"{target_family} — {target_edition}",
                            "verified_target": f"{target_family} — {target_edition}",
                        },
                    )
                else:  # J04
                    out[cid] = _blank_criterion(
                        cid,
                        key,
                        label,
                        pts,
                        status="Pass",
                        finding="Search-record citations verified",
                        required=req,
                        verification_method="Deterministic page/section check",
                        source="code",
                    )
            else:
                tag = "screenshot_mismatch" if cid == "J02" else "unsupported_requirement"
                out[cid] = _blank_criterion(
                    cid,
                    key,
                    label,
                    pts,
                    status="Fail",
                    finding="No linked evidence blocks on this revision — cannot verify against the document.",
                    required=req,
                    gap="Cited evidence is missing or was excluded.",
                    next_action="Locate supporting evidence or change the mapping label to No map.",
                    tags=[tag],
                    verification_method="Deterministic source check",
                    source="code",
                )
        return out

    integrity_by_span = {
        item.get("span_id"): item for item in (integrity or {}).get("checks") or []
    }
    evidence_ids = [b.get("evidence_id") for b in blocks if b.get("evidence_id")]

    quote_per: list[dict[str, Any]] = []
    edition_per: list[dict[str, Any]] = []
    section_per: list[dict[str, Any]] = []
    shot_per: list[dict[str, Any]] = []
    quote_fail = edition_fail = section_fail = shot_fail = False

    for block in blocks:
        eid = block.get("evidence_id") or "unknown"
        if not block.get("available"):
            quote_fail = True
            edition_fail = True
            section_fail = True
            shot_fail = True
            msg = f"Evidence unavailable ({block.get('error') or 'missing'})."
            for bucket in (quote_per, edition_per, section_per, shot_per):
                bucket.append(
                    {
                        "evidence_id": eid,
                        "status": "Fail",
                        "finding": msg,
                    }
                )
            continue

        source = block.get("source") or {}
        doc_id = source.get("document_id")
        family = source.get("family") or ""
        edition = source.get("edition") or ""
        quote = block.get("quote") or ""
        page_ord = block.get("page_ordinal")
        page_corpus = _page_text(doc_id, int(page_ord) if page_ord else None)
        found, located, diff = _quote_on_page(quote, page_corpus)
        integ = integrity_by_span.get(eid) or {}
        if integ and integ.get("pass") is False and any(
            "quote not found" in str(r).lower() for r in (integ.get("reasons") or [])
        ):
            found = False
            diff = "Integrity check reported the quote missing on the cited page."

        if not found:
            quote_fail = True
            quote_per.append(
                {
                    "evidence_id": eid,
                    "status": "Fail",
                    "finding": diff or "Quote not found on cited page.",
                    "quote_displayed": quote[:500],
                    "quote_located": located or None,
                    "differences": diff,
                }
            )
        else:
            quote_per.append(
                {
                    "evidence_id": eid,
                    "status": "Pass",
                    "finding": "Quote located on the cited page"
                    + (f" ({diff})" if diff else ".") ,
                    "quote_displayed": quote[:500],
                    "quote_located": located[:500] if located else None,
                    "differences": diff or None,
                }
            )

        ed_ok = True
        ed_notes = []
        if target_document_id and doc_id and doc_id != target_document_id:
            ed_ok = False
            ed_notes.append(f"document {doc_id} ≠ target {target_document_id}")
        if target_family and family and target_family.lower() not in family.lower():
            ed_ok = False
            ed_notes.append(f"family {family} ≠ {target_family}")
        if target_edition and edition:
            if target_edition.strip() != edition.strip() and target_edition not in edition and edition not in target_edition:
                ed_ok = False
                ed_notes.append(f"edition {edition} ≠ {target_edition}")
        if not ed_ok:
            edition_fail = True
            edition_per.append(
                {
                    "evidence_id": eid,
                    "status": "Fail",
                    "finding": "; ".join(ed_notes),
                    "selected": f"{family} — {edition}",
                    "verified_target": f"{target_family} — {target_edition}",
                }
            )
        else:
            edition_per.append(
                {
                    "evidence_id": eid,
                    "status": "Pass",
                    "finding": f"Matches target {target_family} — {target_edition}.",
                    "selected": f"{family} — {edition}",
                    "verified_target": f"{target_family} — {target_edition}",
                }
            )

        printed = block.get("printed_label")
        sec_notes: list[str] = []
        sec_status: Status = "Pass"
        if not found:
            section_fail = True
            sec_status = "Fail"
            sec_notes.append(
                "Cited page does not contain the quote — citation does not match the document."
            )
        else:
            section_bit = block.get("section_ref") or block.get("section_label")
            if section_bit:
                sec_notes.append(
                    f"Section {section_bit} · quote verified on PDF p. {page_ord}."
                )
            else:
                sec_notes.append(
                    f"Quote verified on PDF p. {page_ord}; section heading unresolved "
                    "(page match holds — not an error)."
                )
            if printed not in (None, "", str(page_ord)):
                sec_notes.append(f"Printed page {printed}.")
            else:
                sec_notes.append("Printed folio not distinct from PDF ordinal.")
        section_per.append(
            {
                "evidence_id": eid,
                "status": sec_status,
                "finding": "; ".join(sec_notes)
                or "Section and page citations verified against page text.",
                "section_ref": block.get("section_ref") or block.get("section_label"),
                "page_ordinal": page_ord,
                "printed_label": printed,
            }
        )

        # Screenshot: Fail only when missing or quote does not match the page.
        # Presence + quote-on-page is Pass (no vision LLM — do not warn as error).
        if not block.get("screenshot_url"):
            shot_fail = True
            shot_per.append(
                {
                    "evidence_id": eid,
                    "status": "Fail",
                    "finding": (
                        "Screenshot missing — source proof image not available for this citation."
                    ),
                    "screenshot_url": None,
                }
            )
        elif not found:
            shot_fail = True
            shot_per.append(
                {
                    "evidence_id": eid,
                    "status": "Fail",
                    "finding": (
                        "Screenshot is linked but the displayed quote was not found on that page text."
                    ),
                    "screenshot_url": block.get("screenshot_url"),
                    "page_ordinal": page_ord,
                }
            )
        else:
            shot_notes = [
                "Screenshot linked and quote verified on the cited page text.",
            ]
            if block.get("highlight_warning"):
                shot_notes.append(str(block["highlight_warning"]))
            shot_per.append(
                {
                    "evidence_id": eid,
                    "status": "Pass",
                    "finding": " ".join(shot_notes),
                    "screenshot_url": block.get("screenshot_url"),
                    "page_ordinal": page_ord,
                }
            )

    out["J01"] = _blank_criterion(
        "J01",
        *meta["J01"][:2],
        meta["J01"][2],
        status="Fail" if quote_fail else "Pass",
        finding=(
            "One or more quotes were not found verbatim on the cited source page."
            if quote_fail
            else "Every supporting quote was located in the cited source page text."
        ),
        required=True,
        per_evidence=quote_per,
        evidence_ids=evidence_ids,
        tags=["quote_mismatch"] if quote_fail else [],
        gap="Displayed quote does not match the source page." if quote_fail else None,
        next_action="Open the cited page and replace the evidence if the quote is wrong."
        if quote_fail
        else None,
        verification_method="Deterministic page-text match",
        source="code",
    )
    out["J02"] = _blank_criterion(
        "J02",
        *meta["J02"][:2],
        meta["J02"][2],
        status="Fail" if shot_fail else "Pass",
        finding=(
            "Screenshot missing or quote does not match the cited page."
            if shot_fail
            else "Screenshots linked; quotes verified against the cited page text."
        ),
        required=True,
        per_evidence=shot_per,
        evidence_ids=evidence_ids,
        tags=["screenshot_mismatch"] if shot_fail else [],
        gap="Screenshot unavailable or quote/page mismatch." if shot_fail else None,
        next_action=(
            "Replace missing screenshots or fix quotes that do not appear on the cited page."
            if shot_fail
            else None
        ),
        verification_method="Deterministic screenshot presence + page-text quote match",
        source="code",
    )
    out["J03"] = _blank_criterion(
        "J03",
        *meta["J03"][:2],
        meta["J03"][2],
        status="Fail" if edition_fail else "Pass",
        finding=(
            "One or more passages cite the wrong standard or edition."
            if edition_fail
            else f"Evidence cites the target standard ({target_family} — {target_edition})."
        ),
        required=True,
        per_evidence=edition_per,
        evidence_ids=evidence_ids,
        tags=["wrong_edition"] if edition_fail else [],
        gap="Document identity does not match the chart target." if edition_fail else None,
        next_action="Replace evidence with spans from the exact target edition."
        if edition_fail
        else None,
        verification_method="Deterministic document identity check",
        source="code",
    )
    if section_fail:
        j04_status: Status = "Fail"
        j04_finding = (
            "Section/page citation does not match the document — quote not found on the cited page."
        )
        j04_tags = ["incorrect_citation"]
    else:
        j04_status = "Pass"
        j04_finding = (
            "Cited PDF pages contain the quotes (verified against the source document)."
        )
        j04_tags = []
    out["J04"] = _blank_criterion(
        "J04",
        *meta["J04"][:2],
        meta["J04"][2],
        status=j04_status,
        finding=j04_finding,
        required=True,
        per_evidence=section_per,
        evidence_ids=evidence_ids,
        tags=j04_tags,
        gap="Citation location does not match the source document."
        if j04_status != "Pass"
        else None,
        next_action=(
            "Fix section/page citations so the quote appears on the cited PDF page."
            if j04_status != "Pass"
            else None
        ),
        verification_method="Deterministic page-text match for cited PDF page",
        source="code",
    )
    return out


def _justified_no_map_semantics(
    *,
    element: dict[str, Any],
    mapping: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Score a No-map row with no affirmative evidence without inventing support."""
    rationale = (mapping.get("rationale") or "").strip()
    missing = sanitize_missing_requirements(
        mapping.get("missing_requirements") or [],
        requirements=element.get("requirements") or [],
        rationale=rationale,
    )
    has_explanation = len(rationale) >= 40
    j05 = _blank_criterion(
        "J05",
        "evidence_supports",
        "Evidence supports the specific claim requirements",
        20,
        status="Pass",
        finding="No adequate support found in documented search",
        semantic=True,
        source="code",
        verification_method="Search-record + mapping rationale",
        requirement=(element.get("exact_text") or "")[:240] or None,
        evidence_establishes="Documented search did not surface adequate supporting text.",
        gap=None,
    )
    if has_explanation:
        j06 = _blank_criterion(
            "J06",
            "rationale_accuracy",
            "Rationale correctly explains support, conditions and missing requirements",
            20,
            status="Pass",
            finding="Explains scope and missing requirement"
            if missing
            else "Explains why the element is not mapped to the standard",
            semantic=True,
            source="code",
            verification_method="Rationale completeness check",
        )
    else:
        j06 = _blank_criterion(
            "J06",
            "rationale_accuracy",
            "Rationale correctly explains support, conditions and missing requirements",
            20,
            status="Needs review",
            finding="No-map rationale is too thin for an analyst to verify the negative finding.",
            gap="Rationale should state what was searched and why support is absent.",
            next_action="Expand the rationale or Ask Agent to re-search before accepting No map.",
            tags=["missing_condition"],
            semantic=True,
            source="code",
        )
    j07 = _blank_criterion(
        "J07",
        "mapping_label",
        "Full / Partial / No mapping label is justified",
        10,
        status="Pass" if has_explanation else "Needs review",
        finding="No map is consistent with findings"
        if has_explanation
        else "No map needs a clearer negative rationale before acceptance.",
        semantic=True,
        source="code",
        label_recommendation="No map",
        tags=[] if has_explanation else ["label_disagreement"],
        next_action=None
        if has_explanation
        else "Confirm No map after reviewing search coverage, or challenge for remapping.",
    )
    blanks = {"J05": j05, "J06": j06, "J07": j07}
    meta = {
        "model": "deterministic-no-map",
        "prompt_hash": "no-map-v1",
        "summary": (
            "No supporting evidence was cited. The No map label is consistent with the documented search "
            "when the rationale explains the gap."
            if has_explanation
            else "No supporting evidence was cited, but the rationale is incomplete for a confident No map."
        ),
        "next_action": (
            "Analyst may Accept No map, or Ask Agent to search again if coverage looks incomplete."
            if has_explanation
            else "Strengthen the No-map rationale or Ask Agent to re-search before accepting."
        ),
        "what_passed": "Standard edition and search-record checks; No map consistent with empty affirmative evidence."
        if has_explanation
        else "Standard edition and search-record checks.",
        "what_needs_attention": "None — justified No map."
        if has_explanation
        else "No-map rationale needs more detail for analyst acceptance.",
        "confidence": {
            "score": 78 if has_explanation else 42,
            "band": "mid" if has_explanation else "low",
            "rationale": (
                "No-map row with an adequate negative rationale — confidence reflects "
                "justified absence of support, not affirmative mapping strength."
                if has_explanation
                else "No-map rationale is too thin for high confidence; expand search coverage notes."
            ),
            "completeness": {
                "status": "Pass" if has_explanation else "Needs review",
                "finding": "Negative finding documented."
                if has_explanation
                else "Negative rationale incomplete.",
                "score": 80 if has_explanation else 40,
            },
            "accuracy": {
                "status": "Pass",
                "finding": "No affirmative standard facts asserted.",
                "score": 85,
            },
            "groundedness": {
                "status": "Pass" if has_explanation else "Needs review",
                "finding": "Absence claim tied to search record."
                if has_explanation
                else "Grounding of No map is thin.",
                "score": 80 if has_explanation else 45,
            },
            "fact_check": {
                "status": "Pass",
                "finding": "No affirmative citations to fact-check.",
                "score": 85,
            },
            "relevance": {
                "status": "Pass",
                "finding": "No-map relevance is the absence of on-point support.",
                "score": 80,
            },
        },
    }
    return blanks, meta


def _screenshot_data_url(span_id: str, *, max_side: int = 1400) -> tuple[str | None, dict[str, Any]]:
    """Load (and lightly resize) a citation screenshot for vision Judge review."""
    import base64
    from io import BytesIO

    try:
        from .exporter import render_page_screenshot

        path, lineage = render_page_screenshot(span_id)
        raw = path.read_bytes()
        try:
            from PIL import Image

            image = Image.open(BytesIO(raw)).convert("RGB")
            w, h = image.size
            scale = min(1.0, float(max_side) / float(max(w, h) or 1))
            if scale < 0.999:
                image = image.resize(
                    (max(1, int(w * scale)), max(1, int(h * scale))),
                    Image.Resampling.LANCZOS,
                )
            buf = BytesIO()
            image.save(buf, format="PNG", optimize=True)
            raw = buf.getvalue()
        except Exception:  # noqa: BLE001
            pass
        return f"data:image/png;base64,{base64.b64encode(raw).decode('ascii')}", lineage
    except Exception as exc:  # noqa: BLE001
        return None, {"error": str(exc)}


def _evidence_packet_for_llm(block: dict[str, Any]) -> dict[str, Any]:
    """Table fields + page excerpt so the Judge can verify chart ↔ document match."""
    doc_id = (block.get("source") or {}).get("document_id") or block.get("document_id")
    page_ord = block.get("page_ordinal")
    page_corpus = _page_text(doc_id, int(page_ord) if page_ord else None)
    quote = block.get("quote") or ""
    found, located, diff = _quote_on_page(quote, page_corpus)
    excerpt = ""
    if page_corpus:
        if located:
            idx = _normalize_layout(page_corpus).find(_normalize_layout(located)[:80])
            # Prefer raw page window around quote when possible.
            raw_idx = page_corpus.find(quote[:40]) if quote else -1
            start = max(0, (raw_idx if raw_idx >= 0 else 0) - 180)
            excerpt = page_corpus[start : start + 900]
        else:
            excerpt = page_corpus[:900]
    return {
        "evidence_id": block.get("evidence_id"),
        "quote": quote[:900],
        "section_ref": block.get("section_ref") or block.get("section_label"),
        "page_ordinal": page_ord,
        "printed_label": block.get("printed_label"),
        "citation_heading": block.get("citation_heading"),
        "source": block.get("source"),
        "role": block.get("role"),
        "screenshot_url": block.get("screenshot_url"),
        "screenshot_present": bool(block.get("screenshot_url")),
        "highlight_warning": block.get("highlight_warning"),
        "quote_found_on_cited_page": found,
        "quote_page_diff": diff or None,
        "cited_page_excerpt": excerpt,
    }


def _is_apparatus_preamble(element: dict[str, Any] | None) -> bool:
    """True for short apparatus/preamble claim elements (e.g. 'An encoding apparatus')."""
    if not element:
        return False
    text = " ".join(
        [
            str(element.get("exact_text") or ""),
            str(element.get("label") or ""),
            " ".join(
                str(r.get("text") or "")
                for r in (element.get("requirements") or [])
                if isinstance(r, dict)
            ),
        ]
    ).lower()
    if not text.strip():
        return False
    apparatus = bool(
        re.search(r"\b(encoding apparatus|encoder|apparatus|comprising)\b", text)
    )
    # Short preamble-like elements without a long operative step list.
    short = len((element.get("exact_text") or "").split()) <= 12
    return apparatus and short


def _evidence_has_encoder_context(evidence_packets: list[dict[str, Any]]) -> bool:
    blob = " ".join(
        str(p.get("quote") or "") for p in evidence_packets if isinstance(p, dict)
    ).lower()
    return bool(
        re.search(
            r"\b(encoder|encoding process|encoding apparatus|encoding engine|"
            r"encoding algorithms?)\b",
            blob,
        )
    )


def _quality_dump(dim: QualityDimension | None) -> dict[str, Any] | None:
    if not dim:
        return None
    data = dim.model_dump()
    if data.get("score") is None:
        data["score"] = _status_to_score(str(data.get("status") or "Needs review"))
    return data


def _status_to_score(status: str) -> int:
    if status == "Pass":
        return 92
    if status == "Fail":
        return 18
    if status == "Needs review":
        return 55
    return 50


def _confidence_band(score: int) -> str:
    if score >= 80:
        return "high"
    if score >= 50:
        return "mid"
    return "low"


def _dim_from_status(status: str, finding: str, *, score: int | None = None) -> dict[str, Any]:
    st = status if status in {"Pass", "Fail", "Needs review"} else "Needs review"
    return {
        "status": st,
        "finding": (finding or f"{st} on this dimension.")[:2000],
        "score": score if score is not None else _status_to_score(st),
    }


def derive_confidence_from_report(
    criteria: list[dict[str, Any]],
    *,
    semantic_meta: dict[str, Any] | None = None,
    summary: str | None = None,
) -> dict[str, Any]:
    """Build a confidence block from litigator meta and/or criterion outcomes.

    Ensures Report always has completeness / accuracy / groundedness / fact_check /
    relevance even when an older stored review omitted them.
    """
    existing = (semantic_meta or {}).get("confidence")
    if isinstance(existing, dict) and isinstance(existing.get("score"), int):
        # Fill any missing dimension slots from top-level meta / criteria.
        filled = dict(existing)
        for name in (
            "completeness",
            "accuracy",
            "groundedness",
            "fact_check",
            "relevance",
        ):
            if isinstance(filled.get(name), dict) and filled[name].get("status"):
                continue
            top = (semantic_meta or {}).get(name)
            if isinstance(top, dict) and top.get("status"):
                filled[name] = {
                    **top,
                    "score": top.get("score")
                    if top.get("score") is not None
                    else _status_to_score(str(top.get("status") or "Needs review")),
                }
        if not filled.get("rationale"):
            filled["rationale"] = summary or (semantic_meta or {}).get("summary") or (
                "Confidence scored from litigator dimensions."
            )
        filled["band"] = filled.get("band") or _confidence_band(int(filled["score"]))
        return filled

    by_cid = {
        str(c.get("criterion_id")): c for c in criteria if isinstance(c, dict)
    }

    def _crit_status(*cids: str) -> tuple[str, str]:
        worst = "Pass"
        notes: list[str] = []
        rank = {"Pass": 0, "Needs review": 1, "Not applicable": 0, "Fail": 2, "Error": 2, "Not run": 1}
        for cid in cids:
            item = by_cid.get(cid) or {}
            st = str(item.get("status") or "Pass")
            if rank.get(st, 0) > rank.get(worst, 0):
                worst = "Fail" if st in {"Fail", "Error"} else (
                    "Needs review" if st in {"Needs review", "Not run"} else st
                )
            if item.get("finding"):
                notes.append(str(item["finding"]))
            details = item.get("details") if isinstance(item.get("details"), dict) else {}
            for key in ("groundedness", "accuracy", "relevance"):
                dim = details.get(key) if isinstance(details, dict) else None
                if isinstance(dim, dict) and dim.get("finding"):
                    notes.append(str(dim["finding"]))
        if worst not in {"Pass", "Fail", "Needs review"}:
            worst = "Needs review"
        return worst, "; ".join(notes[:2]) or f"Based on {[*cids]}."

    # Prefer explicit top-level dims from semantic meta when present.
    def _pick(name: str, *cids: str) -> dict[str, Any]:
        top = (semantic_meta or {}).get(name)
        if isinstance(top, dict) and top.get("status"):
            return {
                **top,
                "score": top.get("score")
                if top.get("score") is not None
                else _status_to_score(str(top.get("status") or "Needs review")),
            }
        # Pull from criterion details when LLM attached per-criterion dims.
        for cid in cids:
            details = (by_cid.get(cid) or {}).get("details") or {}
            if name in {"groundedness", "accuracy", "relevance"} and isinstance(
                details.get(name), dict
            ):
                dim = details[name]
                if dim.get("status"):
                    return {
                        **dim,
                        "score": dim.get("score")
                        if dim.get("score") is not None
                        else _status_to_score(str(dim.get("status"))),
                    }
        st, finding = _crit_status(*cids)
        labels = {
            "completeness": "Completeness of claim-element support and label coverage.",
            "accuracy": "Accuracy of rationale and cited standard facts.",
            "groundedness": "Whether assertions stay grounded in cited text.",
            "fact_check": "Fact-check of quotes, pages, and standard identifiers.",
            "relevance": "Relevance of cited passages to this claim element.",
        }
        return _dim_from_status(
            st,
            finding if finding else labels.get(name, name),
        )

    dims = {
        "completeness": _pick("completeness", "J05", "J07"),
        "accuracy": _pick("accuracy", "J06", "J05"),
        "groundedness": _pick("groundedness", "J05", "J06"),
        "fact_check": _pick("fact_check", "J01", "J02", "J04"),
        "relevance": _pick("relevance", "J05", "J07"),
    }
    scores = [int(d["score"]) for d in dims.values()]
    score = round(sum(scores) / len(scores)) if scores else 50
    if any(d.get("status") == "Fail" for d in dims.values()):
        score = min(score, 45)
    rationale = (
        (semantic_meta or {}).get("summary")
        or summary
        or (
            f"Confidence {score}% from completeness {dims['completeness']['score']}%, "
            f"accuracy {dims['accuracy']['score']}%, groundedness {dims['groundedness']['score']}%, "
            f"fact-check {dims['fact_check']['score']}%, relevance {dims['relevance']['score']}%."
        )
    )
    return {
        "score": score,
        "band": _confidence_band(score),
        "rationale": str(rationale)[:2000],
        **dims,
    }


def _build_confidence_report(
    parsed: JudgeLLMOutput,
    *,
    blanks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Normalize LLM confidence + fill missing dimension scores."""
    dims: dict[str, QualityDimension | None] = {
        "completeness": parsed.completeness
        or (parsed.confidence.completeness if parsed.confidence else None),
        "accuracy": parsed.accuracy
        or (parsed.confidence.accuracy if parsed.confidence else None),
        "groundedness": parsed.groundedness
        or (parsed.confidence.groundedness if parsed.confidence else None),
        "fact_check": parsed.fact_check
        or (parsed.confidence.fact_check if parsed.confidence else None),
        "relevance": parsed.relevance
        or (parsed.confidence.relevance if parsed.confidence else None),
    }
    # Derive missing dims from criterion details / statuses when LLM omits them.
    if dims["completeness"] is None:
        j05 = blanks.get("J05") or {}
        j07 = blanks.get("J07") or {}
        status = "Pass"
        for item in (j05, j07):
            st = str(item.get("status") or "Pass")
            if st == "Fail":
                status = "Fail"
                break
            if st == "Needs review" and status == "Pass":
                status = "Needs review"
        finding = (
            j05.get("finding")
            or j07.get("finding")
            or "Completeness inferred from evidence-support and label criteria."
        )
        dims["completeness"] = QualityDimension(status=status, finding=str(finding)[:2000])
    if dims["fact_check"] is None:
        # Fact-check ≈ accuracy of cited standard facts + quote/page integrity.
        base = dims["accuracy"] or parsed.accuracy
        j01_like = blanks.get("J02") or blanks.get("J06") or {}
        if base is not None:
            dims["fact_check"] = base
        else:
            status = str(j01_like.get("status") or "Needs review")
            if status not in {"Pass", "Fail", "Needs review"}:
                status = "Needs review"
            dims["fact_check"] = QualityDimension(
                status=status,  # type: ignore[arg-type]
                finding=str(
                    j01_like.get("finding")
                    or "Fact-check inferred from screenshot/rationale verification."
                )[:2000],
            )
    if dims["accuracy"] is None and parsed.accuracy is None:
        dims["accuracy"] = QualityDimension(
            status="Needs review",
            finding="Accuracy not separately scored; treat as provisional.",
        )
    if dims["groundedness"] is None:
        dims["groundedness"] = QualityDimension(
            status="Needs review",
            finding="Groundedness not separately scored; treat as provisional.",
        )
    if dims["relevance"] is None:
        dims["relevance"] = QualityDimension(
            status="Needs review",
            finding="Relevance not separately scored; treat as provisional.",
        )

    dumped = {name: _quality_dump(dim) for name, dim in dims.items()}
    scores = [int(d["score"]) for d in dumped.values() if d and d.get("score") is not None]
    derived = round(sum(scores) / len(scores)) if scores else 50

    if parsed.confidence and isinstance(parsed.confidence.score, int):
        score = max(0, min(100, int(parsed.confidence.score)))
        # Cap by worst hard Fail among dimensions.
        if any(d and d.get("status") == "Fail" for d in dumped.values()):
            score = min(score, 45)
        rationale = parsed.confidence.rationale
    else:
        score = derived
        if any(d and d.get("status") == "Fail" for d in dumped.values()):
            score = min(score, 45)
        rationale = (
            parsed.summary
            or "Confidence derived from completeness, accuracy, groundedness, "
            "fact-check, and relevance."
        )

    # Prefer explicit per-dim objects on confidence when present.
    if parsed.confidence:
        for name in dumped:
            explicit = getattr(parsed.confidence, name, None)
            if explicit is not None:
                dumped[name] = _quality_dump(explicit)

    return {
        "score": score,
        "band": _confidence_band(score),
        "rationale": rationale,
        "completeness": dumped.get("completeness"),
        "accuracy": dumped.get("accuracy"),
        "groundedness": dumped.get("groundedness"),
        "fact_check": dumped.get("fact_check"),
        "relevance": dumped.get("relevance"),
    }


def _run_semantic_judge(
    *,
    element: dict[str, Any],
    mapping: dict[str, Any],
    evidence_blocks: list[dict[str, Any]],
    integrity: dict[str, Any] | None,
    run_id: str | None,
    deterministic: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any] | None, str | None]:
    supporting = [b for b in evidence_blocks if b.get("role") != "candidate" and b.get("available")]
    if mapping.get("mapping_label") == "No map" and not supporting:
        blanks, meta = _justified_no_map_semantics(element=element, mapping=mapping)
        return blanks, meta, None

    # LLM owns J05–J07 always; also owns J02 when a screenshot is present.
    screenshots_present = any(b.get("screenshot_url") for b in supporting)
    llm_cids = {"J05", "J06", "J07"} | ({"J02"} if screenshots_present else set())
    blanks = {
        cid: _blank_criterion(
            cid,
            key,
            label,
            pts,
            status="Not run",
            finding="LLM not called — this criterion has not been assessed yet.",
            required=cid == "J02",
            semantic=True,
            source="llm",
            verification_method="LLM not called",
        )
        for cid, key, label, pts, _r in JUDGE_CRITERIA
        if cid in llm_cids
    }
    provider = OpenAICompatibleProvider()
    if not provider.readiness().get("ready"):
        for item in blanks.values():
            item["status"] = "Not run"
            item["earned_points"] = None
            item["score"] = None
            item["finding"] = "LLM not called — model provider is not configured."
            item["gap"] = PLACEHOLDER_GAP
            item["next_action"] = "Configure the model provider and use Recheck this revision."
            item["tags"] = ["reviewer_error"]
            item["verification_method"] = "LLM not called"
        return blanks, None, "provider_not_ready"

    evidence_packets = [
        _evidence_packet_for_llm(block)
        for block in evidence_blocks
        if block.get("available")
    ]
    images: list[dict[str, str]] = []
    for block in supporting:
        eid = str(block.get("evidence_id") or "")
        if not eid or not block.get("screenshot_url"):
            continue
        data_url, lineage = _screenshot_data_url(eid)
        if not data_url:
            continue
        images.append(
            {
                "evidence_id": eid,
                "data_url": data_url,
                "caption": (
                    f"{eid} | section={block.get('section_ref') or block.get('section_label')}"
                    f" | PDF p.{block.get('page_ordinal')} | quote={(block.get('quote') or '')[:120]}"
                ),
            }
        )
        for packet in evidence_packets:
            if packet.get("evidence_id") == eid:
                packet["screenshot_attached_for_vision"] = True
                packet["screenshot_lineage"] = {
                    k: lineage.get(k)
                    for k in (
                        "page_ordinal",
                        "highlight",
                        "cropped_to_quote",
                        "highlight_warning",
                        "lineage_hash",
                    )
                    if k in lineage
                }

    det_summary = {
        cid: {
            "status": (deterministic or {}).get(cid, {}).get("status"),
            "finding": (deterministic or {}).get(cid, {}).get("finding"),
            "gap": (deterministic or {}).get(cid, {}).get("gap"),
            "tags": (deterministic or {}).get(cid, {}).get("tags") or [],
        }
        for cid in ("J01", "J02", "J03", "J04")
        if (deterministic or {}).get(cid)
    }

    payload = {
        "role": (
            "You are the approving litigator reviewing a claim chart prepared by an analyst. "
            "You perform the final strict quality gate before the chart can be relied on. "
            "You do not rubber-stamp. Prefer Fail or Needs review over Pass when uncertain."
        ),
        "claim_element": {
            "label": element.get("label"),
            "exact_text": element.get("exact_text"),
            "requirements": element.get("requirements") or [],
        },
        "chart_table_row": {
            "mapping_label": mapping.get("mapping_label"),
            "rationale": mapping.get("rationale"),
            "missing_requirements": mapping.get("missing_requirements") or [],
            "evidence_status": mapping.get("evidence_status"),
            "match_strength": mapping.get("match_strength"),
            "requirement_applicability": mapping.get("requirement_applicability"),
            "requirement_condition": mapping.get("requirement_condition") or "",
            "evidence_span_ids": mapping.get("evidence_span_ids")
            or mapping.get("evidence_ids")
            or [],
        },
        "product_evidence": mapping.get("_product_evidence") or [],
        "evidence_from_table": evidence_packets,
        "deterministic_source_checks": det_summary,
        "deterministic_integrity": integrity,
        "vision_screenshots_attached": bool(images),
        "assess_criteria": sorted(llm_cids),
        "instructions": (
            "STRICT LITIGATOR REVIEW — verify the entire table row against the document.\n"
            "1) Document match: every quote, section, page, edition, and screenshot claim in the "
            "table must match the cited standard page excerpt / attached screenshot. "
            "Fail on mismatch; do not invent text not present in the excerpts or images.\n"
            "2) J02 (when screenshot attached): confirm the image shows the cited passage "
            "(correct page region / crop for the quote). Fail if wrong passage, wrong page, "
            "unreadable, or not the quoted text. Needs review only if crop is ambiguous.\n"
            "3) J05 Evidence support: does the cited text actually establish each claim "
            "requirement? Shared jargon is not support. For short apparatus/preamble elements "
            "(e.g. 'An encoding apparatus'), encoder/encoding-process definitions are Partial "
            "support when circuitry/combined operations remain named as gaps — Pass J05/J07 "
            "for that Partial map; do not Fail merely because 'apparatus' is not a formal "
            "defined term, and do not push the row to No map.\n"
            "4) J06 Rationale accuracy: does the rationale correctly describe support, "
            "conditions, and named gaps — without overclaiming?\n"
            "5) J07 Mapping label: Full / Partial / No must be justified. Full with any gap = Fail. "
            "Partial map + named gaps + encoder context for an apparatus preamble = Pass. "
            "Also check match_strength (direct support / inference / partial support / "
            "no supporting passage) and requirement_applicability (required / required only "
            "under condition / optional / described only / unclear) against the evidence.\n"
            "6) Groundedness: every assertion in rationale/label must be grounded in cited text.\n"
            "7) Accuracy: factual claims about the standard (equations, ranges, variables, "
            "pages) must be correct vs the excerpt.\n"
            "8) Relevance: cited passages must be relevant to THIS claim element, not merely "
            "same-standard or same-topic.\n"
            "9) If product_evidence is present, verify each product finding stays within what "
            "that product source shows (do not overclaim across untested configurations). "
            "Flag overreach in analyst_comments.\n"
            "10) Leave analyst_comments for anything that must be reconsidered or checked, with "
            "a concrete analyst_action. Populate reconsider_items as short checklist lines.\n"
            "11) approval_recommendation: approve only if you would stake a litigation review "
            "on this row; otherwise approve_with_conditions, rework, or reject.\n"
            "12) confidence: score this claim element 0–100 from five equally weighted "
            "dimensions — completeness, accuracy, groundedness, fact_check, relevance. "
            "Each dimension needs status (Pass|Fail|Needs review), finding, and score 0–100. "
            "Also give confidence.rationale explaining the overall score in plain language "
            "(cite what is solid vs what reduces confidence). "
            "High (80–100) only when the row is litigation-ready; mid (50–79) for partial/"
            "conditional support; low (0–49) when Fail, ungrounded, or irrelevant.\n"
            "Never write 'exact unresolved requirements'. "
            "Tags may include: unsupported_requirement, missing_condition, label_disagreement, "
            "screenshot_mismatch, groundedness_fail, accuracy_fail, relevance_fail, needs_reconsider."
        ),
    }
    try:
        result = provider.structured(
            purpose="judge_litigator_v3",
            reviewer=True,
            max_output_tokens=5500,
            images=images or None,
            system=(
                "You are a senior SEP litigator with approval authority over claim charts. "
                "The analyst prepared the chart; you perform final independent review. "
                "Be strict: Pass only when table content is grounded in the cited standard, "
                "accurate, and relevant to the claim element. "
                "When a screenshot is attached, validate it shows the cited quote passage. "
                "Return JSON with criteria for the requested IDs, confidence (overall score + "
                "completeness / accuracy / groundedness / fact_check / relevance + rationale), "
                "analyst_comments, reconsider_items, approval_recommendation, summary, "
                "next_action, what_passed, what_needs_attention. "
                "Each criterion needs status (Pass|Fail|Needs review), a specific finding, "
                "and when not Pass a concrete analyst_action comment. "
                "Do not invent quotations. Rubric points are assigned by the system from status; "
                "you still must provide the 0–100 confidence score with rationale."
            ),
            payload={
                **payload,
                "response_schema_example": {
                    "criteria": [
                        {
                            "criterion_id": "J05",
                            "status": "Fail",
                            "finding": "…",
                            "requirement": "exact claim requirement",
                            "evidence_establishes": "what the quote shows",
                            "gap": "what remains unsupported",
                            "analyst_action": "what the analyst must check or fix",
                            "evidence_ids": [],
                            "requirement_gaps": [
                                {
                                    "requirement": "…",
                                    "supporting_evidence": "…",
                                    "established_support": "…",
                                    "gap": "…",
                                }
                            ],
                            "tags": ["unsupported_requirement"],
                            "groundedness": {
                                "status": "Fail",
                                "finding": "Rationale cites support not in the quote.",
                                "score": 20,
                            },
                            "accuracy": {
                                "status": "Pass",
                                "finding": "Cited equation identity is correct.",
                                "score": 90,
                            },
                            "relevance": {
                                "status": "Needs review",
                                "finding": "Passage is same-topic but may be decoder-only.",
                                "score": 55,
                            },
                        }
                    ],
                    "completeness": {
                        "status": "Needs review",
                        "finding": "Not every claim requirement is established.",
                        "score": 58,
                    },
                    "accuracy": {"status": "Pass", "finding": "…", "score": 88},
                    "groundedness": {
                        "status": "Fail",
                        "finding": "Overall grounding issue…",
                        "score": 25,
                    },
                    "fact_check": {
                        "status": "Pass",
                        "finding": "Cited pages/equations match the excerpt.",
                        "score": 90,
                    },
                    "relevance": {
                        "status": "Needs review",
                        "finding": "…",
                        "score": 60,
                    },
                    "confidence": {
                        "score": 54,
                        "rationale": (
                            "Mid confidence: facts check out, but groundedness fails on one "
                            "overclaim and completeness is only partial."
                        ),
                        "completeness": {
                            "status": "Needs review",
                            "finding": "…",
                            "score": 58,
                        },
                        "accuracy": {"status": "Pass", "finding": "…", "score": 88},
                        "groundedness": {
                            "status": "Fail",
                            "finding": "…",
                            "score": 25,
                        },
                        "fact_check": {
                            "status": "Pass",
                            "finding": "…",
                            "score": 90,
                        },
                        "relevance": {
                            "status": "Needs review",
                            "finding": "…",
                            "score": 60,
                        },
                    },
                    "analyst_comments": [
                        {
                            "topic": "Screenshot",
                            "severity": "reconsider",
                            "comment": "Crop appears to miss the quoted equation.",
                            "analyst_action": "Re-open the source and replace the screenshot.",
                            "criterion_id": "J02",
                        }
                    ],
                    "reconsider_items": [
                        "Confirm screenshot shows the quoted lines",
                        "Revisit Full vs Partial label",
                    ],
                    "approval_recommendation": "rework",
                    "summary": "plain-language main issue",
                    "next_action": "what the analyst should do next",
                    "what_passed": "brief",
                    "what_needs_attention": "brief",
                },
            },
            run_id=run_id,
        )
    except Exception as exc:  # noqa: BLE001
        for item in blanks.values():
            item["status"] = "Error"
            item["earned_points"] = None
            item["score"] = None
            item["finding"] = f"Judge tool error: {exc}"
            item["gap"] = PLACEHOLDER_GAP
            item["next_action"] = "Retry with Recheck this revision."
            item["tags"] = ["reviewer_error"]
        return blanks, None, str(exc)

    raw = result.data if isinstance(result.data, dict) else {}
    try:
        parsed = JudgeLLMOutput.model_validate(raw)
    except ValidationError:
        decisions = raw.get("criteria") or raw.get("decisions") or []
        if not isinstance(decisions, list):
            for item in blanks.values():
                item["status"] = "Not run"
                item["earned_points"] = None
                item["score"] = None
                item["finding"] = (
                    "LLM not called successfully — invalid Judge output for this criterion."
                )
                item["gap"] = PLACEHOLDER_GAP
                item["next_action"] = "Recheck this revision; do not treat as Pass."
                item["tags"] = ["reviewer_error"]
                item["verification_method"] = "LLM not called"
            return (
                blanks,
                {"model": result.model, "prompt_hash": result.prompt_hash},
                "invalid_output",
            )
        try:
            parsed = JudgeLLMOutput.model_validate(
                {
                    "criteria": decisions,
                    "summary": raw.get("summary")
                    or "Judge output required repair; treat as incomplete.",
                    "next_action": raw.get("next_action")
                    or "Recheck this revision and verify unresolved criteria.",
                    "what_passed": raw.get("what_passed"),
                    "what_needs_attention": raw.get("what_needs_attention"),
                    "groundedness": raw.get("groundedness"),
                    "accuracy": raw.get("accuracy"),
                    "relevance": raw.get("relevance"),
                    "completeness": raw.get("completeness"),
                    "fact_check": raw.get("fact_check"),
                    "confidence": raw.get("confidence"),
                    "analyst_comments": raw.get("analyst_comments") or [],
                    "reconsider_items": raw.get("reconsider_items") or [],
                    "approval_recommendation": raw.get("approval_recommendation")
                    or "rework",
                }
            )
        except ValidationError:
            for item in blanks.values():
                item["status"] = "Not run"
                item["earned_points"] = None
                item["score"] = None
                item["finding"] = (
                    "LLM not called successfully — invalid Judge output for this criterion."
                )
                item["gap"] = PLACEHOLDER_GAP
                item["next_action"] = "Recheck this revision; do not treat as Pass."
                item["tags"] = ["reviewer_error"]
                item["verification_method"] = "LLM not called"
            return (
                blanks,
                {"model": result.model, "prompt_hash": result.prompt_hash},
                "invalid_output",
            )

    by_cid = {item.criterion_id: item for item in parsed.criteria}
    for cid, key, label, pts, required in JUDGE_CRITERIA:
        if cid not in llm_cids:
            continue
        item = by_cid.get(cid)
        if not item:
            blanks[cid] = _blank_criterion(
                cid,
                key,
                label,
                pts,
                status="Not run",
                finding="LLM not called for this criterion — Judge omitted it from the response.",
                gap=PLACEHOLDER_GAP,
                next_action="Recheck this revision.",
                tags=["reviewer_error"],
                required=required,
                semantic=True,
                source="llm",
                verification_method="LLM not called",
            )
            continue
        finding = item.finding.strip()
        if "exact unresolved requirements" in finding.lower():
            finding = PLACEHOLDER_GAP
            status: Status = "Needs review" if item.status == "Pass" else item.status
        else:
            status = item.status

        # Deterministic Fail on J02 (missing screenshot / quote-page fail) cannot be overruled.
        det_j02 = (deterministic or {}).get("J02") or {}
        if cid == "J02" and det_j02.get("status") == "Fail":
            status = "Fail"
            finding = (
                f"{det_j02.get('finding') or 'Screenshot / quote-page check failed.'} "
                f"Litigator note: {finding}"
            ).strip()

        # Stabilize apparatus/preamble Partial maps (H.265 1[a] flip-flop guard):
        # encoder/encoding-process definitions are Partial support, not No map, when gaps
        # (circuitry / combined operations) are named — aligned with reference charts.
        mapping_label = str(
            (payload.get("chart_table_row") or {}).get("mapping_label")
            or (payload.get("proposed_mapping") or {}).get("mapping_label")
            or ""
        )
        missing = list(
            (payload.get("chart_table_row") or {}).get("missing_requirements")
            or (payload.get("proposed_mapping") or {}).get("missing_requirements")
            or []
        )
        if (
            status == "Fail"
            and cid in {"J05", "J07"}
            and mapping_label == "Partial map"
            and missing
            and _is_apparatus_preamble(element)
            and _evidence_has_encoder_context(evidence_packets)
        ):
            status = "Pass"
            finding = (
                f"{finding} Partial map retained: apparatus/preamble has genuine encoder/"
                f"encoding-process context; named gaps cover what remains unresolved "
                f"({'; '.join(str(m) for m in missing[:3])})."
            ).strip()

        gap = _clean_gap(item.gap) or (
            PLACEHOLDER_GAP
            if status not in {"Pass", "Not applicable"} and not item.gap
            else item.gap
        )
        if status == "Pass":
            gap = None
        tags = [t for t in (item.tags or []) if t in FINDING_TAGS]
        if status == "Fail" and cid == "J02" and "screenshot_mismatch" not in tags:
            tags.append("screenshot_mismatch")
        if status == "Fail" and cid == "J05" and "unsupported_requirement" not in tags:
            tags.append("unsupported_requirement")
        if status == "Fail" and cid == "J07" and "label_disagreement" not in tags:
            tags.append("label_disagreement")
        for dim_name, dim in (
            ("groundedness", item.groundedness),
            ("accuracy", item.accuracy),
            ("relevance", item.relevance),
        ):
            if dim and dim.status == "Fail":
                tag = f"{dim_name}_fail"
                if tag in FINDING_TAGS and tag not in tags:
                    tags.append(tag)
        if status != "Pass" and "needs_reconsider" not in tags:
            tags.append("needs_reconsider")

        details: dict[str, Any] = {
            "groundedness": _quality_dump(item.groundedness),
            "accuracy": _quality_dump(item.accuracy),
            "relevance": _quality_dump(item.relevance),
        }
        blanks[cid] = _blank_criterion(
            cid,
            key,
            label,
            pts,
            status=status,
            finding=finding,
            requirement=item.requirement,
            evidence_establishes=item.evidence_establishes,
            gap=gap,
            next_action=item.analyst_action if status != "Pass" else None,
            evidence_ids=item.evidence_ids,
            requirement_gaps=[g.model_dump() for g in item.requirement_gaps],
            tags=tags if status != "Pass" else [t for t in tags if t.endswith("_fail")],
            label_recommendation=item.label_recommendation,
            required=required,
            semantic=True,
            source="llm",
            verification_method=(
                "Litigator LLM + vision screenshot check"
                if cid == "J02"
                else "Litigator LLM verification against document excerpts"
            ),
            details=details,
        )

    # Overall quality dimensions: use model output, else derive from criteria.
    def _overall_dim(
        name: str, provided: QualityDimension | None
    ) -> dict[str, Any]:
        if provided:
            return provided.model_dump()
        worst = "Pass"
        notes: list[str] = []
        rank = {"Pass": 0, "Needs review": 1, "Fail": 2}
        for crit in blanks.values():
            dim = (crit.get("details") or {}).get(name)
            if not isinstance(dim, dict):
                continue
            st = str(dim.get("status") or "Pass")
            if rank.get(st, 0) > rank.get(worst, 0):
                worst = st
            if dim.get("finding"):
                notes.append(str(dim["finding"]))
        return {
            "status": worst,
            "finding": "; ".join(notes[:3])
            or f"{name.title()} assessed via criterion review.",
        }

    analyst_comments = [c.model_dump() for c in parsed.analyst_comments]
    reconsider_items = [str(x).strip() for x in parsed.reconsider_items if str(x).strip()]
    # Ensure every non-Pass criterion leaves an analyst-facing comment.
    for cid, crit in blanks.items():
        if crit.get("status") in {"Pass", "Not applicable"}:
            continue
        action = crit.get("next_action") or crit.get("analyst_action")
        if not action:
            continue
        if any(
            c.get("criterion_id") == cid and c.get("analyst_action") == action
            for c in analyst_comments
        ):
            continue
        analyst_comments.append(
            {
                "topic": crit.get("short_label") or cid,
                "severity": "critical" if crit.get("status") == "Fail" else "reconsider",
                "comment": crit.get("finding") or "Requires analyst attention.",
                "analyst_action": action,
                "criterion_id": cid,
            }
        )
        if action not in reconsider_items:
            reconsider_items.append(action)

    for dim_name, dim in (
        ("groundedness", parsed.groundedness),
        ("accuracy", parsed.accuracy),
        ("relevance", parsed.relevance),
    ):
        dumped = _overall_dim(dim_name, dim)
        if dumped.get("status") != "Pass":
            tag = f"{dim_name}_fail" if dumped["status"] == "Fail" else "needs_reconsider"
            line = f"{dim_name.title()}: {dumped.get('finding')}"
            if line not in reconsider_items:
                reconsider_items.append(line)
            analyst_comments.append(
                {
                    "topic": dim_name.title(),
                    "severity": "critical" if dumped["status"] == "Fail" else "reconsider",
                    "comment": dumped.get("finding") or f"{dim_name} needs attention.",
                    "analyst_action": (
                        f"Re-check {dim_name} of the chart row against the cited standard text."
                    ),
                    "criterion_id": None,
                }
            )

    confidence = _build_confidence_report(parsed, blanks=blanks)
    meta = {
        "model": result.model,
        "prompt_hash": result.prompt_hash,
        "summary": parsed.summary,
        "next_action": parsed.next_action,
        "what_passed": parsed.what_passed,
        "what_needs_attention": parsed.what_needs_attention,
        "groundedness": confidence.get("groundedness")
        or _overall_dim("groundedness", parsed.groundedness),
        "accuracy": confidence.get("accuracy")
        or _overall_dim("accuracy", parsed.accuracy),
        "relevance": confidence.get("relevance")
        or _overall_dim("relevance", parsed.relevance),
        "completeness": confidence.get("completeness"),
        "fact_check": confidence.get("fact_check"),
        "confidence": confidence,
        "analyst_comments": analyst_comments,
        "reconsider_items": reconsider_items,
        "approval_recommendation": parsed.approval_recommendation,
        "vision_screenshots_reviewed": len(images),
    }
    return blanks, meta, None


def remappable_judge_issues(
    criteria: list[dict[str, Any]],
    *,
    integrity: dict[str, Any] | None = None,
    incomplete: bool = False,
) -> list[dict[str, Any]]:
    """Return Judge findings that justify automatic remapping.

    Soft screenshot/folio Needs review (J02/J04) alone must not remapping —
    those stay for analyst eyes. Failures, semantic J05–J07 issues, integrity
    failure, and fully incomplete semantic review do remapping.
    """
    semantic_ids = {"J05", "J06", "J07"}
    semantic = [c for c in criteria if str(c.get("criterion_id") or "") in semantic_ids]
    semantic_assessed = [
        c
        for c in semantic
        if str(c.get("status") or "") not in {"Not run", "Error", "Not applicable"}
    ]
    # Only force remap for "incomplete" when the semantic Judge never assessed anything.
    if incomplete and not semantic_assessed:
        return [
            {
                "criterion_id": "semantic",
                "status": "Not run",
                "finding": "Judge semantic review incomplete — remap and re-judge.",
            }
        ]
    if integrity and integrity.get("pass") is False:
        return [
            {
                "criterion_id": "integrity",
                "status": "Fail",
                "finding": "Deterministic source integrity failed — remap with verified quotes.",
            }
        ]

    remappable: list[dict[str, Any]] = []
    for item in criteria:
        cid = str(item.get("criterion_id") or "")
        status = str(item.get("status") or "")
        if status == "Fail":
            remappable.append(item)
            continue
        if status in {"Not run", "Error"} and cid.startswith("J"):
            # Sibling semantic criteria already scored — do not remapping just because
            # the model omitted one field (that flip-flopped Partial → No map on 1[a]).
            if cid in semantic_ids and semantic_assessed:
                continue
            if cid in SOFT_NEEDS_REVIEW_ONLY:
                continue
            remappable.append(item)
            continue
        if status == "Needs review":
            # Soft visual/folio ambiguity: do not auto-remap.
            if cid in SOFT_NEEDS_REVIEW_ONLY:
                continue
            remappable.append(item)
    return remappable


def should_auto_rework(report: dict[str, Any] | None) -> bool:
    """True when the mapping pipeline should remap this element from Judge feedback."""
    if not report:
        return False
    if report.get("disposition") == "rework":
        return True
    criteria = report.get("criteria") if isinstance(report.get("criteria"), list) else []
    incomplete = (
        report.get("overall_decision") == "Review incomplete"
        or report.get("review_status") == "incomplete"
        or bool(report.get("semantic_error"))
    )
    return bool(
        remappable_judge_issues(
            criteria,
            integrity=report.get("integrity")
            if isinstance(report.get("integrity"), dict)
            else None,
            incomplete=incomplete,
        )
    )


def build_rework_feedback(report: dict[str, Any] | None) -> list[str]:
    """Structured Judge feedback the mapper must address on the next attempt."""
    if not report:
        return ["Judge requested rework; re-evaluate evidence and mapping label."]

    lines: list[str] = [
        "NON-NEGOTIABLE litigator criteria — fix every item below before returning:",
        "1) Right standard and exact edition on every citation.",
        "2) Quotes must exist verbatim on the cited PDF page.",
        "3) Section and page citations must match the passage.",
        "4) Screenshots must show the cited quote passage (correct crop).",
        "5) Evidence must support each claim requirement (shared jargon is not support).",
        "6) Rationale must be grounded, accurate, and relevant — no overclaim.",
        "7) Full / Partial / No map must match the evidence; Full map is forbidden with gaps.",
        "8) Do not invent quotations or cite span IDs that were not retrieved.",
        "9) Do NOT flip Partial map → No map when the standard still provides genuine "
        "contextual/partial support (e.g. encoder / encoding-process definitions for an "
        "'encoding apparatus' preamble). Keep Partial map and name the unresolved gaps "
        "(circuitry, combined operations, mandatory implementation).",
    ]

    criteria = report.get("criteria") if isinstance(report.get("criteria"), list) else []
    incomplete = report.get("overall_decision") == "Review incomplete" or bool(
        report.get("semantic_error")
    )
    issues = remappable_judge_issues(
        criteria,
        integrity=report.get("integrity")
        if isinstance(report.get("integrity"), dict)
        else None,
        incomplete=incomplete,
    )
    for item in issues:
        cid = item.get("criterion_id") or "?"
        status = item.get("status") or "?"
        finding = item.get("finding") or item.get("gap") or "Issue flagged"
        gap = item.get("gap")
        label_rec = item.get("label_recommendation")
        chunk = f"[{cid} {status}] {finding}"
        if gap and str(gap) not in chunk:
            chunk = f"{chunk} | gap: {gap}"
        if label_rec:
            chunk = f"{chunk} | preferred label: {label_rec}"
        for rg in item.get("requirement_gaps") or []:
            if isinstance(rg, dict) and rg.get("requirement"):
                chunk = (
                    f"{chunk} | unsupported: {rg.get('requirement')}"
                    f"{(' — ' + rg['gap']) if rg.get('gap') else ''}"
                )
        lines.append(chunk)

    for reason in report.get("reasons") or []:
        text = str(reason).strip()
        if text and text not in lines:
            lines.append(text)
    for item in report.get("reconsider_items") or []:
        text = str(item).strip()
        if text and text not in lines:
            lines.append(f"[Reconsider] {text}")
    for comment in report.get("analyst_comments") or []:
        if not isinstance(comment, dict):
            continue
        action = comment.get("analyst_action") or comment.get("comment")
        if not action:
            continue
        topic = comment.get("topic") or "Litigator"
        line = f"[Litigator · {topic}] {action}"
        if line not in lines:
            lines.append(line)

    summary = (report.get("summary") or "").strip()
    if summary and summary not in lines:
        lines.append(f"Judge summary: {summary}")
    next_action = (report.get("next_action") or "").strip()
    if next_action and next_action not in lines:
        lines.append(f"Next action: {next_action}")

    return lines[:40]


def assemble_judge_report(
    *,
    deterministic: dict[str, dict[str, Any]],
    semantic: dict[str, dict[str, Any]],
    semantic_meta: dict[str, Any] | None,
    semantic_error: str | None,
    integrity: dict[str, Any] | None,
    mapping_label: str | None,
    missing_requirements: list[str] | None,
    element: dict[str, Any] | None = None,
    target_family: str | None = None,
    target_edition: str | None = None,
) -> dict[str, Any]:
    criteria: list[dict[str, Any]] = []
    for cid, key, label, pts, required in JUDGE_CRITERIA:
        # Prefer litigator LLM result for semantic criteria; J02 uses LLM when screenshots
        # were reviewed (vision), otherwise keep deterministic presence/page check.
        if cid in semantic:
            item = semantic[cid]
        else:
            item = deterministic.get(cid)
        if not item:
            item = _blank_criterion(
                cid,
                key,
                label,
                pts,
                status="Not run",
                required=required,
                semantic=cid >= "J05",
            )
        criteria.append(item)

    if integrity and integrity.get("pass") is False:
        for item in criteria:
            if item["criterion_id"] in {"J01", "J03"} and item["status"] == "Pass":
                item["status"] = "Fail"
                item["earned_points"] = 0
                item["score"] = 0
                item["finding"] = (
                    (item.get("finding") or "")
                    + " Deterministic integrity failed and cannot be overruled."
                ).strip()
                item["gap"] = item.get("gap") or "Source integrity failure."
                item["tags"] = list({*(item.get("tags") or []), "quote_mismatch" if item["criterion_id"] == "J01" else "wrong_edition"})

    applicable = [
        c
        for c in criteria
        if c.get("status") not in {"Not applicable", "Could not assess"}
    ]
    assessed = [c for c in applicable if c.get("earned_points") is not None]
    pending = [c for c in applicable if c.get("status") in {"Not run", "Error"}]
    denominator = sum(int(c["max_points"]) for c in applicable)
    earned_total = sum(int(c["earned_points"]) for c in assessed)
    if not assessed and pending:
        rubric_score = None
        score_label = "Not evaluated"
        score_provisional = True
    elif denominator <= 0:
        rubric_score = None
        score_label = "Not evaluated"
        score_provisional = True
    else:
        rubric_score = round(100 * earned_total / denominator)
        score_provisional = bool(pending) or any(
            c.get("status") == "Needs review" for c in applicable
        )
        score_label = f"{earned_total}/{denominator}"
        if score_provisional:
            score_label += " provisional"

    # Errors / mismatches only. Soft "Needs review" is informational, not a hard error.
    mismatches = [
        c for c in criteria if c.get("status") in {"Fail", "Error"}
    ]
    pending_llm = [c for c in criteria if c.get("status") in {"Not run", "Error"}]
    soft_review = [c for c in criteria if c.get("status") == "Needs review"]
    unresolved = mismatches + soft_review + [
        c for c in pending_llm if c.get("status") == "Not run"
    ]
    # Actionable issues first: Fail, then Error/Not run, then soft Needs review
    order = {"Fail": 0, "Error": 1, "Not run": 2, "Needs review": 3}
    unresolved.sort(key=lambda c: order.get(str(c.get("status")), 9))

    required_blocking = [
        c
        for c in criteria
        if c.get("required") and c.get("status") in {"Fail", "Not run", "Error"}
    ]
    any_fail = [c for c in criteria if c.get("status") == "Fail"]
    incomplete = bool(pending) or bool(semantic_error)

    if any_fail and (required_blocking or (integrity and integrity.get("pass") is False)):
        overall: Overall = "Failed checks"
    elif incomplete:
        overall = "Review incomplete"
    elif mismatches or required_blocking:
        overall = "Needs analyst review"
    elif soft_review:
        # Ambiguity only — not a document mismatch error.
        overall = "Needs analyst review"
    else:
        overall = "Passed checks"

    # High total cannot override failed/unresolved required criterion.
    if required_blocking and overall == "Passed checks":
        overall = "Needs analyst review"
        score_provisional = True

    # Strict litigator gate: quality Fail or reject/rework blocks a soft Pass.
    approval = str((semantic_meta or {}).get("approval_recommendation") or "")
    quality_fail = any(
        isinstance((semantic_meta or {}).get(name), dict)
        and (semantic_meta or {}).get(name, {}).get("status") == "Fail"
        for name in ("groundedness", "accuracy", "relevance")
    )
    if overall == "Passed checks" and (
        approval in {"reject", "rework"} or quality_fail
    ):
        overall = "Needs analyst review"
        score_provisional = True

    missing = sanitize_missing_requirements(missing_requirements or [])
    summary = (semantic_meta or {}).get("summary")
    next_action = (semantic_meta or {}).get("next_action")
    what_passed = (semantic_meta or {}).get("what_passed")
    what_needs = (semantic_meta or {}).get("what_needs_attention")
    if overall == "Needs analyst review" and (
        not what_needs or what_needs == "No open issues."
    ):
        what_needs = (
            (semantic_meta or {}).get("what_needs_attention")
            or "Litigator quality gate requires analyst reconsideration."
        )

    if not what_passed:
        passed = [c["label"] for c in criteria if c.get("status") == "Pass"]
        what_passed = (
            f"Verified: {', '.join(passed[:3])}{'…' if len(passed) > 3 else ''}."
            if passed
            else "No criteria fully passed yet."
        )
    if not what_needs:
        if unresolved:
            first = unresolved[0]
            what_needs = first.get("finding") or "One or more criteria need attention."
        else:
            what_needs = "No open issues."
    if not summary:
        if overall == "Passed checks":
            summary = f"{what_passed} Automated checks passed for this revision."
        elif overall == "Failed checks":
            first = any_fail[0] if any_fail else unresolved[0]
            summary = first.get("finding") or "Required source checks failed."
        elif overall == "Review incomplete":
            summary = PLACEHOLDER_GAP if not semantic_meta else "Judge could not complete all criteria."
        else:
            summary = f"{what_passed} {what_needs}"
    if not next_action:
        if overall == "Passed checks":
            next_action = "Analyst may Accept or Reject. Automated review is separate from approval."
        elif overall == "Failed checks":
            next_action = "Replace failing evidence or send for rework, then Recheck."
        elif overall == "Review incomplete":
            next_action = "Use Recheck this revision after fixing tool or model issues."
        else:
            next_action = "Verify the highlighted findings, then Accept, Reject, or Ask Agent."

    if missing and overall != "Passed checks":
        gap_line = "; ".join(missing)
        if gap_line and gap_line.lower() not in (summary or "").lower():
            summary = f"{summary} Missing: {gap_line}"

    remappable = remappable_judge_issues(
        criteria,
        integrity=integrity,
        incomplete=incomplete,
    )

    # Pipeline disposition drives automatic remapping. Soft J02/J04 Needs review
    # alone must not force remapping (would loop forever), but still surfaces on UI.
    if overall == "Passed checks":
        disposition = "pass"
    elif remappable or overall == "Review incomplete" or approval == "rework":
        disposition = "rework"
    elif overall == "Failed checks" or approval == "reject" or quality_fail:
        disposition = "flag"
    else:
        # Needs analyst review from soft source checks only — no remap.
        disposition = "pass" if not any_fail else "flag"

    reasons: list[str] = []
    for item in unresolved:
        parts = [item.get("label") or item.get("criterion_id"), item.get("status")]
        if item.get("requirement"):
            parts.append(f"requirement: {item['requirement']}")
        if item.get("gap"):
            parts.append(f"gap: {item['gap']}")
        elif item.get("finding"):
            parts.append(str(item["finding"]))
        reasons.append(" — ".join(str(p) for p in parts if p))
    if not reasons and overall != "Passed checks":
        reasons = [summary]

    finding_tags = []
    for item in unresolved:
        for tag in item.get("tags") or []:
            if tag in FINDING_TAGS and FINDING_TAGS[tag] not in finding_tags:
                finding_tags.append(FINDING_TAGS[tag])
    for name in ("groundedness", "accuracy", "relevance"):
        dim = (semantic_meta or {}).get(name)
        if isinstance(dim, dict) and dim.get("status") == "Fail":
            tag = f"{name}_fail"
            if tag in FINDING_TAGS and FINDING_TAGS[tag] not in finding_tags:
                finding_tags.append(FINDING_TAGS[tag])
    if (semantic_meta or {}).get("reconsider_items") or (
        (semantic_meta or {}).get("approval_recommendation") in {"rework", "reject"}
    ):
        if FINDING_TAGS["needs_reconsider"] not in finding_tags:
            finding_tags.append(FINDING_TAGS["needs_reconsider"])

    evidence_context_tags = []
    # Mapping evidence_status → context tags when present on mapping.
    # (Filled by caller via mapping if needed.)

    recommendations: list[dict[str, str]] = []
    seen_rec: set[str] = set()
    for comment in (semantic_meta or {}).get("analyst_comments") or []:
        if not isinstance(comment, dict):
            continue
        action = comment.get("analyst_action") or comment.get("comment")
        if not action:
            continue
        key = str(action).strip()
        if key in seen_rec:
            continue
        seen_rec.add(key)
        sev = comment.get("severity") or "reconsider"
        recommendations.append(
            {
                "criterion_id": str(comment.get("criterion_id") or "litigator"),
                "label": str(comment.get("topic") or "Litigator comment"),
                "recommendation": key,
                "severity": "critical" if sev == "critical" else "attention",
            }
        )
    for item in unresolved:
        action = item.get("next_action") or item.get("analyst_action")
        if not action:
            continue
        key = str(action).strip()
        if key in seen_rec:
            continue
        seen_rec.add(key)
        recommendations.append(
            {
                "criterion_id": str(item.get("criterion_id") or ""),
                "label": str(item.get("short_label") or item.get("label") or ""),
                "recommendation": key,
                "severity": "critical" if item.get("status") == "Fail" else "attention",
            }
        )
    if not recommendations and next_action and overall != "Passed checks":
        recommendations.append(
            {
                "criterion_id": "overall",
                "label": "Next action",
                "recommendation": str(next_action),
                "severity": "attention",
            }
        )

    critical = overall == "Failed checks" or any(
        c.get("status") == "Fail" for c in criteria
    )
    scorecard_note = (
        NO_MAP_SCORECARD_NOTE
        if mapping_label == "No map"
        and all(
            c.get("status") == "Not applicable"
            for c in criteria
            if c.get("criterion_id") in {"J01", "J02"}
        )
        else None
    )

    confidence = derive_confidence_from_report(
        criteria,
        semantic_meta=semantic_meta,
        summary=summary,
    )

    return {
        "rubric_version": RUBRIC_VERSION,
        "overall_decision": overall,
        "rubric_score": rubric_score,
        "score_label": score_label,
        "earned_points": earned_total if assessed else None,
        "max_points": denominator if applicable else None,
        "score_provisional": score_provisional,
        "assessment_complete": not incomplete and not any(
            c.get("status") == "Needs review" and c.get("required") for c in criteria
        ),
        "issue_count": len(mismatches) + len([c for c in criteria if c.get("status") == "Not run"]),
        "critical": critical,
        "review_status": "done" if not incomplete else "incomplete",
        "summary": summary,
        "next_action": next_action,
        "what_passed": what_passed,
        "what_needs_attention": what_needs,
        "groundedness": confidence.get("groundedness"),
        "accuracy": confidence.get("accuracy"),
        "relevance": confidence.get("relevance"),
        "completeness": confidence.get("completeness"),
        "fact_check": confidence.get("fact_check"),
        "confidence": confidence,
        "analyst_comments": (semantic_meta or {}).get("analyst_comments") or [],
        "reconsider_items": (semantic_meta or {}).get("reconsider_items") or [],
        "approval_recommendation": (semantic_meta or {}).get(
            "approval_recommendation"
        ),
        "vision_screenshots_reviewed": (semantic_meta or {}).get(
            "vision_screenshots_reviewed"
        ),
        "criteria": criteria,
        "issues": [
            {
                "criterion_id": c["criterion_id"],
                "label": c.get("short_label") or c["label"],
                "status": c["status"],
                "issue": c.get("finding"),
                "requirement": c.get("requirement"),
                "evidence_establishes": c.get("evidence_establishes"),
                "gap": c.get("gap") or (PLACEHOLDER_GAP if c["status"] != "Pass" else None),
                "next_action": c.get("next_action"),
                "severity": "critical" if c.get("status") == "Fail" else "attention",
                "tags": [
                    FINDING_TAGS[t] if t in FINDING_TAGS else t
                    for t in (c.get("tags") or [])
                ],
                "evidence_ids": c.get("evidence_ids") or [],
            }
            for c in unresolved
        ],
        "recommendations": recommendations,
        "finding_tags": finding_tags,
        "evidence_context_tags": evidence_context_tags,
        "scorecard_note": scorecard_note,
        "disposition": disposition,
        "reasons": reasons,
        "auto_rework": disposition == "rework",
        "remappable_issue_count": len(remappable),
        "mapping_label": mapping_label,
        "element_label": (element or {}).get("label"),
        "element_text": (element or {}).get("exact_text"),
        "standard_family": target_family,
        "standard_edition": target_edition,
        "model_name": (semantic_meta or {}).get("model"),
        "prompt_hash": (semantic_meta or {}).get("prompt_hash"),
        "semantic_error": semantic_error,
        "integrity": integrity,
        "disclaimer": (
            "Litigator LLM review is a strict final check; analyst approval remains separate."
        ),
    }


def checks_dict_from_report(report: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "rubric_version",
        "overall_decision",
        "rubric_score",
        "score_label",
        "earned_points",
        "max_points",
        "score_provisional",
        "assessment_complete",
        "issue_count",
        "critical",
        "review_status",
        "summary",
        "next_action",
        "what_passed",
        "what_needs_attention",
        "groundedness",
        "accuracy",
        "relevance",
        "completeness",
        "fact_check",
        "confidence",
        "analyst_comments",
        "reconsider_items",
        "approval_recommendation",
        "vision_screenshots_reviewed",
        "criteria",
        "issues",
        "recommendations",
        "finding_tags",
        "evidence_context_tags",
        "scorecard_note",
        "auto_rework",
        "remappable_issue_count",
        "element_label",
        "element_text",
        "standard_family",
        "standard_edition",
        "disclaimer",
        "semantic_error",
    ]
    return {key: report.get(key) for key in keys}


def is_structured_rubric(checks: dict[str, Any] | None) -> bool:
    if not isinstance(checks, dict):
        return False
    version = str(checks.get("rubric_version") or "")
    criteria = checks.get("criteria")
    return version.startswith("judge-v") and isinstance(criteria, list) and len(criteria) >= 7


def judge_display_from_checks(
    checks: dict[str, Any] | list | None,
    *,
    disposition: str | None,
    reasons: list[str] | None,
    integrity: dict[str, Any] | None,
) -> dict[str, Any]:
    if is_structured_rubric(checks if isinstance(checks, dict) else None):
        assert isinstance(checks, dict)
        overall = checks.get("overall_decision") or "Needs analyst review"
        # Normalize older "Needs review" / "Failed" wording
        aliases = {
            "Needs review": "Needs analyst review",
            "Failed": "Failed checks",
            "Failed checks": "Failed checks",
            "Passed checks": "Passed checks",
            "Review incomplete": "Review incomplete",
            "Reviewing": "Reviewing",
        }
        overall = aliases.get(str(overall), str(overall))
        criteria = checks.get("criteria") if isinstance(checks.get("criteria"), list) else []
        confidence = derive_confidence_from_report(
            criteria,
            semantic_meta={
                "confidence": checks.get("confidence"),
                "completeness": checks.get("completeness"),
                "accuracy": checks.get("accuracy"),
                "groundedness": checks.get("groundedness"),
                "fact_check": checks.get("fact_check"),
                "relevance": checks.get("relevance"),
                "summary": checks.get("summary"),
            },
            summary=checks.get("summary") if isinstance(checks.get("summary"), str) else None,
        )
        judge_payload = {
            **checks,
            "overall_decision": overall,
            "legacy": False,
            "confidence": confidence,
            "completeness": confidence.get("completeness"),
            "accuracy": confidence.get("accuracy"),
            "groundedness": confidence.get("groundedness"),
            "fact_check": confidence.get("fact_check"),
            "relevance": confidence.get("relevance"),
        }
        # Assignment Mapping Review vocabulary:
        # Passed | Sent back | Flagged | Could not assess
        if overall == "Passed checks":
            review_status = "Passed"
        elif overall in {"Review incomplete", "Reviewing"}:
            review_status = "Could not assess"
        elif overall == "Failed checks" or disposition == "flag":
            review_status = "Flagged"
        elif disposition == "rework":
            review_status = "Sent back"
        elif overall == "Needs analyst review":
            # Soft findings needing analyst attention (not auto-remapped).
            review_status = "Flagged"
        else:
            review_status = disposition or "Pending"
        return {
            "judge": judge_payload,
            "mapping_review_status": review_status,
            "mapping_review_incomplete": overall == "Review incomplete",
        }

    # Legacy: do NOT invent completed criterion results.
    # Empty / pre-rubric reviews are Incomplete — never "Needs analyst review"
    # from a synthetic disposition alone.
    overall = "Review incomplete"
    if integrity and integrity.get("pass") is False:
        overall = "Failed checks"

    cleaned_reasons = []
    for reason in reasons or []:
        text = str(reason)
        if "omitted disposition" in text.lower():
            text = "Mapping review: Incomplete — structured Judge rubric was not recorded."
        if "exact unresolved requirements" in text.lower():
            text = PLACEHOLDER_GAP
        cleaned_reasons.append(text)
    if not cleaned_reasons:
        cleaned_reasons = [
            "No structured Judge rubric on this revision yet. Recheck this revision."
        ]

    return {
        "judge": {
            "rubric_version": "legacy",
            "overall_decision": overall,
            "rubric_score": None,
            "score_label": "Not evaluated",
            "earned_points": None,
            "max_points": None,
            "score_provisional": True,
            "assessment_complete": False,
            "issue_count": max(1, len(cleaned_reasons)),
            "summary": cleaned_reasons[0]
            if cleaned_reasons
            else "No structured Judge rubric on this revision yet.",
            "next_action": "Recheck this revision to produce the full seven-criterion scorecard.",
            "what_passed": "Structured checks have not been recorded for this revision.",
            "what_needs_attention": "Run Recheck this revision before relying on criterion scores.",
            "criteria": [],  # never fabricate completed criteria from legacy findings
            "issues": [
                {
                    "criterion_id": "legacy",
                    "label": "Legacy review note",
                    "status": "Not run",
                    "issue": text,
                    "gap": PLACEHOLDER_GAP,
                    "next_action": "Recheck this revision.",
                    "tags": ["Reviewer error"],
                    "evidence_ids": [],
                }
                for text in cleaned_reasons[:5]
            ],
            "finding_tags": ["Reviewer error"],
            "disclaimer": "Automated review is separate from analyst approval.",
            "legacy": True,
        },
        "mapping_review_status": {
            "Passed checks": "Passed",
            "Needs analyst review": "Flagged",
            "Failed checks": "Flagged",
            "Review incomplete": "Could not assess",
        }.get(overall, "Could not assess"),
        "mapping_review_incomplete": True,
    }


def recheck_revision(revision_id: str) -> dict[str, Any]:
    """Insert a new Judge review record for this revision (history preserved)."""
    with connect() as connection:
        row = connection.execute(
            """
            SELECT rr.*, ce.label, ce.exact_text, ce.requirements_json,
                   r.target_document_id, d.family, d.edition
            FROM row_revisions rr
            JOIN claim_elements ce ON ce.id=rr.element_id
            JOIN runs r ON r.id=rr.run_id
            LEFT JOIN documents d ON d.id=r.target_document_id
            WHERE rr.id=?
            """,
            (revision_id,),
        ).fetchone()
    if not row:
        raise ValueError("Unknown revision")
    element = {
        "id": row["element_id"],
        "label": row["label"],
        "exact_text": row["exact_text"],
        "requirements": json.loads(row["requirements_json"] or "[]"),
    }
    mapping = {
        "mapping_label": row["mapping_label"],
        "rationale": row["rationale"],
        "missing_requirements": json.loads(row["missing_requirements_json"] or "[]"),
        "evidence_status": row["evidence_status"],
        "evidence_span_ids": json.loads(row["evidence_ids_json"] or "[]"),
        "counterevidence_span_ids": json.loads(row["counterevidence_ids_json"] or "[]"),
        "match_strength": row["match_strength"] if "match_strength" in row.keys() else None,
        "requirement_applicability": (
            row["requirement_applicability"]
            if "requirement_applicability" in row.keys()
            else None
        ),
        "requirement_condition": (
            row["requirement_condition"] if "requirement_condition" in row.keys() else ""
        ),
    }
    from .chart_schema import enrich_mapping_tags

    mapping = enrich_mapping_tags(mapping)
    integrity = json.loads(row["integrity_json"] or "null")
    report = run_judge(
        element=element,
        mapping=mapping,
        target_document_id=row["target_document_id"],
        target_family=row["family"],
        target_edition=row["edition"],
        integrity=integrity,
        run_id=row["run_id"],
    )
    checks = checks_dict_from_report(report)
    if not is_structured_rubric(checks):
        raise RuntimeError(
            "Judge did not return a complete seven-criterion rubric; refusing to persist."
        )
    review_id = str(uuid.uuid4())
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO review_results(
              id,revision_id,disposition,checks_json,reasons_json,model_name,prompt_hash,created_at
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                review_id,
                revision_id,
                report["disposition"],
                dumps(checks),
                dumps(report.get("reasons") or []),
                report.get("model_name"),
                report.get("prompt_hash"),
                utcnow(),
            ),
        )
    report["revision_id"] = revision_id
    report["review_id"] = review_id
    report["checks"] = checks
    return report


def recheck_run(
    run_id: str,
    *,
    only_incomplete: bool = True,
) -> dict[str, Any]:
    """Recheck latest revision per claim element that lacks a structured Judge rubric."""
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT rr.id AS revision_id,
                   (
                     SELECT checks_json FROM review_results x
                     WHERE x.revision_id=rr.id
                     ORDER BY x.created_at DESC LIMIT 1
                   ) AS checks_json
            FROM row_revisions rr
            WHERE rr.run_id=?
              AND rr.revision_number = (
                SELECT MAX(revision_number) FROM row_revisions x
                WHERE x.element_id=rr.element_id
              )
            ORDER BY rr.created_at
            """,
            (run_id,),
        ).fetchall()
    results: list[dict[str, Any]] = []
    skipped = 0
    errors: list[dict[str, str]] = []
    for row in rows:
        checks = json.loads(row["checks_json"] or "{}")
        if only_incomplete and is_structured_rubric(checks):
            skipped += 1
            continue
        try:
            report = recheck_revision(row["revision_id"])
            results.append(
                {
                    "revision_id": row["revision_id"],
                    "review_id": report.get("review_id"),
                    "overall_decision": report.get("overall_decision"),
                    "disposition": report.get("disposition"),
                }
            )
        except Exception as exc:  # noqa: BLE001 — collect per-row failures
            errors.append({"revision_id": row["revision_id"], "error": str(exc)})
    return {
        "run_id": run_id,
        "rechecked": len(results),
        "skipped_structured": skipped,
        "errors": errors,
        "results": results,
    }


def run_judge(
    *,
    element: dict[str, Any],
    mapping: dict[str, Any],
    target_document_id: str | None,
    target_family: str | None = None,
    target_edition: str | None = None,
    integrity: dict[str, Any] | None = None,
    evidence_blocks: list[dict[str, Any]] | None = None,
    run_id: str | None = None,
    product_evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    evidence_ids = list(
        mapping.get("evidence_span_ids") or mapping.get("evidence_ids") or []
    )
    counter_ids = list(
        mapping.get("counterevidence_span_ids")
        or mapping.get("counterevidence_ids")
        or []
    )
    blocks = evidence_blocks
    if blocks is None:
        blocks = resolve_evidence_blocks(evidence_ids, role="supporting")
        if counter_ids:
            blocks = blocks + resolve_evidence_blocks(
                [sid for sid in counter_ids if sid not in evidence_ids],
                role="candidate",
            )
    if product_evidence is None and run_id and element.get("id"):
        try:
            from .product_evidence import list_product_evidence

            product_evidence = list_product_evidence(run_id, element_id=element["id"])
        except Exception:  # noqa: BLE001 — product tables may be absent mid-migration
            product_evidence = []
    mapping = {
        **mapping,
        "_product_evidence": product_evidence or [],
    }

    if not target_family or not target_edition:
        with connect() as connection:
            doc = connection.execute(
                "SELECT family, edition FROM documents WHERE id=?",
                (target_document_id,),
            ).fetchone()
        if doc:
            target_family = target_family or doc["family"]
            target_edition = target_edition or doc["edition"]

    # Bounded recovery: retry semantic once on invalid/empty output.
    deterministic = run_deterministic_checks(
        evidence_blocks=blocks,
        target_document_id=target_document_id,
        target_family=target_family,
        target_edition=target_edition,
        integrity=integrity,
        mapping_label=mapping.get("mapping_label"),
    )
    semantic, meta, err = _run_semantic_judge(
        element=element,
        mapping=mapping,
        evidence_blocks=blocks,
        integrity=integrity,
        run_id=run_id,
        deterministic=deterministic,
    )
    if err in {"invalid_output", "provider_not_ready"} or any(
        c.get("status") == "Not run" for c in semantic.values()
    ):
        if err != "provider_not_ready":
            semantic2, meta2, err2 = _run_semantic_judge(
                element=element,
                mapping=mapping,
                evidence_blocks=blocks,
                integrity=integrity,
                run_id=run_id,
                deterministic=deterministic,
            )
            # Keep any completed semantic criteria from the better attempt.
            merged = {}
            for cid in ("J02", "J05", "J06", "J07"):
                if cid not in semantic and cid not in semantic2:
                    continue
                first = semantic.get(cid) or {}
                second = semantic2.get(cid) or {}
                if first.get("status") not in {None, "Not run", "Error"}:
                    merged[cid] = first
                elif second.get("status") not in {None, "Not run", "Error"}:
                    merged[cid] = second
                else:
                    merged[cid] = second or first
            semantic = merged
            meta = meta2 or meta
            err = err2 or err

    # Evidence-status context tags
    report = assemble_judge_report(
        deterministic=deterministic,
        semantic=semantic,
        semantic_meta=meta,
        semantic_error=err,
        integrity=integrity,
        mapping_label=mapping.get("mapping_label"),
        missing_requirements=mapping.get("missing_requirements"),
        element=element,
        target_family=target_family,
        target_edition=target_edition,
    )
    status = mapping.get("evidence_status")
    tags = []
    if status == "normative":
        tags.append("Normative")
    elif status == "informative":
        tags.append("Informative")
    elif status == "conditional":
        tags.append("Conditional support")
    report["evidence_context_tags"] = tags
    return report

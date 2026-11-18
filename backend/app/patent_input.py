"""Replaceable patent-input adapter for prepared assessment records."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import get_settings

DEFAULT_PATENT_INPUT_ID = "patent-us10063856b2"


def patent_inputs_dir() -> Path:
    return get_settings().source_dir / "patent_inputs"


def list_patent_input_paths() -> list[Path]:
    root = patent_inputs_dir()
    if not root.exists():
        return []
    return sorted(root.glob("*.json"))


def load_patent_input(
    patent_input_id: str | None = None,
    *,
    extract_claims: bool = True,
) -> dict[str, Any]:
    target = patent_input_id or DEFAULT_PATENT_INPUT_ID
    # Support both us10063856b2.json and patent-us10063856b2.json naming.
    candidates = [
        patent_inputs_dir() / f"{target}.json",
        patent_inputs_dir() / f"{target.removeprefix('patent-')}.json",
        patent_inputs_dir() / "us10063856b2.json",
    ]
    data = None
    for candidate in candidates:
        if candidate.exists():
            data = json.loads(candidate.read_text())
            break
    if data is None:
        raise FileNotFoundError(
            f"No prepared patent-input record for {target!r}. "
            "Arbitrary patent identity parsing is not implemented; supply a prepared input record."
        )

    if extract_claims:
        from .claim_extract import extract_claims_for_document

        filename = data.get("filename")
        if not filename:
            raise ValueError(f"Patent input {target!r} is missing filename for claim extraction")
        try:
            extracted = extract_claims_for_document(filename)
        except Exception as exc:  # noqa: BLE001 - surface extraction failure to Setup UI
            if data.get("claims"):
                data = {
                    **data,
                    "claims_source": "prepared_fallback",
                    "extraction_error": str(exc),
                    "notes": (
                        f"{data.get('notes') or ''} Extraction failed ({exc}); "
                        "showing prepared fallback claims."
                    ).strip(),
                }
                return data
            raise ValueError(f"Claim extraction failed for {filename}: {exc}") from exc
        data = {
            **data,
            "claims": extracted,
            "claims_source": "pdf_extraction",
            "notes": (
                f"Extracted {len(extracted)} claims from {filename}. "
                "Dependent claims include inherited-parent references."
            ),
        }
        return data

    if not data.get("claims"):
        raise ValueError(f"Patent input {target!r} has no prepared claims")
    return data


def resolve_claims(
    patent: dict[str, Any],
    *,
    claim_scope: str,
    selected_numbers: list[int],
) -> list[dict[str, Any]]:
    claims = list(patent["claims"])
    by_number = {int(claim["number"]): claim for claim in claims}
    if claim_scope == "all":
        return claims
    missing = [number for number in selected_numbers if number not in by_number]
    if missing:
        raise ValueError(
            f"Selected claims are not in the prepared input record: {missing}. "
            "Unavailable claims were not fabricated."
        )
    if not selected_numbers:
        raise ValueError("Select at least one claim, or choose All claims")
    return [by_number[number] for number in selected_numbers]


def suggest_standards(
    patent: dict[str, Any],
    standards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Preliminary lexical relevance — not the final recommended target."""
    haystack = " ".join(
        [
            str(patent.get("subject") or ""),
            str(patent.get("description") or ""),
            str(patent.get("title") or ""),
            " ".join(claim.get("exact_text", "") for claim in patent.get("claims", [])),
        ]
    ).lower()
    patent_signals = {
        "video": "video" in haystack or "picture" in haystack,
        "chroma_qp": "chroma" in haystack and ("qp" in haystack or "quantization" in haystack),
        "speech": "speech" in haystack or "audio" in haystack,
        "lte": "lte" in haystack or "e-utra" in haystack or "physical channel" in haystack,
    }
    suggestions: list[dict[str, Any]] = []
    for standard in standards:
        if standard.get("kind") != "standard":
            continue
        corpus = " ".join(
            [
                str(standard.get("family") or ""),
                str(standard.get("title") or ""),
                str(standard.get("edition") or ""),
            ]
        ).lower()
        reasons: list[str] = []
        if ("h.265" in corpus or "hevc" in corpus or "video coding" in corpus) and (
            patent_signals["video"] or patent_signals["chroma_qp"]
        ):
            reasons.append("video coding and chroma quantization")
        if ("speech" in corpus or "g.722" in corpus) and patent_signals["speech"]:
            reasons.append("speech coding subject")
        if ("136 211" in corpus or "e-utra" in corpus or "lte" in corpus) and patent_signals["lte"]:
            reasons.append("LTE physical-channel subject")
        suggestions.append(
            {
                "document_id": standard["id"],
                "suggested": bool(reasons),
                "reason": (
                    f"Description matches {', '.join(reasons)}." if reasons else None
                ),
            }
        )
    return suggestions

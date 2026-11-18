"""Human-facing matter metadata for Setup (assignment corpus)."""

from __future__ import annotations

from typing import Any

# Short, litigator-readable blurbs — not essentiality conclusions.
DOCUMENT_CATALOG: dict[str, dict[str, Any]] = {
    "patent-us10063856b2": {
        "summary": (
            "Granted U.S. patent directed to an encoding apparatus that sets chroma "
            "quantization parameters (QP) in the range 0–51 from luma QP plus a "
            "picture-level chroma QP offset, then quantizes transform data. The "
            "specification discusses High Efficiency Video Coding (HEVC) practice."
        ),
        "version_label": "US 10,063,856 B2",
        "date_label": "Granted 28 Aug 2018",
        "doc_type_label": "Patent (assessment input)",
        "technology_area": "Video coding / chroma QP",
    },
    "standard-g7222-2003": {
        "summary": (
            "ITU-T Recommendation for wideband speech coding at around 16 kbit/s "
            "using Adaptive Multi-Rate Wideband (AMR-WB). Audio codec specification; "
            "not a video coding standard."
        ),
        "version_label": "ITU-T G.722.2",
        "date_label": "July 2003",
        "doc_type_label": "Candidate standard",
        "technology_area": "Wideband speech / AMR-WB",
    },
    "standard-h265-v10": {
        "summary": (
            "ITU-T H.265 / HEVC — High Efficiency Video Coding. Defines normative "
            "video coding tools, including chroma QP derivation relative to luma QP. "
            "Primary candidate for video-coding claim charts in this matter."
        ),
        "version_label": "ITU-T H.265 V10",
        "date_label": "July 2024",
        "doc_type_label": "Candidate standard",
        "technology_area": "HEVC / video coding",
    },
    "standard-ts136211-v17.2.0": {
        "summary": (
            "3GPP / ETSI technical specification for E-UTRA (LTE) physical channels "
            "and modulation. Cellular radio PHY specification; not a video codec."
        ),
        "version_label": "ETSI TS 136 211 V17.2.0",
        "date_label": "August 2022",
        "doc_type_label": "Candidate standard",
        "technology_area": "LTE physical layer",
    },
}


def enrich_document(doc: dict[str, Any]) -> dict[str, Any]:
    meta = DOCUMENT_CATALOG.get(doc.get("id") or "", {})
    return {
        **doc,
        "summary": meta.get("summary") or doc.get("description") or doc.get("subject"),
        "version_label": meta.get("version_label") or doc.get("edition"),
        "date_label": meta.get("date_label"),
        "doc_type_label": meta.get("doc_type_label"),
        "technology_area": meta.get("technology_area"),
    }

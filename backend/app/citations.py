"""Resolve clean human citations and tighter quote highlights for evidence spans."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pdfplumber

from .config import get_settings
from .database import connect

PLACEHOLDER_MISSING = {
    "exact unresolved requirements",
    "exact unresolved requirement",
    "supporting ids",
    "weakening/context ids",
}

PAGE_HEADER_RE = re.compile(
    r"(?P<printed>\d{1,4})\s+Rec\.\s+",
    re.IGNORECASE,
)
ETSI_PAGE_RE = re.compile(
    r"(?:ETSI\s+TS|3GPP\s+TS).{0,80}?\b(?P<printed>\d{1,4})\b",
    re.IGNORECASE | re.DOTALL,
)
SECTION_NUM_RE = re.compile(r"\b(\d+(?:\.\d+){1,5})\b")
# ITU/3GPP pages often run section titles inline (not always at line start).
# Capture only the leading title token so adjacent headers stay independently matchable
# (e.g. "... (informative) 9.3.5.1 General This clause...").
SECTION_HEADER_RE = re.compile(
    r"(?P<num>\d+(?:\.\d+){1,5})\s+(?P<title>General|[A-Z][A-Za-z]+)"
)
CLAUSE_MENTION_RE = re.compile(
    r"(?:clause|section)\s+(\d+(?:\.\d+){1,5})",
    re.IGNORECASE,
)
BAD_SECTION_RE = re.compile(
    r"^(?:\d{1,4}\s+Rec\.|(?:Rec\.|ITU-T|ETSI|3GPP)\b)",
    re.IGNORECASE,
)
ROMAN_PAGE_RE = re.compile(
    r"^(?=[ivxlcdm]{2,8}$)(?!.*([ivxlcdm])\1{3})[ivxlcdm]+$",
    re.IGNORECASE,
)
EDITION_SHORT_RE = re.compile(r"\b(V\d+)\b", re.IGNORECASE)


def is_plausible_printed_page(value: str | None) -> bool:
    text = (value or "").strip()
    if not text:
        return False
    if re.fullmatch(r"[A-Z]?-?\d{1,4}", text, re.IGNORECASE):
        return True
    return bool(ROMAN_PAGE_RE.fullmatch(text))


def short_standard_label(family: str | None, edition: str | None) -> str:
    family = (family or "").strip() or "Standard"
    edition = edition or ""
    version = EDITION_SHORT_RE.search(edition)
    if version:
        return f"{family} {version.group(1).upper()}"
    short = edition.split("(")[0].strip()
    return f"{family} {short}".strip() if short else family


def is_placeholder_missing(text: str) -> bool:
    return text.strip().lower() in PLACEHOLDER_MISSING


def sanitize_missing_requirements(
    values: list[str] | None,
    *,
    requirements: list[dict[str, Any]] | None = None,
    rationale: str | None = None,
) -> list[str]:
    cleaned: list[str] = []
    saw_placeholder = False
    for raw in values or []:
        text = str(raw or "").strip()
        if not text:
            continue
        if is_placeholder_missing(text):
            saw_placeholder = True
            continue
        if text not in cleaned:
            cleaned.append(text)
    if cleaned:
        return cleaned
    if saw_placeholder:
        # Prefer a concrete claim requirement when the model echoed the schema example.
        for item in requirements or []:
            req = str(item.get("text") or "").strip()
            if req:
                return [f"Not established from cited evidence: {req}"]
        rationale = (rationale or "").strip()
        if rationale:
            return [
                "Not identified precisely — further review is required "
                f"(mapper noted: {rationale[:160]}{'…' if len(rationale) > 160 else ''})"
            ]
        return ["Not identified — further review is required"]
    return []


def _looks_like_section_label(label: str) -> bool:
    label = (label or "").strip()
    if not label or BAD_SECTION_RE.match(label):
        return False
    return bool(re.match(r"^\d+(?:\.\d+)+\b", label))


def _section_ref_from_label(label: str | None) -> str | None:
    if not label or not _looks_like_section_label(label):
        return None
    number = SECTION_NUM_RE.match(label.strip())
    if not number:
        return None
    return f"§{number.group(1)}"


def resolve_printed_page(
    *,
    document_id: str,
    page_ordinal: int,
    stored_printed: str | None,
    page_text: str | None = None,
) -> str:
    stored = (stored_printed or "").strip()
    # Prefer a real printed header page when PDF ordinal was stored as a fallback.
    text = page_text
    if text is None:
        with connect() as connection:
            row = connection.execute(
                """
                SELECT printed_label, raw_text FROM pages
                WHERE document_id=? AND page_ordinal=?
                """,
                (document_id, page_ordinal),
            ).fetchone()
        if row:
            stored = stored or (row["printed_label"] or "")
            text = row["raw_text"] or ""
    if text:
        match = PAGE_HEADER_RE.search(text[:400])
        if match:
            return match.group("printed")
        etsi = ETSI_PAGE_RE.search(text[:500])
        if etsi:
            return etsi.group("printed")
    if is_plausible_printed_page(stored) and stored != str(page_ordinal):
        return stored
    if is_plausible_printed_page(stored):
        return stored
    return str(page_ordinal)


def _section_from_page_context(page_text: str | None, quote: str | None) -> str | None:
    """Pick the nearest preceding numbered section header on the page for this quote."""
    if not page_text:
        return None
    quote = " ".join((quote or "").split())
    pos = -1
    if quote:
        pos = page_text.find(quote[: min(80, len(quote))])
        if pos < 0:
            # Fall back to a shorter distinctive fragment.
            fragment = quote[:40]
            if fragment:
                pos = page_text.find(fragment)
    search_upto = pos if pos >= 0 else min(len(page_text), 2500)
    headers = []
    for match in SECTION_HEADER_RE.finditer(page_text[:search_upto]):
        number = match.group("num")
        title = (match.group("title") or "").strip()
        # Skip page folios / Rec. headers and lone integers.
        if "." not in number:
            continue
        if title.lower().startswith("rec."):
            continue
        headers.append(match)
    if not headers:
        return None
    # Nearest preceding header; prefer a more specific child in the same window.
    best = headers[-1]
    best_num = best.group("num")
    for match in reversed(headers):
        number = match.group("num")
        if number == best_num or number.startswith(best_num + "."):
            best_num = number
            break
        if best.start() - match.start() > 280:
            break
        if number.count(".") > best_num.count("."):
            best_num = number
            break
    return best_num


def resolve_section_citation(
    *,
    document_id: str,
    section_label: str | None,
    quote: str | None,
    page_text: str | None = None,
) -> dict[str, str | None]:
    direct = _section_ref_from_label(section_label)
    if direct:
        return {
            "section_label": section_label,
            "section_ref": direct,
        }

    quote = quote or ""
    candidates: list[str] = []
    page_section = _section_from_page_context(page_text, quote)
    if page_section:
        candidates.append(page_section)
    for match in CLAUSE_MENTION_RE.finditer(quote):
        candidates.append(match.group(1))
    for match in SECTION_NUM_RE.finditer(quote):
        candidates.append(match.group(1))

    # Prefer the most specific (longest) clause number that exists as a real section node.
    # Keep page-context candidate first when present.
    ordered: list[str] = []
    for number in candidates:
        if number not in ordered:
            ordered.append(number)
    ordered = sorted(ordered, key=lambda value: (-value.count("."), -len(value)))
    if page_section and page_section in ordered:
        ordered = [page_section] + [value for value in ordered if value != page_section]

    with connect() as connection:
        for number in ordered:
            row = connection.execute(
                """
                SELECT label FROM nodes
                WHERE document_id=? AND node_type='Section'
                  AND (label=? OR label LIKE ?)
                ORDER BY length(label) ASC
                LIMIT 1
                """,
                (document_id, number, f"{number} %"),
            ).fetchone()
            if row and _looks_like_section_label(row["label"]):
                return {
                    "section_label": row["label"],
                    "section_ref": f"§{number}",
                }
    clean_label = section_label if _looks_like_section_label(section_label or "") else None
    if ordered:
        return {
            "section_label": clean_label or f"{ordered[0]}",
            "section_ref": f"§{ordered[0]}",
        }
    return {"section_label": clean_label, "section_ref": None}


def citation_heading(
    *,
    family: str | None,
    edition: str | None,
    section_ref: str | None,
    page_ordinal: int | None,
    printed_page: str | None,
) -> str:
    parts = [short_standard_label(family, edition)]
    if section_ref:
        parts.append(section_ref)
    if page_ordinal is not None:
        parts.append(f"PDF p.{page_ordinal}")
    if printed_page:
        parts.append(f"Printed p.{printed_page}")
    return " · ".join(parts)


def _bbox_from_words(words: list[dict[str, Any]]) -> list[float] | None:
    if not words:
        return None
    return [
        min(float(word["x0"]) for word in words),
        min(float(word["top"]) for word in words),
        max(float(word["x1"]) for word in words),
        max(float(word["bottom"]) for word in words),
    ]


def _line_bboxes_from_words(words: list[dict[str, Any]]) -> list[list[float]]:
    """Group words into reading-order line boxes so highlights follow exact lines."""
    if not words:
        return []
    ordered = sorted(
        words,
        key=lambda word: (round(float(word["top"]) / 3.0), float(word["x0"])),
    )
    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_top: float | None = None
    for word in ordered:
        top = float(word["top"])
        height = max(1.0, float(word["bottom"]) - top)
        if current_top is None or abs(top - current_top) <= max(3.0, height * 0.55):
            current.append(word)
            current_top = top if current_top is None else (current_top * 0.7 + top * 0.3)
        else:
            box = _bbox_from_words(current)
            if box:
                lines.append(box)
            current = [word]
            current_top = top
    if current:
        box = _bbox_from_words(current)
        if box:
            lines.append(box)
    return lines


def clip_bbox_to_page(
    bbox: list[float] | None,
    *,
    page_width: float,
    page_height: float,
) -> list[float] | None:
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    x0, y0, x1, y1 = (float(value) for value in bbox)
    x0 = max(0.0, min(page_width, x0))
    x1 = max(0.0, min(page_width, x1))
    y0 = max(0.0, min(page_height, y0))
    y1 = max(0.0, min(page_height, y1))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return [x0, y0, x1, y1]


def bbox_is_reliable(
    bbox: list[float] | None,
    *,
    page_width: float | None,
    page_height: float | None,
) -> bool:
    """Reject huge/page-filling boxes that obscure the source."""
    if not isinstance(bbox, list) or len(bbox) != 4:
        return False
    x0, y0, x1, y1 = (float(value) for value in bbox)
    if x1 <= x0 or y1 <= y0:
        return False
    width = x1 - x0
    height = y1 - y0
    if page_width and page_height and page_width > 0 and page_height > 0:
        if width / page_width > 0.92 and height / page_height > 0.28:
            return False
        if height / page_height > 0.45:
            return False
    if height > 160:
        return False
    return True


def refine_quote_bboxes(
    *,
    document_id: str,
    page_ordinal: int,
    quote: str,
    context_bbox: list[float] | None,
) -> dict[str, Any]:
    """Build a tight quote highlight plus lighter context box. Never invents a fake match."""
    context = (
        context_bbox
        if isinstance(context_bbox, list) and len(context_bbox) == 4
        else None
    )
    quote = " ".join((quote or "").split())
    unavailable = "Highlight unavailable — citation location requires verification"
    if not quote:
        return {
            "quote_bbox": None,
            "quote_line_bboxes": [],
            "context_bbox": context,
            "highlight_available": False,
            "highlight_warning": unavailable,
        }

    # Focus the primary highlight on the cited opening lines; keep the span as context.
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", quote) if part.strip()]
    focused = " ".join(sentences[:2]) if sentences else quote
    focused_words = focused.split()
    if len(focused_words) < 8:
        focused_words = quote.split()[:40]
        focused = " ".join(focused_words)
    else:
        focused_words = focused_words[:48]
        focused = " ".join(focused_words)

    settings = get_settings()
    with connect() as connection:
        row = connection.execute(
            "SELECT filename, sha256 FROM documents WHERE id=?", (document_id,)
        ).fetchone()
    if not row:
        return {
            "quote_bbox": None,
            "quote_line_bboxes": [],
            "context_bbox": context,
            "highlight_available": False,
            "highlight_warning": unavailable,
        }

    cache_key = hashlib.sha256(
        f"{row['sha256']}:{page_ordinal}:{focused[:240]}:quote-bbox-v4-lines".encode()
    ).hexdigest()
    cache_dir = settings.artifact_dir / "quote_bboxes"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{cache_key}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        cached.setdefault("quote_line_bboxes", [])
        # Never treat a context-only box as an available quote highlight.
        if not cached.get("quote_bbox") and not cached.get("quote_line_bboxes"):
            cached["highlight_available"] = False
            cached["highlight_warning"] = cached.get("highlight_warning") or unavailable
        return cached

    path = settings.source_dir / row["filename"]
    quote_bbox = None
    quote_line_bboxes: list[list[float]] = []
    warning = None
    page_width = None
    page_height = None
    try:
        with pdfplumber.open(path) as pdf:
            page = pdf.pages[page_ordinal - 1]
            page_width = float(page.width)
            page_height = float(page.height)
            words = page.extract_words(
                x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=True
            )
        tokens = [str(word["text"]) for word in words]
        needle = focused_words
        # Use a distinctive prefix so we lock onto the cited lines, not the whole window.
        prefix = needle[: min(18, len(needle))]
        if len(prefix) >= 4:
            joined = [token.lower() for token in tokens]
            target = [token.lower() for token in prefix]
            start = -1
            for index in range(0, max(0, len(joined) - len(target) + 1)):
                if joined[index : index + len(target)] == target:
                    start = index
                    break
            if start >= 0:
                end = min(len(words), start + len(needle))
                if end - start < len(prefix):
                    end = min(len(words), start + len(prefix))
                matched = words[start:end]
                quote_line_bboxes = _line_bboxes_from_words(matched)
                quote_bbox = _bbox_from_words(matched)
                if not bbox_is_reliable(
                    quote_bbox, page_width=page_width, page_height=page_height
                ):
                    # Prefer individual line boxes when the union is too tall.
                    reliable_lines = [
                        box
                        for box in quote_line_bboxes
                        if bbox_is_reliable(
                            box, page_width=page_width, page_height=page_height
                        )
                    ]
                    if reliable_lines:
                        quote_line_bboxes = reliable_lines
                        quote_bbox = _bbox_from_words(
                            [
                                {
                                    "x0": box[0],
                                    "top": box[1],
                                    "x1": box[2],
                                    "bottom": box[3],
                                }
                                for box in reliable_lines
                            ]
                        )
                    else:
                        quote_bbox = None
                        quote_line_bboxes = []
                        warning = unavailable
            else:
                warning = unavailable
        else:
            warning = unavailable
    except Exception as exc:  # noqa: BLE001
        warning = f"Highlight unavailable — {exc}"

    if quote_bbox is None and not quote_line_bboxes:
        warning = warning or unavailable

    payload = {
        "quote_bbox": quote_bbox,
        "quote_line_bboxes": quote_line_bboxes,
        "context_bbox": context,
        "highlight_available": bool(quote_line_bboxes or quote_bbox),
        "highlight_warning": None if (quote_line_bboxes or quote_bbox) else warning,
    }
    cache_path.write_text(json.dumps(payload))
    return payload

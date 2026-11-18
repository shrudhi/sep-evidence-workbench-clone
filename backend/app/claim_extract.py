"""Deterministic claim extraction from the prepared patent PDF layout."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pdfplumber

DEPENDENCY_RE = re.compile(r"\bof claim\s+(\d+)\b", re.IGNORECASE)


def _normalize(text: str) -> str:
    return " ".join(text.split())


def _preview(text: str, limit: int = 110) -> str:
    clean = _normalize(text)
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + "…"


def _dependencies(text: str) -> list[int]:
    return sorted({int(match) for match in DEPENDENCY_RE.findall(text)})


def extract_claims_from_patent_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    """Extract numbered claims using USPTO two-column geometry.

    Starts at the right-column 'What is claimed' block, then follows sequential
    claim numbers across right and left columns on subsequent pages.
    """
    with pdfplumber.open(pdf_path) as pdf:
        start_page_idx = None
        column_x = None
        claim_one_top = None
        for index, page in enumerate(pdf.pages):
            words = page.extract_words(use_text_flow=False)
            anchors = [
                word
                for word in words
                if str(word["text"]).lower() == "what" and float(word["x0"]) > page.width * 0.45
            ]
            if not anchors:
                continue
            anchor = anchors[0]
            column_x = float(anchor["x0"])
            numbers = [
                word
                for word in words
                if float(word["top"]) > float(anchor["top"])
                and float(word["x0"]) >= column_x - 12
                and re.fullmatch(r"\d+\.?", str(word["text"]))
            ]
            claim_one = next(
                (word for word in numbers if str(word["text"]).rstrip(".") == "1"),
                None,
            )
            if not claim_one:
                continue
            start_page_idx = index
            claim_one_top = float(claim_one["top"])
            break
        if start_page_idx is None or column_x is None or claim_one_top is None:
            raise RuntimeError("Could not locate claim 1 using the patent's column geometry")

        # Claim numbers sit near the left edge of a column (~87 or ~321 on letter pages).
        markers: list[tuple[int, float, int, dict[str, Any], float]] = []
        for page_index, page in enumerate(pdf.pages[start_page_idx:], start_page_idx):
            words = page.extract_words(use_text_flow=False)
            for word in words:
                if not re.fullmatch(r"\d+\.?", str(word["text"])):
                    continue
                number = int(str(word["text"]).rstrip("."))
                if number < 1 or number > 200:
                    continue
                x0 = float(word["x0"])
                top = float(word["top"])
                if page_index == start_page_idx and top < claim_one_top - 1:
                    continue
                # Ignore center line numbers (~300) and body numerals.
                left_col = 70 <= x0 <= 110
                right_col = 300 <= x0 <= 340
                if not (left_col or right_col):
                    continue
                # On the claims-start page, prefer the right column until claim 1 is passed.
                if page_index == start_page_idx and left_col and top < claim_one_top:
                    continue
                markers.append((page_index, top, number, word, x0))

        markers.sort(key=lambda item: (item[0], item[1], item[4]))
        selected: list[tuple[int, float, int, dict[str, Any], float]] = []
        expect = 1
        for marker in markers:
            if marker[2] != expect:
                continue
            selected.append(marker)
            expect += 1

        if not selected or selected[0][2] != 1:
            raise RuntimeError("Failed to assemble a sequential claim list starting at claim 1")

        claims: list[dict[str, Any]] = []
        for index, (page_index, top, number, marker_word, marker_x) in enumerate(selected):
            if index + 1 < len(selected):
                end_page, end_top, _, _, end_x = selected[index + 1]
            else:
                end_page, end_top, end_x = selected[-1][0], 10_000.0, marker_x

            parts: list[dict[str, Any]] = []
            for walk_page in range(page_index, end_page + 1):
                page = pdf.pages[walk_page]
                # Active column band for this page in reading order.
                if walk_page == page_index:
                    active_x = marker_x
                elif walk_page == end_page:
                    # Text before the next claim stays in the next claim's column only when
                    # the next claim begins mid-page; otherwise keep prior column.
                    active_x = end_x if end_top < 10_000 else marker_x
                else:
                    active_x = 90.0 if marker_x >= 200 else marker_x
                col_left, col_right = (70.0, 292.0) if active_x < 200 else (305.0, 580.0)
                for word in page.extract_words(use_text_flow=False):
                    wt = float(word["top"])
                    wx = float(word["x0"])
                    if wt < 70:
                        continue  # page headers
                    if walk_page == page_index and wt < top - 0.5:
                        continue
                    if walk_page == end_page and end_top < 10_000 and wt >= end_top - 0.5:
                        continue
                    if word is marker_word:
                        continue
                    if wx < col_left or wx > col_right:
                        continue
                    # Drop centered USPTO line numbers between columns.
                    if 295 <= wx <= 305 and re.fullmatch(r"\d+", str(word["text"])):
                        continue
                    parts.append(word)

            parts.sort(key=lambda word: (round(float(word["top"]) / 3), float(word["x0"])))
            if parts and str(parts[0]["text"]) == ".":
                parts = parts[1:]
            while parts and str(parts[-1]["text"]).replace(" ", "") in {"*", "***", "****"}:
                parts.pop()
            exact = _normalize(" ".join(str(word["text"]) for word in parts))
            # Soft-join common USPTO line-break hyphenation artifacts.
            exact = re.sub(r"\bcir cuitry\b", "circuitry", exact, flags=re.IGNORECASE)
            exact = re.sub(r"\bthatm aps\b", "that maps", exact, flags=re.IGNORECASE)
            exact = re.sub(r"\bcom ponent\b", "component", exact, flags=re.IGNORECASE)
            exact = re.sub(r"\borthogonal- t ransformed\b", "orthogonal-transformed", exact, flags=re.IGNORECASE)
            if exact.startswith(f"{number} ."):
                exact = exact[len(f"{number} .") :].strip()
            elif exact.startswith(f"{number}."):
                exact = exact[len(f"{number}.") :].strip()
            # Strip accidental leading claim-number echoes.
            exact = re.sub(rf"^{number}\s*\.\s*", "", exact).strip()
            if len(exact) < 20:
                raise RuntimeError(f"Claim {number} extraction produced insufficient text")
            claims.append(
                {
                    "number": number,
                    "preview": _preview(exact),
                    "exact_text": exact,
                    "depends_on": _dependencies(exact),
                }
            )
        return claims


def extract_claims_for_document(filename: str, source_dir: Path | None = None) -> list[dict[str, Any]]:
    from .config import get_settings

    root = source_dir or get_settings().source_dir
    return extract_claims_from_patent_pdf(root / filename)

/** Split a standard quote into readable segments when multiple clauses appear. */

/**
 * Only split before a real clause/section marker.
 * Negative lookbehind prevents matching inside dotted refs like 9.3.5.2
 * (otherwise `\b` before each digit after a `.` creates fake segments "9." / "3.").
 */
const SECTION_BREAK_RE =
  /(?=(?:(?:^|[\s({\[])(?:clause|section|subclause)\s+\d+(?:\.\d+){0,5}\b)|(?:(?<![\d.])\d+(?:\.\d+){1,5}\s+[A-Z][A-Za-z]))/gi;

const NUMERIC_CRUMB_RE = /^(?:\d+\.)+$/;

export type QuoteSegment = {
  heading: string | null;
  text: string;
};

export function formatPrintedPage(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^([A-Z]?-?\d{1,4}|[ivxlcdm]{2,8})$/i.test(text)) return text;
  return null;
}

export function citationTrail(parts: {
  sectionRef?: string | null;
  sectionLabel?: string | null;
  printedPage?: string | number | null;
  pdfPage?: number | null;
}): string[] {
  const trail: string[] = [];
  const printed = formatPrintedPage(parts.printedPage);
  if (printed) trail.push(`Printed p. ${printed}`);
  if (parts.pdfPage != null) trail.push(`PDF p. ${parts.pdfPage}`);
  const section =
    parts.sectionRef ||
    (parts.sectionLabel && !/^\d{1,4}\s+Rec\./i.test(parts.sectionLabel)
      ? parts.sectionLabel
      : null);
  if (section) {
    const clean = section.replace(/^§\s*/, "");
    trail.push(section.startsWith("§") ? section : `§${clean}`);
  }
  return trail;
}

/** Re-join PDF line breaks that split dotted section numbers: "9.\\n3" → "9.3". */
export function healBrokenSectionNumbers(text: string): string {
  return text
    .replace(/(\d)\.\s*\n\s*(?=\d)/g, "$1.")
    .replace(/(\d)\.\s*\n\s*\n\s*(?=\d)/g, "$1.");
}

function isNumericCrumb(text: string): boolean {
  return NUMERIC_CRUMB_RE.test(text.trim());
}

/** Merge orphan "9." / "3." crumbs back into the following segment. */
export function coalesceNumericCrumbs(segments: QuoteSegment[]): QuoteSegment[] {
  if (segments.length <= 1) return segments;
  const merged: QuoteSegment[] = [];
  let pending = "";
  for (const segment of segments) {
    const body = segment.text.trim();
    if (!body && !segment.heading) continue;
    if (isNumericCrumb(body) && !segment.heading) {
      pending += body;
      continue;
    }
    if (pending) {
      const heading = segment.heading;
      if (heading && /^\d/.test(heading)) {
        merged.push({
          heading: `${pending}${heading}`,
          text: segment.text
        });
      } else {
        merged.push({
          heading: segment.heading,
          text: `${pending}${segment.text}`.replace(/\s+/g, " ").trim()
        });
      }
      pending = "";
      continue;
    }
    merged.push(segment);
  }
  if (pending) {
    if (merged.length) {
      const last = merged[merged.length - 1];
      merged[merged.length - 1] = {
        ...last,
        text: `${last.text} ${pending}`.trim()
      };
    } else {
      merged.push({ heading: null, text: pending });
    }
  }
  return merged;
}

export function splitQuoteSegments(quote: string): QuoteSegment[] {
  const cleaned = healBrokenSectionNumbers(quote.replace(/\r\n/g, "\n").trim());
  if (!cleaned) return [];

  // Prefer explicit blank-line / paragraph breaks first.
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    const fromParagraphs = paragraphs.map((text) => extractHeading(text));
    return coalesceNumericCrumbs(fromParagraphs);
  }

  // Single block that embeds multiple clause markers — split gently.
  const pieces = cleaned
    .split(SECTION_BREAK_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (pieces.length <= 1) {
    return [{ heading: null, text: cleaned.replace(/\n+/g, " ") }];
  }

  return coalesceNumericCrumbs(pieces.map((piece) => extractHeading(piece.replace(/\n+/g, " "))));
}

/** Section number + short title; stop on word boundaries (never mid-word). */
function extractHeading(piece: string): QuoteSegment {
  const headingMatch = piece.match(
    /^(?:(?:clause|section|subclause)\s+)?\d+(?:\.\d+){1,5}(?:\s+[A-Za-z][\w/-]*){0,12}(?:\s*\([^)]{0,48}\))?/i
  );
  if (headingMatch && headingMatch[0].length < piece.length) {
    const heading = headingMatch[0].trim();
    const rest = piece.slice(heading.length).trim();
    if (rest) return { heading, text: rest };
  }
  return { heading: null, text: piece };
}

/** Group evidence by PDF page so each page keeps its own quote + screenshot. */
export function pageGroupKey(block: {
  page_ordinal?: number | null;
  printed_label?: string | null;
  evidence_id?: string;
}): string {
  if (block.page_ordinal != null) return `pdf:${block.page_ordinal}`;
  const printed = formatPrintedPage(block.printed_label);
  if (printed) return `printed:${printed}`;
  if (block.evidence_id) return `id:${block.evidence_id}`;
  return "page:unknown";
}

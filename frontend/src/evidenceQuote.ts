/** Split a standard quote into readable segments when multiple clauses appear. */

const SECTION_BREAK_RE =
  /(?=(?:(?:clause|section|subclause)\s+\d+(?:\.\d+){0,5}\b)|(?:\b\d+(?:\.\d+){1,5}\s+[A-Z][A-Za-z]))/gi;

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

export function splitQuoteSegments(quote: string): QuoteSegment[] {
  const cleaned = quote.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  // Prefer explicit blank-line / paragraph breaks first.
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs.map((text) => {
      const headingMatch = text.match(
        /^(?:(?:clause|section|subclause)\s+\d+(?:\.\d+){0,5}|\d+(?:\.\d+){1,5})\b[^\n]{0,80}/i
      );
      if (headingMatch && headingMatch[0].length < text.length) {
        return {
          heading: headingMatch[0].trim(),
          text: text.slice(headingMatch[0].length).trim()
        };
      }
      return { heading: null, text };
    });
  }

  // Single block that embeds multiple clause markers — split gently.
  const pieces = cleaned
    .split(SECTION_BREAK_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (pieces.length <= 1) {
    return [{ heading: null, text: cleaned.replace(/\n+/g, " ") }];
  }

  return pieces.map((piece) => {
    const headingMatch = piece.match(
      /^(?:(?:clause|section|subclause)\s+\d+(?:\.\d+){0,5}|\d+(?:\.\d+){1,5})(?:\s+[^\n]{0,60})?/i
    );
    if (headingMatch && headingMatch[0].length < Math.min(piece.length, 120)) {
      const heading = headingMatch[0].trim();
      const rest = piece.slice(heading.length).trim().replace(/\n+/g, " ");
      return { heading, text: rest || piece.replace(/\n+/g, " ") };
    }
    return { heading: null, text: piece.replace(/\n+/g, " ") };
  });
}

export function pageGroupKey(block: {
  page_ordinal?: number | null;
  printed_label?: string | null;
}): string {
  const printed = formatPrintedPage(block.printed_label);
  if (printed) return `printed:${printed}`;
  if (block.page_ordinal != null) return `pdf:${block.page_ordinal}`;
  return "page:unknown";
}

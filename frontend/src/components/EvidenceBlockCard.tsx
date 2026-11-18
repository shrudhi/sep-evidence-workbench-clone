import { useState, type MouseEvent } from "react";
import { evidenceHeading, highlightAvailable } from "../evidenceLabels";
import { formatPrintedPage, splitQuoteSegments } from "../evidenceQuote";
import type { EvidenceBlock } from "../types";

type Props = {
  block: EvidenceBlock;
  active?: boolean;
  onOpenDocument?: (block: EvidenceBlock) => void;
  compact?: boolean;
  /** Chart target edition — used to flag wrong-version citations. */
  targetEdition?: string | null;
  evidenceTierLabel?: string | null;
};

/** Build an <img>-safe screenshot URL (colon-bearing span IDs break path URLs). */
function screenshotImgSrc(block: EvidenceBlock): string {
  const eid = block.evidence_id;
  if (eid) {
    return `/api/evidence/screenshot?span_id=${encodeURIComponent(eid)}&v=crop5`;
  }
  const raw = block.screenshot_url || "";
  if (!raw) return "";
  // Legacy path form: /api/evidence/{span_id}/screenshot
  const match = raw.match(/^(\/api\/evidence\/)(.+?)(\/screenshot)(\?.*)?$/);
  if (match) {
    return `${match[1]}${encodeURIComponent(decodeURIComponent(match[2]))}${match[3]}?v=crop5`;
  }
  return `${raw}${raw.includes("?") ? "&" : "?"}v=crop5`;
}

/**
 * Reference-chart style evidence cell:
 * Evidence ID | edition | section | pages → quote → cropped screenshot → View in Doc.
 * The card itself is not clickable; only the explicit button opens the document.
 */
export default function EvidenceBlockCard({
  block,
  active = false,
  onOpenDocument,
  compact = false,
  targetEdition = null
}: Props) {
  const [quoteExpanded, setQuoteExpanded] = useState(false);

  if (!block.available) {
    return (
      <div className="evidence-block unavailable">
        <strong>{evidenceHeading(block)}</strong>
        <p>{block.error || "Evidence unavailable"}</p>
      </div>
    );
  }

  const edition = block.source?.edition || "Edition unknown";
  const editionMismatch =
    Boolean(targetEdition && block.source?.edition) &&
    targetEdition!.replace(/\s+/g, " ").trim().toLowerCase() !==
      block.source!.edition.replace(/\s+/g, " ").trim().toLowerCase();
  const section =
    block.section_ref ||
    (block.section_label && !/^\d{1,4}\s+Rec\./i.test(block.section_label)
      ? block.section_label
      : null) ||
    "Section n/a";
  const printed = formatPrintedPage(block.printed_label);
  const pageLine = [
    printed ? `printed ${printed}` : null,
    block.page_ordinal != null ? `PDF ${block.page_ordinal}` : null
  ]
    .filter(Boolean)
    .join(" / ");
  const citationLine = [
    `E${String(block.evidence_number).padStart(2, "0")}`,
    edition,
    section,
    pageLine || null
  ]
    .filter(Boolean)
    .join(" | ");

  const segments = splitQuoteSegments(block.quote || "");
  const longQuote = (block.quote || "").length > 420;
  const visibleSegments =
    !longQuote || quoteExpanded
      ? segments
      : segments.slice(0, 1).map((segment, index) => {
          if (index > 0) return segment;
          const text =
            segment.text.length > 360
              ? `${segment.text.slice(0, 360).trim()}…`
              : segment.text;
          return { ...segment, text };
        });

  const openDoc = (event: MouseEvent) => {
    event.stopPropagation();
    onOpenDocument?.(block);
  };

  return (
    <article
      className={`evidence-block structured reference-style ${
        active ? "active-in-viewer" : ""
      } ${editionMismatch ? "edition-mismatch" : ""}`}
    >
      <header className="evidence-ref-head">
        <div className="evidence-ref-citation" title={citationLine}>
          {citationLine}
        </div>
        {editionMismatch ? (
          <div className="warn-box" style={{ marginTop: 6 }}>
            Wrong edition — cited {block.source?.edition} ≠ chart {targetEdition}
          </div>
        ) : null}
        {active ? (
          <p className="evidence-id-meta">Showing in document panel</p>
        ) : null}
      </header>

      <div className="evidence-quote-panel">
        <div className="evidence-label">Quote</div>
        {visibleSegments.map((segment, index) => (
          <div key={index} className="evidence-quote-segment">
            {segment.heading ? (
              <div className="evidence-quote-heading">{segment.heading}</div>
            ) : null}
            <p className="evidence-quote-text">“{segment.text}”</p>
          </div>
        ))}
        {longQuote ? (
          <button
            type="button"
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setQuoteExpanded((value) => !value);
            }}
          >
            {quoteExpanded ? "Collapse quote" : "Expand quote"}
          </button>
        ) : null}
      </div>

      {!compact && block.screenshot_url ? (
        <figure className="evidence-shot cropped">
          <img
            src={screenshotImgSrc(block)}
            alt={`Cited passage screenshot for ${evidenceHeading(block)}`}
            loading="lazy"
          />
          <figcaption>
            Passage crop
            {block.page_ordinal != null ? ` · PDF p. ${block.page_ordinal}` : ""}
            {printed ? ` · Printed p. ${printed}` : ""}
            {!highlightAvailable(block) ? " · Highlight unavailable" : ""}
          </figcaption>
          {onOpenDocument ? (
            <button type="button" className="secondary view-in-doc" onClick={openDoc}>
              {active ? "Showing in Doc" : "View in Doc"}
            </button>
          ) : null}
        </figure>
      ) : !compact ? (
        <div className="evidence-shot-missing">
          <p className="doc-sub">No passage screenshot available.</p>
          {onOpenDocument ? (
            <button type="button" className="secondary view-in-doc" onClick={openDoc}>
              {active ? "Showing in Doc" : "View in Doc"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!compact && (!highlightAvailable(block) || block.highlight_warning) ? (
        <div className="warn-box" style={{ marginTop: 8 }}>
          {block.highlight_warning || "Highlight unavailable"}
        </div>
      ) : null}
    </article>
  );
}

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { evidenceHeading, highlightAvailable } from "../evidenceLabels";
import { formatPrintedPage, splitQuoteSegments } from "../evidenceQuote";
import type { EvidenceBlock } from "../types";
import ScreenshotModal, {
  downloadScreenshot,
  type ScreenshotItem
} from "./ScreenshotModal";

type Props = {
  block: EvidenceBlock;
  active?: boolean;
  onOpenDocument?: (block: EvidenceBlock) => void;
  compact?: boolean;
  /** Chart target edition — used to flag wrong-version citations. */
  targetEdition?: string | null;
  evidenceTierLabel?: string | null;
  /** When true, omit inline View in Doc (shown on the proof-card header instead). */
  hideViewInDoc?: boolean;
};

type AddedShot = {
  id: string;
  name: string;
  src: string;
};

/** Build an <img>-safe screenshot URL (colon-bearing span IDs break path URLs). */
function screenshotImgSrc(block: EvidenceBlock): string {
  const eid = block.evidence_id;
  if (eid) {
    return `/api/evidence/screenshot?span_id=${encodeURIComponent(eid)}&v=crop5`;
  }
  const raw = block.screenshot_url || "";
  if (!raw) return "";
  const match = raw.match(/^(\/api\/evidence\/)(.+?)(\/screenshot)(\?.*)?$/);
  if (match) {
    return `${match[1]}${encodeURIComponent(decodeURIComponent(match[2]))}${match[3]}?v=crop5`;
  }
  return `${raw}${raw.includes("?") ? "&" : "?"}v=crop5`;
}

function pageCaption(block: EvidenceBlock, printed: string | null): string {
  const parts = [
    block.page_ordinal != null ? `PDF p. ${block.page_ordinal}` : null,
    printed ? `printed p. ${printed}` : null
  ].filter(Boolean);
  return parts.join(" · ") || "Cited passage";
}

export default function EvidenceBlockCard({
  block,
  active = false,
  onOpenDocument,
  compact = false,
  targetEdition = null,
  hideViewInDoc = false
}: Props) {
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeShotId, setActiveShotId] = useState("primary");
  const [addedShots, setAddedShots] = useState<AddedShot[]>([]);
  const [primaryHidden, setPrimaryHidden] = useState(false);
  const addFileRef = useRef<HTMLInputElement>(null);

  const printed = formatPrintedPage(block.printed_label);
  const rawPrimarySrc = block.available && block.screenshot_url ? screenshotImgSrc(block) : "";
  const primarySrc = primaryHidden ? "" : rawPrimarySrc;

  const shotItems: ScreenshotItem[] = useMemo(() => {
    const items: ScreenshotItem[] = [];
    if (primarySrc) {
      items.push({
        id: "primary",
        src: primarySrc,
        label: `Screenshot · ${pageCaption(block, printed)}`,
        removable: true
      });
    }
    for (const shot of addedShots) {
      items.push({
        id: shot.id,
        src: shot.src,
        label: shot.name,
        removable: true
      });
    }
    return items;
  }, [primarySrc, addedShots, block, printed]);

  useEffect(() => {
    return () => {
      for (const shot of addedShots) URL.revokeObjectURL(shot.src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!block.available) {
    return (
      <div className="evidence-block unavailable">
        <strong>{evidenceHeading(block)}</strong>
        <p>{block.error || "Evidence unavailable"}</p>
      </div>
    );
  }

  const family = block.source?.family || block.source?.short_label || "Standard";
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
  const pageParts = [
    printed ? `printed p. ${printed}` : null,
    block.page_ordinal != null ? `PDF p. ${block.page_ordinal}` : null
  ].filter(Boolean);
  const sourceLine = [family, edition, section, pageParts.join(" · ") || null]
    .filter(Boolean)
    .join(" · ");

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

  const openModal = (event: MouseEvent, shotId = shotItems[0]?.id || "primary") => {
    event.stopPropagation();
    if (!shotItems.length) return;
    setActiveShotId(shotId);
    setModalOpen(true);
  };

  const onAddFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: AddedShot[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: `added-${crypto.randomUUID()}`,
        name: file.name,
        src: URL.createObjectURL(file)
      });
    }
    if (!next.length) return;
    setAddedShots((prev) => [...prev, ...next]);
    setActiveShotId(next[0].id);
    setModalOpen(true);
  };

  const onAddFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onAddFiles(event.target.files);
    event.target.value = "";
  };

  const removeShot = (item: ScreenshotItem) => {
    if (item.id === "primary") {
      setPrimaryHidden(true);
      const remaining = shotItems.filter((s) => s.id !== "primary");
      if (remaining.length) {
        setActiveShotId(remaining[0].id);
      } else {
        setModalOpen(false);
      }
      return;
    }
    setAddedShots((prev) => {
      const target = prev.find((s) => s.id === item.id);
      if (target) URL.revokeObjectURL(target.src);
      return prev.filter((s) => s.id !== item.id);
    });
    const remaining = shotItems.filter((s) => s.id !== item.id);
    if (remaining.length) {
      setActiveShotId(remaining[0].id);
    } else {
      setModalOpen(false);
    }
  };

  const downloadName = [
    family,
    section !== "Section n/a" ? section : null,
    block.page_ordinal != null ? `pdf-p${block.page_ordinal}` : null,
    "screenshot"
  ]
    .filter(Boolean)
    .join("-");

  const activeItem = shotItems.find((s) => s.id === activeShotId) || shotItems[0] || null;

  const iconActions = (shotId?: string) => (
    <div className="screenshot-icon-actions" role="toolbar" aria-label="Screenshot actions">
      <button
        type="button"
        className="screenshot-icon-btn"
        aria-label="Download screenshot"
        title="Download"
        disabled={!shotItems.length}
        onClick={(event) => {
          event.stopPropagation();
          const item =
            (shotId ? shotItems.find((s) => s.id === shotId) : null) ||
            shotItems.find((s) => s.id === "primary") ||
            shotItems[0];
          if (item) void downloadScreenshot(item, downloadName);
        }}
      >
        <Download size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="screenshot-icon-btn"
        aria-label="Add screenshot"
        title="Add"
        onClick={(event) => {
          event.stopPropagation();
          addFileRef.current?.click();
        }}
      >
        <Plus size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="screenshot-icon-btn danger"
        aria-label="Remove screenshot"
        title="Remove"
        disabled={!shotItems.length}
        onClick={(event) => {
          event.stopPropagation();
          const item =
            (shotId ? shotItems.find((s) => s.id === shotId) : null) ||
            activeItem ||
            shotItems[0];
          if (item) removeShot(item);
        }}
      >
        <Trash2 size={15} strokeWidth={2} />
      </button>
    </div>
  );

  return (
    <article
      className={`evidence-block structured reference-style assignment-evidence ${
        active ? "active-in-viewer" : ""
      } ${editionMismatch ? "edition-mismatch" : ""}`}
    >
      <div className="evidence-field">
        <div className="evidence-label">Source</div>
        <div className="evidence-ref-citation" title={sourceLine}>
          {sourceLine}
        </div>
        {editionMismatch ? (
          <div className="warn-box" style={{ marginTop: 6 }}>
            Wrong edition — cited {block.source?.edition} ≠ chart {targetEdition}
          </div>
        ) : null}
      </div>

      <div className="evidence-field evidence-quote-panel">
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

      {!compact ? (
        <div className="evidence-field">
          <div className="evidence-label-row">
            <div className="evidence-label">Screenshot</div>
            {iconActions(shotItems[0]?.id)}
          </div>
          {primarySrc || addedShots.length ? (
            <figure className="evidence-shot cropped">
              {primarySrc ? (
                <button
                  type="button"
                  className="shot-hit"
                  onClick={(event) => openModal(event, "primary")}
                  aria-label="Enlarge screenshot"
                  title="Click to enlarge"
                >
                  <img
                    src={primarySrc}
                    alt={`Screenshot of cited passage for ${evidenceHeading(block)}`}
                    loading="lazy"
                  />
                </button>
              ) : null}
              {addedShots.length ? (
                <div className="evidence-added-shots">
                  {addedShots.map((shot) => (
                    <button
                      key={shot.id}
                      type="button"
                      className="shot-hit evidence-added-shot"
                      onClick={(event) => openModal(event, shot.id)}
                      aria-label={`Enlarge ${shot.name}`}
                      title="Click to enlarge"
                    >
                      <img src={shot.src} alt={shot.name} loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : null}
              <figcaption>
                Passage as it appears on the cited page
                {block.page_ordinal != null ? ` · PDF p. ${block.page_ordinal}` : ""}
                {printed ? ` · printed p. ${printed}` : ""}
                {!highlightAvailable(block) ? " · Highlight unavailable" : ""}
                {addedShots.length ? ` · ${addedShots.length} added` : ""}
                {" · click to enlarge"}
              </figcaption>
              {onOpenDocument && !hideViewInDoc ? (
                <button type="button" className="secondary view-in-doc" onClick={openDoc}>
                  {active ? "Showing in Doc" : "View in Doc"}
                </button>
              ) : null}
            </figure>
          ) : (
            <div className="evidence-shot-missing">
              <p className="doc-sub">
                {rawPrimarySrc && primaryHidden
                  ? "Screenshot removed. Use + to add one."
                  : "No screenshot available for this citation."}
              </p>
              {onOpenDocument && !hideViewInDoc ? (
                <button type="button" className="secondary view-in-doc" onClick={openDoc}>
                  {active ? "Showing in Doc" : "View in Doc"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {!compact && (!highlightAvailable(block) || block.highlight_warning) ? (
        <div className="warn-box" style={{ marginTop: 8 }}>
          {block.highlight_warning || "Highlight unavailable"}
        </div>
      ) : null}

      <input
        ref={addFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={onAddFileChange}
      />

      <ScreenshotModal
        open={modalOpen && shotItems.length > 0}
        title={evidenceHeading(block)}
        subtitle={sourceLine}
        items={shotItems}
        activeId={activeShotId}
        onSelect={setActiveShotId}
        onClose={() => setModalOpen(false)}
        onDownload={(item) => void downloadScreenshot(item, downloadName)}
        onAddFiles={onAddFiles}
        onRemove={removeShot}
      />
    </article>
  );
}

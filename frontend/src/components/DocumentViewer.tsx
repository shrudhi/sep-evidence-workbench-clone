import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  contextBboxForDisplay,
  evidenceHeading,
  highlightAvailable,
  isBBox,
  preferredBbox,
  quoteLineBboxes
} from "../evidenceLabels";
import type { EvidenceBlock } from "../types";

export type ViewerLocation = {
  documentId: string;
  page: number;
  bbox?: number[] | null;
  evidenceId?: string;
  label?: string;
};

type DocMeta = {
  id: string;
  family: string;
  title: string;
  edition: string;
  page_count: number;
  pages: {
    page_ordinal: number;
    printed_label?: string | null;
    width?: number;
    height?: number;
  }[];
  pdf_url: string;
};

type Props = {
  claimLabel: string;
  passages: EvidenceBlock[];
  passageIndex: number;
  onPassageIndexChange: (index: number) => void;
  location: ViewerLocation | null;
  onLocationChange: (next: ViewerLocation) => void;
  expanded: boolean;
  onToggleExpand: () => void;
};

type NavEntry = ViewerLocation & { kind: "cited" | "browse" | "reference" };

function bboxStyle(
  bbox: number[],
  pageWidth: number,
  pageHeight: number
): { left: string; top: string; width: string; height: string } | null {
  const [rawX0, rawY0, rawX1, rawY1] = bbox;
  const x0 = Math.max(0, Math.min(pageWidth, rawX0));
  const x1 = Math.max(0, Math.min(pageWidth, rawX1));
  const y0 = Math.max(0, Math.min(pageHeight, rawY0));
  const y1 = Math.max(0, Math.min(pageHeight, rawY1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return {
    left: `${(x0 / pageWidth) * 100}%`,
    top: `${(y0 / pageHeight) * 100}%`,
    width: `${((x1 - x0) / pageWidth) * 100}%`,
    height: `${((y1 - y0) / pageHeight) * 100}%`
  };
}

export default function DocumentViewer({
  claimLabel,
  passages,
  passageIndex,
  onPassageIndexChange,
  location,
  onLocationChange,
  expanded,
  onToggleExpand
}: Props) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<NavEntry[]>([]);
  const [pageMeta, setPageMeta] = useState<{
    page_width?: number | null;
    page_height?: number | null;
    printed_label?: string | null;
    render_width?: number;
    render_height?: number;
    scale?: number;
    image_url?: string;
    cache_key?: string;
  } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const currentPassage = passages[passageIndex] || null;
  const documentId =
    location?.documentId || currentPassage?.source?.document_id || "";
  const page = location?.page || currentPassage?.page_ordinal || 1;
  const onCitedPassage =
    Boolean(currentPassage?.evidence_id) &&
    location?.evidenceId === currentPassage?.evidence_id &&
    location?.page === currentPassage?.page_ordinal;

  const lineBoxes = (() => {
    if (onCitedPassage && currentPassage && highlightAvailable(currentPassage)) {
      return quoteLineBboxes(currentPassage);
    }
    if (location && location.bbox !== undefined) {
      return isBBox(location.bbox) ? [location.bbox] : [];
    }
    return currentPassage && highlightAvailable(currentPassage)
      ? quoteLineBboxes(currentPassage)
      : [];
  })();

  const quoteBbox = preferredBbox(
    onCitedPassage && currentPassage
      ? currentPassage
      : currentPassage && highlightAvailable(currentPassage)
        ? currentPassage
        : null
  );

  const contextBbox =
    onCitedPassage && currentPassage ? contextBboxForDisplay(currentPassage) : null;

  const highlightOk = lineBoxes.length > 0;
  const pageCount = meta?.page_count || 1;

  const pageGeometry = useMemo(() => {
    const fromMeta = meta?.pages.find((item) => item.page_ordinal === page);
    return {
      width: pageMeta?.page_width || fromMeta?.width || null,
      height: pageMeta?.page_height || fromMeta?.height || null,
      printed: pageMeta?.printed_label || fromMeta?.printed_label || null
    };
  }, [meta, page, pageMeta]);

  useEffect(() => {
    if (!documentId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    api<DocMeta>(`/api/documents/${documentId}/viewer`)
      .then((next) => {
        if (!cancelled) {
          setMeta(next);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!documentId || !page) {
      setPageMeta(null);
      return;
    }
    let cancelled = false;
    setImageFailed(false);
    setImageLoaded(false);
    api<{
      page_width?: number | null;
      page_height?: number | null;
      printed_label?: string | null;
      render_width?: number;
      render_height?: number;
      scale?: number;
      image_url?: string;
      cache_key?: string;
    }>(`/api/documents/${documentId}/pages/${page}/meta?scale=1.5`)
      .then((next) => {
        if (!cancelled) {
          setPageMeta(next);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPageMeta(null);
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, page, retryToken]);

  useEffect(() => {
    if (!highlightOk || !highlightRef.current || !imageLoaded) return;
    highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [documentId, page, quoteBbox, highlightOk, zoom, imageLoaded, passageIndex]);

  const pushHistory = (entry: NavEntry) => {
    setHistory((prev) => [...prev.slice(-19), entry]);
  };

  const goPage = (nextPage: number, kind: NavEntry["kind"] = "browse") => {
    const clamped = Math.max(1, Math.min(pageCount, nextPage));
    const next = {
      documentId,
      page: clamped,
      bbox: kind === "cited" ? quoteBbox : null,
      evidenceId: currentPassage?.evidence_id,
      label: meta ? `${meta.family} ${meta.edition}` : undefined
    };
    if (location) pushHistory({ ...location, kind: "browse" });
    onLocationChange(next);
  };

  const returnToCited = () => {
    if (!currentPassage?.source?.document_id || !currentPassage.page_ordinal) return;
    if (location) pushHistory({ ...location, kind: "browse" });
    onLocationChange({
      documentId: currentPassage.source.document_id,
      page: currentPassage.page_ordinal,
      bbox: preferredBbox(currentPassage),
      evidenceId: currentPassage.evidence_id,
      label: `${currentPassage.source.family} ${currentPassage.source.edition}`
    });
  };

  const goBack = () => {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const copy = [...prev];
      const last = copy.pop()!;
      onLocationChange(last);
      return copy;
    });
  };

  const lineStyles =
    pageGeometry.width && pageGeometry.height
      ? lineBoxes
          .map((box) => bboxStyle(box, pageGeometry.width!, pageGeometry.height!))
          .filter((style): style is NonNullable<typeof style> => Boolean(style))
      : [];
  const contextStyle =
    isBBox(contextBbox) && pageGeometry.width && pageGeometry.height
      ? bboxStyle(contextBbox, pageGeometry.width, pageGeometry.height)
      : null;

  const imageUrl = (() => {
    if (!documentId) return null;
    if (pageMeta?.image_url) {
      return `${pageMeta.image_url}${retryToken ? `&retry=${retryToken}` : ""}`;
    }
    return `/api/documents/${documentId}/pages/${page}?scale=1.5&v=${retryToken || "1"}`;
  })();

  const fallbackShot =
    imageFailed && currentPassage?.evidence_id
      ? `/api/evidence/screenshot?span_id=${encodeURIComponent(currentPassage.evidence_id)}&v=crop5`
      : imageFailed && currentPassage?.screenshot_url
        ? currentPassage.screenshot_url
        : null;
  const displaySrc = fallbackShot || imageUrl;

  if (!documentId) {
    return (
      <div className="empty">
        Select evidence with a linked document to open the viewer.
      </div>
    );
  }

  return (
    <div className={`document-viewer ${expanded ? "expanded" : ""}`}>
      <div className="document-viewer-toolbar">
        <div>
          <strong>
            {meta ? `${meta.family} — ${meta.edition}` : "Loading document…"}
          </strong>
          <div className="doc-sub">
            {meta?.title || ""}
            {meta?.edition ? ` · exact edition ${meta.edition}` : ""}
          </div>
          <div className="doc-sub">
            Claim {claimLabel}
            {currentPassage ? ` · Evidence ${currentPassage.evidence_number}` : ""}
          </div>
        </div>
        <div className="doc-toolbar-actions">
          <button type="button" className="ghost" onClick={onToggleExpand}>
            {expanded ? "Exit expanded" : "Expand viewer"}
          </button>
          <a
            className="ghost"
            href={`/api/documents/${documentId}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Open original PDF ↗
          </a>
        </div>
      </div>

      {currentPassage?.available ? (
        <div className="cited-passage-callout">
          <div className="cited-passage-label">Cited evidence on this page</div>
          <div className="cited-passage-heading">{evidenceHeading(currentPassage)}</div>
          <p className="cited-passage-quote">“{currentPassage.quote}”</p>
          <p className="doc-sub">
            {highlightOk
              ? `Translucent amber marks the quoted line${lineStyles.length === 1 ? "" : "s"}`
              : "Highlight unavailable for this citation"}
            {contextStyle ? "; lighter box shows supporting context" : ""}
            {pageGeometry.printed ? ` · printed p. ${pageGeometry.printed}` : ""}
            {` · PDF p. ${page}`}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="warn-box">
          {error}{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => setRetryToken((value) => value + 1)}
          >
            Retry page
          </button>
        </div>
      ) : null}

      <div className="document-controls">
        <button
          type="button"
          className="secondary"
          disabled={page <= 1}
          onClick={() => goPage(page - 1)}
        >
          Previous page
        </button>
        <label className="page-jump">
          PDF p.
          <input
            type="number"
            min={1}
            max={pageCount}
            value={page}
            onChange={(event) => goPage(Number(event.target.value) || 1)}
          />
          / {pageCount}
        </label>
        <button
          type="button"
          className="secondary"
          disabled={page >= pageCount}
          onClick={() => goPage(page + 1)}
        >
          Next page
        </button>
        {pageGeometry.printed ? (
          <span className="doc-sub">Printed p. {pageGeometry.printed}</span>
        ) : null}
        <button
          type="button"
          className="ghost"
          onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
        >
          Zoom in
        </button>
        <button type="button" className="ghost" onClick={() => setZoom(1)}>
          Fit width
        </button>
        <button type="button" className="ghost" disabled={!history.length} onClick={goBack}>
          Back to previous location
        </button>
        <button type="button" className="ghost" onClick={returnToCited}>
          Return to cited passage
        </button>
      </div>

      {passages.length > 1 ? (
        <div className="passage-nav">
          <button
            type="button"
            className="secondary"
            disabled={passageIndex <= 0}
            onClick={() => onPassageIndexChange(Math.max(0, passageIndex - 1))}
          >
            Previous cited passage
          </button>
          <span>
            Cited passage {passageIndex + 1} of {passages.length}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={passageIndex >= passages.length - 1}
            onClick={() =>
              onPassageIndexChange(Math.min(passages.length - 1, passageIndex + 1))
            }
          >
            Next cited passage
          </button>
        </div>
      ) : null}

      <div className="document-search">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter cited quote text on this panel"
          aria-label="Filter cited quote"
        />
        {search.trim() &&
        currentPassage?.quote?.toLowerCase().includes(search.trim().toLowerCase()) ? (
          <span className="doc-sub">Match in current cited quote</span>
        ) : null}
      </div>

      {!highlightOk ? (
        <div className="warn-box">
          {currentPassage?.highlight_warning ||
            "Highlight unavailable — citation location requires verification"}
          {page ? ` Opened PDF page ${page}.` : ""}
        </div>
      ) : (
        <div className="doc-sub" style={{ marginTop: 0 }}>
          Highlight ready for the cited lines on PDF p. {page}.
        </div>
      )}

      <div className="document-frame" ref={frameRef}>
        {displaySrc ? (
          <div
            className="document-page"
            style={{
              width: `${Math.round(zoom * 100)}%`
            }}
          >
            {!imageLoaded && !imageFailed ? (
              <div className="empty" style={{ marginBottom: 8 }}>
                Loading original PDF page {page}…
              </div>
            ) : null}
            <img
              key={displaySrc}
              src={displaySrc}
              alt={`Original PDF page ${page} of ${meta?.family || "document"} ${meta?.edition || ""}`}
              className="document-page-img"
              onLoad={() => {
                setImageLoaded(true);
                setImageFailed(false);
              }}
              onError={() => {
                setImageFailed(true);
                setImageLoaded(false);
              }}
            />
            {imageLoaded && !fallbackShot && highlightOk ? (
              <>
                {contextStyle ? (
                  <div
                    className="document-highlight context"
                    style={contextStyle}
                    title="Supporting context"
                  />
                ) : null}
                {lineStyles.map((style, index) => (
                  <div
                    key={`quote-line-${index}`}
                    ref={index === 0 ? highlightRef : undefined}
                    className="document-highlight quote"
                    style={style}
                    title="Cited quote line"
                  >
                    {index === 0 ? (
                      <span className="document-highlight-label">Cited evidence</span>
                    ) : null}
                  </div>
                ))}
              </>
            ) : null}
            {fallbackShot ? (
              <div className="warn-box" style={{ marginTop: 8 }}>
                Showing evidence screenshot fallback because the full-page render failed.{" "}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRetryToken((value) => value + 1)}
                >
                  Retry full page
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty">Loading page…</div>
        )}
      </div>
    </div>
  );
}

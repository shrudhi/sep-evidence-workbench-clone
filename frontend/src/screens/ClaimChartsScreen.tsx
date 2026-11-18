import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import AiReviewPanel, {
  aiReviewStatusKind,
  aiReviewStatusLabel
} from "../components/AiReviewPanel";
import AskAgentPanel from "../components/AskAgentPanel";
import ClaimEditModal from "../components/ClaimEditModal";
import DocumentViewer, { type ViewerLocation } from "../components/DocumentViewer";
import EvidencePassageList from "../components/EvidencePassageList";
import StatusChip, { mappingLabelKind } from "../components/StatusChip";
import { preferredBbox } from "../evidenceLabels";
import type { Chart, ChartRevision, EvidenceBlock, RunSummary, SetupBundle } from "../types";

const REVIEW_WIDTH_KEY = "sep.claimCharts.aiReviewWidth";
const REVIEW_WIDTH_MIN = 300;
const REVIEW_WIDTH_MAX = 720;
const REVIEW_WIDTH_DEFAULT = 400;

type Props = {
  setup: SetupBundle;
  runs: RunSummary[];
  activeRunId: string | null;
  chart: Chart | null;
  onSelectRun: (runId: string) => void;
  onRefreshChart: () => Promise<void>;
  focusRowId?: string | null;
  reviewMode?: boolean;
  onFocusRowConsumed?: () => void;
};

const IN_FLIGHT = new Set([
  "queued",
  "searching",
  "decomposing",
  "mapping",
  "reviewing"
]);

const READY = new Set(["analyst_review", "complete"]);

function statusLabel(run?: RunSummary | null, fallbackStatus?: string) {
  if (run?.status_label) return run.status_label;
  const status = run?.status || fallbackStatus || "";
  return (
    (
      {
        queued: "Queued",
        searching: "Searching",
        decomposing: "Decomposing",
        mapping: "Mapping",
        reviewing: "Reviewing",
        analyst_review: "Ready for analyst review",
        complete: "Complete",
        failed: "Failed"
      } as Record<string, string>
    )[status] || status || "No run yet"
  );
}

function pickRunForStandard(runs: RunSummary[], standardId: string, activeRunId: string | null) {
  const matching = runs.filter((run) => run.target_document_id === standardId);
  if (!matching.length) return undefined;
  return (
    matching.find((run) => run.id === activeRunId) ||
    matching.find((run) => IN_FLIGHT.has(run.status)) ||
    matching.find((run) => run.status === "analyst_review") ||
    matching.find((run) => run.status === "complete") ||
    matching.find((run) => run.status !== "failed") ||
    matching[0]
  );
}

function latestRevision(row: Chart["rows"][number]): ChartRevision | undefined {
  return row.revisions.at(-1);
}

/** Assignment review-agent outcome for a row (Passed / sent back / flagged). */
function reviewAgentLabel(revision: ChartRevision | undefined): string | null {
  if (!revision) return null;
  if (revision.mapping_review_status) return revision.mapping_review_status;
  const disposition = revision.review_disposition;
  if (disposition === "pass") return "Passed review";
  if (disposition === "rework") return "Sent back for rework";
  if (disposition === "flag") return "Flagged for analyst";
  const decision = revision.judge?.overall_decision;
  if (decision === "Passed checks") return "Passed review";
  if (decision === "Failed checks" || decision === "Failed") return "Failed review";
  if (decision === "Needs analyst review" || decision === "Needs review") {
    return "Flagged for analyst";
  }
  if (decision === "Review incomplete") return "Review incomplete";
  return revision.review_id ? "Review pending" : null;
}

export default function ClaimChartsScreen({
  setup,
  runs,
  activeRunId,
  chart,
  onSelectRun,
  onRefreshChart,
  focusRowId = null,
  onFocusRowConsumed
}: Props) {
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [challengeText, setChallengeText] = useState(
    "Rationale overstates support — re-check normative clauses and tighten Partial gaps."
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewDetailOpen, setReviewDetailOpen] = useState(false);
  const [docViewerOpen, setDocViewerOpen] = useState(false);
  const [viewerLocation, setViewerLocation] = useState<ViewerLocation | null>(null);
  const [passageIndex, setPassageIndex] = useState(0);
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [askAgentOpen, setAskAgentOpen] = useState(false);
  const [askAgentSeed, setAskAgentSeed] = useState<string | null>(null);
  const [askAgentPreferredElementId, setAskAgentPreferredElementId] = useState<string | null>(
    null
  );
  const [askAgentUi, setAskAgentUi] = useState<{
    historyOpen: boolean;
    layout: "normal" | "minimized" | "maximized";
  }>({ historyOpen: false, layout: "normal" });
  const [editOpen, setEditOpen] = useState(false);
  const [reviewWidth, setReviewWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(REVIEW_WIDTH_KEY) || "");
    if (Number.isFinite(stored) && stored >= REVIEW_WIDTH_MIN && stored <= REVIEW_WIDTH_MAX) {
      return stored;
    }
    return REVIEW_WIDTH_DEFAULT;
  });
  const [isResizingReview, setIsResizingReview] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  // Path A: only show standards that are the active chart target or currently building.
  // Do not surface historical G.722.2 / TS charts from older runs.
  const chartStandardIds = useMemo(() => {
    const ids = new Set<string>();
    if (chart?.run.target_document_id) ids.add(chart.run.target_document_id);
    for (const run of runs) {
      if (run.target_document_id && IN_FLIGHT.has(run.status)) {
        ids.add(run.target_document_id);
      }
    }
    if (ids.size === 0 && activeRunId) {
      const active = runs.find((run) => run.id === activeRunId);
      if (active?.target_document_id) ids.add(active.target_document_id);
    }
    return ids;
  }, [chart?.run.target_document_id, runs, activeRunId]);

  const standards = setup.standards.filter((item) => chartStandardIds.has(item.id));

  useEffect(() => {
    if (!focusRowId || !chart?.rows.length) return;
    setSelectedRow(focusRowId);
    onFocusRowConsumed?.();
  }, [focusRowId, chart?.rows, onFocusRowConsumed]);

  const sidePanelOpen = reviewDetailOpen || docViewerOpen;

  useEffect(() => {
    if (!sidePanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReviewDetailOpen(false);
        setDocViewerOpen(false);
        setExpandedDoc(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidePanelOpen]);

  useEffect(() => {
    window.localStorage.setItem(REVIEW_WIDTH_KEY, String(reviewWidth));
  }, [reviewWidth]);

  useEffect(() => {
    if (!isResizingReview) return;
    const onMove = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const rect = layout.getBoundingClientRect();
      const next = Math.min(
        REVIEW_WIDTH_MAX,
        Math.max(REVIEW_WIDTH_MIN, rect.right - event.clientX)
      );
      setReviewWidth(next);
    };
    const onUp = () => setIsResizingReview(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingReview]);

  const openAiReviewPanel = (rowId: string) => {
    setSelectedRow(rowId);
    setDocViewerOpen(false);
    setExpandedDoc(false);
    setReviewDetailOpen(true);
  };

  const closeSidePanel = () => {
    setReviewDetailOpen(false);
    setDocViewerOpen(false);
    setExpandedDoc(false);
  };

  const startReviewResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsResizingReview(true);
  };

  useEffect(() => {
    if (!chart?.rows.length) return;
    if (selectedRow && chart.rows.some((row) => row.id === selectedRow)) return;
    setSelectedRow(chart.rows[0].id);
  }, [chart?.rows, selectedRow]);

  // Keep the live in-flight chart selected when the strip would otherwise stick to an old ready run.
  useEffect(() => {
    if (!chart?.run.target_document_id || !activeRunId) return;
    const preferred = pickRunForStandard(runs, chart.run.target_document_id, activeRunId);
    if (preferred && preferred.id !== activeRunId && IN_FLIGHT.has(preferred.status)) {
      onSelectRun(preferred.id);
    }
  }, [runs, chart?.run.target_document_id, activeRunId, onSelectRun]);

  const building = Boolean(chart && IN_FLIGHT.has(chart.run.status));
  const ready = Boolean(chart && READY.has(chart.run.status));

  const selectedChartRow = chart?.rows.find((row) => row.id === selectedRow);
  const selectedRevision = selectedChartRow ? latestRevision(selectedChartRow) : undefined;

  const openDocument = (block: EvidenceBlock, rowId: string) => {
    setSelectedRow(rowId);
    setActiveEvidenceId(block.evidence_id);
    setReviewDetailOpen(false);
    const row = chart?.rows.find((item) => item.id === rowId);
    const latest = row ? latestRevision(row) : undefined;
    const passages = latest?.evidence_blocks || [];
    const resolvedIndex = Math.max(
      0,
      passages.findIndex((item) => item.evidence_id === block.evidence_id)
    );
    setPassageIndex(resolvedIndex >= 0 ? resolvedIndex : 0);
    const docId = block.source?.document_id || chart?.run.target_document_id;
    if (docId && block.page_ordinal) {
      setViewerLocation({
        documentId: docId,
        page: block.page_ordinal,
        bbox: preferredBbox(block),
        evidenceId: block.evidence_id,
        label: block.source
          ? `${block.source.family || ""} ${block.source.edition || ""}`.trim()
          : [chart?.run.family, chart?.run.edition].filter(Boolean).join(" ")
      });
    } else if (docId) {
      setViewerLocation({
        documentId: docId,
        page: 1,
        bbox: preferredBbox(block),
        evidenceId: block.evidence_id,
        label: [chart?.run.family, chart?.run.edition].filter(Boolean).join(" ")
      });
    }
    setDocViewerOpen(true);
    if (reviewWidth < 420) setReviewWidth(480);
  };

  const openFirstEvidence = () => {
    if (!selectedChartRow || !selectedRevision) return;
    const block =
      selectedRevision.evidence_blocks?.find((item) => item.available !== false) ||
      selectedRevision.evidence_blocks?.[0];
    if (block) openDocument(block, selectedChartRow.id);
  };

  const openEditForm = (rowId?: string) => {
    if (rowId) setSelectedRow(rowId);
    setEditOpen(true);
  };

  const openAskAgentGlobal = () => {
    setReviewDetailOpen(false);
    setDocViewerOpen(false);
    setExpandedDoc(false);
    setEditOpen(false);
    setAskAgentPreferredElementId(null);
    setAskAgentSeed(null);
    setAskAgentOpen(true);
    setActionError(null);
  };

  const openAskAgentForRow = (rowId: string) => {
    setSelectedRow(rowId);
    setReviewDetailOpen(false);
    setDocViewerOpen(false);
    setExpandedDoc(false);
    setEditOpen(false);
    setAskAgentPreferredElementId(rowId);
    setAskAgentSeed(null);
    setAskAgentOpen(true);
    setActionError(null);
  };

  const seedAskAgentFromReview = () => {
    if (selectedChartRow) openAskAgentForRow(selectedChartRow.id);
  };

  const runRowAction = async (
    label: string,
    work: () => Promise<unknown>,
    options?: { openReview?: boolean; revisionId?: string; after?: () => void }
  ) => {
    const revisionId = options?.revisionId || selectedRevision?.id;
    if (!revisionId) return;
    setActionBusy(true);
    setActionError(null);
    setActionNotice(`${label}…`);
    try {
      await work();
      setActionNotice(`${label} done`);
      await onRefreshChart();
      if (options?.openReview || label === "AI review") {
        setReviewDetailOpen(true);
      }
      options?.after?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setActionNotice(null);
    } finally {
      setActionBusy(false);
    }
  };

  const requestRevisionFromReview = () => {
    if (!selectedRevision) return;
    const review = selectedRevision.ai_review;
    const recs = (review?.checks || [])
      .filter((check) => check.status === "fail" || check.status === "unverified")
      .map((check) => check.recommendation || check.explanation || check.reason)
      .filter(Boolean)
      .slice(0, 4);
    const note =
      recs.length > 0
        ? `AI Review requested revision:\n${recs.map((item) => `- ${item}`).join("\n")}`
        : challengeText.trim() ||
          "AI Review requested revision — re-check evidence and mapping label.";
    setChallengeText(note);
    void runRowAction("Request revision", () =>
      api(`/api/rows/${selectedRevision.id}/challenge`, {
        method: "POST",
        body: JSON.stringify({ challenge: note })
      })
    );
  };

  return (
    <section className="setup-page">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title-compact">Claim charts</h1>
          <p className="page-sub-compact">
            Assignment SEP chart: one row per claim element — claim text, verbatim quote with
            source and screenshot, then Full map / Partial map / No map with rationale.
          </p>
        </div>
        <div className="page-header-actions">
          {activeRunId ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openAskAgentGlobal}
                disabled={!chart?.run.target_document_id}
              >
                Ask agent
              </button>
              <a
                className="btn btn-ghost"
                href={`/api/runs/${activeRunId}/export?final=false`}
                target="_blank"
                rel="noreferrer"
              >
                Word export
              </a>
              <a
                className="btn btn-ghost"
                href={`/api/runs/${activeRunId}/trace`}
                target="_blank"
                rel="noreferrer"
              >
                Run trace
              </a>
            </>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => onRefreshChart()}>
            Refresh
          </button>
        </div>
      </div>

      {standards.length ? (
        <div className="status-strip">
          {standards.map((standard) => {
            const matching = pickRunForStandard(runs, standard.id, activeRunId);
            const isActive =
              chart?.run.target_document_id === standard.id || matching?.id === activeRunId;
            return (
              <button
                key={standard.id}
                type="button"
                className={`status-card ${isActive ? "active" : ""}`}
                onClick={() => matching && onSelectRun(matching.id)}
                disabled={!matching}
              >
                <strong>{standard.family}</strong>
                <span>{statusLabel(matching)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!activeRunId ? (
        <div className="empty">
          No chart run yet. On Setup, confirm a recommended standard and build the claim chart.
        </div>
      ) : !chart ? (
        <div className="empty">Loading chart for run {activeRunId.slice(0, 8)}…</div>
      ) : (
        <>
          {building ? (
            <div className="review-phase-banner progress">
              <strong>Building chart</strong>
              <span>
                Mapping Claim{" "}
                {setup.project.selected_claim_numbers.join(", ") || "1"} against{" "}
                {chart.run.family || "the selected standard"}. Rows appear as each element is
                mapped.
              </span>
            </div>
          ) : ready ? (
            <div className="review-phase-banner attention">
              <strong>Ready for review</strong>
              <span>
                {chart.run.family || "Standard"} · {chart.run.edition || chart.run.title || ""}
              </span>
            </div>
          ) : chart.run.status === "failed" ? (
            <div className="warn-box" style={{ marginBottom: 14 }}>
              Chart failed{chart.run.status_label ? `: ${chart.run.status_label}` : "."}
            </div>
          ) : null}

          <div className="doc-sub" style={{ marginBottom: 12 }}>
            Run status: <strong>{statusLabel(undefined, chart.run.status_label || chart.run.status)}</strong>
            {chart.run.family ? (
              <>
                {" "}
                · <strong>{chart.run.family}</strong>
                {chart.run.edition ? ` · ${chart.run.edition}` : null}
              </>
            ) : null}
          </div>

          {actionNotice ? <div className="doc-sub" style={{ marginBottom: 8 }}>{actionNotice}</div> : null}
          {actionError ? <div className="warn-box" style={{ marginBottom: 8 }}>{actionError}</div> : null}

          {!chart.rows.length ? (
            <div className="empty">
              {building
                ? `Searching and decomposing Claim 1 against ${chart.run.family || "the standard"}…`
                : "No claim-chart rows on this run. Return to Setup and build a chart for the confirmed standard."}
            </div>
          ) : (
            <div
              ref={layoutRef}
              className={`chart-layout ${sidePanelOpen ? "with-inspector" : "full"} ${
                isResizingReview ? "is-resizing" : ""
              } ${expandedDoc ? "doc-expanded" : ""}`}
              style={
                sidePanelOpen
                  ? {
                      gridTemplateColumns: `minmax(0, 1fr) 8px ${reviewWidth}px`
                    }
                  : undefined
              }
            >
              <div className="chart-scroll">
                <table className="chart-table assignment-chart-table">
                  <thead>
                    <tr>
                      <th style={{ width: "22%" }}>Claim element</th>
                      <th style={{ width: "42%" }}>Standard evidence</th>
                      <th style={{ width: "36%" }}>Rationale and mapping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.rows.map((row) => {
                      const latest = latestRevision(row);
                      const blocks = latest?.evidence_blocks || [];
                      const selected = selectedRow === row.id;
                      const reviewLabel = reviewAgentLabel(latest);
                      const missing = latest?.missing_requirements || [];
                      return (
                        <tr
                          key={row.id}
                          className={selected ? "selected" : ""}
                          onClick={() => setSelectedRow(row.id)}
                        >
                          <td>
                            <strong className="element-id">{row.label}</strong>
                            <div className="element-text">{row.exact_text}</div>
                          </td>
                          <td>
                            {blocks.length ? (
                              <EvidencePassageList
                                title=""
                                blocks={blocks}
                                activeEvidenceId={activeEvidenceId}
                                onOpenDocument={(item) => openDocument(item, row.id)}
                                targetEdition={chart.run.edition}
                              />
                            ) : latest?.mapping_label === "No map" ? (
                              <div className="evidence-empty">
                                No map — no section of the standard meets this element.
                              </div>
                            ) : building && !latest?.mapping_label ? (
                              <div className="evidence-empty">Mapping in progress…</div>
                            ) : (
                              <div className="evidence-empty">
                                No verbatim quote / source / screenshot linked yet.
                              </div>
                            )}
                          </td>
                          <td>
                            {latest?.mapping_label ? (
                              <div className="mapping-cell">
                                <div className="evidence-label">Mapping label</div>
                                <StatusChip
                                  label={latest.mapping_label}
                                  kind={mappingLabelKind(latest.mapping_label)}
                                />
                                <div className="evidence-label" style={{ marginTop: 10 }}>
                                  Rationale
                                </div>
                                <div className="element-text">
                                  {latest.rationale || "No rationale provided."}
                                </div>
                                {latest.mapping_label === "Partial map" && missing.length ? (
                                  <div className="partial-gaps">
                                    <div className="evidence-label">What is missing</div>
                                    <ul>
                                      {missing.map((item) => (
                                        <li key={item}>{item}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {!latest?.ai_review && reviewLabel ? (
                                  <div className="doc-sub" style={{ marginTop: 8 }}>
                                    Review agent: <strong>{reviewLabel}</strong>
                                  </div>
                                ) : null}
                                {latest?.analyst_disposition ? (
                                  <div className="doc-sub" style={{ marginTop: 4 }}>
                                    Analyst: <strong>{latest.analyst_disposition}</strong>
                                  </div>
                                ) : null}
                                {ready && latest?.id ? (
                                  <div className="row-edit-actions">
                                    <span
                                      className={`authorship-pill origin-${latest.authorship || "ai"}`}
                                    >
                                      {latest.authorship_label || "AI"}
                                    </span>
                                    {latest.ai_review ? (
                                      <span
                                        className={`ai-review-status-badge kind-${aiReviewStatusKind(
                                          latest.ai_review
                                        )}`}
                                      >
                                        {aiReviewStatusLabel(latest.ai_review)}
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="secondary"
                                      disabled={actionBusy}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openEditForm(row.id);
                                      }}
                                    >
                                      Edit claim
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      disabled={actionBusy}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openAskAgentForRow(row.id);
                                      }}
                                    >
                                      Ask agent
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      disabled={actionBusy}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (latest.ai_review) {
                                          openAiReviewPanel(row.id);
                                          return;
                                        }
                                        setSelectedRow(row.id);
                                        void runRowAction(
                                          "AI review",
                                          () =>
                                            api(`/api/rows/${latest.id}/ai-review`, {
                                              method: "POST"
                                            }),
                                          { openReview: true, revisionId: latest.id }
                                        );
                                      }}
                                    >
                                      {latest.ai_review
                                        ? "Analysis report"
                                        : actionBusy && selectedRow === row.id
                                          ? "Reviewing…"
                                          : "AI review"}
                                    </button>
                                    {latest.ai_review ? (
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled={actionBusy}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedRow(row.id);
                                          void runRowAction(
                                            "AI review",
                                            () =>
                                              api(`/api/rows/${latest.id}/ai-review`, {
                                                method: "POST"
                                              }),
                                            { openReview: true, revisionId: latest.id }
                                          );
                                        }}
                                      >
                                        Re-run
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="evidence-empty">
                                {building
                                  ? "Awaiting Full / Partial / No map label…"
                                  : "No mapping yet"}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {sidePanelOpen ? (
                <>
                  <div
                    className="inspector-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={
                      docViewerOpen ? "Resize document panel" : "Resize AI review panel"
                    }
                    tabIndex={0}
                    onMouseDown={startReviewResize}
                  >
                    <span className="inspector-resize-grip" />
                  </div>
                  <aside
                    className={`inspector ${
                      docViewerOpen ? "document-inspector" : "ai-review-inspector"
                    } ${expandedDoc ? "doc-expanded" : ""}`}
                    aria-label={docViewerOpen ? "Document viewer" : "AI review panel"}
                  >
                    <div className="inspector-toolbar">
                      <div>
                        <strong>
                          {docViewerOpen
                            ? `Document · ${selectedChartRow?.label || "row"}`
                            : `AI review · ${selectedChartRow?.label || "row"}`}
                        </strong>
                        <span className="doc-sub">
                          {docViewerOpen
                            ? viewerLocation?.label ||
                              "Quoted lines are darker amber; context is lighter"
                            : "Drag the left edge to resize"}
                        </span>
                      </div>
                      <div className="inspector-toolbar-actions">
                        <button type="button" className="secondary" onClick={closeSidePanel}>
                          Close
                        </button>
                      </div>
                    </div>
                    {docViewerOpen ? (
                      selectedChartRow ? (
                        <DocumentViewer
                          claimLabel={selectedChartRow.label}
                          passages={selectedRevision?.evidence_blocks || []}
                          passageIndex={passageIndex}
                          onPassageIndexChange={(index) => {
                            setPassageIndex(index);
                            const block = selectedRevision?.evidence_blocks?.[index];
                            if (block?.source?.document_id && block.page_ordinal) {
                              setActiveEvidenceId(block.evidence_id);
                              setViewerLocation({
                                documentId: block.source.document_id,
                                page: block.page_ordinal,
                                bbox: preferredBbox(block),
                                evidenceId: block.evidence_id,
                                label: `${block.source.family || ""} ${
                                  block.source.edition || ""
                                }`.trim()
                              });
                            }
                          }}
                          location={viewerLocation}
                          onLocationChange={setViewerLocation}
                          expanded={expandedDoc}
                          onToggleExpand={() => setExpandedDoc((value) => !value)}
                        />
                      ) : (
                        <div className="empty">Select a claim row to open the document.</div>
                      )
                    ) : selectedChartRow && selectedRevision?.ai_review ? (
                      <AiReviewPanel
                        row={selectedChartRow}
                        review={selectedRevision.ai_review}
                        busy={actionBusy}
                        analystName={setup.project.analyst_display_name}
                        onViewEvidence={openFirstEvidence}
                        onAskAgent={seedAskAgentFromReview}
                        onEdit={openEditForm}
                        onRequestRevision={requestRevisionFromReview}
                        onApplyFix={(changeIds) =>
                          runRowAction(
                            "Apply AI Review change",
                            () =>
                              api(`/api/rows/${selectedRevision.id}/ai-review/apply-fix`, {
                                method: "POST",
                                body: JSON.stringify({
                                  analyst_name:
                                    setup.project.analyst_display_name || "Analyst",
                                  project_id: setup.project.id,
                                  change_ids: changeIds || null
                                })
                              }),
                            { openReview: true }
                          )
                        }
                        onRerun={() =>
                          runRowAction(
                            "AI review",
                            () =>
                              api(`/api/rows/${selectedRevision.id}/ai-review`, {
                                method: "POST"
                              }),
                            { openReview: true }
                          )
                        }
                      />
                    ) : (
                      <div className="doc-sub">
                        {actionBusy
                          ? "Running AI review…"
                          : "No AI review for this row yet. Click AI review in the rationale column."}
                      </div>
                    )}
                  </aside>
                </>
              ) : null}
            </div>
          )}

          {askAgentOpen ? (
            <aside
              className={[
                "ask-agent-overlay",
                `layout-${askAgentUi.layout}`,
                askAgentUi.historyOpen ? "is-history-open" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              role="dialog"
              aria-label="Ask agent chatbot"
              aria-hidden={askAgentUi.historyOpen || undefined}
            >
              <div className="ask-agent-dock ask-agent-dock-overlay">
                {activeRunId && chart?.run.target_document_id ? (
                  <AskAgentPanel
                    runId={activeRunId}
                    documentId={chart.run.target_document_id}
                    documentLabel={
                      [chart.run.family, chart.run.edition].filter(Boolean).join(" · ") ||
                      "Selected standard"
                    }
                    selectedRow={selectedChartRow || null}
                    chartRows={chart?.rows || []}
                    visible={askAgentOpen}
                    preferredElementId={askAgentPreferredElementId}
                    seedPrompt={askAgentSeed}
                    analystName={setup.project.analyst_display_name || "Analyst"}
                    onClose={() => {
                      setAskAgentOpen(false);
                      setAskAgentPreferredElementId(null);
                      setAskAgentUi({ historyOpen: false, layout: "normal" });
                    }}
                    onSeedConsumed={() => setAskAgentSeed(null)}
                    onSelectRow={setSelectedRow}
                    onUiStateChange={setAskAgentUi}
                    onOpenCitation={(evidenceId) => {
                      const block = selectedRevision?.evidence_blocks?.find(
                        (item) => item.evidence_id === evidenceId
                      );
                      if (block && selectedChartRow) openDocument(block, selectedChartRow.id);
                    }}
                    onChartRefresh={onRefreshChart}
                  />
                ) : (
                  <div className="warn-box">
                    Ask agent needs an active chart run with a selected standard.
                  </div>
                )}
              </div>
            </aside>
          ) : null}

          {editOpen && selectedRevision && selectedChartRow ? (
            <ClaimEditModal
              open={editOpen}
              label={selectedChartRow.label}
              revision={selectedRevision}
              analystName={setup.project.analyst_display_name || "Analyst"}
              busy={actionBusy}
              onClose={() => setEditOpen(false)}
              onSave={(payload) =>
                void runRowAction(
                  "Save row",
                  () =>
                    api(`/api/rows/${selectedRevision.id}/edit`, {
                      method: "POST",
                      body: JSON.stringify(payload)
                    }),
                  { openReview: true, after: () => setEditOpen(false) }
                )
              }
              onRevert={(targetRevisionId) =>
                void runRowAction(
                  "Revert",
                  () =>
                    api(`/api/rows/${selectedRevision.id}/revert`, {
                      method: "POST",
                      body: JSON.stringify({
                        target_revision_id: targetRevisionId,
                        analyst_name: setup.project.analyst_display_name || "Analyst"
                      })
                    }),
                  { openReview: true, after: () => setEditOpen(false) }
                )
              }
            />
          ) : null}
        </>
      )}
    </section>
  );
}

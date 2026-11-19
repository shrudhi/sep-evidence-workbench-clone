import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  BadgeCheck,
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  UserRound
} from "lucide-react";
import { api } from "../api";
import AiReviewPanel from "../components/AiReviewPanel";
import AskAgentPanel from "../components/AskAgentPanel";
import ChartMappingCell from "../components/ChartMappingCell";
import ClaimEditModal from "../components/ClaimEditModal";
import DocumentViewer, { type ViewerLocation } from "../components/DocumentViewer";
import EvidencePassageList from "../components/EvidencePassageList";
import HelpTooltip from "../components/HelpTooltip";
import InlineSpinner from "../components/InlineSpinner";
import JudgePanel from "../components/JudgePanel";
import NotesPanel from "../components/NotesPanel";
import RejectConfirmModal from "../components/RejectConfirmModal";
import RevisionLogModal from "../components/RevisionLogModal";
import SkeletonBlock from "../components/SkeletonBlock";
import { preferredBbox } from "../evidenceLabels";
import {
  DEFAULT_CHART_FILTERS,
  analystDispositionLabel,
  chartFiltersAreDefault,
  chartReadinessCounts,
  rowAttentionBucket,
  rowMatchesChartFilters,
  type AnalystStatusFilter,
  type AutoReviewFilter,
  type ChartFilters,
  type UpdatedByFilter
} from "../reviewReadiness";
import type { Chart, ChartRevision, EvidenceBlock, RunSummary, SetupBundle } from "../types";

type InspectorTab = "evidence" | "judge" | "notes";

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
  /** When set, only that revision's Accept/Reject show as busy — not the whole chart. */
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);
  const [viewerLocation, setViewerLocation] = useState<ViewerLocation | null>(null);
  const [passageIndex, setPassageIndex] = useState(0);
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [chartFilters, setChartFilters] = useState<ChartFilters>(DEFAULT_CHART_FILTERS);
  const [rejectTarget, setRejectTarget] = useState<{
    rowId: string;
    revisionId: string;
    label: string;
  } | null>(null);
  const [revisionLogTarget, setRevisionLogTarget] = useState<{
    rowId: string;
    label: string;
  } | null>(null);
  const [askAgentOpen, setAskAgentOpen] = useState(false);
  const [askAgentSeed, setAskAgentSeed] = useState<string | null>(null);
  const [askAgentPreferredElementId, setAskAgentPreferredElementId] = useState<string | null>(
    null
  );
  const [askAgentUi, setAskAgentUi] = useState<{
    historyOpen: boolean;
    layout: "normal" | "minimized" | "maximized";
    position: { left: number; top: number } | null;
  }>({ historyOpen: false, layout: "normal", position: null });
  const [editOpen, setEditOpen] = useState(false);
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>({});
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

  const sidePanelOpen = inspectorTab != null;

  useEffect(() => {
    if (!sidePanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInspectorTab(null);
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
    setExpandedDoc(false);
    setInspectorTab("judge");
  };

  const openNotesPanel = (rowId: string) => {
    setSelectedRow(rowId);
    setExpandedDoc(false);
    setInspectorTab("notes");
  };

  const closeSidePanel = () => {
    setInspectorTab(null);
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

  const readiness = useMemo(
    () => chartReadinessCounts(chart?.rows || []),
    [chart?.rows]
  );
  const filteredRows = useMemo(() => {
    const rows = chart?.rows || [];
    return rows.filter((row) => rowMatchesChartFilters(row, chartFilters));
  }, [chart?.rows, chartFilters]);
  const filterIsEmpty =
    Boolean(chart?.rows?.length) &&
    !chartFiltersAreDefault(chartFilters) &&
    filteredRows.length === 0;

  const selectedChartRow = chart?.rows.find((row) => row.id === selectedRow);
  const selectedRevision = selectedChartRow ? latestRevision(selectedChartRow) : undefined;

  const openDocument = (block: EvidenceBlock, rowId: string) => {
    setSelectedRow(rowId);
    setActiveEvidenceId(block.evidence_id);
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
    setInspectorTab("evidence");
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
    setInspectorTab(null);
    setExpandedDoc(false);
    setEditOpen(false);
    setAskAgentPreferredElementId(null);
    setAskAgentSeed(null);
    setAskAgentOpen(true);
    setActionError(null);
  };

  const openAskAgentForRow = (rowId: string) => {
    setSelectedRow(rowId);
    setInspectorTab(null);
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

  // Clear stuck busy if the chart refreshed (e.g. API was down mid-action).
  useEffect(() => {
    setActionBusy(false);
    setBusyRevisionId(null);
  }, [chart?.run.id, chart?.rows?.length]);

  const runRowAction = async (
    label: string,
    work: () => Promise<unknown>,
    options?: { openReview?: boolean; revisionId?: string; after?: () => void }
  ) => {
    const revisionId = options?.revisionId || selectedRevision?.id;
    if (!revisionId) return;
    setActionBusy(true);
    setBusyRevisionId(revisionId);
    setActionError(null);
    setActionNotice(`${label}…`);
    try {
      await work();
      setActionNotice(`${label} done`);
      await onRefreshChart();
      if (options?.openReview || label === "AI review") {
        setInspectorTab("judge");
      }
      options?.after?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setActionNotice(null);
    } finally {
      setActionBusy(false);
      setBusyRevisionId(null);
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
            Review AI evidence, challenge rows that need work, then accept or reject each element.
            Draft Word is available anytime; reviewed final unlocks after every row has an analyst
            decision.
          </p>
        </div>
        <div className="page-header-actions">
          {activeRunId ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openAskAgentGlobal}
                disabled={!chart?.run.target_document_id || actionBusy}
              >
                Ask agent
              </button>
              <a
                className="btn btn-ghost"
                href={`/api/runs/${activeRunId}/export?final=false`}
                target="_blank"
                rel="noreferrer"
                title="Download a watermarked draft Word chart. Use SEP report for the reviewed final."
              >
                Download draft
              </a>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionBusy}
            onClick={() => void onRefreshChart()}
          >
            {actionBusy ? (
              <>
                <InlineSpinner label="Refreshing chart" /> Refreshing…
              </>
            ) : (
              "Refresh chart"
            )}
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

      {chart?.rows?.length ? (
        <div className="chart-attention-bar">
          <div className="chart-attention-counts" aria-label="Review readiness summary">
            <button
              type="button"
              className={`chart-count-chip ${
                chartFilters.autoReview === "all" && chartFilters.status === "all" ? "is-active" : ""
              }`}
              title="Show all claim elements"
              onClick={() =>
                setChartFilters((prev) => ({
                  ...prev,
                  autoReview: "all",
                  status: "all"
                }))
              }
            >
              <strong>{readiness.total}</strong> All
            </button>
            <button
              type="button"
              className={`chart-count-chip ${chartFilters.status === "completed" ? "is-active" : ""}`}
              title="Filter: Analyst review completed (Accepted or Rejected)"
              onClick={() =>
                setChartFilters((prev) => ({
                  ...prev,
                  autoReview: "all",
                  status: prev.status === "completed" ? "all" : "completed"
                }))
              }
            >
              <strong>{readiness.analyst_done}</strong> Analyst review completed
            </button>
            <button
              type="button"
              className={`chart-count-chip ${chartFilters.status === "review_pending" ? "is-active" : ""}`}
              title="Filter: Analyst review pending"
              onClick={() =>
                setChartFilters((prev) => ({
                  ...prev,
                  autoReview: "all",
                  status: prev.status === "review_pending" ? "all" : "review_pending"
                }))
              }
            >
              <strong>{readiness.analyst_review_pending}</strong> Analyst review pending
            </button>
            <button
              type="button"
              className={`chart-count-chip ${chartFilters.autoReview === "need_review" ? "is-active" : ""}`}
              title="Filter: AI- Need Review"
              onClick={() =>
                setChartFilters((prev) => ({
                  ...prev,
                  status: "all",
                  autoReview: prev.autoReview === "need_review" ? "all" : "need_review"
                }))
              }
            >
              <strong>{readiness.auto_need_review}</strong> AI- Need Review
            </button>
          </div>

          <div className="chart-filter-bar" role="group" aria-label="Claim chart filters">
            <label className="chart-filter-field">
              <span className="chart-filter-label">
                <Bot size={15} aria-hidden />
                <span className="label-with-help">
                  Auto review status
                  <HelpTooltip text="Filters by the automated AI review outcome for the latest mapping on each row." />
                </span>
              </span>
              <select
                value={chartFilters.autoReview}
                onChange={(event) =>
                  setChartFilters((prev) => ({
                    ...prev,
                    autoReview: event.target.value as AutoReviewFilter
                  }))
                }
              >
                <option value="all">All</option>
                <option value="verified">AI- Verified</option>
                <option value="need_review">AI- Need Review</option>
                <option value="review_pending">AI- Review Pending</option>
              </select>
            </label>

            <label className="chart-filter-field">
              <span className="chart-filter-label">
                <CheckCircle2 size={15} aria-hidden />
                <span className="label-with-help">
                  Analyst review status
                  <HelpTooltip text="Accepted or rejected means you made a final disposition. Review pending means the row still needs your decision." />
                </span>
              </span>
              <select
                value={chartFilters.status}
                onChange={(event) =>
                  setChartFilters((prev) => ({
                    ...prev,
                    status: event.target.value as AnalystStatusFilter
                  }))
                }
              >
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="review_pending">Review pending</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>

            <label className="chart-filter-field">
              <span className="chart-filter-label">
                <UserRound size={15} aria-hidden />
                <span className="label-with-help">
                  Updated by
                  <HelpTooltip text="Manual includes edits you typed and changes you accepted from Ask agent. AI is the original mapping agent output." />
                </span>
              </span>
              <select
                value={chartFilters.updatedBy}
                onChange={(event) =>
                  setChartFilters((prev) => ({
                    ...prev,
                    updatedBy: event.target.value as UpdatedByFilter
                  }))
                }
              >
                <option value="all">All</option>
                <option value="manual">Manual</option>
                <option value="ai">AI</option>
              </select>
            </label>
          </div>

          {filterIsEmpty ? (
            <p className="doc-sub" style={{ margin: 0 }}>
              No rows match these filters. Set any dropdown back to All to widen the view.
            </p>
          ) : null}
        </div>
      ) : null}

      {!activeRunId ? (
        <div className="empty">
          No chart yet. Return to Setup, confirm a recommended standard, and create a chart.
        </div>
      ) : !chart ? (
        <div className="empty">
          <SkeletonBlock variant="chart" label="Loading claim chart" />
          <p className="doc-sub" style={{ marginBottom: 0 }}>
            Loading chart {activeRunId.slice(0, 8)}…
          </p>
        </div>
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
              {building ? (
                <>
                  <InlineSpinner label="Building chart" size={18} />
                  <p style={{ margin: "10px 0 4px" }}>
                    Analyzing Claim 1 against {chart.run.family || "the selected standard"}…
                  </p>
                  <p className="doc-sub" style={{ margin: 0 }}>
                    Decomposing elements, then mapping evidence. Rows appear as each element finishes.
                  </p>
                </>
              ) : (
                "No claim-chart rows on this run. Return to Setup and create a chart for the confirmed standard."
              )}
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
                    {filteredRows.map((row) => {
                      const latest = latestRevision(row);
                      const blocks = latest?.evidence_blocks || [];
                      const selected = selectedRow === row.id;
                      const attention = rowAttentionBucket(row);
                      const collapsed = Boolean(collapsedRows[row.id]);
                      const rejected = latest?.analyst_disposition === "reject";
                      const dispositionLabel = analystDispositionLabel(row);
                      return (
                        <tr
                          key={row.id}
                          className={`${selected ? "selected" : ""} attention-${attention} ${
                            collapsed ? "is-collapsed" : ""
                          } ${rejected ? "is-rejected" : ""}`}
                          onClick={() => setSelectedRow(row.id)}
                        >
                          <td className="chart-claim-col">
                            <div className="chart-claim-head">
                              <button
                                type="button"
                                className="chart-row-collapse"
                                aria-label={collapsed ? "Expand row" : "Collapse row"}
                                aria-expanded={!collapsed}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCollapsedRows((prev) => ({
                                    ...prev,
                                    [row.id]: !prev[row.id]
                                  }));
                                }}
                              >
                                {collapsed ? (
                                  <ChevronRight size={16} aria-hidden />
                                ) : (
                                  <ChevronDown size={16} aria-hidden />
                                )}
                              </button>
                              <div className="chart-claim-title-row">
                                <strong className="element-id">{row.label}</strong>
                              </div>
                              {dispositionLabel ? (
                                <span
                                  className={`chart-reviewed-badge ${
                                    dispositionLabel === "Accepted" ? "is-accepted" : "is-rejected"
                                  }`}
                                  title={
                                    dispositionLabel === "Accepted"
                                      ? "Analyst accepted — reviewed"
                                      : "Analyst rejected — omitted from Word export"
                                  }
                                >
                                  {dispositionLabel === "Accepted" ? (
                                    <BadgeCheck size={15} strokeWidth={2.25} aria-hidden />
                                  ) : (
                                    <Ban size={15} strokeWidth={2.25} aria-hidden />
                                  )}
                                  {dispositionLabel === "Accepted"
                                    ? "Reviewed · Accepted"
                                    : "Rejected · Excluded from export"}
                                </span>
                              ) : null}
                            </div>
                            {!collapsed ? (
                              <div className="element-text chart-claim-text">{row.exact_text}</div>
                            ) : null}
                          </td>
                          <td className="chart-evidence-col">
                            {collapsed ? (
                              <div className="doc-sub">
                                {blocks.length
                                  ? `${blocks.length} proof${blocks.length === 1 ? "" : "s"}`
                                  : "No evidence"}
                              </div>
                            ) : blocks.length ? (
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
                              <div className="evidence-empty">
                                <InlineSpinner label="Mapping" /> Mapping this element…
                              </div>
                            ) : (
                              <div className="evidence-empty">
                                No quote, source, or screenshot linked yet.
                              </div>
                            )}
                          </td>
                          <td className="chart-mapping-col">
                            {collapsed ? (
                              <div className="doc-sub">{latest?.mapping_label || "No mapping"}</div>
                            ) : latest?.mapping_label && latest.id ? (
                              <ChartMappingCell
                                revision={latest}
                                ready={Boolean(latest.mapping_label) || ready}
                                busy={busyRevisionId === latest.id}
                                onEdit={() => openEditForm(row.id)}
                                onRerun={() => {
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
                                onManageEvidence={() => {
                                  const block =
                                    blocks.find((item) => item.available !== false) || blocks[0];
                                  if (block) openDocument(block, row.id);
                                  else {
                                    setSelectedRow(row.id);
                                    setInspectorTab("evidence");
                                  }
                                }}
                                onAnalysisReport={() => {
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
                                onAskAgent={() => openAskAgentForRow(row.id)}
                                onNotes={() => openNotesPanel(row.id)}
                                onViewRevisionLog={() =>
                                  setRevisionLogTarget({ rowId: row.id, label: row.label })
                                }
                                onAccept={() => {
                                  void runRowAction(
                                    "Accept",
                                    () =>
                                      api(`/api/rows/${latest.id}/decision`, {
                                        method: "POST",
                                        body: JSON.stringify({
                                          disposition: "accept",
                                          comment: ""
                                        })
                                      }),
                                    { revisionId: latest.id }
                                  );
                                }}
                                onReject={() =>
                                  setRejectTarget({
                                    rowId: row.id,
                                    revisionId: latest.id,
                                    label: row.label
                                  })
                                }
                              />
                            ) : (
                              <div className="evidence-empty">
                                {building ? (
                                  <>
                                    <InlineSpinner label="Mapping" /> Waiting for mapping label…
                                  </>
                                ) : (
                                  "No mapping yet for this element."
                                )}
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
                    aria-label="Resize inspector panel"
                    tabIndex={0}
                    onMouseDown={startReviewResize}
                  >
                    <span className="inspector-resize-grip" />
                  </div>
                  <aside
                    className={`inspector ${
                      inspectorTab === "evidence"
                        ? "document-inspector"
                        : inspectorTab === "notes"
                          ? "notes-inspector"
                          : "ai-review-inspector"
                    } ${expandedDoc ? "doc-expanded" : ""}`}
                    aria-label={
                      inspectorTab === "evidence"
                        ? "Evidence viewer"
                        : inspectorTab === "notes"
                          ? "Notes panel"
                          : "Judge / AI review panel"
                    }
                  >
                    <div className="inspector-toolbar">
                      <div>
                        <strong>
                          {selectedChartRow?.label || "Claim row"} · inspector
                        </strong>
                        <div className="inspector-tabs" role="tablist">
                          {(
                            [
                              ["evidence", "Evidence"],
                              ["judge", "Judge"],
                              ["notes", "Notes"]
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              role="tab"
                              aria-selected={inspectorTab === id}
                              className={inspectorTab === id ? "active" : ""}
                              onClick={() => setInspectorTab(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="inspector-toolbar-actions">
                        <button type="button" className="secondary" onClick={closeSidePanel}>
                          Close
                        </button>
                      </div>
                    </div>
                    {inspectorTab === "evidence" ? (
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
                        <div className="empty">Select a claim row to inspect the source document.</div>
                      )
                    ) : null}
                    {inspectorTab === "judge" ? (
                      selectedChartRow && selectedRevision ? (
                        <div className="inspector-judge-stack">
                          {selectedRevision.judge || selectedRevision.mapping_review_status ? (
                            <JudgePanel
                              row={selectedChartRow}
                              revision={selectedRevision}
                              documentLabel={
                                [chart?.run.family, chart?.run.edition]
                                  .filter(Boolean)
                                  .join(" · ") || "Standard"
                              }
                              selectedFinding={selectedFinding}
                              rechecking={actionBusy}
                              recheckNotice={actionNotice}
                              onSelectFinding={setSelectedFinding}
                              onViewEvidence={openFirstEvidence}
                              onRecheck={() =>
                                void runRowAction(
                                  "AI review",
                                  () =>
                                    api(`/api/rows/${selectedRevision.id}/ai-review`, {
                                      method: "POST"
                                    }),
                                  { openReview: true }
                                )
                              }
                              onAskAgent={seedAskAgentFromReview}
                              onAddComment={() => openNotesPanel(selectedChartRow.id)}
                              onAccept={() =>
                                void runRowAction(
                                  "Accept",
                                  () =>
                                    api(`/api/rows/${selectedRevision.id}/decision`, {
                                      method: "POST",
                                      body: JSON.stringify({
                                        disposition: "accept",
                                        comment: ""
                                      })
                                    })
                                )
                              }
                              onReject={() =>
                                setRejectTarget({
                                  rowId: selectedChartRow.id,
                                  revisionId: selectedRevision.id,
                                  label: selectedChartRow.label
                                })
                              }
                              busy={actionBusy}
                            />
                          ) : null}
                          {selectedRevision.ai_review ? (
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
                                    api(
                                      `/api/rows/${selectedRevision.id}/ai-review/apply-fix`,
                                      {
                                        method: "POST",
                                        body: JSON.stringify({
                                          analyst_name:
                                            setup.project.analyst_display_name || "Analyst",
                                          project_id: setup.project.id,
                                          change_ids: changeIds || null
                                        })
                                      }
                                    ),
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
                          ) : !selectedRevision.judge &&
                            !selectedRevision.mapping_review_status ? (
                            <div className="doc-sub">
                              {actionBusy
                                ? "Running AI review…"
                                : "No judge / AI review for this row yet. Click AI review in the rationale column."}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="empty">Select a claim row to open the analysis report.</div>
                      )
                    ) : null}
                    {inspectorTab === "notes" ? (
                      selectedChartRow ? (
                        <NotesPanel
                          row={selectedChartRow}
                          revision={selectedRevision || null}
                          analystName={setup.project.analyst_display_name || "Analyst"}
                          onNotice={(message) => setActionNotice(message)}
                        />
                      ) : (
                        <div className="empty">Select a claim row to add analyst notes.</div>
                      )
                    ) : null}
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
                askAgentUi.historyOpen ? "is-history-open" : "",
                askAgentUi.position ? "is-repositioned" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                askAgentUi.position
                  ? {
                      left: askAgentUi.position.left,
                      top: askAgentUi.position.top
                    }
                  : undefined
              }
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
                      setAskAgentUi({ historyOpen: false, layout: "normal", position: null });
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

          {revisionLogTarget ? (
            <RevisionLogModal
              open
              elementId={revisionLogTarget.rowId}
              elementLabel={revisionLogTarget.label}
              onClose={() => setRevisionLogTarget(null)}
            />
          ) : null}

          {rejectTarget ? (
            <RejectConfirmModal
              open
              elementLabel={rejectTarget.label}
              busy={actionBusy}
              onCancel={() => setRejectTarget(null)}
              onEditManually={() => {
                const rowId = rejectTarget.rowId;
                setRejectTarget(null);
                setSelectedRow(rowId);
                setEditOpen(true);
              }}
              onRerun={() => {
                const revisionId = rejectTarget.revisionId;
                setRejectTarget(null);
                void runRowAction(
                  "Re-run element",
                  () =>
                    api(`/api/rows/${revisionId}/challenge`, {
                      method: "POST",
                      body: JSON.stringify({
                        challenge:
                          "Analyst requested re-run instead of reject — remap this claim element."
                      })
                    }),
                  { revisionId, openReview: true }
                );
              }}
              onAskAgent={() => {
                const rowId = rejectTarget.rowId;
                setRejectTarget(null);
                openAskAgentForRow(rowId);
              }}
              onConfirm={(comment) => {
                const revisionId = rejectTarget.revisionId;
                void runRowAction(
                  "Reject",
                  () =>
                    api(`/api/rows/${revisionId}/decision`, {
                      method: "POST",
                      body: JSON.stringify({
                        disposition: "reject",
                        comment
                      })
                    }),
                  {
                    revisionId,
                    after: () => setRejectTarget(null)
                  }
                );
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

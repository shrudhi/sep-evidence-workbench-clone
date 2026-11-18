import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import AiReviewPanel, {
  aiReviewStatusKind,
  aiReviewStatusLabel
} from "../components/AiReviewPanel";
import AskAgentPanel from "../components/AskAgentPanel";
import DocumentViewer, { type ViewerLocation } from "../components/DocumentViewer";
import EvidencePassageList from "../components/EvidencePassageList";
import StatusChip, {
  checkStatusKind,
  confidenceKind,
  mappingLabelKind
} from "../components/StatusChip";
import {
  evidenceTier,
  requirementCategoryLabel,
  sourceProofStatus
} from "../chartAnatomy";
import {
  explainTag,
  missingRequirementItems,
  isCriticalJudgeFinding,
  mappingCheckStatus,
  mappingCheckSummary,
  mappingConfidence,
  mappingIssueTagDetails,
  needsJudgeAttention,
  preferredBbox,
  reviewPhaseLabel
} from "../evidenceLabels";
import type {
  AiReview,
  Chart,
  ChartRevision,
  EvidenceBlock,
  JudgeCriterion,
  JudgeIssue,
  NoteThread,
  RunSummary,
  SetupBundle
} from "../types";

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

type InspectorView = "document" | "judge" | "notes";

type NotesDraft = {
  body: string;
  assignee: string;
  replyDrafts: Record<string, string>;
};

const emptyNotesDraft = (): NotesDraft => ({
  body: "",
  assignee: "",
  replyDrafts: {}
});

function decisionLabel(disposition?: string | null) {
  if (disposition === "accept") return "Accepted";
  if (disposition === "reject") return "Rejected";
  return "Unreviewed";
}

function sourceChecksLabel(revision: ChartRevision): string {
  if (revision.integrity?.pass === false) return "Failed";
  if (revision.integrity?.pass) return "Passed";
  return "n/a";
}

function mappingReviewLabel(revision: ChartRevision): string {
  if (revision.mapping_review_status) return revision.mapping_review_status;
  const decision = revision.judge?.overall_decision;
  if (decision === "Passed checks") return "Passed";
  if (decision === "Failed checks" || decision === "Failed") return "Flagged";
  if (decision === "Needs analyst review" || decision === "Needs review") return "Flagged";
  if (decision === "Review incomplete") return "Could not assess";
  if (revision.review_disposition === "pass") return "Passed";
  if (revision.review_disposition === "rework") return "Sent back";
  if (revision.review_disposition === "flag") return "Flagged";
  if (!revision.review_disposition) return "Pending";
  return revision.review_disposition;
}

function statusLine(revision: ChartRevision): string {
  return `Source checks: ${sourceChecksLabel(revision)} · Mapping Review: ${mappingReviewLabel(revision)} · Analyst: ${decisionLabel(revision.analyst_disposition)}`;
}

export default function ClaimChartsScreen({
  setup,
  runs,
  activeRunId,
  chart,
  onSelectRun,
  onRefreshChart,
  focusRowId = null,
  reviewMode = false,
  onFocusRowConsumed
}: Props) {
  const [filter, setFilter] = useState<"all" | "needs">("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<InspectorView>("document");
  const [inspectorWidthPct, setInspectorWidthPct] = useState(() => {
    const saved = Number(window.localStorage.getItem("clause.inspectorWidthPct") || "");
    return Number.isFinite(saved) && saved >= 28 && saved <= 75 ? saved : 46;
  });
  const [resizingInspector, setResizingInspector] = useState(false);
  const [overlayMode, setOverlayMode] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [passageIndex, setPassageIndex] = useState(0);
  const [viewerLocation, setViewerLocation] = useState<ViewerLocation | null>(null);
  const [judgeScroll, setJudgeScroll] = useState(0);
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [threads, setThreads] = useState<NoteThread[]>([]);
  const [notesByRow, setNotesByRow] = useState<Record<string, NotesDraft>>({});
  const [noteNotice, setNoteNotice] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckNotice, setRecheckNotice] = useState<string | null>(null);
  const [pendingJudgeDeepLink, setPendingJudgeDeepLink] = useState(false);
  const [askSeedPrompt, setAskSeedPrompt] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState({
    rationale: "",
    mapping_label: "Partial map",
    match_strength: "partial support",
    requirement_applicability: "unclear",
    requirement_condition: "",
    edit_reason: ""
  });
  const [editRevisionId, setEditRevisionId] = useState<string | null>(null);
  const [suppTitle, setSuppTitle] = useState("");
  const [suppUrl, setSuppUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [productModel, setProductModel] = useState("");
  const [productFinding, setProductFinding] = useState("");
  const [productSource, setProductSource] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [aiReviews, setAiReviews] = useState<Record<string, AiReview>>({});
  const aiReviewTokens = useRef<Record<string, symbol>>({});

  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const savedScrollRef = useRef(0);
  const judgePaneRef = useRef<HTMLDivElement | null>(null);
  const previousRowRef = useRef<string | null>(null);

  const setInspectorWidth = useCallback((value: number) => {
    const next = Math.max(28, Math.min(75, Math.round(value)));
    setInspectorWidthPct(next);
    window.localStorage.setItem("clause.inspectorWidthPct", String(next));
  }, []);

  const standards = setup.standards.filter((item) =>
    setup.project.selected_standard_ids.includes(item.id)
  );
  const active = useMemo(
    () => chart?.rows.find((row) => row.id === selectedRow) || null,
    [chart, selectedRow]
  );
  const revision = active?.revisions.at(-1);
  const supporting = revision?.evidence_blocks || [];
  const candidates = revision?.candidate_blocks || [];
  const inspectorPassages = supporting.length ? supporting : candidates;
  const notesDraft = active ? notesByRow[active.id] || emptyNotesDraft() : emptyNotesDraft();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => setOverlayMode(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setPassageIndex(0);
    if (selectedRow && previousRowRef.current && previousRowRef.current !== selectedRow) {
      // Keep unsaved notes drafts keyed by row; do not post to the new row.
      setNoteNotice(null);
    }
    previousRowRef.current = selectedRow;
  }, [selectedRow, revision?.id]);

  useEffect(() => {
    if (!reviewMode && !focusRowId) return;
    setPendingJudgeDeepLink(true);
  }, [reviewMode, focusRowId]);

  useEffect(() => {
    if (!focusRowId || !chart?.rows.length) return;
    setSelectedRow(focusRowId);
    setFilter("needs");
    setInspectorOpen(true);
    setInspectorView("judge");
    setPendingJudgeDeepLink(true);
    onFocusRowConsumed?.();
  }, [focusRowId, chart?.rows, onFocusRowConsumed]);

  useEffect(() => {
    if (!pendingJudgeDeepLink) return;
    if (reviewMode || focusRowId) {
      setFilter("needs");
      setInspectorOpen(true);
      setInspectorView("judge");
    }
    setPendingJudgeDeepLink(false);
  }, [pendingJudgeDeepLink, reviewMode, focusRowId]);

  useEffect(() => {
    const passage = inspectorPassages[passageIndex];
    if (!passage?.source?.document_id || !passage.page_ordinal) return;
    if (inspectorView !== "document" || !inspectorOpen) return;
    setViewerLocation({
      documentId: passage.source.document_id,
      page: passage.page_ordinal,
      bbox: preferredBbox(passage),
      evidenceId: passage.evidence_id,
      label: `${passage.source.family} ${passage.source.edition}`
    });
  }, [passageIndex, inspectorPassages, inspectorView, inspectorOpen, active?.id]);

  useEffect(() => {
    if (!active?.id || !inspectorOpen || inspectorView !== "notes") return;
    let cancelled = false;
    api<NoteThread[]>(`/api/elements/${active.id}/threads`)
      .then((next) => {
        if (!cancelled) setThreads(next);
      })
      .catch((error: Error) => {
        if (!cancelled) setNoteNotice(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, inspectorOpen, inspectorView, revision?.id]);

  useEffect(() => {
    if (inspectorView === "judge" && judgePaneRef.current) {
      judgePaneRef.current.scrollTop = judgeScroll;
    }
  }, [inspectorView, judgeScroll, active?.id]);

  const pendingRows = useMemo(() => {
    return (chart?.rows || []).filter((row) => {
      const latest = row.revisions.at(-1);
      if (!latest) return false;
      return needsJudgeAttention(latest) || !latest.analyst_disposition;
    });
  }, [chart]);

  const goPending = (direction: -1 | 1) => {
    if (!active || !pendingRows.length) return;
    const index = pendingRows.findIndex((row) => row.id === active.id);
    const next = pendingRows[(index + direction + pendingRows.length) % pendingRows.length];
    if (next) {
      setSelectedRow(next.id);
      setFilter("needs");
      openInspector("judge");
    }
  };

  const filteredRows = (chart?.rows || []).filter((row) => {
    const latest = row.revisions.at(-1);
    if (!latest) return filter === "all";
    if (filter === "needs") return needsJudgeAttention(latest);
    return true;
  });

  const statusFor = (run?: RunSummary) =>
    run?.status_label ||
    ({
      queued: "Queued",
      selecting: "Searching",
      searching: "Searching",
      decomposing: "Mapping",
      mapping: "Mapping",
      reviewing: "Reviewing",
      analyst_review: "Ready for analyst review",
      complete: "Complete",
      failed: "Failed"
    }[run?.status || ""] ||
      run?.status ||
      "No run yet");

  const preserveScroll = () => {
    if (chartScrollRef.current) {
      savedScrollRef.current = chartScrollRef.current.scrollTop;
    }
  };

  const restoreScroll = () => {
    requestAnimationFrame(() => {
      if (chartScrollRef.current) {
        chartScrollRef.current.scrollTop = savedScrollRef.current;
      }
    });
  };

  const openInspector = (view: InspectorView) => {
    preserveScroll();
    setInspectorOpen(true);
    setInspectorView(view);
    restoreScroll();
  };

  const closeInspector = () => {
    preserveScroll();
    if (inspectorView === "judge" && judgePaneRef.current) {
      setJudgeScroll(judgePaneRef.current.scrollTop);
    }
    setInspectorOpen(false);
    setExpandedDoc(false);
    restoreScroll();
  };

  const openDocumentPanel = () => {
    preserveScroll();
    setInspectorOpen(true);
    setInspectorView("document");
    if (inspectorWidthPct < 42) setInspectorWidth(52);
    setExpandedDoc(false);
    restoreScroll();
  };

  useEffect(() => {
    if (!resizingInspector) return;
    const onMove = (event: PointerEvent) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const rect = layout.getBoundingClientRect();
      if (rect.width < 1) return;
      const fromRight = ((rect.right - event.clientX) / rect.width) * 100;
      setInspectorWidth(fromRight);
    };
    const onUp = () => setResizingInspector(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizingInspector, setInspectorWidth]);

  const openDocumentForBlock = (block: EvidenceBlock, rowId?: string) => {
    const targetRowId = rowId || selectedRow || active?.id || null;
    if (targetRowId) setSelectedRow(targetRowId);
    const row = chart?.rows.find((item) => item.id === targetRowId);
    const latest = row?.revisions.at(-1);
    const passages = latest?.evidence_blocks?.length
      ? latest.evidence_blocks
      : latest?.candidate_blocks || inspectorPassages;
    const resolvedIndex = Math.max(
      0,
      passages.findIndex((item) => item.evidence_id === block.evidence_id)
    );
    setPassageIndex(resolvedIndex);
    if (block.source?.document_id && block.page_ordinal) {
      setViewerLocation({
        documentId: block.source.document_id,
        page: block.page_ordinal,
        bbox: preferredBbox(block),
        evidenceId: block.evidence_id,
        label: `${block.source.family} ${block.source.edition}`
      });
    }
    openDocumentPanel();
  };

  const openDocumentForRow = (rowId: string, latest: ChartRevision) => {
    setSelectedRow(rowId);
    const passages = latest.evidence_blocks?.length
      ? latest.evidence_blocks
      : latest.candidate_blocks || [];
    const first =
      passages.find((block) => block.available && block.source?.document_id) || passages[0];
    if (first) {
      openDocumentForBlock(first, rowId);
      return;
    }
    const docId = chart?.run.target_document_id;
    if (docId) {
      const label = chart?.run.family
        ? `${chart.run.family} — ${chart.run.edition || ""}`.trim()
        : docId;
      setPassageIndex(0);
      setViewerLocation({
        documentId: docId,
        page: 1,
        bbox: null,
        label
      });
      openDocumentPanel();
      return;
    }
    openDocumentPanel();
  };

  const openCitation = (evidenceId: string) => {
    const index = inspectorPassages.findIndex((item) => item.evidence_id === evidenceId);
    const block =
      (index >= 0 ? inspectorPassages[index] : null) ||
      supporting.find((item) => item.evidence_id === evidenceId) ||
      candidates.find((item) => item.evidence_id === evidenceId);
    if (block) openDocumentForBlock(block);
    else {
      setPassageIndex(Math.max(0, index));
      openInspector("document");
    }
  };

  const updateNotesDraft = (patch: Partial<NotesDraft>) => {
    if (!active) return;
    setNotesByRow((prev) => ({
      ...prev,
      [active.id]: { ...(prev[active.id] || emptyNotesDraft()), ...patch }
    }));
  };

  const activeStandard = standards.find((item) => item.id === chart?.run.target_document_id);
  const documentLabel = chart?.run.family
    ? `${chart.run.family} — ${chart.run.edition || ""}`.trim()
    : activeStandard
      ? `${activeStandard.family} — ${activeStandard.edition}`
      : "Selected standard";
  const reviewPhase = reviewPhaseLabel(chart?.rows, chart?.run.status, rechecking);

  const createNote = async () => {
    if (!active || !notesDraft.body.trim()) return;
    setSavingNote(true);
    setNoteNotice(null);
    try {
      await api(`/api/elements/${active.id}/threads`, {
        method: "POST",
        body: JSON.stringify({
          body: notesDraft.body.trim(),
          author_display_name: setup.project.analyst_display_name,
          assigned_reviewer_name: notesDraft.assignee.trim() || null,
          revision_id: revision?.id || null
        })
      });
      updateNotesDraft({ body: "" });
      const next = await api<NoteThread[]>(`/api/elements/${active.id}/threads`);
      setThreads(next);
      await onRefreshChart();
      if (notesDraft.assignee.trim()) {
        setNoteNotice(
          "Mention/assignment saved on the thread. No notification was delivered — live notify is not configured."
        );
      }
    } catch (error) {
      setNoteNotice((error as Error).message);
    } finally {
      setSavingNote(false);
    }
  };

  const replyNote = async (threadId: string) => {
    if (!active) return;
    const body = (notesDraft.replyDrafts[threadId] || "").trim();
    if (!body) return;
    await api(`/api/threads/${threadId}/replies`, {
      method: "POST",
      body: JSON.stringify({
        body,
        author_display_name: setup.project.analyst_display_name
      })
    });
    updateNotesDraft({
      replyDrafts: { ...notesDraft.replyDrafts, [threadId]: "" }
    });
    setThreads(await api<NoteThread[]>(`/api/elements/${active.id}/threads`));
    await onRefreshChart();
  };

  const openEvidenceForCriterion = (criterion?: JudgeCriterion | JudgeIssue | null) => {
    if (criterion?.criterion_id) setSelectedFinding(criterion.criterion_id);
    if (inspectorView === "judge" && judgePaneRef.current) {
      setJudgeScroll(judgePaneRef.current.scrollTop);
    }
    const ids = criterion?.evidence_ids || [];
    const block =
      inspectorPassages.find((item) => ids.includes(item.evidence_id)) ||
      inspectorPassages[passageIndex] ||
      inspectorPassages[0];
    if (block) openDocumentForBlock(block);
    else openInspector("document");
  };

  const openAskAgent = (prompt?: string) => {
    if (prompt?.trim()) setAskSeedPrompt(prompt.trim());
    setAskOpen(true);
  };

  const recheckThisRevision = async () => {
    if (!revision?.id) return;
    setRechecking(true);
    setRecheckNotice(null);
    try {
      const result = await api<{
        revision_id: string;
        status?: string;
        remapped?: boolean;
      }>(`/api/rows/${revision.id}/recheck`, { method: "POST" });
      await onRefreshChart();
      setRecheckNotice(
        result.remapped || result.status === "remapped"
          ? "Mapping Review sent the row back — remapped and latest status updated."
          : "Mapping Review record saved for this revision."
      );
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Recheck failed");
    } finally {
      setRechecking(false);
    }
  };

  const runAiReview = async (revisionId: string, elementId: string) => {
    const token = Symbol(`${elementId}:${revisionId}`);
    aiReviewTokens.current[elementId] = token;
    // Clear previous verdict while the new review runs (attachment lifecycle).
    setAiReviews((prev) => ({
      ...prev,
      [elementId]: { status: "running", reason: "Checking this row.", revision_id: revisionId }
    }));
    try {
      const result = await api<AiReview>(`/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_id: revisionId })
      });
      if (aiReviewTokens.current[elementId] !== token) return;
      setAiReviews((prev) => ({ ...prev, [elementId]: result }));
    } catch {
      if (aiReviewTokens.current[elementId] !== token) return;
      setAiReviews((prev) => ({
        ...prev,
        [elementId]: {
          status: "unavailable",
          reason: "The row could not be reviewed. Try again.",
          revision_id: revisionId
        }
      }));
    }
  };

  const reviewForRow = (rowId: string, latest?: ChartRevision | null): AiReview | null => {
    const live = aiReviews[rowId];
    if (live) {
      // Ignore a stale live result keyed to a prior revision.
      if (latest?.id && live.revision_id && live.revision_id !== latest.id && live.status !== "running") {
        return latest.ai_review || null;
      }
      return live;
    }
    return latest?.ai_review || null;
  };

  useEffect(() => {
    if (!chart?.rows?.length) return;
    // Attachment: on load, start one review per row.
    for (const row of chart.rows) {
      const latest = row.revisions.at(-1);
      if (!latest?.id) continue;
      void runAiReview(latest.id, row.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chart?.run.id,
    chart?.rows.map((row) => `${row.id}:${row.revisions.at(-1)?.id}`).join("|")
  ]);

  const searchAgain = async (revisionId: string) => {
    setRowBusy(true);
    setRecheckNotice(null);
    try {
      await api(`/api/rows/${revisionId}/search-again`, { method: "POST" });
      await onRefreshChart();
      setRecheckNotice("Search again finished — new revision saved.");
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Search again failed");
    } finally {
      setRowBusy(false);
    }
  };

  const openEditModal = (rowId: string, latest: ChartRevision) => {
    setSelectedRow(rowId);
    setEditRevisionId(latest.id);
    setEditDraft({
      rationale: latest.rationale || "",
      mapping_label: latest.mapping_label || "Partial map",
      match_strength: latest.match_strength || "partial support",
      requirement_applicability: latest.requirement_applicability || "unclear",
      requirement_condition: latest.requirement_condition || "",
      edit_reason: ""
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editRevisionId || !selectedRow) return;
    setRowBusy(true);
    setAiReviews((prev) => ({
      ...prev,
      [selectedRow]: { status: "running", reason: "Checking this row." }
    }));
    try {
      const result = await api<{ revision_id: string; ai_review?: AiReview | null }>(
        `/api/rows/${editRevisionId}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editDraft)
        }
      );
      setEditOpen(false);
      // Successful save → Reviewing… then restart review for this row only.
      if (result.ai_review) {
        setAiReviews((prev) => ({
          ...prev,
          [selectedRow]: { ...result.ai_review!, revision_id: result.revision_id }
        }));
      } else {
        await runAiReview(result.revision_id, selectedRow);
      }
      await onRefreshChart();
      setRecheckNotice("Edit saved. AI Review restarted for this row.");
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Edit failed");
      setAiReviews((prev) => {
        const next = { ...prev };
        delete next[selectedRow];
        return next;
      });
    } finally {
      setRowBusy(false);
    }
  };

  const decideRow = async (
    revisionId: string,
    disposition: "accept" | "reject",
    overridesJudge = false
  ) => {
    const comment =
      window.prompt(
        overridesJudge
          ? "Reason for overriding the Mapping Review finding:"
          : disposition === "accept"
            ? "Optional comment for acceptance:"
            : "Reason for rejecting this row:"
      ) || "";
    if (overridesJudge && !comment.trim()) {
      setRecheckNotice("Override requires a recorded reason.");
      return;
    }
    if (disposition === "reject" && !comment.trim()) {
      setRecheckNotice("Reject requires a reason.");
      return;
    }
    setRowBusy(true);
    try {
      await api(`/api/rows/${revisionId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disposition,
          comment,
          overrides_judge: overridesJudge,
          judge_override_reason: overridesJudge ? comment : ""
        })
      });
      await onRefreshChart();
      setRecheckNotice(
        overridesJudge
          ? `Judge finding overridden (${disposition}).`
          : `Row ${disposition === "accept" ? "accepted" : "rejected"}.`
      );
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setRowBusy(false);
    }
  };

  const addSupplementalDoc = async () => {
    if (!chart?.run.id || !suppTitle.trim()) return;
    setRowBusy(true);
    try {
      await api(`/api/runs/${chart.run.id}/supplemental-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suppTitle.trim(),
          kind: "link",
          url_or_path: suppUrl.trim(),
          notes: ""
        })
      });
      setSuppTitle("");
      setSuppUrl("");
      await onRefreshChart();
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Could not add document");
    } finally {
      setRowBusy(false);
    }
  };

  const addAccusedProduct = async () => {
    if (!chart?.run.id || !productName.trim()) return;
    setRowBusy(true);
    try {
      const created = await api<{ id: string }>(`/api/runs/${chart.run.id}/accused-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: productName.trim(),
          model: productModel.trim()
        })
      });
      setSelectedProductId(created.id);
      setProductName("");
      setProductModel("");
      await onRefreshChart();
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Could not add product");
    } finally {
      setRowBusy(false);
    }
  };

  const addProductEvidence = async () => {
    if (!chart?.run.id || !active || !selectedProductId || !productFinding.trim()) return;
    setRowBusy(true);
    try {
      await api(`/api/runs/${chart.run.id}/product-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: selectedProductId,
          element_id: active.id,
          finding: productFinding.trim(),
          evidence_source: productSource.trim(),
          evidence_text: productFinding.trim()
        })
      });
      setProductFinding("");
      setProductSource("");
      await onRefreshChart();
    } catch (error) {
      setRecheckNotice(error instanceof Error ? error.message : "Could not save product evidence");
    } finally {
      setRowBusy(false);
    }
  };

  const renderRowActions = (rowId: string, latest: ChartRevision) => {
    const noteCount = chart?.rows.find((row) => row.id === rowId)?.thread_count || 0;
    const hasEvidence = Boolean(
      (latest.evidence_blocks || []).length || (latest.candidate_blocks || []).length
    );
    const docOpenForRow =
      inspectorOpen &&
      inspectorView === "document" &&
      selectedRow === rowId;
    const judgeOpenForRow =
      inspectorOpen && inspectorView === "judge" && selectedRow === rowId;
    const commentsOpenForRow =
      inspectorOpen && inspectorView === "notes" && selectedRow === rowId;
    return (
      <div className="row-actions">
        <div className="row-action-group secondary">
          <button
            type="button"
            className={`secondary ${docOpenForRow ? "active-doc-btn" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              openDocumentForRow(rowId, latest);
            }}
            title={
              hasEvidence
                ? "Open the standard document beside the chart at this row’s evidence"
                : "Open the standard document beside the chart"
            }
          >
            View document
          </button>
          <button
            type="button"
            className={`secondary ${judgeOpenForRow ? "active-doc-btn" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRow(rowId);
              openInspector("judge");
            }}
            title="Open AI Review"
          >
            {aiReviewStatusLabel(reviewForRow(rowId, latest))}
          </button>
          <button
            type="button"
            className={`secondary ${commentsOpenForRow ? "active-doc-btn" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRow(rowId);
              openInspector("notes");
            }}
            title="Open comments for this claim element"
          >
            Comments{noteCount ? ` · ${noteCount}` : ""}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRow(rowId);
              setAskOpen(true);
            }}
          >
            Ask Agent
          </button>
          <button
            type="button"
            className="ghost"
            disabled={rowBusy}
            onClick={(event) => {
              event.stopPropagation();
              void searchAgain(latest.id);
            }}
            title="Search again for supporting and counterevidence passages"
          >
            {rowBusy ? "Searching…" : "Search again"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openEditModal(rowId, latest);
            }}
            title="Edit rationale, mapping label, and §4 tags"
          >
            Edit
          </button>
        </div>
      </div>
    );
  };

  const inspectorClass = [
    "panel",
    "inspector",
    inspectorOpen ? "open" : "closed",
    overlayMode && inspectorOpen ? "overlay" : "",
    expandedDoc ? "doc-expanded" : "",
    resizingInspector ? "resizing" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section>
      <h1 className="page-title">Claim charts</h1>
      <p className="page-sub">Inspect evidence and review every mapping against the cited standard.</p>

      <div className="status-strip">
        {standards.map((standard) => {
          const matchingRuns = runs.filter((run) => run.target_document_id === standard.id);
          const matching =
            matchingRuns.find((run) =>
              ["analyst_review", "complete"].includes(run.status)
            ) ||
            matchingRuns.find((run) => !["failed"].includes(run.status)) ||
            matchingRuns[0];
          const isActiveTarget = chart?.run.target_document_id === standard.id;
          return (
            <button
              key={standard.id}
              type="button"
              className={`status-card ${isActiveTarget ? "active" : ""}`}
              onClick={() => matching && onSelectRun(matching.id)}
              disabled={!matching}
            >
              <strong>{standard.family}</strong>
              <span>{statusFor(matching)}</span>
            </button>
          );
        })}
      </div>

      {chart ? (
        <div className={`review-phase-banner ${reviewPhase.kind}`}>
          <strong>{reviewPhase.label}</strong>
          <span>
            {reviewPhase.kind === "progress"
              ? "Mapping Review is verifying quotes, citations and labels against the source documents."
              : reviewPhase.kind === "attention"
                ? "Evaluation finished. Use Mapping Review, Comments, Search again, or Ask Agent on each row."
                : reviewPhase.kind === "done"
                  ? "Mapping Review finished for every row."
                  : "Start analysis to generate the chart and run Mapping Review."}
          </span>
        </div>
      ) : null}

      {!activeRunId ? (
        <div className="empty">
          No analysis run yet. Complete Setup and start analysis to generate charts from live
          retrieval and model review.
        </div>
      ) : !chart ? (
        <div className="empty">Loading chart for run {activeRunId}…</div>
      ) : (
        <>
          {chart.run.status === "failed" ||
          runs.find((run) => run.id === chart.run.id)?.error ? (
            <div className="warn-box" style={{ marginBottom: 14 }}>
              Analysis failed
              {runs.find((run) => run.id === chart.run.id)?.error
                ? `: ${runs.find((run) => run.id === chart.run.id)?.error}`
                : `. Status: ${chart.run.status_label || chart.run.status}.`}
            </div>
          ) : (
            <div style={{ marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
              Run status: <strong>{chart.run.status_label || chart.run.status}</strong>
            </div>
          )}
          <div className="filter-row">
            {(
              [
                ["all", "All rows"],
                ["needs", "Sent back / Flagged"]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`filter-pill ${filter === key ? "active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
            <span className="filter-pill">
              Claim{" "}
              {setup.project.selected_claim_numbers.join(", ") ||
                (setup.project.claim_scope === "all" ? "all" : "1")}
            </span>
            {pendingRows.length ? (
              <>
                <button type="button" className="filter-pill" onClick={() => goPending(-1)}>
                  ← Previous pending
                </button>
                <button type="button" className="filter-pill" onClick={() => goPending(1)}>
                  Next pending →
                </button>
              </>
            ) : null}
          </div>

          <div
            ref={layoutRef}
            className={`chart-layout ${inspectorOpen ? "with-inspector" : "full"} ${
              resizingInspector ? "is-resizing" : ""
            }`}
            style={
              inspectorOpen && !overlayMode
                ? {
                    gridTemplateColumns: `minmax(0, 1fr) 8px minmax(280px, ${inspectorWidthPct}%)`
                  }
                : undefined
            }
          >
            <div className="chart-scroll" ref={chartScrollRef}>
              <table className="chart-table">
                <thead>
                  <tr>
                    <th style={{ width: "22%" }}>Claim element</th>
                    <th style={{ width: "40%" }}>Standard evidence</th>
                    <th style={{ width: "38%" }}>Rationale and mapping</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={3}>
                        {["queued", "selecting", "decomposing", "mapping", "reviewing"].includes(
                          chart.run.status
                        )
                          ? `Run status: ${chart.run.status_label || chart.run.status}. Rows appear as mapping completes.`
                          : "No rows match this filter."}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const latest = row.revisions.at(-1);
                      const selected = selectedRow === row.id;
                      const blocks = latest?.evidence_blocks || [];
                      const cand = latest?.candidate_blocks || [];
                      const critical = latest ? isCriticalJudgeFinding(latest) : false;
                      const needsAttention = latest ? needsJudgeAttention(latest) : false;
                      const issueTags = latest ? mappingIssueTagDetails(latest) : [];
                      const confidence = latest ? mappingConfidence(latest) : null;
                      const checkStatus = latest
                        ? mappingCheckStatus(latest)
                        : { label: "Not evaluated", kind: "muted" as const };
                      const checkSummary = latest ? mappingCheckSummary(latest) : "";
                      const tier = latest
                        ? evidenceTier(latest.evidence_status)
                        : evidenceTier(null);
                      const proof = sourceProofStatus(latest);
                      const requirements = row.requirements || [];
                      const isPreamble =
                        /comprising|comprising:|an encoding apparatus|a method/i.test(
                          row.exact_text
                        ) && requirements.some((r) => r.category === "actor");
                      return (
                        <tr
                          key={row.id}
                          className={[
                            selected ? "selected" : "",
                            critical ? "row-critical" : "",
                            !critical && needsAttention ? "row-needs-review" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => setSelectedRow(row.id)}
                        >
                          <td>
                            <strong className="element-id">{row.label}</strong>
                            {isPreamble ? (
                              <div
                                className="claim-decomp-badge"
                                title="Preamble or apparatus language — usually the claim’s introductory limitation before operative steps."
                              >
                                Preamble / apparatus
                              </div>
                            ) : (
                              <div
                                className="claim-decomp-badge"
                                title="Discrete claim limitation tested element-by-element against the standard."
                              >
                                Limitation test
                              </div>
                            )}
                            {latest && latest.revision_number > 1 ? (
                              <div className="doc-sub" title="Latest revision after mapping / Judge rework">
                                Rev {latest.revision_number} · latest
                              </div>
                            ) : null}
                            <div className="element-text">{row.exact_text}</div>
                            {requirements.length ? (
                              <div className="claim-decomp">
                                <span className="evidence-label">Claim decomposition</span>
                                <ul>
                                  {requirements.map((req, index) => (
                                    <li key={`${row.id}-req-${index}`}>
                                      <span className="claim-decomp-cat">
                                        {requirementCategoryLabel(req.category)}
                                      </span>
                                      <span>{req.text}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <div className="doc-sub" style={{ marginTop: 8 }}>
                                No discrete requirement split recorded for this element.
                              </div>
                            )}
                          </td>
                          <td>
                            {blocks.length ? (
                              <EvidencePassageList
                                blocks={blocks}
                                activeEvidenceId={
                                  inspectorOpen && inspectorView === "document"
                                    ? viewerLocation?.evidenceId
                                    : null
                                }
                                onOpenDocument={(item) => openDocumentForBlock(item, row.id)}
                                targetEdition={chart.run.edition}
                                evidenceTierLabel={tier.label}
                              />
                            ) : latest?.mapping_label === "No map" ? (
                              <div className="evidence-empty">
                                No supporting passage established after documented search.
                                {cand.length ? (
                                  <div style={{ marginTop: 10 }}>
                                    <EvidencePassageList
                                      title="Checked candidates (not support)"
                                      blocks={cand}
                                      activeEvidenceId={
                                        inspectorOpen && inspectorView === "document"
                                          ? viewerLocation?.evidenceId
                                          : null
                                      }
                                      onOpenDocument={(item) =>
                                        openDocumentForBlock(item, row.id)
                                      }
                                      targetEdition={chart.run.edition}
                                      evidenceTierLabel={tier.label}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ) : latest?.analysis_status === "incomplete" ||
                              !latest?.mapping_label ? (
                              <div className="evidence-empty">
                                Analysis incomplete — mapping undetermined.
                                {cand.length ? (
                                  <div style={{ marginTop: 10 }}>
                                    <EvidencePassageList
                                      title="Candidate passages"
                                      blocks={cand}
                                      activeEvidenceId={
                                        inspectorOpen && inspectorView === "document"
                                          ? viewerLocation?.evidenceId
                                          : null
                                      }
                                      onOpenDocument={(item) =>
                                        openDocumentForBlock(item, row.id)
                                      }
                                      targetEdition={chart.run.edition}
                                      evidenceTierLabel={tier.label}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="evidence-empty">No linked passages yet</div>
                            )}
                          </td>
                          <td>
                            {latest ? (
                              (() => {
                                const mappingTitle =
                                  latest.mapping_label ||
                                  latest.analysis_status_label ||
                                  "Analysis incomplete";
                                const mappingKind = mappingLabelKind(latest.mapping_label);
                                const gapInfo = missingRequirementItems(
                                  latest.missing_requirements
                                );
                                const showNotEstablished =
                                  gapInfo.gaps.length > 0 ||
                                  latest.mapping_label === "Partial map" ||
                                  latest.mapping_label === "No map";
                                const notEstablishedItems =
                                  gapInfo.gaps.length > 0
                                    ? gapInfo.gaps
                                    : latest.mapping_label === "No map"
                                      ? [
                                          "No supporting requirements established after documented search."
                                        ]
                                      : [
                                          "Complete claimed requirements not established from cited text alone."
                                        ];
                                return (
                                  <div className="rationale-mapping ref-style">
                                    <div className="mapping-heading-row">
                                      <div
                                        className={`mapping-heading kind-${mappingKind}`}
                                        title={explainTag(mappingTitle)}
                                      >
                                        {mappingTitle}
                                      </div>
                                      {confidence?.percent != null ? (
                                        <div
                                          className={`claim-confidence-badge band-${confidence.kind}`}
                                          title={
                                            confidence.rationale ||
                                            "LLM Judge confidence for this claim"
                                          }
                                        >
                                          Confidence {confidence.percent}%
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="match-tag-row">
                                      <StatusChip
                                        label={`Match: ${latest.match_strength || "—"}`}
                                        kind="muted"
                                        title={explainTag(latest.match_strength || "")}
                                      />
                                      <StatusChip
                                        label={`Requirement: ${latest.requirement_applicability || "—"}`}
                                        kind="muted"
                                        title={
                                          latest.requirement_condition
                                            ? `Condition: ${latest.requirement_condition}`
                                            : explainTag(latest.requirement_applicability || "")
                                        }
                                      />
                                      {latest.requirement_condition ? (
                                        <span className="doc-sub">
                                          Condition: {latest.requirement_condition}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="rationale-text">
                                      {latest.rationale || "No rationale recorded."}
                                    </p>
                                    <div className="ai-review-row-actions">
                                      <button
                                        type="button"
                                        className="ghost"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openEditModal(row.id, latest);
                                        }}
                                      >
                                        Edit row
                                      </button>
                                      <button
                                        type="button"
                                        className={`ai-review-status-btn kind-${aiReviewStatusKind(
                                          reviewForRow(row.id, latest)
                                        )}`}
                                        aria-label={`AI review status for ${row.label}: ${aiReviewStatusLabel(
                                          reviewForRow(row.id, latest)
                                        )}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedRow(row.id);
                                          openInspector("judge");
                                        }}
                                      >
                                        {aiReviewStatusLabel(reviewForRow(row.id, latest))}
                                      </button>
                                    </div>
                                    {(row.product_evidence || []).length ? (
                                      <div className="product-evidence-inline">
                                        <div className="evidence-label">Product evidence</div>
                                        <ul>
                                          {(row.product_evidence || []).map((item) => (
                                            <li key={item.id}>
                                              <strong>
                                                {item.product_name || item.product_id}
                                              </strong>
                                              {item.evidence_source
                                                ? ` · ${item.evidence_source}`
                                                : ""}
                                              <div>{item.finding}</div>
                                              {item.unverified_notes ? (
                                                <div className="doc-sub">
                                                  Unverified: {item.unverified_notes}
                                                </div>
                                              ) : null}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {confidence?.rationale ? (
                                      <div className="claim-confidence-rationale">
                                        <span className="evidence-label">
                                          Judge confidence rationale
                                        </span>
                                        <p>{confidence.rationale}</p>
                                        {confidence.dimensions?.length ? (
                                          <ul className="claim-confidence-dims">
                                            {confidence.dimensions.map((dim) => (
                                              <li key={dim.key}>
                                                <strong>{dim.label}</strong>
                                                {dim.score != null ? ` ${dim.score}%` : ""}
                                                {dim.status ? ` · ${dim.status}` : ""}
                                                {dim.finding ? ` — ${dim.finding}` : ""}
                                              </li>
                                            ))}
                                          </ul>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {showNotEstablished ? (
                                      <div className="not-established">
                                        <div className="not-established-heading">
                                          Not established
                                        </div>
                                        <ul>
                                          {notEstablishedItems.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                        {gapInfo.limitation ? (
                                          <p className="limitation-note">{gapInfo.limitation}</p>
                                        ) : null}
                                      </div>
                                    ) : latest.mapping_label === "Full map" ? (
                                      <div className="not-established established-ok">
                                        <div className="not-established-heading">
                                          Not established
                                        </div>
                                        <p className="doc-sub">
                                          None — cited text alone supports the claimed requirements.
                                        </p>
                                      </div>
                                    ) : null}

                                    <details className="rationale-meta-details">
                                      <summary>Checks & evidence tags</summary>
                                      <div className="mapping-chip-row">
                                        <StatusChip
                                          label={tier.label}
                                          kind={tier.kind}
                                          title={tier.detail || explainTag(tier.label)}
                                        />
                                        <StatusChip
                                          label={proof.label}
                                          kind={proof.kind}
                                          title={proof.detail || explainTag(proof.label)}
                                        />
                                        <StatusChip
                                          label={checkStatus.label}
                                          kind={checkStatusKind(checkStatus.kind)}
                                          title={explainTag(checkStatus.label)}
                                        />
                                        {confidence ? (
                                          <StatusChip
                                            label={confidence.label}
                                            kind={confidenceKind(confidence.kind)}
                                            title={
                                              confidence.rationale ||
                                              explainTag(confidence.label)
                                            }
                                          />
                                        ) : null}
                                      </div>
                                      {issueTags.length ? (
                                        <div className="analysis-confidence-issues">
                                          <span className="evidence-label">Issues</span>
                                          <ul>
                                            {issueTags.map((tag) => (
                                              <li key={tag.label} title={tag.explanation}>
                                                {tag.label}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null}
                                      {checkStatus.kind !== "pass" && checkSummary ? (
                                        <div className="check-summary-text">{checkSummary}</div>
                                      ) : null}
                                    </details>

                                    {renderRowActions(row.id, latest)}
                                  </div>
                                );
                              })()
                            ) : (
                              "Pending mapping"
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {askOpen && active && chart.run.target_document_id ? (
                <div className="ask-agent-dock">
                  <div className="ask-agent-dock-head">
                    <strong>
                      Ask Agent · {active.label} · {documentLabel}
                    </strong>
                    <button type="button" className="ghost" onClick={() => setAskOpen(false)}>
                      Collapse
                    </button>
                  </div>
                  <AskAgentPanel
                    runId={chart.run.id}
                    documentId={chart.run.target_document_id}
                    documentLabel={documentLabel}
                    selectedRow={active}
                    visible
                    seedPrompt={askSeedPrompt}
                    onSeedConsumed={() => setAskSeedPrompt(null)}
                    onOpenCitation={openCitation}
                    onChartRefresh={onRefreshChart}
                  />
                </div>
              ) : null}
            </div>

            {inspectorOpen && !overlayMode ? (
              <div
                className="inspector-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize document panel"
                aria-valuemin={28}
                aria-valuemax={75}
                aria-valuenow={inspectorWidthPct}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setResizingInspector(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setInspectorWidth(inspectorWidthPct + 3);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setInspectorWidth(inspectorWidthPct - 3);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    setInspectorWidth(35);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    setInspectorWidth(65);
                  }
                }}
              >
                <span className="inspector-resize-grip" />
              </div>
            ) : null}

            {inspectorOpen ? (
              <aside className={inspectorClass} aria-label="Claim inspector">
                <div className="inspector-toolbar">
                  <div>
                    <strong>{active?.label || "No row"}</strong>
                    <span className="doc-sub">
                      {inspectorView === "document"
                        ? "Document"
                        : inspectorView === "judge"
                          ? "AI Review"
                          : "Comments"}
                      {viewerLocation?.label ? ` · ${viewerLocation.label}` : ""}
                      {!overlayMode ? ` · ${inspectorWidthPct}% width` : ""}
                    </span>
                  </div>
                  <div className="inspector-toolbar-actions">
                    {!overlayMode ? (
                      <div className="inspector-width-presets" role="group" aria-label="Panel width">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setInspectorWidth(35)}
                          title="Narrow panel"
                        >
                          Narrow
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setInspectorWidth(50)}
                          title="Balanced panel"
                        >
                          50%
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setInspectorWidth(65)}
                          title="Expand panel"
                        >
                          Expand
                        </button>
                      </div>
                    ) : null}
                    {(overlayMode || expandedDoc) && (
                      <button type="button" className="secondary" onClick={closeInspector}>
                        Back to chart
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={closeInspector}
                      aria-label="Close inspector"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="tabs" role="tablist">
                  {(
                    [
                      ["document", "Document"],
                      ["judge", "AI Review"],
                      [
                        "notes",
                        `Comments${active?.thread_count ? ` · ${active.thread_count}` : ""}`
                      ]
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={inspectorView === key}
                      className={`tab ${inspectorView === key ? "active" : ""}`}
                      onClick={() => {
                        if (inspectorView === "judge" && judgePaneRef.current) {
                          setJudgeScroll(judgePaneRef.current.scrollTop);
                        }
                        setInspectorView(key);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {!active || !revision ? (
                  <div className="empty">Select a claim row to inspect.</div>
                ) : inspectorView === "document" ? (
                  <>
                    {selectedFinding ? (
                      <button
                        type="button"
                        className="secondary"
                        style={{ marginBottom: 8 }}
                        onClick={() => setInspectorView("judge")}
                      >
                        Back to AI Review
                      </button>
                    ) : null}
                    <DocumentViewer
                      claimLabel={active.label}
                      passages={inspectorPassages}
                      passageIndex={passageIndex}
                      onPassageIndexChange={(index) => {
                        setPassageIndex(index);
                        const block = inspectorPassages[index];
                        if (block?.source?.document_id && block.page_ordinal) {
                          setViewerLocation({
                            documentId: block.source.document_id,
                            page: block.page_ordinal,
                            bbox: preferredBbox(block),
                            evidenceId: block.evidence_id,
                            label: `${block.source.family} ${block.source.edition}`
                          });
                        }
                      }}
                      location={viewerLocation}
                      onLocationChange={setViewerLocation}
                      expanded={expandedDoc}
                      onToggleExpand={() => setExpandedDoc((value) => !value)}
                    />
                  </>
                ) : inspectorView === "judge" ? (
                  <div
                    ref={judgePaneRef}
                    onScroll={(event) => setJudgeScroll(event.currentTarget.scrollTop)}
                  >
                    <AiReviewPanel
                      row={active}
                      review={reviewForRow(active.id, revision)}
                      busy={rowBusy || reviewForRow(active.id, revision)?.status === "running"}
                      onEditRow={() => openEditModal(active.id, revision)}
                      onTryAgain={() => void runAiReview(revision.id, active.id)}
                    />
                  </div>
                ) : (
                  <div>
                    {noteNotice ? (
                      <div className="warn-box" style={{ marginBottom: 10 }}>
                        {noteNotice}
                      </div>
                    ) : null}
                    <div className="note-compose">
                      <textarea
                        value={notesDraft.body}
                        onChange={(event) => updateNotesDraft({ body: event.target.value })}
                        placeholder={`Comment for ${active.label}…`}
                        rows={3}
                      />
                      <input
                        value={notesDraft.assignee}
                        onChange={(event) => updateNotesDraft({ assignee: event.target.value })}
                        placeholder="@collaborator (saved on thread; no email notify)"
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={!notesDraft.body.trim() || savingNote}
                        onClick={createNote}
                      >
                        Save comment
                      </button>
                    </div>
                    {threads.length === 0 ? (
                      <div className="empty" style={{ marginTop: 12 }}>
                        No comments yet for {active.label}.
                      </div>
                    ) : (
                      <div className="note-list">
                        {threads.map((thread) => (
                          <article key={thread.id} className="note-thread">
                            <header>
                              <strong>{thread.author_display_name}</strong>
                              <span>{thread.status}</span>
                              <span>{new Date(thread.created_at).toLocaleString()}</span>
                              {thread.assigned_reviewer_name ? (
                                <span>→ {thread.assigned_reviewer_name}</span>
                              ) : null}
                            </header>
                            {(thread.comments || []).map((comment) => (
                              <p key={comment.id}>
                                <strong>{comment.author_display_name}</strong>{" "}
                                <span className="doc-sub">
                                  {new Date(comment.created_at).toLocaleString()}
                                </span>
                                <br />
                                {comment.body}
                              </p>
                            ))}
                            <textarea
                              rows={2}
                              placeholder="Reply…"
                              value={notesDraft.replyDrafts[thread.id] || ""}
                              onChange={(event) =>
                                updateNotesDraft({
                                  replyDrafts: {
                                    ...notesDraft.replyDrafts,
                                    [thread.id]: event.target.value
                                  }
                                })
                              }
                            />
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                replyNote(thread.id).catch((error: Error) =>
                                  setNoteNotice(error.message)
                                )
                              }
                            >
                              Reply
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </aside>
            ) : null}
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Upload or link documents</h3>
            <p className="doc-sub">
              Attach supplemental sources the mapper should consider (links or notes). Full standard
              indexing remains via the ingest path.
            </p>
            <div className="filter-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                value={suppTitle}
                onChange={(event) => setSuppTitle(event.target.value)}
                placeholder="Document title"
                style={{ minWidth: 180 }}
              />
              <input
                value={suppUrl}
                onChange={(event) => setSuppUrl(event.target.value)}
                placeholder="URL or path"
                style={{ minWidth: 220, flex: 1 }}
              />
              <button
                type="button"
                className="secondary"
                disabled={rowBusy || !suppTitle.trim()}
                onClick={() => void addSupplementalDoc()}
              >
                Add link
              </button>
            </div>
            {(chart.supplemental_documents || []).length ? (
              <ul className="supplemental-doc-list">
                {(chart.supplemental_documents || []).map((doc) => (
                  <li key={doc.id}>
                    <strong>{doc.title}</strong>
                    {doc.url_or_path ? (
                      <>
                        {" · "}
                        <a href={doc.url_or_path} target="_blank" rel="noreferrer">
                          {doc.url_or_path}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="doc-sub">No supplemental documents linked yet.</p>
            )}
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Accused product evidence</h3>
            <p className="doc-sub">
              Litigation section keyed to claim element × product. Standard evidence stays in the
              three-column chart above.
            </p>
            <div className="filter-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="Product name"
              />
              <input
                value={productModel}
                onChange={(event) => setProductModel(event.target.value)}
                placeholder="Model / firmware"
              />
              <button
                type="button"
                className="secondary"
                disabled={rowBusy || !productName.trim()}
                onClick={() => void addAccusedProduct()}
              >
                Add product
              </button>
            </div>
            {(chart.accused_products || []).length ? (
              <div className="filter-row" style={{ marginTop: 8 }}>
                <label className="doc-sub">
                  Product for selected row{" "}
                  <select
                    value={selectedProductId}
                    onChange={(event) => setSelectedProductId(event.target.value)}
                  >
                    <option value="">Select…</option>
                    {(chart.accused_products || []).map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                        {product.model ? ` (${product.model})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {active ? (
              <div className="filter-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input
                  value={productSource}
                  onChange={(event) => setProductSource(event.target.value)}
                  placeholder="Evidence source (test, log, docs…)"
                  style={{ minWidth: 180 }}
                />
                <input
                  value={productFinding}
                  onChange={(event) => setProductFinding(event.target.value)}
                  placeholder={`Finding for ${active.label}`}
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    rowBusy || !selectedProductId || !productFinding.trim()
                  }
                  onClick={() => void addProductEvidence()}
                >
                  Save product finding
                </button>
              </div>
            ) : (
              <p className="doc-sub">Select a claim row to attach product findings.</p>
            )}
          </div>

          {editOpen ? (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <div className="panel modal-panel">
                <h3>Edit mapping</h3>
                <label className="doc-sub">
                  Mapping label
                  <select
                    value={editDraft.mapping_label}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        mapping_label: event.target.value
                      }))
                    }
                  >
                    {["Full map", "Partial map", "No map", "Abstain"].map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="doc-sub">
                  Match strength
                  <select
                    value={editDraft.match_strength}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        match_strength: event.target.value
                      }))
                    }
                  >
                    {[
                      "direct support",
                      "inference",
                      "partial support",
                      "no supporting passage"
                    ].map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="doc-sub">
                  Requirement applicability
                  <select
                    value={editDraft.requirement_applicability}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        requirement_applicability: event.target.value
                      }))
                    }
                  >
                    {[
                      "required",
                      "required only under condition",
                      "optional",
                      "described only",
                      "unclear"
                    ].map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="doc-sub">
                  Condition
                  <input
                    value={editDraft.requirement_condition}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        requirement_condition: event.target.value
                      }))
                    }
                  />
                </label>
                <label className="doc-sub">
                  Rationale
                  <textarea
                    rows={6}
                    value={editDraft.rationale}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, rationale: event.target.value }))
                    }
                  />
                </label>
                <label className="doc-sub">
                  Edit reason
                  <input
                    value={editDraft.edit_reason}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, edit_reason: event.target.value }))
                    }
                    placeholder="Why this change"
                  />
                </label>
                <div className="row-action-group" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={rowBusy}
                    onClick={() => void saveEdit()}
                  >
                    Save as new revision
                  </button>
                  <button type="button" className="ghost" onClick={() => setEditOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

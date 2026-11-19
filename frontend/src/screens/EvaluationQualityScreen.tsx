import { Fragment, useEffect, useMemo, useState } from "react";
import { api, apiForm } from "../api";
import EvaluationActiveResults from "../components/EvaluationActiveResults";
import {
  FROZEN_BASELINE,
  ITERATION_HISTORY
} from "../data/evaluationIterationHistory";
import type { RunSummary, SetupBundle } from "../types";

type Props = {
  setup: SetupBundle;
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onNotice: (message: string | null) => void;
};

type FailureAction = {
  id: string;
  criterion_id?: string | null;
  case_keys?: string[];
  category?: string;
  severity?: string;
  problem?: string;
  root_cause_hypothesis?: string | null;
  recommended_fix?: string | null;
  responsible_component?: string | null;
  status?: string;
};

type CriterionResult = {
  id: string;
  criterion_id: string;
  criterion_key: string;
  automatic_status: string;
  automatic_reason?: string;
  adjudicated_status?: string | null;
  adjudicated_reason?: string | null;
  severity?: string | null;
  failure_mode?: string | null;
  root_cause_hypothesis?: string | null;
  recommended_action?: string | null;
  responsible_component?: string | null;
  expected_summary?: string | null;
  actual_summary?: string | null;
  score?: number | null;
};

type EvalCase = {
  id: string;
  case_type: string;
  case_key: string;
  reference_label?: string | null;
  generated_label?: string | null;
  criteria: CriterionResult[];
  payload: Record<string, unknown>;
};

type ReleaseReadiness = {
  recommendation?: string;
  reason?: string;
  provisional?: boolean;
  expert_signoff?: boolean;
  attorney_ready?: boolean;
  human_review_required?: boolean;
  critical_failures?: number;
  high_failures?: number;
  alignments_confirmed?: boolean;
  full_map_precision_recall?: { precision?: string; recall?: string; note?: string };
  complete_claim_coverage?: { display?: string };
  limitations?: string[];
};

type LevelMetric = {
  pass?: number;
  eligible?: number;
  rate?: number | null;
  display?: string;
  note?: string;
};

type EvalSummary = {
  status_note?: string;
  attorney_ready?: boolean;
  requires_correction?: boolean;
  critical_failures?: number;
  high_failures?: number;
  release_recommendation?: string;
  release_readiness?: ReleaseReadiness;
  level_metrics?: Record<string, LevelMetric | Record<string, unknown>>;
  always_partial_baseline?: string;
  full_map_precision_recall?: string;
  criteria?: Array<{
    criterion_id: string;
    name: string;
    automatic_display: string;
    failures: number;
    pending: number;
    counts: Record<string, number>;
  }>;
  observed_failures?: Array<{
    name?: string;
    criterion_id?: string | null;
    count: number;
    root_cause_hypothesis?: string;
  }>;
  failure_actions?: FailureAction[];
  production_plan?: {
    automated?: string;
    expert?: string;
    regression?: string;
    quality_gates?: string;
  };
  limitations?: string[];
};

type DatasetOption = {
  id: string;
  version: string;
  status_label: string;
  display_name?: string;
  source_filename?: string | null;
};
type ChartSnapshot = { id: string; output_stage?: string; chart_hash?: string; created_at?: string };

type EvalDetail = {
  id: string;
  status: string;
  alignments_confirmed: boolean;
  alignments: Array<{
    reference_row_id: string;
    reference_label?: string;
    reference_text?: string;
    reference_mapping_label?: string;
    status: string;
    generated_elements: Array<{
      generated_element_id: string;
      generated_label?: string;
      generated_text?: string;
      score: number;
    }>;
  }>;
  summary: EvalSummary;
  cases: EvalCase[];
  dataset: { id: string; version: string; status_label: string; provisional: number | boolean };
  snapshot: { id?: string; output_stage: string; chart_hash: string; run_id: string };
  failure_actions?: FailureAction[];
  reference_payload: {
    status?: string;
    label_policy?: string;
    criteria?: Array<{ id: string; name: string; pass_condition: string }>;
    patent?: { id?: string; claim_number?: number };
    recommended_target?: { family?: string; edition?: string };
  };
  run_id: string;
  start_mode?: string;
  agent_chart_export?: { filename?: string; path?: string; download_url?: string };
};

type LevelId =
  | "standard_selection"
  | "claim_requirements"
  | "evidence_accuracy"
  | "technical_mapping"
  | "complete_claim";

const CORE_CRITERIA = ["C01", "C02", "C03", "C04", "C05", "C06"] as const;
const SUPPORT_CRITERIA = ["C07", "C08"] as const;
const ALL_ROW_CRITERIA = [...CORE_CRITERIA, ...SUPPORT_CRITERIA] as const;

const CRITERION_HELP: Record<string, string> = {
  C01: "Right standard and edition",
  C02: "Quote real and verbatim",
  C03: "Source and page correct",
  C04: "Screenshot matches quote",
  C05: "Rationale supports element",
  C06: "Full / Partial / No label correct",
  C07: "Claim coverage",
  C08: "Normative/optional compliance"
};

const STATUS_CLASS: Record<string, string> = {
  Pass: "eval-pass",
  Fail: "eval-fail",
  "Needs review": "eval-review",
  "Not run": "eval-muted",
  "Not applicable": "eval-muted",
  Error: "eval-fail"
};

const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low"];

const LEVELS: Array<{ id: LevelId; label: string }> = [
  { id: "standard_selection", label: "Standard selection" },
  { id: "claim_requirements", label: "Claim requirements" },
  { id: "evidence_accuracy", label: "Evidence accuracy" },
  { id: "technical_mapping", label: "Technical mapping" },
  { id: "complete_claim", label: "Complete claim" }
];

/** Level metric keys from summary.level_metrics — mirrors D4 multi-level decision surface */
const LEVEL_METRIC_KEYS: Record<LevelId, Array<{ key: string; label: string }>> = {
  standard_selection: [{ key: "target_selection_accuracy", label: "Target selection (S)" }],
  claim_requirements: [
    { key: "requirement_recall", label: "Requirement recall (R)" },
    { key: "requirement_precision", label: "Requirement precision" },
    { key: "decomposition_completeness", label: "Decomposition" }
  ],
  evidence_accuracy: [
    { key: "citation_validity", label: "Citation validity" },
    { key: "verbatim_evidence_validity", label: "Verbatim quotes" },
    { key: "screenshot_correspondence", label: "Screenshot match" },
    { key: "retrieval_recall_at_k", label: "Retrieval recall@k" }
  ],
  technical_mapping: [
    { key: "mapping_label_accuracy", label: "Mapping labels (C06)" },
    { key: "natural_rubric_tests", label: "Natural T-tests" }
  ],
  complete_claim: [{ key: "full_map_precision_recall", label: "Full-map P/R" }]
};

const FALLBACK_RUBRIC: Array<{ id: string; name: string; pass_condition: string }> = [
  {
    id: "C01",
    name: "Right standard",
    pass_condition: "Evidence/target is the intended standard edition (H.265 V10)."
  },
  {
    id: "C02",
    name: "Quote real and verbatim",
    pass_condition: "Quote found verbatim in cited PDF page text (whitespace-normalized)."
  },
  {
    id: "C03",
    name: "Source and page correct",
    pass_condition: "Edition/hash, section, PDF ordinal and printed page correspond."
  },
  {
    id: "C04",
    name: "Screenshot matches quote",
    pass_condition: "Screenshot/crop linked to cited page with quote present."
  },
  {
    id: "C05",
    name: "Rationale supports element",
    pass_condition: "Rationale states support + material gaps/conditions."
  },
  {
    id: "C06",
    name: "Full / Partial / No label correct",
    pass_condition: "Aligned generated labels match reference Full/Partial/No policy."
  }
];

const TOP_FAILURE_NARRATIVES = [
  {
    title: "Claim decomposition / label mismatch (C06)",
    example:
      "Gold pack uses 3 Claim-1 elements (Partial); agent often splits into finer rows mixing Partial and No map.",
    fix: "Constrain Claim-1 split toward the 3-part structure, or score aggregated alignments instead of any-label mismatch.",
    verify: "Re-run C06 on the same reference after alignment; Fail count should drop without regressing C01–C04."
  },
  {
    title: "Cite drift vs labelled evidence crops",
    example:
      "Agent cites valid H.265 pages that pass C02/C03 but differ from gold E01–E07 attorney reference crops.",
    fix: "Bias retrieval toward chroma-QP / encoder definition sections without hardcoding a winner standard.",
    verify: "Improve overlap with labelled anchors while keeping verbatim Pass rate."
  },
  {
    title: "Encoder vs decoder / unsupported Full map risk",
    example:
      "Treating decoder-side qPi/QpC derivation as proof of claimed encoder circuitry (T06/T04 traps).",
    fix: "Deterministic Table 8-10 checks; block Full map when only decoder-side equations are cited.",
    verify: "Re-run T03/T04/T06 and C05/C06; no new Full map without encoder-scope evidence."
  }
];

function StatusChip({ value }: { value?: string | null }) {
  if (!value) return <span className="eval-muted">—</span>;
  return <span className={`eval-chip ${STATUS_CLASS[value] || "eval-muted"}`}>{value}</span>;
}

function criterionStatus(c: CriterionResult) {
  return c.adjudicated_status || c.automatic_status;
}

function criterionReason(c: CriterionResult) {
  return c.adjudicated_reason || c.automatic_reason || "";
}

function formatLabels(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(" · ") || "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).join(" · ") || "—";
      } catch {
        /* keep raw */
      }
    }
    return trimmed;
  }
  return String(value);
}

function worstSeverity(criteria: CriterionResult[]) {
  return SEVERITY_ORDER.find((level) =>
    criteria.some(
      (c) =>
        c.severity === level &&
        ["Fail", "Error", "Needs review"].includes(criterionStatus(c))
    )
  );
}

function caseStatus(item: EvalCase) {
  const crit = (item.criteria || [])[0];
  return crit ? criterionStatus(crit) : item.generated_label || "—";
}

function metricDisplay(metrics: EvalSummary["level_metrics"], key: string) {
  const raw = metrics?.[key];
  if (!raw || typeof raw !== "object") return "—";
  const m = raw as LevelMetric;
  if (m.display) return m.display;
  if (m.eligible != null) return `${m.pass ?? 0}/${m.eligible}`;
  if (typeof (m as { precision?: string }).precision === "string") {
    const pr = m as { precision?: string; recall?: string };
    return `P ${pr.precision || "—"} / R ${pr.recall || "—"}`;
  }
  if (m.note) return m.note.slice(0, 48);
  return "—";
}

function criterionChipClass(status: string) {
  if (status === "Pass") return "eq-crit-chip eq-crit-pass";
  if (["Fail", "Error"].includes(status)) return "eq-crit-chip eq-crit-fail";
  if (status === "Needs review" || status === "Not run") return "eq-crit-chip eq-crit-review";
  return "eq-crit-chip eq-crit-muted";
}

type LabelledReference = {
  id?: string;
  exact_text?: string;
  mapping_label?: string;
  rationale?: string;
  gaps?: string[] | string;
  evidence_ids?: string[];
  limitations?: string;
};

function labelledReference(row: EvalCase | null): LabelledReference | null {
  const ref = row?.payload?.reference;
  if (!ref || typeof ref !== "object") return null;
  return ref as LabelledReference;
}

function filterLevelCases(cases: EvalCase[], level: LevelId) {
  return cases.filter((item) => {
    if (level === "standard_selection") {
      return (
        item.case_type === "target_selection" ||
        item.case_key === "T01" ||
        item.case_key === "T10"
      );
    }
    if (level === "claim_requirements") return item.case_type === "requirement";
    if (level === "evidence_accuracy") {
      return (
        item.case_key === "T02" ||
        item.case_key === "T09" ||
        (item.case_type === "reference_row" &&
          item.criteria.some((c) => ["C01", "C02", "C03", "C04"].includes(c.criterion_id)))
      );
    }
    if (level === "technical_mapping") {
      return (
        ["T03", "T04", "T05", "T06", "T07", "T08"].includes(item.case_key) ||
        item.case_type === "reference_row"
      );
    }
    return item.case_type === "complete_claim";
  });
}

function CriterionCard({
  c,
  expandPass,
  overrideReason,
  setOverrideReason,
  onAdjudicate
}: {
  c: CriterionResult;
  expandPass: boolean;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  onAdjudicate: (id: string, status: string) => void;
}) {
  const st = criterionStatus(c);
  const failed = ["Fail", "Error", "Needs review"].includes(st);
  const [open, setOpen] = useState(failed || expandPass);

  return (
    <div className={`eval-block ${failed ? "eq-fail-block" : ""}`}>
      <button
        type="button"
        className="eq-crit-head linkish"
        style={{ width: "100%", textAlign: "left", textDecoration: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>
          {c.criterion_id} · {CRITERION_HELP[c.criterion_id] || c.criterion_key}
        </strong>
        <StatusChip value={st} />
        {c.score != null ? <span className="doc-sub">score {c.score}</span> : null}
        {c.severity && c.severity !== "None" ? (
          <span className="eval-chip eval-review">{c.severity}</span>
        ) : null}
        <span className="doc-sub">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <>
          <div className="eq-crit-grid">
            <div>
              <span className="doc-sub">Expected</span>
              <p>{c.expected_summary || "—"}</p>
            </div>
            <div>
              <span className="doc-sub">Actual</span>
              <p>{c.actual_summary || "—"}</p>
            </div>
          </div>
          <p>
            <span className="doc-sub">Explanation</span>
            <br />
            {criterionReason(c) || "—"}
          </p>
          {failed ? (
            <>
              <p>
                <span className="doc-sub">Failure mode</span>
                <br />
                <code>{c.failure_mode || "—"}</code>
              </p>
              <p>
                <span className="doc-sub">Root-cause hypothesis</span>
                <br />
                {c.root_cause_hypothesis || "—"}
              </p>
              <p>
                <span className="doc-sub">Recommended action</span>
                <br />
                {c.recommended_action || "—"}
              </p>
              <p className="doc-sub">Component: {c.responsible_component || "—"}</p>
            </>
          ) : null}
          <div className="eval-adj-actions">
            <input
              type="text"
              placeholder="Adjudication reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            {(["Pass", "Fail", "Needs review", "Not applicable"] as const).map((status) => (
              <button
                key={status}
                type="button"
                className="ghost"
                onClick={() => onAdjudicate(c.id, status)}
              >
                {status}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function EvaluationQualityScreen({
  setup,
  runs,
  activeRunId,
  onSelectRun,
  onNotice
}: Props) {
  const [datasetId, setDatasetId] = useState("expected-claim1-v1");
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [evalId, setEvalId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvalDetail | null>(null);
  const [template, setTemplate] = useState<EvalSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [referenceSource, setReferenceSource] = useState<"existing" | "upload">("existing");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState("expected-claim1-v1");
  const [referencePreview, setReferencePreview] = useState<{
    id: string;
    display_name?: string;
    source_filename?: string | null;
    status_label?: string;
    version?: string;
    imported_at?: string;
    provisional?: boolean;
    row_count?: number;
    label_policy?: string;
    download_url?: string | null;
    default_file_id?: string | null;
    recommended_target?: { edition?: string; family?: string };
    files?: Array<{
      id: string;
      filename?: string;
      preview_kind?: string;
      size_kb?: number;
      download_url?: string;
      kind?: string;
      attached_at?: string;
    }>;
    rows?: Array<{
      id?: string;
      mapping_label?: string;
      exact_text?: string;
      rationale?: string;
      evidence_count?: number;
      sample_quote?: string;
      gaps?: string[];
      evidence_blocks?: Array<{
        evidence_id?: string;
        section?: string;
        printed_page?: string | number;
        pdf_page?: string | number;
        quote?: string;
      }>;
    }>;
  } | null>(null);
  const [showReferencePreview, setShowReferencePreview] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedPreviewRow, setExpandedPreviewRow] = useState<string | null>(null);
  const [agentSource, setAgentSource] = useState<"upload" | "generated">("generated");
  const [outputFile, setOutputFile] = useState<File | null>(null);
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [selectedCaseKey, setSelectedCaseKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [criterionFilter, setCriterionFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [overrideReason, setOverrideReason] = useState("");
  const [pastEvals, setPastEvals] = useState<
    Array<{ id: string; status: string; run_id: string; created_at?: string }>
  >([]);
  const [section, setSection] = useState<"results" | "rubric" | "failures" | "plan">("results");
  const [showSupportCriteria, setShowSupportCriteria] = useState(false);
  const [runProgress, setRunProgress] = useState<number | null>(null);
  const [runProgressLabel, setRunProgressLabel] = useState("");
  const [sheetDownloadProgress, setSheetDownloadProgress] = useState<number | null>(null);
  const [referenceVersionTag, setReferenceVersionTag] = useState("v1.1.0");
  const [changeNote, setChangeNote] = useState("");
  const [activeHistoryRunId, setActiveHistoryRunId] = useState(
    ITERATION_HISTORY[ITERATION_HISTORY.length - 1]?.id || ""
  );
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"scorecard" | "history">("scorecard");

  const completedRuns = useMemo(
    () =>
      runs.filter((run) =>
        ["complete", "analyst_review", "awaiting_target_confirm"].includes(run.status)
      ),
    [runs]
  );

  useEffect(() => {
    api<EvalSummary>("/api/evaluations/template")
      .then(setTemplate)
      .catch(() => setTemplate(null));
    api<Array<{ id: string; status: string; run_id: string; created_at?: string }>>(
      "/api/evaluation-runs"
    )
      .then(setPastEvals)
      .catch(() => setPastEvals([]));
    api("/api/evaluation-datasets/import", { method: "POST" })
      .then(async () => {
        const rows = await api<DatasetOption[]>("/api/evaluation-datasets");
        setDatasets(rows);
        const preferred =
          rows.find((d) => d.id === "expected-claim1-v1") ||
          rows.find((d) => d.id === datasetId) ||
          rows[0];
        if (preferred) {
          setDatasetId(preferred.id);
          setSelectedReferenceId(preferred.id);
        }
      })
      .catch(() => undefined);
  }, []);

  const refreshDatasets = async () => {
    const rows = await api<DatasetOption[]>("/api/evaluation-datasets");
    setDatasets(rows);
    return rows;
  };

  const loadReferencePreview = async (id: string) => {
    if (!id) {
      setReferencePreview(null);
      setShowReferencePreview(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const preview = await api<NonNullable<typeof referencePreview>>(
        `/api/evaluation-datasets/${encodeURIComponent(id)}/preview`
      );
      setReferencePreview(preview);
      setPreviewFileId(preview.default_file_id || preview.files?.[0]?.id || "");
      setExpandedPreviewRow(null);
      setShowReferencePreview(true);
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const activePreviewFile = useMemo(() => {
    if (!referencePreview?.files?.length) return null;
    return (
      referencePreview.files.find((f) => f.id === previewFileId) ||
      referencePreview.files[0] ||
      null
    );
  }, [referencePreview, previewFileId]);

  useEffect(() => {
    if (!activeRunId) {
      setSnapshots([]);
      setSnapshotId("");
      return;
    }
    api<ChartSnapshot[]>(`/api/runs/${activeRunId}/chart-snapshots`)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
    // Prefer latest persisted eval for this chart so verdict is visible without re-running
    api<Array<{ id: string; status: string; run_id: string; created_at?: string }>>(
      "/api/evaluation-runs"
    )
      .then(async (rows) => {
        setPastEvals(rows);
        const match = rows.find((row) => row.run_id === activeRunId);
        if (!match) return;
        const next = await api<EvalDetail>(`/api/evaluation-runs/${match.id}`);
        setEvalId(next.id);
        setDetail(next);
        setSelectedCaseKey(
          next.cases.find((c) => c.case_type === "reference_row")?.case_key || null
        );
      })
      .catch(() => undefined);
  }, [activeRunId]);

  useEffect(() => {
    if (!evalId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api<EvalDetail>(`/api/evaluation-runs/${evalId}`);
        if (!cancelled) setDetail(next);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const handle = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [evalId]);

  const summary = detail?.summary || template;
  const readiness = summary?.release_readiness;
  const levelMetrics = summary?.level_metrics || {};
  const rowCases = useMemo(
    () => (detail?.cases || []).filter((c) => c.case_type === "reference_row"),
    [detail]
  );
  const filteredRows = useMemo(() => {
    return rowCases.filter((row) => {
      if (statusFilter === "fail") {
        if (!row.criteria.some((c) => ["Fail", "Error"].includes(criterionStatus(c)))) return false;
      } else if (statusFilter === "pass") {
        if (row.criteria.some((c) => ["Fail", "Error"].includes(criterionStatus(c)))) return false;
      } else if (statusFilter === "review") {
        if (!row.criteria.some((c) => criterionStatus(c) === "Needs review")) return false;
      }
      if (criterionFilter !== "all") {
        const hit = row.criteria.find((c) => c.criterion_id === criterionFilter);
        if (!hit || !["Fail", "Error", "Needs review", "Not run"].includes(criterionStatus(hit))) {
          return false;
        }
      }
      if (severityFilter !== "all") {
        if (!row.criteria.some((c) => c.severity === severityFilter)) return false;
      }
      return true;
    });
  }, [rowCases, statusFilter, criterionFilter, severityFilter]);

  const selectedCase =
    rowCases.find((c) => c.case_key === selectedCaseKey) || filteredRows[0] || null;
  const failureActions = detail?.failure_actions || summary?.failure_actions || [];

  const rowCriterionFailures = useMemo(() => {
    const out: Array<{ caseKey: string; criterion: CriterionResult }> = [];
    for (const row of rowCases) {
      for (const c of row.criteria) {
        if (!ALL_ROW_CRITERIA.includes(c.criterion_id as (typeof ALL_ROW_CRITERIA)[number])) {
          continue;
        }
        const st = criterionStatus(c);
        if (["Fail", "Error", "Needs review"].includes(st) || (c.criterion_id === "C06" && st === "Not run" && !detail?.alignments_confirmed)) {
          out.push({ caseKey: row.case_key, criterion: c });
        }
      }
    }
    return out.sort((a, b) => {
      const sa = SEVERITY_ORDER.indexOf(a.criterion.severity || "Low");
      const sb = SEVERITY_ORDER.indexOf(b.criterion.severity || "Low");
      return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    });
  }, [rowCases, detail?.alignments_confirmed]);

  const patentId =
    detail?.reference_payload?.patent?.id || setup.patent?.identifier || "US10063856B2";
  const provisional = Boolean(
    readiness?.provisional ?? detail?.dataset?.provisional ?? true
  );
  const recommendation =
    summary?.release_recommendation ||
    readiness?.recommendation ||
    (detail ? "Conditional Go — Human Review Required" : "Not run");
  const attorneyReady = Boolean(summary?.attorney_ready || readiness?.attorney_ready);

  const applyEvalResult = async (created: EvalDetail, notice: string) => {
    setEvalId(created.id);
    setDetail(created);
    setSelectedCaseKey(
      created.cases.find((c) => c.case_type === "reference_row")?.case_key || null
    );
      setSection("results");
      setPastEvals(await api("/api/evaluation-runs"));
      if (created.run_id) onSelectRun(created.run_id);
      setShowReferencePreview(false);
      onNotice(notice);
  };

  const runEvaluationFromSources = async () => {
    if (referenceSource === "existing" && !selectedReferenceId) {
      onNotice("Select an existing reference dataset or upload a new reference file.");
      return;
    }
    if (referenceSource === "upload" && !referenceFile) {
      onNotice("Choose a reference file to upload.");
      return;
    }
    if (agentSource === "upload" && !outputFile) {
      onNotice("Choose an agent-output file to upload.");
      return;
    }
    if (agentSource === "generated" && !activeRunId) {
      onNotice("Select a generated chart run to use as agent output.");
      return;
    }

    setRunning(true);
    setRunProgress(6);
    setRunProgressLabel(
      agentSource === "generated"
        ? "Exporting generated chart to XLSX…"
        : "Ingesting reference and agent output…"
    );
    onNotice(
      (agentSource === "generated"
        ? "Exporting generated chart to XLSX, scoring C01–C06, and building the D4 workbook…"
        : "Ingesting inputs, scoring C01–C06, and building the Deliverable 4 workbook…") +
        (changeNote.trim() ? ` Note: ${changeNote.trim()}` : "")
    );
    let tick: number | undefined;
    try {
      tick = window.setInterval(() => {
        setRunProgress((prev) => {
          if (prev == null || prev >= 82) return prev;
          if (prev >= 55) setRunProgressLabel("Building Deliverable 4 workbook…");
          else if (prev >= 30) setRunProgressLabel("Scoring C01–C06 per claim element…");
          return prev + 4;
        });
      }, 400);

      const form = new FormData();
      if (referenceSource === "existing") {
        form.append("reference_dataset_id", selectedReferenceId);
      } else if (referenceFile) {
        form.append("reference", referenceFile);
      }
      if (agentSource === "generated" && activeRunId) {
        form.append("agent_run_id", activeRunId);
        if (snapshotId) form.append("snapshot_id", snapshotId);
      } else if (outputFile) {
        form.append("output", outputFile);
      }
      const created = await apiForm<EvalDetail & { agent_chart_export?: { filename?: string; path?: string } }>(
        "/api/evaluation-runs/from-sources",
        form
      );
      setRunProgress(92);
      setRunProgressLabel("Finalizing results…");
      await refreshDatasets().catch(() => undefined);
      if (referenceSource === "upload" && created.dataset?.id) {
        setSelectedReferenceId(created.dataset.id);
        setReferenceSource("existing");
      }
      const exportNote = created.agent_chart_export?.filename
        ? ` Agent chart stored as ${created.agent_chart_export.filename}.`
        : "";
      await applyEvalResult(
        created,
        (created.summary.requires_correction
          ? "Evaluation complete — critical failures require correction before attorney-ready use."
          : "Evaluation complete. Interactive results below; download the D4 spreadsheet for review.") +
          exportNote
      );
      setRunProgress(100);
      setRunProgressLabel("Complete");
      setSetupDrawerOpen(false);
    } catch (error) {
      onNotice((error as Error).message);
      setRunProgress(null);
      setRunProgressLabel("");
    } finally {
      if (tick != null) window.clearInterval(tick);
      setRunning(false);
      window.setTimeout(() => {
        setRunProgress(null);
        setRunProgressLabel("");
      }, 900);
    }
  };

  const downloadCreatedSheet = async () => {
    if (!evalId) return;
    setSheetDownloadProgress(10);
    let tick: number | undefined;
    try {
      tick = window.setInterval(() => {
        setSheetDownloadProgress((prev) => {
          if (prev == null || prev >= 85) return prev;
          return prev + 8;
        });
      }, 160);
      const response = await fetch(
        `/api/evaluation-runs/${encodeURIComponent(evalId)}/export?format=xlsx&layout=d4`
      );
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      setSheetDownloadProgress(92);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Deliverable4_Evaluation_${evalId.slice(0, 8)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSheetDownloadProgress(100);
      onNotice("Downloaded Deliverable 4 evaluation spreadsheet.");
      window.setTimeout(() => setSheetDownloadProgress(null), 800);
    } catch (error) {
      onNotice((error as Error).message);
      setSheetDownloadProgress(null);
    } finally {
      if (tick != null) window.clearInterval(tick);
    }
  };

  const confirmAlignment = async () => {
    if (!evalId) return;
    try {
      const next = await api<EvalDetail>(`/api/evaluation-runs/${evalId}/alignments`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setDetail(next);
      onNotice("Alignments confirmed — C06 label scoring unlocked.");
    } catch (error) {
      onNotice((error as Error).message);
    }
  };

  const updateActionStatus = async (actionId: string, status: string) => {
    try {
      await api(`/api/evaluation-failure-actions/${actionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      if (evalId) setDetail(await api<EvalDetail>(`/api/evaluation-runs/${evalId}`));
      onNotice(`Failure action marked ${status}`);
    } catch (error) {
      onNotice((error as Error).message);
    }
  };

  const adjudicate = async (criterionResultId: string, status: string) => {
    if (!overrideReason.trim()) {
      onNotice("Provide a reason for adjudication.");
      return;
    }
    try {
      const next = await api<EvalDetail>(`/api/evaluation-results/${criterionResultId}/adjudications`, {
        method: "POST",
        body: JSON.stringify({
          status,
          reason: overrideReason,
          adjudicator: setup.project.analyst_display_name || "Analyst"
        })
      });
      setDetail(next);
      setOverrideReason("");
      onNotice(`Adjudication recorded: ${status}`);
    } catch (error) {
      onNotice((error as Error).message);
    }
  };

  const loadPastEval = async (id: string) => {
    try {
      const next = await api<EvalDetail>(`/api/evaluation-runs/${id}`);
      setEvalId(next.id);
      setDetail(next);
      setSelectedCaseKey(
        next.cases.find((c) => c.case_type === "reference_row")?.case_key || null
      );
      if (next.run_id) onSelectRun(next.run_id);
      setSection("results");
    } catch (error) {
      onNotice((error as Error).message);
    }
  };

  const topStatus = detail
    ? detail.status === "automated_complete"
      ? "Automated checks complete — expert review pending"
      : detail.status === "error"
        ? "Error"
        : detail.status
    : "Not run";

  const sortedCriteriaForDetail = (criteria: CriterionResult[]) => {
    const rank = (c: CriterionResult) => {
      const st = criterionStatus(c);
      if (["Fail", "Error"].includes(st)) return 0;
      if (st === "Needs review" || st === "Not run") return 1;
      return 2;
    };
    return [...criteria]
      .filter((c) => ALL_ROW_CRITERIA.includes(c.criterion_id as (typeof ALL_ROW_CRITERIA)[number]))
      .sort((a, b) => rank(a) - rank(b) || a.criterion_id.localeCompare(b.criterion_id));
  };

  const selectedDataset =
    datasets.find((ds) => ds.id === selectedReferenceId) ||
    datasets.find((ds) => ds.id === FROZEN_BASELINE.id);
  const activeHistory =
    ITERATION_HISTORY.find((r) => r.id === activeHistoryRunId) ||
    ITERATION_HISTORY[ITERATION_HISTORY.length - 1];
  const contextRunId =
    activeHistory?.shortId ||
    (activeRunId ? activeRunId.slice(0, 8) : "—");
  const contextRefId = selectedDataset?.id || FROZEN_BASELINE.id;
  const contextRefVersion =
    selectedDataset?.version || FROZEN_BASELINE.version;

  const downloadPackSheet = () => {
    void (async () => {
      setSheetDownloadProgress(12);
      try {
        const response = await fetch("/api/evaluation-dashboard/h265/export.xlsx");
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        setSheetDownloadProgress(90);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "H265_Claim_Chart_Evaluation.xlsx";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setSheetDownloadProgress(100);
        onNotice("Downloaded evaluation spreadsheet.");
        window.setTimeout(() => setSheetDownloadProgress(null), 800);
      } catch (error) {
        onNotice((error as Error).message);
        setSheetDownloadProgress(null);
      }
    })();
  };

  const canStart =
    !running &&
    (referenceSource === "existing"
      ? Boolean(selectedReferenceId)
      : Boolean(referenceFile && referenceVersionTag.trim())) &&
    (agentSource === "generated" ? Boolean(activeRunId) : Boolean(outputFile));

  return (
    <section className="evaluations eq-screen eq-screen-compact">
      <div className="internal-purpose-banner eq-banner-slim" role="note">
        <strong>Internal only.</strong> Quality gates for engineering — not attorney-facing.
      </div>

      <header className="eq-compact-header">
        <div className="eq-compact-title-row">
          <h1 className="page-title">Evaluation</h1>
          <span className="eq-gate-pill" title={activeHistory?.gateStatus}>
            🔴 BLOCKED — Not Ready for Attorney Review
          </span>
        </div>
        <div className="eq-compact-actions">
          <button
            type="button"
            className="ghost"
            disabled={sheetDownloadProgress != null && sheetDownloadProgress < 100}
            title="Download Deliverable 4 evaluation workbook (.xlsx)"
            onClick={() => {
              if (evalId) void downloadCreatedSheet();
              else downloadPackSheet();
            }}
          >
            {sheetDownloadProgress != null && sheetDownloadProgress < 100
              ? "Preparing…"
              : "Download D4 (.xlsx)"}
          </button>
          <button
            type="button"
            className="primary"
            title="Configure reference and agent output, then start a new evaluation run"
            onClick={() => setSetupDrawerOpen(true)}
          >
            + New Evaluation Run
          </button>
        </div>
      </header>

      <div className="eq-context-strip">
        <span className="evd-mono" title="Frozen reference baseline">
          🔒 {contextRefId} (v{contextRefVersion})
        </span>
        <span className="eq-meta-sep">·</span>
        <span className="evd-mono" title="Active agent / iteration run">
          Run {contextRunId}
        </span>
        <span className="eq-meta-sep">·</span>
        <span className="evd-mono" title="Run timestamp (UTC)">
          {activeHistory?.timestamp || "—"}
        </span>
        <button
          type="button"
          className="linkish eq-context-edit"
          onClick={() => setSetupDrawerOpen(true)}
        >
          Edit / Run New
        </button>
      </div>

      {runProgress != null ? (
        <div className="eq-run-progress" role="status" aria-live="polite">
          <div className="eq-run-progress-label">
            <span>{runProgressLabel || "Running evaluation…"}</span>
            <span className="evd-mono">{runProgress}%</span>
          </div>
          <div className="evd-progress-track">
            <div className="evd-progress-fill" style={{ width: `${runProgress}%` }} />
          </div>
        </div>
      ) : null}

      {sheetDownloadProgress != null ? (
        <div className="eq-run-progress" role="status" aria-live="polite">
          <div className="eq-run-progress-label">
            <span>Preparing spreadsheet…</span>
            <span className="evd-mono">{sheetDownloadProgress}%</span>
          </div>
          <div className="evd-progress-track">
            <div
              className="evd-progress-fill evd-progress-download"
              style={{ width: `${sheetDownloadProgress}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="eq-workspace-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "scorecard"}
          className={workspaceTab === "scorecard" ? "active" : ""}
          onClick={() => setWorkspaceTab("scorecard")}
        >
          Scorecard &amp; Row Audit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "history"}
          className={workspaceTab === "history" ? "active" : ""}
          onClick={() => setWorkspaceTab("history")}
        >
          Iteration History &amp; Trend
        </button>
      </div>

      <EvaluationActiveResults
        workspaceTab={workspaceTab}
        activeRunId={activeHistoryRunId}
        onSelectRun={(id) => {
          setActiveHistoryRunId(id);
          setWorkspaceTab("scorecard");
          const hit = ITERATION_HISTORY.find((r) => r.id === id);
          if (hit) onNotice(`Inspecting ${hit.shortId} — ${hit.label}.`);
        }}
        onDownloadRun={() => downloadPackSheet()}
      />

      {setupDrawerOpen ? (
        <div
          className="eq-drawer-backdrop"
          role="presentation"
          onClick={() => setSetupDrawerOpen(false)}
        >
          <div
            className="eq-setup-drawer panel"
            role="dialog"
            aria-modal="true"
            aria-label="New evaluation run"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="eq-drawer-head">
              <div>
                <h2>New evaluation run</h2>
                <p className="doc-sub">Reference + agent output · no blended score</p>
              </div>
              <button type="button" className="ghost" onClick={() => setSetupDrawerOpen(false)}>
                Close
              </button>
            </div>

            <div className="eq-setup-grid eq-setup-grid-drawer">
              <div className="eq-source-block eq-setup-card">
                <div className="eq-card-head">
                  <span className="evidence-label">Reference</span>
                  <span className="eq-frozen-pill compact">🔒 Frozen</span>
                </div>
                <div className="eq-start-mode">
                  <button
                    type="button"
                    className={referenceSource === "existing" ? "primary" : "ghost"}
                    disabled={running}
                    onClick={() => setReferenceSource("existing")}
                  >
                    Existing
                  </button>
                  <button
                    type="button"
                    className={referenceSource === "upload" ? "primary" : "ghost"}
                    disabled={running}
                    onClick={() => setReferenceSource("upload")}
                  >
                    Upload
                  </button>
                </div>
                {referenceSource === "existing" ? (
                  <div className="eq-inline-controls eq-select-wrap">
                    <label>
                      Dataset
                      <select
                        value={selectedReferenceId}
                        title={
                          selectedDataset
                            ? `${selectedDataset.id} v${selectedDataset.version || "—"}`
                            : "Select reference"
                        }
                        onChange={(e) => {
                          setSelectedReferenceId(e.target.value);
                          setShowReferencePreview(false);
                          setReferencePreview(null);
                        }}
                      >
                        <option value="">Select…</option>
                        {datasets.map((ds) => (
                          <option key={ds.id} value={ds.id} title={`${ds.id} v${ds.version}`}>
                            {ds.id} · v{ds.version || "—"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ghost"
                      disabled={running || !selectedReferenceId || previewLoading}
                      onClick={() => void loadReferencePreview(selectedReferenceId)}
                    >
                      {previewLoading ? "…" : "Preview"}
                    </button>
                  </div>
                ) : (
                  <div className="eq-upload-panel">
                    <label className="eq-dropzone">
                      <input
                        type="file"
                        accept=".json,.csv,.xlsx,.xls,.pdf,.docx,.txt,.md"
                        onChange={(e) => setReferenceFile(e.target.files?.[0] || null)}
                      />
                      <strong>Drop or browse</strong>
                      <span className="doc-sub">
                        {referenceFile ? referenceFile.name : "JSON / XLSX / PDF / DOCX"}
                      </span>
                    </label>
                    <label>
                      Version tag
                      <input
                        type="text"
                        value={referenceVersionTag}
                        onChange={(e) => setReferenceVersionTag(e.target.value)}
                        placeholder="v1.1.0"
                      />
                    </label>
                    <p className="doc-sub">New upload = new frozen baseline for trends.</p>
                  </div>
                )}
              </div>

              <div className="eq-source-block eq-setup-card">
                <div className="eq-card-head">
                  <span className="evidence-label">Agent output</span>
                </div>
                <div className="eq-start-mode">
                  <button
                    type="button"
                    className={agentSource === "generated" ? "primary" : "ghost"}
                    disabled={running}
                    onClick={() => setAgentSource("generated")}
                  >
                    Generated
                  </button>
                  <button
                    type="button"
                    className={agentSource === "upload" ? "primary" : "ghost"}
                    disabled={running}
                    onClick={() => setAgentSource("upload")}
                  >
                    Upload
                  </button>
                </div>
                {agentSource === "generated" ? (
                  <div className="eq-inline-controls eq-select-wrap">
                    <label>
                      Chart run
                      <select
                        value={activeRunId || ""}
                        title={activeRunId || "Select run"}
                        onChange={(event) => onSelectRun(event.target.value)}
                      >
                        <option value="">Select…</option>
                        {completedRuns.map((run) => (
                          <option key={run.id} value={run.id}>
                            {(run.family || "run").slice(0, 12)} · {run.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Snapshot
                      <select
                        value={snapshotId}
                        onChange={(e) => setSnapshotId(e.target.value)}
                      >
                        <option value="">Latest</option>
                        {snapshots.map((snap) => (
                          <option key={snap.id} value={snap.id}>
                            {(snap.created_at || "").slice(0, 16)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <label>
                    Agent file
                    <input
                      type="file"
                      accept=".json,.csv,.xlsx,.xls,.pdf,.docx,.txt,.md"
                      onChange={(e) => setOutputFile(e.target.files?.[0] || null)}
                    />
                    <span className="doc-sub">
                      {outputFile ? outputFile.name : "JSON / XLSX / PDF / DOCX"}
                    </span>
                  </label>
                )}
                <label className="eq-change-note">
                  Change note
                  <input
                    type="text"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    placeholder="What changed in this iteration?"
                  />
                </label>
              </div>
            </div>

            <div className="eq-setup-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setSetupDrawerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!canStart}
                onClick={() => void runEvaluationFromSources()}
              >
                {running ? "Processing…" : "Start evaluation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showReferencePreview && referencePreview ? (
        <div className="panel eq-ref-preview">
          <div className="eq-inline-controls" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>
                Document preview — {referencePreview.display_name || referencePreview.id}
              </strong>
              <div className="doc-sub">
                Dataset <code>{referencePreview.id}</code> · v{referencePreview.version || "—"} ·{" "}
                {referencePreview.status_label || "Reference"} ·{" "}
                {referencePreview.row_count ?? 0} claim elements
                {referencePreview.provisional ? " · provisional" : ""}
                {referencePreview.recommended_target?.edition
                  ? ` · ${referencePreview.recommended_target.edition}`
                  : ""}
              </div>
            </div>
            <div className="eq-inline-controls">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setSelectedReferenceId(referencePreview.id);
                  setShowReferencePreview(false);
                  onNotice(`Selected reference: ${referencePreview.display_name || referencePreview.id}`);
                }}
              >
                Use this reference
              </button>
              <button type="button" className="ghost" onClick={() => setShowReferencePreview(false)}>
                Close
              </button>
            </div>
          </div>

          {(referencePreview.files || []).length > 0 ? (
            <div className="eq-preview-files">
              <span className="evidence-label">Files in this reference</span>
              <div className="eq-inline-controls">
                <label>
                  Preview file
                  <select
                    value={previewFileId}
                    onChange={(e) => setPreviewFileId(e.target.value)}
                  >
                    {(referencePreview.files || []).map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.filename || file.id}
                        {file.preview_kind ? ` (${file.preview_kind})` : ""}
                        {file.size_kb != null ? ` · ${file.size_kb} KB` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {activePreviewFile?.download_url ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => window.open(activePreviewFile.download_url || "", "_blank")}
                  >
                    Open / download file
                  </button>
                ) : null}
              </div>
              {activePreviewFile?.preview_kind === "pdf" && activePreviewFile.download_url ? (
                <iframe
                  className="eq-preview-frame"
                  title={`Preview ${activePreviewFile.filename || "PDF"}`}
                  src={activePreviewFile.download_url}
                />
              ) : (
                <p className="doc-sub" style={{ marginTop: 8 }}>
                  {activePreviewFile
                    ? `Showing labelled-chart contents for “${activePreviewFile.filename}”. Open the file for the native ${activePreviewFile.preview_kind || "document"} view.`
                    : "No attached file — showing parsed labelled chart rows below."}
                </p>
              )}
            </div>
          ) : (
            <p className="doc-sub">
              No companion file attached. Showing parsed labelled expected chart for{" "}
              <code>{referencePreview.id}</code>
              {referencePreview.source_filename ? ` (${referencePreview.source_filename})` : ""}.
            </p>
          )}

          {referencePreview.label_policy ? (
            <p className="doc-sub" style={{ marginTop: 10 }}>
              <strong>Label policy:</strong> {referencePreview.label_policy}
            </p>
          ) : null}

          <h4 style={{ margin: "14px 0 8px" }}>Labelled expected chart (sheet 2)</h4>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Element</th>
                <th>Label</th>
                <th>Evidence</th>
                <th>Claim text</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(referencePreview.rows || []).map((row) => {
                const open = expandedPreviewRow === row.id;
                const rowKey = row.id || row.exact_text || "row";
                return (
                  <Fragment key={rowKey}>
                    <tr>
                      <td>{row.id}</td>
                      <td>
                        <span
                          className={`eval-chip ${
                            row.mapping_label?.includes("Full")
                              ? "eval-pass"
                              : row.mapping_label?.includes("No")
                                ? "eval-fail"
                                : "eval-review"
                          }`}
                        >
                          {row.mapping_label || "—"}
                        </span>
                      </td>
                      <td>{row.evidence_count ?? 0}</td>
                      <td className="doc-sub">{row.exact_text}</td>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() =>
                            setExpandedPreviewRow(open ? null : row.id || null)
                          }
                        >
                          {open ? "Hide" : "Show quotes / gaps"}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="eq-preview-detail">
                            {row.rationale ? (
                              <p>
                                <strong>How decided:</strong> {row.rationale}
                              </p>
                            ) : null}
                            {(row.gaps || []).length ? (
                              <p>
                                <strong>Gaps:</strong> {(row.gaps || []).join("; ")}
                              </p>
                            ) : null}
                            {(row.evidence_blocks || []).length ? (
                              <table className="comparison-table">
                                <thead>
                                  <tr>
                                    <th>Evidence ID</th>
                                    <th>Section</th>
                                    <th>Printed</th>
                                    <th>PDF</th>
                                    <th>Quote</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(row.evidence_blocks || []).map((block, idx) => (
                                    <tr key={`${row.id}-${block.evidence_id || idx}`}>
                                      <td>{block.evidence_id || "—"}</td>
                                      <td>{block.section || "—"}</td>
                                      <td>{block.printed_page ?? "—"}</td>
                                      <td>{block.pdf_page ?? "—"}</td>
                                      <td className="doc-sub">{block.quote || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="doc-sub">{row.sample_quote || "No evidence quotes stored."}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="eq-meta panel">
        <div>
          <span className="doc-sub">Patent</span>
          <strong>{patentId}</strong>
        </div>
        <div>
          <span className="doc-sub">Target</span>
          <strong>
            {detail?.reference_payload?.recommended_target?.edition || "H.265 V10 (07/2024)"}
          </strong>
        </div>
        <div>
          <span className="doc-sub">Rubric</span>
          <strong>C01–C06 · {detail?.dataset?.version || "1.0.0"}</strong>
        </div>
        <div>
          <span className="doc-sub">Status</span>
          <strong>{topStatus}</strong>
        </div>
        <div>
          {provisional ? (
            <span className="eval-chip eval-review">Provisional reference</span>
          ) : (
            <span className="eval-chip eval-pass">Expert-reviewed</span>
          )}
          <span className="eval-chip eval-muted" style={{ marginLeft: 6 }}>
            {attorneyReady ? "Attorney-ready" : "Not attorney-ready"}
          </span>
        </div>
      </div>

      {!detail ? (
        <div className="panel">
          <p className="doc-sub" style={{ margin: 0 }}>
            Not run yet. Choose a reference and agent output above, then Start evaluation.
            Scores appear here when a real evaluation finishes — nothing is invented.
          </p>
        </div>
      ) : (
        <>
          {/* B — Verdict */}
          <div
            className={`panel eq-verdict ${
              attorneyReady ? "eq-verdict-go" : "eq-verdict-conditional"
            }`}
          >
            <div className="eq-verdict-main">
              <span className="doc-sub">Release recommendation</span>
              <h2 style={{ margin: "4px 0 8px" }}>{recommendation}</h2>
              <p style={{ margin: 0 }}>
                {readiness?.reason ||
                  "Provisional reference without SEP attorney sign-off. Prototype acceptance ≠ production readiness."}
              </p>
            </div>
            <div className="eq-verdict-metrics">
              <div>
                <span className="doc-sub">Critical</span>
                <strong>{summary?.critical_failures ?? readiness?.critical_failures ?? 0}</strong>
              </div>
              <div>
                <span className="doc-sub">High</span>
                <strong>{summary?.high_failures ?? readiness?.high_failures ?? 0}</strong>
              </div>
              <div>
                <span className="doc-sub">Requirement recall</span>
                <strong>{metricDisplay(levelMetrics, "requirement_recall")}</strong>
              </div>
              <div>
                <span className="doc-sub">Citation validity</span>
                <strong>{metricDisplay(levelMetrics, "citation_validity")}</strong>
              </div>
              <div>
                <span className="doc-sub">Mapping labels</span>
                <strong>{metricDisplay(levelMetrics, "mapping_label_accuracy")}</strong>
              </div>
              <div>
                <span className="doc-sub">Full-map P/R</span>
                <strong>
                  {typeof summary?.full_map_precision_recall === "string"
                    ? summary.full_map_precision_recall.slice(0, 40)
                    : readiness?.full_map_precision_recall?.precision || "Not Assessable"}
                </strong>
              </div>
            </div>
          </div>

          {/* C — C01–C06 scoreboard */}
          <div className="panel">
            <div className="eq-summary-head">
              <h3 style={{ margin: 0 }}>Aggregated Results Per Rubric Criterion</h3>
              <div className="eq-summary-stats">
                <span>
                  Claim elements: <strong>{rowCases.length}</strong>
                </span>
                <span>
                  Alignments:{" "}
                  <strong>{detail.alignments_confirmed ? "Confirmed" : "Pending"}</strong>
                </span>
                <span>
                  Attorney-ready: <strong>{attorneyReady ? "YES" : "NO"}</strong>
                </span>
              </div>
            </div>
            <table className="comparison-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Rubric criterion</th>
                  <th>Pass count</th>
                  <th>Total rows</th>
                  <th>Pass rate</th>
                  <th>Readiness verdict</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.criteria || [])
                  .filter((c) =>
                    CORE_CRITERIA.includes(c.criterion_id as (typeof CORE_CRITERIA)[number])
                  )
                  .map((c) => {
                    const [passPart, totalPart] = String(c.automatic_display || "0/0").split("/");
                    const passCount = Number(passPart || 0);
                    const totalRows = Number(totalPart || 0);
                    const rate =
                      totalRows > 0 ? `${((100 * passCount) / totalRows).toFixed(1)}%` : "—";
                    const readiness =
                      totalRows === 0
                        ? "Not scored"
                        : passCount === totalRows
                          ? `Ready — ${c.name}`
                          : passCount === 0
                            ? `Blocker — ${c.name} failed on all scored rows`
                            : `Watch — ${c.name} partial (${c.automatic_display})`;
                    return (
                    <tr key={c.criterion_id}>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => {
                            setCriterionFilter(c.criterion_id);
                            setSection("results");
                          }}
                        >
                          {c.criterion_id}: {c.name}
                        </button>
                      </td>
                      <td>{passCount}</td>
                      <td>{totalRows}</td>
                      <td>{rate}</td>
                      <td className="doc-sub">{readiness}</td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
            <details
              style={{ marginTop: 10 }}
              open={showSupportCriteria}
              onToggle={(e) => setShowSupportCriteria((e.target as HTMLDetailsElement).open)}
            >
              <summary className="doc-sub">Supporting criteria C07–C08</summary>
              <table className="comparison-table" style={{ marginTop: 8 }}>
                <tbody>
                  {(summary?.criteria || [])
                    .filter((c) =>
                      SUPPORT_CRITERIA.includes(c.criterion_id as (typeof SUPPORT_CRITERIA)[number])
                    )
                    .map((c) => (
                      <tr key={c.criterion_id}>
                        <td>{c.criterion_id}</td>
                        <td>{c.name}</td>
                        <td>{c.automatic_display}</td>
                        <td>{c.failures} fails</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
            {detail.alignments_confirmed ? null : (
              <div className="eq-align-banner">
                <p>
                  <strong>C06 blocked</strong> until requirement alignment is confirmed. This is an
                  open product risk — not a silent Pass.
                </p>
                <button type="button" className="secondary" onClick={() => void confirmAlignment()}>
                  Confirm alignments
                </button>
              </div>
            )}
          </div>

          <div className="eval-tabs" role="tablist">
            {(
              [
                ["results", "3 Run scores"],
                ["rubric", "1 Rubric"],
                ["failures", "4 Failure modes"],
                ["plan", "5 Production plan"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={section === id ? "active" : ""}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {section === "rubric" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>How one chart row is scored</h3>
              <p className="doc-sub">
                Same criteria as Deliverable 4 sheet <strong>1 Rubric</strong>. Each claim element
                (1[a], 1[b], 1[c]) is scored Pass=1 / Fail=0 — no blended accuracy.
              </p>
              <table className="comparison-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Pass condition</th>
                    <th>This run</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.reference_payload?.criteria?.length
                    ? detail.reference_payload.criteria
                    : FALLBACK_RUBRIC
                  )
                    .filter((c) =>
                      CORE_CRITERIA.includes(c.id as (typeof CORE_CRITERIA)[number])
                    )
                    .map((c) => {
                      const live = (summary?.criteria || []).find((x) => x.criterion_id === c.id);
                      return (
                        <tr key={c.id}>
                          <td>
                            <button
                              type="button"
                              className="linkish"
                              onClick={() => {
                                setCriterionFilter(c.id);
                                setSection("results");
                              }}
                            >
                              {c.id}
                            </button>
                          </td>
                          <td>{c.name}</td>
                          <td className="doc-sub">{c.pass_condition}</td>
                          <td>
                            {live ? (
                              <>
                                <strong>{live.automatic_display}</strong>
                                {live.failures ? (
                                  <span className="eval-chip eval-fail" style={{ marginLeft: 6 }}>
                                    {live.failures} fail
                                  </span>
                                ) : (
                                  <span className="eval-chip eval-pass" style={{ marginLeft: 6 }}>
                                    Pass
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p className="doc-sub" style={{ marginTop: 12 }}>
                Attorney gate: C01–C04 must Pass. C06 Fail → not attorney-ready even if quotes are
                clean.
              </p>
            </div>
          ) : null}

          {section === "results" ? (
            <div className="eq-split">
              <div className="panel">
                <div className="eval-row-toolbar">
                  <strong>Run scores — claim elements vs C01–C06</strong>
                  <div className="eq-filters">
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      <option value="all">All statuses</option>
                      <option value="fail">Has Fail</option>
                      <option value="pass">All Pass</option>
                      <option value="review">Needs review</option>
                    </select>
                    <select
                      value={criterionFilter}
                      onChange={(e) => setCriterionFilter(e.target.value)}
                    >
                      <option value="all">All criteria</option>
                      {CORE_CRITERIA.map((id) => (
                        <option key={id} value={id}>
                          {id} issues
                        </option>
                      ))}
                    </select>
                    <select
                      value={severityFilter}
                      onChange={(e) => setSeverityFilter(e.target.value)}
                    >
                      <option value="all">All severities</option>
                      {SEVERITY_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>Expected label</th>
                      <th>Actual label(s)</th>
                      <th>C01</th>
                      <th>C02</th>
                      <th>C03</th>
                      <th>C04</th>
                      <th>C05</th>
                      <th>C06</th>
                      <th>Severity</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="doc-sub">
                          No rows match filters.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const sev = worstSeverity(row.criteria);
                        return (
                          <tr
                            key={row.id}
                            className={selectedCase?.case_key === row.case_key ? "eval-selected" : ""}
                          >
                            <td>{row.case_key}</td>
                            <td>{row.reference_label || "—"}</td>
                            <td>{formatLabels(row.generated_label)}</td>
                            {CORE_CRITERIA.map((cid) => {
                              const crit = row.criteria.find((c) => c.criterion_id === cid);
                              const st = crit ? criterionStatus(crit) : "—";
                              return (
                                <td key={cid}>
                                  <span className={criterionChipClass(st)} title={st}>
                                    {st === "Pass" ? "1" : st === "Fail" || st === "Error" ? "0" : "·"}
                                  </span>
                                </td>
                              );
                            })}
                            <td>{sev || "—"}</td>
                            <td>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => setSelectedCaseKey(row.case_key)}
                              >
                                View details
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {detail.alignments?.length ? (
                  <details style={{ marginTop: 12 }}>
                    <summary>Alignment proposals</summary>
                    <table className="comparison-table" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Expected</th>
                          <th>Mapped generated</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.alignments.map((a) => (
                          <tr key={a.reference_row_id}>
                            <td>
                              {a.reference_label || a.reference_row_id}
                              <div className="doc-sub">{(a.reference_text || "").slice(0, 80)}</div>
                            </td>
                            <td>{a.reference_mapping_label || "—"}</td>
                            <td>
                              {a.generated_elements
                                .map((g) => `${g.generated_label || "?"} (${g.score.toFixed(2)})`)
                                .join(", ") || "—"}
                            </td>
                            <td>{a.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
              </div>

              <div className="panel eq-detail">
                {selectedCase ? (
                  <>
                    <h3 style={{ marginTop: 0 }}>{selectedCase.case_key} — criterion detail</h3>
                    <p className="doc-sub">
                      Expected: <strong>{selectedCase.reference_label || "—"}</strong>
                      {" · "}
                      Actual: <strong>{formatLabels(selectedCase.generated_label)}</strong>
                    </p>
                    {(() => {
                      const lab = labelledReference(selectedCase);
                      if (!lab) return null;
                      const gaps = Array.isArray(lab.gaps)
                        ? lab.gaps.join("; ")
                        : lab.gaps || "";
                      return (
                        <div className="eq-labelled-box">
                          <span className="doc-sub">Labelled-set decision (sheet 2)</span>
                          <p style={{ margin: "4px 0" }}>
                            <strong>{lab.mapping_label || selectedCase.reference_label}</strong>
                            {lab.evidence_ids?.length ? (
                              <span className="doc-sub"> · anchors {lab.evidence_ids.join(", ")}</span>
                            ) : null}
                          </p>
                          <p className="doc-sub" style={{ margin: "0 0 6px" }}>
                            {(lab.exact_text || "").slice(0, 160)}
                            {(lab.exact_text || "").length > 160 ? "…" : ""}
                          </p>
                          <p style={{ margin: "0 0 6px" }}>{lab.rationale || "—"}</p>
                          {gaps ? (
                            <p className="doc-sub" style={{ margin: 0 }}>
                              Gaps: {gaps}
                            </p>
                          ) : null}
                        </div>
                      );
                    })()}
                    <p className="doc-sub">Failures and blocked criteria shown first.</p>
                    {sortedCriteriaForDetail(selectedCase.criteria).map((c) => (
                      <CriterionCard
                        key={c.id}
                        c={c}
                        expandPass={false}
                        overrideReason={overrideReason}
                        setOverrideReason={setOverrideReason}
                        onAdjudicate={(id, status) => void adjudicate(id, status)}
                      />
                    ))}
                  </>
                ) : (
                  <p className="doc-sub">Select a row to inspect expected vs actual criteria.</p>
                )}
              </div>
            </div>
          ) : null}

          {section === "failures" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Failure modes &amp; corrective actions</h3>
              <p className="doc-sub">
                Top product risks for attorney-facing use. Tracker status is manual — a new eval does
                not auto-close items.
              </p>

              <h4>Top three failure types</h4>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Failure type</th>
                    <th>Example</th>
                    <th>Fix</th>
                    <th>Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {TOP_FAILURE_NARRATIVES.map((item, idx) => (
                    <tr key={item.title}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{item.title}</strong>
                      </td>
                      <td>{item.example}</td>
                      <td>{item.fix}</td>
                      <td className="doc-sub">{item.verify}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!detail.alignments_confirmed ? (
                <div className="eq-align-banner" style={{ marginTop: 12 }}>
                  <p>
                    Open item: <strong>C06 Not run</strong> — alignments unconfirmed. Confirm to
                    unlock label scoring.
                  </p>
                  <button type="button" className="secondary" onClick={() => void confirmAlignment()}>
                    Confirm alignments
                  </button>
                </div>
              ) : null}

              <h4 style={{ marginTop: 20 }}>Criterion failures (this run)</h4>
              {rowCriterionFailures.length ? (
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Criterion</th>
                      <th>Status</th>
                      <th>Severity</th>
                      <th>Failure mode</th>
                      <th>Problem</th>
                      <th>Recommended action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowCriterionFailures.map(({ caseKey, criterion: c }) => (
                      <tr key={`${caseKey}-${c.id}`}>
                        <td>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setSelectedCaseKey(caseKey);
                              setSection("results");
                            }}
                          >
                            {caseKey}
                          </button>
                        </td>
                        <td>{c.criterion_id}</td>
                        <td>
                          <StatusChip value={criterionStatus(c)} />
                        </td>
                        <td>{c.severity || "—"}</td>
                        <td>
                          <code>{c.failure_mode || (criterionStatus(c) === "Not run" ? "blocked_until_alignment" : "—")}</code>
                        </td>
                        <td>{criterionReason(c).slice(0, 160)}</td>
                        <td>{(c.recommended_action || "Confirm alignments / re-score C06").slice(0, 140)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="doc-sub">No open C01–C08 Fail / Needs review / blocked items on rows.</p>
              )}

              <h4 style={{ marginTop: 20 }}>Action tracker</h4>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Criterion</th>
                    <th>Cases</th>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Problem</th>
                    <th>Fix</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {failureActions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="doc-sub">
                        No seeded failure actions yet.
                      </td>
                    </tr>
                  ) : (
                    failureActions.map((action) => (
                      <tr key={action.id}>
                        <td className="doc-sub">{action.id.slice(0, 8)}</td>
                        <td>{action.criterion_id || "—"}</td>
                        <td>{(action.case_keys || []).join(", ") || "—"}</td>
                        <td>
                          <code>{action.category || "—"}</code>
                        </td>
                        <td>{action.severity || "—"}</td>
                        <td>{(action.problem || "—").slice(0, 120)}</td>
                        <td>{(action.recommended_fix || "—").slice(0, 120)}</td>
                        <td>
                          <select
                            value={action.status || "Open"}
                            onChange={(e) => void updateActionStatus(action.id, e.target.value)}
                          >
                            {["Open", "In Progress", "Fixed", "Verified", "Regressed"].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

                    {section === "plan" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Production Quality &amp; Regression Plan</h3>
              <p className="doc-sub">
                Same lanes as Deliverable 4 sheet <strong>5 Production plan</strong>: automated
                guardrails, human-in-the-loop triggers, and per-criterion CI gates (no blended score).
              </p>
              <div className="eq-crit-grid" style={{ marginTop: 12 }}>
                <div>
                  <span className="doc-sub">Automated</span>
                  <p>C01 edition lock; C02 verbatim PDF-text match; C03 section + page offset; C04 screenshot link; Full-map / split / Table 8-10 guards.</p>
                </div>
                <div>
                  <span className="doc-sub">Human-in-the-loop</span>
                  <p>Partial map / C06 Fail / fine-split; decoder→encoder Full-map inference; cite-drift vs E01–E07; visual crop QA. LLMs cannot self-certify claim construction.</p>
                </div>
                <div>
                  <span className="doc-sub">CI / regression</span>
                  <p>Freeze labelled pack; re-eval on prompt/retrieval/LLM change; C01/C02=100%, C06 Fail→0; reference never enters production retrieval.</p>
                </div>
                <div>
                  <span className="doc-sub">This run</span>
                  <p><strong>{recommendation}</strong> · Attorney-ready: {attorneyReady ? "YES" : "NO"}</p>
                </div>
              </div>
            </div>
          ) : null}

        </>
      )}
    </section>
  );
}

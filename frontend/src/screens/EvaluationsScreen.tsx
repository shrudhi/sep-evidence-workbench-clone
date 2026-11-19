import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { RunSummary, SetupBundle } from "../types";

type Props = {
  setup: SetupBundle;
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onNotice: (message: string | null) => void;
};

type RateMetric = {
  pass?: number;
  eligible?: number;
  rate?: number | null;
  display?: string;
};

type ProductMetrics = {
  headline?: {
    health_score?: number | null;
    health_label?: string;
    label_agreement?: RateMetric;
    row_alignment?: RateMetric;
    compared_to?: string;
  };
  quality_gates?: Array<{
    criterion_id: string;
    name: string;
    pass_rate?: RateMetric;
    failures?: number;
    status?: string;
    pm_insight?: string;
  }>;
  integrity?: Record<string, RateMetric>;
  semantic?: Record<string, RateMetric>;
  coverage?: {
    reference_rows?: number;
    aligned_rows?: number;
    label_matches?: number;
    class_distribution_reference?: Record<string, number>;
  };
  row_comparisons?: Array<{
    reference_row_id?: string;
    reference_mapping_label?: string | null;
    generated_mapping_label?: string | null;
    label_match?: boolean;
    aligned?: boolean;
    failed_criteria?: string[];
    problem?: string | null;
  }>;
  failure_hotspots?: Array<{
    criterion_id?: string | null;
    name?: string;
    failures?: number;
    pass_rate?: string;
    pm_insight?: string;
  }>;
  recommendations?: string[];
  metric_glossary?: Array<{ id: string; name: string; meaning: string }>;
};

type ReferenceFile = {
  id: string;
  filename: string;
  size_bytes?: number;
  kind?: string;
  download_url?: string;
  attached_at?: string;
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

type ReleaseReadiness = {
  recommendation?: string;
  reason?: string;
  provisional?: boolean;
  expert_signoff?: boolean;
  human_review_required?: boolean;
  critical_failures?: number;
  high_failures?: number;
  full_map_precision_recall?: { precision?: string; recall?: string; note?: string };
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
    expert_display: string;
    failures: number;
    pending: number;
    counts: Record<string, number>;
  }>;
  product_metrics?: ProductMetrics;
  observed_failures?: Array<{
    name?: string;
    criterion_id?: string | null;
    count: number;
    root_cause_hypothesis?: string;
    note?: string;
  }>;
  failure_actions?: FailureAction[];
  production_plan?: {
    automated?: string;
    expert?: string;
    regression?: string;
    quality_gates?: string;
  };
  limitations?: string[];
  baselines?: Record<string, string>;
};

type ChartSnapshot = {
  id: string;
  output_stage?: string;
  chart_hash?: string;
  created_at?: string;
};

type HistoryPoint = {
  evaluation_run_id: string;
  created_at?: string;
  health_score?: number | null;
  critical_failures?: number | null;
  criteria?: Record<string, { rate?: number | null; name?: string }>;
};

type DatasetOption = {
  id: string;
  version: string;
  status_label: string;
};

type EvalDetail = {
  id: string;
  status: string;
  progress?: { stage?: string; detail?: string };
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
  cases: Array<{
    id: string;
    case_type: string;
    case_key: string;
    reference_label?: string | null;
    generated_label?: string | null;
    criteria: Array<{
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
      automatic_evidence?: unknown;
    }>;
    payload: Record<string, unknown>;
  }>;
  dataset: { id: string; version: string; status_label: string; provisional: number | boolean };
  snapshot: { id?: string; output_stage: string; chart_hash: string; run_id: string };
  failure_actions?: FailureAction[];
  reference_payload: {
    status?: string;
    label_policy?: string;
    class_distribution?: Record<string, number>;
    baselines?: Record<string, string>;
    criteria?: Array<{ id: string; name: string; pass_condition: string }>;
    exclusions?: string[];
    rows?: Array<Record<string, unknown>>;
    requirements?: Array<Record<string, unknown>>;
    target_selection_controls?: Array<Record<string, unknown>>;
    planned_risk_cases?: Array<Record<string, unknown>>;
    companions?: Record<string, string>;
    patent?: { id?: string; claim_number?: number };
    recommended_target?: { family?: string; edition?: string };
  };
  run_id: string;
};

const STATUS_CLASS: Record<string, string> = {
  Pass: "eval-pass",
  Fail: "eval-fail",
  "Needs review": "eval-review",
  "Not run": "eval-muted",
  "Not applicable": "eval-muted",
  Error: "eval-fail"
};

function StatusChip({ value }: { value?: string | null }) {
  if (!value) return <span className="eval-muted">—</span>;
  return <span className={`eval-chip ${STATUS_CLASS[value] || "eval-muted"}`}>{value}</span>;
}

export default function EvaluationsScreen({
  setup,
  runs,
  activeRunId,
  onSelectRun,
  onNotice
}: Props) {
  const [tab, setTab] = useState<
    | "results"
    | "levels"
    | "reference"
    | "failures"
    | "history"
    | "plan"
  >("results");
  const [levelTab, setLevelTab] = useState<
    "standard_selection" | "claim_requirements" | "evidence_accuracy" | "technical_mapping" | "complete_claim"
  >("standard_selection");
  const [datasetId, setDatasetId] = useState("expected-claim1-v1");
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [evalId, setEvalId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvalDetail | null>(null);
  const [template, setTemplate] = useState<EvalSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedCaseKey, setSelectedCaseKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [compareBaseline, setCompareBaseline] = useState("");
  const [compareCandidate, setCompareCandidate] = useState("");
  const [compareResult, setCompareResult] = useState<Record<string, unknown> | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pastEvals, setPastEvals] = useState<
    Array<{ id: string; status: string; run_id: string; created_at?: string }>
  >([]);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [trendCriterion, setTrendCriterion] = useState("C06");

  const completedRuns = useMemo(
    () => runs.filter((run) => ["analyst_review", "complete"].includes(run.status)),
    [runs]
  );
  const h265Runs = completedRuns.filter((run) => (run.family || "").includes("H.265"));

  const refreshReferenceFiles = async (id = datasetId) => {
    try {
      setReferenceFiles(await api<ReferenceFile[]>(`/api/evaluation-datasets/${id}/files`));
    } catch {
      setReferenceFiles([]);
    }
  };

  const refreshDatasets = async () => {
    try {
      const rows = await api<DatasetOption[]>("/api/evaluation-datasets");
      setDatasets(rows);
      if (rows.length && !rows.some((d) => d.id === datasetId)) {
        setDatasetId(rows[0].id);
      }
    } catch {
      setDatasets([]);
    }
  };

  const refreshHistory = async (id = datasetId) => {
    try {
      setHistory(
        await api<HistoryPoint[]>(
          `/api/evaluation-runs/history?dataset_id=${encodeURIComponent(id)}&limit=20`
        )
      );
    } catch {
      setHistory([]);
    }
  };

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
        await api(`/api/evaluation-datasets/${datasetId}/files/attach-default`, {
          method: "POST"
        }).catch(() => undefined);
        await refreshDatasets();
        await refreshReferenceFiles(datasetId);
        await refreshHistory(datasetId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshReferenceFiles(datasetId);
    void refreshHistory(datasetId);
  }, [datasetId]);

  useEffect(() => {
    if (!activeRunId) {
      setSnapshots([]);
      setSnapshotId("");
      return;
    }
    api<ChartSnapshot[]>(`/api/runs/${activeRunId}/chart-snapshots`)
      .then((rows) => {
        setSnapshots(rows);
        setSnapshotId("");
      })
      .catch(() => {
        setSnapshots([]);
        setSnapshotId("");
      });
  }, [activeRunId]);

  useEffect(() => {
    if (!evalId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api<EvalDetail>(`/api/evaluation-runs/${evalId}`);
        if (!cancelled) setDetail(next);
      } catch (error) {
        if (!cancelled) onNotice((error as Error).message);
      }
    };
    load();
  }, [evalId, onNotice]);

  const summary = detail?.summary || template;
  const metrics = summary?.product_metrics;
  const selectedCase =
    detail?.cases.find((item) => item.case_key === selectedCaseKey || item.id === selectedCaseKey) ||
    null;

  const uploadReference = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    onNotice(null);
    try {
      const lower = file.name.toLowerCase();
      const body = new FormData();
      body.append("file", file);
      if (lower.endsWith(".json") || lower.endsWith(".csv") || lower.endsWith(".xlsx")) {
        const response = await fetch(`/api/evaluation-datasets/upload`, {
          method: "POST",
          body
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Dataset upload failed");
        }
        const created = (await response.json()) as DatasetOption;
        await refreshDatasets();
        setDatasetId(created.id);
        onNotice(`Saved reference dataset ${created.id} v${created.version}`);
      } else {
        const response = await fetch(`/api/evaluation-datasets/${datasetId}/files`, {
          method: "POST",
          body
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Upload failed");
        }
        await refreshReferenceFiles();
        onNotice(`Attached reference file: ${file.name}`);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeReference = async (fileId: string) => {
    try {
      await api(`/api/evaluation-datasets/${datasetId}/files/${fileId}`, { method: "DELETE" });
      await refreshReferenceFiles();
      onNotice("Reference file removed.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Remove failed");
    }
  };

  const attachDefaultPdf = async () => {
    try {
      await api(`/api/evaluation-datasets/${datasetId}/files/attach-default`, { method: "POST" });
      await refreshReferenceFiles();
      onNotice("Attached Expected_Claim1_Chart.pdf from the reference pack.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not attach default PDF");
    }
  };

  const filteredCases = (detail?.cases || []).filter((item) => {
    const allowedTypes = ["reference_row", "requirement", "rubric_test", "target_selection", "complete_claim"];
    if (!allowedTypes.includes(item.case_type)) return false;
    if ((item.payload as { synthetic?: boolean })?.synthetic && filter !== "all") {
      // keep synthetic visible under all / evidence
      if (filter !== "evidence") return filter === "failures"
        ? item.criteria.some((c) => (c.adjudicated_status || c.automatic_status) === "Fail")
        : true;
    }
    const statuses = item.criteria.map((c) => c.adjudicated_status || c.automatic_status);
    const severities = item.criteria.map((c) => c.severity || "None");
    if (severityFilter !== "all" && !severities.includes(severityFilter)) return false;
    if (filter === "all") return true;
    if (filter === "failures") return statuses.includes("Fail");
    if (filter === "needs_review") return statuses.includes("Needs review");
    if (filter === "evidence")
      return (
        item.case_type === "rubric_test" ||
        item.criteria.some(
          (c) =>
            ["C02", "C03", "C04"].includes(c.criterion_id) &&
            ["Fail", "Needs review", "Pass"].includes(c.adjudicated_status || c.automatic_status)
        )
      );
    if (filter === "label")
      return item.criteria.some(
        (c) =>
          c.criterion_id === "C06" &&
          (c.adjudicated_status || c.automatic_status) === "Fail"
      );
    if (filter === "coverage")
      return (
        item.case_type === "requirement" ||
        item.criteria.some(
          (c) =>
            ["C07", "C08"].includes(c.criterion_id) &&
            (c.adjudicated_status || c.automatic_status) === "Fail"
        )
      );
    if (filter === "missing") return item.case_type === "reference_row" && !item.generated_label;
    return true;
  });

  const levelCases = (detail?.cases || []).filter((item) => {
    if (levelTab === "standard_selection")
      return item.case_type === "target_selection" || item.case_key === "T01" || item.case_key === "T10";
    if (levelTab === "claim_requirements") return item.case_type === "requirement";
    if (levelTab === "evidence_accuracy")
      return (
        item.case_key === "T02" ||
        item.case_key === "T09" ||
        (item.case_type === "reference_row" &&
          item.criteria.some((c) => ["C01", "C02", "C03", "C04"].includes(c.criterion_id)))
      );
    if (levelTab === "technical_mapping")
      return (
        ["T03", "T04", "T05", "T06", "T07", "T08"].includes(item.case_key) ||
        item.case_type === "reference_row"
      );
    return item.case_type === "complete_claim";
  });

  const readiness = summary?.release_readiness;
  const levelMetrics = summary?.level_metrics || {};

  const runEvaluation = async () => {
    if (!activeRunId) {
      onNotice("Select a completed analysis run first.");
      return;
    }
    if (!datasetId) {
      onNotice("Select or upload a reference dataset first.");
      return;
    }
    setRunning(true);
    onNotice(null);
    try {
      const created = await api<EvalDetail>("/api/evaluation-runs", {
        method: "POST",
        body: JSON.stringify({
          run_id: activeRunId,
          dataset_id: datasetId,
          snapshot_id: snapshotId || undefined
        })
      });
      setEvalId(created.id);
      setDetail(created);
      setSelectedCaseKey(created.cases.find((c) => c.case_type === "reference_row")?.case_key || null);
      setPastEvals(await api("/api/evaluation-runs"));
      await refreshHistory(datasetId);
      if (activeRunId) {
        setSnapshots(await api(`/api/runs/${activeRunId}/chart-snapshots`));
      }
      onNotice(
        created.summary.requires_correction
          ? "Evaluation complete — critical failures require correction before attorney-ready use."
          : "Evaluation complete. Automated quality metrics ready — expert review still pending."
      );
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const updateActionStatus = async (actionId: string, status: string) => {
    try {
      await api(`/api/evaluation-failure-actions/${actionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      if (evalId) {
        setDetail(await api<EvalDetail>(`/api/evaluation-runs/${evalId}`));
      }
      onNotice(`Failure action marked ${status}`);
    } catch (error) {
      onNotice((error as Error).message);
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
      onNotice("Alignments confirmed. Label criterion recomputed.");
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

  const runCompare = async () => {
    if (!compareBaseline || !compareCandidate) return;
    try {
      setCompareResult(
        await api(
          `/api/evaluation-runs/compare?baseline=${encodeURIComponent(compareBaseline)}&candidate=${encodeURIComponent(compareCandidate)}`
        )
      );
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

  return (
    <section className="evaluations">
      <div className="eval-header">
        <div>
          <h1 className="page-title">Evaluation &amp; Quality Improvement</h1>
          <p className="page-sub">
            Score AI claim charts against a human-verified reference. Independent of Observability
            traces.
          </p>
        </div>
        <div className="eval-controls">
          <label>
            Generated chart
            <select
              value={activeRunId || ""}
              onChange={(event) => onSelectRun(event.target.value)}
            >
              <option value="">Select run…</option>
              {completedRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {(run.family || "run") +
                    " · " +
                    (run.status_label || run.status) +
                    " · " +
                    run.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chart snapshot
            <select value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}>
              <option value="">Freeze latest chart</option>
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {(snap.created_at || "").slice(0, 19)} · {(snap.chart_hash || "").slice(0, 8)} ·{" "}
                  {snap.output_stage || "chart"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference dataset
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              {(datasets.length
                ? datasets
                : [{ id: "expected-claim1-v1", version: "1.0.0", status_label: "Claim 1 reference" }]
              ).map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.id} v{ds.version}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={running || !activeRunId} onClick={runEvaluation}>
            {running ? "Evaluating…" : "Run Evaluation"}
          </button>
          <button
            className="ghost"
            disabled={!evalId}
            onClick={() =>
              evalId &&
              window.open(`/api/evaluation-runs/${evalId}/export?format=xlsx`, "_blank")
            }
          >
            Download Evaluation Report (.xlsx)
          </button>
        </div>
      </div>

      <div className="panel eval-reference-panel">
        <div className="eval-reference-head">
          <div>
            <h3>Reference file</h3>
            <p className="doc-sub">
              Upload a JSON/CSV/XLSX reference dataset, or attach companion PDF/files to the selected
              dataset. Chart snapshots freeze actual generated evidence — never fabricated scores.
            </p>
          </div>
          <div className="eval-reference-actions">
            <button type="button" className="secondary" onClick={() => void attachDefaultPdf()}>
              Attach Expected_Claim1_Chart.pdf
            </button>
            <label className="secondary eval-upload-btn">
              {uploading ? "Uploading…" : "Upload reference dataset / file"}
              <input
                type="file"
                accept=".pdf,.xlsx,.csv,.json,application/pdf,text/csv,application/json"
                hidden
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  event.target.value = "";
                  void uploadReference(file);
                }}
              />
            </label>
          </div>
        </div>
        {referenceFiles.length ? (
          <ul className="eval-file-list">
            {referenceFiles.map((file) => (
              <li key={file.id}>
                <div>
                  <strong>{file.filename}</strong>
                  <span className="doc-sub">
                    {" "}
                    · {file.kind || "file"}
                    {file.size_bytes != null
                      ? ` · ${Math.max(1, Math.round(file.size_bytes / 1024))} KB`
                      : ""}
                  </span>
                </div>
                <div className="eval-file-actions">
                  <a
                    className="ghost"
                    href={file.download_url || `#`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void removeReference(file.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">No reference file attached yet.</div>
        )}
      </div>

      <div className="eval-meta">
        <div>
          <strong>Patent</strong>{" "}
          {detail?.reference_payload?.patent?.id || setup.patent?.identifier || "—"}
        </div>
        <div>
          <strong>Target standard</strong>{" "}
          {detail?.reference_payload?.recommended_target?.edition ||
            "Select H.265 V10 chart + Claim 1 reference"}
        </div>
        <div>
          <strong>Dataset</strong> {detail?.dataset.id || datasetId} v
          {detail?.dataset.version || "—"}
        </div>
        <div>
          <strong>Chart version</strong>{" "}
          {detail?.snapshot?.chart_hash
            ? `${detail.snapshot.output_stage} · ${detail.snapshot.chart_hash.slice(0, 10)}`
            : snapshotId
              ? `Selected snapshot ${snapshotId.slice(0, 8)}`
              : "Latest on Run Evaluation"}
        </div>
        <div>
          <strong>Rubric</strong> C01–C08
        </div>
        <div>
          <strong>Status</strong> {topStatus}
        </div>
        {!completedRuns.length ? (
          <div className="warn-box" style={{ gridColumn: "1 / -1" }}>
            No generated claim chart is available. Complete an analysis run before evaluating.
          </div>
        ) : h265Runs.length === 0 ? (
          <div className="warn-box" style={{ gridColumn: "1 / -1" }}>
            No completed H.265 run yet. The default Claim 1 reference requires an H.265 V10 chart.
          </div>
        ) : null}
        {summary?.requires_correction ? (
          <div className="warn-box" style={{ gridColumn: "1 / -1" }}>
            Critical failures present — output requires correction / expert review. Aggregate score
            does not make this attorney-ready.
          </div>
        ) : null}
        {(summary?.release_recommendation || readiness?.recommendation) && detail ? (
          <div
            className="panel"
            style={{ gridColumn: "1 / -1", marginTop: 4, borderColor: "var(--line)" }}
          >
            <h3 style={{ marginTop: 0 }}>Release readiness</h3>
            <p style={{ margin: "0 0 8px" }}>
              <span
                className={`eval-chip ${
                  (summary?.release_recommendation || readiness?.recommendation || "").startsWith(
                    "No-Go"
                  )
                    ? "eval-fail"
                    : (summary?.release_recommendation || "").startsWith("Go") &&
                        !(summary?.release_recommendation || "").includes("Conditional")
                      ? "eval-pass"
                      : "eval-review"
                }`}
              >
                {summary?.release_recommendation || readiness?.recommendation}
              </span>{" "}
              <span className="doc-sub">{readiness?.reason}</span>
            </p>
            <div className="eval-metric-cards">
              <div className="eval-metric-card">
                <span className="evidence-label">Requirement recall</span>
                <strong>
                  {String(
                    (levelMetrics.requirement_recall as LevelMetric | undefined)?.display || "—"
                  )}
                </strong>
              </div>
              <div className="eval-metric-card">
                <span className="evidence-label">Citation validity</span>
                <strong>
                  {String(
                    (levelMetrics.citation_validity as LevelMetric | undefined)?.display || "—"
                  )}
                </strong>
              </div>
              <div className="eval-metric-card">
                <span className="evidence-label">Mapping labels</span>
                <strong>
                  {String(
                    (levelMetrics.mapping_label_accuracy as LevelMetric | undefined)?.display ||
                      "—"
                  )}
                </strong>
              </div>
              <div className="eval-metric-card">
                <span className="evidence-label">Full map P/R</span>
                <strong>Not Assessable</strong>
                <span className="doc-sub">Zero Full positives in provisional pack</span>
              </div>
            </div>
            <p className="doc-sub" style={{ marginBottom: 0 }}>
              Provisional reference · no SEP attorney sign-off · Observability traces are not used
              for scoring.
            </p>
          </div>
        ) : null}
      </div>

      <div className="panel eval-metrics-panel">
        <div className="eval-metrics-head">
          <h3>Product quality metrics</h3>
          <p className="doc-sub">
            {metrics?.headline?.compared_to ||
              "Run evaluation to score latest output against the reference."}
          </p>
        </div>
        <div className="eval-metric-cards">
          <div className="eval-metric-card">
            <span className="evidence-label">Health score</span>
            <strong>
              {metrics?.headline?.health_score != null
                ? `${metrics.headline.health_score}`
                : "—"}
            </strong>
            <span className="doc-sub">
              {summary?.requires_correction
                ? "Requires correction"
                : metrics?.headline?.health_label || "Not scored"}
            </span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Critical / High</span>
            <strong>
              {summary?.critical_failures ?? "—"} / {summary?.high_failures ?? "—"}
            </strong>
            <span className="doc-sub">Open severity-ranked failures</span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Label agreement</span>
            <strong>{metrics?.headline?.label_agreement?.display || "—"}</strong>
            <span className="doc-sub">Generated Full/Partial/No vs reference</span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Row alignment</span>
            <strong>{metrics?.headline?.row_alignment?.display || "—"}</strong>
            <span className="doc-sub">Reference elements matched to chart rows</span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Quote integrity</span>
            <strong>{metrics?.integrity?.quote_verbatim?.display || "—"}</strong>
            <span className="doc-sub">Verbatim quotes on cited pages</span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Edition / page</span>
            <strong>
              {metrics?.integrity?.right_standard?.display || "—"} ·{" "}
              {metrics?.integrity?.source_page?.display || "—"}
            </strong>
            <span className="doc-sub">Right standard & citation location</span>
          </div>
          <div className="eval-metric-card">
            <span className="evidence-label">Rationale / label</span>
            <strong>
              {metrics?.semantic?.rationale_supports?.display || "—"} ·{" "}
              {metrics?.semantic?.label_correct?.display || "—"}
            </strong>
            <span className="doc-sub">Semantic support & mapping label</span>
          </div>
        </div>

        {(metrics?.recommendations || []).length ? (
          <div className="eval-recommendations">
            <span className="evidence-label">PM focus</span>
            <ul>
              {(metrics?.recommendations || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {(metrics?.quality_gates || []).length ? (
          <table className="comparison-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Quality gate</th>
                <th>Pass rate</th>
                <th>Status</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.quality_gates || []).map((gate) => (
                <tr key={gate.criterion_id}>
                  <td>
                    {gate.criterion_id} · {gate.name}
                  </td>
                  <td>{gate.pass_rate?.display || "—"}</td>
                  <td>
                    <span
                      className={`eval-chip ${
                        gate.status === "healthy"
                          ? "eval-pass"
                          : gate.status === "watch"
                            ? "eval-review"
                            : gate.status === "problem"
                              ? "eval-fail"
                              : "eval-muted"
                      }`}
                    >
                      {gate.status || "—"}
                    </span>
                  </td>
                  <td className="doc-sub">{gate.pm_insight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {(metrics?.row_comparisons || []).length ? (
          <table className="comparison-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Reference row</th>
                <th>Reference label</th>
                <th>Latest output label</th>
                <th>Match</th>
                <th>Current problem</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.row_comparisons || []).map((row) => (
                <tr key={row.reference_row_id}>
                  <td>{row.reference_row_id}</td>
                  <td>{row.reference_mapping_label || "—"}</td>
                  <td>{row.generated_mapping_label || "—"}</td>
                  <td>
                    <span
                      className={`eval-chip ${row.label_match ? "eval-pass" : "eval-fail"}`}
                    >
                      {row.label_match ? "Match" : "Mismatch"}
                    </span>
                  </td>
                  <td className="doc-sub">{row.problem || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {(metrics?.metric_glossary || []).length ? (
          <details className="eval-glossary">
            <summary>Metric glossary</summary>
            <ul>
              {(metrics?.metric_glossary || []).map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong> — {item.meaning}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="eval-tabs" role="tablist">
        {(
          [
            ["results", "Test cases"],
            ["levels", "By level"],
            ["reference", "Reference & rubric"],
            ["failures", "Failures & actions"],
            ["history", "Iteration history"],
            ["plan", "Production plan"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "levels" ? (
        <div className="panel">
          <div className="eval-tabs" role="tablist" style={{ marginBottom: 12 }}>
            {(
              [
                ["standard_selection", "1. Standard selection"],
                ["claim_requirements", "2. Claim requirements"],
                ["evidence_accuracy", "3. Evidence accuracy"],
                ["technical_mapping", "4. Technical mapping"],
                ["complete_claim", "5. Complete claim"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={levelTab === id ? "active" : ""}
                onClick={() => setLevelTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Type</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {levelCases.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    {detail ? "No cases for this level." : "Not run — no invented metrics."}
                  </td>
                </tr>
              ) : (
                levelCases.map((row) => {
                  const crit = row.criteria[0];
                  const status = crit?.adjudicated_status || crit?.automatic_status;
                  return (
                    <tr
                      key={row.id}
                      className={selectedCaseKey === row.case_key ? "eval-selected" : ""}
                      onClick={() => {
                        setSelectedCaseKey(row.case_key);
                        setTab("results");
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{row.case_key}</td>
                      <td>{row.case_type}</td>
                      <td style={{ fontSize: 12 }}>{row.reference_label || "—"}</td>
                      <td style={{ fontSize: 12 }}>
                        {Array.isArray(row.generated_label)
                          ? row.generated_label.join(", ")
                          : row.generated_label || "—"}
                      </td>
                      <td>
                        <StatusChip value={status} />
                      </td>
                      <td>{crit?.severity && crit.severity !== "None" ? crit.severity : "—"}</td>
                      <td style={{ fontSize: 12 }}>
                        {(crit?.automatic_reason || "").slice(0, 140)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "results" ? (
        <>
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>Criterion summary</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
              Criterion pass rates exclude Not Applicable. Critical failures stay visible even when
              health score looks high. Always-Partial baseline:{" "}
              {summary?.always_partial_baseline || "3/3"}. Full map P/R:{" "}
              {summary?.full_map_precision_recall ||
                "Not estimable: no adjudicated positive Full examples"}
              .
            </p>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Automatic pass/eligible</th>
                  <th>Expert-confirmed pass/eligible</th>
                  <th>Failures</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.criteria || []).map((row) => (
                  <tr key={row.criterion_id}>
                    <td>
                      {row.criterion_id} · {row.name}
                    </td>
                    <td>{row.automatic_display}</td>
                    <td>{row.expert_display}</td>
                    <td>{row.failures ?? row.counts?.Fail ?? 0}</td>
                    <td>{row.pending ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!detail?.alignments_confirmed && detail ? (
            <div className="warn-box" style={{ marginBottom: 14 }}>
              Requirement alignment is proposed but not confirmed — label grading (C06) stays blocked.
              <div style={{ marginTop: 8 }}>
                {(detail.alignments || []).map((item) => (
                  <div key={item.reference_row_id} style={{ marginBottom: 6, fontSize: 13 }}>
                    <strong>{item.reference_row_id}</strong> →{" "}
                    {item.generated_elements.length
                      ? item.generated_elements
                          .map((g) => `${g.generated_label} (${g.score})`)
                          .join(", ")
                      : "unresolved"}
                  </div>
                ))}
                <button className="primary" onClick={confirmAlignment}>
                  Confirm proposed alignments
                </button>
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="eval-row-toolbar">
              <h3 style={{ margin: 0 }}>Test case results</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="failures">Failures</option>
                  <option value="needs_review">Needs review</option>
                  <option value="evidence">Evidence issues</option>
                  <option value="label">Label disagreement</option>
                  <option value="coverage">Coverage / normative</option>
                  <option value="missing">Missing output</option>
                </select>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                >
                  <option value="all">All severities</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Test case</th>
                  <th>Type / level</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Passed / applicable</th>
                  <th>Score</th>
                  <th>Severity</th>
                  <th>Criteria</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: "var(--muted)" }}>
                      {detail ? "No rows match this filter." : "Not run — no invented metrics."}
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((row) => {
                    const applicable = row.criteria.filter(
                      (c) =>
                        !["Not applicable", "Not run"].includes(
                          c.adjudicated_status || c.automatic_status
                        )
                    );
                    const passed = applicable.filter(
                      (c) => (c.adjudicated_status || c.automatic_status) === "Pass"
                    );
                    const worst = ["Critical", "High", "Medium", "Low"].find((level) =>
                      row.criteria.some(
                        (c) =>
                          c.severity === level &&
                          (c.adjudicated_status || c.automatic_status) === "Fail"
                      )
                    );
                    const scoreVals = applicable
                      .map((c) => c.score)
                      .filter((v): v is number => typeof v === "number");
                    const avg =
                      scoreVals.length > 0
                        ? (scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length).toFixed(2)
                        : "—";
                    const synth = Boolean((row.payload as { synthetic?: boolean })?.synthetic);
                    return (
                      <tr
                        key={row.id}
                        className={selectedCaseKey === row.case_key ? "eval-selected" : ""}
                        onClick={() => setSelectedCaseKey(row.case_key)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          {row.case_key}
                          {synth ? " · synthetic" : ""}
                        </td>
                        <td style={{ fontSize: 12 }}>{row.case_type}</td>
                        <td style={{ fontSize: 12 }}>{row.reference_label || "—"}</td>
                        <td style={{ fontSize: 12 }}>
                          {Array.isArray(row.generated_label)
                            ? row.generated_label.join(", ")
                            : row.generated_label || "—"}
                        </td>
                        <td>
                          {passed.length}/{applicable.length}
                        </td>
                        <td>{avg}</td>
                        <td>{worst || "—"}</td>
                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {row.criteria.map((crit) => (
                              <span key={crit.id} title={crit.criterion_id} style={{ fontSize: 11 }}>
                                {crit.criterion_id}{" "}
                                <StatusChip
                                  value={crit.adjudicated_status || crit.automatic_status}
                                />
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <h4 style={{ marginTop: 18 }}>Target-selection controls (separate denominator)</h4>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Expected</th>
                  <th>C01 status</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.cases || [])
                  .filter((c) => c.case_type === "target_selection")
                  .map((row) => (
                    <tr key={row.id}>
                      <td>{row.case_key}</td>
                      <td>{row.reference_label}</td>
                      <td>
                        <StatusChip
                          value={
                            row.criteria[0]?.adjudicated_status || row.criteria[0]?.automatic_status
                          }
                        />
                      </td>
                    </tr>
                  ))}
                {!detail ? (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--muted)" }}>
                      Not run
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {selectedCase ? (
            <div className="eval-inspector panel" style={{ marginTop: 14 }}>
              <h3>Case inspector · {selectedCase.case_key}</h3>
              <div className="eval-inspector-grid">
                <div>
                  <h4>Generated</h4>
                  {(
                    (selectedCase.payload.generated_elements as Array<Record<string, unknown>>) ||
                    []
                  ).map((el) => {
                    const rev = (el.revision as Record<string, unknown>) || {};
                    return (
                      <div key={String(el.id)} className="eval-block">
                        <strong>
                          {String(el.label)} · {String(rev.mapping_label || "—")}
                        </strong>
                        <p>{String(el.exact_text || "")}</p>
                        <p style={{ color: "var(--muted)", fontSize: 13 }}>
                          {(rev.rationale as string) || ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <h4>Reference</h4>
                  <div className="eval-block">
                    <strong>
                      {String(
                        (selectedCase.payload.reference as Record<string, unknown>)?.mapping_label ||
                          selectedCase.reference_label ||
                          "—"
                      )}
                    </strong>
                    <p>
                      {String(
                        (selectedCase.payload.reference as Record<string, unknown>)?.exact_text || ""
                      )}
                    </p>
                    <p style={{ color: "var(--muted)", fontSize: 13 }}>
                      {String(
                        (selectedCase.payload.reference as Record<string, unknown>)?.rationale || ""
                      )}
                    </p>
                    <p style={{ fontSize: 12 }}>
                      Policy: {detail?.reference_payload.label_policy}
                    </p>
                  </div>
                  <details>
                    <summary>Operational Judge (collapsed — independent grader is primary)</summary>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                      {JSON.stringify(selectedCase.payload.operational_judge || [], null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
              <h4>Criterion details</h4>
              {selectedCase.criteria.map((crit) => (
                <div key={crit.id} className="eval-block">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>
                      {crit.criterion_id} · {crit.criterion_key}
                    </strong>
                    <span>
                      <StatusChip value={crit.adjudicated_status || crit.automatic_status} />{" "}
                      {crit.severity && crit.severity !== "None" ? (
                        <span className="eval-chip eval-fail">{crit.severity}</span>
                      ) : null}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, margin: "6px 0" }}>
                    <strong>Expected:</strong> {crit.expected_summary || "—"}
                  </p>
                  <p style={{ fontSize: 13, margin: "6px 0" }}>
                    <strong>Actual:</strong> {crit.actual_summary || "—"}
                  </p>
                  <p style={{ fontSize: 13, margin: "6px 0" }}>
                    <strong>Score:</strong>{" "}
                    {crit.score == null ? "N/A" : crit.score} ·{" "}
                    <strong>Explanation:</strong>{" "}
                    {crit.adjudicated_reason || crit.automatic_reason || "—"}
                  </p>
                  {crit.failure_mode ? (
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0" }}>
                      Failure mode: {crit.failure_mode}
                      {crit.responsible_component
                        ? ` · Component: ${crit.responsible_component}`
                        : ""}
                    </p>
                  ) : null}
                  {crit.root_cause_hypothesis ? (
                    <p style={{ fontSize: 12, margin: "4px 0" }}>
                      <strong>Suspected root cause:</strong> {crit.root_cause_hypothesis}
                    </p>
                  ) : null}
                  {crit.recommended_action ? (
                    <p style={{ fontSize: 12, margin: "4px 0" }}>
                      <strong>Recommended action:</strong> {crit.recommended_action}
                    </p>
                  ) : null}
                  <div className="eval-adj-actions" style={{ marginTop: 8 }}>
                    <button className="ghost" onClick={() => adjudicate(crit.id, "Pass")}>
                      Confirm
                    </button>
                    <button className="ghost" onClick={() => adjudicate(crit.id, "Fail")}>
                      Override Fail
                    </button>
                    <button className="ghost" onClick={() => adjudicate(crit.id, "Needs review")}>
                      Specialist
                    </button>
                  </div>
                </div>
              ))}
              <label style={{ display: "block", marginTop: 8 }}>
                Adjudication reason
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  placeholder="Required for Confirm / Override / Specialist actions"
                />
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "reference" ? (
        <div className="panel">
          <h3>Reference & rubric</h3>
          <p>
            <strong>Status:</strong> {detail?.reference_payload.status || "Provisional technical reference; no SEP expert/attorney sign-off"}
          </p>
          <p>
            <strong>Label policy:</strong> {detail?.reference_payload.label_policy || "Conditional/contextual support; full requirements not established."}
          </p>
          <p>
            <strong>Class distribution:</strong>{" "}
            {JSON.stringify(
              detail?.reference_payload.class_distribution || {
                "Full map": 0,
                "Partial map": 3,
                "No map": 0
              }
            )}
          </p>
          <p>
            <strong>Baselines:</strong> always-Partial {detail?.reference_payload.baselines?.always_partial_label_agreement || "3/3"}; Full P/R{" "}
            {detail?.reference_payload.baselines?.full_map_precision_recall ||
              "Not estimable: no adjudicated positive Full examples"}
          </p>
          <p style={{ color: "var(--muted)" }}>
            Companions: Expected_Claim1_Chart.pdf and Expected_Claim1_Evaluation.xlsx (human-readable).
            Canonical dataset is Expected_Claim1_Reference.json — not an LLM reading of the PDF.
          </p>
          <h4>Exclusions</h4>
          <ul>
            {(
              detail?.reference_payload.exclusions || [
                "Other claims: Reference not available",
                "G.722.2 and TS 136 211: selection controls only"
              ]
            ).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>Evaluation criteria (C01–C08)</h4>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Pass condition</th>
              </tr>
            </thead>
            <tbody>
              {(
                detail?.reference_payload.criteria ||
                (summary?.criteria || []).map((c) => ({
                  id: c.criterion_id,
                  name: c.name,
                  pass_condition: c.name
                }))
              ).map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.name}</td>
                  <td>{c.pass_condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Requirements</h4>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Element</th>
                <th>Text</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.reference_payload.requirements || []).map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.id)}</td>
                  <td>{String(r.element_label)}</td>
                  <td>{String(r.text)}</td>
                  <td>{String(r.reference_coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "failures" ? (
        <div className="panel">
          <h3>Failure &amp; action tracker</h3>
          <p className="doc-sub">
            Status is human-managed. A newer evaluation does not automatically mark failures Fixed.
          </p>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Failure</th>
                <th>Cases</th>
                <th>Severity</th>
                <th>Problem</th>
                <th>Recommended fix</th>
                <th>Component</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.failure_actions || summary?.failure_actions || []).length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    No open failure actions (evaluation Not run or no Fail results).
                  </td>
                </tr>
              ) : (
                (detail?.failure_actions || summary?.failure_actions || []).map((action) => (
                  <tr key={action.id}>
                    <td>
                      {action.criterion_id}
                      <div className="doc-sub">{action.category}</div>
                    </td>
                    <td>{(action.case_keys || []).join(", ") || "—"}</td>
                    <td>{action.severity || "—"}</td>
                    <td style={{ fontSize: 12 }}>{action.problem}</td>
                    <td style={{ fontSize: 12 }}>{action.recommended_fix || "—"}</td>
                    <td style={{ fontSize: 12 }}>{action.responsible_component || "—"}</td>
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

          <h4 style={{ marginTop: 18 }}>Paired regression comparison</h4>
          <div className="eval-controls">
            <label>
              Baseline
              <select
                value={compareBaseline}
                onChange={(e) => setCompareBaseline(e.target.value)}
              >
                <option value="">Select…</option>
                {pastEvals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id.slice(0, 8)} · {item.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Candidate
              <select
                value={compareCandidate}
                onChange={(e) => setCompareCandidate(e.target.value)}
              >
                <option value="">Select…</option>
                {pastEvals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id.slice(0, 8)} · {item.status}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={runCompare}>
              Compare runs
            </button>
          </div>
          {compareResult ? (
            <div style={{ marginTop: 12 }}>
              {"version_mismatch_warning" in compareResult &&
              compareResult.version_mismatch_warning ? (
                <div className="warn-box">{String(compareResult.version_mismatch_warning)}</div>
              ) : null}
              <p style={{ fontSize: 13 }}>
                Fixed: {String(compareResult.fixed ?? "—")} · Regressed:{" "}
                {String(compareResult.regressed ?? "—")} · Persistent fails:{" "}
                {Array.isArray(compareResult.persistent_failures)
                  ? compareResult.persistent_failures.length
                  : "—"}
              </p>
              <details>
                <summary>Raw compare payload</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                  {JSON.stringify(compareResult, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="panel">
          <h3>Iteration history</h3>
          <p className="doc-sub">
            Each Run Evaluation freezes an immutable snapshot. Trends use the same reference dataset
            when available.
          </p>
          <div className="eval-controls" style={{ marginBottom: 12 }}>
            <label>
              Criterion trend
              <select
                value={trendCriterion}
                onChange={(e) => setTrendCriterion(e.target.value)}
              >
                {["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"].map((cid) => (
                  <option key={cid} value={cid}>
                    {cid}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {history.length >= 2 ? (
            <svg viewBox="0 0 320 120" width="100%" height="120" className="eval-trend-chart">
              <polyline
                fill="none"
                stroke="var(--forest)"
                strokeWidth="2"
                points={history
                  .map((point, index) => {
                    const rate = point.criteria?.[trendCriterion]?.rate;
                    const x = (index / Math.max(history.length - 1, 1)) * 300 + 10;
                    const y =
                      rate == null ? 110 : 110 - (Math.max(0, Math.min(100, rate)) / 100) * 100;
                    return `${x},${y}`;
                  })
                  .join(" ")}
              />
            </svg>
          ) : (
            <p className="doc-sub">Run at least two evaluations to plot criterion trends.</p>
          )}
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>When</th>
                <th>Health</th>
                <th>Critical</th>
                <th>{trendCriterion} rate</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    No saved iterations yet.
                  </td>
                </tr>
              ) : (
                [...history].reverse().map((point) => (
                  <tr key={point.evaluation_run_id}>
                    <td>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setEvalId(point.evaluation_run_id)}
                      >
                        {point.evaluation_run_id.slice(0, 8)}
                      </button>
                    </td>
                    <td>{(point.created_at || "").slice(0, 19)}</td>
                    <td>{point.health_score ?? "—"}</td>
                    <td>{point.critical_failures ?? "—"}</td>
                    <td>
                      {point.criteria?.[trendCriterion]?.rate != null
                        ? `${point.criteria[trendCriterion].rate}%`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "plan" ? (
        <div className="panel">
          <h3>Production evaluation plan</h3>
          <div className="eval-block">
            <strong>Automated evaluation</strong>
            <p>
              {(summary?.production_plan || detail?.summary.production_plan)?.automated ||
                "Source integrity, quote existence, version/page checks, screenshot presence, missing elements, and deterministic citation checks."}
            </p>
          </div>
          <div className="eval-block">
            <strong>Expert evaluation</strong>
            <p>
              {(summary?.production_plan || detail?.summary.production_plan)?.expert ||
                "Technical mapping validity, claim interpretation, Full/Partial/No label accuracy, and essentiality-related legal judgment remain human-gated."}
            </p>
          </div>
          <div className="eval-block">
            <strong>Regression evaluation</strong>
            <p>
              {(summary?.production_plan || detail?.summary.production_plan)?.regression ||
                "Rerun the frozen human-verified dataset after model, prompt, retrieval, or mapping changes."}
            </p>
          </div>
          <div className="eval-block">
            <strong>Quality gates</strong>
            <p>
              {(summary?.production_plan || detail?.summary.production_plan)?.quality_gates ||
                "Critical evidence failures block attorney-ready status. Expert sign-off remains required for substantive conclusions."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

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

type EvalSummary = {
  status_note?: string;
  attorney_ready?: boolean;
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
  limitations?: string[];
  baselines?: Record<string, string>;
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
    }>;
    payload: Record<string, unknown>;
  }>;
  dataset: { id: string; version: string; status_label: string; provisional: number | boolean };
  snapshot: { output_stage: string; chart_hash: string; run_id: string };
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
  const [tab, setTab] = useState<"results" | "reference" | "failures">("results");
  const [datasetId, setDatasetId] = useState("expected-claim1-v1");
  const [evalId, setEvalId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvalDetail | null>(null);
  const [template, setTemplate] = useState<EvalSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedCaseKey, setSelectedCaseKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [compareBaseline, setCompareBaseline] = useState("");
  const [compareCandidate, setCompareCandidate] = useState("");
  const [compareResult, setCompareResult] = useState<Record<string, unknown> | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pastEvals, setPastEvals] = useState<Array<{ id: string; status: string; run_id: string }>>(
    []
  );
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [uploading, setUploading] = useState(false);

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

  useEffect(() => {
    api<EvalSummary>("/api/evaluations/template")
      .then(setTemplate)
      .catch(() => setTemplate(null));
    api<Array<{ id: string; status: string; run_id: string }>>("/api/evaluation-runs")
      .then(setPastEvals)
      .catch(() => setPastEvals([]));
    api("/api/evaluation-datasets/import", { method: "POST" })
      .then(async () => {
        await api(`/api/evaluation-datasets/${datasetId}/files/attach-default`, {
          method: "POST"
        }).catch(() => undefined);
        await refreshReferenceFiles(datasetId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshReferenceFiles(datasetId);
  }, [datasetId]);

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
      const body = new FormData();
      body.append("file", file);
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
    if (item.case_type !== "reference_row") return false;
    if (filter === "all") return true;
    const statuses = item.criteria.map((c) => c.adjudicated_status || c.automatic_status);
    if (filter === "failures") return statuses.includes("Fail");
    if (filter === "needs_review") return statuses.includes("Needs review");
    if (filter === "evidence")
      return item.criteria.some(
        (c) =>
          ["C02", "C03", "C04"].includes(c.criterion_id) &&
          ["Fail", "Needs review"].includes(c.adjudicated_status || c.automatic_status)
      );
    if (filter === "label")
      return item.criteria.some(
        (c) =>
          c.criterion_id === "C06" &&
          (c.adjudicated_status || c.automatic_status) === "Fail"
      );
    if (filter === "missing") return !item.generated_label;
    return true;
  });

  const runEvaluation = async () => {
    if (!activeRunId) {
      onNotice("Select a completed analysis run first.");
      return;
    }
    setRunning(true);
    onNotice(null);
    try {
      const created = await api<EvalDetail>("/api/evaluation-runs", {
        method: "POST",
        body: JSON.stringify({
          run_id: activeRunId,
          dataset_id: datasetId
        })
      });
      setEvalId(created.id);
      setDetail(created);
      setSelectedCaseKey(created.cases.find((c) => c.case_type === "reference_row")?.case_key || null);
      setPastEvals(await api("/api/evaluation-runs"));
      onNotice(
        "Latest chart matched to reference. Automated quality metrics ready — expert review still pending."
      );
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setRunning(false);
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
          <h1 className="page-title">Evaluations</h1>
          <p className="page-sub">
            Match the latest chart output to the attached reference and track product quality
            metrics.
          </p>
        </div>
        <div className="eval-controls">
          <label>
            Analysis run (latest chart)
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
            Reference dataset
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="expected-claim1-v1">Claim 1 reference v1 (provisional)</option>
            </select>
          </label>
          <button className="primary" disabled={running || !activeRunId} onClick={runEvaluation}>
            {running ? "Matching…" : "Match latest output to reference"}
          </button>
          <button
            className="ghost"
            disabled={!evalId}
            onClick={() => evalId && window.open(`/api/evaluation-runs/${evalId}/export`, "_blank")}
          >
            Export evaluation bundle
          </button>
        </div>
      </div>

      <div className="panel eval-reference-panel">
        <div className="eval-reference-head">
          <div>
            <h3>Reference file</h3>
            <p className="doc-sub">
              Attach the expected claim chart (PDF or pack companion). You can remove and add
              files. Evaluation always compares the <strong>latest</strong> chart revision.
            </p>
          </div>
          <div className="eval-reference-actions">
            <button type="button" className="secondary" onClick={() => void attachDefaultPdf()}>
              Attach Expected_Claim1_Chart.pdf
            </button>
            <label className="secondary eval-upload-btn">
              {uploading ? "Uploading…" : "Upload reference"}
              <input
                type="file"
                accept=".pdf,.xlsx,.json,application/pdf"
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
          <strong>Patent</strong> {setup.patent?.identifier || "—"}
        </div>
        <div>
          <strong>Scope</strong> Claim 1 · H.265 chart rows (other claims/standards: Reference not
          available)
        </div>
        <div>
          <strong>Reference</strong>{" "}
          <span className="eval-chip eval-review">
            {detail?.dataset.status_label ||
              "Provisional technical reference; no SEP expert/attorney sign-off"}
          </span>
        </div>
        <div>
          <strong>Compare mode</strong> Latest chart vs attached reference
        </div>
        <div>
          <strong>Status</strong> {topStatus}
        </div>
        {h265Runs.length === 0 ? (
          <div className="warn-box" style={{ gridColumn: "1 / -1" }}>
            No completed H.265 run yet. Evaluations against the Claim 1 reference require an H.265
            V10 chart snapshot.
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
            <span className="doc-sub">{metrics?.headline?.health_label || "Not scored"}</span>
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
        {(["results", "reference", "failures"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {id === "results"
              ? "Results"
              : id === "reference"
                ? "Reference & rubric"
                : "Failures & regressions"}
          </button>
        ))}
      </div>

      {tab === "results" ? (
        <>
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>Criterion summary</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
              No weighted overall score. Pending cases are not counted as passes. Always-Partial
              baseline: {summary?.always_partial_baseline || "3/3"}. Full map P/R:{" "}
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
              <h3 style={{ margin: 0 }}>Row results</h3>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="failures">Failures</option>
                <option value="needs_review">Needs review</option>
                <option value="evidence">Evidence issues</option>
                <option value="label">Label disagreement</option>
                <option value="missing">Missing output</option>
              </select>
            </div>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Claim element</th>
                  <th>Reference label</th>
                  <th>Generated label</th>
                  <th>C01</th>
                  <th>C02</th>
                  <th>C03</th>
                  <th>C04</th>
                  <th>C05</th>
                  <th>C06</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: "var(--muted)" }}>
                      {detail ? "No rows match this filter." : "Not run — no invented metrics."}
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((row) => {
                    const byId = Object.fromEntries(
                      row.criteria.map((c) => [c.criterion_id, c.adjudicated_status || c.automatic_status])
                    );
                    return (
                      <tr
                        key={row.id}
                        className={selectedCaseKey === row.case_key ? "eval-selected" : ""}
                        onClick={() => setSelectedCaseKey(row.case_key)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{row.case_key}</td>
                        <td>{row.reference_label || "—"}</td>
                        <td>
                          {Array.isArray(row.generated_label)
                            ? row.generated_label.join(", ")
                            : row.generated_label || "—"}
                        </td>
                        {["C01", "C02", "C03", "C04", "C05", "C06"].map((cid) => (
                          <td key={cid}>
                            <StatusChip value={byId[cid]} />
                          </td>
                        ))}
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
              <h4>Grader findings</h4>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th>Automatic</th>
                    <th>Reason</th>
                    <th>Adjudicated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCase.criteria.map((crit) => (
                    <tr key={crit.id}>
                      <td>{crit.criterion_id}</td>
                      <td>
                        <StatusChip value={crit.automatic_status} />
                      </td>
                      <td style={{ fontSize: 12 }}>{crit.automatic_reason}</td>
                      <td>
                        <StatusChip value={crit.adjudicated_status} />
                      </td>
                      <td>
                        <div className="eval-adj-actions">
                          <button className="ghost" onClick={() => adjudicate(crit.id, "Pass")}>
                            Confirm
                          </button>
                          <button className="ghost" onClick={() => adjudicate(crit.id, "Fail")}>
                            Override Fail
                          </button>
                          <button
                            className="ghost"
                            onClick={() => adjudicate(crit.id, "Needs review")}
                          >
                            Specialist
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <h4>Six criteria</h4>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Pass condition</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.reference_payload.criteria || []).map((c) => (
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
          <h3>Observed failure types</h3>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
                <th>Hypothesis</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.observed_failures || []).length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>
                    No observed failures yet (evaluation Not run or no Fail results).
                  </td>
                </tr>
              ) : (
                (summary?.observed_failures || []).map((fail, index) => (
                  <tr key={index}>
                    <td>{fail.name || fail.criterion_id || "—"}</td>
                    <td>{fail.count}</td>
                    <td>{fail.root_cause_hypothesis || fail.note || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <h4 style={{ marginTop: 18 }}>Planned risk cases (not observed statistics)</h4>
          <ul>
            {(
              detail?.reference_payload.planned_risk_cases || [
                { title: "Evidence integrity failure" },
                { title: "Semantic overclaim" },
                { title: "Lost condition or numeric branch" }
              ]
            ).map((item, index) => (
              <li key={index}>{String((item as { title?: string }).title || item)}</li>
            ))}
          </ul>

          <h4>Paired regression comparison</h4>
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
              Compare with run
            </button>
          </div>
          {compareResult ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(compareResult, null, 2)}
            </pre>
          ) : null}

          <h4>Synthetic robustness tests</h4>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            Kept separate from natural chart accuracy. Corruption fixtures (wrong page, mutated
            numeric token, missing screenshot, stale revision) are planned detector checks — not
            blended into the six-criterion pass rates above.
          </p>
        </div>
      ) : null}
    </section>
  );
}

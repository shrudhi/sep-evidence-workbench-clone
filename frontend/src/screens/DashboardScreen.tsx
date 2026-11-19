import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../components/HelpTooltip";
import SkeletonBlock from "../components/SkeletonBlock";
import { api } from "../api";

type Props = {
  projectId: string;
  onOpenReview: (args: { runId: string; rowId?: string }) => void;
  onOpenCharts: (runId: string) => void;
  onOpenConclusion: (runId: string) => void;
  onNotice: (message: string | null) => void;
};

type DashboardPayload = {
  period: string;
  email: { configured: boolean; message?: string | null };
  metrics: Record<
    string,
    { value: number | null; definition: string }
  >;
  review_queue: Array<{
    run_id: string;
    patent?: string;
    family?: string;
    edition?: string;
    waiting_since: string;
    priority: number;
    issue_count: number;
    issues: Array<{
      id: string;
      element_id: string;
      element_label?: string;
      reason_label: string;
      reason_text: string;
      priority: number;
      waiting_since: string;
      assigned_reviewer?: string | null;
      deep_link: string;
    }>;
  }>;
  needs_attention: Array<{
    id: string;
    run_id?: string | null;
    kind: string;
    reason: string;
    action_hint?: string;
    created_at: string;
  }>;
  analyses: Array<{
    run_id: string;
    patent?: string;
    family?: string;
    edition?: string;
    processing_stage: string;
    rows_processed: number;
    rows_total: number;
    pending_review_count: number;
    verification_status: string;
    human_review_status: string;
    started_at: string;
    processing_duration_seconds?: number | null;
    delivery_status: string;
    export_status: string;
    error?: string | null;
  }>;
  supporting_metrics: Record<string, unknown>;
  empty?: boolean;
};

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function MetricCard({
  label,
  value,
  definition
}: {
  label: string;
  value: string;
  definition: string;
}) {
  return (
    <div className="dash-metric">
      <div className="dash-metric-label">
        {label}
        {definition ? <HelpTooltip text={definition} /> : null}
      </div>
      <div className="dash-metric-value">{value}</div>
    </div>
  );
}

export default function DashboardScreen({
  projectId,
  onOpenReview,
  onOpenCharts,
  onOpenConclusion,
  onNotice
}: Props) {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("7d");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [queueFilter, setQueueFilter] = useState("all");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [showSupporting, setShowSupporting] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<DashboardPayload>(
        `/api/dashboard?period=${period}&project_id=${encodeURIComponent(projectId)}`
      );
      setData(next);
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, projectId, onNotice]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const filteredQueue = useMemo(() => {
    if (!data) return [];
    return data.review_queue
      .map((group) => {
        const issues =
          queueFilter === "all"
            ? group.issues
            : queueFilter === "oldest"
              ? [...group.issues].sort((a, b) =>
                  a.waiting_since.localeCompare(b.waiting_since)
                )
              : group.issues.filter((issue) => {
                  const code = issue.reason_label.toLowerCase();
                  if (queueFilter === "mapping") return code.includes("mapping");
                  if (queueFilter === "disagreement") return code.includes("disagreement");
                  if (queueFilter === "evidence") return code.includes("evidence");
                  if (queueFilter === "challenge") return code.includes("challenge");
                  return true;
                });
        return { ...group, issues };
      })
      .filter((group) => group.issues.length > 0)
      .sort((a, b) =>
        queueFilter === "oldest"
          ? a.waiting_since.localeCompare(b.waiting_since)
          : b.priority - a.priority
      );
  }, [data, queueFilter]);

  const metrics = data?.metrics;
  const supporting = data?.supporting_metrics || {};

  return (
    <section className="dashboard">
      <div className="eval-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            What needs review, what is blocked, what is running, and what is complete.
          </p>
        </div>
        <div className="eval-controls">
          <label>
            Period
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as typeof period)}
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </label>
          <button className="ghost" disabled={loading} onClick={() => refresh()}>
            {loading ? "Refreshing…" : "Refresh dashboard"}
          </button>
        </div>
      </div>

      {!data?.email?.configured ? (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          Email not configured. Analysis, dashboard, and downloads still work — messages are not
          sent until EMAIL_PROVIDER is set.
        </div>
      ) : null}

      {loading && !data ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <SkeletonBlock variant="page" label="Loading dashboard" />
          <p className="doc-sub" style={{ marginBottom: 0 }}>
            Loading workspace metrics…
          </p>
        </div>
      ) : null}

      <div className="dash-metrics">
        <MetricCard
          label="Rows awaiting review"
          value={loading && !metrics ? "…" : String(metrics?.rows_awaiting_review.value ?? "—")}
          definition={metrics?.rows_awaiting_review.definition || ""}
        />
        <MetricCard
          label="Analyses needing attention"
          value={String(metrics?.analyses_needing_attention.value ?? "—")}
          definition={metrics?.analyses_needing_attention.definition || ""}
        />
        <MetricCard
          label="Completed in period"
          value={String(metrics?.analyses_completed.value ?? "—")}
          definition={metrics?.analyses_completed.definition || ""}
        />
        <MetricCard
          label="Median time to review-ready"
          value={formatDuration(metrics?.median_time_to_review_ready_seconds.value)}
          definition={metrics?.median_time_to_review_ready_seconds.definition || ""}
        />
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="eval-row-toolbar">
          <h3 style={{ margin: 0 }}>Review queue</h3>
          <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}>
            <option value="all">All pending</option>
            <option value="mapping">Mapping uncertainty</option>
            <option value="disagreement">Reviewer disagreement</option>
            <option value="evidence">Evidence verification issue</option>
            <option value="challenge">Analyst challenge</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        {filteredQueue.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {data?.empty
              ? "No analyses yet. Start from Setup when you are ready."
              : "No pending review items for this filter."}
          </p>
        ) : (
          filteredQueue.map((group) => (
            <div key={group.run_id} className="dash-queue-group">
              <button
                type="button"
                className="dash-queue-head"
                onClick={() =>
                  setExpandedRun((current) => (current === group.run_id ? null : group.run_id))
                }
              >
                <strong>
                  {group.patent || "Project"} · {group.family} {group.edition}
                </strong>
                <span>
                  {group.issue_count} issue{group.issue_count === 1 ? "" : "s"} · waiting since{" "}
                  {new Date(group.waiting_since).toLocaleString()}
                </span>
              </button>
              {expandedRun === group.run_id || filteredQueue.length === 1 ? (
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Claim element</th>
                      <th>Review reason</th>
                      <th>Priority</th>
                      <th>Waiting since</th>
                      <th>Assigned</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.issues.map((issue) => (
                      <tr key={issue.id}>
                        <td>{issue.element_label || "—"}</td>
                        <td>
                          <div>{issue.reason_label}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {issue.reason_text}
                          </div>
                        </td>
                        <td>{issue.priority}</td>
                        <td>{new Date(issue.waiting_since).toLocaleString()}</td>
                        <td>{issue.assigned_reviewer || "—"}</td>
                        <td>
                          <button
                            className="primary"
                            onClick={() =>
                              onOpenReview({ runId: group.run_id, rowId: issue.element_id })
                            }
                          >
                            Review row
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Needs attention</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          Operational failures only. Mapping that needs expert interpretation appears in the review
          queue, not here.
        </p>
        {(data?.needs_attention || []).length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No open system issues.</p>
        ) : (
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Reason</th>
                <th>Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.needs_attention.map((item) => (
                <tr key={item.id}>
                  <td>{item.kind}</td>
                  <td>{item.reason}</td>
                  <td>{new Date(item.created_at).toLocaleString()}</td>
                  <td>
                    {item.run_id ? (
                      <button className="ghost" onClick={() => onOpenCharts(item.run_id!)}>
                        {item.action_hint || "Open issue"}
                      </button>
                    ) : (
                      item.action_hint || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Analyses</h3>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Project / patent</th>
              <th>Standard</th>
              <th>Stage</th>
              <th>Rows</th>
              <th>Pending review</th>
              <th>Verification</th>
              <th>Human review</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Delivery</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.analyses || []).length === 0 ? (
              <tr>
                <td colSpan={11} style={{ color: "var(--muted)" }}>
                  No analysis history yet.
                </td>
              </tr>
            ) : (
              data?.analyses.map((row) => (
                <tr key={row.run_id}>
                  <td>{row.patent || "—"}</td>
                  <td>
                    {row.family}
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{row.edition}</div>
                  </td>
                  <td>{row.processing_stage}</td>
                  <td>
                    {row.rows_total
                      ? `${row.rows_processed} / ${row.rows_total}`
                      : `${row.rows_processed} / —`}
                  </td>
                  <td>{row.pending_review_count}</td>
                  <td>{row.verification_status}</td>
                  <td>{row.human_review_status}</td>
                  <td>{new Date(row.started_at).toLocaleString()}</td>
                  <td>{formatDuration(row.processing_duration_seconds)}</td>
                  <td>{row.delivery_status}</td>
                  <td>
                    <div className="eval-adj-actions">
                      <button className="ghost" onClick={() => onOpenCharts(row.run_id)}>
                        Open
                      </button>
                      <button className="ghost" onClick={() => onOpenReview({ runId: row.run_id })}>
                        Review flagged
                      </button>
                      <button
                        className="ghost"
                        title="Open SEP Report to download the claim chart deliverable for this run"
                        onClick={() => onOpenConclusion(row.run_id)}
                      >
                        SEP Report
                      </button>
                      <a
                        className="ghost"
                        href={`/api/runs/${row.run_id}/export-bundle`}
                        title="Download the delivery ZIP (claim chart + supporting artifacts) for this run"
                      >
                        Download bundle
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <button className="ghost" onClick={() => setShowSupporting((value) => !value)}>
          {showSupporting ? "Hide" : "Show"} supporting metrics
        </button>
        {showSupporting ? (
          <div className="dash-supporting">
            <div>
              <strong>First-pass verification</strong>
              <div>
                {String(
                  (supporting.first_pass_verification_rate as { display?: string })?.display || "—"
                )}
              </div>
            </div>
            <div>
              <strong>Revision acceptance</strong>
              <div>
                {String(
                  (supporting.revision_acceptance_rate as { display?: string })?.display || "—"
                )}
              </div>
            </div>
            <div>
              <strong>Median model cost / completed</strong>
              <div>
                {(supporting.median_model_cost_per_completed_analysis_usd as { value?: number })
                  ?.value != null
                  ? `$${(supporting.median_model_cost_per_completed_analysis_usd as { value: number }).value.toFixed(4)}`
                  : "—"}
              </div>
            </div>
            <div>
              <strong>Oldest pending review</strong>
              <div>
                {supporting.oldest_pending_review_at
                  ? new Date(String(supporting.oldest_pending_review_at)).toLocaleString()
                  : "—"}
              </div>
            </div>
            <div>
              <strong>Active human-review time</strong>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                {(
                  supporting.median_active_human_review_time_seconds as { label?: string }
                )?.label || "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

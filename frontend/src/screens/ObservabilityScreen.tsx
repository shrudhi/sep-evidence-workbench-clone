import { useEffect, useMemo, useState } from "react";
import HelpTooltip from "../components/HelpTooltip";
import SkeletonBlock from "../components/SkeletonBlock";
import { api } from "../api";
import type { RunSummary } from "../types";

type Props = {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onNotice: (message: string | null) => void;
};

type TimelineEvent = {
  id: number;
  created_at?: string;
  event_type?: string;
  state?: string;
  category?: string;
  tool_name?: string | null;
  model_name?: string | null;
  prompt_hash?: string | null;
  latency_ms?: number | null;
  error?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  arguments?: unknown;
  result?: unknown;
};

type ObservabilityReport = {
  run: {
    id: string;
    status?: string;
    family?: string;
    edition?: string;
    created_at?: string;
    updated_at?: string;
    error?: string | null;
    verification_status?: string;
    human_review_status?: string;
  };
  summary: {
    event_count: number;
    error_count: number;
    model_calls: number;
    tool_events: number;
    handoff_events: number;
    latency_ms_total: number;
    latency_ms_max?: number | null;
    latency_ms_avg?: number | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    actual_cost_usd: number;
    estimated_cost_usd: number;
    by_event_type: Record<string, number>;
    by_state: Record<string, number>;
    by_tool: Record<string, number>;
    by_model: Record<string, number>;
    by_category: Record<string, number>;
    audit_event_count: number;
  };
  timeline: TimelineEvent[];
  errors: TimelineEvent[];
  handoffs: TimelineEvent[];
  ops_audit: Array<{
    id: number;
    event_type: string;
    created_at?: string;
    payload?: unknown;
  }>;
  independence_note?: string;
};

const CATEGORY_CLASS: Record<string, string> = {
  model: "eval-pass",
  tool: "eval-review",
  handoff: "eval-muted",
  error: "eval-fail",
  other: "eval-muted"
};

function formatMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUsd(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function shortJson(value: unknown, max = 220) {
  if (value == null) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function ObservabilityScreen({
  runs,
  activeRunId,
  onSelectRun,
  onNotice
}: Props) {
  const [report, setReport] = useState<ObservabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"timeline" | "errors" | "handoffs" | "audit">("timeline");

  const chartRuns = useMemo(
    () =>
      runs.filter((run) =>
        [
          "complete",
          "analyst_review",
          "failed",
          "awaiting_target_confirm",
          "mapping",
          "reviewing",
          "selecting"
        ].includes(run.status)
      ),
    [runs]
  );

  useEffect(() => {
    if (!activeRunId) {
      setReport(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const next = await api<ObservabilityReport>(
          `/api/runs/${activeRunId}/observability`
        );
        if (!cancelled) {
          setReport(next);
          setSelectedId(next.timeline[0]?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setReport(null);
          onNotice((error as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const handle = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [activeRunId, onNotice]);

  const filteredTimeline = useMemo(() => {
    const rows = report?.timeline || [];
    return rows.filter((event) => {
      if (categoryFilter !== "all" && event.category !== categoryFilter) return false;
      if (stateFilter !== "all" && event.state !== stateFilter) return false;
      if (query.trim()) {
        const hay = [
          event.event_type,
          event.tool_name,
          event.model_name,
          event.error,
          shortJson(event.result, 400),
          shortJson(event.arguments, 400)
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [report, categoryFilter, stateFilter, query]);

  const selected =
    report?.timeline.find((e) => e.id === selectedId) ||
    filteredTimeline[0] ||
    null;

  const states = useMemo(() => {
    const keys = Object.keys(report?.summary.by_state || {});
    return keys.sort();
  }, [report]);

  const summary = report?.summary;

  return (
    <section className="evaluations obs-screen">
      <div className="internal-purpose-banner" role="note">
        <strong>Internal only.</strong> Run traces for debugging (steps, tools, latency, errors).
        Separate from Evaluation scoring — not an attorney-facing deliverable or essentiality
        opinion.
      </div>

      <div className="eval-header">
        <div>
          <h1 className="page-title">Observability</h1>
          <p className="page-sub">
            Inspect what the agents did: steps, tool calls, model usage, latency, and errors. Use
            Evaluation for C01–C06 quality gates.
          </p>
        </div>
        <div className="eval-controls">
          <label>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Chart / selection run
              <HelpTooltip text="Pick the selection or chart run whose persisted execution timeline you want to inspect." />
            </span>
            <select
              value={activeRunId || ""}
              onChange={(event) => onSelectRun(event.target.value)}
            >
              <option value="">Select a run…</option>
              {chartRuns.map((run) => (
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
          <button
            className="ghost"
            disabled={!activeRunId}
            onClick={() =>
              activeRunId && window.open(`/api/runs/${activeRunId}/trace`, "_blank")
            }
          >
            Download run trace
          </button>
        </div>
      </div>

      {!activeRunId ? (
        <div className="panel">
          <p className="doc-sub" style={{ margin: 0 }}>
            Select a run to inspect its execution timeline. Only measured metrics are shown.
          </p>
        </div>
      ) : loading && !report ? (
        <div className="panel">
          <SkeletonBlock variant="panel" label="Loading observability" />
          <p className="doc-sub" style={{ marginBottom: 0 }}>
            Loading run timeline…
          </p>
        </div>
      ) : !report ? (
        <div className="panel">
          <p className="doc-sub" style={{ margin: 0 }}>
            No execution trace recorded for this run yet.
          </p>
        </div>
      ) : (
        <>
          <div className="eq-meta panel">
            <div>
              <span className="doc-sub">Run</span>
              <strong>{report.run.id.slice(0, 8)}</strong>
            </div>
            <div>
              <span className="doc-sub">Status</span>
              <strong>{report.run.status}</strong>
            </div>
            <div>
              <span className="doc-sub">Target</span>
              <strong>
                {(report.run.family || "—") + " " + (report.run.edition || "")}
              </strong>
            </div>
            <div>
              <span className="doc-sub">Verification</span>
              <strong>{report.run.verification_status || "—"}</strong>
            </div>
            <div>
              <span className="doc-sub">Human review</span>
              <strong>{report.run.human_review_status || "—"}</strong>
            </div>
          </div>

          <div className="dash-metrics" style={{ marginBottom: 14 }}>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Events <HelpTooltip text="Count of persisted timeline events for this run." />
              </div>
              <div className="dash-metric-value">{summary?.event_count ?? "—"}</div>
            </div>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Latency total{" "}
                <HelpTooltip text="Sum of measured model-call latency across the run." />
              </div>
              <div className="dash-metric-value">
                {formatMs(summary?.latency_ms_total)}
              </div>
            </div>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Tokens <HelpTooltip text="Total tokens reported by model calls in this run." />
              </div>
              <div className="dash-metric-value">
                {(summary?.total_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Actual cost{" "}
                <HelpTooltip text="Provider-reported actual_cost_usd from usage records — not an estimate." />
              </div>
              <div className="dash-metric-value">
                {formatUsd(summary?.actual_cost_usd)}
              </div>
            </div>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Errors <HelpTooltip text="Timeline events that recorded an error payload." />
              </div>
              <div className="dash-metric-value">{summary?.error_count ?? 0}</div>
            </div>
            <div className="dash-metric">
              <div className="dash-metric-label">
                Model · tool · handoff{" "}
                <HelpTooltip text="Breakdown of model calls, tool invocations, and agent handoffs." />
              </div>
              <div className="dash-metric-value" style={{ fontSize: 18 }}>
                {summary?.model_calls ?? 0} · {summary?.tool_events ?? 0} ·{" "}
                {summary?.handoff_events ?? 0}
              </div>
            </div>
          </div>

          <p className="doc-sub" style={{ marginTop: 0 }}>
            {report.independence_note}
          </p>

          <div className="eval-tabs" role="tablist">
            {(
              [
                ["timeline", "Timeline"],
                ["errors", `Errors (${summary?.error_count ?? 0})`],
                ["handoffs", "Handoffs / steps"],
                ["audit", `Ops audit (${summary?.audit_event_count ?? 0})`]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "timeline" ? (
            <div className="eq-split">
              <div className="panel">
                <div className="eval-row-toolbar">
                  <strong>Execution timeline</strong>
                  <div className="eq-filters">
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="all">All categories</option>
                      <option value="model">Model calls</option>
                      <option value="tool">Tools / reviews</option>
                      <option value="handoff">Handoffs</option>
                      <option value="error">Errors</option>
                      <option value="other">Other</option>
                    </select>
                    <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                      <option value="all">All states</option>
                      {states.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                    <input
                      type="search"
                      placeholder="Search events…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>State</th>
                      <th>Tool / model</th>
                      <th>Latency</th>
                      <th>Tokens</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTimeline.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="doc-sub">
                          No events match filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTimeline.map((event) => (
                        <tr
                          key={event.id}
                          className={selected?.id === event.id ? "eval-selected" : ""}
                        >
                          <td className="doc-sub">
                            {(event.created_at || "").replace("T", " ").slice(0, 19)}
                          </td>
                          <td>
                            <span
                              className={`eval-chip ${
                                CATEGORY_CLASS[event.category || "other"] || "eval-muted"
                              }`}
                            >
                              {event.event_type}
                            </span>
                          </td>
                          <td>{event.state || "—"}</td>
                          <td>
                            {event.tool_name || "—"}
                            {event.model_name ? (
                              <div className="doc-sub">{event.model_name}</div>
                            ) : null}
                            {event.error ? (
                              <div className="eval-chip eval-fail">error</div>
                            ) : null}
                          </td>
                          <td>{formatMs(event.latency_ms)}</td>
                          <td>{event.total_tokens ?? "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setSelectedId(event.id)}
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="panel eq-detail">
                {selected ? (
                  <>
                    <h3 style={{ marginTop: 0 }}>
                      Event #{selected.id} · {selected.event_type}
                    </h3>
                    <div className="eq-crit-grid">
                      <div>
                        <span className="doc-sub">State</span>
                        <p>{selected.state || "—"}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Category</span>
                        <p>{selected.category || "—"}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Tool</span>
                        <p>{selected.tool_name || "—"}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Model</span>
                        <p>{selected.model_name || "—"}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Latency</span>
                        <p>{formatMs(selected.latency_ms)}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Cost (actual)</span>
                        <p>{formatUsd(selected.actual_cost_usd)}</p>
                      </div>
                      <div>
                        <span className="doc-sub">Tokens (prompt / completion / total)</span>
                        <p>
                          {selected.prompt_tokens ?? "—"} / {selected.completion_tokens ?? "—"} /{" "}
                          {selected.total_tokens ?? "—"}
                        </p>
                      </div>
                      <div>
                        <span className="doc-sub">Prompt hash</span>
                        <p className="doc-sub">{selected.prompt_hash || "—"}</p>
                      </div>
                    </div>
                    {selected.error ? (
                      <div className="eval-block eq-fail-block">
                        <strong>Error</strong>
                        <p>{selected.error}</p>
                      </div>
                    ) : null}
                    <div className="eval-block">
                      <span className="doc-sub">Arguments</span>
                      <pre className="obs-pre">{shortJson(selected.arguments, 4000)}</pre>
                    </div>
                    <div className="eval-block">
                      <span className="doc-sub">Result summary</span>
                      <pre className="obs-pre">{shortJson(selected.result, 4000)}</pre>
                    </div>
                  </>
                ) : (
                  <p className="doc-sub">Select an event for detail.</p>
                )}
              </div>
            </div>
          ) : null}

          {tab === "errors" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Errors &amp; exceptions</h3>
              {(report.errors || []).length === 0 ? (
                <p className="doc-sub">No error events on this run.</p>
              ) : (
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>State</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((event) => (
                      <tr key={event.id}>
                        <td>{(event.created_at || "").slice(0, 19)}</td>
                        <td>{event.event_type}</td>
                        <td>{event.state}</td>
                        <td>{event.error || shortJson(event.result, 200)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {report.run.error ? (
                <div className="eval-block eq-fail-block" style={{ marginTop: 12 }}>
                  <strong>Run-level error</strong>
                  <p>{report.run.error}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "handoffs" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Agent handoffs &amp; step transitions</h3>
              <p className="doc-sub">
                Selection → decompose → map → judge rework/verify → AI review → analyst accept.
              </p>
              <div className="eq-crit-grid" style={{ marginBottom: 12 }}>
                {Object.entries(summary?.by_state || {}).map(([state, count]) => (
                  <div key={state} className="eval-block">
                    <span className="doc-sub">{state}</span>
                    <p style={{ margin: 0 }}>
                      <strong>{count}</strong> events
                    </p>
                  </div>
                ))}
              </div>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>State</th>
                    <th>Tool</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.handoffs || []).map((event) => (
                    <tr key={event.id}>
                      <td className="doc-sub">{(event.created_at || "").slice(0, 19)}</td>
                      <td>{event.event_type}</td>
                      <td>{event.state}</td>
                      <td>{event.tool_name || "—"}</td>
                      <td className="doc-sub">{shortJson(event.result, 160)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 style={{ marginTop: 16 }}>Models used</h4>
              <ul>
                {Object.entries(summary?.by_model || {}).map(([model, count]) => (
                  <li key={model}>
                    <code>{model}</code> · {count} call{count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
              <h4>Tools</h4>
              <ul>
                {Object.entries(summary?.by_tool || {}).map(([tool, count]) => (
                  <li key={tool}>
                    <code>{tool}</code> · {count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "audit" ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Ops audit</h3>
              <p className="doc-sub">
                Delivery eligibility, apply-fix, and other operational decisions — not evaluation
                scores.
              </p>
              {(report.ops_audit || []).length === 0 ? (
                <p className="doc-sub">No ops audit events for this run yet.</p>
              ) : (
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ops_audit.map((item) => (
                      <tr key={item.id}>
                        <td className="doc-sub">{(item.created_at || "").slice(0, 19)}</td>
                        <td>{item.event_type}</td>
                        <td>
                          <pre className="obs-pre">{shortJson(item.payload, 500)}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

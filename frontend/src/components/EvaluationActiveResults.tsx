import { useMemo, useState } from "react";
import IterationTrendChart from "./IterationTrendChart";
import {
  H265_EVAL_DASHBOARD,
  filterEvalRows,
  type RowFilterTab
} from "../data/h265EvaluationDashboard";
import {
  CRITERION_META,
  FROZEN_BASELINE,
  ITERATION_HISTORY,
  deltaVsPrevious,
  formatDelta,
  type CriterionId,
  type IterationRun
} from "../data/evaluationIterationHistory";

type Props = {
  runs?: IterationRun[];
  activeRunId: string;
  onSelectRun: (id: string) => void;
  onDownloadRun?: (runId: string) => void;
  workspaceTab: "scorecard" | "history";
};

function statusClass(status: string) {
  if (status === "Ready") return "evd-pill-ready";
  if (status === "Needs Work") return "evd-pill-needs";
  return "evd-pill-blocker";
}

const SHORT_FILTERS: Array<{ id: RowFilterTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "blockers", label: "Blockers" },
  { id: "false_no_maps", label: "False No-Maps" }
];

export default function EvaluationActiveResults({
  runs = ITERATION_HISTORY,
  activeRunId,
  onSelectRun,
  onDownloadRun,
  workspaceTab
}: Props) {
  const [rowTab, setRowTab] = useState<RowFilterTab>("all");
  const [criterionFilter, setCriterionFilter] = useState<string | null>(null);
  const [auditRowId, setAuditRowId] = useState<string | null>(null);

  const activeIndex = Math.max(0, runs.findIndex((r) => r.id === activeRunId));
  const active = runs[activeIndex] || runs[runs.length - 1];

  const scorecards = useMemo(() => {
    return active.criteria.map((c) => {
      const meta = CRITERION_META.find((m) => m.id === c.id);
      const delta = formatDelta(deltaVsPrevious(runs, activeIndex, c.id));
      return {
        ...c,
        shortName: meta?.name || c.name,
        delta
      };
    });
  }, [active, activeIndex, runs]);

  const auditRows = useMemo(
    () => filterEvalRows(H265_EVAL_DASHBOARD.rows, rowTab, criterionFilter),
    [rowTab, criterionFilter]
  );

  if (workspaceTab === "history") {
    return (
      <div className="eq-workspace-panel">
        <IterationTrendChart
          runs={runs}
          activeRunId={active.id}
          onSelectRun={onSelectRun}
        />
        <div className="eq-history-table-wrap">
          <table className="eq-history-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Run ID</th>
                <th>Change Note</th>
                {CRITERION_META.map((m) => (
                  <th key={m.id} className="evd-mono">
                    {m.id}
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((run) => {
                const idx = runs.findIndex((r) => r.id === run.id);
                return (
                  <tr
                    key={run.id}
                    className={run.id === active.id ? "is-active" : undefined}
                  >
                    <td className="evd-mono">{run.timestamp}</td>
                    <td className="evd-mono">{run.shortId}</td>
                    <td className="eq-history-note">{run.changeNote}</td>
                    {CRITERION_META.map((m) => {
                      const crit = run.criteria.find((c) => c.id === m.id)!;
                      const delta = formatDelta(
                        deltaVsPrevious(runs, idx, m.id as CriterionId)
                      );
                      return (
                        <td key={m.id}>
                          <div className="evd-mono">{crit.rate.toFixed(1)}%</div>
                          {delta.tone !== "flat" ? (
                            <div className={`eq-delta eq-delta-${delta.tone}`}>
                              {delta.text}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                    <td>
                      <div className="eq-history-actions">
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => onSelectRun(run.id)}
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => onDownloadRun?.(run.id)}
                        >
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="doc-sub" style={{ marginTop: 10 }}>
          🔒 Locked to {FROZEN_BASELINE.id} v{FROZEN_BASELINE.version} — identical ground truth
          across plotted runs.
        </p>
      </div>
    );
  }

  return (
    <div className="eq-workspace-panel">
      <div className="eq-score-grid eq-score-grid-compact">
        {scorecards.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`eq-score-card eq-score-card-compact ${statusClass(c.status)} ${
              criterionFilter === c.id ? "is-active" : ""
            }`}
            onClick={() =>
              setCriterionFilter((prev) => (prev === c.id ? null : c.id))
            }
            title={`Filter rows that failed ${c.id}`}
          >
            <div className="eq-score-top">
              <span className="evd-mono eq-score-id">{c.id}</span>
              <span className={`evd-pill ${statusClass(c.status)}`}>{c.status}</span>
            </div>
            <div className="eq-score-name">{c.shortName}</div>
            <div className="eq-score-rate">
              {c.rate.toFixed(1)}
              <span className="eq-score-pct">%</span>
            </div>
            <div className="eq-score-row">
              <span className="evd-mono">
                {c.pass}/{c.total}
              </span>
              <span className={`eq-delta eq-delta-${c.delta.tone}`}>{c.delta.text}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="eq-audit-block">
        <div className="eq-audit-head">
          <h3>Row audit</h3>
          <div className="eq-filter-pills">
            {SHORT_FILTERS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={rowTab === tab.id ? "active" : ""}
                onClick={() => setRowTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {criterionFilter ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setCriterionFilter(null)}
              >
                Clear {criterionFilter}
              </button>
            ) : null}
          </div>
        </div>

        <div className="eq-history-table-wrap">
          <table className="eq-history-table eq-audit-table">
            <thead>
              <tr>
                <th>Element</th>
                <th>Ref</th>
                <th>Agent → Expected</th>
                <th>Failed</th>
                <th>Root cause</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => (
                <tr key={row.id} className={auditRowId === row.id ? "is-active" : undefined}>
                  <td className="evd-mono">{row.id}</td>
                  <td className="evd-mono">{row.alignedRef}</td>
                  <td className="evd-mono">
                    {row.agentLabel} → {row.expectedLabel}
                  </td>
                  <td className="evd-mono">{row.failed.join(", ")}</td>
                  <td>{row.tag}</td>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        setAuditRowId((prev) => (prev === row.id ? null : row.id))
                      }
                    >
                      {auditRowId === row.id ? "Hide" : "Note"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {auditRowId ? (
          <aside className="eq-audit-note">
            {H265_EVAL_DASHBOARD.rows.find((r) => r.id === auditRowId)?.note}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

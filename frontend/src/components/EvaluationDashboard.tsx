import { useMemo, useState } from "react";
import {
  H265_EVAL_DASHBOARD,
  filterEvalRows,
  type CriterionCard,
  type EvalRow,
  type RowFilterTab
} from "../data/h265EvaluationDashboard";

type Props = {
  /** Optional override; defaults to locked H.265 claim-chart evaluation pack. */
  data?: typeof H265_EVAL_DASHBOARD;
};

const SHEET_DOWNLOAD_URL = "/api/evaluation-dashboard/h265/export.xlsx";

function statusClass(status: CriterionCard["status"]) {
  if (status === "Ready") return "evd-pill-ready";
  if (status === "Needs Work") return "evd-pill-needs";
  return "evd-pill-blocker";
}

function toneClass(tone: string) {
  if (tone === "safe") return "evd-tone-safe";
  if (tone === "ok") return "evd-tone-ok";
  if (tone === "warn") return "evd-tone-warn";
  if (tone === "bad") return "evd-tone-bad";
  return "evd-tone-muted";
}

function labelMatchClass(agent: string, expected: string) {
  if (agent === expected) return "evd-label-match";
  return "evd-label-mismatch";
}

export default function EvaluationDashboard({ data = H265_EVAL_DASHBOARD }: Props) {
  const [criterionFilter, setCriterionFilter] = useState<string | null>(null);
  const [rowTab, setRowTab] = useState<RowFilterTab>("all");
  const [auditRowId, setAuditRowId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const meta = data.metadata;
  const rows = data.rows;

  const readyCount = data.criteria.filter((c) => c.status === "Ready").length;
  const blockerCount = data.criteria.filter((c) => c.status === "Blocker").length;
  const needsCount = data.criteria.filter((c) => c.status === "Needs Work").length;
  const gateProgress = Math.round((readyCount / Math.max(data.criteria.length, 1)) * 100);

  const downloadSheet = async () => {
    setDownloadError(null);
    setDownloadProgress(8);
    let tick: number | undefined;
    try {
      tick = window.setInterval(() => {
        setDownloadProgress((prev) => {
          if (prev == null || prev >= 88) return prev;
          return prev + 6;
        });
      }, 180);

      const response = await fetch(SHEET_DOWNLOAD_URL);
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }
      setDownloadProgress(92);
      const blob = await response.blob();
      setDownloadProgress(98);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const disposition = response.headers.get("content-disposition") || "";
      const match = /filename="?([^"]+)"?/i.exec(disposition);
      anchor.href = url;
      anchor.download = match?.[1] || data.source || "H265_Claim_Chart_Evaluation.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadProgress(100);
      window.setTimeout(() => setDownloadProgress(null), 900);
    } catch (error) {
      setDownloadError((error as Error).message || "Could not download spreadsheet.");
      setDownloadProgress(null);
    } finally {
      if (tick != null) window.clearInterval(tick);
    }
  };

  const tabCounts = useMemo(
    () => ({
      all: rows.length,
      blockers: rows.filter((r) => r.failed.length > 0).length,
      false_no_maps: rows.filter((r) => r.tag === "False Negative").length,
      accidental: rows.filter((r) => r.tag.toLowerCase().includes("accidental")).length,
      attorney: rows.filter((r) => r.attorneyReview).length
    }),
    [rows]
  );

  const visibleRows = useMemo(
    () => filterEvalRows(rows, rowTab, criterionFilter),
    [rows, rowTab, criterionFilter]
  );

  const auditRow: EvalRow | null = useMemo(
    () => rows.find((r) => r.id === auditRowId) || null,
    [rows, auditRowId]
  );

  const toggleCriterion = (id: string) => {
    setCriterionFilter((prev) => (prev === id ? null : id));
    setRowTab("all");
  };

  const tabs: Array<{ id: RowFilterTab; label: string; count: number }> = [
    { id: "all", label: "All Rows", count: tabCounts.all },
    { id: "blockers", label: "Blockers", count: tabCounts.blockers },
    { id: "false_no_maps", label: "False No-Maps", count: tabCounts.false_no_maps },
    { id: "accidental", label: "Accidental Matches", count: tabCounts.accidental },
    { id: "attorney", label: "Needs Attorney Review", count: tabCounts.attorney }
  ];

  return (
    <div className="evd-dashboard">
      {/* 1 — Release gate banner */}
      <header className="evd-gate" role="status">
        <div className="evd-gate-main">
          <div className="evd-gate-kicker">Release gate</div>
          <h2 className="evd-gate-title">{meta.releaseStatus}</h2>
          <div className="evd-meta-row">
            <div>
              <span className="evd-meta-label">Patent</span>
              <span className="evd-mono">{meta.patent}</span>
            </div>
            <div>
              <span className="evd-meta-label">Target standard</span>
              <span className="evd-mono">{meta.target}</span>
            </div>
            <div>
              <span className="evd-meta-label">Evaluated elements</span>
              <span>
                <strong className="evd-mono">{meta.evaluatedElements}</strong>
                <span className="evd-meta-quiet">
                  {" "}
                  aligned to {meta.groundTruthElements} ground-truth compound elements
                </span>
              </span>
            </div>
            <div>
              <span className="evd-meta-label">Source pack</span>
              <span className="evd-mono">{data.source}</span>
            </div>
          </div>
        </div>
        <div className="evd-gate-side">
          <span className="evd-safe-badge">{meta.safeOverClaimBadge}</span>
          <div className="evd-gate-progress" aria-label="Criterion readiness progress">
            <div className="evd-gate-progress-label">
              <span>Criterion readiness</span>
              <span className="evd-mono">
                {readyCount}/{data.criteria.length} Ready · {blockerCount} Blocker
                {needsCount ? ` · ${needsCount} Needs Work` : ""}
              </span>
            </div>
            <div className="evd-progress-track">
              <div
                className="evd-progress-fill evd-progress-ready"
                style={{ width: `${gateProgress}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            className="primary evd-download-btn"
            disabled={downloadProgress != null && downloadProgress < 100}
            onClick={() => void downloadSheet()}
          >
            {downloadProgress != null && downloadProgress < 100
              ? "Preparing spreadsheet…"
              : "Download evaluation sheet (.xlsx)"}
          </button>
          {downloadProgress != null ? (
            <div className="evd-download-progress" aria-live="polite">
              <div className="evd-gate-progress-label">
                <span>Building {data.source}</span>
                <span className="evd-mono">{downloadProgress}%</span>
              </div>
              <div className="evd-progress-track">
                <div
                  className="evd-progress-fill evd-progress-download"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          ) : null}
          {downloadError ? <p className="evd-download-error">{downloadError}</p> : null}
          <p className="evd-gate-aside">
            No blended accuracy score. Gate on per-criterion readiness and deployment blockers.
          </p>
        </div>
      </header>

      {/* 2 — Per-criterion metric grid */}
      <section className="evd-section" aria-labelledby="evd-criteria-heading">
        <div className="evd-section-head">
          <h3 id="evd-criteria-heading">Per-criterion scorecard</h3>
          <p>Click a card to filter rows that failed that criterion.</p>
        </div>
        <div className="evd-crit-grid">
          {data.criteria.map((c) => {
            const active = criterionFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`evd-crit-card ${statusClass(c.status)} ${active ? "is-active" : ""}`}
                onClick={() => toggleCriterion(c.id)}
                aria-pressed={active}
              >
                <div className="evd-crit-top">
                  <span className="evd-mono evd-crit-id">{c.id}</span>
                  <span className={`evd-pill ${statusClass(c.status)}`}>{c.status}</span>
                </div>
                <div className="evd-crit-name">{c.name}</div>
                <div className="evd-crit-rate">
                  {c.rate.toFixed(1)}
                  <span className="evd-crit-pct">%</span>
                </div>
                <div className="evd-crit-count evd-mono">
                  {c.pass}/{c.total} pass
                </div>
                <p className="evd-crit-note">{c.note}</p>
              </button>
            );
          })}
        </div>
        {criterionFilter ? (
          <div className="evd-filter-chip">
            Filtering rows that failed <span className="evd-mono">{criterionFilter}</span>
            <button type="button" className="ghost" onClick={() => setCriterionFilter(null)}>
              Clear
            </button>
          </div>
        ) : null}
      </section>

      {/* 3 — Diagnostic split */}
      <section className="evd-split" aria-label="Diagnostic panels">
        <div className="evd-panel">
          <div className="evd-section-head">
            <h3>Failure mode attribution</h3>
            <p>Pipeline root causes across scored rows.</p>
          </div>
          <ul className="evd-bars">
            {data.failureModes.map((mode) => {
              const pct = mode.total ? (100 * mode.count) / mode.total : 0;
              return (
                <li key={mode.id}>
                  <div className="evd-bar-label">
                    <span>{mode.label}</span>
                    <span className="evd-mono">
                      {mode.count}/{mode.total}
                    </span>
                  </div>
                  <div className="evd-bar-track" aria-hidden>
                    <div className="evd-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="evd-panel">
          <div className="evd-section-head">
            <h3>Label alignment summary</h3>
            <p>
              Ground truth: <strong>{data.labelAlignment.groundTruth}</strong>
            </p>
          </div>
          <div className="evd-label-grid">
            {data.labelAlignment.items.map((item) => (
              <div key={item.id} className={`evd-label-card ${toneClass(item.tone)}`}>
                <div className="evd-label-count evd-mono">{item.count}</div>
                <div className="evd-label-name">{item.label}</div>
              </div>
            ))}
          </div>
          <p className="evd-label-footnote">
            Agent labels: 3 Valid Partial · 2 Accidental Partial · 3 False No-Map · 0 False Full-Map
          </p>
        </div>
      </section>

      {/* 4 — Row triage table */}
      <section className="evd-section evd-triage" aria-labelledby="evd-triage-heading">
        <div className="evd-section-head">
          <h3 id="evd-triage-heading">Row-level triage</h3>
          <p>Inspect element failures without leaving the dashboard.</p>
        </div>

        <div className="evd-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={rowTab === tab.id}
              className={rowTab === tab.id ? "active" : ""}
              onClick={() => setRowTab(tab.id)}
            >
              {tab.label} <span className="evd-mono">({tab.count})</span>
            </button>
          ))}
        </div>

        <div className="evd-table-wrap">
          <table className="evd-table">
            <thead>
              <tr>
                <th>Element ID</th>
                <th>Aligned Ref</th>
                <th>Agent vs Expected</th>
                <th>Failed Criteria</th>
                <th>Root Cause</th>
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="evd-empty">
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id} className={auditRowId === row.id ? "is-open" : ""}>
                    <td className="evd-mono">{row.id}</td>
                    <td className="evd-mono">{row.alignedRef}</td>
                    <td>
                      <span className={`evd-vs ${labelMatchClass(row.agentLabel, row.expectedLabel)}`}>
                        <span className="evd-mono">{row.agentLabel}</span>
                        <span className="evd-vs-sep">→</span>
                        <span className="evd-mono">{row.expectedLabel}</span>
                      </span>
                    </td>
                    <td>
                      <div className="evd-fail-badges">
                        {row.failed.map((cid) => (
                          <button
                            key={cid}
                            type="button"
                            className="evd-fail-badge"
                            onClick={() => toggleCriterion(cid)}
                            title={`Filter by ${cid}`}
                          >
                            {cid}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="evd-tag">{row.tag}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost evd-audit-btn"
                        onClick={() =>
                          setAuditRowId((prev) => (prev === row.id ? null : row.id))
                        }
                      >
                        {auditRowId === row.id ? "Hide note" : "Audit note"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {auditRow ? (
          <aside className="evd-drawer" aria-live="polite">
            <div className="evd-drawer-head">
              <div>
                <span className="evd-meta-label">Audit note</span>
                <h4 className="evd-mono">
                  {auditRow.id} · aligned {auditRow.alignedRef}
                </h4>
              </div>
              <button type="button" className="ghost" onClick={() => setAuditRowId(null)}>
                Close
              </button>
            </div>
            <div className="evd-drawer-body">
              <p>
                <strong>Root cause:</strong> {auditRow.tag}
              </p>
              <p>
                <strong>Agent:</strong>{" "}
                <span className="evd-mono">{auditRow.agentLabel}</span>
                {" · "}
                <strong>Expected:</strong>{" "}
                <span className="evd-mono">{auditRow.expectedLabel}</span>
              </p>
              <p>
                <strong>Failed:</strong>{" "}
                <span className="evd-mono">{auditRow.failed.join(", ")}</span>
              </p>
              <p className="evd-drawer-note">{auditRow.note}</p>
              {auditRow.attorneyReview ? (
                <span className="evd-pill evd-pill-needs">Needs attorney review</span>
              ) : (
                <span className="evd-pill evd-pill-blocker">Engineering blocker</span>
              )}
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  );
}

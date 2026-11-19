import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Chart, RunSummary, SetupBundle } from "../types";

type CandidateDecision = {
  document_id: string;
  disposition: string;
  rationale?: string;
};

type Props = {
  setup: SetupBundle;
  runs: RunSummary[];
  chart: Chart | null;
  onOpenCharts: (rowId?: string) => void;
  onExport: (final: boolean) => void | Promise<void>;
  onNotice?: (message: string | null) => void;
};

function humanStatus(run?: RunSummary) {
  if (!run) return "No run";
  return (
    run.status_label ||
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
    }[run.status] ||
      run.status)
  );
}

export default function SepReportScreen({
  setup,
  runs,
  chart,
  onOpenCharts,
  onExport
}: Props) {
  const [exporting, setExporting] = useState<"draft" | "final" | "bundle" | null>(null);
  const [selectionDecision, setSelectionDecision] = useState<{
    candidates?: CandidateDecision[];
  } | null>(null);

  useEffect(() => {
    const selectionRun =
      runs.find(
        (item) =>
          (item.selection_only || item.has_target_decision) && item.has_target_decision
      ) || runs.find((item) => item.has_target_decision);
    if (!selectionRun?.id) {
      setSelectionDecision(null);
      return;
    }
    let cancelled = false;
    void api<{
      target_decision?: { candidates?: CandidateDecision[] } | null;
    }>(`/api/runs/${selectionRun.id}`)
      .then((detail) => {
        if (!cancelled) setSelectionDecision(detail.target_decision || null);
      })
      .catch(() => {
        if (!cancelled) setSelectionDecision(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runs]);

  const latestRevisions =
    chart?.rows.map((row) => ({
      row,
      rev: row.revisions[row.revisions.length - 1]
    })) || [];
  const decidedCount = latestRevisions.filter((item) =>
    Boolean(item.rev?.analyst_disposition)
  ).length;
  const allDecided =
    latestRevisions.length > 0 && decidedCount === latestRevisions.length;

  const unresolved = latestRevisions.filter(
    (item) => !item.rev?.analyst_disposition
  );
  const accepted = latestRevisions.filter(
    (item) => item.rev?.analyst_disposition === "accept"
  ).length;
  const rejected = latestRevisions.filter(
    (item) => item.rev?.analyst_disposition === "reject"
  ).length;

  const run = chart?.run;
  const patentLabel =
    setup.patent?.identifier || setup.patent?.title || "Selected patent";
  const standardLabel = run
    ? [run.family, run.edition || run.title].filter(Boolean).join(" · ")
    : setup.standards.find((s) => setup.project.selected_standard_ids.includes(s.id))
        ?.edition || "No chart selected";

  const hasChart = Boolean(run?.id);

  const comparison = useMemo(() => {
    const candidates = selectionDecision?.candidates || [];
    if (!candidates.length) {
      return setup.standards
        .filter((s) => setup.project.selected_standard_ids.includes(s.id))
        .map((s) => ({
          id: s.id,
          label: s.version_label || s.edition || s.family,
          disposition:
            run?.target_document_id === s.id
              ? "charted"
              : setup.project.selected_standard_ids.includes(s.id)
                ? "candidate"
                : "—",
          rationale: ""
        }));
    }
    return candidates.map((c) => {
      const std = setup.standards.find((s) => s.id === c.document_id);
      const isCharted = run?.target_document_id === c.document_id;
      return {
        id: c.document_id,
        label: std?.version_label || std?.edition || std?.family || c.document_id,
        disposition: isCharted
          ? "charted"
          : c.disposition === "selected"
            ? "recommended"
            : c.disposition === "rejected"
              ? "rejected"
              : c.disposition || "—",
        rationale: c.rationale || ""
      };
    });
  }, [
    selectionDecision,
    setup.standards,
    setup.project.selected_standard_ids,
    run?.target_document_id
  ]);

  return (
    <section className="sep-report-screen">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title">SEP Report</h1>
          <p className="page-sub">
            Standard comparison, unresolved HITL items, and download of the claim-chart
            deliverable.
          </p>
        </div>
      </div>

      <div className="sep-report-meta panel">
        <div>
          <span className="doc-sub">Patent</span>
          <strong className="evd-mono">{patentLabel}</strong>
        </div>
        <div>
          <span className="doc-sub">Mapped standard</span>
          <strong>{standardLabel}</strong>
        </div>
        <div>
          <span className="doc-sub">Chart status</span>
          <strong>{humanStatus(run as RunSummary | undefined)}</strong>
        </div>
        <div>
          <span className="doc-sub">Run</span>
          <strong className="evd-mono">{run?.id ? run.id.slice(0, 8) : "—"}</strong>
        </div>
        <div>
          <span className="doc-sub">Analyst decisions</span>
          <strong className="evd-mono">
            {chart?.rows?.length
              ? `${decidedCount}/${chart.rows.length} (${accepted} accept · ${rejected} reject)`
              : "—"}
          </strong>
        </div>
      </div>

      {comparison.length ? (
        <div className="panel sep-report-compare">
          <h3>Standard comparison</h3>
          <p className="doc-sub" style={{ marginTop: 0 }}>
            Recommendation outcomes from Matter Setup versus the charted target.
          </p>
          <table className="sep-compare-table">
            <thead>
              <tr>
                <th>Standard</th>
                <th>Outcome</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.id} className={row.disposition === "charted" ? "is-charted" : ""}>
                  <td>
                    <strong>{row.label}</strong>
                  </td>
                  <td>
                    <span className={`sep-outcome-pill ${row.disposition}`}>
                      {row.disposition}
                    </span>
                  </td>
                  <td className="doc-sub">{row.rationale || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasChart && unresolved.length ? (
        <div className="panel sep-report-unresolved">
          <h3>Unresolved claim elements</h3>
          <p className="doc-sub" style={{ marginTop: 0 }}>
            {unresolved.length} element{unresolved.length === 1 ? "" : "s"} still need Accept or
            Reject before the reviewed final unlocks.
          </p>
          <ul className="sep-unresolved-list">
            {unresolved.map(({ row, rev }) => (
              <li key={row.id}>
                <strong className="evd-mono">{row.label}</strong>
                <span className="doc-sub">
                  {rev?.mapping_label || "No mapping"} · no analyst disposition
                </span>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => onOpenCharts(row.id)}
                >
                  Open in Claim charts →
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!hasChart ? (
        <div className="warn-box">
          No claim chart report is ready yet. Finish mapping on Claim charts, then return here to
          download.{" "}
          <button type="button" className="ghost" onClick={() => onOpenCharts()}>
            Open claim charts →
          </button>
        </div>
      ) : null}

      <div className="panel sep-report-download">
        <h3>Download created report</h3>
        <p className="doc-sub" style={{ marginTop: 0 }}>
          Landscape Word (.docx) in the assignment three-column format: Claim element · Standard
          evidence · Rationale and mapping
          {run?.id ? (
            <>
              {" "}
              · run <span className="evd-mono">{run.id.slice(0, 8)}</span>
            </>
          ) : null}
          .
        </p>

        <div className="sep-download-actions">
          <button
            type="button"
            className="primary"
            disabled={!hasChart || exporting != null}
            title="Download a draft Word claim chart (.docx) for the open run."
            onClick={async () => {
              setExporting("draft");
              try {
                await onExport(false);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "draft" ? "Preparing draft…" : "Download draft claim chart (.docx)"}
          </button>

          <button
            type="button"
            className="secondary"
            disabled={!hasChart || exporting != null || !allDecided}
            title={
              allDecided
                ? "Download the reviewed final Word claim chart (.docx)."
                : `Reviewed final is locked until every claim element has an Accept or Reject disposition (${decidedCount}/${chart?.rows?.length || 0} decided).`
            }
            onClick={async () => {
              setExporting("final");
              try {
                await onExport(true);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "final" ? "Preparing final…" : "Download reviewed final (.docx)"}
          </button>

          <button
            type="button"
            className="ghost"
            disabled={!hasChart || exporting != null}
            title="Download the delivery bundle (ZIP) for this run."
            onClick={() => {
              if (!run?.id) return;
              setExporting("bundle");
              window.open(`/api/runs/${run.id}/export-bundle`, "_blank");
              window.setTimeout(() => setExporting(null), 600);
            }}
          >
            {exporting === "bundle" ? "Opening bundle…" : "Download delivery bundle (.zip)"}
          </button>
        </div>

        {!allDecided && chart?.rows?.length ? (
          <p className="doc-sub" style={{ marginBottom: 0 }}>
            Reviewed final unlocks after an analyst disposition on every element (
            {decidedCount}/{chart.rows.length} decided).{" "}
            <button type="button" className="linkish" onClick={() => onOpenCharts()}>
              Continue on Claim charts
            </button>
          </p>
        ) : null}

        <p className="doc-sub sep-report-disclaimer">
          Draft exports may still list unresolved rows. This report is not a legal essentiality
          determination.
        </p>
      </div>
    </section>
  );
}

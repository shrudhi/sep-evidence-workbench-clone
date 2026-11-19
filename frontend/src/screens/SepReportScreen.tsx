import { useMemo, useState } from "react";
import HelpTooltip from "../components/HelpTooltip";
import InlineSpinner from "../components/InlineSpinner";
import {
  analystDispositionLabel,
  chartReadinessCounts,
  isRowFinalReady
} from "../reviewReadiness";
import type { Chart, RunSummary, SetupBundle } from "../types";

type Props = {
  setup: SetupBundle;
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
  chart,
  onOpenCharts,
  onExport
}: Props) {
  const [exporting, setExporting] = useState<"draft" | "final" | "bundle" | null>(null);

  const rows = chart?.rows || [];
  const readiness = useMemo(() => chartReadinessCounts(rows), [rows]);
  const unresolved = rows.filter((row) => !isRowFinalReady(row));
  const finalReady = rows.length > 0 && unresolved.length === 0;

  const run = chart?.run;
  const patentLabel =
    setup.patent?.identifier || setup.patent?.title || "Selected patent";
  const standardLabel = run
    ? [run.family, run.edition || run.title].filter(Boolean).join(" · ")
    : setup.standards.find((s) => setup.project.selected_standard_ids.includes(s.id))
        ?.edition || "No chart selected";

  const hasChart = Boolean(run?.id);

  return (
    <section className="sep-report-screen">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title">SEP report</h1>
          <p className="page-sub">
            Resolve open rows, then download a draft or reviewed-final claim chart for this run.
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
          <span className="doc-sub label-with-help">
            Ready for final
            <HelpTooltip text="Counts rows that already have an analyst Accept or Reject. Reviewed final unlocks when every row is decided." />
          </span>
          <strong className="evd-mono">
            {rows.length
              ? `${readiness.analyst_done}/${rows.length} decided`
              : "—"}
          </strong>
        </div>
      </div>

      {hasChart && unresolved.length ? (
        <div className="panel sep-report-unresolved">
          <h3>Still needs an analyst decision</h3>
          <p className="doc-sub" style={{ marginTop: 0 }}>
            {unresolved.length} element{unresolved.length === 1 ? "" : "s"} still need Accept or
            Reject before the reviewed final unlocks.
          </p>
          <ul className="sep-unresolved-list">
            {unresolved.map((row) => {
              const rev = row.revisions[row.revisions.length - 1];
              return (
                <li key={row.id}>
                  <strong className="evd-mono">{row.label}</strong>
                  <span className="doc-sub">
                    {rev?.mapping_label || "No mapping"}
                    {analystDispositionLabel(row)
                      ? ` · ${analystDispositionLabel(row)}`
                      : " · Review pending"}
                  </span>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onOpenCharts(row.id)}
                  >
                    Open in claim charts
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!hasChart ? (
        <div className="warn-box">
          No claim chart is ready yet. Finish mapping on Claim charts, then return here to download.{" "}
          <button type="button" className="ghost" onClick={() => onOpenCharts()}>
            Open claim charts
          </button>
        </div>
      ) : null}

      <div className="panel sep-report-download">
        <h3>Downloads</h3>
        <p className="doc-sub" style={{ marginTop: 0 }}>
          Three-column Word chart: claim element · standard evidence · rationale and mapping
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
            title="Watermarked working copy you can share for internal review."
            onClick={async () => {
              setExporting("draft");
              try {
                await onExport(false);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "draft" ? (
              <>
                <InlineSpinner label="Preparing draft" /> Preparing draft…
              </>
            ) : (
              "Download draft (.docx)"
            )}
          </button>

          <button
            type="button"
            className="secondary"
            disabled={!hasChart || exporting != null || !finalReady}
            title={
              finalReady
                ? "Complete claim chart with every row decided by the analyst."
                : `Reviewed final unlocks when every row is Accepted or Rejected (${readiness.analyst_done}/${rows.length} ready).`
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
            {exporting === "final" ? (
              <>
                <InlineSpinner label="Preparing final" /> Preparing final…
              </>
            ) : (
              "Download reviewed final (.docx)"
            )}
          </button>

          <button
            type="button"
            className="ghost"
            disabled={!hasChart || exporting != null}
            title="ZIP package with chart artifacts for this run."
            onClick={() => {
              if (!run?.id) return;
              setExporting("bundle");
              window.open(`/api/runs/${run.id}/export-bundle`, "_blank");
              window.setTimeout(() => setExporting(null), 600);
            }}
          >
            {exporting === "bundle" ? (
              <>
                <InlineSpinner label="Opening bundle" /> Opening bundle…
              </>
            ) : (
              "Download delivery bundle (.zip)"
            )}
          </button>

          <button
            type="button"
            className="ghost"
            disabled={!hasChart || exporting != null}
            title="Saved execution trace: steps, tool calls, and decisions."
            onClick={() => {
              if (!run?.id) return;
              window.open(`/api/runs/${run.id}/trace`, "_blank");
            }}
          >
            Download run trace (.json)
          </button>
        </div>

        {!finalReady && rows.length ? (
          <p className="doc-sub" style={{ marginBottom: 0 }}>
            Reviewed final unlocks when every element is Accepted or Rejected (
            {readiness.analyst_done}/{rows.length} ready).{" "}
            <button type="button" className="linkish" onClick={() => onOpenCharts()}>
              Continue on claim charts
            </button>
          </p>
        ) : null}

        <p className="doc-sub sep-report-disclaimer">
          Drafts may still include unresolved rows. This report is not a legal essentiality
          determination.
        </p>
      </div>
    </section>
  );
}

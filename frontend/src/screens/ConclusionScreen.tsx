import { useState } from "react";
import { api } from "../api";
import type { Chart, RunSummary, SetupBundle } from "../types";

type Props = {
  setup: SetupBundle;
  runs: RunSummary[];
  chart: Chart | null;
  onOpenCharts: () => void;
  onExport: (final: boolean) => void;
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

export default function ConclusionScreen({
  setup,
  runs,
  chart,
  onOpenCharts,
  onExport,
  onNotice
}: Props) {
  const [sending, setSending] = useState(false);
  const selected = setup.standards.filter((item) =>
    setup.project.selected_standard_ids.includes(item.id)
  );
  const pickRun = (standardId: string) => {
    const matching = runs.filter((item) => item.target_document_id === standardId);
    return (
      matching.find((run) => ["analyst_review", "complete"].includes(run.status)) ||
      matching.find((run) => run.status !== "failed") ||
      matching[0]
    );
  };
  const runsByDoc = selected.map((standard) => {
    const run = pickRun(standard.id);
    return { standard, run };
  });
  const finished = runsByDoc.filter(
    ({ run }) => run && ["complete", "analyst_review"].includes(run.status)
  );
  const incomplete = finished.length < selected.length;
  const strongest =
    finished.find(({ run }) => run?.id === chart?.run.id)?.run || finished[0]?.run;

  return (
    <section>
      <h1 className="page-title">Your comparison, clearly explained.</h1>
      <p className="page-sub">Review the conclusion and export the selected claim charts.</p>

      <table className="comparison-table">
        <thead>
          <tr>
            <th>Standard</th>
            <th>Status</th>
            <th>Recommendation</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runsByDoc.map(({ standard, run }) => {
            const status = humanStatus(run);
            const isVideo = /h\.?265|hevc/i.test(standard.family || "");
            const isSpeech = /g\.?722/i.test(standard.family || "");
            const isLte = /136|36\.211|lte/i.test(standard.family || "");
            const recommendation = !run
              ? "Incomplete — no independent chart run"
              : run.status === "failed"
                ? "Failed (other charts remain usable)"
                : !["complete", "analyst_review"].includes(run.status)
                  ? "In progress"
                  : isVideo
                    ? "Primary candidate — video coding standard matching patent subject matter"
                    : isSpeech
                      ? "Rejected for primary mapping — speech codec, not video coding"
                      : isLte
                        ? "Rejected for primary mapping — LTE physical layer, not video coding"
                        : "Chart ready for analyst comparison";
            return (
              <tr key={standard.id}>
                <td>
                  <strong>{standard.family}</strong>
                  <div style={{ color: "var(--muted)", marginTop: 4 }}>{standard.edition}</div>
                </td>
                <td>{status}</td>
                <td>{recommendation}</td>
                <td>
                  <button className="ghost" onClick={onOpenCharts} disabled={!run}>
                    View chart ↗
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="conclusion-box">
        <h3>
          {incomplete
            ? `Waiting on ${selected.length - finished.length} selected standard(s). ${finished.length} chart(s) already ready for review.`
            : strongest
              ? `${finished.length} independent charts are ready for comparison. Use each chart’s evidence and Judge findings — do not treat readiness alone as essentiality.`
              : "No completed charts yet."}
        </h3>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          Recommendation must come from real searched evidence for the selected claims. Essentiality
          is not established by this report. Open each chart and verify Judge findings before export.
        </p>
      </div>

      {incomplete ? (
        <div className="warn-box">
          Unresolved findings: finish mapping and analyst decisions before treating the report as
          final.{" "}
          <button className="ghost" onClick={onOpenCharts}>
            Return to claim charts →
          </button>
        </div>
      ) : null}

      <div className="panel" style={{ marginTop: 14, maxWidth: 420 }}>
        <h3>Export chart bundle</h3>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Includes quotes, citations, source screenshots and review status when present. Export uses
          the currently open document chart
          {chart?.run.id ? ` (${chart.run.id.slice(0, 8)}…)` : ""}.
        </p>
        <button
          className="primary"
          style={{ width: "100%", marginBottom: 8 }}
          disabled={!chart?.run.id}
          onClick={() => {
            if (chart?.run.id) window.open(`/api/runs/${chart.run.id}/export-bundle`, "_blank");
            else onExport(false);
          }}
        >
          Download Word bundle ↓
        </button>
        <button
          className="secondary"
          style={{ width: "100%", marginBottom: 8 }}
          disabled={!chart?.run.id || sending}
          onClick={async () => {
            if (!chart?.run.id) return;
            setSending(true);
            try {
              const result = await api<{ email?: { status?: string; error?: string } }>(
                `/api/runs/${chart.run.id}/approve-and-send`,
                { method: "POST", body: "{}" }
              );
              const status = result.email?.status;
              onNotice?.(
                status === "provider_accepted" || status === "delivered"
                  ? `Approve and send: ${status}`
                  : status === "not_configured"
                    ? "Email not configured — bundle is ready to download, but nothing was sent."
                    : status
                      ? `Approve and send: ${status}${result.email?.error ? ` — ${result.email.error}` : ""}`
                      : "Approve and send: no provider response"
              );
            } catch (error) {
              onNotice?.((error as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? "Sending…" : "Approve and send"}
        </button>
        <button
          className="ghost"
          style={{ width: "100%", marginBottom: 8 }}
          disabled={!chart?.run.id || sending}
          onClick={async () => {
            if (!chart?.run.id) return;
            setSending(true);
            try {
              const result = await api<{ email?: { status?: string } }>(
                `/api/runs/${chart.run.id}/send-updated-report`,
                { method: "POST", body: "{}" }
              );
              const status = result.email?.status;
              onNotice?.(
                status
                  ? `Send updated report: ${status}`
                  : "Send updated report: no provider response"
              );
            } catch (error) {
              onNotice?.((error as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          Send updated report
        </button>
        <button
          className="secondary"
          style={{ width: "100%" }}
          disabled={!chart?.run.id}
          onClick={() => {
            if (chart?.run.id) window.open(`/api/runs/${chart.run.id}/trace`, "_blank");
          }}
        >
          Download run trace
        </button>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
          Unresolved findings remain marked in draft exports. Reviewed-final export requires every
          included row disposition. Automatically delivered reports say “AI-generated; automated
          checks passed.” “Human reviewed” appears only when approvals are recorded. Selecting a
          target standard does not prove patent essentiality.
        </p>
      </div>
    </section>
  );
}

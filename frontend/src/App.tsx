import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Activity,
  ClipboardCheck,
  FileSpreadsheet,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  X
} from "lucide-react";
import { api } from "./api";
import WorkflowStepper from "./components/WorkflowStepper";
import SetupScreen from "./screens/SetupScreen";
import ClaimChartsScreen from "./screens/ClaimChartsScreen";
import SepReportScreen from "./screens/SepReportScreen";
import EvaluationsScreen from "./screens/EvaluationsScreen";
import EvaluationQualityScreen from "./screens/EvaluationQualityScreen";
import ObservabilityScreen from "./screens/ObservabilityScreen";
import SettingsScreen from "./screens/SettingsScreen";
import type { Chart, Health, RunSummary, Screen, SetupBundle } from "./types";
import {
  computeWorkflowGates,
  isWorkflowScreen,
  toWorkflowStep,
  type WorkflowStepId
} from "./workflow";

const PROJECT_ID = "lumenci-assessment";

function readDeepLink() {
  const params = new URLSearchParams(window.location.search);
  return {
    runId: params.get("run"),
    rowId: params.get("row"),
    view: params.get("view") as Screen | "review" | null,
    projectId: params.get("project")
  };
}

export default function App() {
  const initialLink = readDeepLink();
  const [screen, setScreen] = useState<Screen>(
    initialLink.view === "review" || initialLink.view === "charts"
      ? "charts"
      : initialLink.view === "sep_report" || initialLink.view === "conclusion"
        ? "sep_report"
        : initialLink.view === "setup"
          ? "setup"
          : initialLink.view === "evaluations"
            ? "evaluations"
            : initialLink.view === "evaluations_legacy"
              ? "evaluations_legacy"
              : initialLink.view === "observability"
                ? "observability"
                : initialLink.view === "settings"
                  ? "settings"
                  : "setup"
  );
  const [setup, setSetup] = useState<SetupBundle | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(initialLink.runId);
  const [chart, setChart] = useState<Chart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [focusRowId, setFocusRowId] = useState<string | null>(initialLink.rowId);
  const [reviewMode, setReviewMode] = useState(initialLink.view === "review");
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Path A selection is separate from chart runs. Prefer awaiting/in-flight selection,
  // then any selection_only run that already has recommend/reject rationales.
  const isSelectionRun = (run: RunSummary) =>
    Boolean(run.selection_only) ||
    ["selecting", "awaiting_target_confirm"].includes(run.status) ||
    (run.has_target_decision === true &&
      ["complete", "awaiting_target_confirm"].includes(run.status) &&
      !["analyst_review", "mapping", "searching", "reviewing"].includes(run.status));
  const selectionRun =
    runs.find((run) => run.id === activeRunId && isSelectionRun(run)) ||
    runs.find((run) => run.status === "awaiting_target_confirm") ||
    runs.find((run) => ["queued", "selecting"].includes(run.status) && isSelectionRun(run)) ||
    runs.find((run) => run.selection_only && run.has_target_decision) ||
    runs.find((run) => run.selection_only);
  const selectionStatusForSetup = selectionRun
    ? {
        runId: selectionRun.id,
        status: selectionRun.status,
        statusLabel: selectionRun.status_label || selectionRun.status
      }
    : null;

  const refresh = useCallback(async () => {
    const [nextSetup, nextHealth, nextRuns] = await Promise.all([
      api<SetupBundle>(`/api/projects/${PROJECT_ID}/setup`),
      api<Health>("/api/health"),
      api<RunSummary[]>("/api/runs")
    ]);
    setSetup(nextSetup);
    setHealth(nextHealth);
    setRuns(nextRuns);
    setActiveRunId((current) => {
      if (current) return current;
      const preferredRun = nextRuns.find((run) =>
        ["awaiting_target_confirm", "analyst_review", "complete", "selecting"].includes(
          run.status
        )
      );
      return preferredRun?.id || nextSetup.project.active_run_id || null;
    });
  }, []);

  useEffect(() => {
    refresh().catch((error: Error) => setNotice(error.message));
  }, [refresh]);

  // Keep Setup selection status fresh even when the active chart run is different.
  useEffect(() => {
    if (screen !== "setup") return;
    const timer = window.setInterval(() => {
      api<RunSummary[]>("/api/runs")
        .then(setRuns)
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (!activeRunId) {
      setChart(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [nextChart, nextRuns] = await Promise.all([
          api<Chart>(`/api/runs/${activeRunId}/chart`),
          api<RunSummary[]>("/api/runs")
        ]);
        if (cancelled) return;
        setChart(nextChart);
        setRuns(nextRuns);
        const current = nextRuns.find((run) => run.id === activeRunId);
        if (current?.status === "failed" && current.error) {
          setNotice(`Analysis failed: ${current.error}`);
        } else {
          setNotice((prev) =>
            prev && /failed to fetch|networkerror|load failed/i.test(prev) ? null : prev
          );
        }
      } catch (error) {
        if (!cancelled) setNotice((error as Error).message);
      } finally {
        inFlight = false;
      }
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunId]);

  const patchProject = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setNotice(null);
    try {
      await api(`/api/projects/${PROJECT_ID}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetAutomation = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api(`/api/projects/${PROJECT_ID}/automation/override`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const startAnalysis = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const created = await api<{ id: string }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          session_id: crypto.randomUUID(),
          project_id: PROJECT_ID
        })
      });
      setActiveRunId(created.id);
      setScreen("setup");
      setNotice("Selection running — recommend / reject rationales will appear here when ready.");
      await refresh();
    } catch (error) {
      setNotice((error as Error).message || "Start analysis failed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setStarting(false);
    }
  };

  const confirmTargets = async (runId: string, documentIds: string[]) => {
    setConfirming(true);
    setNotice(null);
    try {
      const created = await api<{
        id: string;
        ids: string[];
        document_count: number;
        warning?: string | null;
      }>(`/api/runs/${runId}/confirm-targets`, {
        method: "POST",
        body: JSON.stringify({
          document_ids: documentIds,
          project_id: PROJECT_ID
        })
      });
      setActiveRunId(created.id);
      setScreen("charts");
      const params = new URLSearchParams({
        project: PROJECT_ID,
        run: created.id,
        view: "charts"
      });
      window.history.replaceState({}, "", `/?${params.toString()}`);
      setNotice(
        created.warning ||
          `Building claim chart${created.document_count > 1 ? "s" : ""} for ${created.document_count} standard${created.document_count > 1 ? "s" : ""}.`
      );
      await refresh();
    } catch (error) {
      setNotice((error as Error).message || "Confirm targets failed");
    } finally {
      setConfirming(false);
    }
  };

  const refreshChart = async () => {
    if (!activeRunId) return;
    setChart(await api<Chart>(`/api/runs/${activeRunId}/chart`));
  };

  const exportDoc = async (final: boolean) => {
    if (!activeRunId) return;
    const url = `/api/runs/${activeRunId}/export?final=${final}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        let detail = `Export failed (${response.status})`;
        try {
          const body = await response.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* ignore */
        }
        setNotice(detail);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = /filename="?([^"]+)"?/i.exec(disposition);
      const filename =
        match?.[1] ||
        (final ? "Claim1_chart_final.docx" : "Claim1_chart_draft.docx");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(
        final
          ? "Downloaded REVIEWED FINAL claim chart (.docx)."
          : "Downloaded DRAFT claim chart (.docx)."
      );
    } catch (error) {
      setNotice((error as Error).message || "Export failed");
    }
  };

  const openReview = (args: { runId: string; rowId?: string }) => {
    setActiveRunId(args.runId);
    setFocusRowId(args.rowId || null);
    setReviewMode(true);
    setScreen("charts");
    const params = new URLSearchParams({
      project: PROJECT_ID,
      run: args.runId,
      view: "review"
    });
    if (args.rowId) params.set("row", args.rowId);
    window.history.replaceState({}, "", `/?${params.toString()}`);
  };

  const projectName = setup?.project.name || "US10063856B2";

  const workflowGates = useMemo(
    () => computeWorkflowGates(setup, runs, chart),
    [setup, runs, chart]
  );
  const activeWorkflowStep = toWorkflowStep(screen);

  const goWorkflowStep = useCallback(
    (step: WorkflowStepId) => {
      if (!workflowGates[step].unlocked) {
        setNotice(workflowGates[step].lockReason || "This step is locked.");
        return;
      }
      if (step === "setup") {
        if (selectionRun) {
          const params = new URLSearchParams({
            project: PROJECT_ID,
            run: selectionRun.id,
            view: "setup"
          });
          window.history.replaceState({}, "", `/?${params.toString()}`);
        }
        setScreen("setup");
        return;
      }
      if (step === "charts") {
        setReviewMode(false);
        const preferred =
          runs.find((run) =>
            ["mapping", "reviewing", "searching", "decomposing", "queued"].includes(
              run.status
            )
          ) ||
          runs.find((run) => run.id === setup?.project.active_run_id) ||
          runs.find((run) => run.status === "analyst_review") ||
          runs.find((run) => run.status === "complete");
        if (preferred) {
          setActiveRunId(preferred.id);
          const params = new URLSearchParams({
            project: PROJECT_ID,
            run: preferred.id,
            view: "charts"
          });
          window.history.replaceState({}, "", `/?${params.toString()}`);
        }
        setScreen("charts");
        return;
      }
      setScreen("sep_report");
    },
    [workflowGates, selectionRun, runs, setup?.project.active_run_id]
  );

  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <nav className="nav" aria-label="Primary">
        <div className="nav-top">
          <p className="wordmark">{navCollapsed ? "LN" : "LexNorm"}</p>
          <button
            type="button"
            className="nav-collapse-btn"
            aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setNavCollapsed((value) => !value)}
          >
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {!navCollapsed ? (
          <button className="workspace-chip" type="button">
            {setup?.project.workspace_label || "LexNorm"}
          </button>
        ) : null}
        <div className="nav-list">
          <button
            className={`nav-item ${screen === "setup" ? "active" : ""} ${
              !workflowGates.setup.unlocked ? "is-locked" : ""
            }`}
            onClick={() => goWorkflowStep("setup")}
            disabled={!workflowGates.setup.unlocked}
            title="Setup — patent, claims, and target standard"
          >
            <Layers3 size={16} />
            {!navCollapsed ? "Setup" : null}
          </button>
          <button
            className={`nav-item ${screen === "charts" ? "active" : ""} ${
              !workflowGates.charts.unlocked ? "is-locked" : ""
            }`}
            onClick={() => goWorkflowStep("charts")}
            disabled={!workflowGates.charts.unlocked}
            title={
              workflowGates.charts.unlocked
                ? "Claim charts"
                : workflowGates.charts.lockReason
            }
          >
            <FileSpreadsheet size={16} />
            {!navCollapsed ? "Claim charts" : null}
          </button>
          <button
            className={`nav-item ${
              screen === "sep_report" || screen === "conclusion" ? "active" : ""
            } ${!workflowGates.sep_report.unlocked ? "is-locked" : ""}`}
            onClick={() => goWorkflowStep("sep_report")}
            disabled={!workflowGates.sep_report.unlocked}
            title={
              workflowGates.sep_report.unlocked
                ? "SEP Report — download the created claim chart report"
                : workflowGates.sep_report.lockReason
            }
          >
            <ScrollText size={16} />
            {!navCollapsed ? "SEP Report" : null}
          </button>
        </div>

        <div className="nav-section-divider" role="presentation">
          {!navCollapsed ? (
            <span className="nav-section-label">Internal only</span>
          ) : (
            <span className="nav-section-rule" aria-hidden />
          )}
        </div>

        <div className="nav-list nav-list-internal" aria-label="Internal tools">
          <button
            className={`nav-item ${
              screen === "evaluations" || screen === "evaluations_legacy" ? "active" : ""
            }`}
            onClick={() => setScreen("evaluations")}
            title="Evaluation — internal quality scoring only (not attorney-facing)"
          >
            <ClipboardCheck size={16} />
            {!navCollapsed ? (
              <span className="nav-item-stack">
                <span>Evaluation</span>
                <span className="nav-item-meta">Internal</span>
              </span>
            ) : null}
          </button>
          <button
            className={`nav-item ${screen === "observability" ? "active" : ""}`}
            onClick={() => setScreen("observability")}
            title="Observability — internal execution traces only (not attorney-facing)"
          >
            <Activity size={16} />
            {!navCollapsed ? (
              <span className="nav-item-stack">
                <span>Observability</span>
                <span className="nav-item-meta">Internal</span>
              </span>
            ) : null}
          </button>
        </div>

        <div className="nav-spacer" />
        <button
          className={`nav-item ${screen === "settings" ? "active" : ""}`}
          onClick={() => setScreen("settings")}
          title="Settings"
        >
          <Settings size={16} />
          {!navCollapsed ? "Settings" : null}
        </button>
        {!navCollapsed ? (
          <div className="analyst">
            <div className="avatar">SS</div>
            <span>{setup?.project.analyst_display_name || "Shrudhi Satya"}</span>
          </div>
        ) : null}
      </nav>

      <div className="main-column">
        <header className="topbar">
          <div className="crumbs">
            <span>Projects</span>
            <span className="crumb-sep">/</span>
            <strong>{projectName}</strong>
          </div>
          <div className="saved">
            <Check size={14} /> {setup?.project.save_status === "saved" ? "Saved" : "Saving"}
          </div>
        </header>

        {notice ? (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        ) : null}

        <div className="content">
          {setup && isWorkflowScreen(screen) && activeWorkflowStep ? (
            <WorkflowStepper
              activeStep={activeWorkflowStep}
              gates={workflowGates}
              onStepChange={goWorkflowStep}
              showNavButtons={false}
            />
          ) : null}
          {!setup ? (
            <div className="empty">Loading workspace…</div>
          ) : screen === "dashboard" ? (
            // Dashboard is WIP — keep Screen type & DashboardScreen.tsx for later.
            <div className="empty">
              Dashboard is temporarily hidden while we continue work. Use Setup to continue.
              <div style={{ marginTop: 12 }}>
                <button type="button" className="primary" onClick={() => setScreen("setup")}>
                  Go to Setup
                </button>
              </div>
            </div>
          ) : screen === "setup" ? (
            <SetupScreen
              setup={setup}
              health={health}
              saving={saving}
              starting={starting}
              confirming={confirming}
              onPatch={patchProject}
              onResetAutomation={resetAutomation}
              onStart={() => startAnalysis()}
              onConfirmTargets={confirmTargets}
              selectionStatus={selectionStatusForSetup}
              onRefresh={refresh}
              onNotice={setNotice}
            />
          ) : screen === "settings" ? (
            <SettingsScreen
              projectId={PROJECT_ID}
              automation={setup.automation}
              onSaved={refresh}
              onNotice={setNotice}
            />
          ) : screen === "charts" ? (
            <ClaimChartsScreen
              setup={setup}
              runs={runs}
              activeRunId={activeRunId}
              chart={chart}
              onSelectRun={setActiveRunId}
              onRefreshChart={refreshChart}
              focusRowId={focusRowId}
              reviewMode={reviewMode}
              onFocusRowConsumed={() => setFocusRowId(null)}
            />
          ) : screen === "sep_report" || screen === "conclusion" ? (
            <SepReportScreen
              setup={setup}
              runs={runs}
              chart={chart}
              onOpenCharts={(rowId) => {
                if (rowId) setFocusRowId(rowId);
                setScreen("charts");
              }}
              onExport={exportDoc}
              onNotice={setNotice}
            />
          ) : screen === "observability" ? (
            <ObservabilityScreen
              runs={runs}
              activeRunId={activeRunId}
              onSelectRun={setActiveRunId}
              onNotice={setNotice}
            />
          ) : screen === "evaluations_legacy" ? (
            <EvaluationsScreen
              setup={setup}
              runs={runs}
              activeRunId={activeRunId}
              onSelectRun={setActiveRunId}
              onNotice={setNotice}
            />
          ) : (
            <EvaluationQualityScreen
              setup={setup}
              runs={runs}
              activeRunId={activeRunId}
              onSelectRun={setActiveRunId}
              onNotice={setNotice}
            />
          )}
        </div>
      </div>
    </div>
  );
}

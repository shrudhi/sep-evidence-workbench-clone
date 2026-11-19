import type { Chart, RunSummary, Screen, SetupBundle } from "./types";

export type WorkflowStepId = "setup" | "charts" | "sep_report";

export type WorkflowStepDef = {
  id: WorkflowStepId;
  label: string;
  shortLabel: string;
  description: string;
};

export const WORKFLOW_STEPS: WorkflowStepDef[] = [
  {
    id: "setup",
    label: "Setup",
    shortLabel: "1",
    description: "Patent, claims, and target standard"
  },
  {
    id: "charts",
    label: "Claim Charts",
    shortLabel: "2",
    description: "Map evidence and decide Full / Partial / No"
  },
  {
    id: "sep_report",
    label: "Report",
    shortLabel: "3",
    description: "Download the created SEP claim chart report"
  }
];

export function isWorkflowScreen(screen: Screen): screen is WorkflowStepId | "conclusion" {
  return screen === "setup" || screen === "charts" || screen === "sep_report" || screen === "conclusion";
}

export function toWorkflowStep(screen: Screen): WorkflowStepId | null {
  if (screen === "setup") return "setup";
  if (screen === "charts") return "charts";
  if (screen === "sep_report" || screen === "conclusion") return "sep_report";
  return null;
}

export function hasChartRunData(runs: RunSummary[], chart: Chart | null): boolean {
  if (chart?.rows && chart.rows.length > 0) return true;
  return runs.some(
    (run) =>
      !run.selection_only &&
      ["mapping", "reviewing", "searching", "decomposing", "analyst_review", "complete"].includes(
        run.status
      )
  );
}

export function isSetupComplete(setup: SetupBundle | null, runs: RunSummary[]): boolean {
  if (!setup) return false;
  const project = setup.project;
  const hasPatent = Boolean(project.patent_input_id || setup.patent);
  const hasClaims =
    project.claim_scope === "all" || (project.selected_claim_numbers || []).length > 0;
  const hasStandards = (project.selected_standard_ids || []).length > 0;
  const hasTargetDecision = runs.some(
    (run) =>
      run.has_target_decision ||
      run.status === "awaiting_target_confirm" ||
      ["mapping", "reviewing", "analyst_review", "complete"].includes(run.status)
  );
  return (hasPatent && hasClaims && hasStandards) || hasTargetDecision;
}

/** Claim chart is created enough to enable Report. */
export function isClaimChartCreated(runs: RunSummary[], chart: Chart | null): boolean {
  if (chart?.rows && chart.rows.length > 0) return true;
  return runs.some(
    (run) =>
      !run.selection_only &&
      ["analyst_review", "complete", "reviewing"].includes(run.status)
  );
}

export type StepGate = {
  unlocked: boolean;
  completed: boolean;
  lockReason?: string;
};

export function computeWorkflowGates(
  setup: SetupBundle | null,
  runs: RunSummary[],
  chart: Chart | null
): Record<WorkflowStepId, StepGate> {
  const setupDone = isSetupComplete(setup, runs);
  const chartData = hasChartRunData(runs, chart);
  const chartCreated = isClaimChartCreated(runs, chart);

  return {
    setup: {
      unlocked: true,
      completed: setupDone
    },
    charts: {
      unlocked: setupDone || chartData,
      completed: chartCreated,
      lockReason: "Finish Setup (patent, claims, and target standard) or open a saved chart draft."
    },
    sep_report: {
      unlocked: chartCreated,
      completed: chartCreated && Boolean(chart?.rows?.length),
      lockReason: "Report unlocks once a claim chart has been created."
    }
  };
}

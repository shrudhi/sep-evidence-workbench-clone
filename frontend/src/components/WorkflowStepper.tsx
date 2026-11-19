import { Check, Lock } from "lucide-react";
import {
  WORKFLOW_STEPS,
  type StepGate,
  type WorkflowStepId
} from "../workflow";

type Props = {
  activeStep: WorkflowStepId;
  gates: Record<WorkflowStepId, StepGate>;
  onStepChange: (step: WorkflowStepId) => void;
  /** Optional footer Next/Back under the indicators */
  showNavButtons?: boolean;
};

export default function WorkflowStepper({
  activeStep,
  gates,
  onStepChange,
  showNavButtons = true
}: Props) {
  const activeIndex = WORKFLOW_STEPS.findIndex((s) => s.id === activeStep);

  const goRelative = (delta: number) => {
    const next = WORKFLOW_STEPS[activeIndex + delta];
    if (!next) return;
    if (!gates[next.id].unlocked) return;
    onStepChange(next.id);
  };

  const prev = WORKFLOW_STEPS[activeIndex - 1];
  const next = WORKFLOW_STEPS[activeIndex + 1];
  const canBack = Boolean(prev && gates[prev.id].unlocked);
  const canNext = Boolean(next && gates[next.id].unlocked);

  return (
    <div className="wf-stepper" role="navigation" aria-label="SEP workflow steps">
      <ol className="wf-track">
        {WORKFLOW_STEPS.map((step, index) => {
          const gate = gates[step.id];
          const isActive = step.id === activeStep;
          const isLocked = !gate.unlocked;
          const isComplete = gate.completed && !isActive;
          const connectorDone =
            index > 0 && gates[WORKFLOW_STEPS[index - 1].id].completed;

          let stateClass = "is-locked";
          if (isActive) stateClass = "is-active";
          else if (isComplete) stateClass = "is-complete";
          else if (gate.unlocked) stateClass = "is-ready";

          return (
            <li key={step.id} className={`wf-step ${stateClass}`}>
              {index > 0 ? (
                <div
                  className={`wf-connector ${connectorDone ? "is-done" : ""}`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                className="wf-step-btn"
                disabled={isLocked}
                aria-current={isActive ? "step" : undefined}
                aria-disabled={isLocked}
                title={
                  isLocked
                    ? gate.lockReason || "Complete the previous step to unlock"
                    : `${step.label}: ${step.description}`
                }
                onClick={() => {
                  if (!isLocked) onStepChange(step.id);
                }}
              >
                <span className="wf-badge" aria-hidden>
                  {isLocked ? (
                    <Lock size={14} strokeWidth={2.25} />
                  ) : isComplete || (gate.completed && isActive) ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <span className="wf-num">{step.shortLabel}</span>
                  )}
                </span>
                <span className="wf-copy">
                  <span className="wf-label">{step.label}</span>
                  <span className="wf-desc">{step.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {showNavButtons ? (
        <div className="wf-nav-row">
          <button
            type="button"
            className="ghost"
            disabled={!canBack}
            title={
              canBack
                ? `Back to ${prev?.label}`
                : "No previous unlocked step"
            }
            onClick={() => goRelative(-1)}
          >
            ← Back
          </button>
          <span className="wf-nav-hint doc-sub">
            {gates[activeStep].completed
              ? "Step has saved data — jump freely among unlocked steps."
              : next && !gates[next.id].unlocked
                ? gates[next.id].lockReason
                : "Unlocked steps keep your data when you switch."}
          </span>
          <button
            type="button"
            className="primary"
            disabled={!canNext}
            title={
              canNext
                ? `Continue to ${next?.label}`
                : next
                  ? gates[next.id].lockReason || "Next step is locked"
                  : "You are on the last step"
            }
            onClick={() => goRelative(1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

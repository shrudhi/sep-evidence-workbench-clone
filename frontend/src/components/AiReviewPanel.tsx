import type { AiReview, ChartRow } from "../types";

type Props = {
  row: ChartRow;
  review: AiReview | null | undefined;
  onEditRow: () => void;
  onTryAgain: () => void;
  busy?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  running: "Reviewing…",
  passed: "Passed",
  attention: "Needs attention",
  pending: "AI review pending",
  unavailable: "Review unavailable"
};

const CHECK_LABELS: Record<string, string> = {
  pass: "Passed",
  fail: "Failed",
  unverified: "Needs verification",
  na: "Not applicable"
};

export function aiReviewStatusLabel(review?: AiReview | null): string {
  if (!review) return "AI review pending";
  return STATUS_LABELS[review.status] || review.status;
}

export function aiReviewStatusKind(
  review?: AiReview | null
): "pass" | "fail" | "needs" | "incomplete" | "muted" {
  switch (review?.status) {
    case "passed":
      return "pass";
    case "attention":
      return "fail";
    case "pending":
      return "needs";
    case "unavailable":
      return "incomplete";
    case "running":
      return "muted";
    default:
      return "muted";
  }
}

export default function AiReviewPanel({
  row,
  review,
  onEditRow,
  onTryAgain,
  busy = false
}: Props) {
  const status = review?.status || "running";
  const label = STATUS_LABELS[status] || status;
  const reason =
    review?.reason ||
    (status === "running" ? "Checking this row." : "No review result yet.");
  const showTryAgain =
    status === "unavailable" ||
    status === "pending" ||
    review?.ai === "unavailable" ||
    review?.ai === "not_configured";
  const openChecks = (review?.checks || []).filter(
    (check) => check.status === "fail" || check.status === "unverified"
  );
  const nextStep =
    status === "attention"
      ? openChecks[0]?.id?.toLowerCase().includes("mapping")
        ? "Edit the mapping label or evidence so the label matches what the citations support."
        : openChecks[0]?.id?.toLowerCase().includes("quote") ||
            openChecks[0]?.id?.toLowerCase().includes("screenshot") ||
            openChecks[0]?.id?.toLowerCase().includes("edition")
          ? "Fix the citation/quote/screenshot, then save the row to re-run AI Review."
          : openChecks[0]?.id?.toLowerCase().includes("search")
            ? "Use Search again to find supporting passages, then save."
            : "Edit the row to fix the first failed check, then save to re-run AI Review."
      : status === "pending" || status === "unavailable"
        ? "Click Try again once the model is available."
        : null;

  return (
    <div className="ai-review-pane" role="region" aria-label={`AI review for ${row.label}`}>
      <header className="ai-review-header">
        <h3 tabIndex={-1} id="ai-review-title">
          AI review · {row.label}
        </h3>
        <p className={`ai-review-verdict kind-${aiReviewStatusKind(review)}`}>{label}</p>
        <p className="ai-review-reason">{reason}</p>
        {nextStep ? (
          <p className="ai-review-next">
            <strong>What to do:</strong> {nextStep}
          </p>
        ) : null}
      </header>

      <div className="row-action-group">
        {status === "attention" ? (
          <button type="button" className="secondary" onClick={onEditRow}>
            Edit row
          </button>
        ) : null}
        {showTryAgain ? (
          <button type="button" className="ghost" disabled={busy} onClick={onTryAgain}>
            Try again
          </button>
        ) : null}
      </div>

      {openChecks.length ? (
        <div className="ai-review-open-issues">
          <div className="evidence-label">Why this status</div>
          <ul className="ai-review-checks">
            {openChecks.map((check) => (
              <li key={`${check.id}-${check.status}-${check.reason.slice(0, 24)}`}>
                <strong>
                  {check.id} · {CHECK_LABELS[check.status] || check.status}
                </strong>
                <span>{check.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review?.checks?.length ? (
        <details className="ai-review-details" open={status === "attention"}>
          <summary>Review details</summary>
          <ul className="ai-review-checks">
            {review.checks.map((check) => (
              <li key={`${check.id}-${check.status}-${check.reason.slice(0, 24)}`}>
                <strong>
                  {check.id} · {CHECK_LABELS[check.status] || check.status}
                </strong>
                <span>{check.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

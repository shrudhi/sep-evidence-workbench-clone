import type {
  AiReview,
  AiReviewCheck,
  AiReviewRecommendation,
  ChartRow,
  EvidenceBlock
} from "../types";

type Props = {
  row: ChartRow;
  review: AiReview | null | undefined;
  busy?: boolean;
  analystName?: string;
  onViewEvidence: () => void;
  onAskAgent: () => void;
  onEdit: () => void;
  onRequestRevision: () => void;
  onRerun: () => void;
  onApplyFix: (changeIds?: string[]) => void;
};

/** Three user-facing statuses only — no Correction / Ambiguous split. */
const STATUS_LABELS: Record<string, string> = {
  running: "Reviewing…",
  passed: "Passed",
  needs_correction: "Needs Review",
  incomplete: "Review Incomplete",
  ambiguous: "Passed",
  sent_back: "Needs Review",
  attention: "Passed",
  flagged: "Passed",
  pending: "Review Incomplete",
  unavailable: "Review Incomplete"
};

const CHECK_LABELS: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  unverified: "Unverified",
  na: "Not applicable"
};

const ACTION_LABELS: Record<string, string> = {
  add: "Add",
  update: "Update",
  remove: "Remove"
};

function isConcreteRecommendation(change: AiReviewRecommendation): boolean {
  if (change.applyable === false) return false;
  if (change.action === "add") {
    return Boolean((change.researched_quote || "").trim() && change.evidence_id);
  }
  if (change.action === "remove") {
    return Boolean(change.evidence_id);
  }
  if (change.action === "update") {
    if (change.target === "rationale") return Boolean((change.rationale || "").trim());
    if (change.target === "mapping_label" || change.target === "label") {
      return Boolean(change.mapping_label);
    }
  }
  return false;
}

function hasConcreteRecommendations(review?: AiReview | null): boolean {
  const list = review?.recommendations || review?.suggested_changes || [];
  return list.some(isConcreteRecommendation);
}

function allReviewChecks(review?: AiReview | null): AiReviewCheck[] {
  if (!review) return [];
  const out: AiReviewCheck[] = [];
  for (const source of review.source_reviews || []) {
    out.push(...(source.checks || []));
  }
  out.push(...(review.claim_checks || review.checks || []));
  return out;
}

function hasFailedCriteria(review?: AiReview | null): boolean {
  return allReviewChecks(review).some((check) => check.status === "fail");
}

/** Needs Review only when the claim report failed a check or has an applyable fix. */
function effectiveReviewStatus(review?: AiReview | null): string {
  if (!review) return "pending";
  if (hasFailedCriteria(review) || hasConcreteRecommendations(review)) {
    return "needs_correction";
  }
  const raw = review.status || "pending";
  if (raw === "incomplete" || raw === "pending" || raw === "unavailable" || raw === "running") {
    return raw;
  }
  return "passed";
}

export function aiReviewStatusLabel(review?: AiReview | null): string {
  if (!review) return "AI review pending";
  return STATUS_LABELS[effectiveReviewStatus(review)] || "Passed";
}

export function aiReviewStatusKind(
  review?: AiReview | null
): "pass" | "fail" | "needs" | "incomplete" | "muted" {
  switch (effectiveReviewStatus(review)) {
    case "passed":
      return "pass";
    case "needs_correction":
      return "fail";
    case "incomplete":
    case "pending":
    case "unavailable":
      return "incomplete";
    case "running":
      return "muted";
    default:
      return "pass";
  }
}

function explanationOf(check: AiReviewCheck): string {
  return (check.explanation || check.reason || "").trim();
}

function CheckCard({ check }: { check: AiReviewCheck }) {
  const explanation = explanationOf(check);
  const fixHint = (check.recommendation || "").trim();
  return (
    <li className={`ai-review-check-card status-${check.status}`}>
      <div className="ai-review-check-head">
        <strong>{check.id}</strong>
        <span className={`ai-review-check-status status-${check.status}`}>
          {CHECK_LABELS[check.status] || check.status}
        </span>
      </div>
      {explanation ? <p className="ai-review-check-reason">{explanation}</p> : null}
      {check.status === "fail" && fixHint ? (
        <p className="doc-sub">Update: {fixHint}</p>
      ) : null}
    </li>
  );
}

function RecommendationCard({
  change,
  busy,
  onApply
}: {
  change: AiReviewRecommendation;
  busy: boolean;
  onApply: () => void;
}) {
  const finding = (change.finding || "").trim();
  return (
    <li className={`ai-review-change-card action-${change.action}`}>
      <div className="ai-review-check-head">
        <strong>{change.title}</strong>
        <span className={`ai-review-action-pill action-${change.action}`}>
          {ACTION_LABELS[change.action] || change.action}
        </span>
      </div>
      {finding ? (
        <p className="ai-review-check-reason">
          <span className="evidence-label">Verified issue</span> {finding}
        </p>
      ) : null}
      {change.researched_quote ? (
        <blockquote className="ai-review-researched-quote">
          <div className="evidence-label">Result to add</div>
          <p>{change.researched_quote}</p>
          {(change.researched_section || change.researched_page) && (
            <p className="doc-sub">
              {[
                change.researched_section,
                change.researched_page ? `p. ${change.researched_page}` : null
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </blockquote>
      ) : null}
      {change.mapping_label ? <p className="doc-sub">Update label → {change.mapping_label}</p> : null}
      {change.rationale ? (
        <p className="doc-sub">
          Update rationale → {change.rationale.slice(0, 180)}
          {change.rationale.length > 180 ? "…" : ""}
        </p>
      ) : null}
      <button type="button" className="secondary" disabled={busy} onClick={onApply}>
        {busy ? "Applying…" : `Apply ${ACTION_LABELS[change.action] || change.action}`}
      </button>
    </li>
  );
}

export default function AiReviewPanel({
  row,
  review,
  busy = false,
  onViewEvidence,
  onAskAgent,
  onEdit,
  onRequestRevision,
  onRerun,
  onApplyFix
}: Props) {
  const status = effectiveReviewStatus(review);
  const label = aiReviewStatusLabel(review);
  const reason =
    status === "passed"
      ? "Mapping and supporting evidence satisfy the review criteria."
      : review?.explanation ||
        review?.reason ||
        (status === "running" ? "Checking this row." : "No review result yet.");
  const sourceReviews = review?.source_reviews || [];
  const claimChecks = review?.claim_checks || review?.checks || [];
  const failedChecks = allReviewChecks(review).filter((check) => check.status === "fail");
  const recommendations = (review?.recommendations || review?.suggested_changes || []).filter(
    isConcreteRecommendation
  );
  const applyable = recommendations;
  const latest = row.revisions.at(-1);
  const hasEvidence = Boolean(
    (latest?.evidence_blocks || []).some((block: EvidenceBlock) => block.available !== false)
  );
  const showNeedsReview = status === "needs_correction";

  return (
    <div className="ai-review-pane" role="region" aria-label={`AI review for ${row.label}`}>
      <header className="ai-review-header">
        <h3 tabIndex={-1} id="ai-review-title">
          AI review · {row.label}
        </h3>
        <p className={`ai-review-verdict kind-${aiReviewStatusKind(review)}`}>{label}</p>
        <p className="ai-review-reason">{reason}</p>
        {review?.review_run_id ? (
          <p className="doc-sub">
            Review run {review.review_run_id.slice(0, 8)}
            {review.reviewed_at ? ` · ${review.reviewed_at}` : ""}
          </p>
        ) : null}
      </header>

      <section className="ai-review-summary-grid" aria-label="Review summary">
        <div>
          <div className="evidence-label">Current mapping</div>
          <div>{review?.current_mapping_label || latest?.mapping_label || "—"}</div>
        </div>
        <div>
          <div className="evidence-label">AI-recommended mapping</div>
          <div>{review?.recommended_mapping_label || "—"}</div>
        </div>
        <div>
          <div className="evidence-label">Sources reviewed</div>
          <div>{sourceReviews.filter((s) => s.evidence_number > 0).length || 0}</div>
        </div>
      </section>

      {showNeedsReview && failedChecks.length ? (
        <section className="ai-review-fix-card" aria-label="Failed criteria">
          <div className="evidence-label">Failed criteria</div>
          <p className="doc-sub">
            Each failed check includes the reason. Apply a recommendation below when a concrete
            chart update is available, or edit the row.
          </p>
          <ul className="ai-review-checks">
            {failedChecks.map((check, index) => (
              <CheckCard key={`fail-${check.id}-${index}`} check={check} />
            ))}
          </ul>
        </section>
      ) : null}

      {sourceReviews.length ? (
        <section className="ai-review-source-stack" aria-label="Per-source checks">
          <div className="evidence-label">Source checks</div>
          {sourceReviews.map((source) => (
            <div key={`${source.evidence_number}-${source.evidence_id || "none"}`} className="ai-review-source-block">
              <h4 className="ai-review-evidence-title">{source.label}</h4>
              <ul className="ai-review-checks">
                {source.checks.map((check) => (
                  <CheckCard key={`${source.evidence_number}-${check.id}`} check={check} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {claimChecks.length ? (
        <section className="ai-review-source-block" aria-label="Claim-level checks">
          <div className="evidence-label">Claim-level checks</div>
          <ul className="ai-review-checks">
            {claimChecks.map((check) => (
              <CheckCard key={check.id} check={check} />
            ))}
          </ul>
        </section>
      ) : null}

      {recommendations.length ? (
        <section className="ai-review-fix-card" aria-label="Recommendations">
          <div className="evidence-label">Update with correct detail</div>
          <p className="doc-sub">
            Concrete chart updates from failed criteria. Apply one at a time or all together. Each
            apply creates a new revision and logs your name.
          </p>
          <ul className="ai-review-checks">
            {recommendations.map((change) => (
              <RecommendationCard
                key={change.id}
                change={change}
                busy={busy}
                onApply={() => onApplyFix([change.id])}
              />
            ))}
          </ul>
          {applyable.length > 1 ? (
            <div className="row-action-group">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => onApplyFix(applyable.map((change) => change.id))}
              >
                {busy ? "Applying…" : `Apply all (${applyable.length})`}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="row-action-group ai-review-actions">
        <button type="button" className="secondary" disabled={!hasEvidence} onClick={onViewEvidence}>
          View evidence
        </button>
        <button type="button" className="secondary" onClick={onAskAgent}>
          Ask agent
        </button>
        <button type="button" className="secondary" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onRequestRevision}>
          Request revision
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={onRerun}>
          {status === "incomplete" ? "Try again" : "Rerun review"}
        </button>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  XCircle
} from "lucide-react";
import {
  criterionStatusClass,
  explainTag,
  getJudge,
  humanFindingTag,
  judgeIssueCount,
  mappingReviewStatusLabel
} from "../evidenceLabels";
import type { ChartRevision, ChartRow, JudgeCriterion } from "../types";

type Props = {
  row: ChartRow;
  revision: ChartRevision;
  documentLabel: string;
  selectedFinding: string | null;
  rechecking: boolean;
  recheckNotice: string | null;
  onSelectFinding: (id: string) => void;
  onViewEvidence: (criterion?: JudgeCriterion | null) => void;
  onRecheck: () => void;
  onAskAgent: (prompt?: string) => void;
  onAddComment: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onOverrideJudge?: () => void;
  busy?: boolean;
};

function decisionClass(decision?: string) {
  if (decision === "Passed checks") return "pass";
  if (decision === "Failed checks") return "fail";
  if (decision === "Review incomplete") return "incomplete";
  if (decision === "Reviewing") return "reviewing";
  return "needs";
}

function DecisionIcon({ decision }: { decision?: string }) {
  if (decision === "Passed checks") return <CheckCircle2 size={16} />;
  if (decision === "Failed checks") return <XCircle size={16} />;
  if (decision === "Review incomplete") return <AlertTriangle size={16} />;
  if (decision === "Reviewing") return <Loader2 size={16} className="spin" />;
  return <CircleDashed size={16} />;
}

function pointsCell(criterion: JudgeCriterion) {
  if (criterion.status === "Not applicable" || criterion.status === "Could not assess") {
    return "—";
  }
  if (criterion.earned_points == null && criterion.score == null) return "—";
  const earned = criterion.earned_points ?? criterion.score ?? 0;
  return `${earned}/${criterion.max_points ?? "—"}`;
}

function statusPill(status?: string) {
  const value = status || "Not run";
  const kind = criterionStatusClass(value);
  const label =
    value === "Not run"
      ? "LLM not called"
      : value === "Error"
        ? "LLM error"
        : value === "Not applicable"
          ? "Could not assess"
          : value;
  const Icon =
    value === "Pass"
      ? CheckCircle2
      : value === "Fail" || value === "Error"
        ? XCircle
        : value === "Needs review"
          ? AlertTriangle
          : CircleDashed;
  return (
    <span className={`status-chip ${kind}`} title={explainTag(label)}>
      <Icon size={12} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function isMismatchError(status?: string) {
  return status === "Fail" || status === "Error";
}

function isPendingLlm(status?: string) {
  return status === "Not run";
}

function revisionSourceLabel(revision: ChartRevision, index: number) {
  if (index === 0) return "System draft";
  if (revision.analyst_disposition === "accept") return "Prior accepted revision";
  if (revision.analyst_disposition === "reject") return "Prior rejected revision";
  return "Updated revision";
}

export default function JudgePanel({
  row,
  revision,
  documentLabel,
  selectedFinding,
  rechecking,
  recheckNotice,
  onSelectFinding,
  onViewEvidence,
  onRecheck,
  onAskAgent,
  onAddComment,
  onAccept,
  onReject,
  onOverrideJudge,
  busy = false
}: Props) {
  const judge = getJudge(revision);
  const criteria = judge?.criteria || [];
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    const firstIssue = (judge?.criteria || []).find((c) =>
      ["Fail", "Error", "Not run", "Needs review", "Could not assess"].includes(c.status)
    );
    return firstIssue?.criterion_id || null;
  });

  const decision = judge?.overall_decision;
  const reviewStatus = mappingReviewStatusLabel(revision);
  const unresolved = useMemo(
    () =>
      criteria.filter((c) =>
        ["Fail", "Error", "Not run", "Needs review", "Could not assess"].includes(c.status)
      ),
    [criteria]
  );
  const issueCount = judgeIssueCount(revision);
  const confidenceScore =
    judge?.confidence && typeof judge.confidence.score === "number"
      ? Math.round(judge.confidence.score)
      : null;
  const scoreText =
    confidenceScore != null
      ? `Confidence ${confidenceScore}%`
      : judge?.score_label ||
        (judge?.rubric_score != null ? String(judge.rubric_score) : "Not evaluated");

  const reviewPhase =
    rechecking || decision === "Reviewing"
      ? { label: "In progress", kind: "progress" as const }
      : decision === "Review incomplete" || judge?.legacy
        ? { label: "Incomplete", kind: "attention" as const }
        : criteria.length >= 7
          ? { label: "Done", kind: "done" as const }
          : { label: "Not started", kind: "idle" as const };

  const nextLine =
    unresolved[0]?.next_action ||
    unresolved[0]?.analyst_action ||
    judge?.next_action ||
    "Open the scorecard row that needs attention, then revise or accept.";

  const history = row.revisions || [];

  return (
    <div className="judge-pane compact">
      <header className="judge-compact-header">
        <div className="judge-compact-top">
          <div className="badge-row">
            <span className={`review-phase-pill ${reviewPhase.kind}`}>
              {reviewPhase.kind === "progress" ? <Loader2 size={14} className="spin" /> : null}
              Review {reviewPhase.label}
            </span>
            <div className={`judge-decision-pill ${decisionClass(decision)}`}>
              <DecisionIcon decision={decision} />
              <span>{reviewStatus}</span>
            </div>
          </div>
          <div
            className="judge-score-chip"
            title={
              judge?.confidence?.rationale ||
              "LLM Judge confidence from completeness, accuracy, groundedness, fact check, and relevance"
            }
          >
            {scoreText}
            {issueCount ? ` · ${issueCount} open` : ""}
          </div>
        </div>

        <div className="badge-row">
          <span className="status-badge map">{revision.mapping_label || "Undetermined"}</span>
          <span
            className={`status-badge ${
              reviewStatus === "Passed"
                ? "pass"
                : reviewStatus === "Flagged"
                  ? "fail"
                  : reviewStatus === "Could not assess"
                    ? "incomplete"
                    : "needs"
            }`}
          >
            {reviewStatus}
          </span>
          {revision.match_strength ? (
            <span className="status-badge muted" title={explainTag(revision.match_strength)}>
              {revision.match_strength}
            </span>
          ) : null}
          {revision.requirement_applicability ? (
            <span
              className="status-badge muted"
              title={
                revision.requirement_condition ||
                explainTag(revision.requirement_applicability)
              }
            >
              {revision.requirement_applicability}
            </span>
          ) : null}
        </div>

        <p className="judge-one-liner">
          {unresolved.length
            ? nextLine
            : judge?.what_passed || "All scored checks passed for this revision."}
        </p>
        <p className="doc-sub">
          {documentLabel} · Rev {revision.revision_number}
          {judge?.score_provisional ? " · Provisional score" : ""}
        </p>
      </header>

      {recheckNotice ? <div className="warn-box">{recheckNotice}</div> : null}
      {judge?.legacy ? (
        <div className="warn-box">Legacy review only — Recheck to score this row.</div>
      ) : null}

      {(judge?.analyst_comments?.length || judge?.reconsider_items?.length) ? (
        <section className="judge-litigator-comments">
          <h3>Litigator comments for analyst</h3>
          {judge.reconsider_items?.length ? (
            <div className="reconsider-box">
              <span className="evidence-label">Reconsider / check</span>
              <ul>
                {judge.reconsider_items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {judge.analyst_comments?.length ? (
            <ul className="litigator-comment-list">
              {judge.analyst_comments.map((comment, index) => (
                <li
                  key={`${comment.topic || "c"}-${index}`}
                  className={`severity-${comment.severity || "reconsider"}`}
                >
                  <strong>{comment.topic || "Note"}</strong>
                  <span className="doc-sub"> · {comment.severity || "reconsider"}</span>
                  <p>{comment.comment}</p>
                  {comment.analyst_action ? (
                    <p className="analyst-action">
                      <strong>Action:</strong> {comment.analyst_action}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="judge-fix-panel">
        <h3>How to fix</h3>
        <ol className="judge-fix-steps">
          <li>
            <strong>Check the source</strong> — confirm the quote and citation on the page.
          </li>
          <li>
            <strong>Ask agent to revise</strong> — proposes a new chart revision (evidence /
            rationale / label). Accept the proposal in Ask agent to update the chart.
          </li>
          <li>
            <strong>Accept or override</strong> — accept the mapping review finding, or override
            it with a recorded reason.
          </li>
        </ol>
        <div className="row-action-group">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onAskAgent(
                unresolved[0]?.finding
                  ? `Revise ${row.label}: ${unresolved[0].finding}. ${nextLine}`
                  : `Revise ${row.label} based on the Judge findings.`
              )
            }
          >
            Ask agent to revise
          </button>
          <button type="button" className="ghost" onClick={onAddComment}>
            Add comments
          </button>
          {onAccept ? (
            <button type="button" className="secondary" disabled={busy} onClick={onAccept}>
              {busy ? "Accepting…" : "Accept finding"}
            </button>
          ) : null}
          {onOverrideJudge ? (
            <button type="button" className="ghost" disabled={busy} onClick={onOverrideJudge}>
              {busy ? "Overriding…" : "Override judge"}
            </button>
          ) : null}
          {onReject ? (
            <button type="button" className="ghost" disabled={busy} onClick={onReject}>
              Reject row
            </button>
          ) : null}
        </div>
      </section>

      {(() => {
        if (!criteria.length || judge?.legacy) return null;
        const conf = judge?.confidence;
        const dims = (
          [
            ["Completeness", conf?.completeness || judge?.completeness],
            ["Accuracy", conf?.accuracy || judge?.accuracy],
            ["Groundedness", conf?.groundedness || judge?.groundedness],
            ["Fact check", conf?.fact_check || judge?.fact_check],
            ["Relevance", conf?.relevance || judge?.relevance]
          ] as const
        ).map(
          ([label, dim]) =>
            [
              label,
              dim || {
                status: "Needs review",
                finding: "Not scored yet — Recheck this revision.",
                score: null
              }
            ] as const
        );
        const score =
          typeof conf?.score === "number" ? conf.score : confidenceScore;
        return (
          <section className="judge-quality-panel judge-confidence-panel">
            <div className="judge-confidence-head">
              <h3>Confidence · quality dimensions</h3>
              {typeof score === "number" ? (
                <div
                  className={`judge-confidence-score band-${String(conf?.band || "mid")}`}
                  title="LLM Judge confidence from completeness, accuracy, groundedness, fact check, and relevance"
                >
                  {Math.round(score)}%
                </div>
              ) : (
                <div className="doc-sub">Not scored</div>
              )}
            </div>
            {conf?.rationale ? (
              <p className="judge-confidence-rationale">{conf.rationale}</p>
            ) : (
              <p className="judge-confidence-rationale doc-sub">
                Dimension scores are derived from the Mapping Review criteria
                {typeof score === "number"
                  ? "."
                  : ". Use Recheck to run a full litigator confidence pass."}
              </p>
            )}
            <div className="judge-quality-grid five">
              {dims.map(([label, dim]) => (
                <div
                  key={label}
                  className={`judge-quality-card status-${String(dim?.status || "muted")
                    .toLowerCase()
                    .replace(/\s+/g, "-")}`}
                >
                  <div className="judge-quality-label">{label}</div>
                  <div className="judge-quality-status">
                    {dim?.score != null ? `${dim.score}%` : dim?.status || "—"}
                    {dim?.score != null && dim?.status ? (
                      <span className="doc-sub"> · {dim.status}</span>
                    ) : null}
                  </div>
                  {dim?.finding ? <p className="doc-sub">{dim.finding}</p> : null}
                </div>
              ))}
            </div>
            {judge?.approval_recommendation ? (
              <p className="doc-sub" style={{ marginTop: 8 }}>
                Approval recommendation:{" "}
                <strong>{judge.approval_recommendation.replaceAll("_", " ")}</strong>
                {judge.vision_screenshots_reviewed
                  ? ` · ${judge.vision_screenshots_reviewed} screenshot(s) vision-checked`
                  : ""}
              </p>
            ) : null}
          </section>
        );
      })()}

      <section>
        <div className="judge-scorecard-head">
          <h3>Criterion scorecard</h3>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const focus =
                unresolved.find((c) => c.criterion_id === selectedFinding) ||
                unresolved[0] ||
                criteria[0] ||
                null;
              if (focus) onSelectFinding(focus.criterion_id);
              onViewEvidence(focus);
            }}
          >
            View highlighted source
          </button>
        </div>

        <div className="judge-table-wrap">
          <table className="judge-criteria-table">
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Score</th>
                <th>Status</th>
                <th>Finding</th>
              </tr>
            </thead>
            <tbody>
              {criteria.length ? (
                criteria.map((criterion) => {
                  const open = expandedId === criterion.criterion_id;
                  const mismatch = isMismatchError(criterion.status);
                  const pendingLlm = isPendingLlm(criterion.status);
                  const softReview = criterion.status === "Needs review";
                  const showDetail = mismatch || pendingLlm || softReview;
                  const verifiedBy =
                    criterion.verification_method ||
                    (criterion.source === "llm"
                      ? "LLM verification against supplied quotes"
                      : criterion.source === "code"
                        ? "Verified against the source document"
                        : null);
                  return (
                    <tr
                      key={criterion.criterion_id}
                      className={[
                        selectedFinding === criterion.criterion_id ? "active" : "",
                        mismatch ? "needs-attention-row" : "",
                        pendingLlm ? "llm-pending-row" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td>
                        <button
                          type="button"
                          className="judge-crit-toggle"
                          onClick={() => {
                            onSelectFinding(criterion.criterion_id);
                            setExpandedId(open ? null : criterion.criterion_id);
                          }}
                        >
                          <span
                            className="judge-crit-label"
                            title={explainTag(criterion.short_label || criterion.label)}
                          >
                            {criterion.short_label || criterion.label}
                          </span>
                          <span className="doc-sub">
                            {showDetail ? (open ? "Hide" : "Details") : ""}
                          </span>
                        </button>
                        {verifiedBy ? (
                          <div className="doc-sub judge-verify-method">{verifiedBy}</div>
                        ) : null}
                      </td>
                      <td className="judge-score-cell">{pointsCell(criterion)}</td>
                      <td>{statusPill(criterion.status)}</td>
                      <td>
                        <div className="judge-finding">{criterion.finding}</div>
                        {showDetail ? (
                          <>
                            <button
                              type="button"
                              className="ghost finding-detail-toggle"
                              onClick={() => {
                                onSelectFinding(criterion.criterion_id);
                                setExpandedId(open ? null : criterion.criterion_id);
                              }}
                            >
                              {open ? "Hide detail" : "View detail"}
                            </button>
                            {open ? (
                              <div className="judge-finding-detail">
                                {(criterion.tags || []).length ? (
                                  <div className="badge-row compact">
                                    {(criterion.tags || []).map((tag) => {
                                      const label = humanFindingTag(tag);
                                      return (
                                        <span
                                          key={tag}
                                          className="status-chip issue"
                                          title={explainTag(tag)}
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                {criterion.requirement ? (
                                  <div>
                                    <strong>Requirement:</strong> {criterion.requirement}
                                  </div>
                                ) : null}
                                {criterion.evidence_establishes ? (
                                  <div>
                                    <strong>Evidence shows:</strong>{" "}
                                    {criterion.evidence_establishes}
                                  </div>
                                ) : null}
                                {mismatch || softReview ? (
                                  <div>
                                    <strong>Gap:</strong>{" "}
                                    {criterion.gap ||
                                      (pendingLlm
                                        ? "LLM has not assessed this criterion yet."
                                        : "No specific mismatch recorded.")}
                                  </div>
                                ) : null}
                                {pendingLlm ? (
                                  <div>
                                    <strong>Status:</strong> LLM call was not made for this
                                    criterion. Use Recheck to run the Judge.
                                  </div>
                                ) : null}
                                {criterion.next_action || criterion.analyst_action ? (
                                  <div>
                                    <strong>Analyst comment / fix:</strong>{" "}
                                    {criterion.next_action || criterion.analyst_action}
                                  </div>
                                ) : null}
                                {criterion.details?.groundedness ||
                                criterion.details?.accuracy ||
                                criterion.details?.relevance ? (
                                  <div className="criterion-quality-mini">
                                    {(
                                      [
                                        ["Grounded", criterion.details.groundedness],
                                        ["Accurate", criterion.details.accuracy],
                                        ["Relevant", criterion.details.relevance]
                                      ] as const
                                    ).map(([label, dim]) => {
                                      if (!dim || typeof dim !== "object") return null;
                                      const status = String(
                                        (dim as { status?: string }).status || ""
                                      );
                                      const finding = String(
                                        (dim as { finding?: string }).finding || ""
                                      );
                                      return (
                                        <div key={label}>
                                          <strong>{label}:</strong> {status}
                                          {finding ? ` — ${finding}` : ""}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                {criterion.per_evidence?.length ? (
                                  <details>
                                    <summary>
                                      Per-evidence checks ({criterion.per_evidence.length})
                                    </summary>
                                    <ul>
                                      {criterion.per_evidence.map((item, index) => (
                                        <li key={index}>
                                          {String(item.status || "")}:{" "}
                                          {String(item.finding || "")}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                                {mismatch ? (
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() =>
                                      onAskAgent(
                                        `Fix ${criterion.short_label || criterion.label} on ${row.label}: ${
                                          criterion.next_action ||
                                          criterion.finding ||
                                          "address this report finding"
                                        }`
                                      )
                                    }
                                  >
                                    Ask agent to fix this
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No criterion results. Recheck this revision.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {judge?.scorecard_note ? (
          <p className="judge-scorecard-note">{judge.scorecard_note}</p>
        ) : null}
      </section>

      <section className="judge-history">
        <h3>Revision history</h3>
        <p className="doc-sub">
          System drafts are kept. Agent proposals create a new revision; older ones remain for
          audit.
        </p>
        <ul className="judge-history-list">
          {[...history].reverse().map((item, reverseIndex) => {
            const index = history.length - 1 - reverseIndex;
            const current = item.id === revision.id;
            return (
              <li key={item.id} className={current ? "current" : ""}>
                <strong>Rev {item.revision_number}</strong>
                <span>{revisionSourceLabel(item, index)}</span>
                <span>{item.mapping_label || "—"}</span>
                <span>{current ? "Current" : "Superseded"}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="row-action-group" style={{ marginTop: 10 }}>
        <button type="button" className="ghost" disabled={rechecking} onClick={onRecheck}>
          {rechecking ? "Rechecking…" : "Recheck"}
        </button>
        <button type="button" className="ghost" onClick={onAddComment}>
          Comments
        </button>
      </div>
    </div>
  );
}

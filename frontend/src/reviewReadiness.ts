import { aiReviewStatusKind } from "./components/AiReviewPanel";
import type { ChartRevision, ChartRow } from "./types";

/** @deprecated Prefer ChartFilters; kept for older call sites. */
export type RowFilterId =
  | "all"
  | "needs_attention"
  | "ai_verified"
  | "analyst_done"
  | "ready_for_final"
  | "human_labelled"
  | "ai_authored";

export type RowAttentionBucket =
  | "needs_attention"
  | "ai_verified"
  | "analyst_done"
  | "pending_review";

/** Auto Review Status — aligned with rationale-column AI pills. */
export type AutoReviewFilter = "all" | "verified" | "need_review" | "review_pending";
export type AnalystStatusFilter =
  | "all"
  | "completed"
  | "review_pending"
  | "accepted"
  | "rejected";
export type UpdatedByFilter = "all" | "manual" | "ai";
export type AutoReviewBucket = "verified" | "need_review" | "review_pending";

export type ChartFilters = {
  autoReview: AutoReviewFilter;
  status: AnalystStatusFilter;
  updatedBy: UpdatedByFilter;
};

export const DEFAULT_CHART_FILTERS: ChartFilters = {
  autoReview: "all",
  status: "all",
  updatedBy: "all"
};

export const AUTO_REVIEW_LABELS: Record<AutoReviewBucket, string> = {
  verified: "AI- Verified",
  need_review: "AI- Need Review",
  review_pending: "AI- Review Pending"
};

function latestRevision(row: ChartRow): ChartRevision | undefined {
  return row.revisions.at(-1);
}

/** Manual / Ask-agent-accepted edits. Everything else counts as AI-authored. */
export function isHumanLabelled(row: ChartRow): boolean {
  const rev = latestRevision(row);
  if (!rev) return false;
  const origin = (rev.authorship || "").toLowerCase();
  const label = (rev.authorship_label || "").toLowerCase();
  return origin === "human" || origin === "agent" || label === "manual";
}

export function isAiAuthored(row: ChartRow): boolean {
  const rev = latestRevision(row);
  if (!rev) return false;
  return !isHumanLabelled(row);
}

/** AI Review Passed counts as ready; otherwise Accept/Reject is required. */
export function isRowFinalReady(row: ChartRow): boolean {
  const rev = latestRevision(row);
  if (!rev) return false;
  if (rev.analyst_disposition) return true;
  return aiReviewStatusKind(rev.ai_review) === "pass" && Boolean(rev.ai_review);
}

export function rowAttentionBucket(row: ChartRow): RowAttentionBucket {
  const rev = latestRevision(row);
  if (!rev) return "pending_review";
  if (rev.analyst_disposition) return "analyst_done";
  if (!rev.ai_review) return "pending_review";
  const kind = aiReviewStatusKind(rev.ai_review);
  if (kind === "pass") return "ai_verified";
  return "needs_attention";
}

/** Claim-element column disposition (no AI review labels). */
export function analystDispositionLabel(row: ChartRow): "Accepted" | "Rejected" | null {
  const rev = latestRevision(row);
  if (rev?.analyst_disposition === "accept") return "Accepted";
  if (rev?.analyst_disposition === "reject") return "Rejected";
  return null;
}

export function rowAttentionLabel(row: ChartRow): string {
  const disposition = analystDispositionLabel(row);
  if (disposition) return disposition;
  return "Review Pending";
}

/**
 * Auto Review Status buckets:
 * - verified → all AI checks passed
 * - need_review → AI finished but fail/unverified / needs correction
 * - review_pending → AI review not run or not completed
 */
export function autoReviewBucketFromRevision(rev?: ChartRevision | null): AutoReviewBucket {
  if (!rev?.ai_review) return "review_pending";
  const kind = aiReviewStatusKind(rev.ai_review);
  if (kind === "pass") return "verified";
  if (kind === "fail" || kind === "needs") return "need_review";
  return "review_pending";
}

export function autoReviewBucket(row: ChartRow): AutoReviewBucket {
  return autoReviewBucketFromRevision(latestRevision(row));
}

export function autoReviewStatusLabel(
  rowOrBucket: ChartRow | AutoReviewBucket | ChartRevision
): string {
  if (typeof rowOrBucket === "string") return AUTO_REVIEW_LABELS[rowOrBucket];
  if ("revisions" in rowOrBucket) return AUTO_REVIEW_LABELS[autoReviewBucket(rowOrBucket)];
  return AUTO_REVIEW_LABELS[autoReviewBucketFromRevision(rowOrBucket)];
}

export function matchesAutoReviewFilter(row: ChartRow, filter: AutoReviewFilter): boolean {
  if (filter === "all") return true;
  return autoReviewBucket(row) === filter;
}

/** Analyst Review Status: Completed | Review Pending | Accepted | Rejected */
export function matchesAnalystStatusFilter(row: ChartRow, filter: AnalystStatusFilter): boolean {
  if (filter === "all") return true;
  const rev = latestRevision(row);
  const disposition = rev?.analyst_disposition || null;
  if (filter === "completed") return disposition === "accept" || disposition === "reject";
  if (filter === "review_pending") return !disposition;
  if (filter === "accepted") return disposition === "accept";
  if (filter === "rejected") return disposition === "reject";
  return false;
}

export function matchesUpdatedByFilter(row: ChartRow, filter: UpdatedByFilter): boolean {
  if (filter === "all") return true;
  if (filter === "manual") return isHumanLabelled(row);
  return isAiAuthored(row);
}

export function rowMatchesChartFilters(row: ChartRow, filters: ChartFilters): boolean {
  return (
    matchesAutoReviewFilter(row, filters.autoReview) &&
    matchesAnalystStatusFilter(row, filters.status) &&
    matchesUpdatedByFilter(row, filters.updatedBy)
  );
}

export function chartFiltersAreDefault(filters: ChartFilters): boolean {
  return (
    filters.autoReview === "all" &&
    filters.status === "all" &&
    filters.updatedBy === "all"
  );
}

/** Legacy single-filter matcher (summary chips / older callers). */
export function rowMatchesFilter(row: ChartRow, filter: RowFilterId): boolean {
  if (filter === "all") return true;
  if (filter === "ready_for_final") return isRowFinalReady(row);
  if (filter === "analyst_done") return rowAttentionBucket(row) === "analyst_done";
  if (filter === "ai_verified") return rowAttentionBucket(row) === "ai_verified";
  if (filter === "human_labelled") return isHumanLabelled(row);
  if (filter === "ai_authored") return isAiAuthored(row);
  if (filter === "needs_attention") {
    const bucket = rowAttentionBucket(row);
    return bucket === "needs_attention" || bucket === "pending_review";
  }
  return true;
}

export function chartReadinessCounts(rows: ChartRow[]) {
  const counts = {
    total: rows.length,
    needs_attention: 0,
    pending_review: 0,
    ai_verified: 0,
    analyst_done: 0,
    ready_for_final: 0,
    human_labelled: 0,
    ai_authored: 0,
    auto_verified: 0,
    auto_need_review: 0,
    auto_review_pending: 0,
    analyst_review_pending: 0,
    accepted: 0,
    rejected: 0
  };
  for (const row of rows) {
    const bucket = rowAttentionBucket(row);
    if (bucket === "needs_attention") counts.needs_attention += 1;
    if (bucket === "pending_review") counts.pending_review += 1;
    if (bucket === "ai_verified") counts.ai_verified += 1;
    if (bucket === "analyst_done") counts.analyst_done += 1;
    if (isRowFinalReady(row)) counts.ready_for_final += 1;
    if (isHumanLabelled(row)) counts.human_labelled += 1;
    else if (latestRevision(row)) counts.ai_authored += 1;

    if (matchesAutoReviewFilter(row, "verified")) counts.auto_verified += 1;
    if (matchesAutoReviewFilter(row, "need_review")) counts.auto_need_review += 1;
    if (matchesAutoReviewFilter(row, "review_pending")) counts.auto_review_pending += 1;
    if (matchesAnalystStatusFilter(row, "review_pending")) counts.analyst_review_pending += 1;
    if (matchesAnalystStatusFilter(row, "accepted")) counts.accepted += 1;
    if (matchesAnalystStatusFilter(row, "rejected")) counts.rejected += 1;
  }
  return counts;
}

export function filterCount(
  filter: RowFilterId,
  counts: ReturnType<typeof chartReadinessCounts>
): number {
  switch (filter) {
    case "all":
      return counts.total;
    case "needs_attention":
      return counts.needs_attention + counts.pending_review;
    case "ai_verified":
      return counts.ai_verified;
    case "analyst_done":
      return counts.analyst_done;
    case "ready_for_final":
      return counts.ready_for_final;
    case "human_labelled":
      return counts.human_labelled;
    case "ai_authored":
      return counts.ai_authored;
    default:
      return 0;
  }
}

/** @deprecated Replaced by the three chart filter dropdowns. */
export const REVIEW_FILTERS: Array<{ id: RowFilterId; label: string; hint: string }> = [
  {
    id: "needs_attention",
    label: "Needs attention",
    hint: "Work queue: AI Review not run yet, incomplete, or Needs Review."
  },
  {
    id: "ai_verified",
    label: "AI verified",
    hint: "AI Review Passed on the latest revision."
  },
  {
    id: "analyst_done",
    label: "Analyst decided",
    hint: "Accept or Reject recorded."
  },
  {
    id: "ready_for_final",
    label: "Ready for final",
    hint: "AI verified ∪ Analyst decided."
  },
  {
    id: "all",
    label: "All rows",
    hint: "Show every claim element on this chart."
  }
];

/** @deprecated Replaced by Updated By dropdown. */
export const AUTHORSHIP_FILTERS: Array<{ id: RowFilterId; label: string; hint: string }> = [
  {
    id: "human_labelled",
    label: "Human labelled",
    hint: "Latest mapping was edited manually or accepted from Ask agent."
  },
  {
    id: "ai_authored",
    label: "AI authored",
    hint: "Latest mapping still comes from the mapping agent or an applied AI Review fix."
  }
];

export const ROW_FILTERS = [...REVIEW_FILTERS, ...AUTHORSHIP_FILTERS];

import type { ChartRevision, EvidenceBlock, JudgeReport } from "./types";

export function evidenceHeading(block: EvidenceBlock): string {
  if (!block.available) {
    return `Evidence ${block.evidence_number} unavailable`;
  }
  if (block.citation_heading) return block.citation_heading;
  const short =
    block.source?.short_label ||
    [block.source?.family, block.source?.edition?.match(/\bV\d+\b/i)?.[0]]
      .filter(Boolean)
      .join(" ") ||
    "Standard";
  const section = block.section_ref || null;
  const page =
    block.page_ordinal != null ? `PDF p.${block.page_ordinal}` : "PDF p. n/a";
  const printed = block.printed_label ? `Printed p.${block.printed_label}` : null;
  return [short, section, page, printed].filter(Boolean).join(" · ");
}

export function isBBox(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number");
}

export function quoteLineBboxes(block: EvidenceBlock | null | undefined): number[][] {
  if (!block) return [];
  const lines = (block.quote_line_bboxes || []).filter(isBBox);
  if (lines.length) return lines;
  if (isBBox(block.quote_bbox)) return [block.quote_bbox];
  if (isBBox(block.bbox) && block.highlight_available !== false) return [block.bbox];
  return [];
}

export function preferredBbox(block: EvidenceBlock | null | undefined): number[] | null {
  const lines = quoteLineBboxes(block);
  if (!lines.length) return null;
  return [
    Math.min(...lines.map((box) => box[0])),
    Math.min(...lines.map((box) => box[1])),
    Math.max(...lines.map((box) => box[2])),
    Math.max(...lines.map((box) => box[3]))
  ];
}

export function highlightAvailable(block: EvidenceBlock | null | undefined): boolean {
  if (!block) return false;
  if (block.highlight_available === false) return false;
  return quoteLineBboxes(block).length > 0;
}

/** Context box only when quote lines exist and context meaningfully extends beyond them. */
export function contextBboxForDisplay(
  block: EvidenceBlock | null | undefined
): number[] | null {
  if (!block || !isBBox(block.context_bbox) || !highlightAvailable(block)) return null;
  const quote = preferredBbox(block);
  if (!quote) return null;
  const [qx0, qy0, qx1, qy1] = quote;
  const [cx0, cy0, cx1, cy1] = block.context_bbox;
  const qArea = Math.max(1, (qx1 - qx0) * (qy1 - qy0));
  const cArea = Math.max(1, (cx1 - cx0) * (cy1 - cy0));
  if (cArea < qArea * 1.35) return null;
  const heightRatio = (cy1 - cy0) / Math.max(1, qy1 - qy0);
  const widthRatio = (cx1 - cx0) / Math.max(1, qx1 - qx0);
  if (heightRatio < 1.25 && widthRatio < 1.25) return null;
  // Never paint a page-filling context rectangle.
  const pageH = block.page_height || 0;
  if (pageH > 0 && (cy1 - cy0) / pageH > 0.35) return null;
  return block.context_bbox;
}

export function missingRequirementItems(
  values: string[] | null | undefined
): { gaps: string[]; limitation: string | null } {
  const gaps: string[] = [];
  let limitation: string | null = null;
  for (const raw of values || []) {
    const value = (raw || "").trim();
    if (!value) continue;
    if (value.toLowerCase() === "exact unresolved requirements") continue;
    // Reference-style rows sometimes append a limitation after a blank line.
    const parts = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      gaps.push(parts[0].replace(/\s+/g, " "));
      limitation = parts.slice(1).join(" ");
    } else {
      gaps.push(value.replace(/\s+/g, " "));
    }
  }
  return { gaps, limitation };
}

export function formatMissingRequirements(values: string[] | null | undefined): string {
  const { gaps } = missingRequirementItems(values);
  if (!gaps.length) {
    return "Not identified — further review is required";
  }
  return gaps.join("; ");
}

export function getJudge(revision: ChartRevision | null | undefined): JudgeReport | null {
  return revision?.judge || null;
}

export function needsJudgeAttention(revision: ChartRevision | null | undefined): boolean {
  if (!revision) return false;
  const status = mappingReviewStatusLabel(revision);
  if (status === "Sent back" || status === "Flagged" || status === "Could not assess") {
    return true;
  }
  const judge = getJudge(revision);
  const decision = judge?.overall_decision;
  if (
    decision === "Needs review" ||
    decision === "Needs analyst review" ||
    decision === "Failed" ||
    decision === "Failed checks" ||
    decision === "Review incomplete"
  ) {
    return true;
  }
  if ((judge?.issue_count || 0) > 0 && decision !== "Passed checks") return true;
  return (
    revision.review_disposition === "flag" ||
    revision.review_disposition === "rework" ||
    revision.analysis_status === "incomplete" ||
    revision.mapping_review_incomplete === true
  );
}

export function isCriticalJudgeFinding(revision: ChartRevision | null | undefined): boolean {
  if (!revision) return false;
  const judge = getJudge(revision);
  if (judge?.critical) return true;
  if (judge?.overall_decision === "Failed checks" || judge?.overall_decision === "Failed") {
    return true;
  }
  if (revision.integrity?.pass === false) return true;
  return (judge?.criteria || []).some((c) => c.status === "Fail");
}

export function judgePrimaryFinding(revision: ChartRevision | null | undefined): string | null {
  const judge = getJudge(revision);
  if (!judge) return null;
  const criticalIssue = (judge.issues || []).find((i) => i.severity === "critical" || i.status === "Fail");
  if (criticalIssue?.issue) return criticalIssue.issue;
  if (judge.what_needs_attention && judge.overall_decision !== "Passed checks") {
    return judge.what_needs_attention;
  }
  if (judge.summary && judge.overall_decision !== "Passed checks") return judge.summary;
  return null;
}

export function reviewPhaseLabel(
  rows: { revisions: ChartRevision[] }[] | null | undefined,
  runStatus?: string,
  rechecking?: boolean
): { label: string; kind: "progress" | "done" | "attention" | "idle" } {
  if (rechecking) return { label: "Review in progress", kind: "progress" };
  if (
    runStatus &&
    ["queued", "selecting", "searching", "decomposing", "mapping", "reviewing"].includes(runStatus)
  ) {
    return { label: "Review in progress", kind: "progress" };
  }
  const revisions = (rows || []).map((row) => row.revisions.at(-1)).filter(Boolean) as ChartRevision[];
  if (!revisions.length) return { label: "Review not started", kind: "idle" };
  const incomplete = revisions.some((rev) => {
    const judge = getJudge(rev);
    return (
      !judge ||
      judge.legacy ||
      !(judge.criteria && judge.criteria.length >= 7) ||
      judge.overall_decision === "Review incomplete" ||
      judge.overall_decision === "Reviewing"
    );
  });
  if (incomplete) return { label: "Review in progress", kind: "progress" };
  const needs = revisions.some((rev) => needsJudgeAttention(rev) && !rev.analyst_disposition);
  if (needs) return { label: "Review done — analyst action needed", kind: "attention" };
  return { label: "Review done", kind: "done" };
}

export function judgeIssueCount(revision: ChartRevision | null | undefined): number {
  if (!revision) return 0;
  const judge = getJudge(revision);
  if (typeof judge?.issue_count === "number") return judge.issue_count;
  let count = 0;
  if (revision.integrity && revision.integrity.pass === false) count += 1;
  count += (revision.reasons || []).length;
  count += (revision.missing_requirements || []).filter(
    (value) => value.toLowerCase() !== "exact unresolved requirements"
  ).length;
  if (
    revision.review_disposition === "flag" ||
    revision.review_disposition === "rework" ||
    revision.mapping_review_status === "Incomplete"
  ) {
    count = Math.max(count, 1);
  }
  if (revision.analysis_status === "incomplete") count = Math.max(count, 1);
  return count;
}

const FINDING_TAG_LABELS: Record<string, string> = {
  quote_mismatch: "Quote mismatch",
  screenshot_mismatch: "Screenshot mismatch",
  wrong_edition: "Wrong edition",
  incorrect_citation: "Incorrect citation",
  unsupported_requirement: "Unsupported requirement",
  missing_condition: "Missing condition",
  label_disagreement: "Label disagreement",
  groundedness_fail: "Not grounded",
  accuracy_fail: "Accuracy issue",
  relevance_fail: "Relevance issue",
  needs_reconsider: "Needs reconsider",
  reviewer_error: "Reviewer error"
};

/** Analyst-facing hover text for every chart / Judge tag or status chip. */
const TAG_EXPLANATIONS: Record<string, string> = {
  // Finding / issue tags (slug + label forms)
  quote_mismatch:
    "The displayed quote was not found on the cited PDF page. The chart text does not match the source document.",
  "Quote mismatch":
    "The displayed quote was not found on the cited PDF page. The chart text does not match the source document.",
  screenshot_mismatch:
    "Screenshot is missing, or the linked screenshot does not correspond to a quote that appears on that page.",
  "Screenshot mismatch":
    "Screenshot is missing, or the linked screenshot does not correspond to a quote that appears on that page.",
  wrong_edition:
    "Evidence cites a different standard family or edition than the chart target. Wrong version invalidates the mapping.",
  "Wrong edition":
    "Evidence cites a different standard family or edition than the chart target. Wrong version invalidates the mapping.",
  incorrect_citation:
    "Section / page citation does not hold — the quote is not on the cited page, or the location cannot be verified in the document.",
  "Incorrect citation":
    "Section / page citation does not hold — the quote is not on the cited page, or the location cannot be verified in the document.",
  unsupported_requirement:
    "A claim requirement is not established by the cited standard text. Shared jargon alone is not enough.",
  "Unsupported requirement":
    "A claim requirement is not established by the cited standard text. Shared jargon alone is not enough.",
  missing_condition:
    "A required condition, range, or contextual limit in the claim is not shown in the cited evidence.",
  "Missing condition":
    "A required condition, range, or contextual limit in the claim is not shown in the cited evidence.",
  label_disagreement:
    "Full / Partial / No map does not match what the evidence actually supports. The label should be corrected.",
  "Label disagreement":
    "Full / Partial / No map does not match what the evidence actually supports. The label should be corrected.",
  groundedness_fail:
    "A chart assertion is not grounded in the cited standard text — the litigator flagged unsupported claims.",
  "Not grounded":
    "A chart assertion is not grounded in the cited standard text — the litigator flagged unsupported claims.",
  accuracy_fail:
    "Factual detail in the chart (equations, ranges, pages, variables) does not match the cited document.",
  "Accuracy issue":
    "Factual detail in the chart (equations, ranges, pages, variables) does not match the cited document.",
  relevance_fail:
    "Cited evidence is not relevant enough to this claim element (same-topic or decoder-only is not enough).",
  "Relevance issue":
    "Cited evidence is not relevant enough to this claim element (same-topic or decoder-only is not enough).",
  needs_reconsider:
    "Litigator flagged this for analyst reconsideration before approval.",
  "Needs reconsider":
    "Litigator flagged this for analyst reconsideration before approval.",
  reviewer_error:
    "The Judge tool failed or did not assess this criterion. Recheck to run the LLM verifier again.",
  "Reviewer error":
    "The Judge tool failed or did not assess this criterion. Recheck to run the LLM verifier again.",

  // Mapping labels
  "Full map":
    "Every requirement of this claim element is supported by the cited standard text, including mandatory conditions.",
  "Partial map":
    "Some requirements are supported, but gaps or conditions remain. Not enough alone to treat the claim as fully essential on this point.",
  "No map":
    "No adequate supporting passage was established after search. Absence of support is asserted, not invented evidence.",
  Abstain:
    "Mapping could not be completed (for example retrieval or integrity failure). This is not the same as No map.",
  "Analysis incomplete":
    "Mapping has not finished or was undetermined for this element.",

  // Evidence tier
  "Mandatory (shall)":
    "Cited text is treated as normative / mandatory standard language (shall). Strongest evidence tier for essentiality.",
  Conditional:
    "Support depends on a condition or context in the standard. Essentiality may be limited to that case.",
  "Optional / informative":
    "Informative or optional language (may / should). Not enough alone to prove the claim is essential.",
  "Tier unresolved":
    "Mandatory vs optional force of the citation has not been established yet.",

  // Source proof
  "Quote on page · screenshot linked":
    "Source integrity passed: the quote appears on the cited page and a screenshot is linked.",
  "Quote verified on page":
    "Source integrity passed: the quote appears on the cited page.",
  "No affirmative quote":
    "No-map row asserts absence of support; no quote or screenshot is required.",
  "Quote not verified on page":
    "Integrity failed — the cited quote was not confirmed on the source page.",
  "Screenshot linked · verify quote":
    "Screenshot is present; confirm the quote appears on the cited page.",
  "Quote linked · proof pending":
    "Evidence is linked but source proof is not fully confirmed yet.",
  "No source proof":
    "No linked passages on this revision, so quote/page proof cannot be shown.",

  // Check / Judge overall (Mapping Review)
  "Passed checks":
    "Mapping Review found no document mismatches on scored criteria for this revision.",
  Passed: "Mapping Review passed for this revision.",
  "Failed checks":
    "A required source check failed (for example quote, edition, or page mismatch). Do not rely on this row until fixed.",
  Flagged:
    "Mapping Review flagged this row for analyst attention — hard failure or soft findings that need a human call.",
  "Sent back":
    "Mapping Review sent this row back for revision (fixable issues / remapping).",
  "Needs review":
    "Something still needs analyst attention — ambiguity or incomplete assessment — not necessarily a hard document mismatch.",
  "Review incomplete":
    "Judge did not finish all criteria (often LLM not called or tool error). Recheck this revision.",
  "Could not assess":
    "Mapping Review could not fully assess this row or check (missing quote/screenshot, or incomplete rubric).",
  Reviewing: "Mapping Review is still running for this row.",
  "Not evaluated": "Mapping Review has not scored this revision yet.",

  // Match strength / requirement applicability (§4)
  "direct support":
    "Evidence directly supports the claim requirement without needing an inference.",
  inference:
    "Evidence supports the requirement only if an inference is accepted — explain the inference in the rationale.",
  "partial support":
    "Evidence supports part of the requirement; gaps remain.",
  "no supporting passage":
    "No supporting passage was found for this requirement after search.",
  required: "The standard requires this behavior for the selected scope.",
  "required only under condition":
    "The standard requires this behavior only under a stated condition.",
  optional: "The behavior is optional under the standard (may / should).",
  "described only": "The behavior is described but not required.",
  unclear: "It is unclear whether the standard requires this behavior.",

  // Criterion statuses
  Pass: "Verified against the source document or Judge LLM — no mismatch found for this criterion.",
  Fail: "Does not match the source document or the claimed support. Treat as an error until fixed.",
  Error: "Judge tool error while assessing this criterion. Recheck; do not treat as Pass.",
  "Not run": "LLM was not called for this criterion, so it has not been assessed yet.",
  "LLM not called": "LLM was not called for this criterion, so it has not been assessed yet.",
  "LLM error": "The Judge LLM call failed for this criterion. Recheck to try again.",
  "Not applicable":
    "This check does not apply (for example No-map rows with no affirmative quote or screenshot).",

  // Confidence
  "Analysis Confidence —": "Judge confidence score is not available yet for this revision.",
  "Confidence —": "LLM Judge confidence is not available yet for this claim.",

  // Evidence / chart badges
  "Exact edition":
    "Evidence cites the same standard edition locked for this chart. Wrong version would invalidate the mapping.",
  "Rejected / contextual candidate":
    "This passage was retrieved but is not treated as supporting evidence — context or a rejected candidate only.",

  // Criterion short labels
  "Verbatim quote":
    "Checks that every supporting quote appears verbatim on the cited source page.",
  "Screenshot match":
    "When a screenshot is present, the litigator LLM verifies it shows the cited quote passage; otherwise presence + page-text match.",
  "Standard & edition":
    "Checks that evidence comes from the chart’s target standard and exact edition.",
  "Section & page":
    "Checks that section/page citations point to a page that actually contains the quote.",
  "Evidence support assessment":
    "Strict litigator LLM check: does the cited standard text support each claim requirement (not shared jargon alone)?",
  "Rationale quality":
    "Strict litigator LLM check: rationale must be grounded, accurate, and correctly state support, conditions, and gaps.",
  "Mapping label":
    "LLM checks that Full / Partial / No map matches what the evidence actually supports."
};

export function humanFindingTag(tag: string): string {
  if (FINDING_TAG_LABELS[tag]) return FINDING_TAG_LABELS[tag];
  // Already humanised (spaces / Title Case from API)
  if (tag.includes(" ") || /^[A-Z]/.test(tag)) return tag;
  return tag.replace(/_/g, " ");
}

/** Hover explanation for any chart / Judge tag or chip label. */
export function explainTag(tag: string | null | undefined): string {
  const raw = (tag || "").trim();
  if (!raw) return "No description available for this tag.";
  if (TAG_EXPLANATIONS[raw]) return TAG_EXPLANATIONS[raw];
  const human = humanFindingTag(raw);
  if (TAG_EXPLANATIONS[human]) return TAG_EXPLANATIONS[human];
  // Analysis Confidence N/M or %
  if (/^Analysis Confidence/i.test(raw)) {
    return "Automated Judge rubric score for this revision (earned points ÷ applicable max). Provisional until all criteria are assessed. Not an essentiality probability.";
  }
  return `${human}: review the Report finding for this tag.`;
}

export type IssueTag = { label: string; explanation: string };

/** Issue tags only (screenshot mismatch, incorrect citation, …) — not context tags. */
export function mappingIssueTags(revision: ChartRevision | null | undefined): string[] {
  return mappingIssueTagDetails(revision).map((item) => item.label);
}

export function mappingIssueTagDetails(revision: ChartRevision | null | undefined): IssueTag[] {
  const judge = getJudge(revision);
  const tags = new Set<string>();
  for (const tag of judge?.finding_tags || []) {
    tags.add(humanFindingTag(tag));
  }
  for (const criterion of judge?.criteria || []) {
    // Only true mismatches / tool errors count as issues — not soft Needs review.
    if (!["Fail", "Error"].includes(criterion.status)) continue;
    for (const tag of criterion.tags || []) {
      tags.add(humanFindingTag(tag));
    }
  }
  return [...tags]
    .filter((tag) =>
      /screenshot|quote|wrong|incorrect|unsupported|disagreement|error|mismatch|missing|citation/i.test(
        tag
      )
    )
    .map((label) => ({ label, explanation: explainTag(label) }));
}

/** @deprecated use mappingIssueTags — kept for callers that still want all tags. */
export function mappingFindingTags(revision: ChartRevision | null | undefined): string[] {
  const judge = getJudge(revision);
  const tags = new Set<string>(mappingIssueTags(revision));
  for (const tag of judge?.evidence_context_tags || []) {
    tags.add(tag);
  }
  return [...tags];
}

function confidenceBand(pct: number): "high" | "mid" | "low" {
  if (pct >= 80) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

/** LLM Judge confidence for the claim (0–100) with dimension breakdown. */
export function mappingConfidence(
  revision: ChartRevision | null | undefined
): {
  label: string;
  kind: "high" | "mid" | "low" | "none";
  percent: number | null;
  scoreText: string;
  rationale?: string | null;
  dimensions?: {
    key: string;
    label: string;
    status?: string;
    score?: number | null;
    finding?: string;
  }[];
} | null {
  const judge = getJudge(revision);
  if (!judge || judge.legacy) return null;

  const conf = judge.confidence;
  if (conf && typeof conf.score === "number") {
    const score = Math.max(0, Math.min(100, Math.round(conf.score)));
    const dims = (
      [
        ["completeness", "Completeness", conf.completeness || judge.completeness],
        ["accuracy", "Accuracy", conf.accuracy || judge.accuracy],
        ["groundedness", "Groundedness", conf.groundedness || judge.groundedness],
        ["fact_check", "Fact check", conf.fact_check || judge.fact_check],
        ["relevance", "Relevance", conf.relevance || judge.relevance]
      ] as const
    )
      .filter(([, , dim]) => Boolean(dim))
      .map(([key, label, dim]) => ({
        key,
        label,
        status: dim?.status,
        score: dim?.score ?? null,
        finding: dim?.finding
      }));
    return {
      label: `Confidence ${score}%`,
      scoreText: `${score}%`,
      percent: score,
      kind: confidenceBand(score),
      rationale: conf.rationale || judge.summary || null,
      dimensions: dims
    };
  }

  // Fallback: rubric earned/max when litigator confidence not yet stored.
  const earned = judge.earned_points;
  const max = judge.max_points;
  if (earned == null || max == null || max <= 0) {
    if (judge.rubric_score == null) return null;
    const score = judge.rubric_score;
    return {
      label: `Confidence ${score}%`,
      scoreText: `${score}%`,
      percent: score,
      kind: confidenceBand(score),
      rationale: judge.summary || null
    };
  }
  const pct = Math.round((100 * earned) / max);
  return {
    label: `Confidence ${pct}%`,
    scoreText: `${pct}%`,
    percent: pct,
    kind: confidenceBand(pct),
    rationale: judge.summary || null
  };
}

export type ReadStrength =
  | "Very Strong"
  | "Strong"
  | "Moderate"
  | "Weak"
  | "Insufficient"
  | "Not evaluated";

/**
 * How strongly the cited evidence supports the claim element for analyst triage.
 * Combines mapping label, analysis confidence, and failed checks.
 */
export function evidenceReadStrength(
  revision: ChartRevision | null | undefined
): { label: ReadStrength; kind: "very-strong" | "strong" | "moderate" | "weak" | "insufficient" | "muted"; detail: string } {
  if (!revision) {
    return { label: "Not evaluated", kind: "muted", detail: "No revision yet." };
  }
  const mapping = revision.mapping_label;
  const judge = getJudge(revision);
  const confidence = mappingConfidence(revision);
  const pct = confidence?.percent;
  const failed =
    judge?.overall_decision === "Failed checks" ||
    judge?.overall_decision === "Failed" ||
    revision.integrity?.pass === false;
  const incomplete =
    !mapping ||
    mapping === "Abstain" ||
    revision.analysis_status === "incomplete" ||
    judge?.overall_decision === "Review incomplete" ||
    judge?.legacy;

  if (incomplete && !mapping) {
    return {
      label: "Not evaluated",
      kind: "muted",
      detail: "Mapping analysis is incomplete."
    };
  }
  if (mapping === "No map") {
    return {
      label: "Insufficient",
      kind: "insufficient",
      detail: "No map — cited material does not support this element."
    };
  }
  if (failed) {
    return {
      label: "Insufficient",
      kind: "insufficient",
      detail: "Required source checks failed; do not rely on this evidence yet."
    };
  }
  if (mapping === "Full map") {
    if (pct != null && pct >= 85 && !needsJudgeAttention(revision)) {
      return {
        label: "Very Strong",
        kind: "very-strong",
        detail: "Full map with high analysis confidence and no open required issues."
      };
    }
    if (pct != null && pct >= 70) {
      return {
        label: "Strong",
        kind: "strong",
        detail: "Full map with solid analysis confidence; confirm open review items."
      };
    }
    if (pct != null && pct < 50) {
      return {
        label: "Weak",
        kind: "weak",
        detail: "Full map claimed but analysis confidence is below 50%."
      };
    }
    return {
      label: "Moderate",
      kind: "moderate",
      detail: "Full map with unresolved review items or mid confidence."
    };
  }
  if (mapping === "Partial map") {
    if (pct != null && pct >= 80) {
      return {
        label: "Moderate",
        kind: "moderate",
        detail: "Partial map — strong checks, but claim coverage is incomplete."
      };
    }
    if (pct != null && pct < 50) {
      return {
        label: "Weak",
        kind: "weak",
        detail: "Partial map with analysis confidence below 50%."
      };
    }
    return {
      label: "Weak",
      kind: "weak",
      detail: "Partial map — evidence supports only part of the element."
    };
  }
  return {
    label: "Not evaluated",
    kind: "muted",
    detail: "Read strength not available for this revision."
  };
}

export function mappingReviewStatusLabel(
  revision: ChartRevision | null | undefined
): string {
  if (revision?.mapping_review_status) return revision.mapping_review_status;
  const decision = getJudge(revision)?.overall_decision;
  if (decision === "Passed checks") return "Passed";
  if (decision === "Failed checks" || decision === "Failed") return "Flagged";
  if (decision === "Review incomplete") return "Could not assess";
  if (decision === "Needs analyst review" || decision === "Needs review") return "Flagged";
  if (revision?.review_disposition === "rework") return "Sent back";
  if (revision?.review_disposition === "flag") return "Flagged";
  if (revision?.review_disposition === "pass") return "Passed";
  return "Pending";
}

export function mappingCheckStatus(
  revision: ChartRevision | null | undefined
): { label: string; kind: "pass" | "fail" | "needs" | "incomplete" | "muted" } {
  const status = mappingReviewStatusLabel(revision);
  if (status === "Passed") return { label: "Passed", kind: "pass" };
  if (status === "Flagged" || status === "Failed") return { label: "Flagged", kind: "fail" };
  if (status === "Sent back") return { label: "Sent back", kind: "needs" };
  if (status === "Could not assess" || status === "Incomplete") {
    return { label: "Could not assess", kind: "incomplete" };
  }
  if (status === "Reviewing") return { label: "Reviewing", kind: "muted" };
  return { label: status || "Not evaluated", kind: "muted" };
}

export function mappingCheckSummary(revision: ChartRevision | null | undefined): string {
  const judge = getJudge(revision);
  if (!judge || judge.legacy) {
    return "Mapping Review not scored yet. Open Mapping Review to run or recheck.";
  }
  if (judge.what_needs_attention && judge.overall_decision !== "Passed checks") {
    return judge.what_needs_attention;
  }
  if (judge.next_action && judge.overall_decision !== "Passed checks") {
    return judge.next_action;
  }
  if (judge.summary) return judge.summary;
  if (judge.overall_decision === "Passed checks") {
    return judge.what_passed || "Automated checks passed for this revision.";
  }
  return "Open Mapping Review for criterion scores and findings.";
}

export function judgeButtonLabel(
  revision: ChartRevision | null | undefined,
  runStatus?: string
): string {
  const base = "Mapping Review";
  if (!revision) {
    if (
      runStatus &&
      ["queued", "selecting", "searching", "decomposing", "mapping", "reviewing"].includes(
        runStatus
      )
    ) {
      return `${base} · Reviewing`;
    }
    return base;
  }
  const status = mappingReviewStatusLabel(revision);
  if (status === "Passed") return `${base} · Passed`;
  if (status === "Sent back") return `${base} · Sent back`;
  if (status === "Flagged" || status === "Failed") {
    const n = judgeIssueCount(revision);
    return n > 1 ? `${base} · ${n} issues` : `${base} · Flagged`;
  }
  if (status === "Could not assess" || status === "Incomplete") {
    return `${base} · Could not assess`;
  }
  if (status === "Reviewing") return `${base} · Reviewing`;
  if (revision.integrity && revision.integrity.pass === false) {
    const n = judgeIssueCount(revision);
    return n > 1 ? `${base} · ${n} issues` : `${base} · Flagged`;
  }
  const issues = judgeIssueCount(revision);
  if (issues > 0) {
    return issues === 1 ? `${base} · 1 issue` : `${base} · ${issues} issues`;
  }
  if (!revision.review_disposition) {
    return runStatus && ["reviewing", "mapping"].includes(runStatus)
      ? `${base} · Reviewing`
      : base;
  }
  return `${base} · Passed`;
}

export function criterionStatusClass(status: string | undefined): string {
  const value = (status || "").toLowerCase();
  if (value === "pass") return "pass";
  if (value === "fail" || value === "failed" || value === "error") return "fail";
  if (value === "needs review" || value === "sent back") return "needs";
  if (value === "not applicable" || value === "could not assess") return "na";
  if (value === "not run" || value === "review incomplete") return "incomplete";
  if (value === "flagged") return "fail";
  return "muted";
}

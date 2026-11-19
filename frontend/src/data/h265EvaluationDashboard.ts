/** Locked pack from H265_Claim_Chart_Evaluation.xlsx — executive dashboard source. */

export type CriterionStatus = "Ready" | "Needs Work" | "Blocker";

export type CriterionCard = {
  id: string;
  name: string;
  pass: number;
  total: number;
  rate: number;
  status: CriterionStatus;
  note: string;
};

export type EvalRow = {
  id: string;
  alignedRef: string;
  agentLabel: string;
  expectedLabel: string;
  failed: string[];
  tag: string;
  note: string;
  attorneyReview: boolean;
};

export type FailureModeBar = {
  id: string;
  label: string;
  count: number;
  total: number;
};

export type LabelBreakdownItem = {
  id: string;
  label: string;
  count: number;
  tone: "safe" | "ok" | "warn" | "bad" | "muted";
};

export const H265_EVAL_DASHBOARD = {
  source: "H265_Claim_Chart_Evaluation.xlsx",
  metadata: {
    patent: "US10063856B2 (Claim 1)",
    target: "ITU-T H.265 V10 (07/2024)",
    evaluatedElements: 8,
    groundTruthElements: 3,
    releaseStatus: "BLOCKED — NOT READY FOR ATTORNEY REVIEW",
    safeOverClaimBadge: "0 False Full-Maps (Safe from Over-Claiming)"
  },
  criteria: [
    {
      id: "C01",
      name: "Right Standard & Edition",
      pass: 8,
      total: 8,
      rate: 100,
      status: "Ready" as const,
      note: "Locked onto H.265 V10 (07/2024)."
    },
    {
      id: "C02",
      name: "Quote Real & Verbatim",
      pass: 8,
      total: 8,
      rate: 100,
      status: "Ready" as const,
      note: "Zero hallucinated text; 100% substring match."
    },
    {
      id: "C03",
      name: "Source, Section & Page",
      pass: 0,
      total: 8,
      rate: 0,
      status: "Blocker" as const,
      note: "+18 PDF page offset bug & missing section IDs."
    },
    {
      id: "C04",
      name: "Screenshot Match",
      pass: 3,
      total: 8,
      rate: 37.5,
      status: "Blocker" as const,
      note: "Bounding boxes drift or truncate referenced tables."
    },
    {
      id: "C05",
      name: "Rationale Supports Element",
      pass: 0,
      total: 8,
      rate: 0,
      status: "Blocker" as const,
      note: "Confuses CABAC/SEI passages & misreads bounds."
    },
    {
      id: "C06",
      name: "Mapping Label Correct",
      pass: 5,
      total: 8,
      rate: 62.5,
      status: "Needs Work" as const,
      note: "3 false No-maps; 2 accidental Partial-maps."
    }
  ] satisfies CriterionCard[],
  failureModes: [
    {
      id: "page_section",
      label: "Page/Section Metadata Errors",
      count: 8,
      total: 8
    },
    {
      id: "rationale",
      label: "Technical Retrieval/Rationale Errors",
      count: 8,
      total: 8
    },
    {
      id: "screenshot",
      label: "Screenshot Bounding-Box Drift",
      count: 5,
      total: 8
    },
    {
      id: "false_neg",
      label: "False Negative Labels",
      count: 3,
      total: 8
    }
  ] satisfies FailureModeBar[],
  labelAlignment: {
    groundTruth: "All 8 aligned to Partial map",
    items: [
      { id: "valid_partial", label: "Valid Partial", count: 3, tone: "ok" },
      { id: "accidental", label: "Accidental Partial", count: 2, tone: "warn" },
      { id: "false_no", label: "False No-Map", count: 3, tone: "bad" },
      { id: "false_full", label: "False Full-Map", count: 0, tone: "safe" }
    ] satisfies LabelBreakdownItem[]
  },
  rows: [
    {
      id: "1[a]",
      alignedRef: "1[a]",
      agentLabel: "Partial map",
      expectedLabel: "Partial map",
      failed: ["C03", "C04", "C05"],
      tag: "Accidental Match / Wrong Citation",
      note: "Cites Tone Mapping SEI (§D.2.15) instead of §3.53; printed/PDF page mismatch.",
      attorneyReview: true
    },
    {
      id: "1[b]",
      alignedRef: "1[b]",
      agentLabel: "No map",
      expectedLabel: "Partial map",
      failed: ["C03", "C04", "C05", "C06"],
      tag: "False Negative",
      note: "Retrieves Eq. 8-287/288 but falsely outputs No map; missing section IDs.",
      attorneyReview: false
    },
    {
      id: "1[c]",
      alignedRef: "1[b]",
      agentLabel: "Partial map",
      expectedLabel: "Partial map",
      failed: ["C03", "C04", "C05"],
      tag: "Crop & Bounds Error",
      note: "Screenshot cuts off Table 8-10; claims lower bound 0 is missing.",
      attorneyReview: true
    },
    {
      id: "1[d]",
      alignedRef: "1[b]",
      agentLabel: "No map",
      expectedLabel: "Partial map",
      failed: ["C03", "C05", "C06"],
      tag: "False Negative",
      note: "Cites §8.6.2 (actually §7.4.7.1) and misses luma QpY range.",
      attorneyReview: false
    },
    {
      id: "1[e]",
      alignedRef: "1[b]",
      agentLabel: "Partial map",
      expectedLabel: "Partial map",
      failed: ["C03", "C04", "C05"],
      tag: "Crop Drift & Self-Contradiction",
      note: "Screenshot highlights wrong paragraph; contradicts Eq. 8-285 quote.",
      attorneyReview: true
    },
    {
      id: "1[f]",
      alignedRef: "1[c]",
      agentLabel: "No map",
      expectedLabel: "Partial map",
      failed: ["C03", "C04", "C05", "C06"],
      tag: "False Negative",
      note: "Misses §0.7/§8.6.2 transform passages; cites wrong section headers.",
      attorneyReview: false
    },
    {
      id: "1[g]",
      alignedRef: "1[c]",
      agentLabel: "Partial map",
      expectedLabel: "Partial map",
      failed: ["C03", "C05"],
      tag: "Wrong Equation Cited",
      note: "Retrieves Eq. 8-287 instead of §8.6.2 Eq. 8-292/293.",
      attorneyReview: true
    },
    {
      id: "1[h]",
      alignedRef: "1[c]",
      agentLabel: "Partial map",
      expectedLabel: "Partial map",
      failed: ["C03", "C05"],
      tag: "Accidental Match / Domain Confusion",
      note: "Confuses CABAC arithmetic quantization (§9.3) with transform quantization.",
      attorneyReview: true
    }
  ] satisfies EvalRow[]
};

export type RowFilterTab =
  | "all"
  | "blockers"
  | "false_no_maps"
  | "accidental"
  | "attorney";

export function filterEvalRows(
  rows: EvalRow[],
  tab: RowFilterTab,
  criterionId: string | null
): EvalRow[] {
  let next = rows;
  if (criterionId) {
    next = next.filter((r) => r.failed.includes(criterionId));
  }
  switch (tab) {
    case "blockers":
      return next.filter((r) => r.failed.length > 0);
    case "false_no_maps":
      return next.filter((r) => r.tag === "False Negative");
    case "accidental":
      return next.filter((r) => r.tag.toLowerCase().includes("accidental"));
    case "attorney":
      return next.filter((r) => r.attorneyReview);
    default:
      return next;
  }
}

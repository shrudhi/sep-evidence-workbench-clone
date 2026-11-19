/** Sample iteration history locked to frozen reference expected-claim1-v1 v1.0.0 */

export type CriterionId = "C01" | "C02" | "C03" | "C04" | "C05" | "C06";

export type CriterionSnapshot = {
  id: CriterionId;
  name: string;
  pass: number;
  total: number;
  rate: number;
  status: "Ready" | "Needs Work" | "Blocker";
  note?: string;
};

export type IterationRun = {
  id: string;
  shortId: string;
  timestamp: string; // display UTC
  iso: string;
  label: string;
  changeNote: string;
  gateStatus: "BLOCKED — NOT READY FOR ATTORNEY REVIEW" | "CONDITIONAL GO — HUMAN REVIEW REQUIRED";
  falseFullMaps: number;
  baselineId: string;
  baselineVersion: string;
  criteria: CriterionSnapshot[];
};

export const FROZEN_BASELINE = {
  id: "expected-claim1-v1",
  version: "1.0.0",
  statusLabel: "Provisional technical reference; no SEP expert/attorney sign-off",
  scope:
    "Frozen Scope: US10063856B2 Claim 1 · ITU-T H.265 V10 (07/2024) · 8 Aligned Elements"
};

export const CRITERION_META: Array<{ id: CriterionId; name: string; color: string }> = [
  { id: "C01", name: "Standard & Edition", color: "#059669" },
  { id: "C02", name: "Verbatim Quote", color: "#0f766e" },
  { id: "C03", name: "Source, Section & Page", color: "#2563eb" },
  { id: "C04", name: "Screenshot Match", color: "#7c3aed" },
  { id: "C05", name: "Rationale Logic", color: "#c2410c" },
  { id: "C06", name: "Mapping Label", color: "#be123c" }
];

function criteriaFromRates(
  rates: Record<CriterionId, number>,
  notes: Partial<Record<CriterionId, string>> = {}
): CriterionSnapshot[] {
  const names: Record<CriterionId, string> = {
    C01: "Standard & Edition",
    C02: "Verbatim Quote",
    C03: "Source, Section & Page",
    C04: "Screenshot Match",
    C05: "Rationale Logic",
    C06: "Mapping Label (Full/Partial/No)"
  };
  const total = 8;
  const order: CriterionId[] = ["C01", "C02", "C03", "C04", "C05", "C06"];
  return order.map((id) => {
    const rate = rates[id];
    const pass = Math.round((rate / 100) * total);
    const status: CriterionSnapshot["status"] =
      rate >= 100 ? "Ready" : rate >= 60 ? "Needs Work" : "Blocker";
    return {
      id,
      name: names[id],
      pass,
      total,
      rate,
      status,
      note: notes[id]
    };
  });
}

export const ITERATION_HISTORY: IterationRun[] = [
  {
    id: "eval-a4d4d0c4",
    shortId: "a4d4d0c4",
    timestamp: "2026-11-18 14:10 UTC",
    iso: "2026-11-18T14:10:00Z",
    label: "Baseline",
    changeNote: "Baseline — initial H.265 Claim 1 evaluation against frozen reference",
    gateStatus: "BLOCKED — NOT READY FOR ATTORNEY REVIEW",
    falseFullMaps: 0,
    baselineId: FROZEN_BASELINE.id,
    baselineVersion: FROZEN_BASELINE.version,
    criteria: criteriaFromRates(
      { C01: 100, C02: 100, C03: 0, C04: 37.5, C05: 0, C06: 62.5 },
      {
        C03: "+18 PDF page offset & missing section IDs",
        C04: "Bounding-box drift & table truncation",
        C05: "CABAC/SEI domain confusion & bounds misread",
        C06: "3 false No-maps; 2 accidental Partial-maps"
      }
    )
  },
  {
    id: "eval-b8812f1a",
    shortId: "b8812f1a",
    timestamp: "2026-11-19 09:45 UTC",
    iso: "2026-11-19T09:45:00Z",
    label: "Page offset fix",
    changeNote: "Fixed +18 PDF page offset & added Clause 7–8 reranker",
    gateStatus: "BLOCKED — NOT READY FOR ATTORNEY REVIEW",
    falseFullMaps: 0,
    baselineId: FROZEN_BASELINE.id,
    baselineVersion: FROZEN_BASELINE.version,
    criteria: criteriaFromRates(
      { C01: 100, C02: 100, C03: 87.5, C04: 37.5, C05: 0, C06: 62.5 },
      {
        C03: "Page offset corrected; residual section ID gaps on 1/8",
        C04: "Bounding-box drift & table truncation",
        C05: "CABAC/SEI domain confusion & bounds misread",
        C06: "3 false No-maps; 2 accidental Partial-maps"
      }
    )
  },
  {
    id: "eval-c11923b4",
    shortId: "c11923b4",
    timestamp: "2026-11-19 12:30 UTC",
    iso: "2026-11-19T12:30:00Z",
    label: "Crop padding fix",
    changeNote: "Crop padding fix — expanded screenshot bounds around tables",
    gateStatus: "BLOCKED — NOT READY FOR ATTORNEY REVIEW",
    falseFullMaps: 0,
    baselineId: FROZEN_BASELINE.id,
    baselineVersion: FROZEN_BASELINE.version,
    criteria: criteriaFromRates(
      { C01: 100, C02: 100, C03: 87.5, C04: 87.5, C05: 0, C06: 62.5 },
      {
        C03: "Page offset corrected; residual section ID gaps on 1/8",
        C04: "Crop padding improved table capture; 1/8 still drifts",
        C05: "CABAC/SEI domain confusion & bounds misread",
        C06: "3 false No-maps; 2 accidental Partial-maps"
      }
    )
  }
];

export function deltaVsPrevious(
  runs: IterationRun[],
  runIndex: number,
  criterionId: CriterionId
): number | null {
  if (runIndex <= 0) return null;
  const curr = runs[runIndex].criteria.find((c) => c.id === criterionId)?.rate ?? 0;
  const prev = runs[runIndex - 1].criteria.find((c) => c.id === criterionId)?.rate ?? 0;
  return Number((curr - prev).toFixed(1));
}

export function formatDelta(delta: number | null): { text: string; tone: "flat" | "up" | "down" } {
  if (delta == null || delta === 0) return { text: "0.0% —", tone: "flat" };
  if (delta > 0) return { text: `▲ +${delta}%`, tone: "up" };
  return { text: `▼ ${delta}%`, tone: "down" };
}

import type { Chart, ChartRevision, EvidenceBlock } from "./types";

/** Industry chart anatomy — shown on the claim chart surface. */
export const CHART_COMPONENTS = [
  {
    id: "decomposition",
    title: "Claim decomposition",
    detail: "Preamble + each limitation as a discrete test"
  },
  {
    id: "edition",
    title: "Exact standard edition",
    detail: "Wrong version kills the chart"
  },
  {
    id: "citations",
    title: "Pinpoint citations",
    detail: "Clause / section / table + quoted normative text"
  },
  {
    id: "tier",
    title: "Evidence tier",
    detail: "shall (mandatory) vs conditional vs optional"
  },
  {
    id: "rationale",
    title: "Rationale",
    detail: "Alignment in the standard’s words, not claim paraphrase as evidence"
  },
  {
    id: "gaps",
    title: "Not established",
    detail: "Unsupported requirements called out openly"
  },
  {
    id: "coherence",
    title: "Coherence",
    detail: "Citations across rows must not contradict each other"
  },
  {
    id: "screenshots",
    title: "Screenshots / source proof",
    detail: "Quote must exist on the cited page"
  }
] as const;

export type EvidenceTier = {
  key: string;
  label: string;
  kind: "full" | "partial" | "needs" | "muted" | "none";
  detail: string;
};

export function evidenceTier(status: string | null | undefined): EvidenceTier {
  const value = (status || "").toLowerCase().trim();
  if (value === "normative") {
    return {
      key: "normative",
      label: "Mandatory (shall)",
      kind: "full",
      detail: "Cited text is treated as normative / mandatory standard language."
    };
  }
  if (value === "conditional") {
    return {
      key: "conditional",
      label: "Conditional",
      kind: "partial",
      detail: "Support depends on a condition or context in the standard."
    };
  }
  if (value === "informative") {
    return {
      key: "informative",
      label: "Optional / informative",
      kind: "needs",
      detail: "Informative or optional language — not enough alone for essentiality."
    };
  }
  if (value === "unresolved" || value === "none" || !value) {
    return {
      key: "unresolved",
      label: "Tier unresolved",
      kind: "muted",
      detail: "Mandatory vs optional force of the citation is not established."
    };
  }
  return {
    key: value,
    label: status || "Tier unknown",
    kind: "muted",
    detail: "Evidence tier reported by the mapper."
  };
}

export function sourceProofStatus(revision: ChartRevision | null | undefined): {
  label: string;
  kind: "pass" | "fail" | "needs" | "muted";
  detail: string;
} {
  if (!revision) {
    return { label: "Source proof —", kind: "muted", detail: "No revision yet." };
  }
  const blocks = revision.evidence_blocks || [];
  const withShot = blocks.filter((b) => b.available && b.screenshot_url).length;
  const integrity = revision.integrity;
  if (revision.mapping_label === "No map" && !blocks.length) {
    return {
      label: "No affirmative quote",
      kind: "pass",
      detail: "No-map row asserts absence of support; no quote/screenshot required."
    };
  }
  if (integrity && integrity.pass === false) {
    return {
      label: "Quote not verified on page",
      kind: "fail",
      detail: "Integrity failed — cited quote was not confirmed on the source page."
    };
  }
  if (integrity && integrity.pass === true && blocks.length) {
    return {
      label: withShot ? "Quote on page · screenshot linked" : "Quote verified on page",
      kind: "pass",
      detail: "Source integrity passed for linked evidence on this revision."
    };
  }
  if (blocks.length && withShot) {
    return {
      label: "Screenshot linked · verify quote",
      kind: "needs",
      detail: "Screenshot present; confirm the quote appears on the cited page."
    };
  }
  if (blocks.length) {
    return {
      label: "Quote linked · proof pending",
      kind: "needs",
      detail: "Evidence is linked but source proof is not fully confirmed."
    };
  }
  return {
    label: "No source proof",
    kind: "muted",
    detail: "No linked passages on this revision."
  };
}

export type CoherenceIssue = {
  id: string;
  severity: "critical" | "attention";
  message: string;
};

function editionKey(edition: string | null | undefined): string {
  return (edition || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function chartCoherence(chart: Chart | null | undefined): {
  ok: boolean;
  issues: CoherenceIssue[];
  summary: string;
} {
  if (!chart) {
    return { ok: true, issues: [], summary: "No chart loaded." };
  }
  const issues: CoherenceIssue[] = [];
  const targetEdition = editionKey(chart.run.edition);
  const targetFamily = (chart.run.family || "").toLowerCase();
  const supportUse = new Map<string, string[]>();
  const counterUse = new Map<string, string[]>();

  for (const row of chart.rows) {
    const latest = row.revisions.at(-1);
    if (!latest) continue;
    const blocks: EvidenceBlock[] = [
      ...(latest.evidence_blocks || []),
      ...(latest.candidate_blocks || [])
    ];
    for (const block of blocks) {
      if (!block.available || !block.source) continue;
      const family = (block.source.family || "").toLowerCase();
      const edition = editionKey(block.source.edition);
      if (targetFamily && family && !family.includes(targetFamily) && !targetFamily.includes(family)) {
        issues.push({
          id: `family-${row.label}-${block.evidence_id}`,
          severity: "critical",
          message: `${row.label}: evidence family “${block.source.family}” does not match chart target “${chart.run.family}”.`
        });
      }
      if (targetEdition && edition && edition !== targetEdition) {
        issues.push({
          id: `edition-${row.label}-${block.evidence_id}`,
          severity: "critical",
          message: `${row.label}: evidence edition “${block.source.edition}” ≠ chart edition “${chart.run.edition}”.`
        });
      }
      const bucket = block.role === "candidate" ? counterUse : supportUse;
      const list = bucket.get(block.evidence_id) || [];
      list.push(row.label);
      bucket.set(block.evidence_id, list);
    }
  }

  for (const [evidenceId, supportRows] of supportUse) {
    const counterRows = counterUse.get(evidenceId);
    if (counterRows?.length) {
      issues.push({
        id: `dual-${evidenceId}`,
        severity: "attention",
        message: `Passage ${evidenceId} is supporting on ${supportRows.join(", ")} and rejected/context on ${counterRows.join(", ")}.`
      });
    }
  }

  // Deduplicate by message
  const seen = new Set<string>();
  const unique = issues.filter((issue) => {
    if (seen.has(issue.message)) return false;
    seen.add(issue.message);
    return true;
  });

  if (!unique.length) {
    return {
      ok: true,
      issues: [],
      summary: "No cross-row edition or citation conflicts detected on latest revisions."
    };
  }
  const critical = unique.filter((i) => i.severity === "critical").length;
  return {
    ok: false,
    issues: unique,
    summary: critical
      ? `${critical} critical coherence issue${critical === 1 ? "" : "s"} across rows.`
      : `${unique.length} coherence note${unique.length === 1 ? "" : "s"} across rows.`
  };
}

export function requirementCategoryLabel(category: string | null | undefined): string {
  const value = (category || "").toLowerCase();
  const map: Record<string, string> = {
    actor: "Actor",
    operation: "Operation",
    input: "Input",
    relationship: "Relationship",
    range: "Range",
    condition: "Condition",
    preamble: "Preamble"
  };
  return map[value] || (category ? category : "Limitation");
}

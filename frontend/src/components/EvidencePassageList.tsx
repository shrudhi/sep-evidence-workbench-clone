import { pageGroupKey, formatPrintedPage } from "../evidenceQuote";
import type { EvidenceBlock } from "../types";
import EvidenceBlockCard from "./EvidenceBlockCard";

type Props = {
  blocks: EvidenceBlock[];
  activeEvidenceId?: string | null;
  onOpenDocument?: (block: EvidenceBlock) => void;
  emptyLabel?: string;
  title?: string;
  targetEdition?: string | null;
  evidenceTierLabel?: string | null;
};

function groupLabel(blocks: EvidenceBlock[], index: number, total: number): string {
  const first = blocks[0];
  if (!first) return "Passages";
  const printed = formatPrintedPage(first.printed_label);
  const pdf = first.page_ordinal;
  const page =
    printed && pdf != null
      ? `Printed p. ${printed} · PDF p. ${pdf}`
      : printed
        ? `Printed p. ${printed}`
        : pdf != null
          ? `PDF p. ${pdf}`
          : "Page not resolved";
  if (total > 1) return `Proof ${index + 1} of ${total} · ${page}`;
  return page;
}

export default function EvidencePassageList({
  blocks,
  activeEvidenceId,
  onOpenDocument,
  emptyLabel = "No linked passages yet",
  title = "",
  targetEdition = null,
  evidenceTierLabel = null
}: Props) {
  if (!blocks.length) {
    return <div className="evidence-empty">{emptyLabel}</div>;
  }

  // One group per PDF page so each page keeps its own Source / Quote / Screenshot.
  const groups: { key: string; blocks: EvidenceBlock[] }[] = [];
  for (const block of blocks) {
    const key = pageGroupKey(block);
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.blocks.push(block);
    else groups.push({ key, blocks: [block] });
  }

  const multiPage = groups.length > 1;

  return (
    <div className="evidence-passage-list">
      {title ? <div className="evidence-passage-list-title">{title}</div> : null}
      {multiPage ? (
        <div className="doc-sub" style={{ marginBottom: 8 }}>
          Evidence spans {groups.length} pages — each page has its own quote and screenshot.
        </div>
      ) : null}
      {groups.map((group, index) => (
        <section key={group.key} className="evidence-page-group">
          {multiPage ? (
            <header className="evidence-page-group-head">
              <span className="evidence-page-group-label">
                {groupLabel(group.blocks, index, groups.length)}
              </span>
            </header>
          ) : null}
          {group.blocks.map((block) => (
            <EvidenceBlockCard
              key={block.evidence_id}
              block={block}
              active={activeEvidenceId === block.evidence_id}
              onOpenDocument={onOpenDocument}
              targetEdition={targetEdition}
              evidenceTierLabel={evidenceTierLabel}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

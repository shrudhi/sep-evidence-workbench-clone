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

function groupLabel(blocks: EvidenceBlock[]): string {
  const first = blocks[0];
  if (!first) return "Passages";
  const printed = formatPrintedPage(first.printed_label);
  const pdf = first.page_ordinal;
  if (printed && pdf != null) return `Printed p. ${printed} · PDF p. ${pdf}`;
  if (printed) return `Printed p. ${printed}`;
  if (pdf != null) return `PDF p. ${pdf}`;
  return "Page not resolved";
}

export default function EvidencePassageList({
  blocks,
  activeEvidenceId,
  onOpenDocument,
  emptyLabel = "No linked passages yet",
  title = "Standard passages",
  targetEdition = null,
  evidenceTierLabel = null
}: Props) {
  if (!blocks.length) {
    return <div className="evidence-empty">{emptyLabel}</div>;
  }

  const groups: { key: string; blocks: EvidenceBlock[] }[] = [];
  for (const block of blocks) {
    const key = pageGroupKey(block);
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.blocks.push(block);
    else groups.push({ key, blocks: [block] });
  }

  return (
    <div className="evidence-passage-list">
      {title !== "Standard passages" ? (
        <div className="evidence-passage-list-title">{title}</div>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} className="evidence-page-group">
          {groups.length > 1 ? (
            <header className="evidence-page-group-head">
              <span className="evidence-page-group-label">{groupLabel(group.blocks)}</span>
              <span className="doc-sub">
                {group.blocks.length} passage{group.blocks.length === 1 ? "" : "s"}
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

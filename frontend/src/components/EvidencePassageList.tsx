import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
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

function groupMeta(blocks: EvidenceBlock[], index: number, total: number) {
  const first = blocks[0];
  const printed = first ? formatPrintedPage(first.printed_label) : null;
  const pdf = first?.page_ordinal;
  const page =
    printed && pdf != null
      ? `Printed p. ${printed} · PDF p. ${pdf}`
      : printed
        ? `Printed p. ${printed}`
        : pdf != null
          ? `PDF p. ${pdf}`
          : "Page not resolved";
  const title = total > 1 ? `Proof ${index + 1} of ${total}` : `Proof 1 of 1`;
  return { title, page };
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
  const groups: { key: string; blocks: EvidenceBlock[] }[] = [];
  for (const block of blocks) {
    const key = pageGroupKey(block);
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.blocks.push(block);
    else groups.push({ key, blocks: [block] });
  }

  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach((group, index) => {
      initial[group.key] = index === 0;
    });
    return initial;
  });

  if (!blocks.length) {
    return <div className="evidence-empty">{emptyLabel}</div>;
  }

  return (
    <div className="evidence-passage-list proof-card-list">
      {title ? <div className="evidence-passage-list-title">{title}</div> : null}
      {groups.map((group, index) => {
        const meta = groupMeta(group.blocks, index, groups.length);
        const open = openKeys[group.key] ?? index === 0;
        const lead = group.blocks[0];
        return (
          <section
            key={group.key}
            className={`proof-card ${open ? "is-open" : "is-collapsed"}`}
          >
            <header className="proof-card-head">
              <button
                type="button"
                className="proof-card-toggle"
                aria-expanded={open}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenKeys((prev) => ({ ...prev, [group.key]: !open }));
                }}
              >
                {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                <span className="proof-card-title">{meta.title}</span>
                <span className="proof-card-page">{meta.page}</span>
              </button>
              {lead && onOpenDocument ? (
                <button
                  type="button"
                  className="proof-view-doc"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDocument(lead);
                  }}
                >
                  View in Doc
                  <ExternalLink size={13} aria-hidden />
                </button>
              ) : null}
            </header>
            {open ? (
              <div className="proof-card-body">
                {group.blocks.map((block) => (
                  <EvidenceBlockCard
                    key={block.evidence_id}
                    block={block}
                    active={activeEvidenceId === block.evidence_id}
                    onOpenDocument={onOpenDocument}
                    targetEdition={targetEdition}
                    evidenceTierLabel={evidenceTierLabel}
                    hideViewInDoc
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

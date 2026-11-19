import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  ChevronDown,
  History,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  StickyNote,
  X
} from "lucide-react";
import StatusChip, { mappingLabelKind } from "./StatusChip";
import InlineSpinner from "./InlineSpinner";
import {
  autoReviewBucketFromRevision,
  autoReviewStatusLabel
} from "../reviewReadiness";
import type { ChartRevision } from "../types";

type Props = {
  revision: ChartRevision;
  ready: boolean;
  busy?: boolean;
  onEdit: () => void;
  onRerun: () => void;
  onManageEvidence: () => void;
  onAnalysisReport: () => void;
  onAskAgent: () => void;
  onNotes: () => void;
  onAccept: () => void;
  onReject: () => void;
  onViewRevisionLog: () => void;
};

export default function ChartMappingCell({
  revision,
  ready,
  busy = false,
  onEdit,
  onRerun,
  onManageEvidence,
  onAnalysisReport,
  onAskAgent,
  onNotes,
  onAccept,
  onReject,
  onViewRevisionLog
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const missing = revision.missing_requirements || [];
  const rationale = (revision.rationale || "").trim() || "No rationale provided.";
  const longRationale = rationale.length > 280;
  const shownRationale =
    !longRationale || rationaleOpen ? rationale : `${rationale.slice(0, 280).trim()}…`;
  const accepted = revision.analyst_disposition === "accept";
  const rejected = revision.analyst_disposition === "reject";
  const analystReviewed = accepted || rejected;
  const aiBucket = autoReviewBucketFromRevision(revision);
  const aiKind =
    aiBucket === "verified" ? "pass" : aiBucket === "need_review" ? "needs" : "muted";
  const aiLabel = autoReviewStatusLabel(aiBucket);
  const isManualUpdate =
    revision.authorship === "human" ||
    revision.authorship === "agent" ||
    (revision.authorship_label || "").toLowerCase() === "manual";

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="chart-mapping-cell" onClick={(event) => event.stopPropagation()}>
      {ready ? (
        <div className="chart-mapping-toolbar">
          <button
            type="button"
            className="chart-mapping-label-btn"
            disabled={busy || analystReviewed}
            title="Edit mapping label / rationale"
            onClick={onEdit}
          >
            <StatusChip
              label={revision.mapping_label || "No mapping"}
              kind={mappingLabelKind(revision.mapping_label)}
            />
            <ChevronDown size={14} aria-hidden />
          </button>

          <button
            type="button"
            className={`chart-ai-pill chart-ai-pill-btn kind-${aiKind || "muted"}`}
            title={`${aiLabel} — open analysis report`}
            disabled={busy}
            onClick={onAnalysisReport}
          >
            {aiLabel}
          </button>
          {isManualUpdate ? (
            <span
              className="authorship-pill origin-human chart-manual-pill"
              title="Updated manually or via Ask agent accept"
            >
              Manual
            </span>
          ) : null}

          <div className="chart-mapping-primary-actions">
            {!analystReviewed ? (
              <>
                <button
                  type="button"
                  className="chart-accept-btn"
                  disabled={busy}
                  title="Accept this mapping for the claim chart"
                  onClick={onAccept}
                >
                  {busy ? (
                    <InlineSpinner label="Accepting" />
                  ) : (
                    <Check size={14} strokeWidth={2.5} aria-hidden />
                  )}
                  {busy ? "Accepting…" : "Accept"}
                </button>
                <button
                  type="button"
                  className="chart-reject-icon-btn"
                  disabled={busy}
                  title="Reject this claim element from the delivered chart"
                  aria-label="Reject"
                  onClick={onReject}
                >
                  <X size={16} strokeWidth={2.25} aria-hidden />
                </button>
              </>
            ) : null}

            <div className="chart-more-menu" ref={menuRef}>
              <button
                type="button"
                className="chart-more-btn"
                aria-label="More actions"
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={18} aria-hidden />
              </button>
              {menuOpen ? (
                <div className="chart-more-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                  >
                    <Pencil size={14} aria-hidden />
                    Edit claim
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onRerun();
                    }}
                  >
                    <RefreshCw size={14} aria-hidden />
                    Re-run element
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onManageEvidence();
                    }}
                  >
                    <Layers size={14} aria-hidden />
                    Manage evidence
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onAnalysisReport();
                    }}
                  >
                    <BarChart3 size={14} aria-hidden />
                    Analysis report
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onViewRevisionLog();
                    }}
                  >
                    <History size={14} aria-hidden />
                    View revision log
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="chart-rationale-block">
        <div className="evidence-label">Rationale</div>
        <p className="chart-rationale-text">{shownRationale}</p>
        {longRationale ? (
          <button
            type="button"
            className="linkish chart-read-more"
            onClick={() => setRationaleOpen((open) => !open)}
          >
            {rationaleOpen ? "Show less" : "Read more"}
          </button>
        ) : null}
      </div>

      {revision.mapping_label === "Partial map" && missing.length ? (
        <div className="partial-gaps chart-missing-box">
          <div className="evidence-label">What is missing</div>
          <ul>
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {ready ? (
        <div className="chart-mapping-footer">
          <button type="button" className="chart-footer-link" disabled={busy} onClick={onAskAgent}>
            <MessageSquare size={15} aria-hidden />
            Ask agent
          </button>
          <span className="chart-footer-divider" aria-hidden />
          <button type="button" className="chart-footer-link" disabled={busy} onClick={onNotes}>
            <StickyNote size={15} aria-hidden />
            Notes
          </button>
        </div>
      ) : null}
    </div>
  );
}

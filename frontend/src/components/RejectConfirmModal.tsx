import { useEffect, useId, useState } from "react";
import InlineSpinner from "./InlineSpinner";

type Props = {
  open: boolean;
  elementLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
  onEditManually?: () => void;
  onRerun?: () => void;
  onAskAgent?: () => void;
};

export default function RejectConfirmModal({
  open,
  elementLabel,
  busy = false,
  onCancel,
  onConfirm,
  onEditManually,
  onRerun,
  onAskAgent
}: Props) {
  const titleId = useId();
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setComment("");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop reject-confirm-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="modal-panel reject-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <strong id={titleId}>Reject claim element {elementLabel}?</strong>
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            Close
          </button>
        </div>

        <div className="reject-confirm-body">
          <p className="reject-confirm-warning">
            Continuing will <strong>remove this entire claim element</strong> and{" "}
            <strong>all linked standard evidence</strong> from downloaded Word charts. The row stays
            visible here as rejected for audit, but it will not appear in draft or reviewed-final
            exports.
          </p>

          <div className="reject-confirm-alts">
            <p className="evidence-label">Want to keep the element and fix it instead?</p>
            <p>
              Cancel and use one of these options — you do not need to reject to make corrections:
            </p>
            <ul>
              <li>
                <strong>Edit manually</strong> — adjust the mapping label, rationale, or evidence
              </li>
              <li>
                <strong>Re-run analysis</strong> — remap this element against the standard
              </li>
              <li>
                <strong>Ask agent</strong> — describe the change, then accept a proposal
              </li>
            </ul>
            <div className="reject-confirm-alt-actions">
              {onEditManually ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={onEditManually}
                >
                  Edit manually
                </button>
              ) : null}
              {onRerun ? (
                <button type="button" className="secondary" disabled={busy} onClick={onRerun}>
                  Re-run analysis
                </button>
              ) : null}
              {onAskAgent ? (
                <button type="button" className="secondary" disabled={busy} onClick={onAskAgent}>
                  Ask agent
                </button>
              ) : null}
            </div>
          </div>

          <label className="reject-confirm-reason">
            <span>Reject reason (optional)</span>
            <textarea
              value={comment}
              disabled={busy}
              rows={3}
              placeholder="Why should this element be omitted from the delivered chart?"
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
        </div>

        <div className="reject-confirm-footer">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            Keep element
          </button>
          <button
            type="button"
            className="btn btn-danger reject-confirm-submit"
            disabled={busy}
            onClick={() => onConfirm(comment.trim())}
          >
            {busy ? (
              <>
                <InlineSpinner label="Rejecting" /> Rejecting…
              </>
            ) : (
              "Reject and remove from chart"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

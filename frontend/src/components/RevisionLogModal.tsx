import { useEffect, useId, useState } from "react";
import { api } from "../api";
import SkeletonBlock from "./SkeletonBlock";

export type RevisionLogEntry = {
  revision_id?: string;
  revision_number?: number;
  column: string;
  old_value: string;
  new_value: string;
  who: string;
  actor?: string;
  summary?: string;
  created_at: string;
};

type Props = {
  open: boolean;
  elementLabel: string;
  elementId: string;
  onClose: () => void;
};

function formatWhen(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export default function RevisionLogModal({ open, elementLabel, elementId, onClose }: Props) {
  const titleId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RevisionLogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<{ revision_log?: RevisionLogEntry[]; items?: unknown[] }>(
          `/api/elements/${elementId}/change-logs`
        );
        if (!cancelled) setEntries(data.revision_log || []);
      } catch (err) {
        if (!cancelled) {
          setEntries([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, elementId, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel revision-log-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <strong id={titleId}>Revision log · {elementLabel}</strong>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="doc-sub" style={{ marginTop: 0 }}>
          Full history for this claim element: what changed, previous vs new value, who made it
          (AI or Analyst), and when.
        </p>

        {loading ? (
          <div className="empty">
            <SkeletonBlock variant="lines" label="Loading revision log" />
            <p className="doc-sub" style={{ marginBottom: 0 }}>
              Loading revision log…
            </p>
          </div>
        ) : null}
        {error ? <div className="warn-box">{error}</div> : null}

        {!loading && !error ? (
          entries.length ? (
            <div className="revision-log-table-wrap">
              <table className="revision-log-table">
                <thead>
                  <tr>
                    <th>Changed field</th>
                    <th>Previous</th>
                    <th>Updated</th>
                    <th>Who</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr key={`${entry.revision_id || "rev"}-${entry.column}-${index}`}>
                      <td>
                        <strong>{entry.column}</strong>
                        {entry.summary ? (
                          <div className="doc-sub">{entry.summary}</div>
                        ) : null}
                      </td>
                      <td className="revision-log-value">{entry.old_value}</td>
                      <td className="revision-log-value">{entry.new_value}</td>
                      <td>
                        <span
                          className={`authorship-pill ${
                            entry.who === "Analyst" ? "origin-human" : "origin-ai"
                          }`}
                        >
                          {entry.who === "Analyst" ? "Analyst" : "AI"}
                        </span>
                      </td>
                      <td className="doc-sub">{formatWhen(entry.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No revisions logged for this claim element yet.</div>
          )
        ) : null}
      </div>
    </div>
  );
}

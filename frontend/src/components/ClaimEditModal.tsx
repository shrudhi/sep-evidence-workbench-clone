import { useEffect, useMemo, useState } from "react";
import InlineSpinner from "./InlineSpinner";
import type { ChangeLogEntry, ChartRevision, EvidenceBlock } from "../types";

export type EvidenceEditDraft = {
  key: string;
  evidence_id: string | null;
  standard_edition: string;
  section: string;
  printed_page: string;
  pdf_page: string;
  quote: string;
  screenshot_data_url: string | null;
  manual: boolean;
  removed: boolean;
  authorship: "ai" | "human";
};

type Props = {
  open: boolean;
  label: string;
  revision: ChartRevision;
  analystName: string;
  busy?: boolean;
  onClose: () => void;
  onSave: (payload: {
    mapping_label: string;
    rationale: string;
    edit_reason: string;
    analyst_name: string;
    evidence_entries: Array<{
      evidence_id: string | null;
      standard_edition: string;
      section: string;
      printed_page: string;
      pdf_page: string | number | null;
      quote: string;
      screenshot_data_url: string | null;
      manual: boolean;
      removed: boolean;
    }>;
  }) => void;
  onRevert?: (targetRevisionId: string) => void;
};

function blockToDraft(block: EvidenceBlock, index: number): EvidenceEditDraft {
  const manual = Boolean(block.manual) || String(block.evidence_id || "").startsWith("manual-");
  return {
    key: `${block.evidence_id || "new"}-${index}`,
    evidence_id: block.evidence_id || null,
    standard_edition:
      block.source?.short_label ||
      [block.source?.family, block.source?.edition].filter(Boolean).join(" ") ||
      block.source?.title ||
      "",
    section: block.section_ref || block.section_label || "",
    printed_page: block.printed_label != null ? String(block.printed_label) : "",
    pdf_page: block.page_ordinal != null ? String(block.page_ordinal) : "",
    quote: block.quote || "",
    screenshot_data_url: null,
    manual,
    removed: false,
    authorship: block.authorship === "human" || manual ? "human" : "ai"
  };
}

function emptyDraft(): EvidenceEditDraft {
  return {
    key: `manual-${crypto.randomUUID()}`,
    evidence_id: null,
    standard_edition: "",
    section: "",
    printed_page: "",
    pdf_page: "",
    quote: "",
    screenshot_data_url: null,
    manual: true,
    removed: false,
    authorship: "human"
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ClaimEditModal({
  open,
  label,
  revision,
  analystName,
  busy = false,
  onClose,
  onSave,
  onRevert
}: Props) {
  const [mappingLabel, setMappingLabel] = useState(revision.mapping_label || "Partial map");
  const [rationale, setRationale] = useState(revision.rationale || "");
  const [editReason, setEditReason] = useState("Analyst manual edit");
  const [entries, setEntries] = useState<EvidenceEditDraft[]>([]);
  const [authorshipFilter, setAuthorshipFilter] = useState<"all" | "ai" | "human">("all");
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMappingLabel(revision.mapping_label || "Partial map");
    setRationale(revision.rationale || "");
    setEditReason("Analyst manual edit");
    const blocks = revision.evidence_blocks || [];
    setEntries(blocks.length ? blocks.map(blockToDraft) : []);
    setAuthorshipFilter("all");
    setShowLogs(false);
  }, [open, revision]);

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (entry.removed) return false;
      if (authorshipFilter === "all") return true;
      return entry.authorship === authorshipFilter;
    });
  }, [entries, authorshipFilter]);

  const changeLogs: ChangeLogEntry[] = revision.change_logs || [];

  if (!open) return null;

  const updateEntry = (key: string, patch: Partial<EvidenceEditDraft>) => {
    setEntries((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const handleScreenshot = async (key: string, file: File | null) => {
    if (!file) {
      updateEntry(key, { screenshot_data_url: null });
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    updateEntry(key, { screenshot_data_url: dataUrl, authorship: "human" });
  };

  const handleSave = () => {
    onSave({
      mapping_label: mappingLabel,
      rationale,
      edit_reason: editReason || "Analyst manual edit",
      analyst_name: analystName || "Analyst",
      evidence_entries: entries.map((entry) => ({
        evidence_id: entry.evidence_id,
        standard_edition: entry.standard_edition,
        section: entry.section,
        printed_page: entry.printed_page,
        pdf_page: entry.pdf_page === "" ? null : entry.pdf_page,
        quote: entry.quote,
        screenshot_data_url: entry.screenshot_data_url,
        manual: entry.manual || !entry.evidence_id || entry.evidence_id.startsWith("manual-"),
        removed: entry.removed
      }))
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel claim-edit-modal"
        role="dialog"
        aria-label={`Edit ${label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <strong>Edit {label}</strong>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="doc-sub">
          Update evidence details for this claim element. Saving creates a Manual revision, logs the
          change, and re-runs AI review.
        </p>

        <div className="claim-edit-authorship-bar" role="group" aria-label="Filter by authorship">
          <span className="evidence-label">Show changes</span>
          {(["all", "ai", "human"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={authorshipFilter === value ? "secondary" : "ghost"}
              onClick={() => setAuthorshipFilter(value)}
            >
              {value === "all" ? "All" : value === "ai" ? "AI" : "Manual"}
            </button>
          ))}
          <span className={`authorship-pill origin-${revision.authorship || "ai"}`}>
            Current: {revision.authorship_label || "AI"}
          </span>
        </div>

        <label className="evidence-label" htmlFor="claim-edit-mapping-label">
          Mapping label
        </label>
        <select
          id="claim-edit-mapping-label"
          value={mappingLabel}
          onChange={(event) => setMappingLabel(event.target.value)}
        >
          <option value="Full map">Full map</option>
          <option value="Partial map">Partial map</option>
          <option value="No map">No map</option>
        </select>

        <label className="evidence-label" htmlFor="claim-edit-rationale">
          Rationale
        </label>
        <textarea
          id="claim-edit-rationale"
          rows={4}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />

        {visibleEntries.map((entry, index) => (
          <section key={entry.key} className="claim-edit-evidence-card">
            <div className="claim-edit-evidence-head">
              <strong>Source passage {index + 1}</strong>
              <span className={`authorship-pill origin-${entry.authorship}`}>
                {entry.authorship === "human" ? "Manual" : "AI"}
              </span>
            </div>

            <label className="evidence-label">Standard and edition</label>
            <input
              value={entry.standard_edition}
              onChange={(event) =>
                updateEntry(entry.key, {
                  standard_edition: event.target.value,
                  authorship: "human"
                })
              }
            />

            <label className="evidence-label">Clause or section</label>
            <input
              value={entry.section}
              onChange={(event) =>
                updateEntry(entry.key, { section: event.target.value, authorship: "human" })
              }
            />

            <div className="claim-edit-page-row">
              <div>
                <label className="evidence-label">Printed page</label>
                <input
                  value={entry.printed_page}
                  onChange={(event) =>
                    updateEntry(entry.key, {
                      printed_page: event.target.value,
                      authorship: "human"
                    })
                  }
                />
              </div>
              <div>
                <label className="evidence-label">PDF page</label>
                <input
                  value={entry.pdf_page}
                  onChange={(event) =>
                    updateEntry(entry.key, { pdf_page: event.target.value, authorship: "human" })
                  }
                />
              </div>
            </div>

            <label className="evidence-label">Verbatim quote</label>
            <textarea
              rows={4}
              value={entry.quote}
              onChange={(event) =>
                updateEntry(entry.key, { quote: event.target.value, authorship: "human" })
              }
            />

            <label className="evidence-label">
              {entry.manual ? "Attach screenshot" : "Replace screenshot"}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                void handleScreenshot(entry.key, file);
              }}
            />

            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => updateEntry(entry.key, { removed: true })}
            >
              Remove evidence
            </button>
          </section>
        ))}

        <div className="row-action-group" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setEntries((prev) => [...prev, emptyDraft()])}
          >
            Add evidence
          </button>
          <button type="button" className="ghost" onClick={() => setShowLogs((value) => !value)}>
            {showLogs ? "Hide change log" : "Change log"}
          </button>
        </div>

        {showLogs ? (
          <section className="claim-edit-changelog" aria-label="Change log">
            <div className="evidence-label">Change log</div>
            {changeLogs.length ? (
              <ul>
                {changeLogs.map((log) => (
                  <li key={log.id}>
                    <div className="claim-edit-log-head">
                      <span className={`authorship-pill origin-${log.origin}`}>
                        {log.origin_label || log.origin}
                      </span>
                      <span className="doc-sub">{log.created_at}</span>
                    </div>
                    <p>
                      {log.actor}: {log.summary}
                    </p>
                    {onRevert && log.revision_id !== revision.id ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => onRevert(log.revision_id)}
                      >
                        Revert to this version
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="doc-sub">No edits logged yet for this claim element.</p>
            )}
          </section>
        ) : null}

        <label className="evidence-label" htmlFor="claim-edit-reason">
          Edit reason
        </label>
        <input
          id="claim-edit-reason"
          value={editReason}
          onChange={(event) => setEditReason(event.target.value)}
        />

        <div className="row-action-group claim-edit-footer">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={handleSave}>
            {busy ? (
              <>
                <InlineSpinner label="Saving" /> Saving row…
              </>
            ) : (
              "Save row"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

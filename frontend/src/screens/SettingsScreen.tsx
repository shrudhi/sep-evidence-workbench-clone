import { useEffect, useMemo, useState } from "react";
import HelpTooltip from "../components/HelpTooltip";
import InlineSpinner from "../components/InlineSpinner";
import { api } from "../api";
import {
  automationPayload,
  invalidRecipients,
  normalizeAutomation,
  parseRecipients,
  policySummary
} from "../automation";
import type { AutomationSettings, EmailStatus } from "../types";

type Props = {
  projectId: string;
  automation: AutomationSettings | undefined;
  onSaved: () => Promise<void>;
  onNotice: (message: string | null) => void;
};

export default function SettingsScreen({ projectId, automation, onSaved, onNotice }: Props) {
  const workspace = normalizeAutomation(automation?.workspace_defaults || automation);
  const [draft, setDraft] = useState<AutomationSettings>(workspace);
  const [recipientsText, setRecipientsText] = useState(workspace.recipients.join(", "));
  const [saving, setSaving] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);

  useEffect(() => {
    const next = normalizeAutomation(automation?.workspace_defaults || automation);
    setDraft(next);
    setRecipientsText(next.recipients.join(", "));
  }, [automation]);

  useEffect(() => {
    api<EmailStatus>("/api/email/status")
      .then(setEmailStatus)
      .catch(() =>
        setEmailStatus({
          configured: false,
          status: "connection_error",
          status_label: "Connection error",
          provider: "unknown",
          message: "Could not load email status"
        })
      );
  }, []);

  const recipients = parseRecipients(recipientsText);
  const invalid = invalidRecipients(recipients);
  const liveSummary = useMemo(
    () => policySummary({ ...draft, recipients }),
    [draft, recipients]
  );

  const update = (patch: Partial<AutomationSettings>) => {
    setDraft((current) => normalizeAutomation({ ...current, ...patch, recipients }));
  };

  const save = async () => {
    if (invalid.length) {
      onNotice(`Invalid recipient email address(es): ${invalid.join(", ")}`);
      return;
    }
    setSaving(true);
    onNotice(null);
    try {
      await api(`/api/projects/${projectId}/automation`, {
        method: "PATCH",
        body: JSON.stringify(
          automationPayload(normalizeAutomation({ ...draft, recipients }))
        )
      });
      await onSaved();
      onNotice("Workspace automation defaults saved. Active runs keep their snapshotted policy.");
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const statusClass =
    emailStatus?.status === "connected"
      ? "ready"
      : emailStatus?.status === "not_configured"
        ? "suggested"
        : "danger";

  return (
    <section>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Workspace defaults for automation and delivery. Customize on a run overrides these without
        changing the defaults. Existing runs keep the policy snapshotted at start.
      </p>

      <div className="panel">
        <h3>Email connection</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <span className={`badge ${statusClass}`}>{emailStatus?.status_label || "…"}</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {emailStatus?.message ||
              (emailStatus?.from_address
                ? `From ${emailStatus.from_address} · ${emailStatus.provider}`
                : emailStatus?.provider || "")}
          </span>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Default delivery mode
          <HelpTooltip text="Controls whether completed charts wait for analyst approval before email, or send once required checks pass." />
        </h3>
        <label className="check-row" style={{ marginTop: 10 }}>
          <input
            type="radio"
            name="settings-mode"
            checked={draft.mode === "review_before_send"}
            onChange={() => update({ mode: "review_before_send" })}
          />
          <span>Review before sending</span>
        </label>
        <label className="check-row">
          <input
            type="radio"
            name="settings-mode"
            checked={draft.mode === "send_when_checks_pass"}
            onChange={() => update({ mode: "send_when_checks_pass" })}
          />
          <span>Send automatically when all required checks pass</span>
        </label>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>
          Review-before-sending always needs explicit approval. Automatic mode still pauses for
          unresolved required reviews, failures, or mandatory evidence issues.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Default recipients</h3>
        <input
          style={{ width: "100%", marginTop: 8 }}
          value={recipientsText}
          placeholder="name@company.com, partner@company.com"
          onChange={(event) => {
            setRecipientsText(event.target.value);
            setDraft((current) =>
              normalizeAutomation({
                ...current,
                recipients: parseRecipients(event.target.value)
              })
            );
          }}
        />
        {invalid.length ? (
          <div className="warn-box" style={{ marginTop: 8 }}>
            Invalid address(es): {invalid.join(", ")}. Fix before enabling email delivery.
          </div>
        ) : recipients.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
            No recipients configured — email delivery stays disabled until valid addresses are added.
          </p>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Notification preferences</h3>
        <label className="check-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={draft.notify_review_required}
            onChange={(event) => update({ notify_review_required: event.target.checked })}
          />
          <span>Notify when review is required</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.notify_analysis_completed}
            onChange={(event) => update({ notify_analysis_completed: event.target.checked })}
          />
          <span>Notify when analysis is ready for review</span>
        </label>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>
          Analysis-ready notifications never attach or send an unapproved report as a completed
          deliverable.
        </p>
        <label className="check-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={draft.attach_word_bundle}
            onChange={(event) => update({ attach_word_bundle: event.target.checked })}
          />
          <span>Attach Word chart bundle when a completed deliverable is authorized</span>
        </label>
        <label style={{ display: "block", marginTop: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Maximum automatic repair attempts
            <HelpTooltip text="How many times the system may auto-retry a failed mapping before pausing for analyst review (0–3)." />
          </span>
          <input
            type="number"
            min={0}
            max={3}
            style={{ width: 80, marginLeft: 8 }}
            value={draft.max_repair_attempts}
            onChange={(event) =>
              update({ max_repair_attempts: Number(event.target.value) || 0 })
            }
          />
        </label>
      </div>

      <div className="conclusion-box" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 18 }}>Default policy summary</h3>
        <p style={{ margin: 0, fontSize: 14 }}>{liveSummary}</p>
      </div>

      <div className="footer-bar">
        <p>Changes apply to future runs only.</p>
        <button className="primary" disabled={saving || invalid.length > 0} onClick={() => save()}>
          {saving ? (
            <>
              <InlineSpinner label="Saving" /> Saving defaults…
            </>
          ) : (
            "Save workspace defaults"
          )}
        </button>
      </div>
    </section>
  );
}

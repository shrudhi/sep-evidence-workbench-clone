import type { AutomationSettings } from "./types";

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export function parseRecipients(value: string | string[] | undefined | null): string[] {
  if (Array.isArray(value)) {
    return value.map((part) => String(part).trim()).filter(Boolean);
  }
  if (!value) return [];
  return value
    .replace(/;/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function invalidRecipients(recipients: string[]): string[] {
  return recipients.filter((addr) => !EMAIL_RE.test(addr));
}

export function policySummary(settings: Partial<AutomationSettings>): string {
  const mode = settings.mode || "review_before_send";
  const repairs = Number(settings.max_repair_attempts ?? 1);
  const recipients = settings.recipients || [];
  const recip = recipients.length ? recipients.join(", ") : "no recipients configured";
  const repairPhrase = repairs === 1 ? "1 repair" : `${repairs} repairs`;
  const notifyBits: string[] = [];
  if (settings.notify_review_required ?? true) {
    notifyBits.push("review notifications enabled");
  }
  if (settings.notify_analysis_completed ?? true) {
    notifyBits.push("analysis-ready notifications enabled");
  }
  const notify = notifyBits.length ? ` (${notifyBits.join("; ")})` : "";
  const attach =
    (settings.attach_word_bundle ?? true)
      ? " Attach the Word bundle only when a completed deliverable is authorized."
      : " Do not attach the Word bundle to emails.";
  if (mode === "send_when_checks_pass") {
    return (
      `Analyse the selected claims and standards. Attempt ${repairPhrase} for failed rows. ` +
      `Email the Word bundle to ${recip} only when mandatory checks pass and no required ` +
      `reviews or processing failures remain${notify}.${attach}`
    );
  }
  return (
    `Analyse the selected claims and standards. Attempt ${repairPhrase} for failed rows. ` +
    `Hold report delivery for explicit human approval before emailing to ${recip}${notify}.` +
    `${attach}`
  );
}

export function compactAutomationLabel(settings: Partial<AutomationSettings>): string {
  const mode =
    settings.mode === "send_when_checks_pass"
      ? "Send automatically when all required checks pass"
      : "Review before sending";
  const bits = [mode];
  if (settings.notify_review_required ?? true) {
    bits.push("Review notifications enabled");
  }
  if (settings.attach_word_bundle ?? true) {
    bits.push("Word bundle");
  }
  return bits.join(" · ");
}

export function modeLabel(mode: AutomationSettings["mode"] | undefined): string {
  return mode === "send_when_checks_pass"
    ? "Send automatically when all required checks pass"
    : "Review before sending";
}

export function automationPayload(settings: AutomationSettings): Record<string, unknown> {
  return {
    mode: settings.mode,
    recipients: settings.recipients,
    notify_review_required: settings.notify_review_required,
    notify_analysis_completed: settings.notify_analysis_completed,
    attach_word_bundle: settings.attach_word_bundle,
    additional_formats: settings.additional_formats || [],
    max_repair_attempts: settings.max_repair_attempts
  };
}

export function defaultAutomation(): AutomationSettings {
  return {
    mode: "review_before_send",
    recipients: [],
    notify_review_required: true,
    notify_analysis_completed: true,
    attach_word_bundle: true,
    additional_formats: [],
    require_human_approval: true,
    max_repair_attempts: 1,
    policy_summary: "",
    using_defaults: true,
    compact_label: "Review before sending · Review notifications enabled · Word bundle"
  };
}

export function normalizeAutomation(
  raw: Partial<AutomationSettings> | undefined | null
): AutomationSettings {
  const base = defaultAutomation();
  if (!raw) return { ...base, policy_summary: policySummary(base) };
  const next: AutomationSettings = {
    ...base,
    ...raw,
    recipients: Array.isArray(raw.recipients)
      ? raw.recipients
      : parseRecipients(raw.recipients as unknown as string),
    mode: raw.mode === "send_when_checks_pass" ? "send_when_checks_pass" : "review_before_send",
    require_human_approval: raw.mode !== "send_when_checks_pass",
    max_repair_attempts: Math.max(0, Math.min(Number(raw.max_repair_attempts ?? 1), 3)),
    using_defaults: raw.using_defaults,
    workspace_defaults: raw.workspace_defaults
  };
  next.policy_summary = policySummary(next);
  next.compact_label = compactAutomationLabel(next);
  return next;
}

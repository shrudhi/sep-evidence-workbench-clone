import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Gauge,
  Info,
  MinusCircle,
  XCircle
} from "lucide-react";

type ChipKind =
  | "full"
  | "partial"
  | "none"
  | "incomplete"
  | "pass"
  | "fail"
  | "needs"
  | "muted"
  | "confidence-high"
  | "confidence-mid"
  | "confidence-low"
  | "very-strong"
  | "strong"
  | "moderate"
  | "weak"
  | "insufficient"
  | "issue"
  | "context";

type Props = {
  label: string;
  kind: ChipKind;
  title?: string;
};

function ChipIcon({ kind }: { kind: ChipKind }) {
  const size = 12;
  if (
    kind === "full" ||
    kind === "pass" ||
    kind === "confidence-high" ||
    kind === "very-strong" ||
    kind === "strong"
  ) {
    return <CheckCircle2 size={size} aria-hidden />;
  }
  if (kind === "fail" || kind === "none" || kind === "insufficient" || kind === "confidence-low") {
    return <XCircle size={size} aria-hidden />;
  }
  if (
    kind === "partial" ||
    kind === "needs" ||
    kind === "confidence-mid" ||
    kind === "moderate" ||
    kind === "weak" ||
    kind === "issue"
  ) {
    return <AlertTriangle size={size} aria-hidden />;
  }
  if (kind === "incomplete") {
    return <CircleDashed size={size} aria-hidden />;
  }
  if (kind === "context") {
    return <Info size={size} aria-hidden />;
  }
  if (kind === "muted") {
    return <Gauge size={size} aria-hidden />;
  }
  return <MinusCircle size={size} aria-hidden />;
}

export function readStrengthKind(
  kind: "very-strong" | "strong" | "moderate" | "weak" | "insufficient" | "muted"
): ChipKind {
  return kind;
}

export default function StatusChip({ label, kind, title }: Props) {
  return (
    <span className={`status-chip ${kind}`} title={title || label}>
      <ChipIcon kind={kind} />
      <span>{label}</span>
    </span>
  );
}

export function mappingLabelKind(label: string | null | undefined): ChipKind {
  if (label === "Full map") return "full";
  if (label === "Partial map") return "partial";
  if (label === "No map") return "none";
  return "incomplete";
}

export function checkStatusKind(
  kind: "pass" | "fail" | "needs" | "incomplete" | "muted"
): ChipKind {
  if (kind === "pass") return "pass";
  if (kind === "fail") return "fail";
  if (kind === "needs") return "needs";
  if (kind === "incomplete") return "incomplete";
  return "muted";
}

export function confidenceKind(kind: "high" | "mid" | "low" | "none"): ChipKind {
  if (kind === "high") return "confidence-high";
  if (kind === "mid") return "confidence-mid";
  if (kind === "none") return "muted";
  return "confidence-low";
}

export function findingTagKind(tag: string): ChipKind {
  if (/screenshot|quote|wrong|incorrect|unsupported|disagreement|error|mismatch/i.test(tag)) {
    return "issue";
  }
  return "context";
}

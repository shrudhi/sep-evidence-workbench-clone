import { LoaderCircle } from "lucide-react";

type Props = {
  size?: number;
  label?: string;
};

export default function InlineSpinner({ size = 14, label }: Props) {
  return (
    <span className="inline-spinner" aria-live="polite">
      <LoaderCircle size={size} className="spin" aria-hidden />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

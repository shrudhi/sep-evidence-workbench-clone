import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

type Props = {
  text: string;
  label?: string;
};

const SHOW_DELAY_MS = 280;
const HIDE_DELAY_MS = 120;

/**
 * Compact info affordance with hover/focus tooltip.
 * Keyboard-accessible; delayed show; flips when near viewport edges.
 */
export default function HelpTooltip({ text, label = "More information" }: Props) {
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");

  const clearTimers = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };

  const scheduleShow = () => {
    clearTimers();
    showTimer.current = window.setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect && rect.top < 72) setPlacement("bottom");
      else setPlacement("top");
      setOpen(true);
    }, SHOW_DELAY_MS);
  };

  const scheduleHide = () => {
    clearTimers();
    hideTimer.current = window.setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <span
      className={`help-tooltip ${open ? "is-open" : ""} placement-${placement}`}
      ref={wrapRef}
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        className="help-tooltip-trigger"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
      >
        <CircleHelp size={14} strokeWidth={2.25} aria-hidden />
      </button>
      {open ? (
        <span className="help-tooltip-bubble" id={tipId} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}

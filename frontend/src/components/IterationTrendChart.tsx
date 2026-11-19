import { useMemo, useState } from "react";
import {
  CRITERION_META,
  deltaVsPrevious,
  formatDelta,
  type CriterionId,
  type IterationRun
} from "../data/evaluationIterationHistory";

type Props = {
  runs: IterationRun[];
  activeRunId: string;
  onSelectRun: (id: string) => void;
};

type HoverState = {
  runIndex: number;
  criterionId: CriterionId;
  x: number;
  y: number;
} | null;

export default function IterationTrendChart({ runs, activeRunId, onSelectRun }: Props) {
  const [visible, setVisible] = useState<Record<CriterionId, boolean>>({
    C01: true,
    C02: true,
    C03: true,
    C04: true,
    C05: true,
    C06: true
  });
  const [hover, setHover] = useState<HoverState>(null);

  const width = 920;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 56, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const points = useMemo(() => {
    const n = Math.max(runs.length - 1, 1);
    return runs.map((run, i) => ({
      run,
      index: i,
      x: pad.left + (i / n) * plotW
    }));
  }, [runs, pad.left, plotW]);

  const yFor = (rate: number) => pad.top + plotH - (rate / 100) * plotH;

  const hoverRun = hover ? runs[hover.runIndex] : null;
  const hoverCrit = hoverRun?.criteria.find((c) => c.id === hover?.criterionId);
  const hoverDelta =
    hover && hoverCrit
      ? formatDelta(deltaVsPrevious(runs, hover.runIndex, hover.criterionId))
      : null;

  return (
    <div className="eq-trend">
      <div className="eq-trend-legend" role="group" aria-label="Toggle criteria series">
        {CRITERION_META.map((meta) => (
          <button
            key={meta.id}
            type="button"
            className={`eq-legend-pill ${visible[meta.id] ? "is-on" : "is-off"}`}
            style={{ ["--legend-color" as string]: meta.color }}
            aria-pressed={visible[meta.id]}
            onClick={() =>
              setVisible((prev) => ({ ...prev, [meta.id]: !prev[meta.id] }))
            }
          >
            <span className="eq-legend-swatch" />
            <span className="evd-mono">{meta.id}</span>
            <span>{meta.name}</span>
          </button>
        ))}
      </div>

      <div className="eq-trend-canvas-wrap">
        <svg
          className="eq-trend-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Per-criterion pass rate trend over iteration runs"
        >
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  className="eq-trend-grid"
                />
                <text x={pad.left - 10} y={y + 4} textAnchor="end" className="eq-trend-axis">
                  {tick}%
                </text>
              </g>
            );
          })}

          {points.map((p) => (
            <g key={p.run.id}>
              <line
                x1={p.x}
                x2={p.x}
                y1={pad.top}
                y2={pad.top + plotH}
                className={`eq-trend-vline ${p.run.id === activeRunId ? "is-active" : ""}`}
              />
              <text
                x={p.x}
                y={height - 28}
                textAnchor="middle"
                className="eq-trend-axis evd-mono"
              >
                {p.run.timestamp.replace(" UTC", "")}
              </text>
              <text
                x={p.x}
                y={height - 12}
                textAnchor="middle"
                className="eq-trend-axis-sub evd-mono"
              >
                {p.run.shortId} — {p.run.label}
              </text>
            </g>
          ))}

          {CRITERION_META.map((meta) => {
            if (!visible[meta.id]) return null;
            const d = points
              .map((p, i) => {
                const rate = p.run.criteria.find((c) => c.id === meta.id)?.rate ?? 0;
                return `${i === 0 ? "M" : "L"} ${p.x} ${yFor(rate)}`;
              })
              .join(" ");
            return (
              <path
                key={meta.id}
                d={d}
                fill="none"
                stroke={meta.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {CRITERION_META.map((meta) => {
            if (!visible[meta.id]) return null;
            return points.map((p) => {
              const rate = p.run.criteria.find((c) => c.id === meta.id)?.rate ?? 0;
              const cy = yFor(rate);
              return (
                <circle
                  key={`${meta.id}-${p.run.id}`}
                  cx={p.x}
                  cy={cy}
                  r={p.run.id === activeRunId ? 5.5 : 4}
                  fill={meta.color}
                  stroke="#fff"
                  strokeWidth={1.5}
                  className="eq-trend-dot"
                  onMouseEnter={() =>
                    setHover({
                      runIndex: p.index,
                      criterionId: meta.id,
                      x: p.x,
                      y: cy
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelectRun(p.run.id)}
                />
              );
            });
          })}
        </svg>

        {hover && hoverRun && hoverCrit && hoverDelta ? (
          <div
            className="eq-trend-tooltip"
            style={{
              left: Math.min(Math.max(hover.x - 90, 8), width - 220),
              top: Math.max(hover.y - 110, 8)
            }}
          >
            <div className="evd-mono">{hoverRun.timestamp}</div>
            <div>
              <strong className="evd-mono">{hoverRun.shortId}</strong> — {hoverRun.label}
            </div>
            <div className="eq-trend-tip-note">{hoverRun.changeNote}</div>
            <div className="eq-trend-tip-metric">
              <span className="evd-mono" style={{ color: CRITERION_META.find((m) => m.id === hover.criterionId)?.color }}>
                {hover.criterionId}
              </span>
              <span className="evd-mono">{hoverCrit.rate.toFixed(1)}%</span>
              <span className={`eq-delta eq-delta-${hoverDelta.tone}`}>{hoverDelta.text}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

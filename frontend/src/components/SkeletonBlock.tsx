type Props = {
  variant?: "page" | "chart" | "panel" | "lines";
  lines?: number;
  label?: string;
};

export default function SkeletonBlock({
  variant = "lines",
  lines = 3,
  label = "Loading"
}: Props) {
  if (variant === "chart") {
    return (
      <div className="skeleton-chart" aria-busy="true" aria-label={label}>
        <div className="skeleton-chart-toolbar">
          <span className="skeleton-bar w-32" />
          <span className="skeleton-bar w-24" />
          <span className="skeleton-bar w-20" />
        </div>
        <div className="skeleton-chart-table">
          {[0, 1, 2].map((row) => (
            <div key={row} className="skeleton-chart-row">
              <span className="skeleton-bar w-full" />
              <span className="skeleton-bar w-full" />
              <span className="skeleton-bar w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div className="skeleton-page" aria-busy="true" aria-label={label}>
        <span className="skeleton-bar w-40 h-lg" />
        <span className="skeleton-bar w-64" />
        <div className="skeleton-card">
          <span className="skeleton-bar w-32" />
          <span className="skeleton-bar w-full" />
          <span className="skeleton-bar w-3/4" />
        </div>
      </div>
    );
  }

  if (variant === "panel") {
    return (
      <div className="skeleton-panel" aria-busy="true" aria-label={label}>
        <span className="skeleton-bar w-28" />
        <span className="skeleton-bar w-full" />
        <span className="skeleton-bar w-5/6" />
        <span className="skeleton-bar w-2/3" />
      </div>
    );
  }

  return (
    <div className="skeleton-lines" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className={`skeleton-bar ${index === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

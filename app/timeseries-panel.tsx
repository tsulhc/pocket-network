type TimeseriesPoint = {
  label: string;
  value: number;
  secondaryValue?: number;
};

type TimeseriesPanelProps = {
  title: string;
  subtitle: string;
  eyebrow: string;
  points: TimeseriesPoint[];
  valueLabel: string;
  formatValue: (value: number) => string;
  emptyText?: string;
  theme?: "revenue" | "demand" | "integrity" | "privacy";
};

const MAX_DISPLAY_DAYS = 30;

function buildLinePath(points: TimeseriesPoint[], maxValue: number): string {
  if (points.length === 0 || maxValue === 0) return "";

  return points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - (Math.max(0, point.secondaryValue ?? point.value) / maxValue) * 100;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function TimeseriesPanel({
  title,
  subtitle,
  eyebrow,
  points,
  valueLabel,
  formatValue,
  emptyText = "Timeseries data is not available yet.",
  theme
}: TimeseriesPanelProps) {
  const displayPoints = points.slice(-MAX_DISPLAY_DAYS);
  const hasData = displayPoints.some((point) => point.value > 0 || (point.secondaryValue ?? 0) > 0);
  const maxValue = Math.max(...displayPoints.map((point) => Math.max(point.value, point.secondaryValue ?? 0)), 0);
  const latestPoint = displayPoints.at(-1);
  const previousPoint = displayPoints.at(-2);
  const totalValue = displayPoints.reduce((sum, point) => sum + point.value, 0);
  const latestChange = latestPoint && previousPoint && previousPoint.value > 0
    ? ((latestPoint.value / previousPoint.value) - 1) * 100
    : 0;
  const linePath = buildLinePath(displayPoints, maxValue);
  const themeClass = theme ? `themed section-theme-${theme}` : "";

  return (
    <section className={`panel section timeseries-panel ${themeClass}`} style={{ position: 'relative' }}>
      <div className="section-title-row">
        <div>
          <span className="eyebrow eyebrow-ghost">{eyebrow}</span>
          <h2 className="section-title">{title}</h2>
          <p className="section-subtitle">{subtitle}</p>
        </div>
        <span className="pill" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text)' }}>Last {displayPoints.length} Days</span>
      </div>

      {hasData ? (
        <>
          <div className="timeseries-metrics">
            <div className="panel-inset" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <span className="hero-highlight-label">Latest Snapshot</span>
              <strong style={{ color: 'var(--accent)' }}>{latestPoint ? formatValue(latestPoint.value) : "n/a"}</strong>
            </div>
            <div className="panel-inset" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <span className="hero-highlight-label">Window Total</span>
              <strong>{formatValue(totalValue)}</strong>
            </div>
            <div className="panel-inset" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <span className="hero-highlight-label">Day Momentum</span>
              <strong style={{ color: latestChange > 0 ? 'var(--green)' : latestChange < 0 ? 'var(--red)' : 'var(--text)' }}>
                {latestChange === 0 ? "Neutral" : `${latestChange > 0 ? "+" : ""}${latestChange.toFixed(1)}%`}
              </strong>
            </div>
          </div>

          <div className="timeseries-chart" aria-label={`${title} chart`}>
            <svg className="timeseries-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ opacity: 0.8 }}>
              <path d={linePath} />
            </svg>
            {displayPoints.map((point) => {
              const height = maxValue === 0 ? 2 : Math.max(4, Math.round((point.value / maxValue) * 100));
              const isActive = point === latestPoint;
              
              return (
                <div key={point.label} className="timeseries-bar-group" title={`${point.label}: ${formatValue(point.value)}`}>
                  <div 
                    className="timeseries-bar" 
                    style={{ 
                      height: `${height}%`,
                      background: isActive ? 'var(--section-accent, var(--accent))' : undefined,
                      boxShadow: isActive ? `0 0 15px color-mix(in srgb, var(--section-accent, var(--accent)), transparent 60%)` : undefined
                    }} 
                  />
                  <span style={{ fontWeight: isActive ? 800 : 500, color: isActive ? 'var(--text)' : 'var(--muted)' }}>
                    {point.label.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="footer-note" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginRight: '24px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'linear-gradient(to bottom, var(--accent), rgba(0, 194, 255, 0.3))' }} />
              Daily {valueLabel}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '20px', height: '3px', borderRadius: '2px', background: 'var(--vanilla)' }} />
              7-Day Moving Average
            </span>
          </p>
        </>
      ) : (
        <p className="footer-note">{emptyText}</p>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  formatCompactNumber,
  formatDecimal,
  formatInteger,
  formatPercent,
  formatRelativeRange,
  formatUsd,
  formatUpokt
} from "@/lib/format";
import type {
  SerializedDashboardData,
  SerializedNetworkDailyHistoryPoint,
  SerializedServiceStats,
  TimeWindow
} from "@/lib/types";

const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];
const WARMING_RETRY_MS = 5_000;

type DashboardViewProps = {
  initialWindow: TimeWindow;
  dataByWindow: Record<TimeWindow, SerializedDashboardData | null>;
  networkHistory: SerializedNetworkDailyHistoryPoint[];
};

type DashboardApiResponse = SerializedDashboardData | { status: "warming" | "ready" };

function toBigInt(value: string): bigint {
  return BigInt(value);
}

function toPoktNumber(value: string): number {
  return Number(toBigInt(value)) / 1_000_000;
}

function toUsdFromUpokt(value: string, poktPriceUsd: number): number {
  return toPoktNumber(value) * poktPriceUsd;
}

function getShare(part: string | number, total: string | number): number {
  if (typeof part === "string" || typeof total === "string") {
    const totalBig = typeof total === "string" ? BigInt(total) : BigInt(total);
    const partBig = typeof part === "string" ? BigInt(part) : BigInt(part);
    if (totalBig === 0n) return 0;
    return Number((partBig * 10_000n) / totalBig) / 100;
  }

  if (total === 0) return 0;
  return (part / total) * 100;
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function getRevenuePerMillionRelays(service: SerializedServiceStats): number {
  return service.relays === 0 ? 0 : (toPoktNumber(service.revenueUpokt) / service.relays) * 1_000_000;
}

function getSupplierDensityLabel(service: SerializedServiceStats): string {
  const suppliers = service.supplierCount ?? 0;
  if (suppliers <= 25) return "low density";
  if (suppliers <= 75) return "balanced";
  return "dense";
}

function buildDomainBuckets(providers: SerializedDashboardData["providers"]): Array<{ label: string; count: number; revenue: bigint }> {
  const buckets = [
    { label: "0-10 POKT", min: 0, max: 10, count: 0, revenue: 0n },
    { label: "10-100 POKT", min: 10, max: 100, count: 0, revenue: 0n },
    { label: "100-1k POKT", min: 100, max: 1_000, count: 0, revenue: 0n },
    { label: "1k+ POKT", min: 1_000, max: Number.POSITIVE_INFINITY, count: 0, revenue: 0n }
  ];

  for (const provider of providers) {
    const pokt = toPoktNumber(provider.revenueUpokt);
    const bucket = buckets.find((entry) => pokt >= entry.min && pokt < entry.max) ?? buckets[buckets.length - 1];
    bucket.count += 1;
    bucket.revenue += BigInt(provider.revenueUpokt);
  }

  return buckets.map(({ label, count, revenue }) => ({ label, count, revenue }));
}

function buildNetworkTrendPath(points: Array<{ revenue: number }>, maxRevenue: number): string {
  if (points.length === 0 || maxRevenue === 0) return "";

  return points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - (Math.max(0, point.revenue) / maxRevenue) * 100;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function NetworkTrendPanel({ history }: { history: SerializedNetworkDailyHistoryPoint[] }) {
  const trendPoints = history.slice(-30).map((point) => ({
    day: point.day,
    revenue: toPoktNumber(point.revenueUpokt),
    relays: point.relays
  }));
  const maxRevenue = Math.max(...trendPoints.map((point) => point.revenue), 0);
  const maxRelays = Math.max(...trendPoints.map((point) => point.relays), 0);
  const latestPoint = trendPoints.at(-1);
  const totalRevenue = trendPoints.reduce((sum, point) => sum + point.revenue, 0);
  const totalRelays = trendPoints.reduce((sum, point) => sum + point.relays, 0);
  const linePath = buildNetworkTrendPath(trendPoints, maxRevenue);
  const hasData = trendPoints.some((point) => point.revenue > 0 || point.relays > 0);

  return (
    <section className="panel section network-trend-panel themed section-theme-demand" style={{ position: 'relative' }}>
      <div className="section-title-row">
        <div>
          <span className="eyebrow eyebrow-ghost">Market</span>
          <h2 className="section-title">Network Trend</h2>
          <p className="section-subtitle">Daily rewards and finalized relay demand over the last 30 days.</p>
        </div>
        <span className="pill" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text)' }}>Last {trendPoints.length} Days</span>
      </div>

      {hasData ? (
        <>
          <div className="network-trend-metrics">
            <div className="panel-inset">
              <span className="hero-highlight-label">Latest Rewards</span>
              <strong style={{ color: 'var(--yellow-primary)' }}>{latestPoint ? `${formatDecimal(latestPoint.revenue, 1)} POKT` : "n/a"}</strong>
            </div>
            <div className="panel-inset">
              <span className="hero-highlight-label">Latest Relays</span>
              <strong style={{ color: 'var(--green)' }}>{latestPoint ? formatCompactNumber(latestPoint.relays) : "n/a"}</strong>
            </div>
            <div className="panel-inset">
              <span className="hero-highlight-label">Window Rewards</span>
              <strong>{formatDecimal(totalRevenue, 1)} POKT</strong>
            </div>
            <div className="panel-inset">
              <span className="hero-highlight-label">Window Relays</span>
              <strong>{formatCompactNumber(totalRelays)}</strong>
            </div>
          </div>

          <div className="network-trend-chart" aria-label="Network revenue and relay trend chart">
            <svg className="network-trend-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={linePath} />
            </svg>
            {trendPoints.map((point) => {
              const height = maxRelays === 0 ? 2 : Math.max(4, Math.round((point.relays / maxRelays) * 100));
              const isActive = point === latestPoint;

              return (
                <div key={point.day} className="network-trend-bar-group" title={`${point.day}: ${formatCompactNumber(point.relays)} relays, ${formatDecimal(point.revenue, 1)} POKT`}>
                  <div
                    className="network-trend-bar"
                    style={{
                      height: `${height}%`,
                      background: isActive ? 'linear-gradient(180deg, var(--green), rgba(25, 195, 125, 0.25))' : undefined,
                      boxShadow: isActive ? '0 0 20px rgba(25, 195, 125, 0.25)' : undefined
                    }}
                  />
                  <span>{point.day.slice(5)}</span>
                </div>
              );
            })}
          </div>

          <p className="footer-note network-trend-legend">
            <span>
              <span className="network-trend-legend-bar" />
              Daily relays
            </span>
            <span>
              <span className="network-trend-legend-line" />
              Daily rewards
            </span>
          </p>
        </>
      ) : (
        <p className="footer-note">Network history is currently unavailable.</p>
      )}
    </section>
  );
}

function DonutMeter({ value, label, detail, icon }: { value: number; label: string; detail: string; icon?: React.ReactNode }) {
  const degrees = Math.max(0, Math.min(360, Math.round((value / 100) * 360)));

  return (
    <div className="donut-card">
      <div
        className="donut-ring"
        style={{
          background: `conic-gradient(from 220deg, var(--accent) 0deg, var(--accent-strong) ${degrees}deg, rgba(255,255,255,0.05) ${degrees}deg 360deg)`
        }}
      >
        <div className="donut-inner">
          {icon && <div style={{ color: 'var(--accent)', marginBottom: '4px' }}>{icon}</div>}
          <strong>{formatPercent(value, 1)}</strong>
          <span>{label}</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '12px' }}>{detail}</p>
    </div>
  );
}

function ServiceDemandMap({ services, totalRevenue }: { services: SerializedServiceStats[]; totalRevenue: string }) {
  const topServices = services
    .filter((service) => BigInt(service.revenueUpokt) > 0n || service.relays > 0)
    .slice(0, 10);
  const maxRevenue = Math.max(...topServices.map((service) => toPoktNumber(service.revenueUpokt)), 1);

  return (
    <div className="opportunity-grid">
      {topServices.length === 0 && (
        <div className="opportunity-card">
          <div className="opportunity-head">
            <div>
              <strong style={{ fontSize: '1.1rem' }}>No service demand yet</strong>
              <div className="muted">Service-level demand will appear after settlement facts are indexed.</div>
            </div>
          </div>
        </div>
      )}
      {topServices.map((service) => {
        const width = Math.max(8, Math.round((toPoktNumber(service.revenueUpokt) / maxRevenue) * 100));
        const share = getShare(service.revenueUpokt, totalRevenue);
        const density = (service.supplierCount ?? 0) <= 25 ? "low" : (service.supplierCount ?? 0) <= 75 ? "medium" : "high";
        const revenuePerMillionRelays = getRevenuePerMillionRelays(service);

        return (
          <div key={service.serviceId} className="opportunity-card">
            <div className="opportunity-head">
              <div>
                <strong style={{ fontSize: '1.1rem' }}>{service.serviceName}</strong>
                <div className="muted mono">{service.serviceId}</div>
              </div>
              <span className={`density density-${density}`}>
                {getSupplierDensityLabel(service)}
              </span>
            </div>
            <div className="opportunity-metric-row" style={{ marginTop: '16px' }}>
              <span className="muted">Settled rewards</span>
              <strong className="accent-number">{formatUpokt(BigInt(service.revenueUpokt), 1)}</strong>
            </div>
            <div className="opportunity-metric-row">
              <span className="muted">Reward / 1M relays</span>
              <strong className="accent-number" style={{ color: 'var(--green)' }}>{formatDecimal(revenuePerMillionRelays, 2)} POKT</strong>
            </div>
            <div className="opportunity-track" style={{ margin: '16px 0' }}>
              <div className="opportunity-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="opportunity-foot">
              <span>{formatInteger(service.supplierCount ?? 0)} suppliers live</span>
              <span>{formatInteger(service.providerCount)} active domains</span>
              <span>{formatPercent(share, 1)} market share</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DomainDistribution({ data }: { data: SerializedDashboardData }) {
  const buckets = buildDomainBuckets(data.providers);
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="distribution-grid">
      {buckets.map((bucket) => {
        const width = Math.max(8, Math.round((bucket.count / maxCount) * 100));
        const share = getShare(bucket.revenue.toString(), data.totalRevenueUpokt);
        return (
          <div key={bucket.label} className="distribution-row">
            <div className="distribution-row-head">
              <strong>{bucket.label}</strong>
              <span className="muted">{formatInteger(bucket.count)} domains</span>
            </div>
            <div className="opportunity-track">
              <div className="opportunity-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="opportunity-foot">
              <span>{formatUpokt(bucket.revenue, 1)}</span>
              <span>{formatPercent(share, 1)} of rewards</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardView({ initialWindow, dataByWindow, networkHistory }: DashboardViewProps) {
  const [datasets, setDatasets] = useState<Record<TimeWindow, SerializedDashboardData | null>>(dataByWindow);
  const [window, setWindow] = useState<TimeWindow>(initialWindow);
  const [isPending, startTransition] = useTransition();
  const data = useMemo(() => datasets[window] ?? datasets[initialWindow], [datasets, initialWindow, window]);

  function loadWindow(entry: TimeWindow, activate = false) {
    if (datasets[entry]) {
      if (activate) {
        setWindow(entry);
      }
      return;
    }

    void fetch(`/api/dashboard?window=${entry}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok && response.status !== 202) {
          return null;
        }

        return (await response.json()) as DashboardApiResponse;
      })
      .then((payload) => {
        if (!payload || "status" in payload) {
          return;
        }

        startTransition(() => {
          setDatasets((current) => ({ ...current, [entry]: payload }));
          if (activate) {
            setWindow(entry);
          }
        });
      })
      .catch(() => {
        // Leave the current view in place if this background request fails.
      });
  }

  useEffect(() => {
    const missingWindows = WINDOWS.filter((entry) => !datasets[entry]);
    if (missingWindows.length === 0) {
      return;
    }

    loadWindow(missingWindows[0], false);

    const retryId = globalThis.setInterval(() => {
      loadWindow(missingWindows[0], false);
    }, WARMING_RETRY_MS);

    return () => globalThis.clearInterval(retryId);
  }, [datasets]);

  if (!data) {
    return (
      <main className="page">
        <section className="hero hero-stack">
          <div className="panel hero-showcase">
            <div className="hero-main">
              <div className="hero-copy hero-copy-strong">
                <span className="eyebrow">Pocket Network</span>
                <h1>Pocket Network Public Analytics.</h1>
                <p>
                  Public service demand, relay, and reward analytics built from indexed Pocket settlement events.
                  No named provider rankings, provider pages, or operator-level playbooks are exposed.
                </p>

                <div className="window-tabs" aria-label="time windows">
                  {WINDOWS.map((entry) => {
                    const active = entry === window;
                    return (
                      <button
                        key={entry}
                        type="button"
                        className={`window-tab${active ? " active" : ""}`}
                        onClick={() => loadWindow(entry, true)}
                      >
                        {entry}
                      </button>
                    );
                  })}
                </div>
              </div>

              <aside className="hero-side panel panel-inset">
                <div className="section-title-row compact-gap">
                  <h2 className="section-title">Status</h2>
                  <span className="pill">Calibrating market data</span>
                </div>
                <div className="insight-list">
                  <div className="insight-row">
                    <span className="muted">Initial dataset</span>
                    <strong>Refreshing in background</strong>
                  </div>
                  <div className="insight-row">
                    <span className="muted">Experience mode</span>
                    <strong>Instant shell, no blocking</strong>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const topService = data.services[0];
  const averageRevenuePerProvider = data.activeProviders === 0 ? 0 : toPoktNumber(data.totalRevenueUpokt) / data.activeProviders;
  const medianRevenuePerProvider = median(data.providers.map((provider) => toPoktNumber(provider.revenueUpokt)));
  const revenuePerMillionRelays = data.totalRelays === 0 ? 0 : (toPoktNumber(data.totalRevenueUpokt) / data.totalRelays) * 1_000_000;
  const top5ProviderShare = getShare(
    data.providers.slice(0, 5).reduce((sum, provider) => sum + BigInt(provider.revenueUpokt), 0n).toString(),
    data.totalRevenueUpokt
  );
  const top5ServiceShare = getShare(
    data.services.slice(0, 5).reduce((sum, service) => sum + BigInt(service.revenueUpokt), 0n).toString(),
    data.totalRevenueUpokt
  );
  const totalRevenueUsd = toUsdFromUpokt(data.totalRevenueUpokt, data.poktPriceUsd);
  const averageRevenuePerProviderUsd = averageRevenuePerProvider * data.poktPriceUsd;
  const revenuePerMillionRelaysUsd = revenuePerMillionRelays * data.poktPriceUsd;
  const indexerLag =
    data.indexerTargetHeight != null && data.indexerProcessedHeight != null
      ? Math.max(0, data.indexerTargetHeight - data.indexerProcessedHeight)
      : null;
  return (
    <main className="page">
      <section className="hero hero-stack">
        <div className="panel hero-showcase" style={{ overflow: 'hidden', position: 'relative' }}>
          <div style={{ 
            position: 'absolute', 
            top: '-10%', 
            right: '-5%', 
            width: '40%', 
            height: '120%', 
            background: 'radial-gradient(circle, rgba(0, 194, 255, 0.05) 0%, transparent 70%)',
            pointerEvents: 'none'
          }} />
          
          <div className="hero-main">
            <div className="hero-copy hero-copy-strong">
              <span className="eyebrow">Network Analytics</span>
              <h1>Public data for Pocket.</h1>
              <p style={{ fontSize: '1.1rem', maxWidth: '600px' }}>
                Analyze finalized relay demand, rewards, and market trends through a neutral, public-facing lens.
              </p>

              <div className="window-tabs" aria-label="time windows">
                {WINDOWS.map((entry) => {
                  const active = entry === window;
                  return (
                    <button
                      key={entry}
                      type="button"
                      className={`window-tab${active ? " active" : ""}`}
                      onClick={() => loadWindow(entry, true)}
                    >
                      {entry === "24h" ? "Real-time" : entry === "7d" ? "Weekly" : "Monthly"}
                    </button>
                  );
                })}
              </div>

              <div className="hero-highlight-grid">
                <div className="hero-highlight">
                  <span className="hero-highlight-label">Reward Pool</span>
                  <strong className="accent-number" style={{ color: 'var(--accent)' }}>{formatUpokt(toBigInt(data.totalRevenueUpokt), 1)}</strong>
                  <p>Total rewards distributed in the selected period.</p>
                </div>
                <div className="hero-highlight">
                  <span className="hero-highlight-label">Domain Benchmark</span>
                  <strong className="accent-number" style={{ color: 'var(--green)' }}>{formatDecimal(averageRevenuePerProvider, 1)} POKT</strong>
                  <p>Average earnings across active domains.</p>
                </div>
              </div>
            </div>

            <aside className="hero-side panel-inset" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
              <div className="section-title-row compact-gap">
                <div>
                  <h2 className="section-title">Quick Snapshot</h2>
                  <p className="muted" style={{ fontSize: '0.8rem' }}>Key market indicators</p>
                </div>
                <span className="pill">{formatRelativeRange(window)}</span>
              </div>
              <div className="insight-list">
                <div className="insight-row"><span className="muted">Active Domains</span><strong>{formatInteger(data.activeProviders)}</strong></div>
                <div className="insight-row"><span className="muted">Active Services</span><strong>{formatInteger(data.activeChains)}</strong></div>
                <div className="insight-row"><span className="muted">Median Earnings</span><strong>{formatDecimal(medianRevenuePerProvider, 1)} POKT</strong></div>
                <div className="insight-row"><span className="muted">Top 5 Market Share</span><strong>{formatPercent(top5ProviderShare, 1)}</strong></div>
              </div>
            </aside>
          </div>
        </div>

        <div className="hero-support-grid">
          <article className="panel narrative-card">
            <span className="eyebrow eyebrow-ghost">Highlights</span>
            <h2>Network insights.</h2>
            <ul className="narrative-points">
              <li>
                <strong>{formatDecimal(revenuePerMillionRelays, 2)} POKT</strong> earned per 1M relays in this window.
              </li>
              <li>
                <strong>{formatUsd(revenuePerMillionRelaysUsd, 2)}</strong> estimated value per 1M relays.
              </li>
              <li>
                <strong>{formatDecimal(medianRevenuePerProvider, 1)} POKT</strong> median benchmark for active domains.
              </li>
              <li>
                <strong>{topService ? topService.serviceName : "n/a"}</strong> is currently the highest-reward service.
              </li>
            </ul>
          </article>

          <article className="panel section section-visual themed section-theme-demand">
            <div className="section-title-row">
              <div>
                <h2 className="section-title">Market Shape</h2>
                <p className="section-subtitle">Concentration and service distribution signals.</p>
              </div>
              <span className="pill">Overview</span>
            </div>

            <div className="donut-grid">
              <DonutMeter 
                value={top5ProviderShare} 
                label="Top 5 Aggregate" 
                detail="Combined reward share of the five largest anonymous domain cohorts." 
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
              />
              <DonutMeter 
                value={100 - top5ProviderShare} 
                label="Long-Tail Share" 
                detail="Reward share held outside the five largest anonymous domain cohorts." 
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              />
              <DonutMeter 
                value={top5ServiceShare} 
                label="Core Mix" 
                detail="Revenue driven by the top 5 high-demand chains." 
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>}
              />
            </div>
          </article>
        </div>
      </section>

      <section className="kpi-grid kpi-grid-strong">
        <article className="panel kpi kpi-primary">
          <span className="kpi-label">Total Revenue</span>
          <span className="kpi-value">{formatUpokt(toBigInt(data.totalRevenueUpokt))}</span>
          <span className="kpi-foot">{formatUsd(totalRevenueUsd, 0)} est. value</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Relays</span>
          <span className="kpi-value">{formatCompactNumber(data.totalRelays)}</span>
          <span className="kpi-foot">Total finalized volume</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Avg. Earnings</span>
          <span className="kpi-value" style={{ color: 'var(--green)' }}>{formatDecimal(averageRevenuePerProvider, 1)} POKT</span>
          <span className="kpi-foot">Per domain benchmark</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Unit Revenue</span>
          <span className="kpi-value" style={{ color: 'var(--accent)' }}>{formatDecimal(revenuePerMillionRelays, 2)} POKT</span>
          <span className="kpi-foot">Per 1M relays</span>
        </article>
      </section>

      <NetworkTrendPanel history={networkHistory} />

      <section className="panel section section-opportunity themed section-theme-demand">
        <div className="section-title-row">
          <div>
              <h2 className="section-title">Service Demand</h2>
              <p className="section-subtitle">
                Reward and participation signals by service. identities and private mixes are not exposed.
              </p>
            </div>
            <span className="pill">Public Data</span>
        </div>

        <ServiceDemandMap services={data.services} totalRevenue={data.totalRevenueUpokt} />
      </section>

      <section className="section-grid">
        <article className="panel section themed section-theme-privacy">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Domain Distribution</h2>
              <p className="section-subtitle">Aggregated reward buckets for active domains.</p>
            </div>
            <span className="pill">Privacy</span>
          </div>
          <DomainDistribution data={data} />
        </article>

        <article className="panel section themed section-theme-revenue">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Top Services</h2>
              <p className="section-subtitle">Chains with the highest reward pools.</p>
            </div>
            <span className="pill">Rewards</span>
          </div>

          <div className="service-list">
            {data.services.slice(0, 8).map((service) => {
              const revenuePerProvider = toPoktNumber(service.revenueUpokt) / Math.max(service.providerCount, 1);
              return (
                <div key={service.serviceId} className="service-row service-row-rich">
                  <div className="service-row-top">
                    <div>
                      <strong style={{ fontSize: '1.05rem' }}>{service.serviceName}</strong>
                      <div className="muted mono">{service.serviceId}</div>
                    </div>
                    <div className="right">
                      <strong className="accent-number" style={{ fontSize: '1.1rem' }}>{formatUpokt(toBigInt(service.revenueUpokt), 1)}</strong>
                       <div className="muted" style={{ fontSize: '0.85rem' }}>{formatInteger(service.relays)} relays</div>
                     </div>
                   </div>
                   <div className="provider-row-metrics">
                     <span>{formatInteger(service.providerCount)} domains</span>
                     <span style={{ color: 'var(--green)' }}>{formatDecimal(revenuePerProvider, 1)} POKT / domain</span>
                   </div>
                 </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="panel section hero-meta themed section-theme-integrity">
        <div className="section-title-row compact-gap">
          <div>
            <h2 className="section-title">System Status</h2>
            <p className="muted" style={{ fontSize: '0.8rem' }}>Data integrity and sync diagnostics</p>
          </div>
          <span className="pill">Health</span>
        </div>
        
        <div className="insight-list">
          <div className="insight-row">
            <span className="muted">Data Source</span>
            <strong style={{ color: data.dataSource === "poktscan" ? 'var(--green)' : 'var(--orange)' }}>
              {data.dataSource === "poktscan" ? "Legacy Verified" : "Live RPC Sync"}
            </strong>
          </div>
          <div className="insight-row">
            <span className="muted">Chain Height</span>
            <strong className="mono">{formatInteger(data.latestHeight)}</strong>
          </div>
          {indexerLag != null && (
            <div className="insight-row">
              <span className="muted">Indexer Lag</span>
              <strong style={{ color: indexerLag > 10 ? 'var(--red)' : 'var(--green)' }}>{formatInteger(indexerLag)} blocks</strong>
            </div>
          )}
          <div className="insight-row">
            <span className="muted">Market Price</span>
            <strong className="accent-number" style={{ color: 'var(--accent)' }}>{formatUsd(data.poktPriceUsd, 4)} POKT/USD</strong>
          </div>
          <div className="insight-row">
            <span className="muted">Last Updated</span>
            <strong>{new Date(data.generatedAt).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          </div>
          {isPending && (
            <div className="insight-row">
              <span className="muted">Status</span>
              <strong style={{ color: 'var(--accent)' }}>Updating...</strong>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

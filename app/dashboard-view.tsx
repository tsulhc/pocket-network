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

function compareRevenueDesc<T extends { revenueUpokt: string }>(a: T, b: T): number {
  const aRevenue = BigInt(a.revenueUpokt);
  const bRevenue = BigInt(b.revenueUpokt);
  if (aRevenue === bRevenue) return 0;
  return bRevenue > aRevenue ? 1 : -1;
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
  const todayUtc = new Date().toISOString().slice(0, 10);
  const candidatePoints = history
    .filter((point) => point.day < todayUtc)
    .slice(-30);
  const daysWithCU = candidatePoints.filter((p) => (p.estimatedComputeUnits ?? 0) > 0).length;
  const allDaysHaveCU = daysWithCU === candidatePoints.length && candidatePoints.length > 0;
  const useCU = allDaysHaveCU;
  const trendPoints = candidatePoints.map((point) => ({
    day: point.day,
    revenue: toPoktNumber(point.revenueUpokt),
    cuLoad: useCU ? point.estimatedComputeUnits! : point.relays
  }));
  const maxRevenue = Math.max(...trendPoints.map((point) => point.revenue), 0);
  const maxCULoad = Math.max(...trendPoints.map((point) => point.cuLoad), 0);
  const latestPoint = trendPoints.at(-1);
  const totalRevenue = trendPoints.reduce((sum, point) => sum + point.revenue, 0);
  const totalCULoad = trendPoints.reduce((sum, point) => sum + point.cuLoad, 0);
  const linePath = buildNetworkTrendPath(trendPoints, maxRevenue);
  const hasData = trendPoints.some((point) => point.revenue > 0 || point.cuLoad > 0);

  return (
    <section className="panel section network-trend-panel themed section-theme-demand" style={{ position: 'relative' }}>
      <div className="section-title-row">
        <div>
          <span className="eyebrow eyebrow-ghost">Market</span>
          <h2 className="section-title">Network Trend</h2>
          <p className="section-subtitle">Daily rewards and finalized compute unit demand over the last 30 days.</p>
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
              <span className="hero-highlight-label">{useCU ? "Latest CU" : "Latest Relays"}</span>
              <strong style={{ color: 'var(--green)' }}>{latestPoint ? formatCompactNumber(latestPoint.cuLoad) : "n/a"}</strong>
            </div>
            <div className="panel-inset">
              <span className="hero-highlight-label">Window Rewards</span>
              <strong>{formatDecimal(totalRevenue, 1)} POKT</strong>
            </div>
            <div className="panel-inset">
              <span className="hero-highlight-label">{useCU ? "Window CU" : "Window Relays"}</span>
              <strong>{formatCompactNumber(totalCULoad)}</strong>
            </div>
          </div>

          <div className="network-trend-chart" aria-label="Network revenue and workload trend chart">
            <div className="network-trend-gridlines" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <svg className="network-trend-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={linePath} />
            </svg>
            {trendPoints.map((point) => {
              const height = maxCULoad === 0 ? 2 : Math.max(4, Math.round((point.cuLoad / maxCULoad) * 100));
              const isActive = point === latestPoint;
              const loadUnit = useCU ? "CU" : "relays";

              return (
                <div key={point.day} className="network-trend-bar-group" title={`${point.day}: ${formatCompactNumber(point.cuLoad)} ${loadUnit}, ${formatDecimal(point.revenue, 1)} POKT`}>
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
              Daily {useCU ? "compute units" : "relays"}
            </span>
            <span>
              <span className="network-trend-legend-line" />
              Daily rewards, independently scaled
            </span>
          </p>
        </>
      ) : (
        <p className="footer-note">Network history is currently unavailable.</p>
      )}
    </section>
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

  const servicesByRevenue = [...data.services].sort(compareRevenueDesc);
  const topService = servicesByRevenue[0];
  const cuCoverageComplete = data.totalEstimatedComputeUnits > 0;
  const cuDenominator = cuCoverageComplete ? data.totalEstimatedComputeUnits : data.totalRelays;
  const cuLabel = cuCoverageComplete ? "estimated compute units" : "relays";
  const revenuePerMillionCU = cuDenominator === 0 ? 0 : (toPoktNumber(data.totalRevenueUpokt) / cuDenominator) * 1_000_000;
  const indexerLag =
    data.indexerTargetHeight != null && data.indexerProcessedHeight != null
      ? Math.max(0, data.indexerTargetHeight - data.indexerProcessedHeight)
      : null;
  return (
    <main className="page">
      <section className="hero hero-stack dashboard-hero">
        <div className="panel hero-showcase dashboard-hero-showcase">
          <div className="dashboard-hero-orb" />

          <div className="hero-main dashboard-hero-main">
            <div className="hero-copy hero-copy-strong dashboard-hero-copy">
              <span className="eyebrow">Network Analytics</span>
              <h1>Earn POKT Serving Workload.</h1>
              <p>
                Track finalized compute units, rewards, and service concentration through a privacy-safe lens built from indexed settlement events.
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
                      {entry === "24h" ? "24 hours" : entry === "7d" ? "Weekly" : entry === "30d" ? "Monthly" : "Yearly"}
                    </button>
                  );
                })}
              </div>

              <div className="hero-highlight-grid dashboard-primary-metrics">
                <div className="hero-highlight metric-glow-revenue">
                  <span className="hero-highlight-label">Reward Pool</span>
                  <strong className="accent-number">{formatUpokt(toBigInt(data.totalRevenueUpokt), 1)}</strong>
                  <p>Total rewards distributed in the selected period.</p>
                </div>
                <div className="hero-highlight metric-glow-demand">
                  <span className="hero-highlight-label">{cuCoverageComplete ? "Compute Units" : "Relay Volume"}</span>
                  <strong className="accent-number">{formatCompactNumber(cuCoverageComplete ? data.totalEstimatedComputeUnits : data.totalRelays)}</strong>
                  <p>{cuCoverageComplete ? "Estimated compute workload captured in this window." : "Finalized relay demand captured in this window."}</p>
                </div>
              </div>
            </div>

            <aside className="hero-side panel-inset network-pulse-card">
              <div className="section-title-row compact-gap">
                <div>
                  <span className="eyebrow eyebrow-ghost">Live Pulse</span>
                  <h2 className="section-title">Network Pulse</h2>
                  <p className="muted">Key indicators for {formatRelativeRange(window)}.</p>
                </div>
                <span className="pill">{indexerLag == null || indexerLag <= 10 ? "Synced" : "Catching up"}</span>
              </div>
              <div className="network-pulse-grid">
                <div>
                  <span>Active Provider Groups</span>
                  <strong>{formatInteger(data.activeProviders)}</strong>
                </div>
                <div>
                  <span>Active Chains</span>
                  <strong>{formatInteger(data.activeChains)}</strong>
                </div>
                <div>
                  <span>Rewards</span>
                  <strong>{formatUpokt(toBigInt(data.totalRevenueUpokt), 1)}</strong>
                </div>
                <div>
                  <span>{cuCoverageComplete ? "Compute Units" : "Relay Volume"}</span>
                  <strong>{formatCompactNumber(cuCoverageComplete ? data.totalEstimatedComputeUnits : data.totalRelays)}</strong>
                </div>
              </div>
              <div className="network-pulse-footer">
                <span>Height <strong>{formatInteger(data.latestHeight)}</strong></span>
                {indexerLag != null && <span>Lag <strong>{formatInteger(indexerLag)} blocks</strong></span>}
              </div>
            </aside>
          </div>

          <div className="hero-support-grid" style={{ gridTemplateColumns: "1fr", marginTop: "32px" }}>
            <article className="panel narrative-card dashboard-insight-card">
              <span className="eyebrow eyebrow-ghost">Highlights</span>
              <h2>Pocket Network Highlights.</h2>
              <ul className="narrative-points">
                <li>
                  <strong>{formatDecimal(revenuePerMillionCU, 2)} POKT</strong> earned per 1M {cuLabel} in this period.
                </li>
                <li>
                  <strong>{formatUsd(revenuePerMillionCU * data.poktPriceUsd, 2)}</strong> estimated value per 1M {cuLabel}.
                </li>
                <li>
                  <strong>{topService ? topService.serviceName : "n/a"}</strong> is the top reward chain in this period.
                </li>
                {!cuCoverageComplete && (
                <li className="muted">
                  <em>Estimated compute unit coverage is incomplete ({formatPercent(data.relayCoverage * 100, 0)}); CU-denominated values are derived from sampled relays.</em>
                </li>
                )}
              </ul>
            </article>
          </div>
        </div>

      </section>

      <NetworkTrendPanel history={networkHistory} />
    </main>
  );
}

import Link from "next/link";

import TimeseriesPanel from "@/app/timeseries-panel";
import { formatCompactNumber, formatCompactUpokt, formatCompactUsd, formatDecimal, formatInteger, formatPercent, formatUsd, formatUpokt } from "@/lib/format";
import { getDashboardDataSafe, getNetworkDailyHistoryLocal } from "@/lib/pocket";

export const metadata = {
  title: "Rewards | Pocket Network Analytics",
  description: "Pocket reward flow, methodology, and anonymous concentration across domains and services."
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toPoktNumber(value: bigint): number {
  return Number(value) / 1_000_000;
}

function getShare(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 10_000n) / total) / 100;
}

function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export default async function RewardsPage() {
  const result = getDashboardDataSafe("30d");
  const data = result.data;
  const history = getNetworkDailyHistoryLocal();

  if (!data) {
    return (
      <main className="page">
        <section className="panel section explorer-empty">
          <span className="eyebrow">Rewards</span>
          <h1 className="section-title">Rewards view is warming up.</h1>
          <p className="section-subtitle">The 30d reward snapshot is still being prepared. Refresh shortly to inspect public reward flow.</p>
        </section>
      </main>
    );
  }

  const topService = data.services[0];
  const averageReward = data.activeProviders === 0 ? 0 : toPoktNumber(data.totalRevenueUpokt) / data.activeProviders;
  const top5ProviderRewards = data.providers.slice(0, 5).reduce((sum, provider) => sum + provider.revenueUpokt, 0n);
  const top5ServiceRewards = data.services.slice(0, 5).reduce((sum, service) => sum + service.revenueUpokt, 0n);
  const rewardPerMillionRelays = data.totalRelays === 0 ? 0 : (toPoktNumber(data.totalRevenueUpokt) / data.totalRelays) * 1_000_000;
  const rewardHistoryValues = history.map((point) => toPoktNumber(point.revenueUpokt));
  const rewardHistoryAverage = movingAverage(rewardHistoryValues, 7);
  const rewardHistoryPoints = history.map((point, index) => ({
    label: point.day,
    value: rewardHistoryValues[index] ?? 0,
    secondaryValue: rewardHistoryAverage[index] ?? 0
  }));

  return (
    <main className="page explorer-page">
      <section className="panel section explorer-hero themed section-theme-revenue" style={{ overflow: 'hidden', position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: '-10%', 
          right: '-5%', 
          width: '30%', 
          height: '120%', 
          background: 'radial-gradient(circle, rgba(245, 200, 66, 0.05) 0%, transparent 70%)',
          pointerEvents: 'none'
        }} />
        
        <div>
          <span className="eyebrow">Settlement</span>
          <h1>Network Rewards.</h1>
          <p className="section-subtitle" style={{ fontSize: '1.1rem', maxWidth: '600px' }}>
            Inspect finalized reward flow across the ecosystem. Analyze concentration, unit yields, and settlement methodology.
          </p>
        </div>
        
        <div className="explorer-summary-grid">
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Total Rewards</span>
            <strong style={{ color: 'var(--yellow-primary)' }}>{formatCompactUpokt(data.totalRevenueUpokt, 1)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Est. Value</span>
            <strong style={{ color: 'var(--text)' }}>{formatCompactUsd(toPoktNumber(data.totalRevenueUpokt) * data.poktPriceUsd, 1)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Yield / 1M Relays</span>
            <strong style={{ color: 'var(--green)' }}>{formatDecimal(rewardPerMillionRelays, 2)} POKT</strong>
          </article>
        </div>
      </section>

      <section className="kpi-grid kpi-grid-strong rewards-kpi-grid">
        <article className="panel kpi kpi-primary">
          <span className="kpi-label">Avg. Domain Earnings</span>
          <span className="kpi-value">{formatDecimal(averageReward, 1)} POKT</span>
          <span className="kpi-foot">Across {formatInteger(data.activeProviders)} domains</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Active Domains</span>
          <span className="kpi-value">{formatInteger(data.activeProviders)}</span>
          <span className="kpi-foot">With rewards in the 30d window</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Top 5 Concentration</span>
          <span className="kpi-value" style={{ color: 'var(--accent)' }}>{formatPercent(getShare(top5ProviderRewards, data.totalRevenueUpokt), 1)}</span>
          <span className="kpi-foot">Share of top 5 entities</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Top Service Share</span>
          <span className="kpi-value" style={{ color: 'var(--yellow-primary)' }}>{topService ? formatPercent(getShare(topService.revenueUpokt, data.totalRevenueUpokt), 1) : "n/a"}</span>
          <span className="kpi-foot">{topService?.serviceName ?? "No activity"}</span>
        </article>
      </section>

      <TimeseriesPanel
        title="Reward Flow"
        subtitle="Daily settled rewards with a 7-day moving average."
        eyebrow="Trend"
        points={rewardHistoryPoints}
        valueLabel="rewards"
        formatValue={(value) => `${formatDecimal(value, 1)} POKT`}
        emptyText="Daily history is currently unavailable."
        theme="revenue"
      />

      <section className="section-grid rewards-grid">
        <article className="panel section themed section-theme-integrity">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Methodology</h2>
              <p className="section-subtitle">Defining finalized reward flow.</p>
            </div>
            <span className="pill">Settlement</span>
          </div>
          <div className="reward-method-list">
            <div className="reward-method-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">Source</span>
              <strong style={{ fontSize: '1.1rem' }}>Claim Settlements</strong>
              <p style={{ fontSize: '0.85rem' }}>Rewards are extracted from protocol events emitted during block finalization.</p>
            </div>
            <div className="reward-method-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">Attribution</span>
              <strong style={{ fontSize: '1.1rem' }}>Supplier Share</strong>
              <p style={{ fontSize: '0.85rem' }}>We capture the specific share allocated directly to suppliers, excluding DAO and other targets.</p>
            </div>
            <div className="reward-method-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">Aggregation</span>
              <strong style={{ fontSize: '1.1rem' }}>Domain Cohorts</strong>
              <p style={{ fontSize: '0.85rem' }}>Operators are grouped into anonymous domains for neutral public benchmarking.</p>
            </div>
          </div>
        </article>

        <article className="panel section themed section-theme-privacy">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Concentration</h2>
              <p className="section-subtitle">30d reward distribution profile.</p>
            </div>
            <span className="pill">Market Shape</span>
          </div>
          <div className="insight-list">
            <div className="insight-row">
              <span className="muted">Top 5 Groups</span>
              <strong className="accent-number" style={{ color: 'var(--accent)' }}>{formatUpokt(top5ProviderRewards, 1)}</strong>
            </div>
            <div className="insight-row">
              <span className="muted">Top 5 Services</span>
              <strong className="accent-number">{formatUpokt(top5ServiceRewards, 1)}</strong>
            </div>
            <div className="insight-row">
              <span className="muted">Volume</span>
              <strong>{formatCompactNumber(data.totalRelays)} relays</strong>
            </div>
            <div className="insight-row">
              <span className="muted">Source</span>
              <strong style={{ color: 'var(--green)' }}>{data.dataSource === "poktscan" ? "Verified" : "Node Sync"}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="section-grid rewards-grid">
        <article className="panel section themed section-theme-revenue">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Top Services</h2>
              <p className="section-subtitle">Chains driving the highest rewards.</p>
            </div>
            <Link href="/chains" className="calculator-action" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}>
              All Chains →
            </Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="right">Rewards</th>
                  <th className="right">Domains</th>
                </tr>
              </thead>
              <tbody>
                {data.services.slice(0, 10).map((service) => (
                  <tr key={service.serviceId}>
                    <td>
                      <strong style={{ fontSize: '1.05rem' }}>{service.serviceName}</strong>
                      <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: '4px' }}>{service.serviceId}</div>
                    </td>
                    <td className="right">
                      <strong className="accent-number">{formatUpokt(service.revenueUpokt, 1)}</strong>
                    </td>
                    <td className="right">
                      {formatInteger(service.providerCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}

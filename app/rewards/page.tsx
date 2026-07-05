import Link from "next/link";

import TimeseriesPanel from "@/app/timeseries-panel";
import { formatCompactNumber, formatCompactUpokt, formatCompactUsd, formatDecimal, formatInteger, formatPercent, formatUpokt } from "@/lib/format";
import { buildAllocatedServiceOpportunity, DEFAULT_NEW_PROVIDER_SUPPLIERS } from "@/lib/opportunities";
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

function compareRevenueDesc<T extends { revenueUpokt: bigint }>(a: T, b: T): number {
  if (a.revenueUpokt === b.revenueUpokt) return 0;
  return b.revenueUpokt > a.revenueUpokt ? 1 : -1;
}

function buildDomainBuckets(providers: Array<{ revenueUpokt: bigint }>) {
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
    bucket.revenue += provider.revenueUpokt;
  }

  return buckets.map(({ label, count, revenue }) => ({ label, count, revenue }));
}

function DonutMeter({ value, label, detail }: { value: number; label: string; detail: string }) {
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
          <strong>{formatPercent(value, 1)}</strong>
          <span>{label}</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '12px' }}>{detail}</p>
    </div>
  );
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

  const providersByRevenue = [...data.providers].sort(compareRevenueDesc);
  const servicesByRevenue = [...data.services].sort(compareRevenueDesc);
  const topService = servicesByRevenue[0];
  const averageReward = data.activeProviders === 0 ? 0 : toPoktNumber(data.totalRevenueUpokt) / data.activeProviders;
  const top5ProviderRewards = providersByRevenue.slice(0, 5).reduce((sum, provider) => sum + provider.revenueUpokt, 0n);
  const top5ServiceRewards = servicesByRevenue.slice(0, 5).reduce((sum, service) => sum + service.revenueUpokt, 0n);
  const estimatedCoverageComplete = data.relayCoverage >= 1;
  const relayDenominator = estimatedCoverageComplete && data.totalEstimatedRelays > 0 ? data.totalEstimatedRelays : data.totalRelays;
  const rewardPerMillionRelays = relayDenominator === 0 ? 0 : (toPoktNumber(data.totalRevenueUpokt) / relayDenominator) * 1_000_000;
  const rewardHistoryValues = history.map((point) => toPoktNumber(point.revenueUpokt));
  const rewardHistoryAverage = movingAverage(rewardHistoryValues, 7);
  const rewardHistoryPoints = history.map((point, index) => ({
    label: point.day,
    value: rewardHistoryValues[index] ?? 0,
    secondaryValue: rewardHistoryAverage[index] ?? 0
  }));
  const topOpportunityServices = [...data.services]
    .map((service) => ({
      service,
      opportunity: buildAllocatedServiceOpportunity(service, DEFAULT_NEW_PROVIDER_SUPPLIERS, DEFAULT_NEW_PROVIDER_SUPPLIERS, { sessionSlots: data.suppliersPerSession, appsStaked: service.appsStaked })
    }))
    .sort((a, b) => b.opportunity.opportunityScore - a.opportunity.opportunityScore)
    .slice(0, 4);
  const domainBuckets = buildDomainBuckets(data.providers);
  const top5ServiceShare = getShare(top5ServiceRewards, data.totalRevenueUpokt);
  const longTailShare = Math.max(0, 100 - getShare(top5ProviderRewards, data.totalRevenueUpokt));

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
          <h1>Network Rewards (Last 30 Days).</h1>
          <p className="section-subtitle" style={{ fontSize: '1.1rem', maxWidth: '600px' }}>
            Inspect finalized reward flow across the ecosystem for the last 30 days. Analyze concentration, unit yields, and settlement methodology.
          </p>
        </div>
        <span className="pill">30d window</span>
        
        <div className="explorer-summary-grid">
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Total Rewards (30d)</span>
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
              <h2 className="section-title">Market Shape</h2>
              <p className="section-subtitle">30d reward concentration and long-tail share.</p>
            </div>
            <span className="pill">Concentration</span>
          </div>
          <div className="donut-grid">
            <DonutMeter
              value={getShare(top5ProviderRewards, data.totalRevenueUpokt)}
              label="Top 5 Groups"
              detail="Combined reward share of the five largest anonymous domain cohorts."
            />
            <DonutMeter
              value={longTailShare}
              label="Long-Tail Share"
              detail="Reward share held outside the five largest anonymous domain cohorts."
            />
            <DonutMeter
              value={top5ServiceShare}
              label="Core Mix"
              detail="Revenue driven by the top 5 high-demand chains."
            />
          </div>
        </article>
      </section>

      <section className="panel section themed section-theme-demand">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Domain Distribution</h2>
            <p className="section-subtitle">Aggregated reward buckets for active domains.</p>
          </div>
          <span className="pill">Privacy</span>
        </div>
        <div className="distribution-grid">
          {domainBuckets.map((bucket) => {
            const maxCount = Math.max(...domainBuckets.map((entry) => entry.count), 1);
            const width = Math.max(8, Math.round((bucket.count / maxCount) * 100));
            const share = getShare(bucket.revenue, data.totalRevenueUpokt);

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
      </section>

      <section className="panel section themed section-theme-revenue">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Top 4 Opportunities</h2>
            <p className="section-subtitle">Best services for a new provider based on an experimental opportunity score.{data.sessionStale && <em className="muted"> Session parameters are stale; opportunity scores use last-known values{data.sessionFetchedAt ? ` from ${data.sessionFetchedAt}` : ""}.</em>}</p>
          </div>
          <Link href="/chains" className="calculator-action" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}>
            Explore all services →
          </Link>
        </div>

        <div className="explorer-summary-grid">
          {topOpportunityServices.map(({ service, opportunity }, index) => (
            <article key={service.serviceId} className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">#{index + 1}</span>
              <strong style={{ fontSize: '1rem' }}>{service.serviceName}</strong>
              <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: '4px' }}>{service.serviceId}</div>
              <div style={{ marginTop: '12px' }}>
                <div><strong style={{ color: 'var(--accent)' }}>{formatDecimal(opportunity.opportunityScore, 1)}</strong> score</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>{formatUpokt(opportunity.equalShareRevenueEstimateUpokt, 1)} projected over 15 suppliers</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>{formatPercent(opportunity.selectionProbability, 1)} selection probability</div>
                {service.appsStaked != null && service.appsStaked > 0 && (
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{formatInteger(service.appsStaked)} apps · {formatDecimal(opportunity.expectedAssignments ?? 0, 1)} exp. sessions</div>
                )}
              </div>
              <div style={{ marginTop: '12px' }}>
                <Link href={`/chains/${encodeURIComponent(service.serviceId)}`} className="calculator-action" style={{ width: '100%', justifyContent: 'center', background: 'var(--panel-strong)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}>
                  View service
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

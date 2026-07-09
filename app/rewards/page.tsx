import TimeseriesPanel from "@/app/timeseries-panel";
import RevenueCalculator from "@/app/revenue-calculator";
import { formatCompactUpokt, formatCompactUsd, formatDecimal, formatInteger, formatPercent } from "@/lib/format";
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

type CalculatorService = {
  serviceId: string;
  serviceName: string;
  relays: number;
  revenueUpokt: string;
  providerCount: number;
  supplierCount?: number;
  appsStaked?: number;
};

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
  const cuCoverageComplete = (data.computeUnitCoverage ?? 0) >= 1;
  const cuDenominator = cuCoverageComplete ? data.totalEstimatedComputeUnits : data.totalRelays;
  const rewardPerMillionCU = cuDenominator === 0 ? 0 : (toPoktNumber(data.totalRevenueUpokt) / cuDenominator) * 1_000_000;
  const rewardHistoryValues = history.map((point) => toPoktNumber(point.revenueUpokt));
  const rewardHistoryAverage = movingAverage(rewardHistoryValues, 7);
  const rewardHistoryPoints = history.map((point, index) => ({
    label: point.day,
    value: rewardHistoryValues[index] ?? 0,
    secondaryValue: rewardHistoryAverage[index] ?? 0,
  }));

  const calculatorServices: CalculatorService[] = data.services.map((service) => ({
    serviceId: service.serviceId,
    serviceName: service.serviceName,
    relays: service.relays,
    revenueUpokt: service.revenueUpokt.toString(),
    providerCount: service.providerCount,
    supplierCount: service.supplierCount,
    appsStaked: service.appsStaked,
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
          <h1>Network Rewards (Last 30 Days).</h1>
          <p className="section-subtitle" style={{ fontSize: '1.1rem', maxWidth: '600px' }}>
            Inspect finalized reward flow across the ecosystem. Model your entry with the Growth Simulator below.
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
            <span className="hero-highlight-label">{cuCoverageComplete ? "Yield / 1M CU" : "Yield / 1M Relays"}</span>
            <strong style={{ color: 'var(--green)' }}>{formatDecimal(rewardPerMillionCU, 2)} POKT</strong>
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

        <article className="panel section themed section-theme-revenue">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Yield Metrics</h2>
              <p className="section-subtitle">Key economic indicators for providers in this window.</p>
            </div>
            <span className="pill">Economics</span>
          </div>
          <div className="reward-method-list">
            <div className="reward-method-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">Per-Domain Avg</span>
              <strong style={{ fontSize: '1.1rem' }}>{formatDecimal(averageReward, 1)} POKT</strong>
              <p style={{ fontSize: '0.85rem' }}>Mean revenue earned per active domain cohort.</p>
            </div>
            <div className="reward-method-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <span className="hero-highlight-label">{cuCoverageComplete ? "Yield / 1M CU" : "Yield / 1M Relays"}</span>
              <strong style={{ fontSize: '1.1rem' }}>{formatDecimal(rewardPerMillionCU, 2)} POKT</strong>
              <p style={{ fontSize: '0.85rem' }}>{cuCoverageComplete ? "Revenue per 1M estimated compute units." : "Revenue per 1M sampled relays."}</p>
            </div>
          </div>
        </article>
      </section>

      <RevenueCalculator
        poktPriceUsd={data.poktPriceUsd}
        services={calculatorServices}
        suppliersPerSession={data.suppliersPerSession}
        sessionObservedHeight={data.sessionObservedHeight}
        sessionFetchedAt={data.sessionFetchedAt}
        sessionStale={data.sessionStale}
      />
    </main>
  );
}

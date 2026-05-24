import Link from "next/link";
import { notFound } from "next/navigation";

import TimeseriesPanel from "@/app/timeseries-panel";
import { formatCompactNumber, formatDecimal, formatInteger, formatPercent, formatUsd, formatUpokt } from "@/lib/format";
import { getDashboardDataSafe, getServiceDailyHistoryLocal } from "@/lib/pocket";

type PageProps = {
  params: Promise<{
    serviceId: string;
  }>;
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

export async function generateMetadata({ params }: PageProps) {
  const { serviceId } = await params;
  const decodedServiceId = decodeURIComponent(serviceId);

  return {
    title: `${decodedServiceId} | Pocket Chain Detail`,
      description: `Pocket service rewards, relay demand, and aggregate participation metrics for ${decodedServiceId}.`
  };
}

export default async function ChainDetailPage({ params }: PageProps) {
  const { serviceId } = await params;
  const decodedServiceId = decodeURIComponent(serviceId);
  const result = getDashboardDataSafe("30d");
  const data = result.data;

  if (!data) {
    return (
      <main className="page">
        <section className="panel section explorer-empty">
          <span className="eyebrow">Chain Detail</span>
          <h1 className="section-title">Chain detail is warming up.</h1>
          <p className="section-subtitle">The 30d market snapshot is still being prepared. Refresh shortly to inspect this service.</p>
          <Link href="/chains" className="calculator-action provider-back-link">Back to chains</Link>
        </section>
      </main>
    );
  }

  const service = data.services.find((entry) => entry.serviceId === decodedServiceId);
  if (!service) {
    notFound();
  }

  const history = getServiceDailyHistoryLocal(decodedServiceId);
  const historyValues = history.map((point) => toPoktNumber(point.revenueUpokt));
  const historyAverage = movingAverage(historyValues, 7);
  const historyPoints = history.map((point, index) => ({
    label: point.day,
    value: historyValues[index] ?? 0,
    secondaryValue: historyAverage[index] ?? 0
  }));
  const revenuePerProvider = toPoktNumber(service.revenueUpokt) / Math.max(service.providerCount, 1);
  const suppliersPerDomain = (service.supplierCount ?? 0) / Math.max(service.providerCount, 1);
  const revenuePerMillionRelays = service.relays === 0 ? 0 : (toPoktNumber(service.revenueUpokt) / service.relays) * 1_000_000;

  return (
    <main className="page explorer-page">
      <section className="panel section explorer-hero" style={{ overflow: 'hidden', position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: '-10%', 
          right: '-5%', 
          width: '30%', 
          height: '120%', 
          background: 'radial-gradient(circle, rgba(0, 194, 255, 0.05) 0%, transparent 70%)',
          pointerEvents: 'none'
        }} />

        <div>
          <span className="eyebrow">Chain Profile</span>
          <h1>{service.serviceName}</h1>
          <p className="section-subtitle mono" style={{ fontSize: '0.9rem' }}>{service.serviceId}</p>
          <p className="section-subtitle" style={{ fontSize: '1.1rem', maxWidth: '600px', marginTop: '12px' }}>
            Analyze service-level demand, unit rewards, and aggregate participation for this specific service.
          </p>
          <div className="window-tabs" style={{ marginTop: '24px' }}>
            <Link href="/chains" className="calculator-action" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}>
              Back to Explorer
            </Link>
          </div>
        </div>
        
        <div className="explorer-summary-grid">
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Service Revenue</span>
            <strong style={{ color: 'var(--accent)' }}>{formatUpokt(service.revenueUpokt, 1)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Final Relays</span>
            <strong style={{ color: 'var(--green)' }}>{formatCompactNumber(service.relays)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Active Domains</span>
            <strong style={{ color: 'var(--text)' }}>{formatInteger(service.providerCount)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Live Suppliers</span>
            <strong style={{ color: 'var(--accent)' }}>{formatInteger(service.supplierCount ?? 0)}</strong>
          </article>
        </div>
      </section>

      <section className="kpi-grid kpi-grid-strong rewards-kpi-grid">
        <article className="panel kpi kpi-primary">
          <span className="kpi-label">Avg reward / active domain</span>
          <span className="kpi-value">{formatDecimal(revenuePerProvider, 1)} POKT</span>
          <span className="kpi-foot">{formatUsd(revenuePerProvider * data.poktPriceUsd, 0)} per domain (30d)</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Monetization density</span>
          <span className="kpi-value" style={{ color: 'var(--accent)' }}>{formatDecimal(revenuePerMillionRelays, 2)} POKT</span>
          <span className="kpi-foot">Revenue per 1M relays</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Market influence</span>
          <span className="kpi-value">{formatPercent(getShare(service.revenueUpokt, data.totalRevenueUpokt), 1)}</span>
          <span className="kpi-foot">Share of total network rewards</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Supplier Density</span>
          <span className="kpi-value" style={{ color: 'var(--green)' }}>{formatDecimal(suppliersPerDomain, 1)}</span>
          <span className="kpi-foot">Average suppliers per active domain</span>
        </article>
      </section>

      <TimeseriesPanel
        title="Service Reward Trend"
        subtitle="Daily settled rewards for this service with a 7-day moving average."
        eyebrow="Service Trend"
        points={historyPoints}
        valueLabel="rewards"
        formatValue={(value) => `${formatDecimal(value, 1)} POKT`}
        emptyText="Daily service history is not available yet. The 30d service snapshot remains available above."
      />

      <section className="panel section">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Service Participation Profile</h2>
            <p className="section-subtitle">Aggregate participation and reward signals without naming individual operators.</p>
          </div>
          <span className="pill">Competition</span>
        </div>

        <div className="insight-list">
          <div className="insight-row"><span className="muted">Active Domains</span><strong>{formatInteger(service.providerCount)}</strong></div>
          <div className="insight-row"><span className="muted">Live Suppliers</span><strong>{formatInteger(service.supplierCount ?? 0)}</strong></div>
          <div className="insight-row"><span className="muted">Average Revenue / Domain</span><strong>{formatDecimal(revenuePerProvider, 1)} POKT</strong></div>
          <div className="insight-row"><span className="muted">Service Share</span><strong>{formatPercent(getShare(service.revenueUpokt, data.totalRevenueUpokt), 1)}</strong></div>
        </div>
      </section>
    </main>
  );
}

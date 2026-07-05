"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatCompactNumber, formatCompactUpokt, formatDecimal, formatInteger, formatPercent, formatUsd, formatUpokt } from "@/lib/format";
import { buildAllocatedServiceOpportunity, DEFAULT_NEW_PROVIDER_SUPPLIERS } from "@/lib/opportunities";
import type { SerializedDashboardData, SerializedServiceStats } from "@/lib/types";

type SortKey = "service" | "revenue" | "relays" | "computeUnits" | "providers" | "suppliers" | "revenuePerProvider" | "opportunity";
type SortDirection = "asc" | "desc";

type SortColumn = {
  key: SortKey;
  label: string;
  align?: "right";
  defaultDirection?: SortDirection;
  tooltip?: string;
};

const SORT_COLUMNS: SortColumn[] = [
  { key: "service", label: "Service Identity", defaultDirection: "asc" },
  { key: "revenue", label: "Revenue (30d)", align: "right" },
  { key: "relays", label: "Final Relays", align: "right" },
  { key: "providers", label: "Domains", align: "right" },
  { key: "suppliers", label: "Suppliers", align: "right" },
  { key: "revenuePerProvider", label: "Avg Domain Reward", align: "right" },
  {
    key: "opportunity",
    label: "Demand Signal (experimental)",
    align: "right",
    tooltip: "The higher the score, the more potential for providers to profit from participating in this network."
  }
];

type ChainsExplorerViewProps = {
  data: SerializedDashboardData | null;
  mode?: "chains" | "service-demand";
};

function toPoktNumber(value: string): number {
  return Number(BigInt(value)) / 1_000_000;
}

function revenuePerProvider(service: SerializedServiceStats): number {
  return toPoktNumber(service.revenueUpokt) / Math.max(service.providerCount, 1);
}

function onboardingOpportunityScore(service: SerializedServiceStats): number {
  return buildAllocatedServiceOpportunity(service, DEFAULT_NEW_PROVIDER_SUPPLIERS, DEFAULT_NEW_PROVIDER_SUPPLIERS).opportunityScore;
}

function getSortValue(service: SerializedServiceStats, sort: SortKey): string | number | bigint {
  switch (sort) {
    case "service":
      return service.serviceName;
    case "revenue":
      return BigInt(service.revenueUpokt);
    case "relays":
      return service.relays;
    case "computeUnits":
      return service.computeUnits ?? 0;
    case "providers":
      return service.providerCount;
    case "suppliers":
      return service.supplierCount ?? 0;
    case "revenuePerProvider":
      return revenuePerProvider(service);
    case "opportunity":
      return onboardingOpportunityScore(service);
  }
}

function compareSortValue(a: string | number | bigint, b: string | number | bigint, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * multiplier;
  }

  if (typeof a === "bigint" || typeof b === "bigint") {
    const aBig = typeof a === "bigint" ? a : BigInt(Math.trunc(Number(a)));
    const bBig = typeof b === "bigint" ? b : BigInt(Math.trunc(Number(b)));
    if (aBig === bBig) return 0;
    return (aBig > bBig ? 1 : -1) * multiplier;
  }

  return (Number(a) - Number(b)) * multiplier;
}

function compareRevenueDesc(a: SerializedServiceStats, b: SerializedServiceStats): number {
  const aRevenue = BigInt(a.revenueUpokt);
  const bRevenue = BigInt(b.revenueUpokt);
  if (aRevenue === bRevenue) return a.serviceName.localeCompare(b.serviceName);
  return bRevenue > aRevenue ? 1 : -1;
}

function getSortDirectionLabel(direction: SortDirection): string {
  return direction === "asc" ? "ascending" : "descending";
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

function getRevenuePerMillionRelays(service: SerializedServiceStats): number {
  return service.relays === 0 ? 0 : (toPoktNumber(service.revenueUpokt) / service.relays) * 1_000_000;
}

function getSupplierDensityLabel(service: SerializedServiceStats): string {
  const suppliers = service.supplierCount ?? 0;
  if (suppliers <= 25) return "low density";
  if (suppliers <= 75) return "balanced";
  return "dense";
}

function ServiceDemandMap({ services, totalRevenue }: { services: SerializedServiceStats[]; totalRevenue: string }) {
  const topServices = [...services]
    .sort(compareRevenueDesc)
    .filter((service) => BigInt(service.revenueUpokt) > 0n || service.relays > 0)
    .slice(0, 10);
  const maxRevenue = Math.max(...topServices.map((service) => toPoktNumber(service.revenueUpokt)), 1);
  const maxRelays = Math.max(...topServices.map((service) => service.relays), 1);

  return (
    <div className="demand-signal-grid">
      {topServices.length === 0 && (
        <div className="demand-signal-card">
          <div className="demand-signal-head">
            <div>
              <strong>No service demand yet</strong>
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
        const relayWidth = Math.max(8, Math.round((service.relays / maxRelays) * 100));

        return (
          <div key={service.serviceId} className="demand-signal-card">
            <div className="demand-signal-head">
              <div>
                <strong>{service.serviceName}</strong>
                <div className="muted mono">{service.serviceId}</div>
              </div>
              <span className={`density density-${density}`}>{getSupplierDensityLabel(service)}</span>
            </div>

            <div className="demand-signal-metrics">
              <div>
                <span>Rewards</span>
                <strong>{formatUpokt(BigInt(service.revenueUpokt), 1)}</strong>
              </div>
              <div>
                <span>Relays</span>
                <strong>{formatCompactNumber(service.relays)}</strong>
              </div>
              <div>
                <span>Yield / 1M</span>
                <strong>{formatDecimal(revenuePerMillionRelays, 2)} POKT</strong>
              </div>
            </div>

            <div className="demand-signal-bars" aria-hidden="true">
              <div>
                <span>reward pool</span>
                <div className="opportunity-track"><div className="opportunity-fill" style={{ width: `${width}%` }} /></div>
              </div>
              <div>
                <span>relay demand</span>
                <div className="opportunity-track"><div className="opportunity-fill demand-fill-green" style={{ width: `${relayWidth}%` }} /></div>
              </div>
            </div>

            <div className="demand-signal-foot">
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

export default function ChainsExplorerView({ data, mode = "chains" }: ChainsExplorerViewProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  function updateSort(nextSort: SortKey, nextDirection?: SortDirection) {
    if (nextDirection) {
      setSort(nextSort);
      setSortDirection(nextDirection);
      return;
    }

    if (nextSort === sort) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    const column = SORT_COLUMNS.find((entry) => entry.key === nextSort);
    setSort(nextSort);
    setSortDirection(column?.defaultDirection ?? "desc");
  }

  const services = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.services ?? [])
      .filter((service) => {
        if (!normalizedQuery) return true;
        return [service.serviceName, service.serviceId].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => compareSortValue(getSortValue(a, sort), getSortValue(b, sort), sortDirection) || a.serviceName.localeCompare(b.serviceName));
  }, [data?.services, query, sort, sortDirection]);
  const topRevenueServices = [...(data?.services ?? [])]
    .sort(compareRevenueDesc)
    .slice(0, 4);

  if (!data) {
    return (
      <main className="page">
        <section className="panel section explorer-empty">
          <span className="eyebrow">{mode === "chains" ? "Chains" : "Service Demand"}</span>
          <h1 className="section-title">{mode === "chains" ? "Chain explorer is warming up." : "Service demand is warming up."}</h1>
          <p className="section-subtitle">The 30d dashboard snapshot is still being prepared. Refresh shortly to inspect services.</p>
        </section>
      </main>
    );
  }

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
          <span className="eyebrow">{mode === "chains" ? "Chains" : "Service Demand"}</span>
          <h1>{mode === "chains" ? "Chain Explorer." : "Chain Intelligence."}</h1>
          <p className="section-subtitle" style={{ fontSize: '1.1rem', maxWidth: '600px' }}>
            {mode === "chains"
              ? "Search, sort, and open service-level chain details from a dedicated explorer."
              : "Top revenue chains first, then service demand signals without exposing provider identities."}
          </p>
        </div>
        
        <div className="explorer-summary-grid">
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Active Services</span>
            <strong style={{ color: 'var(--text)' }}>{formatInteger(data.activeChains)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Aggregate Pool</span>
            <strong style={{ color: 'var(--accent)' }}>{formatCompactUpokt(BigInt(data.totalRevenueUpokt), 1)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <span className="hero-highlight-label">Total Traffic</span>
            <strong style={{ color: 'var(--green)' }}>{formatCompactNumber(data.totalRelays)}</strong>
          </article>
        </div>
      </section>

      {mode === "service-demand" && (
      <section className="panel section">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Top 4 Revenue Chains</h2>
            <p className="section-subtitle">Highest-earning services in the current 30d snapshot.</p>
          </div>
          <span className="pill">Revenue</span>
        </div>

        <div className="explorer-summary-grid">
          {topRevenueServices.map((service, index) => {
            const opportunity = buildAllocatedServiceOpportunity(service, DEFAULT_NEW_PROVIDER_SUPPLIERS, DEFAULT_NEW_PROVIDER_SUPPLIERS);

            return (
              <article key={service.serviceId} className="explorer-summary-card panel-inset" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                <span className="hero-highlight-label">#{index + 1}</span>
                <strong style={{ fontSize: '1rem' }}>{service.serviceName}</strong>
                <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: '4px' }}>{service.serviceId}</div>
                <div style={{ marginTop: '12px' }}>
                  <div><strong style={{ color: 'var(--accent)' }}>{formatUpokt(BigInt(service.revenueUpokt), 1)}</strong></div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{formatInteger(service.relays)} relays · {formatInteger(service.providerCount)} domains</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{formatDecimal(opportunity.opportunityScore, 1)} opportunity score</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      )}

      {mode === "service-demand" && (
      <section className="panel section themed section-theme-demand">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Service Demand Map</h2>
            <p className="section-subtitle">Top service-level reward and relay signals for the current snapshot.</p>
          </div>
          <span className="pill">Demand</span>
        </div>

        <ServiceDemandMap services={data.services} totalRevenue={data.totalRevenueUpokt} />
      </section>
      )}

      {mode === "service-demand" && (
      <section className="panel section themed section-theme-revenue">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Top Services</h2>
            <p className="section-subtitle">Compact leaderboard for the highest earning services.</p>
          </div>
          <span className="pill">Leaderboards</span>
        </div>

        <div className="service-list">
          {[...data.services]
            .sort(compareRevenueDesc)
            .slice(0, 8)
            .map((service) => {
              const revenuePerProviderValue = toPoktNumber(service.revenueUpokt) / Math.max(service.providerCount, 1);
              return (
                <div key={service.serviceId} className="service-row service-row-rich">
                  <div className="service-row-top">
                    <div>
                      <strong style={{ fontSize: '1.05rem' }}>{service.serviceName}</strong>
                      <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: '4px' }}>{service.serviceId}</div>
                    </div>
                    <div className="right">
                      <strong className="accent-number" style={{ fontSize: '1.1rem' }}>{formatUpokt(BigInt(service.revenueUpokt), 1)}</strong>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>{formatInteger(service.relays)} relays</div>
                    </div>
                  </div>
                  <div className="provider-row-metrics">
                    <span>{formatInteger(service.providerCount)} domains</span>
                    <span style={{ color: 'var(--green)' }}>{formatDecimal(revenuePerProviderValue, 1)} POKT / domain</span>
                  </div>
                </div>
              );
            })}
        </div>
      </section>
      )}

      {mode === "chains" && (
      <section className="panel section">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">Chains</h2>
            <p className="section-subtitle">Clickable and filterable list of services in the current 30d snapshot.</p>
          </div>
          <span className="pill">Explorer</span>
        </div>

        <div className="explorer-toolbar">
          <div className="explorer-search">
            <span className="hero-highlight-label">Filter Chains</span>
            <div style={{ position: 'relative' }}>
              <input 
                value={query} 
                onChange={(event) => setQuery(event.target.value)} 
                placeholder="Service name or identity..." 
                style={{ paddingLeft: '40px' }}
              />
              <svg 
                style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', opacity: 0.5 }}
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>
          
          <div className="explorer-select">
            <span className="hero-highlight-label">Sort Objective</span>
            <select value={sort} onChange={(event) => updateSort(event.target.value as SortKey, SORT_COLUMNS.find((entry) => entry.key === event.target.value)?.defaultDirection ?? "desc")}>
              <option value="service">Service Identity</option>
              <option value="opportunity">Demand Signal (experimental)</option>
              <option value="revenue">Total Revenue</option>
              <option value="relays">Relay Volume</option>
              <option value="providers">Domain Density</option>
              <option value="revenuePerProvider">Avg Domain Reward</option>
              <option value="computeUnits">Compute Units</option>
              <option value="suppliers">Supplier Count</option>
            </select>
          </div>
        </div>

        <div className="explorer-table-wrap">
          <table className="mini-table explorer-table">
            <thead>
              <tr>
                {SORT_COLUMNS.map((column) => {
                  const active = column.key === sort;
                  const ariaSort = active ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

                  return (
                    <th key={column.key} className={column.align} aria-sort={ariaSort}>
                      <button
                        type="button"
                        className={`table-sort-button${active ? " active" : ""}`}
                        onClick={() => updateSort(column.key)}
                        aria-label={`Sort by ${column.label} ${active ? `currently ${getSortDirectionLabel(sortDirection)}` : ""}`}
                      >
                        <span>{column.label}</span>
                        {column.tooltip && (
                          <span className="info-tooltip" onClick={(event) => event.stopPropagation()}>
                            <span
                              className="info-tooltip-trigger"
                              tabIndex={0}
                              aria-label={column.tooltip}
                            >
                              ?
                            </span>
                            <span className="info-tooltip-content" role="tooltip">{column.tooltip}</span>
                          </span>
                        )}
                        <span className="sort-indicator" aria-hidden="true">{active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const opportunity = buildAllocatedServiceOpportunity(service, DEFAULT_NEW_PROVIDER_SUPPLIERS, DEFAULT_NEW_PROVIDER_SUPPLIERS);

                return (
                <tr key={service.serviceId}>
                  <td>
                    <Link href={`/chains/${encodeURIComponent(service.serviceId)}`} className="explorer-primary-link">
                      {service.serviceName}
                    </Link>
                    <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: '4px' }}>{service.serviceId}</div>
                  </td>
                  <td className="right">
                    <strong className="accent-number" style={{ fontSize: '1.05rem' }}>{formatUpokt(BigInt(service.revenueUpokt), 1)}</strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>{formatUsd(toPoktNumber(service.revenueUpokt) * data.poktPriceUsd, 0)}</div>
                  </td>
                  <td className="right">{formatInteger(service.relays)}</td>
                  <td className="right">{formatInteger(service.providerCount)}</td>
                  <td className="right">{formatInteger(service.supplierCount ?? 0)}</td>
                  <td className="right" style={{ color: 'var(--green)', fontWeight: 600 }}>{formatDecimal(revenuePerProvider(service), 1)} POKT</td>
                  <td className="right">
                    <span className={`pill ${opportunity.opportunityScore >= 7 ? 'density-low' : opportunity.opportunityScore >= 4 ? 'density-medium' : 'density-high'}`} style={{ fontSize: '0.7rem' }}>
                      {formatDecimal(opportunity.opportunityScore, 1)} score
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </main>
  );
}

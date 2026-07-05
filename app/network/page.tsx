import Link from "next/link";

import { formatInteger, formatPercent } from "@/lib/format";
import { getIndexedHeightCoverage, getIndexerState } from "@/lib/db";

export const metadata = {
  title: "Network Status | Pocket Network Analytics",
  description: "Indexer coverage, freshness, and data-source status for the public Pocket Network analytics dashboard."
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getNumberState(key: string): number | null {
  const value = getIndexerState(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStringState(key: string): string | null {
  return getIndexerState(key);
}

function getPriceState(): { value: number | null; updatedAt: string | null } {
  const raw = getIndexerState("pokt_price_usd");
  if (!raw) return { value: null, updatedAt: null };

  try {
    const parsed = JSON.parse(raw) as { value?: number; updatedAt?: string };
    return {
      value: typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null
    };
  } catch {
    return { value: null, updatedAt: null };
  }
}

function formatIso(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "n/a";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" });
}

export default function NetworkStatusPage() {
  const latestSeenHeight = getNumberState("latest_seen_height");
  const lastProcessedHeight = getNumberState("last_processed_height");
  const wsConnected = getStringState("ws_connected") === "true";
  const activeRpc = getStringState("active_rpc");
  const priceState = getPriceState();
  const averageBlockSeconds = Number(process.env.POCKET_INDEXER_AVG_BLOCK_SECONDS ?? 60);
  const retentionDays = Number(process.env.POCKET_INDEXER_RETENTION_DAYS ?? 45);
  const estimatedRetentionBlocks = Math.max(1, Math.round((retentionDays * 24 * 60 * 60) / Math.max(averageBlockSeconds, 1)));
  const rangeEnd = latestSeenHeight ?? lastProcessedHeight ?? 0;
  const rangeStart = Math.max(1, rangeEnd - estimatedRetentionBlocks + 1);
  const coverage = rangeEnd > 0 ? getIndexedHeightCoverage(rangeStart, rangeEnd) : [];
  const indexedCount = coverage.filter((row) => row.status === "indexed").length;
  const emptyCount = coverage.filter((row) => row.status === "empty").length;
  const failedCount = coverage.filter((row) => row.status === "failed").length;
  const coveredCount = indexedCount + emptyCount;
  const expectedCount = rangeEnd > 0 ? rangeEnd - rangeStart + 1 : 0;
  const missingCount = Math.max(0, expectedCount - coverage.length);
  const coveragePercent = expectedCount === 0 ? 0 : (coveredCount / expectedCount) * 100;
  const lagBlocks = latestSeenHeight != null && lastProcessedHeight != null
    ? Math.max(0, latestSeenHeight - lastProcessedHeight)
    : null;
  const newestScan = coverage.reduce<string | null>((latest, row) => {
    if (!latest) return row.scanned_at;
    return new Date(row.scanned_at).getTime() > new Date(latest).getTime() ? row.scanned_at : latest;
  }, null);

  return (
    <main className="page explorer-page">
      <section className="panel section explorer-hero network-hero">
        <div>
          <span className="eyebrow">Network Status</span>
          <h1>Indexer Coverage.</h1>
          <p className="section-subtitle" style={{ fontSize: "1.1rem", maxWidth: "640px" }}>
            Operational visibility for the public analytics dataset. This page reports freshness and indexed-height coverage without exposing provider identities or operator-level detail.
          </p>
          <div className="window-tabs" style={{ marginTop: "24px" }}>
            <Link href="/" className="calculator-action" style={{ background: "var(--panel-strong)", border: "1px solid var(--border)", color: "var(--text)", boxShadow: "none" }}>
              Back to analytics
            </Link>
          </div>
        </div>

        <div className="explorer-summary-grid">
          <article className="explorer-summary-card panel-inset">
            <span className="hero-highlight-label">Coverage</span>
            <strong style={{ color: "var(--green)" }}>{formatPercent(coveragePercent, 1)}</strong>
          </article>
          <article className="explorer-summary-card panel-inset">
            <span className="hero-highlight-label">Lag</span>
            <strong style={{ color: lagBlocks != null && lagBlocks > 10 ? "var(--orange)" : "var(--accent)" }}>{lagBlocks == null ? "n/a" : `${formatInteger(lagBlocks)} blocks`}</strong>
          </article>
          <article className="explorer-summary-card panel-inset">
            <span className="hero-highlight-label">Retention</span>
            <strong>{formatInteger(retentionDays)} days</strong>
          </article>
        </div>
      </section>

      <section className="kpi-grid kpi-grid-strong rewards-kpi-grid">
        <article className="panel kpi kpi-primary">
          <span className="kpi-label">Latest Seen Height</span>
          <span className="kpi-value">{latestSeenHeight == null ? "n/a" : formatInteger(latestSeenHeight)}</span>
          <span className="kpi-foot">Highest chain height observed by the indexer</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Processed Height</span>
          <span className="kpi-value">{lastProcessedHeight == null ? "n/a" : formatInteger(lastProcessedHeight)}</span>
          <span className="kpi-foot">Highest saved checkpoint</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Covered Heights</span>
          <span className="kpi-value" style={{ color: "var(--green)" }}>{formatInteger(coveredCount)}</span>
          <span className="kpi-foot">Indexed or confirmed empty</span>
        </article>
        <article className="panel kpi">
          <span className="kpi-label">Failed Heights</span>
          <span className="kpi-value" style={{ color: failedCount > 0 ? "var(--orange)" : "var(--text)" }}>{formatInteger(failedCount)}</span>
          <span className="kpi-foot">Retryable by the autonomous repair loop</span>
        </article>
      </section>

      <section className="section-grid rewards-grid">
        <article className="panel section">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Coverage Breakdown</h2>
              <p className="section-subtitle">Height-level state for the current retention window.</p>
            </div>
            <span className="pill">Public Dataset</span>
          </div>
          <div className="network-coverage-grid">
            <div className="network-coverage-card density-low"><span>Indexed with events</span><strong>{formatInteger(indexedCount)}</strong></div>
            <div className="network-coverage-card"><span>Confirmed empty</span><strong>{formatInteger(emptyCount)}</strong></div>
            <div className="network-coverage-card density-medium"><span>Missing</span><strong>{formatInteger(missingCount)}</strong></div>
            <div className="network-coverage-card density-high"><span>Failed</span><strong>{formatInteger(failedCount)}</strong></div>
          </div>
        </article>

        <article className="panel section">
          <div className="section-title-row">
            <div>
              <h2 className="section-title">Runtime Notes</h2>
              <p className="section-subtitle">What the public dashboard reads from.</p>
            </div>
            <span className="pill">Indexer</span>
          </div>
          <div className="insight-list">
            <div className="insight-row"><span className="muted">Request path</span><strong>SQLite snapshots only</strong></div>
            <div className="insight-row"><span className="muted">Live source</span><strong>CometBFT WebSocket + HTTP RPC</strong></div>
            <div className="insight-row"><span className="muted">Repair mode</span><strong>Autonomous retention-window repair</strong></div>
            <div className="insight-row"><span className="muted">Last coverage scan</span><strong>{formatIso(newestScan)}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel section">
        <div className="section-title-row">
          <div>
            <h2 className="section-title">System Status</h2>
            <p className="section-subtitle">Live runtime state for the public indexer and snapshot pipeline.</p>
          </div>
          <span className="pill">Health</span>
        </div>

        <div className="insight-list">
          <div className="insight-row"><span className="muted">Data source</span><strong>{wsConnected ? "CometBFT WebSocket" : "HTTP/RPC fallback"}</strong></div>
          <div className="insight-row"><span className="muted">Active RPC</span><strong className="mono">{activeRpc ?? "n/a"}</strong></div>
          <div className="insight-row"><span className="muted">POKT price</span><strong>{priceState.value == null ? "n/a" : `$${priceState.value.toFixed(4)}`}</strong></div>
          <div className="insight-row"><span className="muted">Price updated</span><strong>{formatIso(priceState.updatedAt)}</strong></div>
          <div className="insight-row"><span className="muted">Indexer height</span><strong>{lastProcessedHeight == null ? "n/a" : formatInteger(lastProcessedHeight)}</strong></div>
          <div className="insight-row"><span className="muted">Chain height</span><strong>{latestSeenHeight == null ? "n/a" : formatInteger(latestSeenHeight)}</strong></div>
        </div>
      </section>
    </main>
  );
}

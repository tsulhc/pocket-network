import crypto from "node:crypto";

import WebSocket from "ws";

import {
  finishJobRun,
  getDashboardCache,
  getIndexedDailyAggregates,
  getIndexedProviderAggregates,
  getIndexedServiceAggregates,
  getIndexedServiceDailyAggregates,
  getIndexedHeightCoverage,
  getIndexerState,
  getLatestIndexedFact,
  markIndexedHeightFailed,
  pruneIndexerData,
  pruneIndexedHeightCoverage,
  saveIndexedBlock,
  saveIndexedServices,
  setDashboardCache,
  setIndexerState,
  setMeta,
  startJobRun,
  type IndexedSettlementFact,
  type IndexedService
} from "@/lib/db";
import type { TimeWindow } from "@/lib/types";

type RpcEvent = {
  type: string;
  attributes: Array<{ key: string; value: string; index?: boolean }>;
};

type RpcStatusResponse = {
  result?: {
    sync_info?: {
      latest_block_height?: string;
    };
  };
};

type RpcBlockResultsResponse = {
  result?: {
    finalize_block_events?: RpcEvent[];
    final_block_events?: RpcEvent[];
    txs_results?: Array<{ events?: RpcEvent[] }>;
  };
};

type RpcBlockResponse = {
  result?: {
    block?: {
      header?: {
        time?: string;
      };
    };
  };
};

type RestServicesResponse = {
  service?: Array<{
    id: string;
    name: string;
    compute_units_per_relay?: string | number | null;
    computeUnitsPerRelay?: string | number | null;
  }>;
  pagination?: { next_key?: string | null };
};

type RewardDistributionDetail = {
  op_reason: string;
  amount: string;
};

type SerializedDashboardCache = {
  window: TimeWindow;
  generatedAt: string;
  dataSource: "rpc";
  poktPriceUsd: number;
  latestHeight: number;
  indexerProcessedHeight?: number;
  indexerTargetHeight?: number;
  scannedHeights: number;
  scannedSettlementHeights: number;
  settlementEvents: number;
  earliestSettlementTime: string | null;
  latestSettlementTime: string | null;
  totalRelays: number;
  totalRevenueUpokt: string;
  activeProviders: number;
  activeChains: number;
  providers: Array<{
    providerKey: string;
    providerLabel: string;
    providerDomain: string;
    relays: number;
    revenueUpokt: string;
    chainCount: number;
    supplierCount: number;
    suppliers: [];
    chains: [];
  }>;
  services: Array<{
    serviceId: string;
    serviceName: string;
    relays: number;
    computeUnits?: number;
    computeUnitsPerRelay?: number;
    supplierCount?: number;
    revenueUpokt: string;
    providerCount: number;
  }>;
};

type IndexerOptions = {
  live?: boolean;
  once?: boolean;
  fromHeight?: number;
  toHeight?: number;
  maxBlocks?: number;
  backfillDays?: number;
};

const DEFAULT_RPC_URLS = [
  "https://sauron-rpc.infra.pocket.network",
  "https://pocket-rpc.polkachu.com:443",
  "https://rpc.pocket.chaintools.tech:443",
  "https://pocket.api.pocket.network:443"
];
const RPC_URLS = Array.from(
  new Set(
    (process.env.POCKET_RPC_URLS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .concat(process.env.POCKET_RPC_URL ? [process.env.POCKET_RPC_URL] : [])
      .concat(DEFAULT_RPC_URLS)
  )
);
const BACKFILL_RPC_URLS = Array.from(
  new Set(
    (process.env.POCKET_BACKFILL_RPC_URLS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .concat(RPC_URLS)
  )
);
const REST_URL = process.env.POCKET_REST_URL ?? "https://sauron-api.infra.pocket.network";
const HASH_SALT = process.env.POCKET_INDEXER_HASH_SALT ?? "pocket-dashboard-public-main";
const RETENTION_DAYS = Number(process.env.POCKET_INDEXER_RETENTION_DAYS ?? 45);
const CACHE_INTERVAL_MS = Number(process.env.POCKET_INDEXER_CACHE_INTERVAL_MS ?? 30_000);
const RPC_TIMEOUT_MS = Number(process.env.POCKET_INDEXER_RPC_TIMEOUT_MS ?? 8_000);
const RPC_RETRIES = Number(process.env.POCKET_INDEXER_RPC_RETRIES ?? 3);
const RPC_RETRY_DELAY_MS = Number(process.env.POCKET_INDEXER_RPC_RETRY_DELAY_MS ?? 500);
const WS_IDLE_TIMEOUT_MS = Number(process.env.POCKET_INDEXER_WS_IDLE_TIMEOUT_MS ?? 45_000);
const BACKFILL_CONCURRENCY = Number(process.env.POCKET_INDEXER_BACKFILL_CONCURRENCY ?? 8);
const BACKFILL_BATCH_SIZE = Number(process.env.POCKET_INDEXER_BACKFILL_BATCH_SIZE ?? 500);
const LIVE_CATCHUP_MAX_BLOCKS = Number(process.env.POCKET_INDEXER_LIVE_CATCHUP_MAX_BLOCKS ?? 1_000);
const BLOCK_RETRIES = Number(process.env.POCKET_INDEXER_BLOCK_RETRIES ?? 5);
const PRICE_TIMEOUT_MS = Number(process.env.POCKET_INDEXER_PRICE_TIMEOUT_MS ?? 20_000);
const PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=pocket-network&vs_currencies=usd";
const REPAIR_INTERVAL_MS = Number(process.env.POCKET_INDEXER_REPAIR_INTERVAL_MS ?? 60_000);
const REPAIR_BATCH_SIZE = Number(process.env.POCKET_INDEXER_REPAIR_BATCH_SIZE ?? 250);
const REPAIR_CONCURRENCY = Number(process.env.POCKET_INDEXER_REPAIR_CONCURRENCY ?? 4);
const REPAIR_FAILED_COOLDOWN_MS = Number(process.env.POCKET_INDEXER_REPAIR_FAILED_COOLDOWN_MS ?? 300_000);
const REPAIR_MAX_FAILED_RETRIES = Number(process.env.POCKET_INDEXER_REPAIR_MAX_FAILED_RETRIES ?? 10);
const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];
const SETTLEMENT_EVENT_TYPE = "pocket.tokenomics.EventClaimSettled";
const SUPPLIER_REWARD_REASONS = new Set([
  "TLM_RELAY_BURN_EQUALS_MINT_SUPPLIER_SHAREHOLDER_REWARD_DISTRIBUTION",
  "TLM_GLOBAL_MINT_SUPPLIER_SHAREHOLDER_REWARD_DISTRIBUTION"
]);

let lastCacheBuildAt = 0;
let cacheDirty = true;
let liveCatchupInFlight = false;
const rpcStats = new Map<string, { successes: number; failures: number; timeouts: number; totalLatencyMs: number }>();

function logInfo(message: string, context?: Record<string, unknown>): void {
  console.info(`[pocket-dashboard:indexer] ${message}`, context ?? "");
}

function logWarn(message: string, context?: Record<string, unknown>): void {
  console.warn(`[pocket-dashboard:indexer] ${message}`, context ?? "");
}

function logError(message: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(`[pocket-dashboard:indexer] ${message}`, {
    ...context,
    error: error instanceof Error ? error.stack ?? error.message : String(error)
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function recordRpcResult(rpcUrl: string, ok: boolean, latencyMs: number, error?: unknown): void {
  const stats = rpcStats.get(rpcUrl) ?? { successes: 0, failures: 0, timeouts: 0, totalLatencyMs: 0 };
  if (ok) {
    stats.successes += 1;
    stats.totalLatencyMs += latencyMs;
  } else {
    stats.failures += 1;
    if (isTimeoutError(error)) stats.timeouts += 1;
  }
  rpcStats.set(rpcUrl, stats);
}

function rpcHealthSnapshot(): Array<{ rpcUrl: string; successes: number; failures: number; timeouts: number; avgLatencyMs: number }> {
  return Array.from(rpcStats.entries()).map(([rpcUrl, stats]) => ({
    rpcUrl,
    successes: stats.successes,
    failures: stats.failures,
    timeouts: stats.timeouts,
    avgLatencyMs: stats.successes === 0 ? 0 : Math.round(stats.totalLatencyMs / stats.successes)
  }));
}

function rpcPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function wsUrlFromRpc(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/websocket";
  url.search = "";
  return url.toString();
}

async function fetchJson<T>(url: string, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "pocket-dashboard/1.0"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchFromRpcPool<T>(path: string, seed = 0, rpcUrls = RPC_URLS): Promise<T> {
  const candidates = [...rpcUrls.slice(seed % rpcUrls.length), ...rpcUrls.slice(0, seed % rpcUrls.length)];
  let lastError: unknown;

  for (let attempt = 1; attempt <= RPC_RETRIES; attempt += 1) {
    for (const rpcUrl of candidates) {
      const startedAt = Date.now();
      try {
        const result = await fetchJson<T>(rpcPath(rpcUrl, path));
        recordRpcResult(rpcUrl, true, Date.now() - startedAt);
        return result;
      } catch (error) {
        lastError = error;
        recordRpcResult(rpcUrl, false, Date.now() - startedAt, error);
        logWarn("RPC request failed", {
          rpcUrl,
          path,
          attempt,
          maxAttempts: RPC_RETRIES,
          error: formatError(error)
        });
      }
    }

    if (attempt < RPC_RETRIES) {
      await sleep(RPC_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`All RPC requests failed for ${path}`);
}

async function getLatestHeight(): Promise<number> {
  const status = await fetchFromRpcPool<RpcStatusResponse>("/status");
  const height = Number(status.result?.sync_info?.latest_block_height ?? 0);
  if (!height) throw new Error("Unable to read latest block height");
  return height;
}

function normalizeAttributeValue(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

function parseInteger(value: string | undefined): number {
  return Number(normalizeAttributeValue(value));
}

function parseUpokt(value: string): bigint {
  const normalized = normalizeAttributeValue(value);
  const match = normalized.match(/^(-?\d+)upokt$/);
  if (!match) throw new Error(`Unexpected coin value: ${value}`);
  return BigInt(match[1]);
}

function hashIdentity(value: string): string {
  return crypto.createHash("sha256").update(`${HASH_SALT}:${value}`).digest("hex").slice(0, 32);
}

function getTimeParts(blockTime: number): { day: string; hour: string } {
  const iso = new Date(blockTime).toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(0, 13) };
}

function extractEvents(response: RpcBlockResultsResponse): RpcEvent[] {
  return [
    ...(response.result?.finalize_block_events ?? []),
    ...(response.result?.final_block_events ?? []),
    ...(response.result?.txs_results ?? []).flatMap((result) => result.events ?? [])
  ];
}

function parseSettlementFact(event: RpcEvent, height: number, eventIndex: number, blockTime: number): IndexedSettlementFact | null {
  if (event.type !== SETTLEMENT_EVENT_TYPE) return null;

  const attributes = Object.fromEntries(event.attributes.map((attribute) => [attribute.key, attribute.value]));
  const serviceId = normalizeAttributeValue(attributes.service_id);
  const supplierOperatorAddress = normalizeAttributeValue(attributes.supplier_operator_address);
  const supplierOwnerAddress = normalizeAttributeValue(attributes.supplier_owner_address);
  const rewardDistribution = normalizeAttributeValue(attributes.reward_distribution_detailed);
  if (!serviceId || !supplierOperatorAddress || !rewardDistribution) return null;

  const rewardDetails = JSON.parse(rewardDistribution) as RewardDistributionDetail[];
  const supplierRevenueUpokt = rewardDetails.reduce((sum, detail) => {
    if (!SUPPLIER_REWARD_REASONS.has(detail.op_reason)) return sum;
    return sum + parseUpokt(detail.amount);
  }, 0n);
  const { day, hour } = getTimeParts(blockTime);

  return {
    height,
    eventIndex,
    blockTime,
    day,
    hour,
    serviceId,
    supplierHash: hashIdentity(supplierOperatorAddress),
    ownerHash: supplierOwnerAddress ? hashIdentity(supplierOwnerAddress) : null,
    relays: parseInteger(attributes.num_relays),
    revenueUpokt: supplierRevenueUpokt.toString()
  };
}

async function fetchBlockFacts(height: number, rpcUrls = RPC_URLS): Promise<IndexedSettlementFact[]> {
  const response = await fetchFromRpcPool<RpcBlockResultsResponse>(`/block_results?height=${height}`, height, rpcUrls);
  const settlementEvents = extractEvents(response).filter((event) => event.type === SETTLEMENT_EVENT_TYPE);
  if (settlementEvents.length === 0) {
    return [];
  }

  const block = await fetchFromRpcPool<RpcBlockResponse>(`/block?height=${height}`, height, rpcUrls);
  const blockTime = Date.parse(block.result?.block?.header?.time ?? "");
  if (!Number.isFinite(blockTime)) {
    throw new Error(`Unable to read block time for height ${height}`);
  }
  const facts: IndexedSettlementFact[] = [];
  let eventIndex = 0;

  for (const event of settlementEvents) {
    const fact = parseSettlementFact(event, height, eventIndex, blockTime);
    eventIndex += 1;
    if (fact) facts.push(fact);
  }

  return facts;
}

function parseMaybeNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function syncServices(): Promise<void> {
  const services: IndexedService[] = [];
  let nextKey = "";

  try {
    while (true) {
      const search = new URLSearchParams({ dehydrated: "true", "pagination.limit": "250" });
      if (nextKey) search.set("pagination.key", nextKey);
      const response = await fetchJson<RestServicesResponse>(`${REST_URL.replace(/\/$/, "")}/pokt-network/poktroll/service/service?${search.toString()}`);
      for (const service of response.service ?? []) {
        services.push({
          serviceId: service.id,
          serviceName: service.name || service.id,
          computeUnitsPerRelay: parseMaybeNumber(service.computeUnitsPerRelay ?? service.compute_units_per_relay)
        });
      }
      nextKey = response.pagination?.next_key ?? "";
      if (!nextKey) break;
    }

    saveIndexedServices(services);
    logInfo("Service dimension synced", { serviceCount: services.length });
  } catch (error) {
    logWarn("Service dimension sync failed; existing labels will be reused", { error: error instanceof Error ? error.message : String(error) });
  }
}

function windowMs(window: TimeWindow): number {
  switch (window) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function getCachedPrice(): number {
  const cached = getIndexerState("pokt_price_usd");
  if (!cached) return 0;
  try {
    const parsed = JSON.parse(cached) as { value: number; updatedAt: string };
    return Number.isFinite(parsed.value) ? parsed.value : 0;
  } catch {
    return 0;
  }
}

async function refreshPrice(): Promise<number> {
  const cached = getIndexerState("pokt_price_usd");
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { value: number; updatedAt: string };
      if (Date.now() - new Date(parsed.updatedAt).getTime() < 60 * 60 * 1000) return parsed.value;
    } catch {
      // Fall through to refresh.
    }
  }

  try {
    const data = await fetchJson<{ "pocket-network"?: { usd?: number } }>(PRICE_URL, PRICE_TIMEOUT_MS);
    const value = data["pocket-network"]?.usd;
    if (typeof value === "number" && Number.isFinite(value)) {
      setIndexerState("pokt_price_usd", JSON.stringify({ value, updatedAt: new Date().toISOString() }));
      return value;
    }
  } catch (error) {
    logWarn("Price refresh failed; using cached value", { error: error instanceof Error ? error.message : String(error) });
  }

  return getCachedPrice();
}

function serializeDailyCache(rows: Array<{ day: string; relays: number; revenue_upokt: string }>): Array<{ day: string; relays: number; revenueUpokt: string }> {
  return rows.map((row) => ({ day: row.day, relays: row.relays, revenueUpokt: row.revenue_upokt }));
}

function setProviderDataCache<T>(key: string, data: T): void {
  setMeta(key, JSON.stringify({ updatedAt: new Date().toISOString(), data }));
}

function cacheChanged(key: string, payloadJson: string): boolean {
  const existing = getDashboardCache(key);
  if (!existing) return true;
  return crypto.createHash("sha256").update(existing.payloadJson).digest("hex") !== crypto.createHash("sha256").update(payloadJson).digest("hex");
}

export async function rebuildIndexerCaches(): Promise<void> {
  const startedAt = Date.now();
  const jobId = startJobRun("indexer_cache_rebuild");

  try {
    const latestHeight = Number(getIndexerState("last_processed_height") ?? 0);
    const latestSeenHeight = Number(getIndexerState("latest_seen_height") ?? latestHeight);
    const latestFact = getLatestIndexedFact();
    const poktPriceUsd = await refreshPrice();

    for (const window of WINDOWS) {
      const since = Date.now() - windowMs(window);
      const serviceRows = getIndexedServiceAggregates(since);
      const providerRows = getIndexedProviderAggregates(since);
      const totalRelays = serviceRows.reduce((sum, row) => sum + row.relays, 0);
      const totalRevenueUpokt = serviceRows.reduce((sum, row) => sum + BigInt(row.revenue_upokt), 0n);
      const earliestSettlementTime = serviceRows.length > 0 ? new Date(since).toISOString() : null;
      const latestSettlementTime = latestFact ? new Date(latestFact.block_time).toISOString() : null;
      const services = serviceRows.map((row) => ({
        serviceId: row.service_id,
        serviceName: row.service_name ?? row.service_id,
        relays: row.relays,
        computeUnits: row.compute_units_per_relay ? row.compute_units_per_relay * row.relays : undefined,
        computeUnitsPerRelay: row.compute_units_per_relay ?? undefined,
        supplierCount: row.supplier_count,
        revenueUpokt: row.revenue_upokt,
        providerCount: row.provider_count
      }));
      const providers = providerRows.map((row, index) => ({
        providerKey: `provider-group-${index + 1}`,
        providerLabel: `Provider group ${index + 1}`,
        providerDomain: "anonymous",
        relays: row.relays,
        revenueUpokt: row.revenue_upokt,
        chainCount: row.service_count,
        supplierCount: 1,
        suppliers: [] as [],
        chains: [] as []
      }));
      const payload: SerializedDashboardCache = {
        window,
        generatedAt: new Date().toISOString(),
        dataSource: "rpc",
        poktPriceUsd,
        latestHeight,
        indexerProcessedHeight: latestHeight,
        indexerTargetHeight: latestSeenHeight,
        scannedHeights: latestHeight,
        scannedSettlementHeights: latestHeight,
        settlementEvents: providerRows.length,
        earliestSettlementTime,
        latestSettlementTime,
        totalRelays,
        totalRevenueUpokt: totalRevenueUpokt.toString(),
        activeProviders: providerRows.length,
        activeChains: services.length,
        providers,
        services
      };
      const payloadJson = JSON.stringify(payload);
      if (cacheChanged(window, payloadJson)) {
        setDashboardCache(window, payloadJson);
      }
    }

    const dailyRows = getIndexedDailyAggregates(Date.now() - 30 * 24 * 60 * 60 * 1000);
    setProviderDataCache("network_daily_history:30", serializeDailyCache(dailyRows));
    for (const service of getIndexedServiceAggregates(Date.now() - 30 * 24 * 60 * 60 * 1000).slice(0, 100)) {
      const rows = getIndexedServiceDailyAggregates(Date.now() - 30 * 24 * 60 * 60 * 1000, service.service_id);
      setProviderDataCache(`service_daily_history:${service.service_id}:30`, serializeDailyCache(rows));
    }

    setProviderDataCache("indexer_status", {
      lastProcessedHeight: latestHeight,
      latestSeenHeight,
      lagBlocks: Math.max(0, latestSeenHeight - latestHeight),
      lastBlockTime: latestFact ? new Date(latestFact.block_time).toISOString() : null,
      wsConnected: getIndexerState("ws_connected") === "true",
      activeRpc: getIndexerState("active_rpc")
    });
    lastCacheBuildAt = Date.now();
    cacheDirty = false;
    finishJobRun(jobId, "success", startedAt, { durationMs: Date.now() - startedAt });
  } catch (error) {
    finishJobRun(jobId, "failed", startedAt, { durationMs: Date.now() - startedAt }, error instanceof Error ? error.stack ?? error.message : String(error));
    throw error;
  }
}

async function maybeRebuildCaches(force = false): Promise<void> {
  if (!force && (!cacheDirty || Date.now() - lastCacheBuildAt < CACHE_INTERVAL_MS)) return;
  await rebuildIndexerCaches();
}

async function fetchBlockFactsWithRetries(height: number, rpcUrls = RPC_URLS): Promise<IndexedSettlementFact[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= BLOCK_RETRIES; attempt += 1) {
    try {
      return await fetchBlockFacts(height, rpcUrls);
    } catch (error) {
      lastError = error;
      logWarn("Block fetch failed", {
        height,
        attempt,
        maxAttempts: BLOCK_RETRIES,
        error: formatError(error)
      });
      if (attempt < BLOCK_RETRIES) {
        await sleep(RPC_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch block facts for height ${height}`);
}

async function processHeight(height: number, rpcUrls = RPC_URLS): Promise<boolean> {
  try {
    const facts = await fetchBlockFactsWithRetries(height, rpcUrls);
    saveIndexedBlock(height, facts);
    if (facts.length > 0) cacheDirty = true;
    return true;
  } catch (error) {
    markIndexedHeightFailed(height, formatError(error));
    logError("Height processing failed", error, { height });
    return false;
  }
}

async function fetchHeightResult(height: number, rpcUrls = BACKFILL_RPC_URLS): Promise<{ height: number; facts?: IndexedSettlementFact[]; error?: string }> {
  try {
    return { height, facts: await fetchBlockFactsWithRetries(height, rpcUrls) };
  } catch (error) {
    return { height, error: formatError(error) };
  }
}

function getRepairCandidateHeights(fromHeight: number, toHeight: number, limit: number): { missing: number[]; failed: number[] } {
  const coverage = getIndexedHeightCoverage(fromHeight, toHeight);
  const byHeight = new Map(coverage.map((row) => [row.height, row]));
  const missing: number[] = [];
  const failed: number[] = [];
  const now = Date.now();

  for (let height = toHeight; height >= fromHeight && missing.length + failed.length < limit; height -= 1) {
    const row = byHeight.get(height);
    if (!row) {
      missing.push(height);
      continue;
    }
    if (row.status === "failed") {
      const lastTriedAt = new Date(row.scanned_at).getTime();
      const cooldownElapsed = !Number.isFinite(lastTriedAt) || now - lastTriedAt >= REPAIR_FAILED_COOLDOWN_MS;
      if (row.failure_count < REPAIR_MAX_FAILED_RETRIES && cooldownElapsed) {
        failed.push(height);
      }
    }
  }

  return { missing, failed };
}

async function processRepairHeights(heights: number[], concurrency: number, source: string): Promise<{ repaired: number; failed: number; events: number }> {
  if (heights.length === 0) return { repaired: 0, failed: 0, events: 0 };
  const results = await mapConcurrent(heights, concurrency, (height) => fetchHeightResult(height, BACKFILL_RPC_URLS));
  let repaired = 0;
  let failed = 0;
  let events = 0;

  for (const result of results.sort((a, b) => b.height - a.height)) {
    if (result.facts) {
      saveIndexedBlock(result.height, result.facts);
      repaired += 1;
      events += result.facts.length;
      if (result.facts.length > 0) cacheDirty = true;
    } else {
      markIndexedHeightFailed(result.height, result.error ?? "Unknown block fetch error");
      failed += 1;
    }
  }

  logInfo("Repair batch completed", {
    source,
    heights: heights.length,
    repaired,
    failed,
    events,
    rpcHealth: rpcHealthSnapshot()
  });

  return { repaired, failed, events };
}

async function runRepairLoop(): Promise<void> {
  while (true) {
    const startedAt = Date.now();
    try {
      const latestHeight = await getLatestHeight();
      const retentionStartHeight = estimateBackfillStart(latestHeight, RETENTION_DAYS);
      const { missing, failed } = getRepairCandidateHeights(retentionStartHeight, latestHeight, REPAIR_BATCH_SIZE);
      const candidateHeights = [...missing, ...failed].sort((a, b) => b - a).slice(0, REPAIR_BATCH_SIZE);

      if (candidateHeights.length > 0) {
        const result = await processRepairHeights(candidateHeights, REPAIR_CONCURRENCY, "repair-loop");
        await maybeRebuildCaches();
        pruneIndexerData(RETENTION_DAYS);
        pruneIndexedHeightCoverage(retentionStartHeight);
        logInfo("Repair loop summary", {
          latestHeight,
          retentionStartHeight,
          missingHeights: missing.length,
          retryableFailedHeights: failed.length,
          repairedHeights: result.repaired,
          stillFailedHeights: result.failed,
          durationMs: Date.now() - startedAt
        });
      } else {
        logInfo("Repair loop found no gaps", {
          latestHeight,
          retentionStartHeight,
          durationMs: Date.now() - startedAt
        });
      }
    } catch (error) {
      logError("Repair loop failed", error);
    }

    await sleep(REPAIR_INTERVAL_MS);
  }
}

async function processRange(fromHeight: number, toHeight: number, maxBlocks?: number): Promise<void> {
  const targetHeight = maxBlocks ? Math.min(toHeight, fromHeight + maxBlocks - 1) : toHeight;
  for (let height = fromHeight; height <= targetHeight; height += 1) {
    await processHeight(height);
    if (height % 25 === 0 || height === targetHeight) {
      setIndexerState("latest_seen_height", String(toHeight));
      await maybeRebuildCaches();
      logInfo("Indexed block range progress", { height, targetHeight });
    }
  }
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours === 0 ? `${remainingMinutes}m ${remainingSeconds}s` : `${hours}h ${remainingMinutes}m`;
}

async function processBackfillRange(fromHeight: number, toHeight: number, maxBlocks?: number): Promise<void> {
  const targetHeight = toHeight;
  const minimumHeight = maxBlocks ? Math.max(fromHeight, toHeight - maxBlocks + 1) : fromHeight;
  const totalBlocks = Math.max(0, targetHeight - minimumHeight + 1);
  const startedAt = Date.now();
  let processedBlocks = 0;
  let indexedEvents = 0;

  logInfo("Starting concurrent backfill range", {
    fromHeight,
    minimumHeight,
    targetHeight,
    totalBlocks,
    concurrency: BACKFILL_CONCURRENCY,
    batchSize: BACKFILL_BATCH_SIZE,
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    rpcRetries: RPC_RETRIES,
    rpcRetryDelayMs: RPC_RETRY_DELAY_MS,
    blockRetries: BLOCK_RETRIES
  });

  for (let batchEnd = targetHeight; batchEnd >= minimumHeight; batchEnd -= BACKFILL_BATCH_SIZE) {
    const batchStart = Math.max(minimumHeight, batchEnd - BACKFILL_BATCH_SIZE + 1);
    const heights = Array.from({ length: batchEnd - batchStart + 1 }, (_, index) => batchEnd - index);
    const batchResults = await mapConcurrent(heights, BACKFILL_CONCURRENCY, (height) => fetchHeightResult(height, BACKFILL_RPC_URLS));
    let failedBlocks = 0;

    for (const result of batchResults.sort((a, b) => b.height - a.height)) {
      if (result.facts) {
        saveIndexedBlock(result.height, result.facts);
        indexedEvents += result.facts.length;
        if (result.facts.length > 0) cacheDirty = true;
      } else {
        markIndexedHeightFailed(result.height, result.error ?? "Unknown block fetch error");
        failedBlocks += 1;
      }
    }

    processedBlocks += heights.length;
    setIndexerState("latest_seen_height", String(toHeight));
    const elapsedMs = Date.now() - startedAt;
    const blocksPerMinute = elapsedMs === 0 ? 0 : Math.round((processedBlocks / elapsedMs) * 60_000);
    const remainingBlocks = Math.max(0, totalBlocks - processedBlocks);
    const etaMs = blocksPerMinute === 0 ? 0 : (remainingBlocks / blocksPerMinute) * 60_000;

    logInfo("Concurrent backfill progress", {
      height: batchStart,
      targetHeight,
      minimumHeight,
      processedBlocks,
      totalBlocks,
      indexedEvents,
      failedBlocks,
      blocksPerMinute,
      eta: formatDuration(etaMs),
      rpcHealth: rpcHealthSnapshot()
    });
  }
}

function estimateBackfillStart(latestHeight: number, days: number): number {
  const averageBlockSeconds = Number(process.env.POCKET_INDEXER_AVG_BLOCK_SECONDS ?? 60);
  return Math.max(1, latestHeight - Math.ceil((days * 24 * 60 * 60) / averageBlockSeconds));
}

async function runCatchup(options: IndexerOptions): Promise<void> {
  const latestHeight = options.toHeight ?? await getLatestHeight();
  const checkpoint = Number(getIndexerState("last_processed_height") ?? 0);
  const configuredStart = Number(process.env.POCKET_INDEXER_START_HEIGHT ?? 0);
  const isImplicitLiveCatchup = Boolean(options.live && !options.backfillDays && !options.fromHeight && !options.toHeight);
  let fromHeight = options.fromHeight
    ?? (options.backfillDays ? estimateBackfillStart(latestHeight, options.backfillDays) : undefined)
    ?? (configuredStart > 0 ? configuredStart : undefined)
    ?? (checkpoint > 0 ? checkpoint + 1 : latestHeight);

  if (isImplicitLiveCatchup && latestHeight - fromHeight + 1 > LIVE_CATCHUP_MAX_BLOCKS) {
    logWarn("Skipping stale live checkpoint catchup", {
      checkpoint,
      requestedFromHeight: fromHeight,
      latestHeight,
      lagBlocks: latestHeight - checkpoint,
      liveCatchupMaxBlocks: LIVE_CATCHUP_MAX_BLOCKS
    });
    fromHeight = latestHeight;
  }

  setIndexerState("latest_seen_height", String(latestHeight));
  if (fromHeight <= latestHeight) {
    if (options.live && !options.backfillDays && !options.fromHeight && !options.toHeight) {
      await processRange(fromHeight, latestHeight, options.maxBlocks);
    } else {
      await processBackfillRange(fromHeight, latestHeight, options.maxBlocks);
    }
  }
  await maybeRebuildCaches(true);
}

async function runLiveCatchup(maxBlocks = LIVE_CATCHUP_MAX_BLOCKS): Promise<void> {
  if (liveCatchupInFlight) {
    logInfo("Skipping live catchup because one is already running");
    return;
  }

  liveCatchupInFlight = true;
  try {
    const latestHeight = await getLatestHeight();
    const checkpoint = Number(getIndexerState("last_processed_height") ?? 0);
    let fromHeight = checkpoint > 0 ? checkpoint + 1 : latestHeight;

    setIndexerState("latest_seen_height", String(latestHeight));
    if (latestHeight - fromHeight + 1 > LIVE_CATCHUP_MAX_BLOCKS) {
      logWarn("Skipping stale live catchup", {
        checkpoint,
        requestedFromHeight: fromHeight,
        latestHeight,
        lagBlocks: latestHeight - checkpoint,
        liveCatchupMaxBlocks: LIVE_CATCHUP_MAX_BLOCKS
      });
      fromHeight = latestHeight;
    }

    if (fromHeight <= latestHeight) {
      await processRange(fromHeight, latestHeight, maxBlocks);
    }
    await maybeRebuildCaches();
  } finally {
    liveCatchupInFlight = false;
  }
}

async function runLiveStartupTasks(): Promise<void> {
  try {
    await syncServices();
  } catch (error) {
    logError("Service sync failed during live startup", error);
  }

  try {
    await runLiveCatchup(500);
    pruneIndexerData(RETENTION_DAYS);
  } catch (error) {
    logError("Initial live catchup failed", error);
  }
}

function subscribeToNewBlocks(ws: WebSocket): void {
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    method: "subscribe",
    id: "pocket-dashboard-new-blocks",
    params: { query: "tm.event='NewBlock'" }
  }));
}

function extractHeightFromWsMessage(data: unknown): number | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { result?: { data?: { value?: { block?: { header?: { height?: string } } } } } };
    const height = Number(parsed.result?.data?.value?.block?.header?.height ?? 0);
    return height > 0 ? height : null;
  } catch {
    return null;
  }
}

async function runLive(): Promise<void> {
  let rpcIndex = 0;

  while (true) {
    const rpcUrl = RPC_URLS[rpcIndex % RPC_URLS.length];
    const websocketUrl = wsUrlFromRpc(rpcUrl);
    setIndexerState("active_rpc", rpcUrl);
    setIndexerState("ws_connected", "false");
    logInfo("Connecting indexer websocket", { websocketUrl });

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(websocketUrl);
        let lastMessageAt = Date.now();
        const idleTimer = globalThis.setInterval(() => {
          if (Date.now() - lastMessageAt > WS_IDLE_TIMEOUT_MS) {
            ws.close();
            reject(new Error("WebSocket idle timeout"));
          }
        }, 5_000);

        ws.addEventListener("open", () => {
          setIndexerState("ws_connected", "true");
          subscribeToNewBlocks(ws);
        });
        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();
          const height = extractHeightFromWsMessage(event.data);
          if (!height) return;

          void (async () => {
            const checkpoint = Number(getIndexerState("last_processed_height") ?? 0);
            setIndexerState("latest_seen_height", String(height));
            if (height > checkpoint) {
              const fromHeight = checkpoint > 0 ? checkpoint + 1 : height;
              const gapBlocks = height - fromHeight;
              if (gapBlocks > 0) {
                logWarn("Processing live tip before websocket checkpoint gap", {
                  checkpoint,
                  requestedFromHeight: fromHeight,
                  latestHeight: height,
                  gapBlocks,
                  liveCatchupMaxBlocks: LIVE_CATCHUP_MAX_BLOCKS
                });
                void runLiveCatchup(500).catch((error) => logError("Websocket gap catchup failed", error));
              }
              await processRange(height, height);
            }
          })().catch((error) => logError("Live block processing failed", error, { height }));
        });
        ws.addEventListener("close", () => {
          globalThis.clearInterval(idleTimer);
          setIndexerState("ws_connected", "false");
          resolve();
        });
        ws.addEventListener("error", (event) => {
          globalThis.clearInterval(idleTimer);
          setIndexerState("ws_connected", "false");
          reject(new Error(`WebSocket error: ${event.type}`));
        });
      });
    } catch (error) {
      logWarn("WebSocket connection failed", { rpcUrl, error: error instanceof Error ? error.message : String(error) });
    }

    rpcIndex += 1;
    await sleep(Math.min(30_000, 1_000 * rpcIndex));
    void runLiveCatchup(500).catch((error) => logError("Reconnect live catchup failed", error));
  }
}

export async function runIndexer(options: IndexerOptions = {}): Promise<void> {
  const startedAt = Date.now();
  const jobId = startJobRun("indexer_start", options as Record<string, unknown>);
  const liveFirst = Boolean(options.live && !options.once && !options.backfillDays && !options.fromHeight && !options.toHeight);

  try {
    logInfo("Starting Pocket indexer", options as Record<string, unknown>);
    if (liveFirst) {
      void runLiveStartupTasks().catch((error) => logError("Live startup background tasks failed", error));
      finishJobRun(jobId, "success", startedAt, { durationMs: Date.now() - startedAt, liveFirst: true });
      await Promise.all([runLive(), runRepairLoop()]);
      return;
    }

    await syncServices();
    await runCatchup(options);
    pruneIndexerData(RETENTION_DAYS);
    finishJobRun(jobId, "success", startedAt, { durationMs: Date.now() - startedAt });

    if (options.once || !options.live) {
      return;
    }

    await Promise.all([runLive(), runRepairLoop()]);
  } catch (error) {
    finishJobRun(jobId, "failed", startedAt, { durationMs: Date.now() - startedAt }, error instanceof Error ? error.stack ?? error.message : String(error));
    throw error;
  }
}

import type { DashboardData, NetworkDailyHistoryPoint, ProviderStats, ServiceDailyHistoryPoint, ServiceStats, TimeWindow } from "@/lib/types";
import { SESSION_SUPPLIER_SLOTS } from "@/lib/opportunities";

const UPOKT = 1_000_000n;

const SERVICE_FIXTURES = [
  { id: "eth", name: "Ethereum", relays: 18_420_000, rewardPokt: 42_500, suppliers: 118, domains: 32, computeUnitsPerRelay: 150 },
  { id: "base", name: "Base", relays: 14_850_000, rewardPokt: 31_200, suppliers: 84, domains: 26, computeUnitsPerRelay: 120 },
  { id: "solana", name: "Solana", relays: 11_240_000, rewardPokt: 27_900, suppliers: 67, domains: 21, computeUnitsPerRelay: 180 },
  { id: "polygon", name: "Polygon", relays: 9_780_000, rewardPokt: 18_600, suppliers: 53, domains: 18, computeUnitsPerRelay: 100 },
  { id: "arbitrum-one", name: "Arbitrum One", relays: 7_430_000, rewardPokt: 15_250, suppliers: 41, domains: 15, computeUnitsPerRelay: 125 },
  { id: "optimism", name: "Optimism", relays: 5_920_000, rewardPokt: 10_700, suppliers: 35, domains: 13, computeUnitsPerRelay: 115 },
  { id: "avax", name: "Avalanche", relays: 4_760_000, rewardPokt: 8_900, suppliers: 29, domains: 11, computeUnitsPerRelay: 130 },
  { id: "near", name: "NEAR", relays: 3_180_000, rewardPokt: 5_650, suppliers: 19, domains: 8, computeUnitsPerRelay: 95 },
  { id: "gnosis", name: "Gnosis", relays: 2_040_000, rewardPokt: 3_450, suppliers: 14, domains: 6, computeUnitsPerRelay: 80 },
  { id: "osmosis", name: "Osmosis", relays: 1_460_000, rewardPokt: 2_300, suppliers: 9, domains: 5, computeUnitsPerRelay: 75 }
] as const;

const PROVIDER_REWARD_POKT = [18_400, 13_700, 10_250, 8_100, 6_900, 4_850, 3_600, 2_450, 1_700, 980, 720, 430, 220, 95, 42, 18, 8];

function windowMultiplier(window: TimeWindow): number {
  switch (window) {
    case "24h":
      return 0.07;
    case "7d":
      return 0.25;
    case "30d":
      return 1;
    case "365d":
      return 12;
  }
}

function toUpokt(pokt: number): bigint {
  return BigInt(Math.round(pokt * 1_000_000));
}

function isoDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function buildServices(multiplier: number): ServiceStats[] {
  return SERVICE_FIXTURES.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    relays: Math.round(service.relays * multiplier),
    computeUnits: Math.round(service.relays * service.computeUnitsPerRelay * multiplier),
    computeUnitsPerRelay: service.computeUnitsPerRelay,
    supplierCount: service.suppliers,
    revenueUpokt: toUpokt(service.rewardPokt * multiplier),
    providerCount: service.domains
  })).sort((a, b) => Number(b.revenueUpokt - a.revenueUpokt));
}

function buildProviders(multiplier: number): ProviderStats[] {
  return PROVIDER_REWARD_POKT.map((rewardPokt, index) => ({
    providerKey: `provider-group-${index + 1}`,
    providerLabel: `Provider group ${index + 1}`,
    providerDomain: "anonymous",
    relays: Math.round((9_500_000 / (index + 1)) * multiplier),
    revenueUpokt: toUpokt(rewardPokt * multiplier),
    chainCount: 0,
    supplierCount: 0,
    suppliers: [],
    chains: []
  }));
}

export function isDevelopmentDummyDataEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.POCKET_DISABLE_DEV_DUMMY_DATA !== "true";
}

export function getDevelopmentDashboardData(window: TimeWindow): DashboardData {
  const multiplier = windowMultiplier(window);
  const services = buildServices(multiplier);
  const providers = buildProviders(multiplier);
  const totalRelays = services.reduce((sum, service) => sum + service.relays, 0);
  const totalRevenueUpokt = services.reduce((sum, service) => sum + service.revenueUpokt, 0n);
  const now = new Date();

  return {
    window,
    generatedAt: now.toISOString(),
    dataSource: "rpc",
    poktPriceUsd: 0.042,
    latestHeight: 812_345,
    indexerProcessedHeight: 812_338,
    indexerTargetHeight: 812_345,
    scannedHeights: Math.round(64_800 * multiplier),
    scannedSettlementHeights: Math.round(18_240 * multiplier),
    settlementEvents: Math.round(134_500 * multiplier),
    earliestSettlementTime: new Date(now.getTime() - multiplier * 30 * 24 * 60 * 60 * 1000).toISOString(),
    latestSettlementTime: now.toISOString(),
    totalRelays,
    totalEstimatedRelays: totalRelays,
    totalEstimatedComputeUnits: 0,
    relayCoverage: 0,
    computeUnitCoverage: 0,
    totalRevenueUpokt,
    activeProviders: providers.length,
    activeChains: services.length,
    suppliersPerSession: SESSION_SUPPLIER_SLOTS,
    appsStakedByService: Object.fromEntries(services.map((s) => [s.serviceId, s.providerCount])),
    sessionObservedHeight: 812_338,
    sessionFetchedAt: now.toISOString(),
    sessionStale: false,
    providers,
    services
  };
}

export function getDevelopmentNetworkDailyHistory(days = 30): NetworkDailyHistoryPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const dayIndex = days - index - 1;
    const wave = 0.82 + Math.sin(index / 4) * 0.12 + index / days * 0.18;
    return {
      day: isoDaysAgo(dayIndex),
      relays: Math.round(2_050_000 * wave),
      revenueUpokt: toUpokt(4_250 * wave)
    };
  });
}

export function getDevelopmentServiceDailyHistory(serviceId: string, days = 30): ServiceDailyHistoryPoint[] {
  const service = SERVICE_FIXTURES.find((entry) => entry.id === serviceId) ?? SERVICE_FIXTURES[0];
  return Array.from({ length: days }, (_, index) => {
    const dayIndex = days - index - 1;
    const wave = 0.78 + Math.cos((index + service.id.length) / 5) * 0.14 + index / days * 0.2;
    return {
      day: isoDaysAgo(dayIndex),
      relays: Math.round((service.relays / 30) * wave),
      revenueUpokt: toUpokt((service.rewardPokt / 30) * wave)
    };
  });
}

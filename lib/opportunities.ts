type OpportunityService = {
  serviceId: string;
  serviceName: string;
  supplierCount?: number;
  providerCount: number;
  relays: number;
  computeUnits?: number;
  revenueUpokt: string | bigint;
};

export const SESSION_SUPPLIER_SLOTS = 50;
export const DEFAULT_NEW_PROVIDER_SUPPLIERS = 15;

export type ProviderServiceOpportunity = {
  serviceId: string;
  serviceName: string;
  supplierCount: number;
  providerCount: number;
  relays: number;
  computeUnits?: number;
  opportunityScore: number;
  expectedSharePercent: number;
  selectionProbability: number;
  projectedRevenueUpokt: bigint;
  projectedRevenuePerSupplierUpokt: bigint;
};

function toBigInt(value: string | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function toPoktNumber(value: bigint): number {
  return Number(value) / 1_000_000;
}

export function getProjectedRevenueUpokt(revenueUpokt: bigint, existingSupplierCount: number, enteringSupplierCount: number): bigint {
  if (revenueUpokt <= 0n || enteringSupplierCount <= 0) return 0n;
  const totalSuppliers = existingSupplierCount + enteringSupplierCount;
  if (totalSuppliers <= 0) return 0n;
  return (revenueUpokt * BigInt(enteringSupplierCount)) / BigInt(totalSuppliers);
}

export function getMarginalRevenueGainUpokt(revenueUpokt: bigint, existingSupplierCount: number, allocatedSupplierCount: number): bigint {
  const current = getProjectedRevenueUpokt(revenueUpokt, existingSupplierCount, allocatedSupplierCount);
  const next = getProjectedRevenueUpokt(revenueUpokt, existingSupplierCount, allocatedSupplierCount + 1);
  return next - current;
}

export function getSelectionProbability(existingSupplierCount: number, enteringSupplierCount: number, sessionSlots = SESSION_SUPPLIER_SLOTS): number {
  if (enteringSupplierCount <= 0) return 0;
  const totalSuppliers = existingSupplierCount + enteringSupplierCount;
  if (totalSuppliers <= 0) return 0;
  if (sessionSlots >= totalSuppliers) return 100;

  let probabilityNoneSelected = 1;
  for (let index = 0; index < sessionSlots; index += 1) {
    probabilityNoneSelected *= (totalSuppliers - enteringSupplierCount - index) / (totalSuppliers - index);
  }

  return Math.max(0, Math.min(100, (1 - probabilityNoneSelected) * 100));
}

export function buildProviderServiceOpportunity(service: OpportunityService, providerSupplierCount: number): ProviderServiceOpportunity {
  const supplierCount = Math.max(service.supplierCount ?? 0, 0);
  const projectedRevenueUpokt = getProjectedRevenueUpokt(toBigInt(service.revenueUpokt), supplierCount, providerSupplierCount);
  const projectedRevenuePerSupplierUpokt = providerSupplierCount > 0
    ? projectedRevenueUpokt / BigInt(providerSupplierCount)
    : 0n;
  const totalSuppliers = supplierCount + Math.max(providerSupplierCount, 0);
  const expectedSharePercent = totalSuppliers === 0 ? 0 : (providerSupplierCount / totalSuppliers) * 100;
  const selectionProbability = getSelectionProbability(supplierCount, providerSupplierCount);
  const projectedRevenuePerSupplierPokt = Number(projectedRevenuePerSupplierUpokt) / 1_000_000;
  const opportunityScore = projectedRevenuePerSupplierPokt * (0.65 + (selectionProbability / 100) * 0.35);

  return {
    serviceId: service.serviceId,
    serviceName: service.serviceName,
    supplierCount,
    providerCount: service.providerCount,
    relays: service.relays,
    computeUnits: service.computeUnits,
    opportunityScore,
    expectedSharePercent,
    selectionProbability,
    projectedRevenueUpokt,
    projectedRevenuePerSupplierUpokt
  };
}

export function allocateSuppliersByMarginalReturn(
  services: OpportunityService[],
  supplierCount: number
): Map<string, number> {
  const allocation = new Map<string, number>();
  if (supplierCount <= 0 || services.length === 0) {
    return allocation;
  }

  for (const service of services) {
    allocation.set(service.serviceId, 0);
  }

  for (let index = 0; index < supplierCount; index += 1) {
    let bestService: OpportunityService | null = null;
    let bestGain = -1n;

    for (const service of services) {
      const allocated = allocation.get(service.serviceId) ?? 0;
      const gain = getMarginalRevenueGainUpokt(toBigInt(service.revenueUpokt), Math.max(service.supplierCount ?? 0, 0), allocated);
      if (!bestService || gain > bestGain) {
        bestService = service;
        bestGain = gain;
      }
    }

    if (!bestService) {
      break;
    }

    allocation.set(bestService.serviceId, (allocation.get(bestService.serviceId) ?? 0) + 1);
  }

  return allocation;
}

export function buildAllocatedServiceOpportunity(
  service: OpportunityService,
  enteringSupplierCount: number,
  allocatedSupplierCount: number
): ProviderServiceOpportunity {
  const opportunity = buildProviderServiceOpportunity(service, enteringSupplierCount);
  const projectedRevenueUpokt = getProjectedRevenueUpokt(
    toBigInt(service.revenueUpokt),
    Math.max(service.supplierCount ?? 0, 0),
    allocatedSupplierCount
  );
  const projectedRevenuePerSupplierUpokt = allocatedSupplierCount > 0
    ? projectedRevenueUpokt / BigInt(allocatedSupplierCount)
    : 0n;
  const projectedRevenuePerSupplierPokt = toPoktNumber(projectedRevenuePerSupplierUpokt);
  const selectionProbability = getSelectionProbability(Math.max(service.supplierCount ?? 0, 0), allocatedSupplierCount);

  return {
    ...opportunity,
    selectionProbability,
    projectedRevenueUpokt,
    projectedRevenuePerSupplierUpokt,
    expectedSharePercent: (Math.max(service.supplierCount ?? 0, 0) + allocatedSupplierCount) === 0
      ? 0
      : (allocatedSupplierCount / (Math.max(service.supplierCount ?? 0, 0) + allocatedSupplierCount)) * 100,
    opportunityScore: projectedRevenuePerSupplierPokt * (0.65 + (selectionProbability / 100) * 0.35)
  };
}

import {
  saveIndexedBlock,
  getFailedHeights,
  type IndexedSettlementFact
} from "@/lib/db";
import {
  fetchSettlementsForHeight,
  isGraphQLHealthy,
} from "@/lib/graphql";

function graphQLSettlementToFact(event: {
  id: string;
  sessionEndHeight: number;
  blockTime: number;
  serviceId: string;
  supplierId: string;
  ownerId: string | null;
  numRelays: number;
  numEstimatedRelays: number;
  numEstimatedComputeUnits: number;
  claimedAmount: string;
  settledAmount: string;
}, eventIndex: number): IndexedSettlementFact {
  const date = new Date(event.blockTime);
  const day = date.toISOString().slice(0, 10);
  const hour = `${day}T${String(date.getUTCHours()).padStart(2, "0")}`;
  const upokt = event.settledAmount || event.claimedAmount || "0";

  return {
    height: event.sessionEndHeight,
    eventIndex,
    blockTime: Math.floor(event.blockTime / 1000),
    day,
    hour,
    serviceId: event.serviceId,
    supplierHash: event.supplierId,
    ownerHash: event.ownerId,
    relays: event.numRelays,
    estimatedRelays: event.numEstimatedRelays > 0 ? event.numEstimatedRelays : undefined,
    estimatedComputeUnits: event.numEstimatedComputeUnits > 0 ? event.numEstimatedComputeUnits : undefined,
    revenueUpokt: upokt,
  };
}

async function repairHeightViaGraphQL(height: number): Promise<number> {
  try {
    const events = await fetchSettlementsForHeight(height);
    if (events.length === 0) {
      saveIndexedBlock(height, [], undefined, "graphql");
      return 0;
    }
    const facts = events.map((event, index) => graphQLSettlementToFact(event, index));
    saveIndexedBlock(height, facts, Math.floor(events[0].blockTime), "graphql");
    return events.length;
  } catch {
    return -1;
  }
}

export async function graphQLRepairFailedHeights(): Promise<{ repaired: number; failed: number; events: number }> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return { repaired: 0, failed: 0, events: 0 };

  const failedHeights = getFailedHeights(100);
  if (failedHeights.length === 0) return { repaired: 0, failed: 0, events: 0 };

  let repaired = 0;
  let failed = 0;
  let events = 0;

  for (const height of failedHeights) {
    const result = await repairHeightViaGraphQL(height);
    if (result >= 0) {
      repaired += 1;
      events += result;
    } else {
      failed += 1;
    }
  }

  return { repaired, failed, events };
}

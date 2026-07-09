import {
  saveIndexedBlock,
  getFailedHeights,
  getEmptyNullTimestampHeights,
  type IndexedSettlementFact
} from "@/lib/db";
import {
  fetchSettlementsByBlockRange,
  isGraphQLHealthy,
  fetchGraphQLMetadata,
} from "@/lib/graphql";
import { hashIdentity } from "@/lib/indexer";

function graphQLSettlementToFact(event: {
  id: string;
  blockHeight: number;
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
    height: event.blockHeight,
    eventIndex,
    blockTime: event.blockTime,
    day,
    hour,
    serviceId: event.serviceId,
    supplierHash: hashIdentity(event.supplierId),
    ownerHash: event.ownerId ? hashIdentity(event.ownerId) : null,
    relays: event.numRelays,
    estimatedRelays: event.numEstimatedRelays > 0 ? event.numEstimatedRelays : undefined,
    estimatedComputeUnits: event.numEstimatedComputeUnits > 0 ? event.numEstimatedComputeUnits : undefined,
    revenueUpokt: "0", // GraphQL rewards must be reconciled before contributing to totals
    ingestionSource: "graphql",
    sourceRecordId: JSON.stringify({ graphqlId: event.id, claimedAmount: event.claimedAmount, settledAmount: event.settledAmount }),
  };
}

async function repairHeightViaGraphQL(height: number): Promise<number> {
  try {
    const meta = await fetchGraphQLMetadata();
    if (!meta || meta.lastFinalizedVerifiedHeight == null || height > meta.lastFinalizedVerifiedHeight) {
      return -1; // GraphQL hasn't finalized this height
    }

    const result = await fetchSettlementsByBlockRange(height, height);
    if (result.settlements.length === 0) {
      if (result.blocksFound.has(height)) {
        const blockTime = result.blockTimeByHeight.get(height);
        saveIndexedBlock(height, [], blockTime, "graphql");
        return 0;
      }
      return -1;
    }
    const facts = result.settlements.map((event, index) => graphQLSettlementToFact(event, index));
    const blockTime = result.settlements[0].blockTime || result.blockTimeByHeight.get(height);
    saveIndexedBlock(height, facts, blockTime, "graphql");
    return result.settlements.length;
  } catch {
    return -1;
  }
}

export async function graphQLRepairFailedHeights(): Promise<{ repaired: number; failed: number; events: number }> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return { repaired: 0, failed: 0, events: 0 };

  const failedHeights = getFailedHeights(50);
  const emptyNullHeights = getEmptyNullTimestampHeights(50);
  const targetHeights = [...new Set([...failedHeights, ...emptyNullHeights])].sort((a, b) => b - a);
  if (targetHeights.length === 0) return { repaired: 0, failed: 0, events: 0 };

  let repaired = 0;
  let failed = 0;
  let events = 0;

  for (const height of targetHeights) {
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

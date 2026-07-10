import {
  saveIndexedBlock,
  savePartialBlock,
  getFailedHeights,
  getEmptyNullTimestampHeights,
  insertGraphQLSettlementFacts,
  updateHeightMetadata,
} from "@/lib/db";
import {
  fetchSettlementsByBlockRange,
  fetchBlockHeadersByRange,
  isGraphQLHealthy,
  fetchGraphQLMetadata,
} from "@/lib/graphql";
import { hashIdentity } from "@/lib/indexer";

function buildGraphQLSettlementRows(
  settlements: Array<{
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
  }>
): Array<{
  sourceRecordId: string;
  height: number;
  blockTime: number;
  day: string;
  serviceId: string;
  supplierHash: string;
  ownerHash: string | null;
  relays: number;
  estimatedRelays?: number;
  estimatedComputeUnits?: number;
  claimedAmount: string;
  settledAmount: string;
}> {
  return settlements.map((ev) => {
    const date = new Date(ev.blockTime);
    const day = date.toISOString().slice(0, 10);
    return {
      sourceRecordId: ev.id,
      height: ev.blockHeight,
      blockTime: ev.blockTime,
      day,
      serviceId: ev.serviceId,
      supplierHash: hashIdentity(ev.supplierId),
      ownerHash: ev.ownerId ? hashIdentity(ev.ownerId) : null,
      relays: ev.numRelays,
      estimatedRelays: ev.numEstimatedRelays > 0 ? ev.numEstimatedRelays : undefined,
      estimatedComputeUnits: ev.numEstimatedComputeUnits > 0 ? ev.numEstimatedComputeUnits : undefined,
      claimedAmount: ev.claimedAmount,
      settledAmount: ev.settledAmount,
    };
  });
}

async function repairHeightViaGraphQL(height: number): Promise<number> {
  try {
    const meta = await fetchGraphQLMetadata();
    if (!meta || meta.lastFinalizedVerifiedHeight == null || height > meta.lastFinalizedVerifiedHeight) {
      return -1;
    }

    const result = await fetchSettlementsByBlockRange(height, height);
    const blockTime = result.blockTimeByHeight.get(height);
    // Save block metadata (header) regardless of settlement presence
    if (blockTime != null && Number.isFinite(blockTime)) {
      updateHeightMetadata(height, blockTime, new Date(blockTime).toISOString().slice(0, 10));
    }

    if (result.settlements.length === 0) {
      if (result.blocksFound.has(height)) {
        // Verified empty: save as empty with known timestamp and completeness flags
        saveIndexedBlock(height, [], blockTime ?? undefined, "graphql");
        return 0;
      }
      return -1; // Block not found in GraphQL
    }

    // Write settlements to separate staging table (not canonical settlement_facts)
    const stagingRows = buildGraphQLSettlementRows(result.settlements);
    insertGraphQLSettlementFacts(stagingRows);

    // Mark as partial — block + workload complete but reward not verified
    savePartialBlock(height, blockTime ?? undefined);
    return result.settlements.length;
  } catch {
    return -1;
  }
}

export async function graphQLRepairFailedHeights(): Promise<{ repaired: number; failed: number; events: number; metadataRepaired: number }> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return { repaired: 0, failed: 0, events: 0, metadataRepaired: 0 };

  const failedHeights = getFailedHeights(50);
  const emptyNullHeights = getEmptyNullTimestampHeights(50);
  const targetHeights = [...new Set([...failedHeights, ...emptyNullHeights])].sort((a, b) => b - a);
  if (targetHeights.length === 0) return { repaired: 0, failed: 0, events: 0, metadataRepaired: 0 };

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

  // Run metadata repair (block headers for empty heights) — target >=1000 per cycle
  const metadataRepaired = await repairEmptyBlockMetadata();

  return { repaired, failed, events, metadataRepaired };
}

export async function repairEmptyBlockMetadata(): Promise<number> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return 0;

  let total = 0;
  // First repair last 31 days (recent window needs freshness)
  const recentStartMs = Date.now() - 31 * 86400000;
  const recentHeights = getEmptyNullTimestampHeights(500).filter(h => h >= recentStartMs);
  if (recentHeights.length > 0) {
    const minH = Math.min(...recentHeights);
    const maxH = Math.max(...recentHeights);
    const headers = await fetchBlockHeadersByRange(minH, maxH);
    for (const [h, bt] of headers) {
      updateHeightMetadata(h, bt, new Date(bt).toISOString().slice(0, 10));
      total += 1;
    }
  }

  // Then process historical stale heights
  while (total < 1000) {
    const batch = getEmptyNullTimestampHeights(500);
    if (batch.length === 0) break;
    const minH = Math.min(...batch);
    const maxH = Math.max(...batch);
    const headers = await fetchBlockHeadersByRange(minH, maxH);
    if (headers.size === 0) break;
    for (const [h, bt] of headers) {
      updateHeightMetadata(h, bt, new Date(bt).toISOString().slice(0, 10));
      total += 1;
    }
  }

  return total;
}

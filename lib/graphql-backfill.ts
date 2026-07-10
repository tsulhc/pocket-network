import {
  saveIndexedBlock,
  savePartialBlock,
  getFailedHeights,
  getEmptyNullTimestampHeights,
  getEmptyNullTimestampHeightsInRange,
  getFirstHeightAtOrAfter,
  getBlockHeaderHeight,
  getIndexerState,
  insertGraphQLSettlementFacts,
  setIndexerState,
  saveBlockHeader,
  updateHeightTimestamp,
  completeVerifiedEmptyHeight,
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
    if (result.blocksFound.has(height) && !Number.isFinite(blockTime)) {
      return -1;
    }
    // Save block metadata (header) regardless of settlement presence
    if (blockTime != null && Number.isFinite(blockTime)) {
      updateHeightTimestamp(height, blockTime, new Date(blockTime).toISOString().slice(0, 10));
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
  const boundariesRepaired = await repairRecentUtcBoundaries();

  return { repaired, failed, events, metadataRepaired: metadataRepaired + boundariesRepaired };
}

export async function repairEmptyBlockMetadata(): Promise<number> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return 0;

  let total = 0;
  const seenHeight = Number(getIndexerState("highest_seen_height") ?? 0);
  if (seenHeight <= 0) return 0;

  async function repairTargets(targets: number[]): Promise<number> {
    if (targets.length === 0) return 0;
    let updated = 0;
    const sorted = [...targets].sort((a, b) => a - b);
    let cursor = 0;
    while (cursor < sorted.length) {
      const fromHeight = sorted[cursor];
      const toHeight = fromHeight + 499;
      const batchTargets: number[] = [];
      while (cursor < sorted.length && sorted[cursor] <= toHeight) {
        batchTargets.push(sorted[cursor]);
        cursor += 1;
      }
      const targetSet = new Set(batchTargets);
      const headers = await fetchBlockHeadersByRange(fromHeight, Math.min(toHeight, batchTargets.at(-1) ?? toHeight));
      for (const [height, blockTime] of headers) {
        if (!targetSet.has(height)) continue;
        completeVerifiedEmptyHeight(height, blockTime, new Date(blockTime).toISOString().slice(0, 10));
        updated += 1;
      }
    }
    return updated;
  }

  // Determine the recent range from known headers, never by comparing a
  // block height to an epoch timestamp.
  const recentStartHeight = getFirstHeightAtOrAfter(Date.now() - 31 * 86400000);
  if (recentStartHeight != null) {
    const recent = getEmptyNullTimestampHeightsInRange(recentStartHeight, seenHeight, 1000, true);
    total += await repairTargets(recent);
  }

  let cursor = Number(getIndexerState("graphql_metadata_repair_cursor") ?? seenHeight);
  while (total < 1000 && cursor > 0) {
    const historical = getEmptyNullTimestampHeightsInRange(1, cursor, Math.min(500, 1000 - total), true);
    if (historical.length === 0) {
      setIndexerState("graphql_metadata_repair_cursor", String(seenHeight));
      break;
    }
    total += await repairTargets(historical);
    cursor = Math.min(...historical) - 1;
    setIndexerState("graphql_metadata_repair_cursor", String(Math.max(0, cursor)));
    if (historical.length < 500) break;
  }

  return total;
}

export async function repairRecentUtcBoundaries(): Promise<number> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) return 0;

  let total = 0;
  const now = Date.now();
  const today = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())).getTime();

  for (let d = 0; d < 31; d++) {
    const dayStartMs = today - d * 86400000;
    const nextDayStartMs = dayStartMs + 86400000;

    const startH = getFirstHeightAtOrAfter(dayStartMs);
    const nextH = getFirstHeightAtOrAfter(nextDayStartMs);
    if (startH == null || nextH == null || nextH <= startH) continue;

    const prev = getBlockHeaderHeight(startH - 1);
    const beforeNext = getBlockHeaderHeight(nextH - 1);
    if (prev && prev.block_time < dayStartMs && beforeNext && beforeNext.block_time < nextDayStartMs) continue;

    const targetHeights: number[] = [];
    if (!prev) targetHeights.push(startH - 1);
    if (!beforeNext) targetHeights.push(nextH - 1);

    if (targetHeights.length === 0) continue;

    const headers = await fetchBlockHeadersByRange(Math.min(...targetHeights), Math.max(...targetHeights));
    for (const [height, blockTime] of headers) {
      if (!targetHeights.includes(height)) continue;
      saveBlockHeader(height, blockTime, "graphql");
      total += 1;
    }
  }

  return total;
}

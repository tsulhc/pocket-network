import {
  getIndexerState,
  setIndexerState,
  saveBlockHeader,
  insertGraphQLSettlementFacts,
  savePartialBlock,
  saveIndexedBlock,
  upsertImportRange,
  getImportRangeStatus,
  markImportRangeFailed,
} from "@/lib/db";
import {
  fetchBlockHeadersByRange,
  fetchSettlementsByBlockRange,
  isGraphQLHealthy,
  fetchGraphQL,
  fetchGraphQLMetadata,
} from "@/lib/graphql";

const CONCURRENCY = Number(process.env.POCKET_GRAPHQL_BOOTSTRAP_CONCURRENCY ?? 2);
const RANGE_SIZE = Number(process.env.POCKET_GRAPHQL_BOOTSTRAP_RANGE_SIZE ?? 500);
const PAGE_SIZE = Math.min(500, Number(process.env.POCKET_GRAPHQL_BOOTSTRAP_PAGE_SIZE ?? 500));
const MAX_RETRIES = Number(process.env.POCKET_GRAPHQL_BOOTSTRAP_MAX_RETRIES ?? 4);
const MAX_MINUTES = Number(process.env.POCKET_GRAPHQL_BOOTSTRAP_MAX_MINUTES ?? 60);

export type BootstrapResult = {
  headersImported: number;
  eventsImported: number;
  rangesCommitted: number;
  rangesFailed: number;
};

type BootstrapPhase = "headers" | "settlements" | "idle";
type BootstrapMode = "recent" | "retention" | "range";

type ImportRange = {
  phase: BootstrapPhase;
  fromHeight: number;
  toHeight: number;
  status: string;
  headerCount: number;
  settlementCount: number;
  pageCount: number;
};

async function sleepWithBackoff(attempt: number): Promise<void> {
  const base = 1_000;
  await new Promise((r) => setTimeout(r, base * Math.pow(2, attempt)));
}

function setBootstrapState(keyValues: Record<string, string | number | boolean>): void {
  for (const [k, v] of Object.entries(keyValues)) {
    setIndexerState(`graphql_bootstrap_${k}`, String(v));
  }
}

// ── Phase A: Block Headers ──────────────────────────────────────────

async function bootstrapBlockHeaders(fromHeight: number, toHeight: number): Promise<BootstrapResult> {
  const meta = await fetchGraphQLMetadata();
  const safeHeight = meta?.lastFinalizedVerifiedHeight ?? toHeight;
  const safeToHeight = Math.min(toHeight, safeHeight);
  const result: BootstrapResult = { headersImported: 0, eventsImported: 0, rangesCommitted: 0, rangesFailed: 0 };

  for (let start = fromHeight; start <= safeToHeight; start += RANGE_SIZE) {
    const end = Math.min(start + RANGE_SIZE - 1, safeToHeight);
    const rangeKey = `headers:${start}:${end}`;
    const existing = getImportRangeStatus("headers", start, end);
    if (existing === "committed") { result.rangesCommitted++; continue; }

    let committed = false;
    for (let attempt = 0; attempt < MAX_RETRIES && !committed; attempt++) {
      if (attempt > 0) await sleepWithBackoff(attempt);

      try {
        const headers = await fetchBlockHeadersByRange(start, end);
        const imported = await commitHeaderRange(start, end, headers, attempt);
        result.headersImported += imported;
        result.rangesCommitted++;
        committed = true;
      } catch (err: any) {
        markImportRangeFailed("headers", start, end, err.message ?? String(err), attempt);
        if (attempt >= MAX_RETRIES - 1) result.rangesFailed++;
      }
    }
  }

  return result;
}

async function commitHeaderRange(fromHeight: number, toHeight: number, headers: Map<number, number>, attempt: number): Promise<number> {
  let imported = 0;
  for (const [height, blockTime] of headers) {
    saveBlockHeader(height, blockTime, "graphql");
    imported++;
  }
  upsertImportRange("headers", fromHeight, toHeight, "committed", imported, 0, 0, attempt);
  return imported;
}

export function getBootstrapProgress(): Record<string, any> {
  const getNum = (key: string) => {
    const v = getIndexerState(`graphql_bootstrap_${key}`);
    return v ? Number(v) || 0 : 0;
  };
  const getStr = (key: string) => getIndexerState(`graphql_bootstrap_${key}`) ?? null;
  return {
    mode: getStr("mode"),
    phase: getStr("phase"),
    safeHeight: getNum("safe_height"),
    lastCommittedHeight: getNum("last_committed_height"),
    headersImported: getNum("headers_imported"),
    eventsImported: getNum("events_imported"),
    rangesCommitted: getNum("ranges_committed"),
    rangesFailed: getNum("ranges_failed"),
    remainingHeights: getNum("remaining_heights"),
    lastSuccessAt: getStr("last_success_at"),
    lastError: getStr("last_error"),
  };
}

export async function runGraphQLBootstrap(mode: BootstrapMode, fromHeight?: number, toHeight?: number): Promise<BootstrapResult> {
  const healthy = await isGraphQLHealthy();
  if (!healthy) throw new Error("GraphQL unhealthy — cannot bootstrap");

  const meta = await fetchGraphQLMetadata();
  const safeHeight = meta?.lastFinalizedVerifiedHeight ?? toHeight ?? 0;

  setBootstrapState({ mode, phase: "headers", safe_height: safeHeight });

  const totalResult: BootstrapResult = { headersImported: 0, eventsImported: 0, rangesCommitted: 0, rangesFailed: 0 };

  const seenHeight = Number(getIndexerState("highest_seen_height") ?? meta?.lastFinalizedVerifiedHeight ?? 0);
  const retentionDays = Number(process.env.POCKET_INDEXER_RETENTION_DAYS ?? 45);
  const avgBlockSec = Math.max(1, Number(process.env.POCKET_INDEXER_AVG_BLOCK_SECONDS ?? 60));
  const retentionStart = Math.max(1, seenHeight - Math.ceil(retentionDays * 86400 / avgBlockSec));

  let rangeFrom: number;
  let rangeTo: number;

  switch (mode) {
    case "recent": {
      const recentStartH = await getFirstHeightForRecent();
      rangeFrom = recentStartH;
      rangeTo = safeHeight;
      break;
    }
    case "retention": {
      rangeFrom = retentionStart;
      rangeTo = safeHeight;
      break;
    }
    case "range": {
      rangeFrom = fromHeight ?? retentionStart;
      rangeTo = toHeight ?? safeHeight;
      break;
    }
  }

  if (rangeFrom >= rangeTo) return totalResult;

  setBootstrapState({ remaining_heights: rangeTo - rangeFrom + 1 });

  // Phase A: Headers
  const headersResult = await bootstrapBlockHeaders(rangeFrom, rangeTo);
  totalResult.headersImported += headersResult.headersImported;
  totalResult.rangesCommitted += headersResult.rangesCommitted;
  totalResult.rangesFailed += headersResult.rangesFailed;

  setBootstrapState({ phase: "settlements", remaining_heights: rangeTo - rangeFrom + 1 });

  // Phase B: Settlements
  for (let start = rangeFrom; start <= rangeTo; start += RANGE_SIZE) {
    const end = Math.min(start + RANGE_SIZE - 1, rangeTo);
    const phaseRangeKey = `settlements:${start}:${end}`;
    const existing = getImportRangeStatus("settlements", start, end);
    if (existing === "committed") { totalResult.rangesCommitted++; continue; }

    let committed = false;
    for (let attempt = 0; attempt < MAX_RETRIES && !committed; attempt++) {
      if (attempt > 0) await sleepWithBackoff(attempt);
      try {
        const evResult = await commitSettlementRange(start, end, attempt);
        totalResult.eventsImported += evResult.eventsImported;
        totalResult.headersImported += evResult.headersImported;
        totalResult.rangesCommitted++;
        committed = true;
        setBootstrapState({ last_committed_height: end, last_success_at: new Date().toISOString() });
      } catch (err: any) {
        markImportRangeFailed("settlements", start, end, err.message ?? String(err), attempt);
        if (attempt >= MAX_RETRIES - 1) totalResult.rangesFailed++;
      }
    }
  }

  setBootstrapState({ phase: "idle", remaining_heights: 0 });
  return totalResult;
}

async function getFirstHeightForRecent(): Promise<number> {
  const meta = await fetchGraphQLMetadata();
  const now = Date.now();
  const recentMs = now - 31 * 86400000;
  try {
    const data = await fetchGraphQL<{ blocks: { nodes: Array<{ height: string }> } }>(
      `query($time: Datetime!) {
        blocks(filter: { time: { greaterThanOrEqualTo: $time } }, orderBy: HEIGHT_ASC, first: 1) {
          nodes { height }
        }
      }`,
      { time: new Date(recentMs).toISOString() }
    );
    if (data.blocks.nodes.length > 0) return Number(data.blocks.nodes[0].height);
  } catch { }
  const seen = Number(getIndexerState("highest_seen_height") ?? meta?.lastFinalizedVerifiedHeight ?? 0);
  return Math.max(1, seen - 1440 * 31);
}

async function commitSettlementRange(fromHeight: number, toHeight: number, attempt: number): Promise<BootstrapResult> {
  try {
    const result = await fetchSettlementsByBlockRange(fromHeight, toHeight);
    const events = result.settlements;
    const headers = result.blockTimeByHeight;

    const db = (await import("@/lib/db")) as typeof import("@/lib/db");
    const dbConn = (require("@/lib/db") as any).getDb();

    const tx = () => {
      // Save all block headers
      for (const [height, blockTime] of headers) {
        saveBlockHeader(height, blockTime, "graphql");
      }

      // Group events by height
      const eventsByHeight = new Map<number, typeof events>();
      for (const ev of events) {
        const list = eventsByHeight.get(ev.blockHeight) ?? [];
        list.push(ev);
        eventsByHeight.set(ev.blockHeight, list);
      }

      // Build staging rows
      const stagingRows = events.map((ev) => ({
        sourceRecordId: ev.id,
        height: ev.blockHeight,
        blockTime: ev.blockTime,
        day: new Date(ev.blockTime).toISOString().slice(0, 10),
        serviceId: ev.serviceId,
        supplierHash: ev.supplierId,
        ownerHash: ev.ownerId,
        relays: ev.numRelays,
        estimatedRelays: ev.numEstimatedRelays > 0 ? ev.numEstimatedRelays : undefined,
        estimatedComputeUnits: ev.numEstimatedComputeUnits > 0 ? ev.numEstimatedComputeUnits : undefined,
        claimedAmount: ev.claimedAmount,
        settledAmount: ev.settledAmount,
      }));
      insertGraphQLSettlementFacts(stagingRows);

      // Mark heights in range
      for (let h = fromHeight; h <= toHeight; h++) {
        const blockTime = headers.get(h);
        if (!blockTime) continue; // header missing from GraphQL
        const blockEvents = eventsByHeight.get(h);
        if (blockEvents && blockEvents.length > 0) {
          savePartialBlock(h, blockTime);
        } else {
          saveIndexedBlock(h, [], blockTime, "graphql");
        }
      }

      upsertImportRange("settlements", fromHeight, toHeight, "committed", headers.size, events.length, result.pageCount, attempt);
    };
    tx();

    return {
      headersImported: headers.size,
      eventsImported: events.length,
      rangesCommitted: 1,
      rangesFailed: 0,
    };
  } catch (err: any) {
    throw err;
  }
}

export type { BootstrapMode };

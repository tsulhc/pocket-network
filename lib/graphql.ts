const GRAPHQL_URL = "https://data.pocket.network/";

import { setIndexerState } from "@/lib/db";

type GraphQLMetadata = {
  targetHeight: number | null;
  lastProcessedHeight: number | null;
  lastProcessedTimestamp: string | null;
  lastFinalizedVerifiedHeight: number | null;
  indexerHealthy: boolean | null;
};

type GraphQLMetadataResponse = {
  _metadata: GraphQLMetadata;
};

export type IndexedGraphQLSettlement = {
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
};

export async function fetchGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GraphQL request failed: HTTP ${response.status}`);
  }
  const body = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`GraphQL error: ${body.errors[0].message}`);
  }
  return body.data as T;
}

export async function fetchGraphQLMetadata(): Promise<GraphQLMetadata | null> {
  try {
    const data = await fetchGraphQL<GraphQLMetadataResponse>(
      `{ _metadata { targetHeight lastProcessedHeight lastProcessedTimestamp lastFinalizedVerifiedHeight indexerHealthy } }`
    );
    return data._metadata;
  } catch {
    return null;
  }
}

export async function isGraphQLHealthy(): Promise<boolean> {
  const meta = await fetchGraphQLMetadata();
  if (!meta) return false;
  if (meta.lastFinalizedVerifiedHeight == null || meta.indexerHealthy !== true) return false;
  return (meta.lastProcessedHeight ?? 0) > 0;
}

type BlockNode = {
  height: string;
  header: { time: string };
  eventClaimSettledsByBlockId: {
    nodes: Array<{
      id: string;
      serviceId: string;
      supplierId: string;
      supplierOwnerId: string | null;
      numRelays: string;
      numEstimatedRelays: string | null;
      numEstimatedComputeUnits: string | null;
      claimedAmount: string | null;
      settledAmount: string | null;
    }>;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
};

type BlocksResponse = {
  blocks: {
    nodes: BlockNode[];
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
};

const BLOCKS_QUERY = `query($from: BigInt!, $to: BigInt!, $cursor: Cursor) {
  blocks(
    filter: { height: { greaterThanOrEqualTo: $from, lessThanOrEqualTo: $to } }
    orderBy: HEIGHT_ASC
    first: 500
    after: $cursor
  ) {
    nodes {
      height
      header
      eventClaimSettledsByBlockId(first: 500) {
        nodes {
          id
          serviceId
          supplierId
          supplierOwnerId
          numRelays
          numEstimatedRelays
          numEstimatedComputeUnits
          claimedAmount
          settledAmount
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export type FetchBlocksResult = {
  settlements: IndexedGraphQLSettlement[];
  blocksFound: Set<number>;
  blockTimeByHeight: Map<number, number>;
  pageCount: number;
};

export async function fetchSettlementsByBlockRange(
  fromHeight: number,
  toHeight: number
): Promise<FetchBlocksResult> {
  const results: IndexedGraphQLSettlement[] = [];
  const blocksFound = new Set<number>();
  const blockTimeByHeight = new Map<number, number>();
  let from = fromHeight;
  let pageCount = 0;

  while (from <= toHeight) {
    const batchTo = Math.min(from + 200, toHeight);

    const data = await fetchGraphQL<BlocksResponse>(BLOCKS_QUERY, {
      from: String(from),
      to: String(batchTo),
      cursor: null,
    });
    pageCount++;
    for (const block of data.blocks.nodes) {
      const nested = block.eventClaimSettledsByBlockId;
      if (nested.pageInfo?.hasNextPage) {
        // Block has more than 500 settlement events — don't process it, the
        // repair will retry via RPC or we'll need cursor pagination here too
        continue;
      }
      const blockTime = Date.parse(block.header?.time ?? "");
      const height = Number(block.height);
      blocksFound.add(height);
      if (Number.isFinite(blockTime) && blockTime > 0) {
        blockTimeByHeight.set(height, blockTime);
      }
      for (const node of block.eventClaimSettledsByBlockId.nodes) {
        results.push({
          id: node.id,
          blockHeight: height,
          blockTime: Number.isFinite(blockTime) ? blockTime : 0,
          serviceId: node.serviceId,
          supplierId: node.supplierId,
          ownerId: node.supplierOwnerId ?? null,
          numRelays: Number(node.numRelays || 0),
          numEstimatedRelays: Number(node.numEstimatedRelays || 0),
          numEstimatedComputeUnits: Number(node.numEstimatedComputeUnits || 0),
          claimedAmount: node.claimedAmount ?? "0",
          settledAmount: node.settledAmount ?? "0",
        });
      }
    }
    from = batchTo + 1;
  }

  return { settlements: results, blocksFound, blockTimeByHeight, pageCount };
}

export async function fetchBlockHeadersByRange(fromHeight: number, toHeight: number): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  let from = fromHeight;

  while (from <= toHeight) {
    const batchTo = Math.min(from + 499, toHeight);
    const query = `query($from: BigInt!, $to: BigInt!) {
      blocks(
        filter: { height: { greaterThanOrEqualTo: $from, lessThanOrEqualTo: $to } }
        orderBy: HEIGHT_ASC
        first: 500
      ) {
        nodes { height header }
      }
    }`;
    const data = await fetchGraphQL<{ blocks: { nodes: Array<{ height: string; header: { time: string } }> } }>(query, {
      from: String(from), to: String(batchTo),
    });
    for (const n of data.blocks.nodes) {
      const h = Number(n.height);
      const bt = Date.parse(n.header?.time ?? "");
      if (Number.isFinite(bt) && bt > 0) result.set(h, bt);
    }
    from = batchTo + 1;
  }

  return result;
}

export async function updateGraphQLWatermark(): Promise<void> {
  try {
    const meta = await fetchGraphQLMetadata();
    if (!meta) return;
    const now = new Date().toISOString();
    setIndexerState("graphql_target_height", String(meta.targetHeight ?? 0));
    setIndexerState("graphql_processed_height", String(meta.lastProcessedHeight ?? 0));
    setIndexerState("graphql_watermark_time", now);
    if (meta.indexerHealthy) {
      setIndexerState("graphql_last_healthy_time", now);
    }
  } catch { /* non-critical */ }
}

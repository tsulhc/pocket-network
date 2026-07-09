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
  sessionEndHeight: number;
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

export type GraphQLWatermark = {
  lastIngestedHeight: number | null;
  lastIngestedTime: string | null;
  lastHealthyTime: string | null;
};

async function fetchGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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
  return meta.indexerHealthy === true && (meta.lastProcessedHeight ?? 0) > 0;
}

export async function fetchSettlementsByHeightRange(
  fromHeight: number,
  toHeight: number,
  limit = 500
): Promise<IndexedGraphQLSettlement[]> {
  const query = `query($from: BigInt!, $to: BigInt!, $first: Int!) {
    eventClaimSettleds(
      filter: { sessionEndHeight: { greaterThanOrEqualTo: $from, lessThanOrEqualTo: $to } }
      orderBy: SESSION_END_HEIGHT_ASC
      first: $first
    ) {
      nodes {
        id
        sessionEndHeight
        serviceId
        supplierId
        supplierOwnerId
        numRelays
        numEstimatedRelays
        numEstimatedComputedUnits
        claimedAmount
        claimedDenom
        settledAmount
        settledDenom
        blockId
        block {
          height
          header
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }`;

  const data = await fetchGraphQL<{
    eventClaimSettleds: {
      nodes: Array<{
        id: string;
        sessionEndHeight: string;
        serviceId: string;
        supplierId: string;
        supplierOwnerId: string | null;
        numRelays: string;
        numEstimatedRelays: string | null;
        numEstimatedComputeUnits: string | null;
        claimedAmount: string | null;
        claimedDenom: string | null;
        settledAmount: string | null;
        settledDenom: string | null;
        blockId: string;
        block: { height: string; header: { time: string } } | null;
      }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };
  }>(query, { from: String(fromHeight), to: String(toHeight), first: limit });

  return data.eventClaimSettleds.nodes.map((node) => {
    const blockTime = node.block?.header?.time
      ? Date.parse(node.block.header.time)
      : 0;
    return {
      id: node.id,
      sessionEndHeight: Number(node.sessionEndHeight || 0),
      blockHeight: Number(node.block?.height || 0),
      blockTime: Number.isFinite(blockTime) ? blockTime : 0,
      serviceId: node.serviceId,
      supplierId: node.supplierId,
      ownerId: node.supplierOwnerId ?? null,
      numRelays: Number(node.numRelays || 0),
      numEstimatedRelays: Number(node.numEstimatedRelays || 0),
      numEstimatedComputeUnits: Number(node.numEstimatedComputeUnits || 0),
      claimedAmount: node.claimedAmount ?? "0",
      settledAmount: node.settledAmount ?? "0",
    };
  });
}

export async function fetchSettlementsForHeight(
  height: number,
  limit = 500
): Promise<IndexedGraphQLSettlement[]> {
  return fetchSettlementsByHeightRange(height, height, limit);
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

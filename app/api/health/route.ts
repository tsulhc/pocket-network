import { getIndexerHealth, isDatabaseReadOnly } from "@/lib/db";
import { getBootstrapProgress } from "@/lib/graphql-bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getIndexerHealth();
  const readOnly = isDatabaseReadOnly();

  const contiguousHeight = health.processedHeight ?? 0;
  const seenHeight = health.targetHeight ?? 0;
  const lag = Math.max(0, seenHeight - contiguousHeight);

  const degraded =
    health.failedHeights > 0 ||
    health.missingHeights > 0 ||
    health.emptyNullTimestamps > 0 ||
    (health.partialWorkloadHeights ?? 0) > 0 ||
    (health.partialRewardHeights ?? 0) > 0;

  return Response.json({
    status: readOnly ? "ready" : "writing",
    dataVersion: health.dataVersion,
    degraded,
    indexer: {
      isLocked: health.isLocked,
      contiguousHeight,
      highestIngestedHeight: health.ingestedHeight,
      seenHeight,
      lag,
      gaps: health.gaps,
      failedHeights: health.failedHeights,
      missingHeights: health.missingHeights,
      emptyNullTimestamps: health.emptyNullTimestamps,
      partialWorkloadHeights: health.partialWorkloadHeights,
      partialRewardHeights: health.partialRewardHeights,
      lastSuccessfulCommit: health.lastSuccessfulCommit,
      lastBackup: health.lastBackup,
    },
    graphqlBootstrap: getBootstrapProgress(),
  });
}

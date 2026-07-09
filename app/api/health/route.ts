import { getIndexerHealth, isDatabaseReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getIndexerHealth();
  const readOnly = isDatabaseReadOnly();

  const contiguousHeight = health.processedHeight ?? 0;
  const seenHeight = health.targetHeight ?? 0;
  const lag = Math.max(0, seenHeight - contiguousHeight);

  return Response.json({
    status: readOnly ? "ready" : "writing",
    dataVersion: health.dataVersion,
    degraded: health.gaps > 0 || health.failedHeights > 0,
    indexer: {
      isLocked: health.isLocked,
      contiguousHeight,
      seenHeight,
      lag,
      gaps: health.gaps,
      failedHeights: health.failedHeights,
      lastSuccessfulCommit: health.lastSuccessfulCommit,
      lastBackup: health.lastBackup,
    },
  });
}

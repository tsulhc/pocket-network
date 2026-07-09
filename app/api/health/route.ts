import { getIndexerHealth, isDatabaseReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getIndexerHealth();
  const readOnly = isDatabaseReadOnly();

  return Response.json({
    status: readOnly ? "ready" : "writing",
    dataVersion: health.dataVersion,
    indexer: {
      isLocked: health.isLocked,
      processedHeight: health.processedHeight,
      targetHeight: health.targetHeight,
      gaps: health.gaps,
      failedHeights: health.failedHeights,
      lastSuccessfulCommit: health.lastSuccessfulCommit,
      lastBackup: health.lastBackup,
    },
  });
}

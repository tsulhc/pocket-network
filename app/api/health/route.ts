import { getIndexerHealth, isDatabaseReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getIndexerHealth();
  const readOnly = isDatabaseReadOnly();

  return Response.json({
    status: readOnly ? "ready" : "writing",
    dataVersion: health.dataVersion,
    schemaVersion: health.schemaVersion,
    indexer: {
      isLocked: health.isLocked,
      processedHeight: health.processedHeight,
      targetHeight: health.targetHeight,
      lastSuccessfulCommit: health.lastSuccessfulCommit,
      lastBackup: health.lastBackup,
    },
  });
}

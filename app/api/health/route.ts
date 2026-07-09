import { getIndexerHealth, isDatabaseReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getIndexerHealth();
  const readOnly = isDatabaseReadOnly();

  return Response.json({
    database: {
      path: process.env.POCKET_SQLITE_PATH ?? "(default)",
      mode: readOnly ? "read-only" : "read-write",
      dataVersion: health.dataVersion,
      schemaVersion: health.schemaVersion,
    },
    indexer: {
      isLocked: health.isLocked,
      processedHeight: health.processedHeight,
      targetHeight: health.targetHeight,
      lastSuccessfulCommit: health.lastSuccessfulCommit,
      lastBackup: health.lastBackup,
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
    },
  });
}

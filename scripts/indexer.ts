import { runIndexer } from "../lib/indexer";

function readNumberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readBackfillDays(): number | undefined {
  const index = process.argv.indexOf("--backfill");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) return Number(process.env.POCKET_INDEXER_RETENTION_DAYS ?? 45);
  const match = value.match(/^(\d+)(d)?$/);
  return match ? Number(match[1]) : undefined;
}

runIndexer({
  live: process.argv.includes("--live") || (!process.argv.includes("--once") && !process.argv.includes("--backfill")),
  once: process.argv.includes("--once"),
  fromHeight: readNumberFlag("--from-height"),
  toHeight: readNumberFlag("--to-height"),
  maxBlocks: readNumberFlag("--max-blocks"),
  backfillDays: readBackfillDays()
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

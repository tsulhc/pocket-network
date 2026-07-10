import { runGraphQLBootstrap, getBootstrapProgress } from "@/lib/graphql-bootstrap";
import { getBootstrapProgress as getProgress } from "@/lib/graphql-bootstrap";

function parseArg(key: string): string | undefined {
  const idx = process.argv.indexOf(`--${key}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  if (process.argv.includes(`--${key}`)) return "true";
  return undefined;
}

async function main() {
  const mode = (parseArg("mode") ?? "retention") as "recent" | "retention" | "range";
  const fromHeight = parseArg("from-height") ? Number(parseArg("from-height")) : undefined;
  const toHeight = parseArg("to-height") ? Number(parseArg("to-height")) : undefined;

  console.log("GraphQL Bootstrap starting", { mode, fromHeight, toHeight, ts: new Date().toISOString() });

  const startedAt = Date.now();
  const result = await runGraphQLBootstrap(mode, fromHeight, toHeight);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);

  console.log("Bootstrap complete", {
    ...result,
    durationSec: elapsed,
    ts: new Date().toISOString(),
  });

  const progress = getBootstrapProgress();
  console.log("Progress:", JSON.stringify(progress, null, 2));

  if (result.rangesFailed > 0) {
    console.error("Some ranges failed — check graphql_import_ranges table");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});

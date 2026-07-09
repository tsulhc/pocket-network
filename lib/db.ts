import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

type CachedSettlementBlockRow = {
  height: number;
  block_time: string;
  events_json: string;
};

export type IndexedSettlementFact = {
  height: number;
  eventIndex: number;
  blockTime: number;
  day: string;
  hour: string;
  serviceId: string;
  supplierHash: string;
  ownerHash: string | null;
  relays: number;
  estimatedRelays?: number;
  claimedComputeUnits?: number;
  estimatedComputeUnits?: number;
  revenueUpokt: string;
};

export type IndexedService = {
  serviceId: string;
  serviceName: string;
  computeUnitsPerRelay: number | null;
};

export type IndexedSupplierDomain = {
  supplierHash: string;
  domainHash: string;
  hasEndpoint: boolean;
};

export type IndexedHeightStatus = "indexed" | "empty" | "failed";

export type IndexedHeightCoverage = {
  height: number;
  status: IndexedHeightStatus;
  event_count: number;
  failure_count: number;
  last_error: string | null;
  scanned_at: string;
};

export type IndexedServiceAggregate = {
  service_id: string;
  service_name: string | null;
  compute_units_per_relay: number | null;
  relays: number;
  estimated_relays: number;
  estimated_compute_units: number;
  relay_coverage: number;
  revenue_upokt: string;
  supplier_count: number;
  provider_count: number;
};

export type IndexedProviderAggregate = {
  supplier_hash: string;
  relays: number;
  revenue_upokt: string;
  service_count: number;
};

export type IndexedDailyAggregate = {
  day: string;
  relays: number;
  estimated_relays: number;
  estimated_compute_units: number;
  relay_coverage: number;
  revenue_upokt: string;
};

const defaultDbPath = path.join(process.cwd(), "data", "pocket-dashboard.sqlite");
const dbPath = process.env.POCKET_SQLITE_PATH ?? defaultDbPath;
const isReadOnly = process.env.POCKET_DB_READONLY === "true";

export function isDatabaseReadOnly(): boolean {
  return isReadOnly;
}

export function acquireIndexerLock(): boolean {
  if (isReadOnly) return false;
  const lockfile = path.join(path.dirname(dbPath), "indexer.lock");
  try {
    const fd = fs.openSync(lockfile, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Lock exists — check if the owning process is still alive
      try {
        const pidStr = fs.readFileSync(lockfile, "utf-8").trim();
        const pid = Number.parseInt(pidStr, 10);
        if (pid > 0) {
          try {
            process.kill(pid, 0);
            return false; // alive, genuine lock holder
          } catch {
            // Stale lock — process is dead, take over
            fs.unlinkSync(lockfile);
            const fd2 = fs.openSync(lockfile, "wx");
            fs.writeSync(fd2, String(process.pid));
            fs.closeSync(fd2);
            return true;
          }
        }
      } catch {
        // Can't read the lockfile — don't claim ownership
      }
    }
    return false;
  }
}

export function releaseIndexerLock(): void {
  if (isReadOnly) return;
  try {
    const lockfile = path.join(path.dirname(dbPath), "indexer.lock");
    if (fs.existsSync(lockfile)) {
      const pid = Number.parseInt(fs.readFileSync(lockfile, "utf-8").trim(), 10) || 0;
      if (pid === process.pid) {
        fs.unlinkSync(lockfile);
      }
    }
  } catch { /* best-effort cleanup */ }
}

export type IndexerHealth = {
  schemaVersion: string | null;
  dataVersion: string | null;
  processedHeight: number | null;
  targetHeight: number | null;
  lastSuccessfulCommit: string | null;
  lastBackup: string | null;
  isLocked: boolean;
};

export function getIndexerHealth(): IndexerHealth {
  let isLocked = false;
  try {
    const lockfile = path.join(path.dirname(dbPath), "indexer.lock");
    if (fs.existsSync(lockfile)) {
      const pid = Number.parseInt(fs.readFileSync(lockfile, "utf-8").trim(), 10) || 0;
      try { process.kill(pid, 0); isLocked = true; } catch { /* stale */ }
    }
  } catch { /* ignored */ }

  try {
    const dataVersion = getIndexerState("data_version");
    const processedHeight = getIndexerState("last_processed_height");
    const targetHeight = getIndexerState("latest_network_height");
    return {
      schemaVersion: getMeta("schema_version") ?? null,
      dataVersion: dataVersion ?? null,
      processedHeight: processedHeight ? Number.parseInt(processedHeight, 10) || null : null,
      targetHeight: targetHeight ? Number.parseInt(targetHeight, 10) || null : null,
      lastSuccessfulCommit: getIndexerState("last_successful_commit") ?? null,
      lastBackup: getIndexerState("last_backup") ?? null,
      isLocked,
    };
  } catch {
    return {
      schemaVersion: null,
      dataVersion: null,
      processedHeight: null,
      targetHeight: null,
      lastSuccessfulCommit: null,
      lastBackup: null,
      isLocked,
    };
  }
}

let db: Database.Database;

if (isReadOnly) {
  if (!process.env.POCKET_SQLITE_PATH) {
    throw new Error("POCKET_SQLITE_PATH must be set when POCKET_DB_READONLY=true");
  }
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 10000");
} else {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");
  db.exec(`
  CREATE TABLE IF NOT EXISTS settlement_blocks (
    height INTEGER PRIMARY KEY,
    block_time TEXT NOT NULL,
    events_json TEXT NOT NULL,
    scanned_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_cache (
    window TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    error TEXT,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS indexer_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_dim (
    service_id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    compute_units_per_relay REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS supplier_domain_dim (
    supplier_hash TEXT PRIMARY KEY,
    domain_hash TEXT NOT NULL,
    has_endpoint INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlement_facts (
    height INTEGER NOT NULL,
    event_index INTEGER NOT NULL,
    block_time INTEGER NOT NULL,
    day TEXT NOT NULL,
    hour TEXT NOT NULL,
    service_id TEXT NOT NULL,
    supplier_hash TEXT NOT NULL,
    owner_hash TEXT,
    relays INTEGER NOT NULL,
    estimated_relays INTEGER,
    claimed_compute_units INTEGER,
    estimated_compute_units INTEGER,
    revenue_upokt TEXT NOT NULL,
    PRIMARY KEY (height, event_index)
  );

  CREATE TABLE IF NOT EXISTS indexed_heights (
    height INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_rollups (
    day TEXT PRIMARY KEY,
    total_relays INTEGER NOT NULL,
    estimated_relays INTEGER,
    estimated_compute_units INTEGER,
    revenue_upokt TEXT NOT NULL,
    relay_coverage REAL NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS settlement_facts_time_idx ON settlement_facts(block_time);
  CREATE INDEX IF NOT EXISTS settlement_facts_service_time_idx ON settlement_facts(service_id, block_time);
  CREATE INDEX IF NOT EXISTS settlement_facts_day_idx ON settlement_facts(day);
  CREATE INDEX IF NOT EXISTS settlement_facts_supplier_time_idx ON settlement_facts(supplier_hash, block_time);
  CREATE INDEX IF NOT EXISTS supplier_domain_dim_domain_idx ON supplier_domain_dim(domain_hash);
  CREATE INDEX IF NOT EXISTS indexed_heights_status_idx ON indexed_heights(status, height);
`);

  for (const col of ["estimated_relays", "claimed_compute_units", "estimated_compute_units"]) {
    try { db.exec(`ALTER TABLE settlement_facts ADD COLUMN ${col} INTEGER`); } catch { /* column already exists */ }
  }

  const settlementFactsColumns = db.prepare("PRAGMA table_info(settlement_facts)").all() as Array<{ name: string }>;
  const hasLegacyColumn = (col: string) => settlementFactsColumns.some((c) => c.name === col);
  if (!hasLegacyColumn("relays")) {
    try { db.exec("ALTER TABLE settlement_facts ADD COLUMN relays INTEGER"); } catch { /* fallback */ }
  }
}

const selectSettlementBlocksStatement = db.prepare(
  `SELECT height, block_time, events_json FROM settlement_blocks WHERE height IN (${Array.from({ length: 999 }, () => "?").join(",")})`
);

const insertSettlementBlockStatement = db.prepare(
  `
    INSERT INTO settlement_blocks (height, block_time, events_json, scanned_at)
    VALUES (@height, @block_time, @events_json, @scanned_at)
    ON CONFLICT(height) DO UPDATE SET
      block_time = excluded.block_time,
      events_json = excluded.events_json,
      scanned_at = excluded.scanned_at
  `
);

const selectMetaStatement = db.prepare("SELECT value FROM meta WHERE key = ?");

const upsertMetaStatement = db.prepare(
  `
    INSERT INTO meta (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `
);

const selectDashboardCacheStatement = db.prepare(
  "SELECT payload_json, updated_at FROM dashboard_cache WHERE window = ?"
);

const upsertDashboardCacheStatement = db.prepare(
  `
    INSERT INTO dashboard_cache (window, payload_json, updated_at)
    VALUES (@window, @payload_json, @updated_at)
    ON CONFLICT(window) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `
);

const insertJobRunStatement = db.prepare(
  `
    INSERT INTO job_runs (job_name, status, started_at, metadata_json)
    VALUES (@job_name, @status, @started_at, @metadata_json)
  `
);

const updateJobRunStatement = db.prepare(
  `
    UPDATE job_runs
    SET status = @status,
        finished_at = @finished_at,
        duration_ms = @duration_ms,
        error = @error,
        metadata_json = @metadata_json
    WHERE id = @id
  `
);

const upsertIndexerStateStatement = db.prepare(
  `
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `
);

const selectIndexerStateStatement = db.prepare("SELECT value FROM indexer_state WHERE key = ?");

const upsertServiceStatement = db.prepare(
  `
    INSERT INTO service_dim (service_id, service_name, compute_units_per_relay, updated_at)
    VALUES (@service_id, @service_name, @compute_units_per_relay, @updated_at)
    ON CONFLICT(service_id) DO UPDATE SET
      service_name = excluded.service_name,
      compute_units_per_relay = excluded.compute_units_per_relay,
      updated_at = excluded.updated_at
  `
);

const upsertSupplierDomainStatement = db.prepare(
  `
    INSERT INTO supplier_domain_dim (supplier_hash, domain_hash, has_endpoint, updated_at)
    VALUES (@supplier_hash, @domain_hash, @has_endpoint, @updated_at)
    ON CONFLICT(supplier_hash) DO UPDATE SET
      domain_hash = excluded.domain_hash,
      has_endpoint = excluded.has_endpoint,
      updated_at = excluded.updated_at
  `
);

const insertSettlementFactStatement = db.prepare(
  `
    INSERT INTO settlement_facts (
      height,
      event_index,
      block_time,
      day,
      hour,
      service_id,
      supplier_hash,
      owner_hash,
      relays,
      estimated_relays,
      claimed_compute_units,
      estimated_compute_units,
      revenue_upokt
    ) VALUES (
      @height,
      @event_index,
      @block_time,
      @day,
      @hour,
      @service_id,
      @supplier_hash,
      @owner_hash,
      @relays,
      @estimated_relays,
      @claimed_compute_units,
      @estimated_compute_units,
      @revenue_upokt
    )
    ON CONFLICT(height, event_index) DO UPDATE SET
      estimated_relays = COALESCE(excluded.estimated_relays, settlement_facts.estimated_relays),
      claimed_compute_units = COALESCE(excluded.claimed_compute_units, settlement_facts.claimed_compute_units),
      estimated_compute_units = COALESCE(excluded.estimated_compute_units, settlement_facts.estimated_compute_units)
  `
);

const upsertIndexedHeightStatement = db.prepare(
  `
    INSERT INTO indexed_heights (height, status, scanned_at, event_count, failure_count, last_error)
    VALUES (@height, @status, @scanned_at, @event_count, @failure_count, @last_error)
    ON CONFLICT(height) DO UPDATE SET
      status = excluded.status,
      scanned_at = excluded.scanned_at,
      event_count = excluded.event_count,
      failure_count = excluded.failure_count,
      last_error = excluded.last_error
  `
);

const markIndexedHeightFailedStatement = db.prepare(
  `
    INSERT INTO indexed_heights (height, status, scanned_at, event_count, failure_count, last_error)
    VALUES (@height, 'failed', @scanned_at, 0, 1, @last_error)
    ON CONFLICT(height) DO UPDATE SET
      status = 'failed',
      scanned_at = excluded.scanned_at,
      failure_count = indexed_heights.failure_count + 1,
      last_error = excluded.last_error
  `
);

const selectIndexedHeightsStatement = db.prepare(
  `
    SELECT height, status, event_count, failure_count, last_error, scanned_at
    FROM indexed_heights
    WHERE height BETWEEN ? AND ?
    ORDER BY height ASC
  `
);

const deleteOldSettlementFactsStatement = db.prepare("DELETE FROM settlement_facts WHERE block_time < ?");
const deleteOldIndexedHeightsStatement = db.prepare("DELETE FROM indexed_heights WHERE height < ?");
const deleteOldJobRunsStatement = db.prepare(
  "DELETE FROM job_runs WHERE id NOT IN (SELECT id FROM job_runs ORDER BY id DESC LIMIT ?)"
);

const selectServiceAggregatesStatement = db.prepare(
  `
    SELECT
      facts.service_id,
      service_dim.service_name,
      service_dim.compute_units_per_relay,
      SUM(facts.relays) AS relays,
      CAST(COALESCE(SUM(facts.estimated_relays), 0) AS INTEGER) AS estimated_relays,
      CAST(COALESCE(SUM(facts.estimated_compute_units), 0) AS INTEGER) AS estimated_compute_units,
      CAST(COALESCE(SUM(CASE WHEN facts.estimated_relays IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS REAL) AS relay_coverage,
      CAST(SUM(CAST(facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt,
      COUNT(DISTINCT facts.supplier_hash) AS supplier_count,
      COUNT(DISTINCT COALESCE(supplier_domain_dim.domain_hash, facts.owner_hash, facts.supplier_hash)) AS provider_count
    FROM settlement_facts facts
    LEFT JOIN service_dim ON service_dim.service_id = facts.service_id
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = facts.supplier_hash
    WHERE facts.block_time >= ?
    GROUP BY facts.service_id
    HAVING relays > 0 OR CAST(revenue_upokt AS INTEGER) > 0
    ORDER BY CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectProviderAggregatesStatement = db.prepare(
  `
    SELECT
      COALESCE(supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash) AS supplier_hash,
      SUM(settlement_facts.relays) AS relays,
      CAST(SUM(CAST(settlement_facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt,
      COUNT(DISTINCT settlement_facts.service_id) AS service_count
    FROM settlement_facts
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = settlement_facts.supplier_hash
    WHERE settlement_facts.block_time >= ?
    GROUP BY COALESCE(supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash)
    HAVING relays > 0 OR CAST(revenue_upokt AS INTEGER) > 0
    ORDER BY CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectExistingBlockTimeStatement = db.prepare(
  `
    SELECT block_time
    FROM settlement_facts
    WHERE height = ?
    LIMIT 1
  `
);

const selectDailyAggregatesStatement = db.prepare(
  `
    SELECT
      day,
      SUM(relays) AS relays,
      CAST(COALESCE(SUM(estimated_relays), 0) AS INTEGER) AS estimated_relays,
      CAST(COALESCE(SUM(estimated_compute_units), 0) AS INTEGER) AS estimated_compute_units,
      CAST(COALESCE(SUM(CASE WHEN estimated_relays IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS REAL) AS relay_coverage,
      CAST(SUM(CAST(revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt
    FROM settlement_facts
    WHERE block_time >= ?
    GROUP BY day
    ORDER BY day ASC
  `
);

const selectGlobalRelayCoverageStatement = db.prepare(
  `
    SELECT CAST(COALESCE(SUM(CASE WHEN estimated_relays IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS REAL) AS coverage
    FROM settlement_facts
    WHERE block_time >= ?
  `
);

const selectGlobalComputeUnitCoverageStatement = db.prepare(
  `
    SELECT CAST(COALESCE(SUM(CASE WHEN estimated_compute_units IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS REAL) AS coverage
    FROM settlement_facts
    WHERE block_time >= ?
  `
);

const selectServiceDailyAggregatesStatement = db.prepare(
  `
    SELECT
      day,
      SUM(relays) AS relays,
      CAST(COALESCE(SUM(estimated_relays), 0) AS INTEGER) AS estimated_relays,
      CAST(COALESCE(SUM(estimated_compute_units), 0) AS INTEGER) AS estimated_compute_units,
      CAST(COALESCE(SUM(CASE WHEN estimated_relays IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS REAL) AS relay_coverage,
      CAST(SUM(CAST(revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt
    FROM settlement_facts
    WHERE block_time >= ? AND service_id = ?
    GROUP BY day
    ORDER BY day ASC
  `
);

const selectLatestIndexedFactStatement = db.prepare(
  "SELECT height, block_time FROM settlement_facts ORDER BY height DESC LIMIT 1"
);

const upsertDailyRollupStatement = db.prepare(
  `
    INSERT INTO daily_rollups (day, total_relays, estimated_relays, estimated_compute_units, revenue_upokt, relay_coverage, generated_at)
    VALUES (@day, @total_relays, @estimated_relays, @estimated_compute_units, @revenue_upokt, @relay_coverage, @generated_at)
    ON CONFLICT(day) DO UPDATE SET
      total_relays = excluded.total_relays,
      estimated_relays = excluded.estimated_relays,
      estimated_compute_units = excluded.estimated_compute_units,
      revenue_upokt = excluded.revenue_upokt,
      relay_coverage = excluded.relay_coverage,
      generated_at = excluded.generated_at
  `
);

const selectDailyRollupsStatement = db.prepare(
  `
    SELECT day, total_relays AS relays, estimated_relays, estimated_compute_units, revenue_upokt, relay_coverage
    FROM daily_rollups
    WHERE day >= ?
    ORDER BY day ASC
  `
);

const writeIndexedBlockTransaction = db.transaction((height: number, facts: IndexedSettlementFact[]) => {
  for (const fact of facts) {
    insertSettlementFactStatement.run({
      height: fact.height,
      event_index: fact.eventIndex,
      block_time: fact.blockTime,
      day: fact.day,
      hour: fact.hour,
      service_id: fact.serviceId,
      supplier_hash: fact.supplierHash,
      owner_hash: fact.ownerHash,
      relays: fact.relays,
      estimated_relays: fact.estimatedRelays ?? null,
      claimed_compute_units: fact.claimedComputeUnits ?? null,
      estimated_compute_units: fact.estimatedComputeUnits ?? null,
      revenue_upokt: fact.revenueUpokt
    });
  }

  upsertIndexedHeightStatement.run({
    height,
    status: facts.length > 0 ? "indexed" : "empty",
    scanned_at: new Date().toISOString(),
    event_count: facts.length,
    failure_count: 0,
    last_error: null
  });

  const current = Number((selectIndexerStateStatement.get("last_processed_height") as { value: string } | undefined)?.value ?? 0);
  if (height > current) {
    upsertIndexerStateStatement.run({
      key: "last_processed_height",
      value: String(height),
      updated_at: new Date().toISOString()
    });
  }
});

export function getCachedSettlementBlocks(heights: number[]): Map<number, CachedSettlementBlockRow> {
  const result = new Map<number, CachedSettlementBlockRow>();

  for (let start = 0; start < heights.length; start += 999) {
    const batch = heights.slice(start, start + 999);
    if (batch.length === 0) continue;

    const rows = selectSettlementBlocksStatement.all(...batch, ...Array.from({ length: 999 - batch.length }, () => null)) as CachedSettlementBlockRow[];
    for (const row of rows) {
      if (row?.height) {
        result.set(row.height, row);
      }
    }
  }

  return result;
}

export function saveSettlementBlock(height: number, blockTime: string, eventsJson: string): void {
  insertSettlementBlockStatement.run({
    height,
    block_time: blockTime,
    events_json: eventsJson,
    scanned_at: new Date().toISOString()
  });
}

export function getMeta(key: string): string | null {
  const row = selectMetaStatement.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  upsertMetaStatement.run({
    key,
    value,
    updated_at: new Date().toISOString()
  });
}

export function getDashboardCache(window: string): { payloadJson: string; updatedAt: string } | null {
  const row = selectDashboardCacheStatement.get(window) as { payload_json: string; updated_at: string } | undefined;
  if (!row) {
    return null;
  }

  return {
    payloadJson: row.payload_json,
    updatedAt: row.updated_at
  };
}

export function setDashboardCache(window: string, payloadJson: string): void {
  upsertDashboardCacheStatement.run({
    window,
    payload_json: payloadJson,
    updated_at: new Date().toISOString()
  });
}

export function startJobRun(jobName: string, metadata?: Record<string, unknown>): number {
  const result = insertJobRunStatement.run({
    job_name: jobName,
    status: "running",
    started_at: new Date().toISOString(),
    metadata_json: metadata ? JSON.stringify(metadata) : null
  });
  return Number(result.lastInsertRowid);
}

export function finishJobRun(id: number, status: "success" | "failed", startedAt: number, metadata?: Record<string, unknown>, error?: string): void {
  updateJobRunStatement.run({
    id,
    status,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    error: error ?? null,
    metadata_json: metadata ? JSON.stringify(metadata) : null
  });
}

export function getIndexerState(key: string): string | null {
  const row = selectIndexerStateStatement.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setIndexerState(key: string, value: string): void {
  upsertIndexerStateStatement.run({ key, value, updated_at: new Date().toISOString() });
}

export function saveIndexedBlock(height: number, facts: IndexedSettlementFact[]): void {
  writeIndexedBlockTransaction(height, facts);
}

export function markIndexedHeightFailed(height: number, error: string): void {
  markIndexedHeightFailedStatement.run({
    height,
    scanned_at: new Date().toISOString(),
    last_error: error.slice(0, 1000)
  });
}

export function getIndexedHeightCoverage(fromHeight: number, toHeight: number): IndexedHeightCoverage[] {
  return selectIndexedHeightsStatement.all(fromHeight, toHeight) as IndexedHeightCoverage[];
}

export function pruneIndexedHeightCoverage(minHeight: number): void {
  deleteOldIndexedHeightsStatement.run(minHeight);
}

export function saveIndexedServices(services: IndexedService[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction((entries: IndexedService[]) => {
    for (const service of entries) {
      upsertServiceStatement.run({
        service_id: service.serviceId,
        service_name: service.serviceName,
        compute_units_per_relay: service.computeUnitsPerRelay,
        updated_at: now
      });
    }
  });
  transaction(services);
}

export function saveIndexedSupplierDomains(domains: IndexedSupplierDomain[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction((entries: IndexedSupplierDomain[]) => {
    for (const entry of entries) {
      upsertSupplierDomainStatement.run({
        supplier_hash: entry.supplierHash,
        domain_hash: entry.domainHash,
        has_endpoint: entry.hasEndpoint ? 1 : 0,
        updated_at: now
      });
    }
  });
  transaction(domains);
}

export function getIndexedServiceAggregates(sinceUnixMs: number): IndexedServiceAggregate[] {
  return selectServiceAggregatesStatement.all(sinceUnixMs) as IndexedServiceAggregate[];
}

export function getIndexedProviderAggregates(sinceUnixMs: number): IndexedProviderAggregate[] {
  return selectProviderAggregatesStatement.all(sinceUnixMs) as IndexedProviderAggregate[];
}

export function getIndexedDailyAggregates(sinceUnixMs: number): IndexedDailyAggregate[] {
  return selectDailyAggregatesStatement.all(sinceUnixMs) as IndexedDailyAggregate[];
}

export function getGlobalComputeUnitCoverage(sinceUnixMs: number): number {
  const row = selectGlobalComputeUnitCoverageStatement.get(sinceUnixMs) as { coverage: number } | undefined;
  return row?.coverage ?? 0;
}

export function getGlobalRelayCoverage(sinceUnixMs: number): number {
  const row = selectGlobalRelayCoverageStatement.get(sinceUnixMs) as { coverage: number } | undefined;
  return row?.coverage ?? 0;
}

export function getIndexedServiceDailyAggregates(sinceUnixMs: number, serviceId: string): IndexedDailyAggregate[] {
  return selectServiceDailyAggregatesStatement.all(sinceUnixMs, serviceId) as IndexedDailyAggregate[];
}

export function getExistingBlockTime(height: number): number | null {
  const row = selectExistingBlockTimeStatement.get(height) as { block_time: number } | undefined;
  return row && Number.isFinite(row.block_time) ? row.block_time : null;
}

export function getLatestIndexedFact(): { height: number; block_time: number } | null {
  const row = selectLatestIndexedFactStatement.get() as { height: number; block_time: number } | undefined;
  return row ?? null;
}

export function upsertDailyRollup(rollup: IndexedDailyAggregate & { generated_at: string }): void {
  upsertDailyRollupStatement.run({
    day: rollup.day,
    total_relays: rollup.relays,
    estimated_relays: rollup.estimated_relays,
    estimated_compute_units: rollup.estimated_compute_units,
    revenue_upokt: rollup.revenue_upokt,
    relay_coverage: rollup.relay_coverage,
    generated_at: rollup.generated_at
  });
}

export function getDailyRollups(sinceDay: string): IndexedDailyAggregate[] {
  return selectDailyRollupsStatement.all(sinceDay) as IndexedDailyAggregate[];
}

export function pruneIndexerData(retentionDays: number, maxJobRuns = 500): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  deleteOldSettlementFactsStatement.run(cutoff);
  deleteOldJobRunsStatement.run(maxJobRuns);
}

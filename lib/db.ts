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

export type IndexedSupplierIdentity = {
  supplierHash: string;
  operatorAddress: string;
  ownerAddress: string;
  providerKey: string;
  providerLabel: string;
  providerDomain: string;
  stakeUpokt: string | null;
  serviceCount: number | null;
  operatorRevSharePercent: number | null;
  ownerRevSharePercent: number | null;
  otherRevSharePercent: number | null;
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
  revenue_upokt: string;
  supplier_count: number;
  provider_count: number;
};

export type IndexedProviderAggregate = {
  provider_key: string;
  provider_label: string | null;
  provider_domain: string | null;
  relays: number;
  revenue_upokt: string;
  service_count: number;
  supplier_count: number;
};

export type IndexedProviderServiceAggregate = {
  provider_key: string;
  service_id: string;
  service_name: string | null;
  compute_units_per_relay: number | null;
  relays: number;
  revenue_upokt: string;
};

export type IndexedProviderSupplierAggregate = {
  provider_key: string;
  operator_address: string;
  owner_address: string;
  provider_domain: string | null;
  relays: number;
  revenue_upokt: string;
  service_count: number;
  stake_upokt: string | null;
  supplier_service_count: number | null;
  operator_rev_share_percent: number | null;
  owner_rev_share_percent: number | null;
  other_rev_share_percent: number | null;
};

export type IndexedDailyAggregate = {
  day: string;
  relays: number;
  revenue_upokt: string;
};

const defaultDbPath = path.join(process.cwd(), "data", "pocket-dashboard.sqlite");
const dbPath = process.env.POCKET_SQLITE_PATH ?? defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

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

  CREATE TABLE IF NOT EXISTS supplier_identity_dim (
    supplier_hash TEXT PRIMARY KEY,
    operator_address TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    provider_label TEXT NOT NULL,
    provider_domain TEXT NOT NULL,
    stake_upokt TEXT,
    service_count INTEGER,
    operator_rev_share_percent REAL,
    owner_rev_share_percent REAL,
    other_rev_share_percent REAL,
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

  CREATE INDEX IF NOT EXISTS settlement_facts_time_idx ON settlement_facts(block_time);
  CREATE INDEX IF NOT EXISTS settlement_facts_service_time_idx ON settlement_facts(service_id, block_time);
  CREATE INDEX IF NOT EXISTS settlement_facts_day_idx ON settlement_facts(day);
  CREATE INDEX IF NOT EXISTS settlement_facts_supplier_time_idx ON settlement_facts(supplier_hash, block_time);
  CREATE INDEX IF NOT EXISTS supplier_domain_dim_domain_idx ON supplier_domain_dim(domain_hash);
  CREATE INDEX IF NOT EXISTS supplier_identity_provider_idx ON supplier_identity_dim(provider_key);
  CREATE INDEX IF NOT EXISTS indexed_heights_status_idx ON indexed_heights(status, height);
`);

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

const upsertSupplierIdentityStatement = db.prepare(
  `
    INSERT INTO supplier_identity_dim (
      supplier_hash,
      operator_address,
      owner_address,
      provider_key,
      provider_label,
      provider_domain,
      stake_upokt,
      service_count,
      operator_rev_share_percent,
      owner_rev_share_percent,
      other_rev_share_percent,
      updated_at
    ) VALUES (
      @supplier_hash,
      @operator_address,
      @owner_address,
      @provider_key,
      @provider_label,
      @provider_domain,
      @stake_upokt,
      @service_count,
      @operator_rev_share_percent,
      @owner_rev_share_percent,
      @other_rev_share_percent,
      @updated_at
    )
    ON CONFLICT(supplier_hash) DO UPDATE SET
      operator_address = excluded.operator_address,
      owner_address = excluded.owner_address,
      provider_key = excluded.provider_key,
      provider_label = excluded.provider_label,
      provider_domain = excluded.provider_domain,
      stake_upokt = excluded.stake_upokt,
      service_count = excluded.service_count,
      operator_rev_share_percent = excluded.operator_rev_share_percent,
      owner_rev_share_percent = excluded.owner_rev_share_percent,
      other_rev_share_percent = excluded.other_rev_share_percent,
      updated_at = excluded.updated_at
  `
);

const insertSettlementFactStatement = db.prepare(
  `
    INSERT OR IGNORE INTO settlement_facts (
      height,
      event_index,
      block_time,
      day,
      hour,
      service_id,
      supplier_hash,
      owner_hash,
      relays,
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
      @revenue_upokt
    )
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
      CAST(SUM(CAST(facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt,
      COUNT(DISTINCT facts.supplier_hash) AS supplier_count,
      COUNT(DISTINCT COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, facts.owner_hash, facts.supplier_hash)) AS provider_count
    FROM settlement_facts facts
    LEFT JOIN service_dim ON service_dim.service_id = facts.service_id
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = facts.supplier_hash
    LEFT JOIN supplier_identity_dim ON supplier_identity_dim.supplier_hash = facts.supplier_hash
    WHERE facts.block_time >= ?
    GROUP BY facts.service_id
    HAVING relays > 0 OR CAST(revenue_upokt AS INTEGER) > 0
    ORDER BY CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectProviderAggregatesStatement = db.prepare(
  `
    SELECT
      COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash) AS provider_key,
      supplier_identity_dim.provider_label,
      supplier_identity_dim.provider_domain,
      SUM(settlement_facts.relays) AS relays,
      CAST(SUM(CAST(settlement_facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt,
      COUNT(DISTINCT settlement_facts.service_id) AS service_count,
      COUNT(DISTINCT settlement_facts.supplier_hash) AS supplier_count
    FROM settlement_facts
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = settlement_facts.supplier_hash
    LEFT JOIN supplier_identity_dim ON supplier_identity_dim.supplier_hash = settlement_facts.supplier_hash
    WHERE settlement_facts.block_time >= ?
    GROUP BY COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash)
    HAVING relays > 0 OR CAST(revenue_upokt AS INTEGER) > 0
    ORDER BY CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectProviderServiceAggregatesStatement = db.prepare(
  `
    SELECT
      COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash) AS provider_key,
      settlement_facts.service_id,
      service_dim.service_name,
      service_dim.compute_units_per_relay,
      SUM(settlement_facts.relays) AS relays,
      CAST(SUM(CAST(settlement_facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt
    FROM settlement_facts
    LEFT JOIN service_dim ON service_dim.service_id = settlement_facts.service_id
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = settlement_facts.supplier_hash
    LEFT JOIN supplier_identity_dim ON supplier_identity_dim.supplier_hash = settlement_facts.supplier_hash
    WHERE settlement_facts.block_time >= ?
    GROUP BY provider_key, settlement_facts.service_id
    ORDER BY provider_key ASC, CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectProviderSupplierAggregatesStatement = db.prepare(
  `
    SELECT
      COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash) AS provider_key,
      COALESCE(supplier_identity_dim.operator_address, settlement_facts.supplier_hash) AS operator_address,
      COALESCE(supplier_identity_dim.owner_address, settlement_facts.owner_hash, settlement_facts.supplier_hash) AS owner_address,
      supplier_identity_dim.provider_domain,
      SUM(settlement_facts.relays) AS relays,
      CAST(SUM(CAST(settlement_facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt,
      COUNT(DISTINCT settlement_facts.service_id) AS service_count,
      supplier_identity_dim.stake_upokt,
      supplier_identity_dim.service_count AS supplier_service_count,
      supplier_identity_dim.operator_rev_share_percent,
      supplier_identity_dim.owner_rev_share_percent,
      supplier_identity_dim.other_rev_share_percent
    FROM settlement_facts
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = settlement_facts.supplier_hash
    LEFT JOIN supplier_identity_dim ON supplier_identity_dim.supplier_hash = settlement_facts.supplier_hash
    WHERE settlement_facts.block_time >= ?
    GROUP BY provider_key, settlement_facts.supplier_hash
    ORDER BY provider_key ASC, CAST(revenue_upokt AS INTEGER) DESC, relays DESC
  `
);

const selectProviderDailyAggregatesStatement = db.prepare(
  `
    SELECT
      settlement_facts.day,
      SUM(settlement_facts.relays) AS relays,
      CAST(SUM(CAST(settlement_facts.revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt
    FROM settlement_facts
    LEFT JOIN supplier_domain_dim ON supplier_domain_dim.supplier_hash = settlement_facts.supplier_hash
    LEFT JOIN supplier_identity_dim ON supplier_identity_dim.supplier_hash = settlement_facts.supplier_hash
    WHERE settlement_facts.block_time >= ?
      AND COALESCE(supplier_identity_dim.provider_key, supplier_domain_dim.domain_hash, settlement_facts.owner_hash, settlement_facts.supplier_hash) = ?
    GROUP BY settlement_facts.day
    ORDER BY settlement_facts.day ASC
  `
);

const selectDailyAggregatesStatement = db.prepare(
  `
    SELECT
      day,
      SUM(relays) AS relays,
      CAST(SUM(CAST(revenue_upokt AS INTEGER)) AS TEXT) AS revenue_upokt
    FROM settlement_facts
    WHERE block_time >= ?
    GROUP BY day
    ORDER BY day ASC
  `
);

const selectServiceDailyAggregatesStatement = db.prepare(
  `
    SELECT
      day,
      SUM(relays) AS relays,
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

export function saveIndexedSupplierIdentities(identities: IndexedSupplierIdentity[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction((entries: IndexedSupplierIdentity[]) => {
    for (const entry of entries) {
      upsertSupplierIdentityStatement.run({
        supplier_hash: entry.supplierHash,
        operator_address: entry.operatorAddress,
        owner_address: entry.ownerAddress,
        provider_key: entry.providerKey,
        provider_label: entry.providerLabel,
        provider_domain: entry.providerDomain,
        stake_upokt: entry.stakeUpokt,
        service_count: entry.serviceCount,
        operator_rev_share_percent: entry.operatorRevSharePercent,
        owner_rev_share_percent: entry.ownerRevSharePercent,
        other_rev_share_percent: entry.otherRevSharePercent,
        updated_at: now
      });
    }
  });
  transaction(identities);
}

export function getIndexedServiceAggregates(sinceUnixMs: number): IndexedServiceAggregate[] {
  return selectServiceAggregatesStatement.all(sinceUnixMs) as IndexedServiceAggregate[];
}

export function getIndexedProviderAggregates(sinceUnixMs: number): IndexedProviderAggregate[] {
  return selectProviderAggregatesStatement.all(sinceUnixMs) as IndexedProviderAggregate[];
}

export function getIndexedProviderServiceAggregates(sinceUnixMs: number): IndexedProviderServiceAggregate[] {
  return selectProviderServiceAggregatesStatement.all(sinceUnixMs) as IndexedProviderServiceAggregate[];
}

export function getIndexedProviderSupplierAggregates(sinceUnixMs: number): IndexedProviderSupplierAggregate[] {
  return selectProviderSupplierAggregatesStatement.all(sinceUnixMs) as IndexedProviderSupplierAggregate[];
}

export function getIndexedDailyAggregates(sinceUnixMs: number): IndexedDailyAggregate[] {
  return selectDailyAggregatesStatement.all(sinceUnixMs) as IndexedDailyAggregate[];
}

export function getIndexedServiceDailyAggregates(sinceUnixMs: number, serviceId: string): IndexedDailyAggregate[] {
  return selectServiceDailyAggregatesStatement.all(sinceUnixMs, serviceId) as IndexedDailyAggregate[];
}

export function getIndexedProviderDailyAggregates(sinceUnixMs: number, providerKey: string): IndexedDailyAggregate[] {
  return selectProviderDailyAggregatesStatement.all(sinceUnixMs, providerKey) as IndexedDailyAggregate[];
}

export function getLatestIndexedFact(): { height: number; block_time: number } | null {
  const row = selectLatestIndexedFactStatement.get() as { height: number; block_time: number } | undefined;
  return row ?? null;
}

export function pruneIndexerData(retentionDays: number, maxJobRuns = 500): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  deleteOldSettlementFactsStatement.run(cutoff);
  deleteOldJobRunsStatement.run(maxJobRuns);
}

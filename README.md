# Pocket Provider Dashboard

Public-facing Pocket Network dashboard focused on provider onboarding.

## Overview

This project is a Next.js app that turns live Pocket Network data into a simple provider-side market view.

The current public demo focuses on:

- provider-side revenue across `24h`, `7d`, and `30d` windows
- relay demand across active services
- top provider domains and high-demand services
- a growth calculator for early provider planning

## Current Product Scope

This repository does **not** implement the full RC1 architecture described in the technical docs yet.

Today, the project is intentionally lightweight:

- a Next.js application for the UI and read-only API routes
- a separate Node.js ingestion worker for external data collection
- a small local SQLite cache for settlement blocks, metadata, and dashboard snapshots
- `Poktscan` as the primary data source when available
- direct Pocket RPC fallback when `Poktscan` is unavailable
- provider grouping at the domain level, derived from supplier endpoints and service configuration

That makes it a good public demo, but not yet a full historical analytics product backed by a dedicated indexer.

## Data Sources

The dashboard uses a two-layer data strategy.

### Primary path: `Poktscan`

When available, the app loads pre-aggregated network data from `Poktscan` for faster response times and broader historical coverage.

### Fallback path: Pocket RPC

When `Poktscan` is unavailable, the app falls back to Pocket Shannon RPC and reads settlement information from `end_block_events`.

In fallback mode it:

- uses `block_search` to find recent blocks containing `EventClaimSettled`
- fetches only a recent sample of settlement blocks per time window
- skips slow or heavy `block_results` responses automatically

In this mode, provider-side revenue is computed from the supplier-side share inside `reward_distribution_detailed`.

## Demo Semantics

Some details are important when reading the numbers shown in the UI.

- The main unit shown in the dashboard is a provider domain, not a single supplier operator.
- USD values are derived from the live CoinGecko price for `pocket-network`.
- Time windows are based on settlement block time, or the equivalent aggregated time window from `Poktscan`.
- The growth calculator is deliberately simple and designed to provide plausible onboarding guidance, not exact protocol-level forecasting.

## Default Endpoints

- RPC pool:
  - `https://sauron-rpc.infra.pocket.network`
  - `https://pocket-rpc.polkachu.com:443`
  - `https://rpc.pocket.chaintools.tech:443`
  - `https://pocket.api.pocket.network:443`
- REST:
  - `https://sauron-api.infra.pocket.network`

## Environment Variables

Optional overrides:

- `POCKET_RPC_URL`
- `POCKET_RPC_URLS` comma-separated custom RPC pool
- `POCKET_REST_URL`
- `POKTSCAN_API_URL`
- `POCKET_SQLITE_PATH`

## Local Development

```bash
npm install
npm run indexer:once
npm run dev
```

Then open `http://localhost:3101`.

The UI reads local SQLite snapshots only. Run `npm run indexer:once` before opening the app on a fresh database.

## Production Runtime

Run the web process and indexer separately:

```bash
npm run build
npm run start
npm run indexer
```

With PM2:

```bash
POCKET_SQLITE_PATH=/root/pocket-provider-dashboard/data/pocket-provider-dashboard.sqlite pm2 start npm --name pocket-dashboard-provider -- run start
POCKET_SQLITE_PATH=/root/pocket-provider-dashboard/data/pocket-provider-dashboard.sqlite pm2 start npm --name pocket-indexer-provider -- run indexer
```

This branch serves on port `3101` so it can run beside `main` on port `3100`. Use a separate `POCKET_SQLITE_PATH` for the provider deployment so public and provider dashboards do not share cache or indexer state.

The indexer owns live Pocket RPC ingestion, newest-first repair/backfill, supplier identity sync, and dashboard snapshot writes. The Next.js request path reads SQLite snapshots only.

Legacy worker fallback remains available but is not the preferred production path:

```bash
npm run worker
```

## Verification

```bash
npm run typecheck
npm run build
```

## Caching

The app uses:

- SQLite persistence for settlement blocks, metadata, and dashboard snapshots
- `job_runs` records for ingestion success/failure tracking

This keeps the public demo responsive and reduces repeated network fetches.

## Repository Context

If you want the longer-term direction for the project, see:

- `TECHNICAL_DESIGN.md`
- `ROADMAP.md`

Those documents describe the path toward a more rigorous RC1 architecture. The implementation in this repository is the current public demo version.

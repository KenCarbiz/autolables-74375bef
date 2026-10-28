import type { FeedConfigRow } from "@/lib/admin/integrations/feed";
import type { SyncRunRow } from "@/lib/admin/integrations/runs";
import type { InventoryCounts } from "@/lib/admin/integrations/queries";

// Synthetic data shared by the Integrations fixtures (screens 12 and 13).
// Every identifier, domain, name and date here is made up.

export const FIXTURE_NOW = Date.parse("2026-10-24T14:30:00Z");
export const FIXTURE_TENANT = "00000000-0000-4000-8000-000000000000";
export const FIXTURE_HOST = "example-dealer.test";
export const FIXTURE_PIN = "example-pin-0001";

export const RUN_RATE_LIMITED: SyncRunRow = {
  id: "a1b2c3d4-0000-4000-8000-000000000429",
  tenant_id: FIXTURE_TENANT,
  source: FIXTURE_HOST,
  started_at: "2026-10-24T06:07:04Z",
  finished_at: "2026-10-24T06:07:09Z",
  status: "failed",
  num_found: 0,
  seen: 0,
  new_vehicles: 0,
  updated_vehicles: 0,
  prices_recorded: 0,
  removed: 0,
  http_status: 429,
  matched_dealer: null,
  error_summary: "MarketCheck rate-limited or over quota (HTTP 429)",
  raw: { kind: "provider_refused", error: "refused_429", mc_param: "dealer_id", mc_value: FIXTURE_PIN, attempts: 3, source: FIXTURE_HOST },
};

export const RUN_SKIPPED: SyncRunRow = {
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  tenant_id: FIXTURE_TENANT,
  source: FIXTURE_HOST,
  started_at: "2026-10-23T06:07:02Z",
  finished_at: "2026-10-23T06:07:02Z",
  status: "skipped",
  num_found: 0,
  seen: 0,
  new_vehicles: 0,
  updated_vehicles: 0,
  prices_recorded: 0,
  removed: 0,
  http_status: null,
  matched_dealer: null,
  error_summary: "skipped: cadence",
  raw: { reason: "cadence", last_run_at: "2026-10-22T06:07:00Z" },
};

export const RUN_SUCCESS: SyncRunRow = {
  id: "a1b2c3d4-0000-4000-8000-000000000200",
  tenant_id: FIXTURE_TENANT,
  source: FIXTURE_HOST,
  started_at: "2026-10-22T06:07:00Z",
  finished_at: "2026-10-22T06:09:41Z",
  status: "success",
  num_found: 131,
  seen: 128,
  new_vehicles: 2,
  updated_vehicles: 126,
  prices_recorded: 128,
  removed: 0,
  http_status: 200,
  matched_dealer: "Example Motors",
  error_summary: null,
  raw: { source: FIXTURE_HOST, mc_param: "dealer_id", mc_value: FIXTURE_PIN, pruned: 0, new_units: { primary_feed: 2, total: 2 } },
};

export const FIXTURE_RUNS: SyncRunRow[] = [RUN_RATE_LIMITED, RUN_SKIPPED, RUN_SUCCESS];

export const FIXTURE_CONFIG: FeedConfigRow = {
  enabled: true,
  allowed: true,
  source: FIXTURE_HOST,
  frequency: "nightly",
  run_hour: 6,
  day_of_week: 0,
  max_vehicles: 1000,
  last_run_at: RUN_RATE_LIMITED.started_at,
  mc_scope_param: "dealer_id",
  mc_scope_value: FIXTURE_PIN,
  rooftop_name: "Example Motors",
  rooftop_street: "100 Example Way",
  rooftop_zip: "00000",
  rooftop_verified_at: RUN_SUCCESS.finished_at,
  strict_rooftop: true,
  last_good_count: 128,
  last_good_at: RUN_SUCCESS.finished_at,
  updated_at: "2026-10-01T12:00:00Z",
};

export const FIXTURE_COUNTS: InventoryCounts = {
  active: { kind: "known", value: 130 },
  new: { kind: "known", value: 79 },
  used: { kind: "known", value: 31 },
  cpo: { kind: "known", value: 20 },
};

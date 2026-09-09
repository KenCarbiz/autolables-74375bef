import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { compareVehicle, summariseParity } from "../_shared/factorySticker/lib/vehicleFile/parity.ts";
import { buildVehicleFileReadModel } from "../_shared/factorySticker/lib/vehicleFile/readModel.ts";
import type { ParityRow } from "../_shared/factorySticker/lib/vehicleFile/readModelTypes.ts";
import { emptySources, type Row, type VehicleFileSources } from "../_shared/factorySticker/lib/vehicleFile/sources.ts";

// ──────────────────────────────────────────────────────────────
// vehicle-file-read-model  ·  Gate 2 shadow read model
//
// SHADOW ONLY. Nothing in the product reads this function, and it writes
// nothing: no table, no audit row, no cache. It exists so the projection
// described in directive §11 can be built against live data and compared
// (§50, §51) with what the app shows today, without one user-visible value
// moving. If this function is ever wired to a page, the parity report has to
// come first.
//
// Contract:
//   POST /functions/v1/vehicle-file-read-model
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>  (or x-cron-secret)
//   Body:
//     { action: "read_model", tenant_id, vin? , vehicle_id? }
//       -> { model, timing, queryCount, payloadBytes }
//     { action: "shadow_parity", tenant_id, limit?, offset? }
//       -> { summary, rows (non-MATCH only), compared, skipped, truncated }
//
// Auth: service-role key or the shared cron secret. There is deliberately NO
// user-JWT path. The bundle joins tables under two different tenant-scoping
// models — some RLS policies key on current_tenant_id(), others on a
// tenant_members list — so a JWT caller would get a bundle whose gaps depend
// on which policy answered, and a projection assembled from a partly-visible
// bundle is worse than no projection. Running as service role with an
// explicit tenant filter on every query makes the scope one reviewable rule
// instead of thirty-five.
//
// Round trips (§58). The current page assembles a vehicle from 48 read sites
// (DUPLICATE_READ_PATHS.md). This fetches by TABLE, not by section, with one
// `.in()` over the whole batch of vehicle ids:
//     read_model     = 1 listing + 4 tenant-level + 31 batched  = 36
//     shadow_parity  = 1 count + 1 listing page + 4 tenant-level
//                      + 31 per chunk of PARITY_CHUNK vehicles
// so 25 vehicles cost the same 31 reads as one. `payloadBytes` is what those
// reads pulled out of Postgres, not the size of the reply — the reply is a
// summary and would say nothing about the cost of building it.
//
// Anything unreadable becomes a line in `sources.missing` and travels into
// the model's `missingSources`. A gap is reported; it is never inferred and
// it never throws.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** The gateway drops an idle link at 150 s; stop early enough to answer. */
const RUN_BUDGET_MS = 120_000;
/** Vehicles per fetch batch. Bigger batches are fewer round trips and more
 *  rows held at once; 25 keeps the widest table (vehicle_facts, ~39 rows a
 *  vehicle) inside a few thousand rows per read. */
const PARITY_CHUNK = 25;
const DEFAULT_PARITY_LIMIT = 25;
const MAX_PARITY_LIMIT = 200;

type Db = ReturnType<typeof createClient>;

const encoder = new TextEncoder();

interface FetchContext {
  queryCount: number;
  payloadBytes: number;
  missing: string[];
}

const newContext = (): FetchContext => ({ queryCount: 0, payloadBytes: 0, missing: [] });

const account = (ctx: FetchContext, rows: unknown): void => {
  ctx.payloadBytes += encoder.encode(JSON.stringify(rows ?? [])).length;
};

// ── The fetch plan ──────────────────────────────────────────────────

interface VehicleQuery {
  /** The table, which is also the name this query is grouped and reported by. */
  table: string;
  /** The column that carries the tenant. `audit_log` calls it `store_id`. */
  tenantColumn: "tenant_id" | "store_id";
  /** The column that ties a row to one vehicle. */
  keyColumn: string;
  /** `id` = a vehicle_listings.id; `vin` = an upper-cased VIN. */
  keyKind: "id" | "vin";
  /**
   * The writer's own stamp. Rows come back newest first with nulls last —
   * Postgres orders DESC as NULLS FIRST, which would otherwise let an
   * unstamped row take `[0]` from a stamped one — so `[0]` is the current row.
   */
  timeColumn: string;
  /**
   * Row cap per vehicle; the batch cap is this times the batch size. Each
   * number sits above the pilot tenant's observed per-vehicle maximum
   * (measured 2026-09-09), so a cap note in `missing` means a vehicle is
   * unusual, not that the plan is too small to read a normal one.
   */
  perVehicle: number;
  eq?: Array<[string, string]>;
  /** `.is(column, null)` — an open row is one nothing has resolved. */
  isNull?: string;
}

const VEHICLE_QUERIES: VehicleQuery[] = [
  { table: "vehicle_files", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 5 },
  { table: "vehicle_facts", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "observed_at", perVehicle: 300 },
  { table: "vehicle_snapshots", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 10 },
  { table: "vehicle_source_records", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "retrieved_at", perVehicle: 40 },
  { table: "vehicle_fact_conflicts", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 40, isNull: "resolved_at" },
  { table: "neovin_snapshots", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "fetched_at", perVehicle: 10 },
  { table: "advertised_prices", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "captured_at", perVehicle: 300 },
  { table: "advertised_price_crawl_attempts", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "last_attempt_at", perVehicle: 5 },
  // A refused page reading writes no price row: the only record it leaves is
  // this audit action, and the guard's own numbers live in `details`.
  { table: "audit_log", tenantColumn: "store_id", keyColumn: "entity_id", keyKind: "vin", timeColumn: "created_at", perVehicle: 200, eq: [["action", "advertised_price_crawl_skipped"]] },
  { table: "factory_sticker_records", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 5 },
  { table: "get_ready_records", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 5 },
  { table: "dealer_work_items", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 60 },
  { table: "recon_estimates", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 20 },
  { table: "safety_inspections", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 20 },
  { table: "prep_sign_offs", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 20 },
  { table: "vehicle_delivery_clearance", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "computed_at", perVehicle: 5 },
  { table: "vehicle_lifecycle", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 5 },
  { table: "generated_documents", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 60 },
  { table: "signed_document_archive", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "created_at", perVehicle: 40 },
  { table: "stale_document_flags", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 40 },
  { table: "recall_service_tasks", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "updated_at", perVehicle: 20 },
  { table: "description_versions", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 20 },
  { table: "description_channel_versions", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 120 },
  { table: "description_exceptions", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "created_at", perVehicle: 120 },
  { table: "passport_engagement", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "last_at", perVehicle: 250 },
  { table: "qr_scan_events", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "scanned_at", perVehicle: 100 },
  // `customer_engagement_events.vehicle_id` is text, not uuid; the ids are
  // handed in as strings, so the same `.in()` works.
  { table: "customer_engagement_events", tenantColumn: "tenant_id", keyColumn: "vehicle_id", keyKind: "id", timeColumn: "occurred_at", perVehicle: 300 },
  { table: "leads", tenantColumn: "tenant_id", keyColumn: "vehicle_vin", keyKind: "vin", timeColumn: "captured_at", perVehicle: 20 },
  { table: "vehicle_change_history", tenantColumn: "tenant_id", keyColumn: "vehicle_listing_id", keyKind: "id", timeColumn: "changed_at", perVehicle: 150 },
  { table: "vehicle_value_history", tenantColumn: "tenant_id", keyColumn: "vin", keyKind: "vin", timeColumn: "captured_at", perVehicle: 200 },
];

/**
 * `provider_payload_shapes` is the one table in the bundle with no tenant
 * column, and it cannot have one: a row records the SHAPE a provider's
 * payload arrived in, which is a property of the provider, not of a dealer.
 * It is read here filtered to this batch's own VINs (`sample_vin`), which is
 * both the narrowest possible filter and exactly what the health check asks —
 * "could the last NeoVIN payload FOR THIS VIN be parsed". No tenant data is
 * reachable through it.
 */
const SHAPE_QUERY = {
  table: "provider_payload_shapes",
  keyColumn: "sample_vin",
  timeColumn: "last_seen_at",
  perVehicle: 10,
} as const;

interface TenantQuery {
  table: string;
  timeColumn: string | null;
  limit: number;
}

/** Tenant-wide inputs: the same rows for every vehicle, so read once a run. */
const TENANT_QUERIES: TenantQuery[] = [
  { table: "dealer_profiles", timeColumn: null, limit: 1 },
  { table: "source_authority_rules", timeColumn: null, limit: 200 },
  { table: "inventory_sync_runs", timeColumn: "started_at", limit: 20 },
  { table: "marketcheck_sync_config", timeColumn: null, limit: 1 },
];

const QUERIES_PER_BATCH = VEHICLE_QUERIES.length + 1;

// ── Fetching ────────────────────────────────────────────────────────

const groupRows = (rows: Row[], keyColumn: string, keyKind: "id" | "vin"): Map<string, Row[]> => {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const raw = row[keyColumn];
    if (typeof raw !== "string" || !raw) continue;
    const key = keyKind === "vin" ? raw.toUpperCase() : raw;
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
};

const capNote = (table: string, cap: number): string =>
  `${table}: the batch row cap of ${cap} was reached, so some rows for these vehicles were not read.`;

async function runVehicleQuery(
  db: Db,
  tenantId: string,
  spec: VehicleQuery,
  ids: string[],
  vins: string[],
  ctx: FetchContext,
): Promise<Map<string, Row[]>> {
  const keys = spec.keyKind === "vin" ? vins : ids;
  const cap = Math.max(spec.perVehicle * keys.length, spec.perVehicle);
  let query = db.from(spec.table).select("*").eq(spec.tenantColumn, tenantId);
  for (const [column, value] of spec.eq ?? []) query = query.eq(column, value);
  if (spec.isNull) query = query.is(spec.isNull, null);
  const { data, error } = await query
    .in(spec.keyColumn, keys)
    .order(spec.timeColumn, { ascending: false, nullsFirst: false })
    .limit(cap);
  ctx.queryCount += 1;
  if (error) {
    ctx.missing.push(`${spec.table}: ${error.message}`);
    return new Map();
  }
  const rows = (data ?? []) as Row[];
  account(ctx, rows);
  if (rows.length >= cap) ctx.missing.push(capNote(spec.table, cap));
  return groupRows(rows, spec.keyColumn, spec.keyKind);
}

async function runShapeQuery(db: Db, vins: string[], ctx: FetchContext): Promise<Map<string, Row[]>> {
  const cap = Math.max(SHAPE_QUERY.perVehicle * vins.length, SHAPE_QUERY.perVehicle);
  const { data, error } = await db
    .from(SHAPE_QUERY.table)
    .select("*")
    .in(SHAPE_QUERY.keyColumn, vins)
    .order(SHAPE_QUERY.timeColumn, { ascending: false, nullsFirst: false })
    .limit(cap);
  ctx.queryCount += 1;
  if (error) {
    ctx.missing.push(`${SHAPE_QUERY.table}: ${error.message}`);
    return new Map();
  }
  const rows = (data ?? []) as Row[];
  account(ctx, rows);
  return groupRows(rows, SHAPE_QUERY.keyColumn, "vin");
}

interface TenantScope {
  dealerProfile: Row | null;
  authorityRules: Row[];
  syncRuns: Row[];
  syncConfig: Row | null;
}

async function fetchTenantScope(db: Db, tenantId: string, ctx: FetchContext): Promise<TenantScope> {
  const results = await Promise.all(TENANT_QUERIES.map(async (spec) => {
    let query = db.from(spec.table).select("*").eq("tenant_id", tenantId);
    if (spec.timeColumn) query = query.order(spec.timeColumn, { ascending: false, nullsFirst: false });
    const { data, error } = await query.limit(spec.limit);
    ctx.queryCount += 1;
    if (error) {
      ctx.missing.push(`${spec.table}: ${error.message}`);
      return [] as Row[];
    }
    const rows = (data ?? []) as Row[];
    account(ctx, rows);
    return rows;
  }));

  const [profiles, rules, runs, config] = results;
  return {
    dealerProfile: profiles[0] ?? null,
    authorityRules: rules,
    syncRuns: runs,
    syncConfig: config[0] ?? null,
  };
}

type Batch = Map<string, Map<string, Row[]>>;

async function fetchVehicleBatch(
  db: Db,
  tenantId: string,
  listings: Row[],
  ctx: FetchContext,
): Promise<Batch> {
  const ids: string[] = [];
  const vins: string[] = [];
  for (const listing of listings) {
    const id = listing.id;
    const vin = listing.vin;
    if (typeof id === "string" && id) ids.push(id);
    if (typeof vin === "string" && vin) vins.push(vin.toUpperCase());
  }

  const batch: Batch = new Map();
  if (!ids.length && !vins.length) return batch;

  const grouped = await Promise.all([
    ...VEHICLE_QUERIES.map((spec) => runVehicleQuery(db, tenantId, spec, ids, vins, ctx)),
    runShapeQuery(db, vins, ctx),
  ]);

  VEHICLE_QUERIES.forEach((spec, index) => batch.set(spec.table, grouped[index]));
  batch.set(SHAPE_QUERY.table, grouped[VEHICLE_QUERIES.length]);
  return batch;
}

// ── Assembly ────────────────────────────────────────────────────────

const KEY_KIND = new Map<string, "id" | "vin">([
  ...VEHICLE_QUERIES.map((spec) => [spec.table, spec.keyKind] as [string, "id" | "vin"]),
  [SHAPE_QUERY.table, "vin"] as [string, "id" | "vin"],
]);

function assembleSources(
  tenantId: string,
  listing: Row,
  batch: Batch,
  tenant: TenantScope,
  missing: string[],
): VehicleFileSources {
  const id = typeof listing.id === "string" ? listing.id : "";
  const vin = typeof listing.vin === "string" ? listing.vin.toUpperCase() : "";

  const many = (table: string): Row[] => {
    const key = KEY_KIND.get(table) === "vin" ? vin : id;
    if (!key) return [];
    return batch.get(table)?.get(key) ?? [];
  };
  const one = (table: string): Row | null => many(table)[0] ?? null;

  const sources = emptySources(tenantId);
  sources.listing = listing;
  sources.file = one("vehicle_files");
  sources.facts = many("vehicle_facts");
  sources.snapshot = one("vehicle_snapshots");
  sources.sourceRecords = many("vehicle_source_records");
  sources.factConflicts = many("vehicle_fact_conflicts");
  sources.neovin = one("neovin_snapshots");
  sources.advertisedPrices = many("advertised_prices");
  sources.crawlAttempt = one("advertised_price_crawl_attempts");
  sources.crawlRefusals = many("audit_log");
  sources.factorySticker = one("factory_sticker_records");
  sources.getReady = one("get_ready_records");
  sources.workItems = many("dealer_work_items");
  sources.reconEstimates = many("recon_estimates");
  sources.safetyInspections = many("safety_inspections");
  sources.prepSignOffs = many("prep_sign_offs");
  sources.deliveryClearance = one("vehicle_delivery_clearance");
  sources.lifecycle = one("vehicle_lifecycle");
  sources.generatedDocuments = many("generated_documents");
  sources.signedDocuments = many("signed_document_archive");
  sources.staleFlags = many("stale_document_flags");
  sources.recallTasks = many("recall_service_tasks");
  sources.descriptionVersion = one("description_versions");
  sources.descriptionChannels = many("description_channel_versions");
  sources.descriptionExceptions = many("description_exceptions");
  // One list, three writers: dwell rows, QR scans and the engagement stream.
  // `buildCustomer` tells them apart by their own columns, not by origin.
  sources.engagement = [
    ...many("passport_engagement"),
    ...many("qr_scan_events"),
    ...many("customer_engagement_events"),
  ];
  sources.leads = many("leads");
  sources.changeHistory = many("vehicle_change_history");
  sources.valueHistory = many("vehicle_value_history");
  sources.providerShapes = many("provider_payload_shapes");
  sources.dealerProfile = tenant.dealerProfile;
  sources.authorityRules = tenant.authorityRules;
  sources.syncRuns = tenant.syncRuns;
  sources.syncConfig = tenant.syncConfig;
  sources.missing = [...missing];
  return sources;
}

// ── Vehicle selection ───────────────────────────────────────────────

async function fetchOneListing(
  db: Db,
  tenantId: string,
  vehicleId: string | null,
  vin: string | null,
  ctx: FetchContext,
): Promise<Row | null> {
  let query = db.from("vehicle_listings").select("*").eq("tenant_id", tenantId);
  query = vehicleId ? query.eq("id", vehicleId) : query.eq("vin", (vin ?? "").toUpperCase());
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
  ctx.queryCount += 1;
  if (error) {
    ctx.missing.push(`vehicle_listings: ${error.message}`);
    return null;
  }
  const rows = (data ?? []) as Row[];
  account(ctx, rows);
  return rows[0] ?? null;
}

/** Active = the dealer still has it: not archived, not marked archived. */
async function countActiveListings(db: Db, tenantId: string, ctx: FetchContext): Promise<number | null> {
  const { count, error } = await db
    .from("vehicle_listings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .neq("status", "archived");
  ctx.queryCount += 1;
  if (error) {
    ctx.missing.push(`vehicle_listings (active count): ${error.message}`);
    return null;
  }
  return count ?? 0;
}

async function fetchActiveListings(
  db: Db,
  tenantId: string,
  limit: number,
  offset: number,
  ctx: FetchContext,
): Promise<Row[]> {
  const { data, error } = await db
    .from("vehicle_listings")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .neq("status", "archived")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  ctx.queryCount += 1;
  if (error) {
    ctx.missing.push(`vehicle_listings: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as Row[];
  account(ctx, rows);
  return rows;
}

// ── Actions ─────────────────────────────────────────────────────────

interface RequestBody {
  action?: string;
  tenant_id?: string;
  vin?: string;
  vehicle_id?: string;
  limit?: number;
  offset?: number;
}

async function readModelAction(db: Db, body: RequestBody, startedAt: number): Promise<Response> {
  const tenantId = body.tenant_id ?? "";
  const vehicleId = body.vehicle_id ?? null;
  const vin = body.vin ?? null;
  if (!tenantId) return json({ error: "tenant_id required" }, 400);
  if (!vehicleId && !vin) return json({ error: "vin or vehicle_id required" }, 400);

  const ctx = newContext();
  const listing = await fetchOneListing(db, tenantId, vehicleId, vin, ctx);
  if (!listing) {
    return json({
      error: "vehicle not found for this tenant",
      tenant_id: tenantId,
      queryCount: ctx.queryCount,
      missing: ctx.missing,
    }, 404);
  }

  const [tenant, batch] = await Promise.all([
    fetchTenantScope(db, tenantId, ctx),
    fetchVehicleBatch(db, tenantId, [listing], ctx),
  ]);
  const fetchMs = Date.now() - startedAt;

  const sources = assembleSources(tenantId, listing, batch, tenant, ctx.missing);
  const buildStartedAt = Date.now();
  const model = buildVehicleFileReadModel(sources);
  const buildMs = Date.now() - buildStartedAt;

  return json({
    ok: true,
    action: "read_model",
    tenant_id: tenantId,
    vehicle_id: model.vehicleId,
    vin: model.vin,
    model,
    queryCount: ctx.queryCount,
    queriesPerBatch: QUERIES_PER_BATCH,
    payloadBytes: ctx.payloadBytes,
    timing: { elapsedMs: Date.now() - startedAt, fetchMs, buildMs },
  });
}

async function shadowParityAction(db: Db, body: RequestBody, startedAt: number): Promise<Response> {
  const tenantId = body.tenant_id ?? "";
  if (!tenantId) return json({ error: "tenant_id required" }, 400);

  const limit = Math.max(1, Math.min(Number(body.limit) || DEFAULT_PARITY_LIMIT, MAX_PARITY_LIMIT));
  const offset = Math.max(0, Number(body.offset) || 0);
  const deadlineAt = startedAt + RUN_BUDGET_MS;

  const ctx = newContext();
  const activeVins = await countActiveListings(db, tenantId, ctx);
  const listings = await fetchActiveListings(db, tenantId, limit, offset, ctx);
  const tenant = await fetchTenantScope(db, tenantId, ctx);

  const rows: ParityRow[] = [];
  const missingSources: string[] = [];
  let compared = 0;
  let truncated = false;

  for (let start = 0; start < listings.length; start += PARITY_CHUNK) {
    // A run that stops early must never read as a run that finished. The
    // remainder is reported as skipped and `next_offset` chains it.
    if (Date.now() > deadlineAt) {
      truncated = true;
      break;
    }
    const chunk = listings.slice(start, start + PARITY_CHUNK);
    const batch = await fetchVehicleBatch(db, tenantId, chunk, ctx);
    for (const listing of chunk) {
      const sources = assembleSources(tenantId, listing, batch, tenant, ctx.missing);
      const model = buildVehicleFileReadModel(sources);
      for (const line of model.missingSources) missingSources.push(line);
      for (const row of compareVehicle(sources, model)) rows.push(row);
      compared += 1;
    }
  }

  const summary = summariseParity(rows, activeVins ?? compared, missingSources);
  const skipped = listings.length - compared;
  // Where to resume: the vehicle the budget stopped at, or the next page when
  // this one finished and the tenant has more active cars than it covered.
  const nextOffset = compared < listings.length
    ? offset + compared
    : (activeVins !== null && offset + listings.length < activeVins ? offset + listings.length : null);

  return json({
    ok: true,
    action: "shadow_parity",
    tenant_id: tenantId,
    activeVins,
    selected: listings.length,
    compared,
    skipped,
    truncated,
    next_offset: nextOffset,
    summary,
    rows: rows.filter((row) => row.verdict !== "MATCH"),
    queryCount: ctx.queryCount,
    queriesPerBatch: QUERIES_PER_BATCH,
    payloadBytes: ctx.payloadBytes,
    timing: { elapsedMs: Date.now() - startedAt, budgetMs: RUN_BUDGET_MS },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Missing Supabase env vars" }, 500);

  // Service role or the shared cron secret, and nothing else. See the header:
  // a user JWT cannot produce a whole bundle, so it is not offered one.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  const isCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
  if (auth !== serviceKey && !isCron) return json({ error: "service role or cron secret required" }, 401);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody = {};
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json({ error: "a JSON body with an action is required" }, 400);
  }

  try {
    if (body.action === "read_model") return await readModelAction(db, body, startedAt);
    if (body.action === "shadow_parity") return await shadowParityAction(db, body, startedAt);
    return json({ error: 'action must be "read_model" or "shadow_parity"' }, 400);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: detail, action: body.action ?? null, elapsedMs: Date.now() - startedAt }, 500);
  }
});

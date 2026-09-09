// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/sources.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// What the projection is built FROM.
//
// One bundle, fetched once, server-side, then handed to pure builders. The
// split matters: everything downstream of this file is a function of data,
// so it can be tested against a fixture instead of a database, and the
// fetching is one reviewable place instead of 48 (DUPLICATE_READ_PATHS.md).
//
// Row types are deliberately loose. These tables carry jsonb columns whose
// keys differ per vehicle and per provider generation, and a strict
// interface here would either lie about that or have to be migrated every
// time a provider adds a field. Builders narrow what they read.

export type Row = Record<string, unknown>;

export interface VehicleFileSources {
  tenantId: string;
  /** `vehicle_listings` row. The one row every consumer reads today. */
  listing: Row | null;
  /** `vehicle_files` row, joined on (tenant_id, upper(vin)) — the only home of stock. */
  file: Row | null;
  /** `vehicle_facts` rows for this vehicle_id. A derived ledger, not a source. */
  facts: Row[];
  /** Latest `vehicle_snapshots` row. */
  snapshot: Row | null;
  /** `vehicle_source_records` rows. */
  sourceRecords: Row[];
  /** Open `vehicle_fact_conflicts` rows. */
  factConflicts: Row[];
  /** `neovin_snapshots` row: the manufacturer build answer, unrewritten by the feed. */
  neovin: Row | null;
  /** `advertised_prices` rows for (tenant, VIN), newest first, both channels. */
  advertisedPrices: Row[];
  /** `advertised_price_crawl_attempts` row: the crawl ledger for this VIN. */
  crawlAttempt: Row | null;
  /** `audit_log` rows for `advertised_price_crawl_skipped`: refusals leave no price row. */
  crawlRefusals: Row[];
  /** `factory_sticker_records` row. */
  factorySticker: Row | null;
  /** `get_ready_records` row. */
  getReady: Row | null;
  /** `dealer_work_items`, `recon_estimates`, inspections, sign-offs, clearance. */
  workItems: Row[];
  reconEstimates: Row[];
  safetyInspections: Row[];
  prepSignOffs: Row[];
  deliveryClearance: Row | null;
  lifecycle: Row | null;
  /** `generated_documents` + `signed_document_archive` + `stale_document_flags`. */
  generatedDocuments: Row[];
  signedDocuments: Row[];
  staleFlags: Row[];
  /** `recall_service_tasks`. */
  recallTasks: Row[];
  /** `description_versions` / `description_channel_versions` / exceptions. */
  descriptionVersion: Row | null;
  descriptionChannels: Row[];
  descriptionExceptions: Row[];
  /** `passport_engagement`, `qr_scan_events`, `customer_engagement_events`, `leads`. */
  engagement: Row[];
  leads: Row[];
  /** `vehicle_change_history` and `vehicle_value_history`, newest first, bounded. */
  changeHistory: Row[];
  valueHistory: Row[];
  /** Tenant-level settings that change how a value is read, not what it is. */
  dealerProfile: Row | null;
  /** `source_authority_rules` compiled per tenant; empty today. */
  authorityRules: Row[];
  /** Provider health inputs: sync runs, crawl ledger tail, provider shapes. */
  syncRuns: Row[];
  syncConfig: Row | null;
  providerShapes: Row[];
  /** Tables or queries that failed; a gap is reported, never inferred. */
  missing: string[];
}

/** An empty bundle, so a builder can be tested one field at a time. */
export function emptySources(tenantId = "00000000-0000-0000-0000-000000000000"): VehicleFileSources {
  return {
    tenantId,
    listing: null,
    file: null,
    facts: [],
    snapshot: null,
    sourceRecords: [],
    factConflicts: [],
    neovin: null,
    advertisedPrices: [],
    crawlAttempt: null,
    crawlRefusals: [],
    factorySticker: null,
    getReady: null,
    workItems: [],
    reconEstimates: [],
    safetyInspections: [],
    prepSignOffs: [],
    deliveryClearance: null,
    lifecycle: null,
    generatedDocuments: [],
    signedDocuments: [],
    staleFlags: [],
    recallTasks: [],
    descriptionVersion: null,
    descriptionChannels: [],
    descriptionExceptions: [],
    engagement: [],
    leads: [],
    changeHistory: [],
    valueHistory: [],
    dealerProfile: null,
    authorityRules: [],
    syncRuns: [],
    syncConfig: null,
    providerShapes: [],
    missing: [],
  };
}

// ── Small readers, so every builder narrows jsonb the same way ──────

export const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

export const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};

export const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
};

export const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Read a nested json path: `dig(mc, "build_sheet", "pricing", "total_msrp")`. */
export const dig = (root: unknown, ...path: string[]): unknown => {
  let cur: unknown = root;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Row)[key];
  }
  return cur;
};

/**
 * ISO string from anything a stamp column might hold.
 *
 * MarketCheck writes `last_seen_at`, `first_seen_at` and `scraped_at` as
 * epoch seconds, which `Date.parse` rejects outright. Left unhandled, every
 * feed-written value reports an unknown observation time, so no feed field
 * can be aged and the whole freshness policy silently degrades to UNKNOWN on
 * the source that supplies most of the vehicle. Ten digits is seconds,
 * thirteen is milliseconds; anything else is left to Date.parse, so an ISO
 * string and a bare year still behave as before.
 */
export const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length > 10 ? n : n * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** The most recent of several stamps; null when none parse. */
export const latestStamp = (...values: unknown[]): string | null => {
  let best: string | null = null;
  for (const v of values) {
    const s = iso(v);
    if (s && (!best || s > best)) best = s;
  }
  return best;
};

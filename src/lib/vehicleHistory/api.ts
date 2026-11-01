import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation, rpcErrorMessage } from "./labels";
import type {
  ActionResult, EpisodeRow, InboxRow, InspectionRow, LookupResult, MilestoneRow, QuarantineRow, RepairRow, ReviewRow, SettingRow, Snapshot,
  VehicleLookup, VisitRow,
} from "./types";

// The vehicle history tables and RPCs are proposed and not in the generated
// types, so this one cast is the only place the client loses its typing.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Narrow = (q: any) => any;
const untyped = supabase as unknown as {
  from: (t: string) => any;
  rpc: (f: string, a: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface PgError { code?: string | null; message?: string | null }
interface Reply<T> { data: T | null; error: PgError | null; count?: number | null }

export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const INBOX_STATUSES = ["received", "held", "applied", "superseded", "stale", "conflict", "rejected", "unmatched", "dead"] as const;
const VEHICLE_SCAN_LIMIT = 10000;
const LIST_LIMIT = 50;

interface Guarded<T> { data: T | null; missing: boolean; failed: boolean }

async function guarded<T>(run: () => PromiseLike<Reply<T>>): Promise<Guarded<T>> {
  try {
    const { data, error } = await run();
    if (error) return { data: null, missing: isMissingRelation(error), failed: true };
    return { data, missing: false, failed: false };
  } catch {
    return { data: null, missing: false, failed: true };
  }
}

async function headCount(table: string, tenantId: string, narrow: Narrow = (q) => q): Promise<Guarded<number>> {
  try {
    const { count, error } = (await narrow(untyped.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId))) as Reply<unknown>;
    if (error) return { data: null, missing: isMissingRelation(error), failed: true };
    return typeof count === "number" ? { data: count, missing: false, failed: false } : { data: null, missing: false, failed: true };
  } catch {
    return { data: null, missing: false, failed: true };
  }
}

const sumKnown = (a: Guarded<number>, b: Guarded<number>): number | null => (a.data === null || b.data === null ? null : a.data + b.data);

function parseSetting(value: unknown): boolean | number | null {
  return typeof value === "boolean" || typeof value === "number" ? value : null;
}

async function loadSettings(tenantId: string): Promise<{ settings: SettingRow[] | null; missing: boolean }> {
  const keys = await guarded<Array<Omit<SettingRow, "effective_value" | "source" | "tenant_version" | "tenant_value">>>(() =>
    untyped.from("vehicle_history_setting_keys").select("key,value_type,allowed_scopes,consumer,policy_status,min_value,max_value").order("key"));
  if (keys.data === null) return { settings: null, missing: keys.missing };
  const own = await guarded<Array<{ key: string; version: number; value: unknown }>>(() =>
    untyped.from("vehicle_history_settings").select("key,version,value").eq("scope_type", "tenant").eq("scope_id", tenantId).order("version", { ascending: false }));
  if (own.data === null) return { settings: null, missing: own.missing };
  const latest = new Map<string, { version: number; value: unknown }>();
  for (const r of own.data) if (!latest.has(r.key)) latest.set(r.key, { version: r.version, value: r.value });
  const effective = await Promise.all(keys.data.map((k) =>
    guarded<{ value: unknown; source: string }>(() => untyped.rpc("vehicle_history_effective_setting", { p_tenant: tenantId, p_store: null, p_key: k.key }))));
  const settings = keys.data.map((k, i): SettingRow => {
    const mine = latest.get(k.key);
    const eff = effective[i].data;
    return {
      ...k,
      effective_value: eff ? parseSetting(eff.value) : null,
      source: eff ? eff.source : null,
      tenant_version: mine?.version ?? 0,
      tenant_value: mine ? parseSetting(mine.value) : null,
    };
  });
  return { settings, missing: false };
}

export async function loadSnapshot(tenantId: string): Promise<Snapshot> {
  const [scan, openReviews, held, unmatched, quarantineOpen, dead] = await Promise.all([
    guarded<Array<{ vin: string }>>(() => untyped.from("vehicle_instances").select("vin").eq("tenant_id", tenantId).limit(VEHICLE_SCAN_LIMIT)),
    headCount("vehicle_reappearance_reviews", tenantId, (q) => q.eq("status", "open")),
    headCount("integration_inbox", tenantId, (q) => q.eq("status", "held")),
    headCount("integration_inbox", tenantId, (q) => q.eq("status", "unmatched")),
    headCount("vehicle_identity_quarantine", tenantId, (q) => q.eq("status", "open")),
    headCount("integration_inbox", tenantId, (q) => q.eq("status", "dead")),
  ]);
  const awaiting = sumKnown(sumKnownG(held, unmatched), quarantineOpen);

  const [reviews, visits, inbox, quarantine, statusCounts, settings] = await Promise.all([
    guarded<ReviewRow[]>(() => untyped.from("vehicle_reappearance_reviews").select("id,vin,prior_instance_id,prior_custody_state,detected_source,detected_at,status")
      .eq("tenant_id", tenantId).eq("status", "open").order("detected_at", { ascending: false }).limit(LIST_LIMIT)),
    guarded<VisitRow[]>(() => untyped.from("service_visits").select("id,vin,instance_id,source_app,ro_number,opened_at,closed_at,odometer_value,odometer_unit,intake_verification,status")
      .eq("tenant_id", tenantId).order("opened_at", { ascending: false }).limit(25)),
    guarded<InboxRow[]>(() => untyped.from("integration_inbox").select("id,status,event_type,vin,producer,received_at,outcome_code,attempts")
      .eq("tenant_id", tenantId).in("status", ["dead", "unmatched", "held"]).order("received_at", { ascending: false }).limit(LIST_LIMIT)),
    guarded<QuarantineRow[]>(() => untyped.from("vehicle_identity_quarantine").select("id,raw_vin,reason,source_app,source_ref,inbox_id,status,created_at")
      .eq("tenant_id", tenantId).eq("status", "open").order("created_at", { ascending: false }).limit(LIST_LIMIT)),
    Promise.all(INBOX_STATUSES.map((s) => headCount("integration_inbox", tenantId, (q) => q.eq("status", s)))),
    loadSettings(tenantId),
  ]);

  const visitIds = (visits.data ?? []).map((v) => v.id);
  const [inspections, repairs] = visitIds.length
    ? await Promise.all([
        guarded<InspectionRow[]>(() => untyped.from("inspection_evidence").select("id,service_visit_id,vin,inspected_at,source_app,technician_verified").eq("tenant_id", tenantId).in("service_visit_id", visitIds)),
        guarded<RepairRow[]>(() => untyped.from("repair_items").select("id,service_visit_id,vin,item,severity,status").eq("tenant_id", tenantId).in("service_visit_id", visitIds)),
      ])
    : [{ data: [] as InspectionRow[], missing: false, failed: false }, { data: [] as RepairRow[], missing: false, failed: false }];

  const inboxCounts = statusCounts.every((c) => c.data !== null)
    ? Object.fromEntries(INBOX_STATUSES.map((s, i) => [s, statusCounts[i].data as number]))
    : null;
  const capRow = settings.settings?.find((s) => s.key === "integration.replay_max_batch");
  const missing = [scan, openReviews, held, unmatched, quarantineOpen, dead, reviews, visits, inbox, quarantine].some((g) => g.missing) || settings.missing;
  const capped = (scan.data?.length ?? 0) >= VEHICLE_SCAN_LIMIT;

  return {
    missing,
    counts: {
      vehicles: scan.data ? new Set(scan.data.map((r) => r.vin)).size : null,
      vehiclesAtLeast: capped,
      openReturns: openReviews.data,
      awaitingMatch: awaiting,
      deadLetters: dead.data,
    },
    reviews: reviews.data,
    visits: visits.data,
    inspections: inspections.data ?? [],
    repairs: repairs.data ?? [],
    inbox: inbox.data,
    inboxCounts,
    quarantine: quarantine.data,
    settings: settings.settings,
    replayCap: typeof capRow?.effective_value === "number" ? capRow.effective_value : null,
  };
}

function sumKnownG(a: Guarded<number>, b: Guarded<number>): Guarded<number> {
  return { data: sumKnown(a, b), missing: a.missing || b.missing, failed: a.failed || b.failed };
}

export async function lookupVehicle(tenantId: string, query: string): Promise<LookupResult> {
  const q = query.trim().toUpperCase();
  if (!q) return { kind: "none" };
  let vins: string[];
  if (VIN_PATTERN.test(q)) {
    vins = [q];
  } else {
    const byStock = await guarded<Array<{ vin: string }>>(() => untyped.from("vehicle_files").select("vin").eq("tenant_id", tenantId).ilike("stock_number", q).limit(5));
    if (byStock.data === null) return { kind: "error" };
    vins = Array.from(new Set(byStock.data.map((r) => r.vin)));
    if (!vins.length) return { kind: "none" };
  }
  const [episodes, visits] = await Promise.all([
    guarded<EpisodeRow[]>(() => untyped.from("vehicle_instances").select("id,vin,store_id,opened_reason,custody_state,status,acquired_at,disposed_at,created_at,previous_instance_id")
      .eq("tenant_id", tenantId).in("vin", vins).order("created_at", { ascending: true })),
    guarded<VisitRow[]>(() => untyped.from("service_visits").select("id,vin,instance_id,source_app,ro_number,opened_at,closed_at,odometer_value,odometer_unit,intake_verification,status")
      .eq("tenant_id", tenantId).in("vin", vins).order("opened_at", { ascending: true })),
  ]);
  if (episodes.missing || visits.missing) return { kind: "missing" };
  if (episodes.data === null || visits.data === null) return { kind: "error" };
  const ids = episodes.data.map((e) => e.id);
  let milestones: MilestoneRow[] = [];
  if (ids.length) {
    const m = await guarded<MilestoneRow[]>(() => untyped.from("vehicle_custody_milestones").select("id,instance_id,milestone,occurred_at").eq("tenant_id", tenantId).in("instance_id", ids).order("occurred_at", { ascending: true }));
    if (m.missing) return { kind: "missing" };
    if (m.data === null) return { kind: "error" };
    milestones = m.data;
  }
  const found: VehicleLookup[] = vins
    .map((vin) => ({
      vin,
      episodes: episodes.data!.filter((e) => e.vin === vin),
      milestones: milestones.filter((m) => episodes.data!.some((e) => e.id === m.instance_id && e.vin === vin)),
      visits: visits.data!.filter((v) => v.vin === vin),
    }))
    .filter((v) => v.episodes.length || v.visits.length);
  return found.length ? { kind: "found", vehicles: found } : { kind: "none" };
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { error } = (await untyped.rpc(fn, args)) as Reply<unknown>;
    if (error) return { ok: false, message: isMissingRelation(error) ? "Not installed in this environment: the vehicle history migration has not been applied." : rpcErrorMessage(error) };
    return { ok: true };
  } catch {
    return { ok: false, message: "The request did not reach the server. Nothing was changed." };
  }
}

export const resolveReappearance = (reviewId: string, decision: string, reason: string): Promise<ActionResult> =>
  callRpc("vehicle_history_resolve_reappearance", { p_review_id: reviewId, p_decision: decision, p_reason: reason });

export const replayInbox = (tenantId: string, ids: string[], reason: string): Promise<ActionResult> =>
  callRpc("integration_replay_inbox", { p_tenant: tenantId, p_ids: ids, p_reason: reason });

export const setTenantSetting = (tenantId: string, key: string, value: boolean | number, expectedVersion: number, reason: string): Promise<ActionResult> =>
  callRpc("vehicle_history_set_setting", { p_scope_type: "tenant", p_scope_id: tenantId, p_key: key, p_value: value, p_expected_version: expectedVersion, p_reason: reason });

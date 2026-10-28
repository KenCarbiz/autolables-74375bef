import { supabase } from "@/integrations/supabase/client";
import { knownCount, type CountValue } from "@/lib/admin/health";
import type { FeedConfigRow } from "@/lib/admin/integrations/feed";
import { outcomeForRun, type SyncErrorRow, type SyncRunRow } from "@/lib/admin/integrations/runs";
import type { CrawlFacts, ProviderEventRow } from "@/lib/admin/integrations/providers";
import type { CronLookup, JobLedger, LedgerFacts } from "@/lib/admin/integrations/jobs";
import { activityServerFilter, type ActivityKind, type AuditRow } from "@/lib/admin/integrations/activity";

// Read-only loaders for the health center. Every function returns a typed
// result that says when a read failed, so a view can render Unknown instead
// of zero. Nothing here is called on mount by anything but a query hook, and
// none of it writes or calls a provider. The write paths live at the bottom,
// each one reached only from an explicit, confirmed click.

type Query = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any; functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> } };
const db = (): Query => supabase as unknown as Query;

export const UNDEFINED_FUNCTION = "42883";

const isUndefinedFunction = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === UNDEFINED_FUNCTION || /does not exist|could not find the function/i.test(e.message ?? ""));
};

export async function countOf(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<CountValue> {
  try {
    const { count, error } = await q;
    if (error || count === null || count === undefined) return { kind: "failed" };
    return knownCount(count);
  } catch {
    return { kind: "failed" };
  }
}

const RUN_COLUMNS = "id, tenant_id, source, started_at, finished_at, status, num_found, seen, new_vehicles, updated_vehicles, prices_recorded, removed, http_status, matched_dealer, error_summary, raw";

export interface FeedConfigResult {
  config: FeedConfigRow | null;
  failed: boolean;
}

export async function loadFeedConfig(tenantId: string): Promise<FeedConfigResult> {
  try {
    const { data, error } = await db()
      .from("marketcheck_sync_config")
      .select("enabled, allowed, source, frequency, run_hour, day_of_week, max_vehicles, last_run_at, mc_scope_param, mc_scope_value, rooftop_name, rooftop_street, rooftop_zip, rooftop_verified_at, strict_rooftop, last_good_count, last_good_at, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { config: null, failed: true };
    return { config: (data as FeedConfigRow | null) ?? null, failed: false };
  } catch {
    return { config: null, failed: true };
  }
}

export interface LedgerHeads {
  latest: SyncRunRow | null;
  latestReal: SyncRunRow | null;
  lastSuccessAt: string | null;
  failed: boolean;
}

/** The newest run, the newest non-skip run and the whole-ledger last success. */
export async function loadLedgerHeads(tenantId: string): Promise<LedgerHeads> {
  try {
    const [latestRes, realRes, successAt] = await Promise.all([
      db().from("inventory_sync_runs").select(RUN_COLUMNS).eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      db().from("inventory_sync_runs").select(RUN_COLUMNS).eq("tenant_id", tenantId).neq("status", "skipped").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      loadLastSuccessAt(tenantId),
    ]);
    const failed = !!latestRes.error || !!realRes.error || successAt.failed;
    return { latest: (latestRes.data as SyncRunRow | null) ?? null, latestReal: (realRes.data as SyncRunRow | null) ?? null, lastSuccessAt: successAt.at, failed };
  } catch {
    return { latest: null, latestReal: null, lastSuccessAt: null, failed: true };
  }
}

/** `admin_feed_last_success` when the migration exists; the ledger itself otherwise. Never a page window. */
export async function loadLastSuccessAt(tenantId: string): Promise<{ at: string | null; failed: boolean }> {
  try {
    const rpc = await db().rpc("admin_feed_last_success", { p_tenant_id: tenantId });
    if (!rpc.error) return { at: typeof rpc.data === "string" ? rpc.data : null, failed: false };
    if (!isUndefinedFunction(rpc.error)) return { at: null, failed: true };
  } catch {
    return { at: null, failed: true };
  }
  try {
    const { data, error } = await db().from("inventory_sync_runs").select("started_at").eq("tenant_id", tenantId).in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return { at: null, failed: true };
    return { at: (data as { started_at: string } | null)?.started_at ?? null, failed: false };
  } catch {
    return { at: null, failed: true };
  }
}

export interface RunsPage {
  rows: SyncRunRow[];
  total: number | null;
  failed: boolean;
}

export async function loadRunsPage(tenantId: string, page: number, size: number): Promise<RunsPage> {
  const from = Math.max(0, (page - 1) * size);
  try {
    const { data, count, error } = await db().from("inventory_sync_runs").select(RUN_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).order("started_at", { ascending: false }).range(from, from + size - 1);
    if (error) return { rows: [], total: null, failed: true };
    return { rows: (data as SyncRunRow[]) ?? [], total: typeof count === "number" ? count : null, failed: false };
  } catch {
    return { rows: [], total: null, failed: true };
  }
}

export interface RunDetail {
  run: SyncRunRow | null;
  failed: boolean;
  errors: SyncErrorRow[];
  errorsFailed: boolean;
}

export async function loadRun(runId: string): Promise<RunDetail> {
  try {
    const { data, error } = await db().from("inventory_sync_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
    if (error) return { run: null, failed: true, errors: [], errorsFailed: true };
    const run = (data as SyncRunRow | null) ?? null;
    if (!run) return { run: null, failed: false, errors: [], errorsFailed: false };
    const errs = await db().from("inventory_sync_errors").select("id, vin, code, message, created_at").eq("sync_run_id", runId).order("created_at", { ascending: true }).limit(500);
    return { run, failed: false, errors: errs.error ? [] : ((errs.data as SyncErrorRow[]) ?? []), errorsFailed: !!errs.error };
  } catch {
    return { run: null, failed: true, errors: [], errorsFailed: true };
  }
}

export interface InventoryCounts {
  active: CountValue;
  new: CountValue;
  used: CountValue;
  cpo: CountValue;
}

const activeListings = (tenantId: string) => db().from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).neq("status", "archived");

export async function loadInventoryCounts(tenantId: string): Promise<InventoryCounts> {
  const [active, nw, used, cpo] = await Promise.all([
    countOf(activeListings(tenantId)),
    countOf(activeListings(tenantId).eq("condition", "new")),
    countOf(activeListings(tenantId).eq("condition", "used")),
    countOf(activeListings(tenantId).eq("condition", "cpo")),
  ]);
  return { active, new: nw, used, cpo };
}

export async function loadProviderEvents(tenantId: string, sinceIso: string): Promise<ProviderEventRow[] | null> {
  try {
    const { data, error } = await db().from("provider_call_events").select("at, product, outcome, http_status").eq("tenant_id", tenantId).gte("at", sinceIso).order("at", { ascending: false }).limit(2000);
    if (error) return null;
    return (data as ProviderEventRow[]) ?? [];
  } catch {
    return null;
  }
}

export async function loadCrawlFacts(tenantId: string): Promise<CrawlFacts | null> {
  try {
    const { data, count, error } = await db().from("advertised_price_crawl_attempts").select("outcome, last_attempt_at, resolved_at", { count: "exact" }).eq("tenant_id", tenantId).order("last_attempt_at", { ascending: false }).limit(200);
    if (error) return null;
    const rows = (data as Array<{ outcome: string | null; last_attempt_at: string | null; resolved_at: string | null }>) ?? [];
    const captured = rows.find((r) => r.outcome === "captured");
    return {
      lastAttemptAt: rows[0]?.last_attempt_at ?? null,
      lastOutcome: rows[0]?.outcome ?? null,
      lastSuccessAt: captured ? captured.resolved_at ?? captured.last_attempt_at : null,
      attempts: typeof count === "number" ? count : rows.length,
    };
  } catch {
    return null;
  }
}

const DAY_MS = 86_400_000;

export async function loadDataQualityCounts(tenantId: string, now: number): Promise<Record<string, CountValue>> {
  const sevenDaysAgo = new Date(now - 7 * DAY_MS).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS).toISOString();
  const [source_conflicts, price_mismatch, price_missing, market_stale, enrich_missing, recall_unknown, recall_stale, descriptions_blocked] = await Promise.all([
    countOf(db().from("vehicle_exceptions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["open", "in_progress"])),
    countOf(activeListings(tenantId).eq("price_parse_status", "warning")),
    countOf(activeListings(tenantId).is("advertised_price_before_doc", null).not("price", "is", null)),
    countOf(activeListings(tenantId).or(`market_checked_at.is.null,market_checked_at.lt.${sevenDaysAgo}`)),
    countOf(activeListings(tenantId).is("enriched_at", null)),
    countOf(activeListings(tenantId).is("recall_status", null)),
    countOf(activeListings(tenantId).not("recall_checked_at", "is", null).lt("recall_checked_at", thirtyDaysAgo)),
    countOf(db().from("description_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["failed", "failed_blocked"])),
  ]);
  return { source_conflicts, price_mismatch, price_missing, market_stale, enrich_missing, recall_unknown, recall_stale, descriptions_blocked };
}

export interface JobStatusResult {
  cron: Record<string, CronLookup>;
  /** Ledger facts the server already joined, keyed by cron name; only from `admin_job_status`. */
  serverLedger: Record<string, LedgerFacts>;
  source: "admin_job_status" | "get_cron_job_status" | "unavailable";
}

interface AdminJobStatusRow {
  job: string;
  schedule: string | null;
  active: boolean | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_outcome: string | null;
  scope?: string | null;
}

/**
 * `admin_job_status` when the migration exists; otherwise the per-job cron
 * read, which the server restricts to platform admins; otherwise unavailable.
 */
export async function loadJobStatus(tenantId: string, cronNames: readonly string[], isAdmin: boolean): Promise<JobStatusResult> {
  const unavailable = (): JobStatusResult => ({ cron: Object.fromEntries(cronNames.map((n) => [n, "unavailable" as const])), serverLedger: {}, source: "unavailable" });
  try {
    const rpc = await db().rpc("admin_job_status", { p_tenant_id: tenantId });
    if (!rpc.error) {
      const rows = (Array.isArray(rpc.data) ? rpc.data : []) as AdminJobStatusRow[];
      const cron: Record<string, CronLookup> = {};
      const serverLedger: Record<string, LedgerFacts> = {};
      for (const name of cronNames) {
        const row = rows.find((r) => r.job === name);
        cron[name] = row ? { jobname: row.job, schedule: row.schedule, active: row.active, last_status: row.last_outcome, last_message: null, last_start: row.last_attempt_at, last_end: null } : null;
        if (row && (row.last_attempt_at || row.last_success_at)) serverLedger[name] = { lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at, lastOutcome: row.last_outcome };
      }
      return { cron, serverLedger, source: "admin_job_status" };
    }
    if (!isUndefinedFunction(rpc.error)) return unavailable();
  } catch {
    return unavailable();
  }
  if (!isAdmin) return unavailable();
  const cron: Record<string, CronLookup> = {};
  await Promise.all(cronNames.map(async (name) => {
    try {
      const { data, error } = await db().rpc("get_cron_job_status", { _jobname: name });
      if (error) { cron[name] = "unavailable"; return; }
      const row = (Array.isArray(data) ? data[0] : data) as { jobname?: string; schedule?: string | null; active?: boolean | null; last_status?: string | null; last_message?: string | null; last_start?: string | null; last_end?: string | null } | null;
      cron[name] = row && row.jobname ? { jobname: row.jobname, schedule: row.schedule ?? null, active: row.active ?? null, last_status: row.last_status ?? null, last_message: row.last_message ?? null, last_start: row.last_start ?? null, last_end: row.last_end ?? null } : null;
    } catch {
      cron[name] = "unavailable";
    }
  }));
  return { cron, serverLedger: {}, source: "get_cron_job_status" };
}

const latestStamp = async (table: string, tenantId: string, column: string): Promise<string | null | "failed"> => {
  try {
    const { data, error } = await db().from(table).select(column).eq("tenant_id", tenantId).not(column, "is", null).order(column, { ascending: false }).limit(1).maybeSingle();
    if (error) return "failed";
    const v = (data as Record<string, unknown> | null)?.[column];
    return typeof v === "string" ? v : null;
  } catch {
    return "failed";
  }
};

export type JobLedgers = Partial<Record<Exclude<JobLedger, null>, LedgerFacts | null>>;

/** Per-rooftop execution evidence for the jobs that leave a ledger here. */
export async function loadJobLedgers(tenantId: string, heads: LedgerHeads, crawl: CrawlFacts | null): Promise<JobLedgers> {
  const syncOutcome = heads.latestReal ? outcomeForRun(heads.latestReal) : null;
  const inventory_sync: LedgerFacts | null = heads.failed
    ? null
    : { lastAttemptAt: heads.latestReal?.started_at ?? null, lastSuccessAt: heads.lastSuccessAt, lastOutcome: syncOutcome === null ? null : syncOutcome === "success" || syncOutcome === "partial" ? "succeeded" : "failed" };
  const crawlFacts: LedgerFacts | null = crawl ? { lastAttemptAt: crawl.lastAttemptAt, lastSuccessAt: crawl.lastSuccessAt, lastOutcome: crawl.lastOutcome === null ? null : crawl.lastOutcome === "captured" ? "succeeded" : "failed" } : null;

  const [enrichedAt, recallAt, descLatest, descSuccess, escalation] = await Promise.all([
    latestStamp("vehicle_listings", tenantId, "enriched_at"),
    latestStamp("vehicle_listings", tenantId, "recall_checked_at"),
    (async () => {
      try {
        const { data, error } = await db().from("description_jobs").select("status, started_at, completed_at, failed_at, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (error) return "failed" as const;
        return (data as { status: string | null; started_at: string | null; completed_at: string | null; failed_at: string | null; created_at: string } | null) ?? null;
      } catch {
        return "failed" as const;
      }
    })(),
    (async () => {
      try {
        const { data, error } = await db().from("description_jobs").select("completed_at").eq("tenant_id", tenantId).in("status", ["succeeded", "approved"]).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle();
        if (error) return "failed" as const;
        return (data as { completed_at: string | null } | null)?.completed_at ?? null;
      } catch {
        return "failed" as const;
      }
    })(),
    (async () => {
      try {
        const { data, error } = await db().from("audit_log").select("created_at").eq("store_id", tenantId).ilike("action", "%escalat%").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (error) return "failed" as const;
        return (data as { created_at: string } | null)?.created_at ?? null;
      } catch {
        return "failed" as const;
      }
    })(),
  ]);

  const stampFacts = (v: string | null | "failed"): LedgerFacts | null => (v === "failed" ? null : { lastAttemptAt: v, lastSuccessAt: v, lastOutcome: v ? "succeeded" : null });
  const description: LedgerFacts | null = descLatest === "failed" || descSuccess === "failed"
    ? null
    : {
        lastAttemptAt: descLatest ? descLatest.started_at ?? descLatest.created_at : null,
        lastSuccessAt: descSuccess,
        lastOutcome: descLatest?.status ? (descLatest.status === "succeeded" || descLatest.status === "approved" ? "succeeded" : descLatest.status.startsWith("failed") ? "failed" : descLatest.status) : null,
      };

  return { inventory_sync, crawl: crawlFacts, enrich: stampFacts(enrichedAt), recall: stampFacts(recallAt), description, escalation: stampFacts(escalation) };
}

export interface ActivityPage {
  rows: AuditRow[];
  total: number | null;
  failed: boolean;
}

export async function loadActivityPage(tenantId: string, page: number, size: number, kind: ActivityKind | "all"): Promise<ActivityPage> {
  const from = Math.max(0, (page - 1) * size);
  try {
    let q = db().from("audit_log").select("id, action, entity_type, entity_id, user_id, user_email, created_at, details", { count: "exact" }).eq("store_id", tenantId);
    const filter = activityServerFilter(kind);
    if (filter) q = q.or(filter);
    const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, from + size - 1);
    if (error) return { rows: [], total: null, failed: true };
    return { rows: (data as AuditRow[]) ?? [], total: typeof count === "number" ? count : null, failed: false };
  } catch {
    return { rows: [], total: null, failed: true };
  }
}

// ── Explicit actions (click paths only) ───────────────────────────────────

export async function loadActivityExport(tenantId: string): Promise<AuditRow[] | null> {
  try {
    const { data, error } = await db().from("audit_log").select("id, action, entity_type, entity_id, user_id, user_email, created_at, details").eq("store_id", tenantId).order("created_at", { ascending: false }).limit(2000);
    if (error) return null;
    return (data as AuditRow[]) ?? [];
  } catch {
    return null;
  }
}

export interface ChainVerification {
  total: number;
  verified: number;
  firstBreakId: string | null;
  firstBreakAt: string | null;
}

export async function verifyAuditChain(storeId: string): Promise<{ result: ChainVerification | null; error: string | null }> {
  try {
    const { data, error } = await db().rpc("verify_audit_chain", { _store_id: storeId });
    if (error) return { result: null, error: (error as { message?: string }).message ?? "Verification failed" };
    const row = (Array.isArray(data) ? data[0] : data) as { total?: number; verified?: number; first_break_id?: string | null; first_break_at?: string | null } | null;
    if (!row) return { result: { total: 0, verified: 0, firstBreakId: null, firstBreakAt: null }, error: null };
    return { result: { total: row.total ?? 0, verified: row.verified ?? 0, firstBreakId: row.first_break_id ?? null, firstBreakAt: row.first_break_at ?? null }, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : "Verification failed" };
  }
}

export interface FeedConfigDraft {
  enabled: boolean;
  source: string;
  frequency: string;
  day_of_week: number;
  run_hour: number;
  max_vehicles: number;
}

/** The existing writer. The directory id is cleared on save, as the legacy card did, so a stale id is never reused. */
export async function saveFeedConfig(tenantId: string, draft: FeedConfigDraft): Promise<{ error: string | null }> {
  const base = { _tenant_id: tenantId, _enabled: draft.enabled, _source: draft.source.trim(), _max_vehicles: draft.max_vehicles, _frequency: draft.frequency, _day_of_week: draft.day_of_week, _run_hour: draft.run_hour };
  try {
    let { error } = await db().rpc("save_marketcheck_config", { ...base, _dealer_id: "" });
    if (error && /save_marketcheck_config|function|does not exist|argument/i.test((error as { message?: string }).message ?? "")) {
      ({ error } = await db().rpc("save_marketcheck_config", base));
    }
    return { error: error ? ((error as { message?: string }).message ?? "Save failed") : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function clearFeedScope(tenantId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await db().rpc("marketcheck_clear_scope", { _tenant_id: tenantId });
    return { error: error ? ((error as { message?: string }).message ?? "Clear failed") : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Clear failed" };
  }
}

export interface ManualRunResult {
  ok: boolean;
  message: string;
}

export async function runFeedNow(tenantId: string): Promise<ManualRunResult> {
  try {
    const { data, error } = await db().functions.invoke("marketcheck-sync", { body: { tenant_id: tenantId, force: true } });
    if (error) return { ok: false, message: "The run could not be started. The ledger will show the attempt if the provider was reached." };
    const r = (data ?? {}) as { error?: string; listings_seen?: number; new_vehicles?: number; prices_recorded?: number };
    if (r.error === "not_configured") return { ok: false, message: "The provider credential is not configured on the server." };
    if (r.error) return { ok: false, message: `The provider did not complete the run (${r.error}). Open the newest run for details.` };
    return { ok: true, message: `Run finished: ${r.listings_seen ?? 0} seen, ${r.new_vehicles ?? 0} new, ${r.prices_recorded ?? 0} prices recorded.` };
  } catch {
    return { ok: false, message: "The run could not be started." };
  }
}

// ──────────────────────────────────────────────────────────────────────
// packet-backfill — reconcile the OEM half of the customer packet across
// inventory that is ALREADY published.
//
// Why this exists. The OEM Monroney pull and the OEM brochure / owner's-manual
// harvests are wired at INGEST and nowhere else. intake-autoprovision fires
// oem-window-sticker once for a genuinely new VIN and states plainly that it is
// "fired once at ingest and retried by nothing"; the two link harvests only
// ever run when a human presses a button on the Vehicle File. So a dealer with
// 120 live cars sees nothing change on a single one of them until each car
// happens to re-ingest — which, for a car that arrived by CSV import, DMS
// webhook or manual add, is never.
//
// What it does NOT do. The Factory Window Sticker record has its own sweep
// (factory-sticker-orchestrate `orchestrate_sweep`, cron 08:40-08:55) and the
// compliance forms have theirs (generate-vehicle-forms `sweep`, cron
// 09:10-09:25). This function deliberately does not reach into either; it fills
// only what nothing else retries.
//
// Spend posture. Provider spend on this platform has been cut deliberately —
// incentives disabled, mc-probe deleted, title reports manual-only and capped.
// This sweep is built to match:
//
//   * Cache-first. A triple the link cache already answers, judged by the same
//     nearest-year rule public-listing-view applies, costs zero calls.
//   * Negative-cached. A VIN the provider has already answered "no" for is
//     stamped and never charged again. A triple that came back empty is
//     recorded and re-asked at most LINK_MAX_ATTEMPTS times, ever.
//   * Hard per-run budgets, separate for money (provider calls) and for fan-out
//     (invocations), and every cap reports what it deferred. Silent truncation
//     reads as "covered everything", which is how a half-done backfill gets
//     signed off.
//   * Single-runner, via the expiry-based service lock — two overlapping runs
//     would pay twice for one answer.
//
// Body (all optional):
//   tenant_id            scope to one dealer; omitted = every dealer (cron)
//   limit                published listings examined      (default 500, max 2000)
//   sticker_limit        paid Monroney pulls this run     (default 20, 0 disables)
//   link_limit           harvests that may reach Firecrawl(default 8, 0 disables)
//   link_dispatch_limit  harvest invocations whatever the outcome (default 40)
//   recheck_after_days   re-open VINs last checked this long ago (default 0=never)
//   kinds                ["brochure"] / ["owners_manual"] to run one half
//   force                ignore the negative cache for link triples
//   sync                 run inline and return the tally instead of acking
// ──────────────────────────────────────────────────────────────────────

import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron, SERVICE_KEY, SUPABASE_URL } from "../_shared/supabase.ts";
import { invokeFunction, mapWithConcurrency } from "../_shared/invoke.ts";
import {
  PACKET_BACKFILL_LOCK_KEY, LOCK_TTL_SECONDS, SWEEP_BUDGET_MS,
  DEFAULT_VEHICLE_LIMIT, MAX_VEHICLE_LIMIT,
  DEFAULT_STICKER_BUDGET, MAX_STICKER_BUDGET,
  DEFAULT_LINK_PROVIDER_BUDGET, MAX_LINK_PROVIDER_BUDGET,
  DEFAULT_LINK_DISPATCH_CAP, MAX_LINK_DISPATCH_CAP,
  CATALOG_FETCH_LIMIT, LINK_KINDS,
  clampInt, selectStickerTargets, selectLinkTargets, interleaveByTenant,
  classifyHarvest, classifySticker, harvestChargesProvider, stickerChargesProvider,
  persistedLinkOutcome, stickerStampsChecked, describeTruncation,
  type ListingRow, type CatalogRow, type AttemptRow, type LinkKind,
  type LinkTarget, type StickerTarget,
} from "../_shared/packetBackfill.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

const LISTING_COLUMNS = "id, tenant_id, vin, ymm, oem_sticker_url, oem_sticker_checked_at";

// Low and paced on purpose. Every call below reaches a paid provider or
// Firecrawl; the throttle these sweeps used to provoke was caused by fanning
// invocations into one tick, and pacing the dispatch is the durable fix.
const STICKER_CONCURRENCY = 2;
const STICKER_GAP_MS = 250;
const LINK_CONCURRENCY = 2;
const LINK_GAP_MS = 400;

const HARVEST_FUNCTION: Record<LinkKind, string> = {
  brochure: "oem-brochure",
  owners_manual: "oem-owners-manual",
};

const tally = () => ({} as Record<string, number>);
const bump = (t: Record<string, number>, key: string) => { t[key] = (t[key] || 0) + 1; };

async function loadListings(admin: Admin, tenantId: string | null, limit: number): Promise<ListingRow[]> {
  let q = admin.from("vehicle_listings")
    .select(LISTING_COLUMNS)
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new Error(`listing_query_failed: ${error.message}`);
  return (data || []) as ListingRow[];
}

/**
 * The link tables and the attempt cache are global catalogues keyed on
 * (make, model, year), not on tenant, so they are pulled once per run and
 * matched in memory. That is two queries instead of one per distinct make, and
 * it is what lets the coverage rule be an exact copy of the passport's rather
 * than an approximation expressible in PostgREST filters.
 */
async function loadCatalog(admin: Admin, table: string): Promise<{ rows: CatalogRow[]; truncated: boolean }> {
  const { data, error } = await admin.from(table)
    .select("make, model, year")
    .order("year", { ascending: false, nullsFirst: false })
    .limit(CATALOG_FETCH_LIMIT);
  if (error) throw new Error(`${table}_query_failed: ${error.message}`);
  const rows = (data || []) as CatalogRow[];
  return { rows, truncated: rows.length >= CATALOG_FETCH_LIMIT };
}

async function loadAttempts(admin: Admin): Promise<{ rows: AttemptRow[]; truncated: boolean }> {
  const { data, error } = await admin.from("oem_packet_backfill_attempts")
    .select("kind, make_key, model_key, year_key, outcome, attempts, last_attempt_at")
    .limit(CATALOG_FETCH_LIMIT);
  // A missing attempt table must not stop the sweep — it only means nothing is
  // negative-cached yet, and every budget cap still applies.
  if (error) return { rows: [], truncated: false };
  const rows = (data || []) as AttemptRow[];
  return { rows, truncated: rows.length >= CATALOG_FETCH_LIMIT };
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  // Service-role or cron only. This function spends money on every call it
  // makes; it must never be reachable with a dealer's own JWT.
  if (!isServiceOrCron(req)) return json(403, { error: "service_role_or_cron_required" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "missing_service_credentials" });

  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const admin = adminClient();

  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const limit = clampInt(body.limit, DEFAULT_VEHICLE_LIMIT, 1, MAX_VEHICLE_LIMIT);
  const stickerBudget = clampInt(body.sticker_limit, DEFAULT_STICKER_BUDGET, 0, MAX_STICKER_BUDGET);
  const linkBudget = clampInt(body.link_limit, DEFAULT_LINK_PROVIDER_BUDGET, 0, MAX_LINK_PROVIDER_BUDGET);
  const linkDispatchCap = clampInt(body.link_dispatch_limit, DEFAULT_LINK_DISPATCH_CAP, 0, MAX_LINK_DISPATCH_CAP);
  const recheckAfterDays = clampInt(body.recheck_after_days, 0, 0, 3650);
  const force = body.force === true;
  const kinds = Array.isArray(body.kinds)
    ? LINK_KINDS.filter((k) => (body.kinds as unknown[]).map(String).includes(k))
    : LINK_KINDS;

  let listings: ListingRow[];
  let brochureCatalog: CatalogRow[];
  let manualCatalog: CatalogRow[];
  let attempts: AttemptRow[];
  let catalogTruncated = false;
  try {
    listings = await loadListings(admin, tenantId, limit);
    const [b, m, a] = await Promise.all([
      loadCatalog(admin, "oem_brochure_links"),
      loadCatalog(admin, "oem_owners_manual_links"),
      loadAttempts(admin),
    ]);
    brochureCatalog = b.rows; manualCatalog = m.rows; attempts = a.rows;
    catalogTruncated = b.truncated || m.truncated || a.truncated;
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e).slice(0, 300) });
  }

  const now = Date.now();
  const stickerTargets = interleaveByTenant(
    selectStickerTargets(listings, { recheckAfterDays, now }), (t) => t.tenantId,
  );
  const linkTargets = interleaveByTenant(
    selectLinkTargets(listings, { brochureCatalog, manualCatalog, attempts, kinds, now, force }),
    (t) => t.tenantId,
  );

  const vehicleCapHit = listings.length >= limit;
  // Two different ceilings, deliberately. The money guard inside the worker is
  // authoritative and never exceeded; the plan is allowed a little headroom
  // above it so a run that meets a burst of platform throttles — which reach no
  // provider and are refunded — can still spend its budget on real work instead
  // of losing the night to a rate limit.
  const stickerDispatchCap = stickerBudget === 0 ? 0 : stickerBudget + Math.min(10, stickerBudget);
  const plannedStickers = stickerTargets.slice(0, stickerDispatchCap);
  const plannedLinks = linkTargets.slice(0, linkBudget === 0 ? 0 : linkDispatchCap);

  if (!plannedStickers.length && !plannedLinks.length) {
    const note = describeTruncation({
      vehicleCapHit, stickerTargets: stickerTargets.length, stickerAttempted: 0,
      stickerDeferred: stickerTargets.length, linkTargets: linkTargets.length,
      linkAttempted: 0, linkDeferred: linkTargets.length,
    });
    return json(200, {
      success: true, scope: tenantId || "all_tenants",
      vehicles_examined: listings.length, processed: 0,
      sticker_targets: stickerTargets.length, link_targets: linkTargets.length,
      catalog_truncated: catalogTruncated,
      note: note ?? "Nothing to backfill.",
    });
  }

  // Single-runner. Taken only once the worklist is known, so a failed query can
  // never leak the lock; expiry-based, because a pooled edge connection cannot
  // hold a session-scoped advisory lock.
  const { data: acquired } = await admin.rpc("try_acquire_service_lock", {
    _key: PACKET_BACKFILL_LOCK_KEY,
    _ttl_seconds: LOCK_TTL_SECONDS,
    _holder: tenantId || "all_tenants",
  });
  if (acquired === false) {
    return json(200, {
      success: true, skipped: "already_running",
      sticker_targets: stickerTargets.length, link_targets: linkTargets.length,
    });
  }

  const worker = async () => {
    const deadline = Date.now() + SWEEP_BUDGET_MS;
    const outcomes = tally();
    let stickerSpend = 0, stickerAttempted = 0, stickerFound = 0;
    let linkSpend = 0, linkAttempted = 0, linkFound = 0;
    let stickerProviderConfigured = true;
    let linkProviderConfigured = true;

    const recordAttempt = async (t: LinkTarget, outcome: string, detail: string | null) => {
      try {
        await admin.rpc("record_packet_backfill_attempt", {
          _kind: t.kind, _make: t.make, _model: t.model, _year: t.year,
          _outcome: outcome, _detail: detail ? detail.slice(0, 500) : null,
        });
      } catch { /* the negative cache is an optimisation, never a gate */ }
    };

    const runSticker = async (target: StickerTarget) => {
      if (Date.now() >= deadline || !stickerProviderConfigured) return;
      if (stickerSpend >= stickerBudget) return;
      // Reserved before the call so concurrent workers cannot both spend the
      // last unit; refunded below when nothing reached the provider.
      stickerSpend++;
      stickerAttempted++;
      const res = await invokeFunction(
        `${SUPABASE_URL}/functions/v1/oem-window-sticker`, SERVICE_KEY,
        { body: { vin: target.vin, tenant_id: target.tenantId, vehicle_id: target.vehicleId },
          timeoutMs: 30_000, maxRetries: 1, maxWaitMs: 3_000, deadlineMs: 40_000 },
      );
      const outcome = classifySticker(res);
      bump(outcomes, `sticker_${outcome}`);
      // A throttle taught us nothing and reached no provider, so it must not
      // burn the budget that exists to bound provider spend — the dispatch cap
      // above is what keeps the refund from becoming an unbounded retry loop.
      if (!stickerChargesProvider(outcome)) stickerSpend--;
      if (outcome === "found") stickerFound++;
      if (outcome === "not_configured") {
        stickerProviderConfigured = false;
        console.warn("packet-backfill: no window-sticker provider configured; skipping the sticker phase");
        return;
      }
      if (!stickerStampsChecked(outcome)) return;
      // The stamp IS the negative cache. oem-window-sticker only writes it on
      // success, so without this a VIN with no factory sticker on record is
      // re-purchased every night for as long as it stays in inventory. Guarded
      // on the url still being null so a concurrent success is never clobbered.
      try {
        await admin.from("vehicle_listings")
          .update({ oem_sticker_checked_at: new Date().toISOString() })
          .eq("id", target.vehicleId).is("oem_sticker_url", null);
      } catch { /* the budget still bounds the cost of failing to stamp */ }
    };

    const runLink = async (target: LinkTarget) => {
      if (Date.now() >= deadline || !linkProviderConfigured) return;
      if (linkSpend >= linkBudget) return;
      // Reserved before the call, refunded after, so two workers in flight can
      // never both slip past the last unit of budget.
      linkSpend++;
      linkAttempted++;
      const res = await invokeFunction(
        `${SUPABASE_URL}/functions/v1/${HARVEST_FUNCTION[target.kind]}`, SERVICE_KEY,
        { body: { make: target.make, model: target.model, year: target.year },
          timeoutMs: 60_000, maxRetries: 1, maxWaitMs: 3_000, deadlineMs: 75_000 },
      );
      const outcome = classifyHarvest(res);
      bump(outcomes, `${target.kind}_${outcome}`);
      // A cache hit and an unsupported make both return before oem-brochure
      // looks at its Firecrawl key, and a throttle never left our platform —
      // none of them may consume the budget that bounds provider spend. The
      // dispatch cap is what stops them fanning out without limit.
      if (!harvestChargesProvider(outcome)) linkSpend--;
      if (outcome === "found" || outcome === "cached") linkFound++;
      if (outcome === "not_configured") {
        linkProviderConfigured = false;
        console.warn("packet-backfill: no Firecrawl key configured; skipping the OEM link phase");
        return;
      }
      const persisted = persistedLinkOutcome(outcome);
      if (persisted) await recordAttempt(target, persisted, res.error);
    };

    try {
      // Per-target isolation: one bad VIN or one wedged OEM CDN must not end
      // the run for everything queued behind it.
      await mapWithConcurrency(plannedStickers, STICKER_CONCURRENCY,
        async (t) => { try { await runSticker(t); } catch (e) { bump(outcomes, "sticker_exception"); console.error("packet-backfill sticker", t.vin, e); } },
        { gapMs: STICKER_GAP_MS });
      await mapWithConcurrency(plannedLinks, LINK_CONCURRENCY,
        async (t) => { try { await runLink(t); } catch (e) { bump(outcomes, `${t.kind}_exception`); console.error("packet-backfill link", t.kind, t.make, t.model, e); } },
        { gapMs: LINK_GAP_MS });
    } finally {
      try { await admin.rpc("release_service_lock", { _key: PACKET_BACKFILL_LOCK_KEY }); }
      catch { /* the TTL expiry is the backstop */ }
    }

    const truncation = {
      vehicleCapHit,
      stickerTargets: stickerTargets.length, stickerAttempted,
      stickerDeferred: Math.max(0, stickerTargets.length - stickerAttempted),
      linkTargets: linkTargets.length, linkAttempted,
      linkDeferred: Math.max(0, linkTargets.length - linkAttempted),
    };
    const note = describeTruncation(truncation);
    if (note) console.warn(`packet-backfill: ${note}`);

    return {
      vehicles_examined: listings.length,
      sticker_targets: stickerTargets.length,
      sticker_attempted: stickerAttempted,
      sticker_found: stickerFound,
      sticker_provider_calls: stickerSpend,
      sticker_deferred: truncation.stickerDeferred,
      link_targets: linkTargets.length,
      link_attempted: linkAttempted,
      link_found: linkFound,
      link_provider_calls: linkSpend,
      link_deferred: truncation.linkDeferred,
      catalog_truncated: catalogTruncated,
      vehicle_cap_hit: vehicleCapHit,
      outcomes,
      note,
    };
  };

  if (body.sync === true) {
    const result = await worker();
    return json(200, { success: true, scope: tenantId || "all_tenants", ...result });
  }

  // cron's http_post and the admin button both have short deadlines a 90s
  // inline sweep blows past. Ack immediately and finish in the background.
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(worker());
  else worker();

  return json(200, {
    success: true, started: true, scope: tenantId || "all_tenants",
    vehicles_examined: listings.length,
    sticker_targets: stickerTargets.length, sticker_planned: plannedStickers.length,
    link_targets: linkTargets.length, link_planned: plannedLinks.length,
    budgets: { sticker: stickerBudget, link_provider: linkBudget, link_dispatch: linkDispatchCap },
    catalog_truncated: catalogTruncated,
    note: "Backfill running in background; re-invoke to see remaining.",
  });
});

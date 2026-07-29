// ──────────────────────────────────────────────────────────────────────
// Pure selection / budget / dedupe logic for the packet backfill sweep.
//
// The problem it exists for: the OEM half of the customer packet is wired at
// INGEST only. intake-autoprovision fires oem-window-sticker once per brand-new
// VIN and says so in its own comment — "fired once at ingest and retried by
// nothing" — and the OEM brochure / owner's-manual links are harvested only
// when a human presses a button on the Vehicle File. A dealer who was already
// live before those hooks existed therefore sees nothing change on a single one
// of their published cars until each car happens to re-ingest.
//
// This module decides, for inventory that is ALREADY published:
//   * which VINs still owe an OEM Monroney pull (per-VIN, PAID provider), and
//   * which (make, model, year) triples still owe a brochure / owner's-manual
//     harvest (per-TRIPLE, Firecrawl-backed, globally cached).
//
// Three properties the caller depends on:
//
//   1. Cache-first. A triple already answered by oem_brochure_links /
//      oem_owners_manual_links using the SAME resolution rule the passport
//      applies is never re-harvested, so a correct car costs zero calls. A
//      hundred cars usually collapse to a few dozen triples.
//   2. Negative caching. "We looked and there is nothing" is a result worth
//      keeping. Without it every night re-asks Firecrawl for the brochure that
//      does not exist, and re-asks VinAudit for the 2009 sticker that was never
//      digitised — which is exactly the silent recurring spend this codebase has
//      already been trimmed to avoid. A VIN is charged at most once, ever; a
//      triple at most LINK_MAX_ATTEMPTS times, ever.
//   3. Bounded. Provider spend per run is capped separately from invocation
//      count, because "the platform refused to call us" and "we paid for an
//      answer" must not consume the same budget.
//
// Runtime-free (no Deno, no network) so vitest can exercise it directly.
// ──────────────────────────────────────────────────────────────────────

import { oemDocKeyFromYmm } from "./oemDocKey.ts";

export const PACKET_BACKFILL_LOCK_KEY = "packet_backfill_sweep";
export const LOCK_TTL_SECONDS = 300;

/** Wall clock per invocation, matching the sibling sweeps. */
export const SWEEP_BUDGET_MS = 90_000;

export const DEFAULT_VEHICLE_LIMIT = 500;
export const MAX_VEHICLE_LIMIT = 2000;

/** Paid per-VIN Monroney pulls per run. */
export const DEFAULT_STICKER_BUDGET = 20;
export const MAX_STICKER_BUDGET = 200;

/** Harvests per run that could actually reach Firecrawl. */
export const DEFAULT_LINK_PROVIDER_BUDGET = 8;
export const MAX_LINK_PROVIDER_BUDGET = 60;

/**
 * Harvest invocations per run whatever the outcome. Separate from the provider
 * budget so a run that meets nothing but unsupported makes (free, no Firecrawl)
 * still cannot fan out an unbounded number of edge invocations.
 */
export const DEFAULT_LINK_DISPATCH_CAP = 40;
export const MAX_LINK_DISPATCH_CAP = 200;

/** Ceiling on the global link/attempt catalogues pulled into memory per run. */
export const CATALOG_FETCH_LIMIT = 5000;

/** A triple is never asked more times than this, across all runs. */
export const LINK_MAX_ATTEMPTS = 3;
/** An OEM can publish a brochure late; three tries spread over months is fair. */
export const LINK_NOT_FOUND_RETRY_DAYS = 45;
/** A 5xx or a timeout is not evidence of absence, so it retries sooner. */
export const LINK_ERROR_RETRY_DAYS = 1;

const DAY_MS = 86_400_000;

export type LinkKind = "brochure" | "owners_manual";
export const LINK_KINDS: readonly LinkKind[] = ["brochure", "owners_manual"];

export interface ListingRow {
  id: string;
  tenant_id: string | null;
  vin: string | null;
  ymm: string | null;
  oem_sticker_url?: string | null;
  oem_sticker_checked_at?: string | null;
}

export interface StickerTarget {
  vehicleId: string;
  tenantId: string;
  vin: string;
}

export interface LinkTarget {
  kind: LinkKind;
  make: string;
  model: string;
  year: number | null;
  tenantId: string;
  /** How many published vehicles this one harvest would serve. */
  vehicleCount: number;
}

/** A row of oem_brochure_links / oem_owners_manual_links. */
export interface CatalogRow {
  make: string | null;
  model: string | null;
  year: number | null;
}

export type AttemptOutcome = "found" | "not_found" | "unsupported" | "error";

/** A row of oem_packet_backfill_attempts. */
export interface AttemptRow {
  kind: string;
  make_key: string;
  model_key: string;
  year_key: number;
  outcome: string;
  attempts: number;
  last_attempt_at: string | null;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export const isVin = (vin: unknown): boolean => VIN_RE.test(String(vin ?? "").toUpperCase());

export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * The (make, model, year) this vehicle's OEM links are filed under, or null.
 *
 * Deliberately NOT a local copy. `oemDocKeyFromYmm` is the one derivation the
 * ingest wiring already harvests under, and it reproduces public-listing-view's
 * naive split verbatim — second word is the make, the rest is the model. A
 * backfill that keyed vehicles any other way would either re-harvest triples
 * ingest has already filed, or file rows under a key the passport never
 * queries. Both cost money and neither shows the shopper anything.
 */
export const packetLinkKeyFor = oemDocKeyFromYmm;

const norm = (s: string | null | undefined): string => String(s ?? "").trim().toLowerCase();

/** Stable key for one (kind, make, model, year) triple. Year-less is 0. */
export function linkKey(kind: LinkKind, make: string, model: string, year: number | null): string {
  return `${kind}|${norm(make)}|${norm(model)}|${year ?? 0}`;
}

export function attemptKey(row: AttemptRow): string {
  return `${row.kind}|${norm(row.make_key)}|${norm(row.model_key)}|${row.year_key ?? 0}`;
}

/**
 * Does the harvest cache already answer this vehicle?
 *
 * Mirrors public-listing-view's pick, step for step, including the final
 * year-less fallback: the harvest legitimately falls back to a make's
 * "Manuals & Guides" portal, which carries no year, and the passport treats
 * that row as covering every year. If we used a stricter rule here we would
 * re-harvest a triple the shopper can already see.
 */
export function catalogCovers(
  rows: readonly CatalogRow[], make: string, model: string, year: number | null,
): boolean {
  const mk = norm(make), md = norm(model);
  if (!mk || !md) return false;
  const candidates = rows.filter((r) => norm(r.make) === mk && norm(r.model) === md);
  if (!candidates.length) return false;
  if (year == null) return true;
  if (candidates.some((r) => r.year === year)) return true;
  if (candidates.some((r) => r.year != null && Math.abs(r.year - year) <= 2)) return true;
  return candidates.some((r) => r.year == null);
}

export interface AttemptPolicyOptions {
  now?: number;
  force?: boolean;
  maxAttempts?: number;
}

/**
 * May we spend another harvest on this triple?
 *
 * `found` and `unsupported` are terminal. `unsupported` is deliberately sticky:
 * a make absent from the OEM domain allow-list does not appear overnight, it
 * appears in a deploy, and an admin can force a re-ask when it does.
 */
export function shouldAttemptLink(
  attempt: AttemptRow | undefined, opts: AttemptPolicyOptions = {},
): boolean {
  const { now = Date.now(), force = false, maxAttempts = LINK_MAX_ATTEMPTS } = opts;
  if (force) return true;
  if (!attempt) return true;
  if (attempt.outcome === "found" || attempt.outcome === "unsupported") return false;
  if ((attempt.attempts ?? 0) >= maxAttempts) return false;

  const last = Date.parse(attempt.last_attempt_at || "");
  // An unreadable timestamp is not a licence to re-spend every run.
  if (!Number.isFinite(last)) return false;
  const waitDays = attempt.outcome === "error" ? LINK_ERROR_RETRY_DAYS : LINK_NOT_FOUND_RETRY_DAYS;
  return now - last >= waitDays * DAY_MS;
}

export interface StickerSelectionOptions {
  /**
   * Re-open a VIN whose last check found nothing, this many days on. Default 0
   * — never. A VIN that came back empty is charged exactly once, ever, because
   * a 2009 trade-in does not acquire a Monroney label by waiting.
   */
  recheckAfterDays?: number;
  now?: number;
}

/**
 * VINs on published inventory with no OEM sticker on file and no record of ever
 * having been asked.
 *
 * `oem_sticker_checked_at` is the negative cache. oem-window-sticker only
 * stamps it on success, so the sweep stamps it itself on a confirmed miss —
 * see the caller. Without that stamp this selection would return the same
 * un-stickered VINs every single night and be billed for them every single
 * night.
 */
export function selectStickerTargets(
  listings: readonly ListingRow[], opts: StickerSelectionOptions = {},
): StickerTarget[] {
  const { recheckAfterDays = 0, now = Date.now() } = opts;
  const out: StickerTarget[] = [];
  const seen = new Set<string>();
  for (const row of listings) {
    const tenantId = String(row.tenant_id || "");
    const vin = String(row.vin || "").toUpperCase();
    if (!tenantId || !isVin(vin)) continue;
    if (String(row.oem_sticker_url || "").trim()) continue;

    const checked = row.oem_sticker_checked_at ? Date.parse(row.oem_sticker_checked_at) : NaN;
    if (Number.isFinite(checked)) {
      if (recheckAfterDays <= 0) continue;
      if (now - checked < recheckAfterDays * DAY_MS) continue;
    }
    // One dealer listing the same VIN twice must not be billed twice.
    const dedupe = `${tenantId}|${vin}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ vehicleId: String(row.id), tenantId, vin });
  }
  return out;
}

export interface LinkSelectionOptions {
  brochureCatalog: readonly CatalogRow[];
  manualCatalog: readonly CatalogRow[];
  attempts: readonly AttemptRow[];
  kinds?: readonly LinkKind[];
  now?: number;
  force?: boolean;
}

/**
 * Distinct (kind, make, model, year) triples that neither the link cache nor
 * the attempt cache already answers, ordered so the highest-leverage harvest
 * (the triple covering the most cars) comes first.
 */
export function selectLinkTargets(
  listings: readonly ListingRow[], opts: LinkSelectionOptions,
): LinkTarget[] {
  const { brochureCatalog, manualCatalog, attempts, kinds = LINK_KINDS, now = Date.now(), force = false } = opts;
  const attemptIndex = new Map<string, AttemptRow>();
  for (const a of attempts) attemptIndex.set(attemptKey(a), a);

  const catalogFor = (kind: LinkKind) => (kind === "brochure" ? brochureCatalog : manualCatalog);
  const grouped = new Map<string, LinkTarget>();

  for (const row of listings) {
    const tenantId = String(row.tenant_id || "");
    if (!tenantId) continue;
    // A ymm with no leading model year yields a key whose "make" is really the
    // model, so every link derived from it is wrong. Ingest refuses those; so
    // does the backfill, rather than paying to file a row nothing will read.
    const key = packetLinkKeyFor(row.ymm);
    if (!key) continue;
    const { year, make, model } = key;

    for (const kind of kinds) {
      const key = linkKey(kind, make, model, year);
      const existing = grouped.get(key);
      if (existing) { existing.vehicleCount++; continue; }
      if (catalogCovers(catalogFor(kind), make, model, year)) continue;
      if (!shouldAttemptLink(attemptIndex.get(key), { now, force })) continue;
      grouped.set(key, { kind, make, model, year, tenantId, vehicleCount: 1 });
    }
  }

  return [...grouped.values()].sort(
    (a, b) => b.vehicleCount - a.vehicleCount || a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
  );
}

/**
 * Round-robin across tenants, preserving each tenant's own order.
 *
 * Without this a single dealer whose whole inventory predates the ingest hooks
 * consumes every run's budget and every other dealer waits for that backlog to
 * drain. Nightly fairness matters more here than absolute throughput, because
 * the budget is small on purpose.
 */
export function interleaveByTenant<T>(items: readonly T[], tenantOf: (item: T) => string): T[] {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const key = tenantOf(item);
    const lane = lanes.get(key);
    if (lane) lane.push(item);
    else lanes.set(key, [item]);
  }
  const queues = [...lanes.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    let moved = false;
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); moved = true; }
    }
    if (!moved) break;
  }
  return out;
}

// ── Provider-response classification ──────────────────────────────────
// invokeFunction never throws and hands back { ok, status, data, error,
// rateLimited }. These turn that into a decision about (a) whether money was
// spent and (b) what, if anything, to write into the negative cache.

export interface InvokeLike {
  ok: boolean;
  status: number;
  data: unknown;
  error: string | null;
  rateLimited: boolean;
}

export type HarvestOutcome =
  | "found" | "cached" | "not_found" | "unsupported" | "not_configured" | "rate_limited" | "error";

export function classifyHarvest(res: InvokeLike): HarvestOutcome {
  // A throttle is the platform declining to call the function at all, so no
  // provider was reached and nothing was learned about this triple.
  if (res.rateLimited) return "rate_limited";
  if (res.ok) {
    const d = (res.data ?? {}) as { ok?: boolean; cached?: boolean; error?: string };
    if (d.error === "not_configured") return "not_configured";
    if (d.ok === true) return d.cached === true ? "cached" : "found";
    return "error";
  }
  const text = `${res.status} ${res.error ?? ""}`;
  if (text.includes("make_not_supported")) return "unsupported";
  if (/brochure_not_found|manual_not_found|brochure_unreachable|manual_unreachable/.test(text)) {
    return "not_found";
  }
  return "error";
}

export type StickerOutcome = "found" | "miss" | "not_configured" | "rate_limited" | "error";

export function classifySticker(res: InvokeLike): StickerOutcome {
  if (res.rateLimited) return "rate_limited";
  if (!res.ok) return "error";
  const d = (res.data ?? {}) as { ok?: boolean; error?: string };
  if (d.ok === true) return "found";
  if (d.error === "not_configured") return "not_configured";
  // Anything else on a 200 is the provider answering "no sticker for this VIN"
  // — which it was paid to answer.
  return "miss";
}

/**
 * Did this outcome consume a paid provider call?
 *
 * `cached` and `unsupported` both return before oem-brochure looks at its
 * Firecrawl key, `not_configured` means there is no key at all, and
 * `rate_limited` never left our own platform. Charging those would make the
 * budget bound the wrong thing — but note they are all still charged against
 * the dispatch cap, so they cannot fan out without limit either.
 */
export function harvestChargesProvider(outcome: HarvestOutcome): boolean {
  return outcome === "found" || outcome === "not_found" || outcome === "error";
}

export function stickerChargesProvider(outcome: StickerOutcome): boolean {
  return outcome === "found" || outcome === "miss" || outcome === "error";
}

/** What to write into the attempt cache, or null to leave it untouched. */
export function persistedLinkOutcome(outcome: HarvestOutcome): AttemptOutcome | null {
  switch (outcome) {
    // `cached` means our coverage check disagreed with the function's own
    // cache lookup. Record it as found so we stop paying to rediscover that.
    case "found": case "cached": return "found";
    case "not_found": return "not_found";
    case "unsupported": return "unsupported";
    case "error": return "error";
    // Nothing was learned about the triple; a throttle or a missing key must
    // never be remembered as "this vehicle has no brochure".
    case "rate_limited": case "not_configured": return null;
  }
}

/** True when a confirmed provider miss should be stamped onto the listing. */
export function stickerStampsChecked(outcome: StickerOutcome): boolean {
  return outcome === "miss";
}

// ── Truncation accounting ─────────────────────────────────────────────

export interface Truncation {
  /** The listing query returned a full page, so older inventory was not seen. */
  vehicleCapHit: boolean;
  stickerTargets: number;
  stickerAttempted: number;
  stickerDeferred: number;
  linkTargets: number;
  linkAttempted: number;
  linkDeferred: number;
}

/**
 * One line an operator can read. A sweep that quietly stops at its cap and
 * reports success is indistinguishable from one that covered the fleet, and
 * that is how a dealer concludes the backfill is finished when it is not.
 */
export function describeTruncation(t: Truncation): string | null {
  const notes: string[] = [];
  if (t.vehicleCapHit) {
    notes.push("vehicle scan hit its page limit; older published inventory was not examined this run");
  }
  if (t.stickerDeferred > 0) {
    notes.push(`${t.stickerDeferred} of ${t.stickerTargets} VINs deferred by the sticker budget`);
  }
  if (t.linkDeferred > 0) {
    notes.push(`${t.linkDeferred} of ${t.linkTargets} OEM link triples deferred by the harvest budget`);
  }
  return notes.length ? notes.join("; ") : null;
}

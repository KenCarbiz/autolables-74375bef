// Primary vs child-store inventory scope.
//
// A tenant has one primary dealership inventory (dealer_stores.is_primary_inventory_store)
// and any number of child/sister stores under the same dealer group. A listing
// belongs to a store only on verified evidence: the Files.com owning store
// (vehicle_listings.owning_store_id), or a MarketCheck dealer id that an admin
// mapped to a store (dealer_stores.provider_ids.marketcheck_dealer_id). Make,
// model, address text and stock-number patterns are never used.
//
// A listing that carries a provider dealer id nobody has mapped is held in a
// review bucket instead of being counted as primary inventory, because it may
// be a sister store's car. A listing with no rooftop evidence at all (manual
// entry, legacy row) is the tenant's own when the tenant has one rooftop; when
// the tenant has child stores it could be any of them, so it is held for review
// too. Nothing is ever assumed to be the primary store's.

export type Condition = "new" | "used" | "cpo";

export interface ScopeStore {
  id: string;
  display_name: string;
  is_primary_inventory_store: boolean;
  status: "active" | "inactive";
  provider_ids?: Record<string, unknown> | null;
}

export interface ScopeListing {
  id: string;
  tenant_id?: string | null;
  owning_store_id?: string | null;
  mc_dealer_id?: string | number | null;
  condition?: string | null;
}

export type ScopeKind = "primary" | "child" | "rooftop_review";
export type ScopeBasis = "owning_store" | "marketcheck_dealer_id" | "single_rooftop" | "no_verified_rooftop" | "unmapped_provider_dealer" | "ambiguous_provider_dealer" | "unknown_store";

export interface ListingScope { kind: ScopeKind; storeId: string | null; basis: ScopeBasis }

export interface StoreRegistry {
  primary: ScopeStore | null;
  children: ScopeStore[];
  byId: Map<string, ScopeStore>;
  byMcDealer: Map<string, ScopeStore>;
  /** Dealer ids mapped to more than one store. They resolve to review, never to a guess. */
  ambiguousMcDealers: Set<string>;
  /** Stores the tenant has according to the server, not how many this client can see. */
  verifiedStoreCount: number;
}

export const MC_DEALER_KEY = "marketcheck_dealer_id";

const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

export function buildRegistry(stores: ScopeStore[], verifiedStoreCount = stores.length): StoreRegistry {
  const byId = new Map<string, ScopeStore>();
  const byMcDealer = new Map<string, ScopeStore>();
  const ambiguous = new Set<string>();
  for (const s of stores) {
    byId.set(s.id, s);
    const ids = s.provider_ids?.[MC_DEALER_KEY];
    for (const raw of Array.isArray(ids) ? ids : [ids]) {
      const k = norm(raw);
      if (!k) continue;
      if (byMcDealer.has(k) && byMcDealer.get(k)!.id !== s.id) ambiguous.add(k);
      else byMcDealer.set(k, s);
    }
  }
  for (const k of ambiguous) byMcDealer.delete(k);
  const primaries = stores.filter((s) => s.is_primary_inventory_store);
  const primary = primaries.length === 1 ? primaries[0] : null;
  const children = stores
    .filter((s) => !primary || s.id !== primary.id)
    .filter((s) => !s.is_primary_inventory_store)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  return { primary, children, byId, byMcDealer, ambiguousMcDealers: ambiguous, verifiedStoreCount: Math.max(verifiedStoreCount, byId.size) };
}

/**
 * One rooftop (or none registered): every listing of the tenant is that rooftop's.
 * Decided by the server's store count, so a client that can see only one of
 * several stores is never treated as single-rooftop.
 */
export const isSingleRooftop = (reg: StoreRegistry): boolean => reg.verifiedStoreCount <= 1;

const kindOf = (reg: StoreRegistry, store: ScopeStore): ScopeKind =>
  reg.primary && store.id === reg.primary.id ? "primary" : "child";

export function resolveListingScope(listing: ScopeListing, reg: StoreRegistry): ListingScope {
  const owner = norm(listing.owning_store_id);
  if (isSingleRooftop(reg)) {
    const only = [...reg.byId.values()][0] ?? null;
    if (owner && owner !== only?.id) return { kind: "rooftop_review", storeId: owner, basis: "unknown_store" };
    return { kind: "primary", storeId: only?.id ?? null, basis: owner ? "owning_store" : "single_rooftop" };
  }
  if (owner) {
    const s = reg.byId.get(owner);
    if (!s) return { kind: "rooftop_review", storeId: owner, basis: "unknown_store" };
    return { kind: kindOf(reg, s), storeId: s.id, basis: "owning_store" };
  }
  const dealer = norm(listing.mc_dealer_id);
  if (dealer) {
    const s = reg.byMcDealer.get(dealer);
    if (s) return { kind: kindOf(reg, s), storeId: s.id, basis: "marketcheck_dealer_id" };
    if (reg.ambiguousMcDealers.has(dealer)) return { kind: "rooftop_review", storeId: null, basis: "ambiguous_provider_dealer" };
    return { kind: "rooftop_review", storeId: null, basis: "unmapped_provider_dealer" };
  }
  return { kind: "rooftop_review", storeId: null, basis: "no_verified_rooftop" };
}

/** True when a row belongs in the default (primary dealership) list. */
export const inPrimaryView = (listing: ScopeListing, reg: StoreRegistry): boolean =>
  resolveListingScope(listing, reg).kind === "primary";

export interface ConditionCounts { total: number; new: number; used: number; cpo: number; unknown: number }

export const emptyCounts = (): ConditionCounts => ({ total: 0, new: 0, used: 0, cpo: 0, unknown: 0 });

export function normalizeCondition(c: string | null | undefined): Condition | null {
  const v = String(c ?? "").trim().toLowerCase();
  if (v === "new") return "new";
  if (v === "used" || v === "pre-owned" || v === "preowned") return "used";
  if (v === "cpo" || v === "certified" || v === "certified pre-owned") return "cpo";
  return null;
}

export function addCondition(c: ConditionCounts, condition: string | null | undefined): void {
  c.total += 1;
  const n = normalizeCondition(condition);
  if (n) c[n] += 1; else c.unknown += 1;
}

export interface ScopeSummary {
  primary: ConditionCounts;
  review: ConditionCounts;
  byChild: Map<string, ConditionCounts>;
}

export function summarizeScopes(rows: ScopeListing[], reg: StoreRegistry): ScopeSummary {
  const out: ScopeSummary = { primary: emptyCounts(), review: emptyCounts(), byChild: new Map() };
  for (const r of rows) {
    const s = resolveListingScope(r, reg);
    if (s.kind === "primary") addCondition(out.primary, r.condition);
    else if (s.kind === "rooftop_review") addCondition(out.review, r.condition);
    else {
      const c = out.byChild.get(s.storeId!) ?? emptyCounts();
      addCondition(c, r.condition);
      out.byChild.set(s.storeId!, c);
    }
  }
  return out;
}

// ── Per-store status lines ───────────────────────────────────────────────

export interface UsageRow { outcome: "admitted" | "denied"; deny_reason: string | null; estimated_cost_usd: number | null; product: string }
export interface UsageSummary { admitted: number; denied: number; estimatedUsd: number; unpriced: number; denyReasons: Record<string, number>; byProduct: Record<string, number> }

export function summarizeUsage(rows: readonly UsageRow[]): UsageSummary {
  const out: UsageSummary = { admitted: 0, denied: 0, estimatedUsd: 0, unpriced: 0, denyReasons: {}, byProduct: {} };
  for (const r of rows) {
    if (r.outcome === "admitted") {
      out.admitted += 1;
      out.byProduct[r.product] = (out.byProduct[r.product] ?? 0) + 1;
      if (r.estimated_cost_usd === null || r.estimated_cost_usd === undefined) out.unpriced += 1;
      else out.estimatedUsd += Number(r.estimated_cost_usd);
    } else {
      out.denied += 1;
      const k = r.deny_reason ?? "unknown";
      out.denyReasons[k] = (out.denyReasons[k] ?? 0) + 1;
    }
  }
  out.estimatedUsd = Math.round(out.estimatedUsd * 100) / 100;
  return out;
}

export interface FeedVehicle { presence: string; condition: string | null; stock_number: string | null; feed_price_status: string; enrichment_status: string; last_seen_at: string }
export interface StoreFeedHealth {
  counts: ConditionCounts;
  missingFromLastFeed: number;
  noStockNumber: number;
  noPrice: number;
  enrichmentFresh: number;
  lastFeedUpdate: string | null;
}

export function storeFeedHealth(rows: readonly FeedVehicle[]): StoreFeedHealth {
  const h: StoreFeedHealth = { counts: emptyCounts(), missingFromLastFeed: 0, noStockNumber: 0, noPrice: 0, enrichmentFresh: 0, lastFeedUpdate: null };
  for (const r of rows) {
    if (!h.lastFeedUpdate || r.last_seen_at > h.lastFeedUpdate) h.lastFeedUpdate = r.last_seen_at;
    if (r.presence !== "present") { h.missingFromLastFeed += 1; continue; }
    addCondition(h.counts, r.condition);
    if (!r.stock_number || !r.stock_number.trim()) h.noStockNumber += 1;
    if (r.feed_price_status !== "known") h.noPrice += 1;
    if (r.enrichment_status === "fresh") h.enrichmentFresh += 1;
  }
  return h;
}

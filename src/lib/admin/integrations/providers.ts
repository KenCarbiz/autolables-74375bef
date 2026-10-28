import { capability } from "@/lib/market/providerRegistry";
import { deriveProviderHealth, type EntitlementState, type HealthVerdict } from "@/lib/admin/health";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";

// Provider cards for the health center. Health comes from the call ledger
// (`provider_call_events`), the crawl ledger and the provider registry's
// entitlement knowledge. No card is painted by calling a provider.

export type ProviderCardKind = "marketcheck" | "crawl" | "blackbook" | "backend" | "vindata";

export interface ProviderCardSpec {
  id: string;
  label: string;
  kind: ProviderCardKind;
  registryKeys: string[];
  billingProducts: string[];
  affectedOutput: string;
  drillIn: string;
  drillInLabel: string;
  /** Manual, capped product: never a background health call. */
  manual?: boolean;
}

export const PROVIDER_CARDS: readonly ProviderCardSpec[] = [
  { id: "syndication", label: "MarketCheck inventory feed", kind: "marketcheck", registryKeys: ["syndication"], billingProducts: ["dealer_inventory_syndication"], affectedOutput: "Inventory freshness and availability", drillIn: adminTabHref("inventory-feed"), drillInLabel: "Open inventory feed" },
  { id: "active_search", label: "MarketCheck active search", kind: "marketcheck", registryKeys: ["active_search"], billingProducts: ["inventory_search"], affectedOutput: "Active comparables and price integrity", drillIn: adminTabHref("price-rules", "price-audit"), drillInLabel: "Open pricing" },
  { id: "neovin", label: "NeoVIN build decode", kind: "marketcheck", registryKeys: ["neovin", "basic_decode"], billingProducts: ["neovin", "basic_vin_decode"], affectedOutput: "Exact build and equipment", drillIn: "/inventory-intelligence", drillInLabel: "Open inventory intelligence" },
  { id: "vin_history", label: "VIN history", kind: "marketcheck", registryKeys: ["vin_history"], billingProducts: ["vin_history"], affectedOutput: "Mileage and listing history evidence", drillIn: "/inventory-intelligence", drillInLabel: "Open inventory intelligence" },
  { id: "mds", label: "Market days supply", kind: "marketcheck", registryKeys: ["mds"], billingProducts: ["market_days_supply"], affectedOutput: "Liquidity context", drillIn: adminTabHref("data-quality"), drillInLabel: "Open data quality" },
  { id: "sales_stats", label: "Sales statistics", kind: "marketcheck", registryKeys: ["sales_stats", "recents"], billingProducts: ["sales_stats", "recent_inventory"], affectedOutput: "Velocity context", drillIn: adminTabHref("data-quality"), drillInLabel: "Open data quality" },
  { id: "price_prediction", label: "MarketCheck price prediction", kind: "marketcheck", registryKeys: ["price_base", "price_premium", "price_premium_plus"], billingProducts: ["price_prediction"], affectedOutput: "Market value refresh (shadow)", drillIn: adminTabHref("data-quality"), drillInLabel: "Open data quality" },
  { id: "autorecalls", label: "AutoRecalls (VIN recalls)", kind: "marketcheck", registryKeys: ["autorecalls"], billingProducts: ["auto_recalls"], affectedOutput: "VIN recall verification", drillIn: adminTabHref("data-quality"), drillInLabel: "Open data quality" },
  { id: "incentives", label: "OEM incentives", kind: "marketcheck", registryKeys: ["incentives_oem", "incentives_make_zip"], billingProducts: ["oem_incentive"], affectedOutput: "Incentive context on the Passport", drillIn: adminTabHref("price-rules"), drillInLabel: "Open price rules" },
  { id: "vindata", label: "VINData / NMVTIS title report", kind: "vindata", registryKeys: ["vindata_generate", "vindata_access"], billingProducts: ["vindata_generate", "vindata_access"], affectedOutput: "Title and odometer verification", drillIn: "/compliance", drillInLabel: "Open compliance", manual: true },
  { id: "blackbook", label: "Black Book", kind: "blackbook", registryKeys: ["blackbook_used_vin"], billingProducts: [], affectedOutput: "Market and reference values", drillIn: adminTabHref("plan-features"), drillInLabel: "Open plan & features" },
  { id: "dealer_site", label: "Dealer-site price evidence", kind: "crawl", registryKeys: [], billingProducts: [], affectedOutput: "Dealer VDP price evidence", drillIn: adminTabHref("jobs"), drillInLabel: "Open jobs" },
  { id: "backend", label: "AutoLabels backend", kind: "backend", registryKeys: [], billingProducts: [], affectedOutput: "Core application operations", drillIn: adminTabHref("activity"), drillInLabel: "Open activity" },
];

export interface ProviderEventRow {
  at: string;
  product: string | null;
  outcome: string | null;
  http_status: number | null;
}

export interface ProductAggregate {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Newest recorded outcome; an unrecorded admission is not an outcome. */
  lastOutcome: string | null;
  attempts: number;
  refusals: number;
}

const REFUSAL_OUTCOMES = new Set(["refused_quota", "refused_rate", "refused_auth", "budget_denied"]);

/** Newest-first or any order; the aggregate sorts by time itself. */
export function aggregateEvents(events: readonly ProviderEventRow[], products: readonly string[]): ProductAggregate {
  const wanted = new Set(products);
  const mine = events.filter((e) => e.product && wanted.has(e.product)).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const recorded = mine.filter((e) => e.outcome && e.outcome !== "admitted");
  return {
    lastAttemptAt: mine[0]?.at ?? null,
    lastSuccessAt: recorded.find((e) => e.outcome === "ok")?.at ?? null,
    lastOutcome: recorded[0]?.outcome ?? null,
    attempts: mine.length,
    refusals: recorded.filter((e) => REFUSAL_OUTCOMES.has(e.outcome as string)).length,
  };
}

export function registryEntitlement(keys: readonly string[]): EntitlementState {
  if (keys.length === 0) return "entitled";
  const statuses = keys.map((k) => capability(k)?.status ?? null).filter((s): s is NonNullable<typeof s> => s !== null);
  if (statuses.length === 0) return "unknown";
  if (statuses.some((s) => s === "active" || s === "shadow")) return "entitled";
  if (statuses.every((s) => s === "entitlement_blocked")) return "blocked";
  if (statuses.every((s) => s === "autocurb_reserved" || s === "not_active" || s === "not_useful" || s === "deprecated_replaced")) return "not_applicable";
  if (statuses.some((s) => s === "entitlement_blocked")) return "blocked";
  return "unknown";
}

export function registryTtlHours(keys: readonly string[]): number | null {
  const ttls = keys.map((k) => capability(k)?.ttlHours ?? null).filter((t): t is number => typeof t === "number");
  return ttls.length ? Math.min(...ttls) : null;
}

export type CrawlOutcome = string;

export interface CrawlFacts {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastOutcome: CrawlOutcome | null;
  attempts: number;
}

/** Crawl ledger outcomes mapped onto the provider-call vocabulary the health rule reads. */
export function crawlOutcomeToCall(outcome: string | null): string | null {
  switch (outcome) {
    case null:
      return null;
    case "captured":
      return "ok";
    case "render_rate_limited":
      return "refused_rate";
    case "render_cost_refused":
    case "blocked_no_render_budget":
      return "budget_denied";
    case "render_auth_failed":
      return "refused_auth";
    case "render_unconfigured":
      return "not_configured";
    default:
      return "provider_error";
  }
}

export interface ProviderCardInput {
  spec: ProviderCardSpec;
  events: readonly ProviderEventRow[] | null;
  crawl?: CrawlFacts | null;
  crawlConfigured?: boolean | null;
  flags: { blackbook: boolean };
  backendOk: boolean | null;
  now: number;
}

export interface ProviderCardModel {
  spec: ProviderCardSpec;
  verdict: HealthVerdict;
  entitlement: EntitlementState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  attempts: number | null;
  refusals: number | null;
  ttlHours: number | null;
}

/** A null TTL means the answer is immutable; it is never stale, so freshness gets a very long window. */
const IMMUTABLE_WINDOW_HOURS = 24 * 3650;

export function deriveProviderCard(i: ProviderCardInput): ProviderCardModel {
  const { spec } = i;
  const base = { spec, attempts: null as number | null, refusals: null as number | null, ttlHours: registryTtlHours(spec.registryKeys) };

  if (spec.kind === "backend") {
    const verdict: HealthVerdict = i.backendOk === null
      ? { state: "unknown", headline: "Backend status could not be read", detail: "No read completed yet.", affectedOutput: spec.affectedOutput, inventoryPreserved: true }
      : i.backendOk
        ? { state: "healthy", headline: "Reads answered", detail: "Every query this page made returned normally.", affectedOutput: spec.affectedOutput, inventoryPreserved: true }
        : { state: "degraded", headline: "A read failed", detail: "At least one query on this page did not return; the affected cards show Unknown.", affectedOutput: spec.affectedOutput, inventoryPreserved: true };
    return { ...base, verdict, entitlement: "entitled", lastAttemptAt: null, lastSuccessAt: null };
  }

  if (spec.kind === "blackbook") {
    const verdict = deriveProviderHealth({
      configured: i.flags.blackbook ? null : false,
      entitlement: i.flags.blackbook ? registryEntitlement(spec.registryKeys) : "entitled",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastOutcome: null,
      ttlHours: base.ttlHours,
      affectedOutput: spec.affectedOutput,
      now: i.now,
    });
    const final: HealthVerdict = i.flags.blackbook && verdict.state === "unknown"
      ? { ...verdict, headline: "Enabled, no calls recorded", detail: "The feature is switched on but no Black Book call has been recorded; the integration is not yet complete." }
      : verdict;
    return { ...base, verdict: final, entitlement: i.flags.blackbook ? registryEntitlement(spec.registryKeys) : "not_applicable", lastAttemptAt: null, lastSuccessAt: null };
  }

  if (spec.kind === "crawl") {
    const c = i.crawl;
    const loadFailed = c === null;
    const lastOutcome = c ? crawlOutcomeToCall(c.lastOutcome) : null;
    const verdict = deriveProviderHealth({
      configured: i.crawlConfigured ?? (c && c.attempts > 0 ? true : null),
      entitlement: "entitled",
      lastAttemptAt: c?.lastAttemptAt ?? null,
      lastSuccessAt: c?.lastSuccessAt ?? null,
      lastOutcome: lastOutcome === "not_configured" ? "provider_error" : lastOutcome,
      ttlHours: 24,
      affectedOutput: spec.affectedOutput,
      now: i.now,
      loadFailed,
    });
    return { ...base, verdict, entitlement: "entitled", lastAttemptAt: c?.lastAttemptAt ?? null, lastSuccessAt: c?.lastSuccessAt ?? null, attempts: c?.attempts ?? null };
  }

  const entitlement = registryEntitlement(spec.registryKeys);
  const loadFailed = i.events === null;
  const agg = i.events ? aggregateEvents(i.events, spec.billingProducts) : null;
  const refusedByPlan = agg?.lastOutcome === "refused_auth";
  const verdict = deriveProviderHealth({
    configured: true,
    entitlement: refusedByPlan ? "refused" : entitlement,
    lastAttemptAt: agg?.lastAttemptAt ?? null,
    lastSuccessAt: agg?.lastSuccessAt ?? null,
    lastOutcome: agg?.lastOutcome ?? null,
    ttlHours: base.ttlHours ?? IMMUTABLE_WINDOW_HOURS,
    affectedOutput: spec.affectedOutput,
    now: i.now,
    loadFailed,
  });
  const manualNote: HealthVerdict = spec.manual && verdict.state === "unknown"
    ? { ...verdict, headline: "Manual, on request", detail: "Pulled only when a person requests a report; no background call is ever made." }
    : verdict;
  return {
    ...base,
    verdict: manualNote,
    entitlement: refusedByPlan ? "refused" : entitlement,
    lastAttemptAt: agg?.lastAttemptAt ?? null,
    lastSuccessAt: agg?.lastSuccessAt ?? null,
    attempts: agg?.attempts ?? null,
    refusals: agg?.refusals ?? null,
  };
}

export const providerDrillIn = (spec: ProviderCardSpec, latestRunId: string | null): string =>
  spec.id === "syndication" && latestRunId ? ADMIN_CHILD_ROUTES.syncRun(latestRunId) : spec.drillIn;

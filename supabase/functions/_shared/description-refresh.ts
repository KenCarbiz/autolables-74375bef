// When a description is rewritten after its first one.
//
// Owner rule: write it once, on ingest, and then leave it alone. A description
// that is still accurate does not need rewriting because a week passed, and one
// orchestrate run costs NINE provider calls (1 master + 8 channel variants)
// against a 500/day, ~1,350/month tenant ceiling. On a 130-car lot a single
// lot-wide rewrite pass is ~1,170 calls: one avoidable pass is most of a month.
//
// The only scheduled rewrite is age + market: the vehicle has been in inventory
// past the configured threshold (90-120 days) AND comparable supply is
// measurably abundant, so the copy is now competing against many near-identical
// listings. Age on its own is the weaker half of that test and does not
// qualify on its own — a scarce car does not sell better for being re-worded.
// At most ONE aged rewrite per vehicle, ever.
//
// This is not "never update a stale fact". A price change, an equipment change,
// a new source_data_version or config_version, a stalled run and a repairable
// validation failure all still regenerate — those are input changes, and they
// are selected by their own candidate classes in the reconcile sweep, not by
// this module. This module only answers "should we rewrite copy whose inputs
// have not moved?", and its default answer is no.
//
// Inventory age comes from the feed's days-on-market where the provider
// supplies it, because that is the vehicle's real age on the lot. Falling back
// to our own ingest date would restart the clock for every car that was
// already in stock when the dealership onboarded: on this lot the oldest row
// is 79 days old while the oldest vehicle has been listed 883 days, so the
// fallback would have said "day 0" for a car approaching its third year.
// get_ready_records.inventory_date is NOT used: it is written only when a user
// clicks through the recon workflow, so it exists for a subset of one lot and
// is absent for every feed-ingested car.

export const REFRESH_POLICY = {
  /** Age at which an unchanged description may be rewritten, once. */
  defaultAgeDays: 120,
  /**
   * Floor for any configured threshold. The reconcile SQL owns the tenant's
   * exact number; this module cannot see tenant settings from the orchestrator
   * call site, so it enforces the floor instead. Any vehicle the sweep can
   * legitimately select clears it, and anything younger that reaches here by
   * another path is refused.
   */
  minAgeDays: 90,
  /** Comparable active listings at or above which supply counts as abundant. */
  abundantSupplyCount: 10,
  /** Regional market days supply at or above which supply counts as abundant. */
  abundantDaysSupply: 60,
  /**
   * Oldest market evidence still allowed to decide. Deliberately generous:
   * next_enrich_batch only re-enriches a vehicle that is MISSING
   * market_value/recall_status/comparables, so a fully enriched lot never has
   * recent market_meta. A 30-day rule would make the whole refresh unreachable,
   * which is the same failure as not having the rule at all.
   */
  supplyEvidenceMaxAgeDays: 180,
} as const;

export type SupplyClass = "abundant" | "scarce" | "unknown";
export type SupplyBasis = "trim_count" | "similar_count" | "market_days_supply" | "none";

export interface SupplyEvidence {
  supply: SupplyClass;
  basis: SupplyBasis;
  comparableCount: number | null;
  daysSupply: number | null;
  evidenceAgeDays: number | null;
}

export type RefreshReason =
  | "initial"
  | "locked"
  | "already_refreshed"
  | "unknown_age"
  | "too_new"
  | "scarce"
  | "supply_unknown"
  | "aged_and_abundant";

export interface RefreshInputs {
  /** Days on market from the provider, when present. */
  dom?: number | null;
  /** When AutoLabels first saw the vehicle. Fallback only. */
  ingestedAt?: string | Date | null;
  /** The age threshold the current description was already rewritten for. */
  lastMilestone?: number | null;
  /** Whether a description exists at all. */
  hasDescription: boolean;
  /** A manually locked description is never rewritten on a schedule. */
  locked?: boolean;
  /** Tenant threshold in days. Clamped up to REFRESH_POLICY.minAgeDays. */
  ageThresholdDays?: number | null;
  /**
   * Market supply for this vehicle. OMITTED (or null) means the caller's
   * selector already applied the supply gate — the reconcile SQL does, because
   * the orchestrator has no market fields at this call site. A value here is
   * enforced, and the two must agree: a test pins the SQL's thresholds to
   * REFRESH_POLICY.
   */
  supply?: SupplyClass | SupplyEvidence | null;
  /** Set false to let age alone qualify. Defaults to true. */
  requireAbundantSupply?: boolean;
  now?: Date;
}

export interface RefreshDecision {
  due: boolean;
  reason: RefreshReason;
  /** The age threshold satisfied. Stamped onto description_cases. */
  milestone: number | null;
  daysInInventory: number | null;
  ageSource: "provider_dom" | "ingest_date" | "unknown";
  ageThresholdDays: number;
  supply: SupplyClass | "delegated";
  supplyBasis: SupplyBasis | null;
  comparableCount: number | null;
}

const days = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);

const numeric = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return null;
  const s = String(v).trim();
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const countOf = (v: unknown): number | null => {
  const n = numeric(v);
  return n !== null && n >= 0 ? Math.floor(n) : null;
};

// The winning search tier vehicle-enrich recorded. Anything that kept the year
// or the price band is close enough to call comparable supply; a bare "model"
// tier counts every model-year in the region and cannot.
const TIGHT_TIERS = ["trim_year_band", "year_band", "year", "band"];

export function threshold(input: Pick<RefreshInputs, "ageThresholdDays">): number {
  const configured = numeric(input.ageThresholdDays);
  if (configured === null) return REFRESH_POLICY.defaultAgeDays;
  return Math.max(REFRESH_POLICY.minAgeDays, Math.floor(configured));
}

/**
 * Comparable supply, read straight off vehicle_listings.market_meta.
 *
 * Only whole-market counts are used. `trim_count` and `similar_count` are
 * MarketCheck `num_found` values — the size of the market, not of a page.
 * `like_count` is deliberately NOT read: it is the length of the like-for-like
 * subset of the returned page, so it saturates at the page size and would
 * report a commodity model as scarce. `market_position` is not read either —
 * it is a PRICE position (great_deal / above_market), not a supply figure, and
 * nothing in it says how many comparable cars exist.
 *
 * No composite score is computed. Each basis is a stored provider figure
 * compared against one threshold.
 */
export function classifyMarketSupply(
  meta: Record<string, unknown> | null | undefined,
  opts: { maxEvidenceAgeDays?: number | null; abundantCount?: number | null; abundantDaysSupply?: number | null; now?: Date } = {},
): SupplyEvidence {
  const none: SupplyEvidence = {
    supply: "unknown", basis: "none", comparableCount: null, daysSupply: null, evidenceAgeDays: null,
  };
  if (!meta || typeof meta !== "object") return none;

  const now = opts.now ?? new Date();
  const stamp = meta.checked_at ?? null;
  let evidenceAgeDays: number | null = null;
  if (stamp) {
    const at = new Date(stamp as string | Date);
    if (!Number.isNaN(at.getTime())) evidenceAgeDays = Math.max(0, days(at, now));
  }
  const maxAge = numeric(opts.maxEvidenceAgeDays) ?? REFRESH_POLICY.supplyEvidenceMaxAgeDays;
  // No timestamp at all is not evidence. Enrichment always writes checked_at,
  // so its absence means the payload predates the field or was hand-built.
  if (evidenceAgeDays === null || evidenceAgeDays > maxAge) return { ...none, evidenceAgeDays };

  const abundantCount = numeric(opts.abundantCount) ?? REFRESH_POLICY.abundantSupplyCount;
  const abundantMds = numeric(opts.abundantDaysSupply) ?? REFRESH_POLICY.abundantDaysSupply;
  const verdict = (ok: boolean): SupplyClass => (ok ? "abundant" : "scarce");

  const trimCount = countOf(meta.trim_count);
  if (trimCount !== null) {
    return { supply: verdict(trimCount >= abundantCount), basis: "trim_count",
             comparableCount: trimCount, daysSupply: null, evidenceAgeDays };
  }

  const tier = String(meta.relaxation_tier ?? "");
  if (TIGHT_TIERS.includes(tier)) {
    const similar = countOf(meta.similar_count ?? meta.inventory_count);
    if (similar !== null) {
      return { supply: verdict(similar >= abundantCount), basis: "similar_count",
               comparableCount: similar, daysSupply: null, evidenceAgeDays };
    }
  }

  const mds = numeric(meta.market_days_supply);
  if (mds !== null && mds >= 0) {
    return { supply: verdict(mds >= abundantMds), basis: "market_days_supply",
             comparableCount: null, daysSupply: mds, evidenceAgeDays };
  }

  return { ...none, evidenceAgeDays };
}

export function inventoryAge(input: RefreshInputs): {
  days: number | null; source: RefreshDecision["ageSource"];
} {
  // Number(null) is 0, which is finite and non-negative — so a missing
  // provider figure would read as "brand new" and the vehicle would never
  // reach a milestone. The absence has to be checked before the coercion.
  if (input.dom !== null && input.dom !== undefined && String(input.dom).trim() !== "") {
    const dom = Number(input.dom);
    if (Number.isFinite(dom) && dom >= 0) return { days: Math.floor(dom), source: "provider_dom" };
  }
  if (input.ingestedAt) {
    const from = new Date(input.ingestedAt);
    if (!Number.isNaN(from.getTime())) {
      return { days: Math.max(0, days(from, input.now ?? new Date())), source: "ingest_date" };
    }
  }
  return { days: null, source: "unknown" };
}

const normalizeSupply = (
  supply: RefreshInputs["supply"],
): { supply: SupplyClass | "delegated"; basis: SupplyBasis | null; count: number | null } => {
  if (supply === null || supply === undefined) return { supply: "delegated", basis: null, count: null };
  if (typeof supply === "string") return { supply, basis: null, count: null };
  return { supply: supply.supply, basis: supply.basis, count: supply.comparableCount };
};

export function refreshDecision(input: RefreshInputs): RefreshDecision {
  const { days: age, source } = inventoryAge(input);
  const ageThresholdDays = threshold(input);
  const supply = normalizeSupply(input.supply);
  const base = {
    milestone: null, daysInInventory: age, ageSource: source, ageThresholdDays,
    supply: supply.supply, supplyBasis: supply.basis, comparableCount: supply.count,
  };

  // A vehicle with no description gets one regardless of age or market. This is
  // the original-ingest write, and also the repair path for anything that
  // failed — neither is a rewrite, so neither is gated.
  if (!input.hasDescription) return { ...base, due: true, reason: "initial" };

  // A human chose this copy. Age never overrides that; the material-change
  // path marks it stale for review instead.
  if (input.locked) return { ...base, due: false, reason: "locked" };

  // Write once. One aged rewrite per vehicle, ever — a car that has had it does
  // not get another at any age, and rows stamped under the older 60/200 ladder
  // are treated as already spent.
  if ((numeric(input.lastMilestone) ?? 0) > 0) {
    return { ...base, due: false, reason: "already_refreshed" };
  }

  if (age === null) return { ...base, due: false, reason: "unknown_age", daysInInventory: null };
  if (age < ageThresholdDays) return { ...base, due: false, reason: "too_new" };

  const requireSupply = input.requireAbundantSupply !== false;
  if (requireSupply && supply.supply !== "delegated") {
    if (supply.supply === "scarce") return { ...base, due: false, reason: "scarce" };
    if (supply.supply === "unknown") return { ...base, due: false, reason: "supply_unknown" };
  }

  return { ...base, due: true, reason: "aged_and_abundant", milestone: ageThresholdDays };
}

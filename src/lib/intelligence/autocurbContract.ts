// ── AutoCurb handoff contract ───────────────────────────────────────────────
//
// AutoCurb is a separate project (master build sections 37 and 18). What it
// receives from AutoLabels is reusable canonical intelligence about a vehicle:
// who it is, what it has done, what it is worth and how fast it moves. What it
// does NOT receive is any part of its own acquisition formula: no maximum
// acquisition, no suggested offer, no recon economics, no holding reserve.
// Those are AutoCurb's to compute, and the validator below refuses a payload
// that carries them, so the boundary is enforced rather than remembered.
//
// MarketMatch, auction and FSBO are AUTOCURB_RESERVED: listed by name, never
// present as data, and refused by the provider registry (policyFor) for both
// AutoLabels vehicle types.

import type { CohortMatchLevel } from "../market/cohortLadder.ts";
import {
  containsForbiddenKey,
  type AuthorityClass, type ConditionSummary, type Freshness, type IdentitySummary, type MarketTrend,
  type MarketValueV3, type ProvenanceSummary, type RecallSummary, type TitleOdometerSummary,
} from "./contracts.ts";

export const AUTOCURB_CONTRACT_VERSION = "autocurb-handoff-1.0.0";

export const AUTOCURB_RESERVED = ["marketmatch", "marketmatch_dealers", "auction", "fsbo"] as const;
export type AutocurbReservedCapability = (typeof AUTOCURB_RESERVED)[number];

/**
 * Keys that belong to AutoCurb's own formula (package file 18, "AutoCurb adds
 * later") and the two counts listing history may never pretend to know
 * (section 15). Compared after normalising case and separators, so
 * `suggested_offer`, `suggestedOffer` and `Suggested Offer` are all caught.
 */
export const ACQUISITION_FORMULA_KEYS = [
  "max_acquisition", "recommended_max_acquisition", "suggested_offer", "target_gross",
  "recon_economics", "expected_recon_economics", "holding_risk_reserve", "acquisition_costs",
  "wholesale_downside", "auction_downside", "marketmatch_fit", "marketmatch_dealer_fit",
  "manager_override", "manager_approval",
] as const;

export const UNINFERABLE_HISTORY_KEYS = ["owner_count", "owners", "accident_count", "accidents"] as const;

// ── VIN history (section 15) ──────────────────────────────────────────────

export type HistorySellerType = "dealer" | "private" | "auction" | "unknown";
export type HistoryInventoryType = "new" | "used" | "certified" | "unknown";

export interface VinHistoryEpisode {
  /** Ordinal in time, 1 = earliest listing seen. */
  episode: number;
  price: number | null;
  mileage: number | null;
  sellerType: HistorySellerType;
  inventoryType: HistoryInventoryType;
  /** The site or dealer the listing was seen on, as the provider names it; never a VDP body. */
  source: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface MileageReading { mileage: number; observedAt: string | null; source: string | null }

export interface VinHistorySummary {
  episodes: VinHistoryEpisode[];
  mileageChronology: MileageReading[];
  /** Days the VIN was on the market across all episodes; null when no episode has both dates. */
  priorMarketExposureDays: number | null;
  /** Episodes beyond the first. */
  relistedCount: number | null;
  /** The same source appears in two non-adjacent episodes. */
  returnedToDealer: boolean | null;
  /** A later reading lower than an earlier one by more than the tolerance. */
  mileageConflict: boolean | null;
  freshness: Freshness;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const stamp = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = str(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return stamp(Number(s));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const sellerType = (v: unknown): HistorySellerType => {
  const s = (str(v) ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/auction/.test(s)) return "auction";
  if (/fsbo|private|owner/.test(s)) return "private";
  if (/dealer|franchise|independent/.test(s)) return "dealer";
  return "unknown";
};
const inventoryType = (v: unknown): HistoryInventoryType => {
  const s = (str(v) ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/cpo|certified/.test(s)) return "certified";
  if (/new/.test(s)) return "new";
  if (/used/.test(s)) return "used";
  return "unknown";
};

const pick = (bag: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (bag[k] != null && bag[k] !== "") return bag[k];
  return null;
};

/** The provider's listing entries, in whichever of its spellings they arrive, as ordered episodes. */
export function normalizeHistoryEpisodes(entries: unknown): VinHistoryEpisode[] {
  if (!Array.isArray(entries)) return [];
  const raw = entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({
      price: num(pick(e, "price", "listing_price", "asking_price")),
      mileage: num(pick(e, "miles", "mileage", "odometer")),
      sellerType: sellerType(pick(e, "seller_type", "sellerType", "dealer_type")),
      inventoryType: inventoryType(pick(e, "inventory_type", "inventoryType", "car_type", "condition")),
      source: str(pick(e, "source", "seller_name", "dealer_name", "site")),
      firstSeenAt: stamp(pick(e, "first_seen_at", "first_seen", "firstSeen", "first_seen_at_date", "scraped_at")),
      lastSeenAt: stamp(pick(e, "last_seen_at", "last_seen", "lastSeen", "last_seen_at_date")),
    }))
    .sort((a, b) => (a.firstSeenAt ?? "").localeCompare(b.firstSeenAt ?? ""));
  return raw.map((e, i) => ({ episode: i + 1, ...e }));
}

export const MILEAGE_CONFLICT_TOLERANCE = 100;

export function summarizeVinHistory(entries: unknown, args: { checkedAt: string | null; ttlDays: number | null; nowMs: number }): VinHistorySummary {
  const episodes = normalizeHistoryEpisodes(entries);
  const readings: MileageReading[] = episodes
    .filter((e) => e.mileage != null)
    .map((e) => ({ mileage: e.mileage as number, observedAt: e.lastSeenAt ?? e.firstSeenAt, source: e.source }))
    .sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""));
  let conflict: boolean | null = readings.length >= 2 ? false : null;
  for (let i = 1; i < readings.length; i++) {
    if (readings[i].mileage < readings[i - 1].mileage - MILEAGE_CONFLICT_TOLERANCE) conflict = true;
  }
  const spans = episodes
    .filter((e) => e.firstSeenAt && e.lastSeenAt)
    .map((e) => Math.max(0, (Date.parse(e.lastSeenAt as string) - Date.parse(e.firstSeenAt as string)) / 86_400_000));
  const exposure = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0)) : null;
  const sources = episodes.map((e) => (e.source ?? "").toLowerCase());
  let returned: boolean | null = episodes.length >= 3 ? false : null;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 2; j < sources.length; j++) {
      if (sources[i] && sources[i] === sources[j]) returned = true;
    }
  }
  const checked = args.checkedAt && Number.isFinite(Date.parse(args.checkedAt)) ? args.checkedAt : null;
  const staleAtMs = checked && args.ttlDays ? Date.parse(checked) + args.ttlDays * 86_400_000 : null;
  const freshness: Freshness = {
    checkedAt: checked, observedAt: null, ttlDays: args.ttlDays ?? null,
    staleAt: staleAtMs != null ? new Date(staleAtMs).toISOString() : null,
    state: checked == null ? "unknown" : staleAtMs != null && args.nowMs > staleAtMs ? "stale" : "current",
  };
  return {
    episodes, mileageChronology: readings, priorMarketExposureDays: exposure,
    relistedCount: episodes.length ? Math.max(0, episodes.length - 1) : null,
    returnedToDealer: returned, mileageConflict: conflict, freshness,
  };
}

// ── The handoff ───────────────────────────────────────────────────────────

export interface MileageFacts {
  current: number | null;
  observedAt: string | null;
  source: string | null;
  authority: AuthorityClass;
  chronologyConsistent: boolean | null;
}

export interface MdsSummary {
  days: number | null;
  tier: CohortMatchLevel | null;
  geography: string | null;
  sampleSize: number | null;
  checkedAt: string | null;
}

export interface SalesStatsSummary {
  inferredSoldCount: number | null;
  medianLastAdvertisedPrice: number | null;
  medianDaysToSell: number | null;
  tier: CohortMatchLevel | null;
  geography: string | null;
  periodDays: number | null;
  checkedAt: string | null;
  /** The figures are inferred from listings leaving the market; the receiver must keep that wording. */
  wording: "inferred_sold";
}

export interface TrendSummary {
  direction: MarketTrend;
  basis: "sold_summary" | "none";
  months: number | null;
  checkedAt: string | null;
}

export interface ProviderTimestamps {
  syndication: string | null;
  neovin: string | null;
  history: string | null;
  mds: string | null;
  salesStats: string | null;
  soldSummary: string | null;
  recall: string | null;
  valuation: string | null;
  title: string | null;
}

export interface AutocurbHandoffParts {
  vin: string;
  identity: IdentitySummary;
  mileage: MileageFacts;
  titleOdometer: TitleOdometerSummary;
  vinHistory: VinHistorySummary;
  condition: ConditionSummary;
  provenance: ProvenanceSummary;
  marketValue: MarketValueV3;
  mds: MdsSummary;
  salesStats: SalesStatsSummary;
  trend: TrendSummary;
  recall: RecallSummary;
  providerTimestamps: ProviderTimestamps;
}

export interface AutocurbHandoff extends AutocurbHandoffParts {
  contractVersion: string;
  generatedAt: string;
  reserved: { capabilities: readonly AutocurbReservedCapability[]; note: string };
}

export const RESERVED_NOTE =
  "MarketMatch, auction and FSBO are AutoCurb capabilities. AutoLabels never requests them and this payload never carries their data.";

export function buildAutocurbHandoff(parts: AutocurbHandoffParts, opts: { generatedAt: string }): AutocurbHandoff {
  return {
    contractVersion: AUTOCURB_CONTRACT_VERSION,
    generatedAt: opts.generatedAt,
    ...parts,
    reserved: { capabilities: AUTOCURB_RESERVED, note: RESERVED_NOTE },
  };
}

const normKey = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const BANNED = new Set([...ACQUISITION_FORMULA_KEYS, ...UNINFERABLE_HISTORY_KEYS].map(normKey));

function findBannedKey(value: unknown, depth = 0): string | null {
  if (depth > 12 || value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) { const hit = findBannedKey(v, depth + 1); if (hit) return hit; }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (BANNED.has(normKey(k))) return k;
    const hit = findBannedKey(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export interface HandoffValidation { ok: boolean; problems: string[] }

/** What a payload must not carry: provider raw material, AutoCurb's formula, invented counts, reserved data. */
export function validateAutocurbHandoff(h: AutocurbHandoff): HandoffValidation {
  const problems: string[] = [];
  if (h.contractVersion !== AUTOCURB_CONTRACT_VERSION) problems.push(`contract_version_${h.contractVersion}`);
  if (!h.vin || !/^[A-HJ-NPR-Z0-9]{17}$/.test(h.vin)) problems.push("vin_invalid");
  const forbidden = containsForbiddenKey(h);
  if (forbidden) problems.push(`forbidden_key_${forbidden}`);
  const banned = findBannedKey(h);
  if (banned) problems.push(`acquisition_or_uninferable_key_${banned}`);
  const reserved = [...h.reserved.capabilities].sort().join(",");
  if (reserved !== [...AUTOCURB_RESERVED].sort().join(",")) problems.push("reserved_list_altered");
  for (const cap of AUTOCURB_RESERVED) {
    if (Object.prototype.hasOwnProperty.call(h, cap)) problems.push(`reserved_data_present_${cap}`);
  }
  if (h.salesStats.wording !== "inferred_sold") problems.push("sales_stats_wording");
  return { ok: problems.length === 0, problems };
}

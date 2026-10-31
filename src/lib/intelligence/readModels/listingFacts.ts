// ── Listing facts: the vehicle_listings row read into the contract summaries ─
//
// A Passport read model is assembled from two kinds of input: conclusions the
// intelligence modules compute (score, confidence, market value, deal rating,
// recommendation, title, condition, provenance) and facts that already sit on
// the listing row. This file is the row half: pure mappers from the columns
// the sync, enrich, specs and crawl writers maintain into the summary types
// in ../contracts.ts, each dated against a server-defined TTL.
//
// Rules the mappers carry:
//   - identity exactness comes from the factory decode: an exact NeoVIN sheet
//     is EXACT_VIN, a generic sheet is GENERIC_CANDIDATE, no sheet is YMM or
//     UNKNOWN, and nothing below exact may carry an exact-only claim;
//   - a fee basis the feed did not state is unknown, never zero;
//   - a failed or absent VIN recall check is never a no-open answer;
//   - the provider's sold figures are inferred and the summary says so;
//   - raw provider payloads are read here and never copied into a summary.

import { verifiedInServiceDate } from "../../warranty/inServiceEvidence.ts";
import { capability } from "../../market/providerRegistry.ts";
import { isExactIdentity, mayClaim, type IdentityMatchLevel } from "../../market/identityMatch.ts";
import { COHORT_MATCH_LEVELS, type CohortMatchLevel } from "../../market/cohortLadder.ts";
import { resolveListingFeeBasis } from "../../market/listingFeeBasis.ts";
import {
  deriveRecallView, RECALL_STALE_DAYS, type RecallRowInput, type RecallView, type RecallVinState,
} from "../../vehicleTruth/recallView.ts";
import {
  resolveFreshness,
  type AvailabilityState, type AvailabilitySummary, type DealerOfferSummary, type DecodeSource, type FactoryPackage,
  type DecodeAuthority, type Freshness, type IdentitySummary, type IncentiveSummary, type MarketContextSummary, type MarketTrend,
  type MsrpBreakdown, type PriceChannel, type PriceChannelObservation, type PriceIntegritySummary, type PublicState,
  type RecallSummary, type SalesVelocity, type VehicleMedia, type VinRecallContractState, type WarrantySummary,
  type WarrantyTerm,
} from "../contracts.ts";

export const LISTING_FACTS_VERSION = "listing-facts-1.0.0";

/** The columns these mappers read. Anything else on the row is ignored. */
export interface ListingRowLike {
  vin: string;
  ymm?: string | null;
  trim?: string | null;
  mileage?: number | string | null;
  condition?: string | null;
  price?: number | string | null;
  advertised_price_before_doc?: number | string | null;
  doc_fee?: number | string | null;
  website_sale_price?: number | string | null;
  website_price_term?: string | null;
  price_last_verified_at?: string | null;
  mc_attributes?: unknown;
  mc_raw?: unknown;
  market_meta?: unknown;
  recall_status?: string | null;
  recall_checked_at?: string | null;
  open_recall_count?: number | null;
  closed_recall_count?: number | null;
  recall_check?: unknown;
  recall_payload?: unknown;
  history_payload?: unknown;
  warranty_info?: unknown;
  in_service_date?: string | null;
  hero_image_url?: string | null;
  photos?: unknown;
  photo_count?: number | null;
  enriched_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
}

// ── TTLs: the registry cadence where one exists, in days ───────────────────

const hoursToDays = (h: number | null | undefined): number | null => (h != null && h > 0 ? h / 24 : null);

const registryTtlDays = (key: string, fallbackDays: number | null): number | null => {
  const c = capability(key);
  return c ? hoursToDays(c.ttlHours) ?? fallbackDays : fallbackDays;
};

export interface ReadModelTtlDays {
  feed: number | null;
  websitePrice: number | null;
  factoryDecode: number | null;
  marketDaysSupply: number | null;
  salesStats: number | null;
  recall: number | null;
  incentives: number | null;
  warranty: number | null;
}

/** Days before each row-sourced fact presents as stale. Registry-backed where the registry has a cadence. */
export const READ_MODEL_TTL_DAYS: ReadModelTtlDays = {
  // The feed runs nightly; one late or refused run must not flip every row to
  // stale, so the window is the registry cadence plus one run.
  feed: Math.max(registryTtlDays("syndication", 1) ?? 1, 2),
  websitePrice: 7,
  factoryDecode: registryTtlDays("neovin", null),
  marketDaysSupply: registryTtlDays("mds", 7),
  salesStats: registryTtlDays("sales_stats", 30),
  recall: registryTtlDays("autorecalls", RECALL_STALE_DAYS),
  incentives: registryTtlDays("incentives_oem", 1),
  warranty: null,
};

// ── Small readers ──────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const money = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return null;
};

/** The provider stamps first_seen_at and last_seen_at as epoch seconds; a row may also carry ISO strings. */
export const providerStamp = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const freshnessOf = (checkedAt: string | null, ttlDays: number | null, nowMs: number): Freshness =>
  resolveFreshness({ checkedAt, ttlDays, nowMs });

/** The public state a sound fact takes from its freshness. A fact with no TTL is current whether or not it carries a date. */
export const stateFromFreshness = (f: Freshness, whenKnown: PublicState = "verified"): PublicState =>
  f.state === "stale" ? "stale" : f.state === "unknown" && f.ttlDays != null ? "unknown" : whenKnown;

export interface ParsedYmm { year: number | null; make: string | null; model: string | null }

export function parseYmm(ymm: string | null | undefined): ParsedYmm {
  const parts = (ymm || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { year: null, make: null, model: null };
  const year = /^\d{4}$/.test(parts[0]) ? Number(parts[0]) : null;
  const rest = year != null ? parts.slice(1) : parts;
  return { year, make: rest[0] ?? null, model: rest.length > 1 ? rest.slice(1).join(" ") : null };
}

// ── Identity and configuration ─────────────────────────────────────────────

const buildSheetOf = (mc: Bag): Bag | null => {
  const sheet = mc.build_sheet;
  return sheet && typeof sheet === "object" && !Array.isArray(sheet) ? (sheet as Bag) : null;
};

const isBasicDecode = (sheet: Bag): boolean => sheet.source === "basic_decode" || sheet.request_tier === "basic_decoder";

/** A basic decoder answer names the trim line, not this VIN's build. */
const decodeLevel = (sheet: Bag | null): IdentityMatchLevel | null =>
  sheet == null ? null : sheet.generic === true ? "GENERIC_CANDIDATE" : isBasicDecode(sheet) ? "YMMT" : "EXACT_VIN";

/**
 * NeoVIN record_confidence is the only numeric whole-record confidence, and the
 * data dictionary defines it as max(0, 100 - penalty): a 0-100 scale. The
 * other *_confidence fields are categorical strings (equipment_code, single,
 * mc_build_specs) and are not numbers to compare. A value outside the declared
 * range keeps its raw form with no numeric interpretation.
 */
export function decodeConfidenceOf(mc: Bag, sheet: Bag): Pick<IdentitySummary, "providerConfidence" | "providerConfidenceRaw" | "providerConfidenceScale"> {
  const c = { ...bag(sheet.confidence), ...bag(mc.neovin_confidence) };
  const raw = c.record_confidence;
  const rawOut = typeof raw === "number" || typeof raw === "string" ? raw : null;
  const n = num(raw);
  if (n == null || n < 0 || n > 100) return { providerConfidence: null, providerConfidenceRaw: rawOut, providerConfidenceScale: "unknown" };
  return { providerConfidence: n / 100, providerConfidenceRaw: rawOut, providerConfidenceScale: "percent_0_100" };
}

const recordSourceOf = (mc: Bag, sheet: Bag): string | null =>
  str(bag(sheet.taxonomy).record_source) ?? str(bag(mc.taxonomy).record_source);

/** build_oem / build_specs are factory build data; *_mc_listing records are assembled from listings. */
export function decodeAuthorityOf(recordSource: string | null): DecodeAuthority {
  const v = (recordSource ?? "").toLowerCase();
  if (/^build_(oem|specs)/.test(v)) return "factory_build";
  if (v.includes("listing")) return "listing_derived";
  return "unknown";
}

const colorName = (v: unknown): string | null => (typeof v === "string" ? str(v) : str(bag(v).name));

export function identityFromRow(row: ListingRowLike, nowMs: number): IdentitySummary {
  const mc = bag(row.mc_attributes);
  const sheet = buildSheetOf(mc);
  const { year, make, model } = parseYmm(row.ymm);

  let matchLevel: IdentityMatchLevel;
  let decodeSource: DecodeSource;
  const decoded = decodeLevel(sheet);
  if (decoded != null) {
    matchLevel = decoded;
    decodeSource = sheet && isBasicDecode(sheet) ? "basic_decode" : "neovin";
  } else if (year != null && make && model) {
    matchLevel = "YMM";
    decodeSource = Object.keys(mc).length ? "feed" : "none";
  } else {
    matchLevel = "UNKNOWN";
    decodeSource = "none";
  }

  const recordSource = sheet ? recordSourceOf(mc, sheet) : null;
  const decodeAuthority: DecodeAuthority = sheet && !isBasicDecode(sheet) ? decodeAuthorityOf(recordSource) : "unknown";
  const exact = sheet != null && mayClaim("exact_trim_version_identity", matchLevel);
  const colors: Bag = exact ? bag(sheet.colors) : {};
  return {
    vin: String(row.vin ?? "").trim().toUpperCase(),
    year,
    make,
    model,
    trim: str(row.trim) ?? str(mc.trim),
    version: exact ? str(sheet.version) ?? str(mc.version) : null,
    drivetrain: str(mc.drivetrain),
    engine: str(mc.engine),
    transmission: str(mc.transmission),
    exteriorColor: colorName(colors.exterior) ?? str(mc.exterior_color) ?? str(mc.base_ext_color),
    interiorColor: colorName(colors.interior) ?? str(mc.interior_color) ?? str(mc.base_int_color),
    mileage: num(row.mileage),
    matchLevel,
    factoryVerified: isExactIdentity(matchLevel) && decodeAuthority === "factory_build",
    decodeSource,
    decodeAuthority,
    recordSource,
    ...(sheet ? decodeConfidenceOf(mc, sheet) : { providerConfidence: null, providerConfidenceRaw: null, providerConfidenceScale: "unknown" as const }),
    freshness: freshnessOf(sheet ? str(sheet.decoded_at) : null, READ_MODEL_TTL_DAYS.factoryDecode, nowMs),
  };
}

const packagesOf = (sheet: Bag): FactoryPackage[] =>
  (Array.isArray(sheet.packages) ? (sheet.packages as unknown[]) : [])
    .map(bag)
    .map((p) => ({ name: str(p.name) ?? str(p.code) ?? "", msrp: money(p.msrp), installed: true }))
    .filter((p) => p.name !== "");

const feedSeenAt = (row: ListingRowLike): string | null => {
  const raw = bag(row.mc_raw);
  return providerStamp(raw.last_seen_at) ?? providerStamp(raw.scraped_at) ?? null;
};

export function msrpFromRow(row: ListingRowLike, nowMs: number): MsrpBreakdown {
  const mc = bag(row.mc_attributes);
  const raw = bag(row.mc_raw);
  const sheet = buildSheetOf(mc);
  const level = decodeLevel(sheet);

  if (sheet && level != null && mayClaim("exact_msrp", level)) {
    const pricing = bag(sheet.pricing);
    const baseMsrp = money(mc.base_msrp) ?? money(pricing.base_msrp);
    const destination = money(mc.delivery_charges) ?? money(pricing.destination_charge);
    const installedOptionsMsrp = money(mc.installed_options_msrp) ?? money(sheet.installed_options_msrp);
    const total = money(mc.total_msrp) ?? money(pricing.total_msrp);
    const configuredMsrp = total ?? (baseMsrp != null ? baseMsrp + (installedOptionsMsrp ?? 0) + (destination ?? 0) : null);
    if (baseMsrp != null || configuredMsrp != null) {
      const freshness = freshnessOf(str(sheet.decoded_at), READ_MODEL_TTL_DAYS.factoryDecode, nowMs);
      return {
        baseMsrp, installedOptionsMsrp, destination, configuredMsrp,
        packages: packagesOf(sheet), source: "neovin", state: stateFromFreshness(freshness), freshness,
      };
    }
  }

  // The listing's own MSRP is the dealer's figure, not a factory decode: a
  // figure to review, never the configuration. A generic decode lands here too.
  const feedMsrp = money(mc.msrp) ?? money(raw.msrp);
  if (feedMsrp != null) {
    return {
      baseMsrp: null, installedOptionsMsrp: null, destination: null, configuredMsrp: feedMsrp, packages: [],
      source: "feed", state: "warning",
      freshness: freshnessOf(feedSeenAt(row) ?? str(row.updated_at), READ_MODEL_TTL_DAYS.feed, nowMs),
    };
  }
  return {
    baseMsrp: null, installedOptionsMsrp: null, destination: null, configuredMsrp: null, packages: [],
    source: "none", state: "unknown", freshness: freshnessOf(null, null, nowMs),
  };
}

// ── Dealer offer and price integrity ───────────────────────────────────────

export function dealerOfferFromRow(row: ListingRowLike, nowMs: number): DealerOfferSummary {
  const mc = bag(row.mc_attributes);
  const raw = bag(row.mc_raw);
  const feedPrice = money(row.price);
  const websitePrice = money(row.website_sale_price);
  const basis = resolveListingFeeBasis({
    price: feedPrice ?? websitePrice ?? undefined,
    fees: mc.fees ?? raw.fees,
    price_includes_fees: mc.price_includes_fees ?? raw.price_includes_fees,
  });
  const channel: PriceChannel | null = feedPrice != null ? "feed" : websitePrice != null ? "website" : null;
  const observedAt =
    channel === "feed" ? feedSeenAt(row) ?? str(row.updated_at)
    : channel === "website" ? str(row.price_last_verified_at)
    : null;
  const ttl = channel === "website" ? READ_MODEL_TTL_DAYS.websitePrice : READ_MODEL_TTL_DAYS.feed;
  const freshness = freshnessOf(observedAt, ttl, nowMs);
  return {
    advertisedPrice: feedPrice ?? websitePrice,
    feeBasis: basis.priceIncludesFees,
    fees: basis.identifiedFees,
    docFee: money(row.doc_fee),
    websiteSalePrice: websitePrice,
    priceTerm: str(row.website_price_term),
    channel,
    observedAt: freshness.checkedAt,
    freshness,
    state: channel ? stateFromFreshness(freshness) : "unknown",
  };
}

export interface PriceIntegrityOptions {
  /** Two channels agree when they differ by no more than this share of the lower price, or this many dollars. */
  tolerance: { pct: number; dollars: number };
  /** A channel observed this many days apart from the other is not comparable with it. */
  staleChannelDays: number;
}

export const PRICE_INTEGRITY_DEFAULTS: PriceIntegrityOptions = {
  tolerance: { pct: 0.01, dollars: 100 },
  staleChannelDays: 3,
};

export function priceIntegrityFromRow(
  row: ListingRowLike,
  opts: Partial<PriceIntegrityOptions> = {},
): PriceIntegritySummary {
  const tol = opts.tolerance ?? PRICE_INTEGRITY_DEFAULTS.tolerance;
  const staleDays = opts.staleChannelDays ?? PRICE_INTEGRITY_DEFAULTS.staleChannelDays;
  const channels: PriceChannelObservation[] = [];
  const feedPrice = money(row.price);
  const websitePrice = money(row.website_sale_price);
  if (feedPrice != null) channels.push({ channel: "feed", price: feedPrice, observedAt: feedSeenAt(row) ?? str(row.updated_at) });
  if (websitePrice != null) channels.push({ channel: "website", price: websitePrice, observedAt: str(row.price_last_verified_at) });

  if (channels.length === 0) return { state: "unknown", channels, maxDeltaDollars: null, reasons: ["no_price_observed_on_any_channel"] };
  if (channels.length === 1) return { state: "single_channel", channels, maxDeltaDollars: null, reasons: [`only_${channels[0].channel}_observed`] };

  const prices = channels.map((c) => c.price);
  const maxDeltaDollars = Math.max(...prices) - Math.min(...prices);
  const stamps = channels.map((c) => (c.observedAt ? Date.parse(c.observedAt) : NaN));
  if (stamps.some((t) => !Number.isFinite(t))) {
    return { state: "stale_channel", channels, maxDeltaDollars, reasons: ["a_channel_has_no_observation_time"] };
  }
  const spreadDays = (Math.max(...stamps) - Math.min(...stamps)) / 86_400_000;
  if (spreadDays > staleDays) {
    const older = channels[stamps.indexOf(Math.min(...stamps))].channel;
    return { state: "stale_channel", channels, maxDeltaDollars, reasons: [`${older}_observation_is_${Math.round(spreadDays)}_days_older`] };
  }
  const allowed = Math.max(tol.dollars, Math.min(...prices) * tol.pct);
  if (maxDeltaDollars <= allowed) return { state: "consistent", channels, maxDeltaDollars, reasons: [] };
  return { state: "channel_mismatch", channels, maxDeltaDollars, reasons: [`channels_differ_by_${Math.round(maxDeltaDollars)}_dollars`] };
}

// ── Availability ───────────────────────────────────────────────────────────

export function availabilityFromRow(row: ListingRowLike, nowMs: number): AvailabilitySummary {
  const mc = bag(row.mc_attributes);
  const raw = bag(row.mc_raw);
  const archived = str(row.archived_at) != null;
  const inTransit = bool(mc.in_transit) ?? bool(raw.in_transit);
  const vehicleStatus = archived ? "archived" : str(mc.vehicle_status) ?? str(raw.vehicle_status);
  const lastSeen = feedSeenAt(row);
  const freshness = freshnessOf(lastSeen, READ_MODEL_TTL_DAYS.feed, nowMs);
  const status = (vehicleStatus ?? "").toLowerCase();
  let state: AvailabilityState;
  if (archived) state = "unknown";
  else if (/sold/.test(status)) state = "sold";
  else if (/pending|hold|deposit/.test(status)) state = "pending";
  else if (inTransit === true) state = "in_transit";
  else if (freshness.state === "current") state = "available";
  else state = "unknown";
  return { state, inTransit, vehicleStatus, lastSeenInFeedAt: lastSeen, freshness };
}

// ── Warranty ───────────────────────────────────────────────────────────────

const termFrom = (name: string, months: unknown, miles: unknown): WarrantyTerm | null => {
  const m = num(months);
  const mi = num(miles);
  if (m == null && mi == null) return null;
  return { name, months: m != null && m > 0 ? m : null, miles: mi != null && mi > 0 ? mi : null };
};

const isTerm = (t: WarrantyTerm | null): t is WarrantyTerm => t != null;

export function warrantyFromRow(row: ListingRowLike, nowMs: number): WarrantySummary {
  const mc = bag(row.mc_attributes);
  const history = bag(row.history_payload);
  const info = bag(row.warranty_info);
  // Listing history (first advertised / first seen) never starts a warranty.
  const inServiceDate = verifiedInServiceDate(row.in_service_date, history) ?? verifiedInServiceDate(info.in_service_date, history);
  // Remaining coverage needs a computation this contract has no fields for
  // yet, so a dated vehicle reports unknown rather than a figure.
  const remaining = (terms: WarrantyTerm[]): WarrantySummary["remainingCoverage"] =>
    !terms.length || inServiceDate ? "unknown" : "not_calculated_without_in_service_date";

  const factory = bag(mc.factory_warranty);
  const factoryTerms = (Array.isArray(factory.terms) ? (factory.terms as unknown[]) : [])
    .map(bag)
    .map((t) => termFrom(str(t.type) ?? str(t.name) ?? "warranty", t.months, t.miles))
    .filter(isTerm);
  if (factoryTerms.length) {
    const freshness = freshnessOf(str(buildSheetOf(mc)?.decoded_at), READ_MODEL_TTL_DAYS.warranty, nowMs);
    return {
      terms: factoryTerms, basis: "original_factory", inServiceDate, remainingCoverage: remaining(factoryTerms),
      source: str(factory.source) ?? "neovin", freshness, state: "verified",
    };
  }

  const infoTerms = [
    termFrom("basic", info.factory_months, info.factory_miles),
    termFrom("powertrain", info.powertrain_months, info.powertrain_miles),
  ].filter(isTerm);
  if (infoTerms.length) {
    return {
      terms: infoTerms, basis: "original_factory", inServiceDate, remainingCoverage: remaining(infoTerms),
      source: "warranty_info", freshness: freshnessOf(str(row.updated_at), READ_MODEL_TTL_DAYS.warranty, nowMs), state: "verified",
    };
  }
  return {
    terms: [], basis: "unknown", inServiceDate, remainingCoverage: "unknown", source: null,
    freshness: freshnessOf(null, null, nowMs), state: "unknown",
  };
}

// ── Market context ─────────────────────────────────────────────────────────

export interface VelocityBands {
  /** Below this many inferred sales the sold figure is too thin to read a velocity from. */
  soldMinCount: number;
  soldDomStrongMaxDays: number;
  soldDomSteadyMaxDays: number;
  mdsStrongMaxDays: number;
  mdsSteadyMaxDays: number;
}

/** Configuration, not UI constants: calibrate before the public lock. */
export const VELOCITY_BANDS: VelocityBands = {
  soldMinCount: 5,
  soldDomStrongMaxDays: 30,
  soldDomSteadyMaxDays: 60,
  mdsStrongMaxDays: 45,
  mdsSteadyMaxDays: 90,
};

const cohortLevel = (v: unknown): CohortMatchLevel | null =>
  typeof v === "string" && (COHORT_MATCH_LEVELS as readonly string[]).includes(v) ? (v as CohortMatchLevel) : null;

const TRENDS: readonly MarketTrend[] = ["rising", "stable", "softening"];
const trendOf = (v: unknown): MarketTrend | null => {
  const token = typeof v === "string" ? v : str(bag(v).trend) ?? str(bag(v).direction);
  const t = (token ?? "").trim().toLowerCase();
  return (TRENDS as readonly string[]).includes(t) ? (t as MarketTrend) : null;
};

export function marketContextFromRow(row: ListingRowLike, nowMs: number, bands: VelocityBands = VELOCITY_BANDS): MarketContextSummary {
  const meta = bag(row.market_meta);
  const cohort = bag(meta.mds_cohort);
  const sold = bag(meta.sold_stats);
  const mdsDays = num(meta.market_days_supply) ?? num(cohort.value);
  const mdsCheckedAt = str(cohort.checked_at) ?? str(meta.checked_at);
  const soldCount = num(sold.count);
  const soldDom = num(sold.dom_median);
  // A make-wide figure is the loosest cohort and says nothing about this model; the enrich writer draws the same line.
  const soldUsable = soldCount != null && soldCount >= bands.soldMinCount && soldDom != null && str(sold.scope) !== "make_state";

  let salesVelocity: SalesVelocity = "unknown";
  let velocityBasis: MarketContextSummary["velocityBasis"] = "none";
  if (soldUsable) {
    salesVelocity = soldDom <= bands.soldDomStrongMaxDays ? "strong" : soldDom <= bands.soldDomSteadyMaxDays ? "steady" : "slow";
    velocityBasis = "inferred_sales_stats";
  } else if (mdsDays != null) {
    salesVelocity = mdsDays <= bands.mdsStrongMaxDays ? "strong" : mdsDays <= bands.mdsSteadyMaxDays ? "steady" : "slow";
    velocityBasis = "mds_estimate";
  }

  const trend = trendOf(meta.trend);
  const freshness =
    mdsDays != null ? freshnessOf(mdsCheckedAt, READ_MODEL_TTL_DAYS.marketDaysSupply, nowMs)
    : velocityBasis === "inferred_sales_stats" ? freshnessOf(str(sold.checked_at), READ_MODEL_TTL_DAYS.salesStats, nowMs)
    : freshnessOf(null, null, nowMs);

  return {
    mdsDays,
    mdsScope: cohortLevel(meta.mds_match_level) ?? cohortLevel(cohort.match_level),
    mdsCheckedAt,
    salesVelocity,
    velocityBasis,
    trend: trend ?? "unknown",
    trendBasis: trend ? "sold_summary" : "none",
    inferredSoldWording: true,
    freshness,
  };
}

// ── Media and incentives ───────────────────────────────────────────────────

export function mediaFromRow(row: ListingRowLike): VehicleMedia {
  const list = Array.isArray(row.photos) ? (row.photos as unknown[]) : [];
  const photos = list
    .map((p) => (typeof p === "string" ? str(p) : str(bag(p).url) ?? str(bag(p).src)))
    .filter((u): u is string => u != null);
  return { heroImageUrl: str(row.hero_image_url) ?? photos[0] ?? null, photoCount: num(row.photo_count) ?? photos.length, photos };
}

/** No incentive is stored on the row today; the model carries an empty list, never an invented offer. */
export function incentivesFromRow(_row: ListingRowLike): IncentiveSummary[] {
  return [];
}

// ── Recall, from the stored columns ────────────────────────────────────────

const ENTITLEMENT_NOTE = /http_40[13]|forbidden|unauthori[sz]ed|not_entitled|entitlement/i;
const UNAVAILABLE_NOTE = /rate_limit|http_429|http_5\d\d|transport_error|timeout|shape_unrecognised|budget_denied|quota|not_configured|unavailable/i;

function recallStatement(
  state: VinRecallContractState,
  truth: RecallVinState,
  view: RecallView,
  closedCount: number | null,
  freshness: Freshness,
): string {
  const date = freshness.checkedAt ? ` as of ${freshness.checkedAt.slice(0, 10)}` : "";
  if (view.doNotDrive) {
    return "A campaign on record carries do-not-drive language; do not rely on this vehicle's recall status until the remedy is recorded.";
  }
  switch (state) {
    case "OPEN": {
      const n = view.vin.openCount;
      return n != null && n > 0
        ? `${n} open recall campaign${n === 1 ? "" : "s"} reported on this VIN${date}.`
        : `An open recall campaign is reported on this VIN${date}.`;
    }
    case "NO_OPEN":
      return `No open recall campaigns reported on this VIN${date}.`;
    case "CLOSED_CAMPAIGN_ONLY":
      return `No open recall campaigns reported on this VIN${date}; ${closedCount} completed campaign${closedCount === 1 ? "" : "s"} on record.`;
    case "ENTITLEMENT_BLOCKED":
      return "VIN-level recall verification is not available on the current data plan.";
    case "PROVIDER_UNAVAILABLE":
      return "The VIN-level recall check did not return an answer, so recall status is not verified.";
    default:
      if (truth === "STALE") {
        return `The last VIN-level recall answer${date} is older than ${freshness.ttlDays ?? RECALL_STALE_DAYS} days; re-check before relying on it.`;
      }
      if (view.conflict) return "Stored records disagree about this VIN's recall status; confirm with the manufacturer before relying on it.";
      if (view.riskSignalled) return "A campaign is reported on this model line; the VIN-level answer is not available.";
      return "No VIN-level recall answer is on record for this vehicle.";
  }
}

export function recallSummaryFromRow(row: ListingRowLike, nowMs: number): RecallSummary {
  const input: RecallRowInput = {
    recall_status: row.recall_status ?? null,
    open_recall_count: row.open_recall_count ?? null,
    closed_recall_count: row.closed_recall_count ?? null,
    recall_checked_at: row.recall_checked_at ?? null,
    recall_payload: row.recall_payload,
    recall_check: row.recall_check,
  };
  const ttl = READ_MODEL_TTL_DAYS.recall ?? RECALL_STALE_DAYS;
  const view = deriveRecallView(input, { now: nowMs, staleDays: ttl });
  const check = bag(row.recall_check);
  const closedCount = row.closed_recall_count ?? num(check.closed_count);
  const note = view.vin.state === "UNKNOWN" ? str(check.note) ?? str(check.error) : null;

  let vinState: VinRecallContractState;
  if (view.vin.state === "OPEN") vinState = "OPEN";
  else if (view.vin.state === "VERIFIED_CLEAR" && view.vin.clearClaimAllowed) vinState = (closedCount ?? 0) > 0 ? "CLOSED_CAMPAIGN_ONLY" : "NO_OPEN";
  else if (note != null && ENTITLEMENT_NOTE.test(note)) vinState = "ENTITLEMENT_BLOCKED";
  else if (note != null && UNAVAILABLE_NOTE.test(note)) vinState = "PROVIDER_UNAVAILABLE";
  else vinState = "UNKNOWN";

  const freshness = freshnessOf(view.vin.checkedAt, ttl, nowMs);
  const publicState: PublicState =
    view.doNotDrive || vinState === "OPEN" ? "adverse"
    : vinState === "NO_OPEN" || vinState === "CLOSED_CAMPAIGN_ONLY" ? stateFromFreshness(freshness)
    : vinState === "ENTITLEMENT_BLOCKED" || vinState === "PROVIDER_UNAVAILABLE" ? "unavailable"
    : view.vin.state === "STALE" ? "stale"
    : view.riskSignalled || view.conflict ? "warning"
    : "unknown";

  return {
    vinState,
    truthState: view.vin.state,
    openCount: view.vin.openCount,
    closedCount,
    modelState: view.model?.state ?? null,
    modelCampaignCount: view.model?.campaignCount ?? null,
    doNotDrive: view.doNotDrive,
    checkedAt: view.vin.checkedAt,
    publicState,
    publicStatement: recallStatement(vinState, view.vin.state, view, closedCount, freshness),
    freshness,
  };
}

/** Everything the row can say on its own, for a builder to assemble. */
export interface ListingFacts {
  version: string;
  identity: IdentitySummary;
  msrp: MsrpBreakdown;
  dealerOffer: DealerOfferSummary;
  priceIntegrity: PriceIntegritySummary;
  availability: AvailabilitySummary;
  warranty: WarrantySummary;
  marketContext: MarketContextSummary;
  media: VehicleMedia;
  incentives: IncentiveSummary[];
  recall: RecallSummary;
}

export function listingFacts(row: ListingRowLike, nowMs: number): ListingFacts {
  return {
    version: LISTING_FACTS_VERSION,
    identity: identityFromRow(row, nowMs),
    msrp: msrpFromRow(row, nowMs),
    dealerOffer: dealerOfferFromRow(row, nowMs),
    priceIntegrity: priceIntegrityFromRow(row),
    availability: availabilityFromRow(row, nowMs),
    warranty: warrantyFromRow(row, nowMs),
    marketContext: marketContextFromRow(row, nowMs),
    media: mediaFromRow(row),
    incentives: incentivesFromRow(row),
    recall: recallSummaryFromRow(row, nowMs),
  };
}

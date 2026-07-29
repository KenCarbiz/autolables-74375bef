// ──────────────────────────────────────────────────────────────────────
// resolveVehicleTruth — the ONE derived model every passport surface reads.
//
// Before this existed, the passport, the Buying Report, the Verification
// Report and the Document Center each re-derived price, savings, verification
// status and document counts from the raw listing. They drifted, and the drift
// was visible to shoppers: the passport said Title & Brand was Pending and
// Vehicle History was Not available while the Buying Report scored the very
// same "History & Title" category 86/100 and called it Strong.
//
// Two rules hold the model together:
//
//   1. A SAVINGS NUMBER IS ALWAYS COMPUTED FROM THE VALUE PRINTED NEXT TO IT.
//      `savingsAgainst()` is the only way to produce one. The live page showed
//      "$3,899 below" (derived from the $42,880 normalized market value) in a
//      row whose comparison column read $39,049 (the comparable listing
//      average) — two different metrics, one displayed and the other used for
//      the arithmetic. Passing the comparison value in makes that impossible.
//
//   2. MISSING EVIDENCE NEVER SCORES. A category whose critical sources have
//      not returned resolves to null with a stated reason, and null renders as
//      "Insufficient data" — never as a fabricated positive.
//
// Nothing here fetches. It is a pure projection over PassportData + the
// listing, so every consumer is deterministic and testable.
// ──────────────────────────────────────────────────────────────────────

import type { PassportData } from "@/lib/passportV2Data";
import { deriveRating, type VehicleRating } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import type { SalePriceCard } from "@/lib/priceModel";
import {
  deriveVerificationReport,
  VERIFICATION_STATUS_LABEL,
  VERIFICATION_CHECK_SHORT_LABEL,
  type VerificationReport,
  type VerificationStatus,
  type ReportCheck,
} from "@/lib/passport/verificationSummary";

// ── Money ─────────────────────────────────────────────────────────────
// One formatter. Whole dollars: cents on a $38,981 vehicle price are noise,
// and a stray toFixed(2) elsewhere is how two surfaces start disagreeing.
export const fmtMoney = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

// ── Market metrics ────────────────────────────────────────────────────
// The two market figures are genuinely different measurements and are never
// interchangeable:
//
//   normalized market value    — the provider's VIN-level predicted value for
//                                THIS vehicle (listing.market_value).
//   comparable listing average — the median/mean asking price of the comps we
//                                actually pulled (market_meta.price_median).
//
// They differed by ~$3,800 on the reference vehicle. Labelling either as the
// other is what produced the impossible savings claim.
export type MarketMetricKey = "normalized_market_value" | "comparable_listing_average" | "msrp";

export const MARKET_METRIC_LABEL: Record<MarketMetricKey, string> = {
  normalized_market_value: "Normalized market value",
  comparable_listing_average: "Comparable listing average",
  msrp: "Factory MSRP",
};

export interface MarketMetric {
  key: MarketMetricKey;
  label: string;
  value: number | null;
  /** How many comparable listings back this figure, when it is a sample. */
  sampleSize: number | null;
  checkedAt: string | null;
}

/**
 * The ONLY way to produce a savings claim.
 *
 * Takes the comparison value the UI is about to print and derives the delta
 * from it, so "X below" can never be computed against a number the shopper
 * cannot see. Returns null unless the vehicle is genuinely cheaper — an
 * at-or-above-market car gets no green badge.
 */
export function savingsAgainst(comparisonValue: number | null, price: number | null): number | null {
  if (comparisonValue == null || price == null) return null;
  if (!Number.isFinite(comparisonValue) || !Number.isFinite(price)) return null;
  const delta = Math.round(comparisonValue) - Math.round(price);
  return delta > 0 ? delta : null;
}

export interface SavingsClaim {
  /** Which metric the claim is measured against — printed with the number. */
  basis: MarketMetricKey;
  basisLabel: string;
  comparisonValue: number;
  price: number;
  amount: number;
  /** e.g. "$3,899 below the normalized market value". Never bare "$3,899 below". */
  sentence: string;
}

/**
 * Build a fully self-describing savings claim, or null. The basis label always
 * travels with the amount so a claim cannot be re-displayed beside a different
 * metric.
 */
export function buildSavingsClaim(metric: MarketMetric, price: number | null): SavingsClaim | null {
  const amount = savingsAgainst(metric.value, price);
  if (amount == null || metric.value == null || price == null) return null;
  return {
    basis: metric.key,
    basisLabel: metric.label,
    comparisonValue: metric.value,
    price,
    amount,
    sentence: `${fmtMoney(amount)} below the ${metric.label.toLowerCase()}`,
  };
}

// ── Category confidence ───────────────────────────────────────────────
export interface CategoryConfidence {
  key: string;
  label: string;
  /** null = not scoreable. Never substitute a default. */
  score: number | null;
  /** Band name, or "Insufficient data" when score is null and evidence is missing. */
  tierLabel: string;
  /** Critical sources that have not returned, in customer wording. */
  blockedBy: string[];
  evidence: string[];
}

// ── Documents ─────────────────────────────────────────────────────────
// "Available" and "verified" are different claims and were being shown as one:
// the Document Center listed records as available beside a "0 verified" count.
export type DocumentAvailability =
  | "available_now"      // we hold the file and can serve it
  | "external_source"    // it exists, on the manufacturer's or provider's site
  | "signed"             // a customer-signed record
  | "requested"          // the shopper asked for it
  | "not_available";     // no record

export interface DocumentTruthCounts {
  availableNow: number;
  externalSource: number;
  signed: number;
  requested: number;
  dealerProvided: number;
  vinSpecific: number;
  verified: number;
  /** Everything a shopper can act on right now. */
  total: number;
}

// ── Source recency ────────────────────────────────────────────────────
// A report generated today does not mean its sources were checked today. Each
// source carries its own date, and a source with no date says so.
export interface SourceRecency {
  key: string;
  label: string;
  checkedAt: string | null;
  /** True when the source has been consulted but not since `staleAfterDays`. */
  stale: boolean;
  /** True when a refresh is queued but has not landed. */
  pending: boolean;
}

export interface VehicleTruth {
  // Pricing
  price: SalePriceCard | null;
  advertisedPrice: number | null;
  vehicleSellingPrice: number | null;
  docFee: number | null;
  totalAdvertisedPrice: number | null;

  // Market
  normalizedMarketValue: MarketMetric;
  comparableListingAverage: MarketMetric;
  /** The metric the headline savings claim is measured against, if any. */
  headlineSavings: SavingsClaim | null;

  // Verification
  verification: VerificationReport;
  checkByKey: (key: string) => ReportCheck | null;
  statusLabel: (s: VerificationStatus) => string;
  shortLabel: (key: string) => string;

  // Scoring
  rating: VehicleRating;
  historyAndTitle: CategoryConfidence;

  // Recency
  sources: SourceRecency[];
  generatedAt: string;

  // Documents
  documents: DocumentTruthCounts;
}

const DAY_MS = 86_400_000;

function marketMetric(
  key: MarketMetricKey,
  value: number | null,
  sampleSize: number | null,
  checkedAt: string | null,
): MarketMetric {
  return {
    key,
    label: MARKET_METRIC_LABEL[key],
    value: value != null && Number.isFinite(value) && value > 0 ? value : null,
    sampleSize,
    checkedAt,
  };
}

/**
 * Project the authoritative truth model for one vehicle.
 *
 * `nowMs` is injected rather than read from the clock so staleness is
 * deterministic under test.
 */
export function resolveVehicleTruth(
  d: PassportData,
  listing: VehicleListing,
  opts?: { nowMs?: number; staleAfterDays?: number },
): VehicleTruth {
  const nowMs = opts?.nowMs ?? Date.now();
  const staleAfterDays = opts?.staleAfterDays ?? 30;

  const price = buildPassportSaleCard(d, (listing as { condition?: string }).condition);
  const verification = deriveVerificationReport(d, listing);
  const rating = deriveRating(listing, d);

  const normalizedMarketValue = marketMetric(
    "normalized_market_value",
    d.marketAvg,
    null,
    d.marketCheckedAt,
  );
  const comparableListingAverage = marketMetric(
    "comparable_listing_average",
    d.marketMeta.priceMedian ?? d.marketMeta.priceMean,
    d.marketMeta.similarCount,
    d.marketMeta.checkedAt ?? d.marketCheckedAt,
  );

  // The headline claim prefers the normalized VIN-level value (it is the
  // stronger measurement) but is always derived from whichever metric it names.
  const headlineSavings =
    buildSavingsClaim(normalizedMarketValue, d.price) ??
    buildSavingsClaim(comparableListingAverage, d.price);

  const historyFactor = rating.factors.find((f) => f.key === "history") ?? null;
  const historyAndTitle: CategoryConfidence = {
    key: "history",
    label: "History & Title",
    score: historyFactor?.score ?? null,
    tierLabel:
      historyFactor?.score != null
        ? d.confLabel
        : d.confBlockedBy.length
          ? "Insufficient data"
          : "Not applicable",
    blockedBy: d.confBlockedBy,
    evidence: historyFactor?.evidence ?? [],
  };

  const sources: SourceRecency[] = verification.sources.map((s) => ({
    key: s.family,
    label: s.label,
    checkedAt: s.checkedAt,
    stale: !!s.checkedAt && nowMs - Date.parse(s.checkedAt) > staleAfterDays * DAY_MS,
    pending: !s.checkedAt,
  }));

  return {
    price,
    advertisedPrice: d.price,
    vehicleSellingPrice: price?.vehicleSellingPrice ?? null,
    docFee: d.docFee,
    totalAdvertisedPrice: price?.totalAdvertisedPrice ?? null,

    normalizedMarketValue,
    comparableListingAverage,
    headlineSavings,

    verification,
    checkByKey: (key) => verification.checks.find((c) => c.key === key) ?? null,
    statusLabel: (s) => VERIFICATION_STATUS_LABEL[s],
    shortLabel: (key) => VERIFICATION_CHECK_SHORT_LABEL[key] ?? key,

    rating,
    historyAndTitle,

    sources,
    generatedAt: new Date(nowMs).toISOString(),

    documents: countDocumentTruth(listing),
  };
}

/**
 * Count what the Document Center is actually holding, by claim type. Every
 * badge and count on that surface reads these fields so a record cannot be
 * "available" in the list and absent from the count.
 */
export function countDocumentTruth(listing: VehicleListing): DocumentTruthCounts {
  const docs = ((listing.documents as { type?: string; name?: string; url?: string; verified?: boolean; vin_specific?: boolean }[] | undefined) || [])
    .filter((x) => x?.name && x?.url);

  const signed = docs.filter((x) => /sign|addendum|disclosure/i.test(String(x.type || ""))).length;
  const verified = docs.filter((x) => x.verified === true).length;
  const vinSpecific = docs.filter((x) => x.vin_specific === true || /window_sticker|factory_sticker|carfax|autocheck/i.test(String(x.type || ""))).length;

  const external = [
    (listing as { oem_brochure?: { url?: string } }).oem_brochure?.url,
    (listing as { oem_owners_manual?: { url?: string } }).oem_owners_manual?.url,
    listing.history_report_url,
    listing.oem_sticker_url,
  ].filter(Boolean).length;

  return {
    availableNow: docs.length - signed,
    externalSource: external,
    signed,
    requested: 0,
    dealerProvided: docs.length,
    vinSpecific,
    verified,
    total: docs.length + external,
  };
}

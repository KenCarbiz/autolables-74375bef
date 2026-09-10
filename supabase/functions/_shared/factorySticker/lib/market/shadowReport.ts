// GENERATED — do not edit.
// Mirror of src/lib/market/shadowReport.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Shadow fleet report ────────────────────────────────────────────────────
//
// Reads what production holds, computes V2 beside it, writes nothing.
//
// The point is not to show that V2 produces different numbers. It is to
// measure, per vehicle and then across the lot, exactly WHICH of the known
// defects each car is carrying — CPO flattening, a fee-inclusive comparison,
// the dealer's own inventory inside its own market, duplicate VINs, one
// rooftop owning the sample, a stale valuation, three surfaces disagreeing —
// so the owner can see the size of each before approving a rollout, and so
// the provider spend needed to fix them is a number rather than a guess.

import { buildMarketView } from "./marketView.ts";
import { legacyComparableToCandidate, stripListingConditionPrefix, type LegacyComparableRow } from "./legacyAdapter.ts";
import { parseYmm } from "../ymm.ts";
import { contradictoryVerdicts, legacyMarketView, type LegacyListingFields } from "./surfaceCompat.ts";
import { resolvePriceBasis } from "./priceBasis.ts";
import { buildPredictionRequest } from "./providerAdapter.ts";
import { canonicalizeComparable } from "./comparables.ts";
import type { TenantDealerIdentity } from "./dealerIdentity.ts";
import type { MandatoryAddOnAnswer } from "./priceBasis.ts";
import type { MarketView, ProviderValuation, SubjectCondition } from "./types.ts";

/** What one vehicle looks like coming out of `vehicle_listings`. */
export interface ShadowListingRow {
  vin: string;
  ymm?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  drivetrain?: string | null;
  condition?: string | null;
  mileage?: number | null;
  price?: number | null;
  advertised_price_before_doc?: number | null;
  website_sale_price?: number | null;
  doc_fee?: number | null;
  advertised_excludes_doc_fee?: boolean | null;
  market_value?: number | null;
  market_position?: string | null;
  market_checked_at?: string | null;
  market_payload?: Record<string, unknown> | null;
  market_meta?: Record<string, unknown> | null;
  comparables?: LegacyComparableRow[] | null;
  zip?: string | null;
  dealer_name?: string | null;
}

export interface ShadowOptions {
  identity: TenantDealerIdentity;
  dealerType: "franchise" | "independent" | null;
  zip: string | null;
  nowMs: number;
  /** Per-VIN cost of one provider call, for the budget estimate. */
  providerCallCostUsd: number;
  /**
   * The tenant's DEFAULT mandatory dealer add-on answer, applied to every
   * vehicle in the run. Omitted or unverified means the question has not been
   * answered, which yields an ambiguous price basis rather than an assumed
   * zero.
   */
  mandatoryAddOns?: MandatoryAddOnAnswer | null;
}

export interface ShadowVehicleResult {
  vin: string;
  legacy: {
    view: MarketView;
    storedPosition: string | null;
    storedMarketValue: number | null;
    displayedDifference: number | null;
  };
  v2: MarketView;
  findings: string[];
  verdictChanged: boolean;
  redSuppressed: boolean;
  dollarChange: number | null;
  percentChange: number | null;
  needsProviderCall: boolean;
}

export const SHADOW_FINDINGS = [
  "cpo_flattened_to_used",
  "price_basis_fee_inclusive_comparison",
  "price_basis_unverified",
  "own_rooftop_in_market",
  "own_group_in_market",
  "duplicate_vin",
  "dealer_concentration_over_cap",
  "stale_valuation",
  "missing_certification_on_comparables",
  "missing_dealer_identity_on_comparables",
  "missing_history_on_comparables",
  "no_stored_comparables",
  "provider_request_not_reconstructable",
  "provider_source_not_recorded",
  "contradictory_surface_directions",
  "contradictory_surface_amounts",
  "surfaces_agree",
  "mandatory_add_on_treatment_unknown",
  "insufficient_market_diversity",
] as const;

export type ShadowFinding = (typeof SHADOW_FINDINGS)[number];

const conditionOf = (v: unknown): SubjectCondition | null =>
  v === "new" || v === "used" || v === "cpo" ? v : null;

/**
 * Structured identity for the subject.
 *
 * Stored columns first; the shared parser only when the row has nothing else,
 * because splitting a display string is how "Alfa Romeo" became make "Alfa".
 */
export function subjectIdentity(row: ShadowListingRow): { year: number | null; make: string | null; model: string | null } {
  if (row.year != null || row.make || row.model) {
    return { year: row.year ?? null, make: row.make ?? null, model: row.model ?? null };
  }
  const parsed = parseYmm(stripListingConditionPrefix(row.ymm));
  return {
    year: /^\d{4}$/.test(parsed.year) ? Number(parsed.year) : null,
    make: parsed.make || null,
    model: parsed.model || null,
  };
}

/** Rebuild the ProviderValuation a legacy market_payload stands for. */
export function legacyProviderValuation(row: ShadowListingRow): ProviderValuation | null {
  const mp = row.market_payload ?? {};
  const value = Number(row.market_value ?? (mp as { marketValue?: unknown }).marketValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const checkedAt = String((mp as { checked_at?: unknown }).checked_at ?? row.market_checked_at ?? "");
  const raw = (mp as { raw?: Record<string, unknown> }).raw ?? {};
  const specs = (raw.specs ?? {}) as Record<string, unknown>;
  const echo = typeof specs.is_certified === "boolean" ? specs.is_certified : null;
  return {
    provider: "marketcheck",
    // Legacy rows came from the old predict path; naming it truthfully is what
    // lets the report count how many vehicles need the corrected endpoint.
    endpointVersion: "legacy/predict/car/price",
    selectedField: "predicted_price",
    predictedValue: value,
    providerRangeLow: Number((mp as { low?: unknown }).low) || null,
    providerRangeHigh: Number((mp as { high?: unknown }).high) || null,
    providerRangeMeaning: "Provider Estimated Range",
    providerCertifiedEcho: echo,
    requestFingerprint: "legacy-unreconstructable",
    responseHash: "legacy",
    requestedAt: checkedAt,
    receivedAt: checkedAt,
    rawResponseSanitized: raw,
  };
}

export function shadowVehicle(row: ShadowListingRow, opts: ShadowOptions): ShadowVehicleResult {
  const findings: string[] = [];
  const condition = conditionOf(row.condition);
  const comparables = Array.isArray(row.comparables) ? row.comparables : [];

  const legacyFields: LegacyListingFields = {
    price: row.price,
    advertised_price_before_doc: row.advertised_price_before_doc,
    website_sale_price: row.website_sale_price,
    doc_fee: row.doc_fee,
    advertised_excludes_doc_fee: row.advertised_excludes_doc_fee,
    market_value: row.market_value,
    market_position: row.market_position,
    market_checked_at: row.market_checked_at,
    market_meta: row.market_meta as LegacyListingFields["market_meta"],
  };
  const legacyView = legacyMarketView(legacyFields, "dealer_inventory");

  const basis = resolvePriceBasis({
    price: row.price,
    advertisedPriceBeforeDoc: row.advertised_price_before_doc,
    websiteSalePrice: row.website_sale_price,
    docFee: row.doc_fee,
    advertisedExcludesDocFee: row.advertised_excludes_doc_fee,
    tenantMandatoryAddOns: opts.mandatoryAddOns,
  });

  // ── Findings ────────────────────────────────────────────────────────────
  const provider = legacyProviderValuation(row);
  if (condition === "cpo" && provider && provider.providerCertifiedEcho !== true) {
    findings.push("cpo_flattened_to_used");
  }
  if (basis.basisStatus !== "verified") findings.push("price_basis_unverified");
  if (basis.advertisedIncludesDocFee === true && basis.docFee != null && basis.docFee > 0) {
    findings.push("price_basis_fee_inclusive_comparison");
  }
  if (!comparables.length) findings.push("no_stored_comparables");
  if (provider && provider.requestFingerprint === "legacy-unreconstructable") {
    findings.push("provider_request_not_reconstructable");
  }
  const rawProvider = (row.market_payload ?? {}) as { rawProvider?: unknown; source?: unknown };
  if (provider && rawProvider.rawProvider == null && rawProvider.source == null) {
    findings.push("provider_source_not_recorded");
  }
  if (row.market_checked_at) {
    const ageDays = (opts.nowMs - Date.parse(row.market_checked_at)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > 14) findings.push("stale_valuation");
  }

  const canonical = comparables.map((c) => canonicalizeComparable(legacyComparableToCandidate(c), opts.identity));
  if (canonical.some((c) => c.ownership === "own_rooftop")) findings.push("own_rooftop_in_market");
  if (canonical.some((c) => c.ownership === "own_group")) findings.push("own_group_in_market");
  const vins = canonical.map((c) => c.vin).filter(Boolean);
  if (new Set(vins).size !== vins.length) findings.push("duplicate_vin");
  if (canonical.some((c) => c.certified == null)) findings.push("missing_certification_on_comparables");
  if (canonical.some((c) => c.identityConfidence === "none")) findings.push("missing_dealer_identity_on_comparables");
  if (canonical.some((c) => c.historyStatus === "unknown")) findings.push("missing_history_on_comparables");

  const disagreement = contradictoryVerdicts(legacyFields);
  if (disagreement.directionalContradiction) findings.push("contradictory_surface_directions");
  if (disagreement.numericContradiction) findings.push("contradictory_surface_amounts");
  if (!disagreement.contradictory && Object.values(disagreement.surfaces).some((c) => c.direction !== "none")) {
    findings.push("surfaces_agree");
  }
  if (basis.mandatoryAddOnSource === "unknown") findings.push("mandatory_add_on_treatment_unknown");

  // ── V2, shadow ──────────────────────────────────────────────────────────
  const { view: v2 } = buildMarketView({
    subject: {
      vin: row.vin,
      ...subjectIdentity(row),
      trim: row.trim ?? null, drivetrain: row.drivetrain ?? null, powertrain: null,
      mileage: row.mileage ?? null, certified: condition === "cpo" ? true : condition === null ? null : false,
      price: row.price, advertisedPriceBeforeDoc: row.advertised_price_before_doc,
      websiteSalePrice: row.website_sale_price, docFee: row.doc_fee,
      advertisedExcludesDocFee: row.advertised_excludes_doc_fee,
      tenantMandatoryAddOns: opts.mandatoryAddOns,
      dealerType: opts.dealerType, zip: row.zip ?? opts.zip,
    },
    condition,
    candidates: comparables.map((c) => legacyComparableToCandidate(c)),
    identity: opts.identity,
    provider,
    nowMs: opts.nowMs,
  });

  if (v2.confidenceReasons.includes("insufficient_market_diversity")) {
    findings.push("insufficient_market_diversity");
  }

  const built = buildPredictionRequest({
    vin: row.vin, mileage: row.mileage, condition,
    dealerType: opts.dealerType, zip: row.zip ?? opts.zip,
  });

  const dollarChange = v2.difference != null && legacyView.difference != null
    ? v2.difference - legacyView.difference : null;

  return {
    vin: row.vin,
    legacy: {
      view: legacyView,
      storedPosition: row.market_position ?? null,
      storedMarketValue: row.market_value ?? null,
      displayedDifference: legacyView.difference,
    },
    v2,
    findings: [...new Set(findings)],
    verdictChanged: legacyView.verdict !== v2.verdict,
    redSuppressed: legacyView.verdict === "High End of Adjusted Market"
      && (v2.confidence === "unavailable" || v2.confidence === "low"),
    dollarChange,
    percentChange: legacyView.difference != null && legacyView.difference !== 0 && dollarChange != null
      ? dollarChange / Math.abs(legacyView.difference) : null,
    // A corrected provider call is needed when the request can be built AND
    // the stored answer cannot stand: wrong certification, expired, or absent.
    needsProviderCall: built.request != null
      && (findings.includes("cpo_flattened_to_used")
        || findings.includes("stale_valuation")
        || provider == null),
  };
}

export interface FleetShadowReport {
  generatedAt: string;
  engineVersion: string;
  totalEvaluated: number;
  available: number;
  limited: number;
  unavailable: number;
  findingCounts: Record<string, number>;
  verdictChanges: number;
  redSuppressed: number;
  largestDollarChanges: { vin: string; from: number | null; to: number | null; change: number }[];
  largestPercentChanges: { vin: string; percent: number }[];
  providerCallsRequired: number;
  providerBudgetUsd: number;
  blockedByConfiguration: string[];
  perVehicle: ShadowVehicleResult[];
}

export function shadowFleet(
  rows: ShadowListingRow[],
  opts: ShadowOptions,
  generatedAt: string,
  engineVersion: string,
): FleetShadowReport {
  const perVehicle = rows.map((r) => shadowVehicle(r, opts));
  const findingCounts: Record<string, number> = {};
  for (const f of SHADOW_FINDINGS) findingCounts[f] = 0;
  for (const v of perVehicle) for (const f of v.findings) findingCounts[f] = (findingCounts[f] ?? 0) + 1;

  const withDollar = perVehicle
    .filter((v) => v.dollarChange != null)
    .sort((a, b) => Math.abs(b.dollarChange!) - Math.abs(a.dollarChange!))
    .slice(0, 10)
    .map((v) => ({ vin: v.vin, from: v.legacy.displayedDifference, to: v.v2.difference, change: v.dollarChange! }));

  const withPercent = perVehicle
    .filter((v) => v.percentChange != null)
    .sort((a, b) => Math.abs(b.percentChange!) - Math.abs(a.percentChange!))
    .slice(0, 10)
    .map((v) => ({ vin: v.vin, percent: v.percentChange! }));

  const blocked: string[] = [];
  if (!opts.dealerType) blocked.push("tenant dealer_type is not configured; no provider request can be built");
  if (!opts.identity.rooftopIds?.length && !opts.identity.dealerIds?.length && !opts.identity.domains?.length) {
    blocked.push("tenant has no stable dealer identity; own-inventory exclusion falls back to name matching");
  }

  const providerCallsRequired = perVehicle.filter((v) => v.needsProviderCall).length;

  return {
    generatedAt,
    engineVersion,
    totalEvaluated: perVehicle.length,
    available: perVehicle.filter((v) => v.v2.status === "available").length,
    limited: perVehicle.filter((v) => v.v2.status === "limited").length,
    unavailable: perVehicle.filter((v) => v.v2.status === "unavailable").length,
    findingCounts,
    verdictChanges: perVehicle.filter((v) => v.verdictChanged).length,
    redSuppressed: perVehicle.filter((v) => v.redSuppressed).length,
    largestDollarChanges: withDollar,
    largestPercentChanges: withPercent,
    providerCallsRequired,
    providerBudgetUsd: Math.round(providerCallsRequired * opts.providerCallCostUsd * 100) / 100,
    blockedByConfiguration: blocked,
    perVehicle,
  };
}

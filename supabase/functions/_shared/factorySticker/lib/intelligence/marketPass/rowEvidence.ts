// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/rowEvidence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── MarketPass: stored evidence read off one vehicle_listings row ──────────
//
// Pure readers. Nothing here fetches, and nothing calls a provider: the
// assessment is built only from what the sync, enrich, valuation and title
// writers have already stored. Where a column's provider meaning is not
// verified, the reader says so instead of guessing.

import { legacyComparableToCandidate, type LegacyComparableRow } from "../../market/legacyAdapter.ts";
import { buildMarketView, type MarketEngineResult } from "../../market/marketView.ts";
import { resolveDealerType } from "../../market/providerAdapter.ts";
import { parseConfiguredBoolean, resolveDocFeeTreatment } from "../../market/priceBasis.ts";
import { groupIdsKnown, tenantIdentityStability, type TenantDealerIdentity } from "../../market/dealerIdentity.ts";
import type { ComparableCandidate, ProviderValuation } from "../../market/types.ts";
import type { ComparableEvidence, ProviderPredictionEvidence } from "../marketValueV3.ts";
import { classifyTitleOdometer, type TitleReportInput } from "../titleOdometer.ts";
import type { DocumentationFacts } from "../vehicleScore.ts";
import {
  resolveFreshness,
  type ConditionSummary, type OdometerReading, type ProvenanceSummary, type TitleOdometerSummary,
} from "../contracts.ts";
import { parseYmm, type ListingFacts, type ListingRowLike } from "../readModels/listingFacts.ts";

/** The columns the assessment reads. `view_count` is listed only so a test can prove it is ignored. */
export interface MarketPassRow extends ListingRowLike {
  id?: string | null;
  tenant_id?: string | null;
  slug?: string | null;
  status?: string | null;
  market_value?: number | string | null;
  market_payload?: unknown;
  market_checked_at?: string | null;
  comparables?: unknown;
  title_verification?: unknown;
  view_count?: number | null;
}

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
const stampOf = (v: unknown): string | null => {
  const s = str(v);
  if (s == null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const DAY_MS = 86_400_000;

// ── Title and odometer ─────────────────────────────────────────────────────

/** Adverse or doubtful title signals the listing feed carries; never NMVTIS evidence. */
export interface FeedHistoryFlags {
  /** A non-clean title brand string on the feed (mc_attributes.title_brand / title_status). */
  titleBrand: string | null;
  /** CARFAX clean-title flag explicitly false. Its provider meaning is not documented, so it means "review", not "branded". */
  carfaxCleanTitleFalse: boolean;
  /** Accident count on the feed. No writer populates it today; read so a value, if one appears, is never ignored. */
  accidentCount: number | null;
}

export function feedHistoryFlags(row: MarketPassRow): FeedHistoryFlags {
  const mc = bag(row.mc_attributes);
  const brandRaw = str(mc.title_brand) ?? str(mc.title_status);
  const titleBrand = brandRaw && !/^clean/i.test(brandRaw) ? brandRaw : null;
  const accidents = num(mc.accident_count);
  return {
    titleBrand,
    carfaxCleanTitleFalse: mc.carfax_clean_title === false,
    accidentCount: accidents != null && accidents >= 0 ? accidents : null,
  };
}

/**
 * The dealer's NMVTIS attestation (vehicle_listings.title_verification) is the
 * only stored title evidence; the report body is never persisted. A branded
 * attestation is adverse. A clean one carries no odometer reading, which the
 * classifier reports as needing review; the assessment treats that as an
 * evidence gap, not a finding.
 */
export function titleOdometerFromRow(row: MarketPassRow, nowMs: number): TitleOdometerSummary {
  const tv = bag(row.title_verification);
  const status = str(tv.status);
  const verifiedAt = stampOf(tv.verified_at);
  const reportDate = stampOf(tv.report_generated_at) ?? verifiedAt;
  // The listing feed's odometer is one reading from a source that can
  // mistype; on its own it would read as a "consistent" chronology, which is
  // not an odometer check. Only dated readings from stronger sources belong.
  const otherReadings: OdometerReading[] = [];

  let report: TitleReportInput;
  if ((status === "clean" || status === "branded") && reportDate) {
    report = {
      outcome: "answered",
      reportDate,
      checkedAt: verifiedAt ?? reportDate,
      brands: status === "branded" ? [{ brand: str(tv.brand_note) ?? "Title brand reported", date: reportDate }] : [],
      junkSalvageTotalLoss: [],
      odometerReadings: [],
      complete: true,
      source: "dealer_nmvtis_attestation",
    };
  } else {
    report = { outcome: "not_requested" };
  }
  return classifyTitleOdometer({ report, otherReadings, nowMs });
}

// ── Condition, provenance, documentation: no stored reader yet ─────────────

export function unknownCondition(nowMs: number): ConditionSummary {
  return {
    state: "unknown", source: "none", inspectionDate: null, tires32nds: [], brakesMm: [], openItems: null,
    completedRecon: null, findings: [], reasons: ["no_inspection_reader_on_listing_row"],
    freshness: resolveFreshness({ checkedAt: null, ttlDays: null, nowMs }),
  };
}

export function unknownProvenance(nowMs: number): ProvenanceSummary {
  return {
    designation: "unknown", soldHere: null, servicedHere: null, serviceVisits: null, serviceShare: null,
    yearsKnown: null, autofilmInspections: null, directTrade: null, facts: [], source: "none",
    freshness: resolveFreshness({ checkedAt: null, ttlDays: null, nowMs }),
  };
}

export function documentationFromFacts(facts: ListingFacts): DocumentationFacts {
  return {
    serviceRecordCount: null,
    inspectionEvidenceOnFile: null,
    warrantyDocumented: facts.warranty.terms.length ? true : null,
    windowStickerOnFile: null,
  };
}

// ── Comparable selection, as the writer recorded it ────────────────────────

/**
 * `market_meta.comp_selection` is the record a comparable writer leaves to say
 * how it chose the rows. Only an explicit `price_independent: true` lets the
 * set count as evidence about the asking price. Rows written before the
 * record existed were selected inside a band built from the subject's own
 * price (vehicle-enrich price_range 0.65x-1.35x, marketcheck-comps 1.0x-1.35x).
 */
export interface ComparableSelectionRecord {
  selection: "price_independent" | "conditioned_on_subject_price" | "not_recorded";
  totalSearchMatches: number | null;
  radiusMiles: number | null;
  zip: string | null;
  retrievedAt: string | null;
}

export function comparableSelectionFromRow(row: MarketPassRow): ComparableSelectionRecord {
  const meta = bag(row.market_meta);
  const rec = bag(meta.comp_selection);
  const flag = rec.price_independent;
  return {
    selection: flag === true ? "price_independent" : flag === false ? "conditioned_on_subject_price" : "not_recorded",
    totalSearchMatches: num(rec.total_matches) ?? num(meta.similar_count),
    radiusMiles: num(rec.radius_miles),
    zip: str(rec.zip),
    retrievedAt: stampOf(rec.checked_at) ?? stampOf(meta.search_checked_at) ?? stampOf(meta.checked_at),
  };
}

const readBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Legacy stored row to engine candidate, plus the normalized keys a newer writer may add. */
export function storedComparableToCandidate(raw: unknown, observedAt: string | null): ComparableCandidate {
  const r = bag(raw);
  const base = legacyComparableToCandidate(r as LegacyComparableRow, { observedAt });
  const certified = readBool(r.certified) ?? readBool(r.is_certified);
  const docFeeIncluded = readBool(r.doc_fee_included);
  return {
    ...base,
    ...(certified != null ? { certified } : {}),
    ...(docFeeIncluded != null ? { docFeeIncluded, docFee: num(r.doc_fee) } : {}),
    ...(str(r.drivetrain) ? { drivetrain: str(r.drivetrain) } : {}),
    ...(str(r.dealer_id) ? { dealerId: str(r.dealer_id) } : {}),
  };
}

// ── The market engine over stored evidence ─────────────────────────────────

const isProviderValuation = (v: unknown): v is ProviderValuation => {
  const b = bag(v);
  return typeof b.predictedValue === "number" && Number.isFinite(b.predictedValue) && typeof b.receivedAt === "string";
};

export interface StoredMarketEvidence {
  engine: MarketEngineResult;
  candidateCount: number;
  selection: ComparableSelectionRecord;
  comparables: ComparableEvidence | null;
  provider: ProviderPredictionEvidence | null;
  /** Our receipt time of the stored prediction, not the provider's data time. */
  providerRetrievedAt: string | null;
  reasons: string[];
}

export function storedMarketEvidence(row: MarketPassRow, settings: unknown, facts: ListingFacts, nowMs: number): StoredMarketEvidence {
  const s = bag(settings);
  const mc = bag(row.mc_attributes);
  const build = bag(bag(row.mc_raw).build);
  const ymm = parseYmm(row.ymm);
  const condition = row.condition === "new" || row.condition === "used" || row.condition === "cpo" ? row.condition : null;
  const docFee = resolveDocFeeTreatment(settings);
  const selection = comparableSelectionFromRow(row);
  const payload = bag(row.market_payload);
  const stored = isProviderValuation(payload.provider_valuation) ? payload.provider_valuation : null;
  const candidates = (Array.isArray(row.comparables) ? row.comparables : [])
    .map((c) => storedComparableToCandidate(c, selection.retrievedAt));
  const identity = bag(s.dealer_identity) as TenantDealerIdentity;
  const reasons: string[] = [];

  const engine = buildMarketView({
    subject: {
      vin: row.vin,
      year: ymm.year ?? num(mc.year),
      make: ymm.make ?? str(build.make),
      model: ymm.model ?? str(build.model),
      trim: str(row.trim),
      drivetrain: str(mc.drivetrain) ?? str(build.drivetrain),
      powertrain: null,
      mileage: num(row.mileage),
      certified: condition === "cpo" ? true : condition === null ? null : false,
      price: num(row.price),
      advertisedPriceBeforeDoc: num(row.advertised_price_before_doc),
      websiteSalePrice: num(row.website_sale_price),
      docFee: num(row.doc_fee),
      advertisedExcludesDocFee: docFee.advertisedExcludesDocFee,
      tenantMandatoryAddOns: {
        amountUsd: num(s.mandatory_add_ons_usd),
        verified: parseConfiguredBoolean(s.mandatory_add_ons_verified) === true,
        includedInDisplayedPrice: parseConfiguredBoolean(s.mandatory_add_ons_included_in_displayed_price),
      },
      dealerType: resolveDealerType(settings),
      zip: str(s.dealer_zip),
    },
    condition,
    candidates,
    identity,
    provider: stored,
    materialContradictions: [],
    nowMs,
  });
  const ex = engine.explanation;

  const primary = ex.comparables.filter((c) => c.inclusionStatus === "primary");
  const comparables: ComparableEvidence | null = candidates.length ? {
    stats: ex.stats,
    winningTier: ex.winningTier,
    relaxationSteps: ex.relaxationSteps,
    feeNormalized: primary.length > 0 && primary.every((c) => c.priceBasisStatus === "verified"),
    priceBasis: ex.priceBasis,
    groupIdentityKnown: groupIdsKnown(ex.comparables),
    tenantIdentityStability: tenantIdentityStability(identity),
    concentrationUnderAllocated: ex.stats.insufficientMarketDiversity,
    materialContradictions: [],
    selection: selection.selection,
  } : null;

  let provider: ProviderPredictionEvidence | null = null;
  if (stored) {
    const ageDays = (nowMs - Date.parse(stored.receivedAt)) / DAY_MS;
    let validation = ex.providerValidation;
    // A used vehicle's prediction above its own original factory sticker is a
    // provider answer for some other configuration or a data error.
    const msrp = facts.msrp.source === "neovin" ? facts.msrp.configuredMsrp : null;
    if (condition !== "new" && msrp != null && stored.predictedValue > msrp) {
      validation = { usable: false, rejections: [...validation.rejections, "implausible_prediction"], cautions: [...validation.cautions, "prediction_exceeds_original_factory_msrp"] };
      reasons.push("provider_prediction_exceeds_original_factory_msrp");
    }
    provider = { valuation: stored, validation, ageDays: Number.isFinite(ageDays) ? ageDays : null };
  }

  return {
    engine, candidateCount: candidates.length, selection, comparables, provider,
    providerRetrievedAt: stored ? stampOf(stored.receivedAt) : null, reasons,
  };
}

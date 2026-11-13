// ── MarketPass V2 assessment: the one authoritative result ─────────────────
//
// Built server-side from one vehicle_listings row and the dealer's settings.
// AutoLabels and AutoFilm render the contract this returns; neither
// recomputes a score. Every indicator carries its own version, and the
// envelope carries the computation time and a digest of the inputs read.

import { digest } from "../../market/hash.ts";
import { isExactIdentity } from "../../market/identityMatch.ts";
import { buildDataConfidence } from "../dataConfidence.ts";
import { listingFacts, READ_MODEL_TTL_DAYS, providerStamp } from "../readModels/listingFacts.ts";
import { isNewCondition } from "../readModels/shared.ts";
import { resolveFreshness } from "../contracts.ts";
import {
  MARKETPASS_ASSESSMENT_VERSION, MARKETPASS_DATA_CONFIDENCE_VERSION, MARKETPASS_RULES_STATUS,
  type DataConfidenceAssessment, type EvidenceProvenance, type MarketPassAssessment, type VehicleType,
} from "./contracts.ts";
import { buildMarketDesirability } from "./marketDesirability.ts";
import { buildPriceFairness } from "./priceFairness.ts";
import {
  documentationFromFacts, feedHistoryFlags, storedMarketEvidence, titleOdometerFromRow,
  unknownCondition, unknownProvenance, type MarketPassRow,
} from "./rowEvidence.ts";
import { buildVehicleConfidence } from "./vehicleConfidence.ts";

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const stamp = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null;
};

/** The settings keys the assessment reads; anything else in the blob is ignored and never hashed. */
const SETTINGS_KEYS = [
  "advertised_includes_doc_fee", "advertised_excludes_doc_fee", "mandatory_add_ons_usd", "mandatory_add_ons_verified",
  "mandatory_add_ons_included_in_displayed_price", "dealer_type", "dealer_zip", "dealer_identity",
] as const;

/** The row columns the assessment reads; view_count is deliberately absent. */
const ROW_KEYS = [
  "vin", "ymm", "trim", "mileage", "condition", "price", "advertised_price_before_doc", "doc_fee", "website_sale_price",
  "website_price_term", "price_last_verified_at", "mc_attributes", "market_meta", "market_payload", "comparables",
  "recall_status", "recall_checked_at", "open_recall_count", "closed_recall_count", "recall_check", "recall_payload",
  "history_payload", "warranty_info", "in_service_date", "title_verification", "updated_at", "archived_at",
] as const;

export function assessmentInputsHash(row: MarketPassRow, settings: unknown): string {
  const r = row as unknown as Bag;
  const s = bag(settings);
  const rawSeen = bag(row.mc_raw);
  return digest({
    v: MARKETPASS_ASSESSMENT_VERSION,
    row: Object.fromEntries(ROW_KEYS.map((k) => [k, r[k] ?? null])),
    feed: { last_seen_at: rawSeen.last_seen_at ?? null, build: rawSeen.build ?? null, in_transit: rawSeen.in_transit ?? null, vehicle_status: rawSeen.vehicle_status ?? null },
    settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, s[k] ?? null])),
  });
}

function evidenceFor(row: MarketPassRow, nowMs: number, facts: ReturnType<typeof listingFacts>, providerRetrievedAt: string | null, compsRetrievedAt: string | null): EvidenceProvenance[] {
  const meta = bag(row.market_meta);
  const sold = bag(meta.sold_stats);
  const tv = bag(row.title_verification);
  const f = (checkedAt: string | null, ttl: number | null) => resolveFreshness({ checkedAt, ttlDays: ttl, nowMs }).state;
  const sheet = bag(bag(row.mc_attributes).build_sheet);
  const out: EvidenceProvenance[] = [
    {
      key: "asking_price", label: "Advertised price", source: facts.dealerOffer.channel,
      authority: "provider_listing", retrievedAt: stamp(row.updated_at), observedAt: providerStamp(bag(row.mc_raw).last_seen_at),
      freshness: facts.dealerOffer.freshness.state, ttlDays: facts.dealerOffer.freshness.ttlDays, meaningVerified: true,
    },
  ];
  if (providerRetrievedAt) out.push({
    key: "provider_estimate", label: "MarketCheck VIN price estimate", source: "marketcheck_price_prediction",
    authority: "market_evidence", retrievedAt: providerRetrievedAt, observedAt: null,
    freshness: f(providerRetrievedAt, 14), ttlDays: 14, meaningVerified: true,
  });
  if (Array.isArray(row.comparables) && row.comparables.length) out.push({
    key: "comparables", label: "Comparable active listings", source: "marketcheck_active_search",
    authority: "market_evidence", retrievedAt: compsRetrievedAt, observedAt: null,
    freshness: f(compsRetrievedAt, 7), ttlDays: 7, meaningVerified: true,
  });
  if (meta.market_days_supply != null) {
    const at = stamp(meta.mds_checked_at) ?? stamp(meta.checked_at);
    out.push({
      key: "market_days_supply", label: "Market days supply", source: "marketcheck_mds", authority: "market_evidence",
      retrievedAt: at, observedAt: null, freshness: f(at, READ_MODEL_TTL_DAYS.marketDaysSupply), ttlDays: READ_MODEL_TTL_DAYS.marketDaysSupply, meaningVerified: false,
    });
  }
  if (sold.count != null) {
    const at = stamp(sold.checked_at);
    out.push({
      key: "inferred_sold_stats", label: "Inferred sold listings", source: str(sold.source), authority: "market_evidence",
      retrievedAt: at, observedAt: null, freshness: f(at, READ_MODEL_TTL_DAYS.salesStats), ttlDays: READ_MODEL_TTL_DAYS.salesStats, meaningVerified: false,
    });
  }
  out.push({
    key: "recall", label: "VIN recall check", source: str(bag(row.recall_check).source), authority: "manufacturer",
    retrievedAt: facts.recall.checkedAt, observedAt: null, freshness: facts.recall.freshness.state, ttlDays: facts.recall.freshness.ttlDays, meaningVerified: true,
  });
  if (facts.identity.decodeSource !== "none") out.push({
    key: "factory_decode", label: "Factory build decode", source: facts.identity.decodeSource, authority: "manufacturer",
    retrievedAt: stamp(sheet.decoded_at), observedAt: null, freshness: facts.identity.freshness.state, ttlDays: facts.identity.freshness.ttlDays, meaningVerified: true,
  });
  if (str(tv.status)) out.push({
    key: "title", label: "NMVTIS title check (dealer attestation)", source: "dealer_nmvtis_attestation", authority: "government_record",
    retrievedAt: stamp(tv.verified_at), observedAt: stamp(tv.report_generated_at), freshness: f(stamp(tv.verified_at), 90), ttlDays: 90, meaningVerified: true,
  });
  return out;
}

export interface MarketPassAssessmentInput {
  row: MarketPassRow;
  settings: unknown;
  nowMs: number;
}

/**
 * PROPOSED: the advertised trim disagrees with the factory build record. Only
 * read when the decode is exact; every advertised trim word must appear in the
 * decoded version, so "SPORT" against "SPORT AWD" agrees and "SPORT" against
 * "BASE FWD" does not.
 */
export function identityConflicts(advertisedTrim: string | null | undefined, identity: { version: string | null; matchLevel: string }): string[] {
  const words = (v: string | null | undefined) => (v ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const trim = words(advertisedTrim);
  const version = new Set(words(identity.version));
  if (!trim.length || !version.size || !isExactIdentity(identity.matchLevel as Parameters<typeof isExactIdentity>[0])) return [];
  return trim.every((w) => version.has(w)) ? [] : ["trim_decode_conflict"];
}

export function buildMarketPassAssessment(input: MarketPassAssessmentInput): MarketPassAssessment {
  const { row, settings, nowMs } = input;
  const vehicleType: VehicleType = isNewCondition(row.condition) ? "new" : "used";
  const facts = listingFacts(row, nowMs);
  const titleOdometer = titleOdometerFromRow(row, nowMs);
  const condition = unknownCondition(nowMs);
  const provenance = unknownProvenance(nowMs);
  const documentation = documentationFromFacts(facts);
  const market = storedMarketEvidence(row, settings, facts, nowMs);
  const evidence = evidenceFor(row, nowMs, facts, market.providerRetrievedAt, market.selection.retrievedAt);

  const dc = buildDataConfidence({
    vehicleType, identity: facts.identity, titleOdometer, condition, provenance, recall: facts.recall, documentation,
    conflicts: identityConflicts(row.trim, facts.identity),
  });
  const dataConfidence: DataConfidenceAssessment = {
    indicator: "data_confidence",
    version: MARKETPASS_DATA_CONFIDENCE_VERSION,
    moduleVersion: dc.version,
    vehicleType,
    score: dc.coveragePct,
    level: dc.level,
    label: dc.level === "high" ? "High evidence coverage" : dc.level === "moderate" ? "Moderate evidence coverage" : "Limited evidence coverage",
    domainCoverage: dc.domainCoverage,
    conflicts: dc.conflicts,
    staleFacts: dc.staleFacts,
    reasons: dc.reasons,
  };

  return {
    assessmentVersion: MARKETPASS_ASSESSMENT_VERSION,
    rulesStatus: MARKETPASS_RULES_STATUS,
    computedAt: new Date(nowMs).toISOString(),
    inputsHash: assessmentInputsHash(row, settings),
    vehicle: { vin: facts.identity.vin, vehicleType, tenantId: row.tenant_id ?? null, slug: row.slug ?? null },
    priceFairness: buildPriceFairness({ vehicleType, facts, market, nowMs, evidence }),
    vehicleConfidence: buildVehicleConfidence({
      vehicleType, identity: facts.identity, titleOdometer, feedFlags: feedHistoryFlags(row), condition, provenance,
      recall: facts.recall, documentation, dataConfidence: dc, evidence,
    }),
    marketDesirability: buildMarketDesirability({ vehicleType, marketMeta: row.market_meta, nowMs, evidence }),
    dataConfidence,
  };
}

// ── MarketCheck provider adapter ───────────────────────────────────────────
//
// The QX50 defect in one line: the request said `car_type=used`.
//
// AutoLabels stored `condition = cpo` correctly — the feed sent
// `is_certified = 1` and `classifyCondition` did its job. The pricing request
// then threw that away, because the legacy endpoint took a `car_type` and
// nobody mapped certification onto it. MarketCheck priced an ordinary used
// QX50, returned 39,158, and the dealer screen subtracted that from a
// fee-inclusive 43,876 and printed "$4,718 Above Market" about a certified car
// that was never valued as one.
//
// Two rules follow and neither is negotiable:
//
//   1. A CPO subject sends is_certified=true. `car_type=used` is not a
//      substitute for certification and never was.
//   2. A response that came back for the wrong certification cannot be
//      repaired by arithmetic. It is quarantined as provider_input_mismatch
//      and the valuation is unavailable until the car is re-priced correctly.
//
// This module is pure: it builds a request, parses a response and judges both.
// Nothing here performs I/O, so it runs in a test, in the browser and in Deno,
// and no test can accidentally spend money.

import { digest, stableStringify } from "./hash.ts";
import {
  type DealerType,
  type MarketPredictionRequest,
  type ProviderRejectionCode,
  type ProviderResponseField,
  type ProviderValidation,
  type ProviderValuation,
  type SubjectCondition,
} from "./types.ts";

/**
 * The documented United States price-prediction endpoint.
 * https://docs.marketcheck.com/docs/api/cars/market-insights/marketcheck-price
 */
export const MARKETCHECK_PREDICT_PATH = "/v2/predict/car/us/marketcheck_price";
export const MARKETCHECK_ENDPOINT_VERSION = "us/marketcheck_price@2026-09";
export const MARKETCHECK_REQUEST_VERSION = "v2.0.0";

/** The optional Premium comparables endpoint. Behind a flag; never called without owner approval. */
export const MARKETCHECK_COMPARABLES_PATH = "/v2/predict/car/us/marketcheck_price/comparables";

/** How old a provider answer may be before it is only context, and before it is nothing. */
export const PROVIDER_FRESH_DAYS = 7;
export const PROVIDER_HARD_EXPIRY_DAYS = 14;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const MIN_MILES = 0;
const MAX_MILES = 500_000;
const MIN_PREDICTION = 500;
const MAX_PREDICTION = 5_000_000;

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};

// ── Tenant dealer type ─────────────────────────────────────────────────────

export function isDealerType(v: unknown): v is DealerType {
  return v === "franchise" || v === "independent";
}

/**
 * Read the tenant's dealer type. Returns null when it has not been configured.
 *
 * Deliberately no default. `dealer_type` moves the prediction — a franchise
 * rooftop and an independent lot are not priced alike — so defaulting every
 * tenant to franchise would silently mis-price every independent dealer we
 * ever sign, and it would look like it worked. An unconfigured tenant gets no
 * valuation until somebody answers the question.
 */
export function resolveDealerType(settings: unknown): DealerType | null {
  const v = (settings as { dealer_type?: unknown } | null | undefined)?.dealer_type;
  return isDealerType(v) ? v : null;
}

// ── Request ────────────────────────────────────────────────────────────────

export interface SubjectForPrediction {
  vin: string | null | undefined;
  mileage: number | null | undefined;
  condition: SubjectCondition | null | undefined;
  dealerType: DealerType | null | undefined;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface BuiltRequest {
  request: MarketPredictionRequest | null;
  /** Query parameters WITHOUT the api key. This is what gets stored. */
  sanitizedParams: Record<string, string>;
  requestFingerprint: string | null;
  path: string;
  blockers: ProviderRejectionCode[];
}

/**
 * CPO is a grade of used, and the certification flag is the only thing that
 * tells the provider so. Mapping cpo -> is_certified=true is the whole fix.
 */
export const isCertifiedForCondition = (condition: SubjectCondition): boolean => condition === "cpo";

export function buildPredictionRequest(subject: SubjectForPrediction): BuiltRequest {
  const blockers: ProviderRejectionCode[] = [];
  const vin = String(subject.vin ?? "").trim().toUpperCase();
  const miles = num(subject.mileage);
  const condition = subject.condition ?? null;
  const dealerType = isDealerType(subject.dealerType) ? subject.dealerType : null;
  const zip = String(subject.zip ?? "").trim() || null;
  const city = String(subject.city ?? "").trim() || null;
  const state = String(subject.state ?? "").trim() || null;

  if (!VIN_RE.test(vin)) blockers.push("invalid_vin");
  if (miles == null) blockers.push("missing_mileage");
  else if (miles < MIN_MILES || miles > MAX_MILES) blockers.push("implausible_mileage");
  if (!dealerType) blockers.push("missing_dealer_type");
  if (!zip && !(city && state)) blockers.push("missing_location");

  if (blockers.length || condition == null || miles == null || !dealerType) {
    return { request: null, sanitizedParams: {}, requestFingerprint: null, path: MARKETCHECK_PREDICT_PATH, blockers };
  }

  const request: MarketPredictionRequest = {
    vin,
    miles,
    dealerType,
    ...(zip ? { zip } : {}),
    ...(!zip && city ? { city } : {}),
    ...(!zip && state ? { state } : {}),
    isCertified: isCertifiedForCondition(condition),
    subjectCondition: condition,
    requestVersion: MARKETCHECK_REQUEST_VERSION,
  };

  const sanitizedParams: Record<string, string> = {
    vin,
    miles: String(miles),
    dealer_type: dealerType,
    is_certified: request.isCertified ? "true" : "false",
    ...(zip ? { zip } : {}),
    ...(!zip && city ? { city } : {}),
    ...(!zip && state ? { state } : {}),
  };

  return {
    request,
    sanitizedParams,
    requestFingerprint: digest({ path: MARKETCHECK_PREDICT_PATH, params: sanitizedParams, v: MARKETCHECK_REQUEST_VERSION }),
    path: MARKETCHECK_PREDICT_PATH,
    blockers: [],
  };
}

/**
 * The URL a caller would fetch. The api key is passed separately and is never
 * part of the fingerprint or of anything stored.
 */
export function predictionUrl(base: string, params: Record<string, string>, apiKey: string): string {
  const qs = new URLSearchParams({ ...params, api_key: apiKey });
  return `${base.replace(/\/+$/, "")}${MARKETCHECK_PREDICT_PATH}?${qs.toString()}`;
}

/** Anything that looks like a credential is stripped before a response is stored. */
const SECRET_KEY_RE = /api[_-]?key|apikey|authorization|token|secret|password|bearer/i;

export function sanitizeForAudit(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = sanitizeForAudit(v, depth + 1);
    else if (Array.isArray(v)) out[k] = v.slice(0, 50);
    else out[k] = v;
  }
  return out;
}

// ── Response ───────────────────────────────────────────────────────────────

/** Current field first, then the legacy one, then documented aliases. */
const PREDICTION_FIELDS: { field: ProviderResponseField; read: (b: Record<string, unknown>) => unknown }[] = [
  { field: "marketcheck_price", read: (b) => b.marketcheck_price },
  { field: "predicted_price", read: (b) => b.predicted_price },
  { field: "price", read: (b) => b.price },
  { field: "market_price", read: (b) => b.market_price },
  { field: "mean_price", read: (b) => b.mean_price },
  { field: "price_stats.mean", read: (b) => (b.price_stats as Record<string, unknown> | undefined)?.mean },
];

const readRange = (b: Record<string, unknown>): { low: number | null; high: number | null; meaning: string | null } => {
  const pr = (b.price_range ?? {}) as Record<string, unknown>;
  const stats = (b.price_stats ?? {}) as Record<string, unknown>;
  const low = num(pr.lower_bound ?? pr.low ?? b.min_price ?? stats.min);
  const high = num(pr.upper_bound ?? pr.high ?? b.max_price ?? stats.max);
  // The provider does not document this as a calibrated interval, so we do not
  // call it one. Section 18.
  const meaning = low != null || high != null ? "Provider Estimated Range" : null;
  return { low, high, meaning };
};

/**
 * Certification as the response reports it — three states, never two.
 *
 * A missing echo is `null`, and null is not false. The current endpoint is not
 * documented to echo the flag back at all, so treating its absence as "the
 * provider says not certified" would quarantine every correct CPO request we
 * ever make.
 */
export function readCertifiedEcho(body: Record<string, unknown>): boolean | null {
  const specs = (body.specs ?? {}) as Record<string, unknown>;
  for (const v of [body.is_certified, specs.is_certified, (body.build as Record<string, unknown> | undefined)?.is_certified]) {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
  }
  return null;
}

/**
 * A three-state read of a provider history field.
 *
 * `carfax_clean_title: false` is NOT proof of a branded title. Providers emit
 * false for "no report available" as readily as for an adverse finding, and no
 * contract we hold says which. A customer-facing claim of damage — or of
 * cleanliness — cannot rest on that.
 */
export function readHistoryFlag(v: unknown): boolean | "unknown" {
  if (typeof v === "boolean") return v ? true : "unknown";
  if (v === "true" || v === 1) return true;
  return "unknown";
}

export interface ParsedProviderResponse {
  valuation: ProviderValuation | null;
  parseErrors: ProviderRejectionCode[];
}

export function parsePredictionResponse(args: {
  body: unknown;
  requestFingerprint: string;
  requestedAt: string;
  receivedAt: string;
}): ParsedProviderResponse {
  const parseErrors: ProviderRejectionCode[] = [];
  const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? args.body
    : {}) as Record<string, unknown>;

  let selectedField: ProviderResponseField | null = null;
  let predictedValue: number | null = null;
  for (const candidate of PREDICTION_FIELDS) {
    const v = num(candidate.read(body));
    if (v != null) { selectedField = candidate.field; predictedValue = v; break; }
  }

  if (predictedValue == null || selectedField == null) {
    parseErrors.push("missing_prediction");
    return { valuation: null, parseErrors };
  }
  if (predictedValue < MIN_PREDICTION || predictedValue > MAX_PREDICTION) {
    parseErrors.push("implausible_prediction");
    return { valuation: null, parseErrors };
  }

  const { low, high, meaning } = readRange(body);
  if (low != null && high != null && low > high) parseErrors.push("inverted_range");

  const sanitized = sanitizeForAudit(body);

  return {
    valuation: {
      provider: "marketcheck",
      endpointVersion: MARKETCHECK_ENDPOINT_VERSION,
      selectedField,
      predictedValue,
      providerRangeLow: parseErrors.includes("inverted_range") ? null : low,
      providerRangeHigh: parseErrors.includes("inverted_range") ? null : high,
      providerRangeMeaning: meaning,
      providerCertifiedEcho: readCertifiedEcho(body),
      requestFingerprint: args.requestFingerprint,
      responseHash: fnvOf(sanitized),
      requestedAt: args.requestedAt,
      receivedAt: args.receivedAt,
      rawResponseSanitized: sanitized,
    },
    parseErrors,
  };
}

const fnvOf = (v: unknown): string => digest(v);

// ── Validation ─────────────────────────────────────────────────────────────

export interface ProviderValidationInput {
  subject: SubjectForPrediction;
  built: BuiltRequest;
  valuation: ProviderValuation | null;
  parseErrors?: ProviderRejectionCode[];
  /** Specification fields the provider echoed, when it echoes any. */
  providerSpecs?: { year?: unknown; make?: unknown; model?: unknown; vin?: unknown } | null;
  /** Structured subject identity. Never a whitespace split of the display `ymm`. */
  subjectYear?: number | null;
  subjectMake?: string | null;
  subjectModel?: string | null;
  nowMs: number;
}

const sameText = (a: unknown, b: unknown): boolean => {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const x = norm(a); const y = norm(b);
  return !x || !y || x === y;
};

/**
 * Decide whether a stored provider answer may be used for a conclusion.
 *
 * Rejections make the valuation unavailable. Cautions leave it usable and cost
 * it confidence — the difference between "this answer is about a different
 * car" and "this answer may be about the right car and we cannot prove it".
 */
export function validateProviderValuation(input: ProviderValidationInput): ProviderValidation {
  const rejections: ProviderRejectionCode[] = [...input.built.blockers, ...(input.parseErrors ?? [])];
  const cautions: string[] = [];
  const { valuation, subject } = input;

  if (!valuation) {
    if (!rejections.includes("missing_prediction")) rejections.push("missing_prediction");
    return { usable: false, rejections: unique(rejections), cautions };
  }

  if (!valuation.requestFingerprint) rejections.push("unreconstructable_request");

  // Certification. The request is the evidence we control; the echo is a bonus.
  const wantsCertified = subject.condition === "cpo";
  const requestedCertified = input.built.request?.isCertified ?? null;

  if (wantsCertified && requestedCertified === false) {
    rejections.push("provider_input_mismatch");
  }
  if (wantsCertified && valuation.providerCertifiedEcho === false) {
    // The response is explicitly about a non-certified car. Whatever we asked,
    // this number is not a CPO valuation.
    rejections.push("provider_input_mismatch");
  }
  if (!wantsCertified && valuation.providerCertifiedEcho === true) {
    rejections.push("provider_certification_conflict");
  }
  if (wantsCertified && valuation.providerCertifiedEcho == null) {
    cautions.push("provider_did_not_echo_certification");
  }

  // Specification agreement, when the provider says anything about the car.
  const specs = input.providerSpecs;
  if (specs) {
    const vinMatches = !specs.vin || String(specs.vin).toUpperCase() === (input.built.request?.vin ?? "");
    const yearMatches = specs.year == null || String(specs.year) === String(input.subjectYear ?? specs.year);
    if (!vinMatches || !yearMatches || !sameText(specs.make, input.subjectMake) || !sameText(specs.model, input.subjectModel)) {
      rejections.push("specification_conflict");
    }
  }

  // Age.
  const receivedMs = Date.parse(valuation.receivedAt);
  if (Number.isFinite(receivedMs)) {
    const ageDays = (input.nowMs - receivedMs) / 86_400_000;
    if (ageDays > PROVIDER_HARD_EXPIRY_DAYS) rejections.push("stale_response");
    else if (ageDays > PROVIDER_FRESH_DAYS) cautions.push("provider_answer_older_than_seven_days");
  } else {
    rejections.push("unreconstructable_request");
  }

  if (valuation.providerRangeLow == null || valuation.providerRangeHigh == null) {
    cautions.push("provider_range_incomplete");
  }
  if (valuation.selectedField !== "marketcheck_price") {
    cautions.push(`provider_field_fallback_${valuation.selectedField}`);
  }

  return { usable: rejections.length === 0, rejections: unique(rejections), cautions };
}

const unique = <T,>(xs: T[]): T[] => [...new Set(xs)];

/** Reconstruct the exact request a stored valuation came from, for the audit view. */
export function describeStoredRequest(params: Record<string, string> | null | undefined): string {
  if (!params) return "unavailable";
  return stableStringify(params);
}


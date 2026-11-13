// GENERATED — do not edit.
// Mirror of src/lib/market/providerAdapter.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { digest, stableStringify } from "./hash.ts";
import { providerRequestFingerprint } from "./fingerprints.ts";
import { type DealerType, type MarketPredictionRequest, type ProviderRejectionCode, type ProviderResponseField, type ProviderValidation, type ProviderValuation, type SubjectCondition, } from "./types.ts";
export const MARKETCHECK_PREDICT_PATH = "/v2/predict/car/us/marketcheck_price";
export const MARKETCHECK_ENDPOINT_VERSION = "us/marketcheck_price@2026-09";
export const MARKETCHECK_REQUEST_VERSION = "v2.0.0";
export const MARKETCHECK_COMPARABLES_PATH = "/v2/predict/car/us/marketcheck_price/comparables";
export const PROVIDER_FRESH_DAYS = 7;
export const PROVIDER_HARD_EXPIRY_DAYS = 14;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const MIN_MILES = 0;
const MAX_MILES = 500000;
const MIN_PREDICTION = 500;
const MAX_PREDICTION = 5000000;
const num = (v: unknown): number | null => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const n = Number(v.replace(/[$,\s]/g, ""));
        return Number.isFinite(n) && v.trim() !== "" ? n : null;
    }
    return null;
};
export function isDealerType(v: unknown): v is DealerType {
    return v === "franchise" || v === "independent";
}
export function resolveDealerType(settings: unknown): DealerType | null {
    const v = (settings as {
        dealer_type?: unknown;
    } | null | undefined)?.dealer_type;
    return isDealerType(v) ? v : null;
}
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
    sanitizedParams: Record<string, string>;
    requestFingerprint: string | null;
    path: string;
    blockers: ProviderRejectionCode[];
}
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
    if (!VIN_RE.test(vin))
        blockers.push("invalid_vin");
    if (miles == null)
        blockers.push("missing_mileage");
    else if (miles < MIN_MILES || miles > MAX_MILES)
        blockers.push("implausible_mileage");
    if (!dealerType)
        blockers.push("missing_dealer_type");
    if (!zip && !(city && state))
        blockers.push("missing_location");
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
        requestFingerprint: providerRequestFingerprint({
            provider: "marketcheck",
            endpointVersion: MARKETCHECK_ENDPOINT_VERSION,
            vin,
            miles,
            dealerType,
            zip,
            city: zip ? null : city,
            state: zip ? null : state,
            isCertified: request.isCertified,
            requestVersion: MARKETCHECK_REQUEST_VERSION,
        }),
        path: MARKETCHECK_PREDICT_PATH,
        blockers: [],
    };
}
export function predictionUrl(base: string, params: Record<string, string>, apiKey: string): string {
    const qs = new URLSearchParams({ ...params, api_key: apiKey });
    return `${base.replace(/\/+$/, "")}${MARKETCHECK_PREDICT_PATH}?${qs.toString()}`;
}
const SECRET_KEY_RE = /api[_-]?key|apikey|authorization|token|secret|password|bearer/i;
export function sanitizeForAudit(value: unknown, depth = 0): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6)
        return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_RE.test(k))
            continue;
        if (v && typeof v === "object" && !Array.isArray(v))
            out[k] = sanitizeForAudit(v, depth + 1);
        else if (Array.isArray(v))
            out[k] = v.slice(0, 50);
        else
            out[k] = v;
    }
    return out;
}
const PREDICTION_FIELDS: {
    field: ProviderResponseField;
    read: (b: Record<string, unknown>) => unknown;
}[] = [
    { field: "marketcheck_price", read: (b) => b.marketcheck_price },
    { field: "predicted_price", read: (b) => b.predicted_price },
    { field: "price", read: (b) => b.price },
    { field: "market_price", read: (b) => b.market_price },
    { field: "mean_price", read: (b) => b.mean_price },
    { field: "price_stats.mean", read: (b) => (b.price_stats as Record<string, unknown> | undefined)?.mean },
];
const readRange = (b: Record<string, unknown>): {
    low: number | null;
    high: number | null;
    meaning: string | null;
} => {
    const pr = (b.price_range ?? {}) as Record<string, unknown>;
    const stats = (b.price_stats ?? {}) as Record<string, unknown>;
    const low = num(pr.lower_bound ?? pr.low ?? b.min_price ?? stats.min);
    const high = num(pr.upper_bound ?? pr.high ?? b.max_price ?? stats.max);
    const meaning = low != null || high != null ? "Provider Estimated Range" : null;
    return { low, high, meaning };
};
export function readCertifiedEcho(body: Record<string, unknown>): boolean | null {
    const specs = (body.specs ?? {}) as Record<string, unknown>;
    for (const v of [body.is_certified, specs.is_certified, (body.build as Record<string, unknown> | undefined)?.is_certified]) {
        if (typeof v === "boolean")
            return v;
        if (v === "true" || v === 1)
            return true;
        if (v === "false" || v === 0)
            return false;
    }
    return null;
}
export function readHistoryFlag(v: unknown): boolean | "unknown" {
    if (typeof v === "boolean")
        return v ? true : "unknown";
    if (v === "true" || v === 1)
        return true;
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
        if (v != null) {
            selectedField = candidate.field;
            predictedValue = v;
            break;
        }
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
    if (low != null && high != null && low > high)
        parseErrors.push("inverted_range");
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
export interface ProviderValidationInput {
    subject: SubjectForPrediction;
    built: BuiltRequest;
    valuation: ProviderValuation | null;
    parseErrors?: ProviderRejectionCode[];
    providerSpecs?: {
        year?: unknown;
        make?: unknown;
        model?: unknown;
        vin?: unknown;
    } | null;
    subjectYear?: number | null;
    subjectMake?: string | null;
    subjectModel?: string | null;
    nowMs: number;
}
const sameText = (a: unknown, b: unknown): boolean => {
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const x = norm(a);
    const y = norm(b);
    return !x || !y || x === y;
};
export function validateProviderValuation(input: ProviderValidationInput): ProviderValidation {
    const rejections: ProviderRejectionCode[] = [...input.built.blockers, ...(input.parseErrors ?? [])];
    const cautions: string[] = [];
    const { valuation, subject } = input;
    if (!valuation) {
        if (!rejections.includes("missing_prediction"))
            rejections.push("missing_prediction");
        return { usable: false, rejections: unique(rejections), cautions };
    }
    if (!valuation.requestFingerprint)
        rejections.push("unreconstructable_request");
    const wantsCertified = subject.condition === "cpo";
    const requestedCertified = input.built.request?.isCertified ?? null;
    if (wantsCertified && requestedCertified === false) {
        rejections.push("provider_input_mismatch");
    }
    if (wantsCertified && valuation.providerCertifiedEcho === false) {
        rejections.push("provider_input_mismatch");
    }
    if (!wantsCertified && valuation.providerCertifiedEcho === true) {
        rejections.push("provider_certification_conflict");
    }
    if (wantsCertified && valuation.providerCertifiedEcho == null) {
        cautions.push("provider_did_not_echo_certification");
    }
    const specs = input.providerSpecs;
    if (specs) {
        const vinMatches = !specs.vin || String(specs.vin).toUpperCase() === (input.built.request?.vin ?? "");
        const yearMatches = specs.year == null || String(specs.year) === String(input.subjectYear ?? specs.year);
        if (!vinMatches || !yearMatches || !sameText(specs.make, input.subjectMake) || !sameText(specs.model, input.subjectModel)) {
            rejections.push("specification_conflict");
        }
    }
    const receivedMs = Date.parse(valuation.receivedAt);
    if (Number.isFinite(receivedMs)) {
        const ageDays = (input.nowMs - receivedMs) / 86400000;
        if (ageDays > PROVIDER_HARD_EXPIRY_DAYS)
            rejections.push("stale_response");
        else if (ageDays > PROVIDER_FRESH_DAYS)
            cautions.push("provider_answer_older_than_seven_days");
    }
    else {
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
export function describeStoredRequest(params: Record<string, string> | null | undefined): string {
    if (!params)
        return "unavailable";
    return stableStringify(params);
}

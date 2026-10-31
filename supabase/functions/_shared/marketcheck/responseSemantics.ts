// What a MarketCheck answer means, kept apart from what it costs. Pure.
//
//  * classifyDecode: one of nine reason-specific states, so an invalid or
//    unsupported VIN is never asked again and an unavailable one waits.
//  * confidence: a provider's record confidence describes the decode, not the
//    truth of every field, and its scale (0–1 or 0–100) is detected per
//    answer, never assumed.
//  * dates: the dataset's delivery_date is when the provider produced the
//    data, not the vehicle's delivery or the warranty in-service date.
//  * quota headers: read only headers that are present; a reset is accepted
//    only as an absolute time or an explicit delta, never by guessing a zone.

export type DecodeState =
  | "complete" | "partial" | "ambiguous" | "invalid_vin" | "unsupported"
  | "unavailable" | "temporarily_failed" | "budget_blocked" | "billing_uncertain";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** North-American check digit. Only format is enforced for non-NA VINs. */
export function vinLooksValid(vin: string): { valid: boolean; checkDigit: "ok" | "mismatch" | "not_applicable" } {
  const v = vin.trim().toUpperCase();
  if (!VIN_RE.test(v)) return { valid: false, checkDigit: "not_applicable" };
  const northAmerican = "12345".includes(v[0]);
  if (!northAmerican) return { valid: true, checkDigit: "not_applicable" };
  const sum = [...v].reduce((n, ch, i) => n + (/\d/.test(ch) ? Number(ch) : TRANSLIT[ch]) * WEIGHTS[i], 0);
  const r = sum % 11;
  const ok = (r === 10 ? "X" : String(r)) === v[8];
  return { valid: ok, checkDigit: ok ? "ok" : "mismatch" };
}

export interface DecodeClassification {
  state: DecodeState;
  presentFields: string[];
  missingFields: string[];
  billing: "consumed" | "no_charge" | "billing_uncertain";
  detail: string;
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => !!v && typeof v === "object" && !Array.isArray(v);
const has = (b: Bag, k: string) => b[k] != null && b[k] !== "" && !(Array.isArray(b[k]) && (b[k] as unknown[]).length === 0);

/** Which answer keys stand for each approved field. */
export const DECODE_FIELD_KEYS: Record<string, string[]> = {
  build_identity: ["year", "make", "model", "trim"],
  installed_equipment: ["installed_options_details", "options", "installed_equipment"],
  msrp_build: ["msrp", "base_msrp", "combined_msrp"],
  factory_warranty_spec: ["warranty", "factory_warranty", "powertrain_warranty"],
};

export function classifyDecode(status: number | null, body: unknown, required: string[], timedOut = false): DecodeClassification {
  const none = { presentFields: [] as string[], missingFields: required };
  if (timedOut || status == null) return { state: "billing_uncertain", ...none, billing: "billing_uncertain", detail: "no answer (timeout or transport failure); billing unknown" };
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  if (status === 429) return { state: "temporarily_failed", ...none, billing: "no_charge", detail: "rate or quota refusal" };
  if (status === 401 || status === 403) return { state: "temporarily_failed", ...none, billing: "no_charge", detail: "authorization refused" };
  if (status >= 500) return { state: "temporarily_failed", ...none, billing: "billing_uncertain", detail: `provider error ${status}` };
  if (status === 400 || status === 422) {
    if (/invalid\s*vin|vin.*(invalid|malformed)/i.test(text)) return { state: "invalid_vin", ...none, billing: "consumed", detail: "provider rejected the VIN" };
    if (/not\s*supported|unsupported/i.test(text)) return { state: "unsupported", ...none, billing: "consumed", detail: "provider does not support this vehicle" };
    return { state: "temporarily_failed", ...none, billing: "consumed", detail: `request rejected ${status}` };
  }
  if (status === 404 || status === 204) return { state: "unavailable", ...none, billing: "consumed", detail: "no data for this VIN yet" };
  if (status < 200 || status >= 300) return { state: "temporarily_failed", ...none, billing: "billing_uncertain", detail: `unexpected status ${status}` };

  const b = isBag(body) ? body : {};
  if (Object.keys(b).length === 0) return { state: "unavailable", ...none, billing: "consumed", detail: "empty answer" };
  const trims = Array.isArray(b.trims) ? b.trims : Array.isArray(b.possible_trims) ? b.possible_trims : null;
  if (b.is_generic === true || b.generic === true || (trims && trims.length > 1 && !has(b, "trim"))) {
    return { state: "ambiguous", ...splitFields(b, required), billing: "consumed", detail: "several trims possible; not an exact build" };
  }
  const split = splitFields(b, required);
  if (split.missingFields.length === 0) return { state: "complete", ...split, billing: "consumed", detail: "all approved fields present" };
  if (split.presentFields.length > 0) return { state: "partial", ...split, billing: "consumed", detail: `missing ${split.missingFields.join(", ")}` };
  return { state: "unavailable", ...split, billing: "consumed", detail: "answer had none of the approved fields" };
}

function splitFields(b: Bag, required: string[]) {
  const presentFields: string[] = [];
  const missingFields: string[] = [];
  for (const f of required) {
    const keys = DECODE_FIELD_KEYS[f] ?? [f];
    const ok = f === "build_identity" ? keys.slice(0, 3).every((k) => has(b, k)) : keys.some((k) => has(b, k));
    (ok ? presentFields : missingFields).push(f);
  }
  return { presentFields, missingFields };
}

export type ConfidenceScale = "fraction" | "percent" | "unknown";

/**
 * Reads a provider confidence without assuming its scale. A value in (1, 100]
 * is a percentage; 0 or 1 alone could be either, so other confidences in the
 * same answer decide; otherwise the scale stays unknown and no fraction is
 * reported.
 */
export function readConfidence(answer: unknown, key = "record_confidence"): { raw: number | null; scale: ConfidenceScale; fraction: number | null; meaning: string } {
  const meaning = "provider's confidence in the decode as a whole; not a guarantee of each field";
  const conf = isBag(answer) ? (isBag(answer.confidence) ? answer.confidence : answer) : {};
  const nums = Object.entries(conf).filter(([k, v]) => /confidence/i.test(k) && typeof v === "number" && Number.isFinite(v)).map(([, v]) => v as number);
  const raw = typeof conf[key] === "number" ? (conf[key] as number) : null;
  if (raw == null) return { raw: null, scale: "unknown", fraction: null, meaning };
  if (raw < 0 || nums.some((n) => n < 0 || n > 100)) return { raw, scale: "unknown", fraction: null, meaning };
  const scale: ConfidenceScale = nums.some((n) => n > 1) ? "percent" : nums.some((n) => n > 0 && n < 1) ? "fraction" : "unknown";
  const fraction = scale === "percent" ? raw / 100 : scale === "fraction" ? raw : null;
  return { raw, scale, fraction, meaning };
}

/** Dates in a provider answer, each named for what it is. */
export function readProviderDates(answer: unknown): { dataDeliveryDate: string | null; warrantyInServiceDate: string | null } {
  const b = isBag(answer) ? answer : {};
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return {
    // delivery_date in MarketCheck datasets is the data delivery date.
    dataDeliveryDate: iso(b.delivery_date) ?? iso(b.data_delivery_date),
    // Only an explicit in-service field is an in-service date.
    warrantyInServiceDate: iso(b.in_service_date) ?? iso(b.warranty_start_date),
  };
}

export interface QuotaReading {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
  source: string[];
}

type HeaderLike = { get(name: string): string | null } | Record<string, string | undefined>;
const getHeader = (h: HeaderLike, name: string): string | null => {
  if (typeof (h as { get?: unknown }).get === "function") return (h as { get(n: string): string | null }).get(name);
  const rec = h as Record<string, string | undefined>;
  const k = Object.keys(rec).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? rec[k] ?? null : null;
};
const int = (v: string | null) => (v != null && /^\s*\d+\s*$/.test(v) ? Number(v) : null);

/**
 * Header names are candidates until confirmed against a real MarketCheck
 * answer for this account; unknown names are ignored, never guessed.
 */
export function readQuotaHeaders(h: HeaderLike, now: Date): QuotaReading {
  const source: string[] = [];
  const pick = (names: string[]) => {
    for (const n of names) { const v = getHeader(h, n); if (v != null) { source.push(n); return v; } }
    return null;
  };
  const limit = int(pick(["x-ratelimit-limit", "x-quota-limit", "ratelimit-limit"]));
  const remaining = int(pick(["x-ratelimit-remaining", "x-quota-remaining", "ratelimit-remaining"]));
  const used = int(pick(["x-ratelimit-used", "x-quota-used"]));
  let resetAt: string | null = null;
  const absolute = pick(["x-ratelimit-reset", "x-quota-reset"]);
  if (absolute != null) {
    const n = int(absolute);
    if (n != null && n > 1_000_000_000) resetAt = new Date(n * 1000).toISOString();
    else if (n == null && /\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(absolute.trim())) resetAt = new Date(absolute.trim()).toISOString();
  }
  if (resetAt == null) {
    const delta = int(pick(["ratelimit-reset"]));
    if (delta != null && delta < 40 * 86400) resetAt = new Date(now.getTime() + delta * 1000).toISOString();
  }
  return { limit, remaining, used, resetAt, source };
}

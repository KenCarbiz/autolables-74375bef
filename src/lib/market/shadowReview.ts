// ── The internal shadow review, as a typed adapter ─────────────────────────
//
// Shadow evidence is the whole point of the pilot, and it is also the one
// place where "Limited Market Evidence", abstention reasons, own-rooftop
// exclusions and provider diagnostics are ALLOWED to be read — by the dealer
// and by us, never by a shopper.
//
// So this adapter exists to make that boundary explicit rather than implied:
// it maps an append-only evidence row to a view model, and it is deliberately
// read-only. There is no mutation helper here, no invoke helper, no budget
// control and no provider-call control, because a review screen that can start
// a paid run is not a review screen.
//
// Tenant isolation is not this module's job to enforce — RLS and the query's
// own `tenant_id` filter do that — but it IS this module's job to refuse to
// assemble a row that does not match the tenant being viewed, so a filter
// forgotten upstream shows nothing instead of someone else's inventory.

export interface ShadowEvidenceRow {
  id?: unknown;
  tenant_id?: unknown;
  vin?: unknown;
  created_at?: unknown;
  checked_at?: unknown;
  status?: unknown;
  algorithm_version?: unknown;
  displayed_total_price?: unknown;
  vehicle_comparison_price?: unknown;
  doc_fee?: unknown;
  price_basis_status?: unknown;
  price_basis_reasons?: unknown;
  certification_match?: unknown;
  provider?: unknown;
  provider_attempt_status?: unknown;
  provider_prediction?: unknown;
  raw_candidate_count?: unknown;
  eligible_primary_count?: unknown;
  effective_sample_size?: unknown;
  independent_rooftop_count?: unknown;
  confidence_tier?: unknown;
  verdict?: unknown;
  confidence_reasons?: unknown;
  insufficient_market_diversity?: unknown;
  data_provenance?: unknown;
}

export interface ShadowComparableRow {
  comparable_vin?: unknown;
  dealer_name?: unknown;
  inclusion_status?: unknown;
  exclusion_reasons?: unknown;
}

export interface ShadowReviewRow {
  id: string;
  vin: string;
  evaluatedAt: string | null;
  /** True only when the evidence itself says so. Never inferred from a flag. */
  shadow: boolean;
  invocationSource: string | null;
  algorithmVersion: string | null;
  status: string | null;
  verdict: string | null;
  confidence: string | null;
  /** The dealer's published price. */
  advertisedPrice: number | null;
  /** INTERNAL comparison basis. Labelled as such in the view model itself. */
  internalComparisonPrice: number | null;
  docFee: number | null;
  priceBasisStatus: string | null;
  certificationConflict: boolean;
  rawComparableCount: number | null;
  eligibleComparableCount: number | null;
  effectiveSampleSize: number | null;
  independentRooftopCount: number | null;
  providerAttemptStatus: string | null;
  providerPrediction: number | null;
  /** Actual metered spend for this evaluation, in USD. Zero for shadow. */
  providerCostUsd: number;
  abstentionReasons: string[];
  ownRooftopExclusions: string[];
  /** Legacy value minus V2 percentile, when both exist. */
  legacyVersusV2: number | null;
  freshnessDays: number | null;
  /** Fixed banner text. This screen is never customer-facing. */
  audience: "internal_only";
}

export const SHADOW_REVIEW_AUDIENCE_NOTICE =
  "Internal only — shadow evaluation. Not shown to customers.";

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const provenance = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Reasons that name an own-rooftop exclusion, for the comparables panel. */
export const OWN_ROOFTOP_REASONS = [
  "internal_inventory_own_rooftop",
  "own_rooftop_matched_by_name_only",
] as const;

export function buildShadowReviewRow(input: {
  evaluation: ShadowEvidenceRow;
  comparables?: ShadowComparableRow[];
  /** The tenant whose screen this is. A mismatch yields null. */
  viewerTenantId: string;
  legacyMarketValue?: unknown;
  providerCostUsd?: unknown;
  now?: number;
}): ShadowReviewRow | null {
  const e = input.evaluation;
  const tenantId = str(e.tenant_id);
  const id = str(e.id);
  const vin = str(e.vin);
  // Refuse rather than render. A forgotten filter upstream shows nothing.
  if (!tenantId || !id || !vin || tenantId !== input.viewerTenantId) return null;

  const prov = provenance(e.data_provenance);
  const evaluatedAt = str(e.checked_at) ?? str(e.created_at);
  const now = input.now ?? Date.now();
  const parsed = evaluatedAt ? Date.parse(evaluatedAt) : NaN;

  const ownRooftop = (input.comparables ?? [])
    .filter((c) => strings(c.exclusion_reasons)
      .some((r) => (OWN_ROOFTOP_REASONS as readonly string[]).includes(r)))
    .map((c) => str(c.dealer_name) ?? str(c.comparable_vin) ?? "unknown");

  const legacy = num(input.legacyMarketValue);
  const v2 = num(e.provider_prediction);

  return {
    id,
    vin,
    evaluatedAt,
    shadow: prov.shadow === true,
    invocationSource: str(prov.invocation_source),
    algorithmVersion: str(e.algorithm_version),
    status: str(e.status),
    verdict: str(e.verdict),
    confidence: str(e.confidence_tier),
    advertisedPrice: num(e.displayed_total_price),
    internalComparisonPrice: num(e.vehicle_comparison_price),
    docFee: num(e.doc_fee),
    priceBasisStatus: str(e.price_basis_status),
    certificationConflict: e.certification_match === false,
    rawComparableCount: num(e.raw_candidate_count),
    eligibleComparableCount: num(e.eligible_primary_count),
    effectiveSampleSize: num(e.effective_sample_size),
    independentRooftopCount: num(e.independent_rooftop_count),
    providerAttemptStatus: str(e.provider_attempt_status),
    providerPrediction: v2,
    // Never inferred. A shadow evaluation makes no reservation, so its cost is
    // zero by construction, and anything else is read from the ledger.
    providerCostUsd: num(input.providerCostUsd) ?? 0,
    abstentionReasons: strings(e.confidence_reasons),
    ownRooftopExclusions: ownRooftop,
    legacyVersusV2: legacy != null && v2 != null ? legacy - v2 : null,
    freshnessDays: Number.isFinite(parsed) ? (now - parsed) / 86_400_000 : null,
    audience: "internal_only",
  };
}

/**
 * Everything this adapter must never expose, asserted by a test.
 *
 * A raw provider payload can contain the API key echoed in a request URL, and
 * a review screen is not worth that risk.
 */
export const SHADOW_REVIEW_FORBIDDEN_FIELDS = [
  "provider_request_params",
  "provider_response_hash",
  "subject_inputs",
  "api_key",
  "raw",
] as const;

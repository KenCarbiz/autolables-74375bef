// ── The shadow pilot, as a decision rather than an intention ───────────────
//
// `market_value_v2_shadow` has been stored as `false` on a tenant since Gate
// 14B and read by nothing. A flag with no reader is a label: turning it on
// would have changed nothing, produced no evidence, and — worse than doing
// nothing — read in an audit as though a pilot had run and found nothing wrong.
//
// This module is what makes it a control. Everything here is pure and has no
// caller-visible side effect; the edge function that calls it does the I/O.
//
// Seven conditions, ALL of which must hold, and every one of which defaults to
// refusing:
//
//   1. the tenant flag is a literal boolean true
//   2. the invocation came from an approved server-side path
//   3. the VIN is in an explicitly configured pilot cohort
//   4. that cohort holds no more than 50 VINs
//   5. the vehicle belongs to the tenant being asked about
//   6. a MATERIAL valuation input actually changed
//   7. no completed shadow evaluation already exists for the same material
//      inputs and the same algorithm version
//
// No tenant id and no VIN appears anywhere in this file. A pilot cohort that
// lives in code is a cohort nobody can turn off without a deploy.

import { digest } from "./hash.ts";
import { readMarketFlag } from "./flags.ts";

// ── Provider policy ────────────────────────────────────────────────────────
//
// Two modes, and the difference is not a degree of caution — it is whether the
// code path that spends money exists for this request at all.
//
//   "reserved"  the ordinary authorized writer path: reserve under the tenant
//               budget, then call, then record the actual cost.
//   "disabled"  evidence only. No reservation is attempted, so the budget is
//               never consulted and an enabled budget cannot grant anything.

export type ProviderPolicy = "reserved" | "disabled";

export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = "reserved";

/** Only the exact literal selects the evidence-only mode. */
export function readProviderPolicy(value: unknown): ProviderPolicy {
  return value === "disabled" ? "disabled" : "reserved";
}

/**
 * May this request reach a provider?
 *
 * Deliberately NOT parameterised by budget, flag, entitlement or key presence.
 * Those are answers to "should we spend"; this answers "is spending part of
 * this request's shape", and a later yes cannot re-open a no.
 */
export function providerCallPermitted(policy: ProviderPolicy): boolean {
  return policy === "reserved";
}

// ── Invocation source ──────────────────────────────────────────────────────

export const APPROVED_SHADOW_SOURCES = [
  "ingestion",
  "enrichment_sweep",
  "server_operator",
] as const;

export type ApprovedShadowSource = (typeof APPROVED_SHADOW_SOURCES)[number];

/** Everything a caller might claim. `browser` is enumerated so it can be refused by name. */
export type ShadowInvocationSource = ApprovedShadowSource | "browser" | "unknown";

export const isApprovedShadowSource = (s: unknown): s is ApprovedShadowSource =>
  typeof s === "string" && (APPROVED_SHADOW_SOURCES as readonly string[]).includes(s);

/**
 * An invocation source safe to store in an audit row.
 *
 * Allow-list, never passthrough: the source reaches evidence and an
 * attacker-chosen string in an audit trail is a log-injection surface.
 */
export function sanitizeInvocationSource(value: unknown): ShadowInvocationSource {
  if (isApprovedShadowSource(value)) return value;
  return value === "browser" ? "browser" : "unknown";
}

// ── The pilot cohort ───────────────────────────────────────────────────────

export const SHADOW_COHORT_SETTING = "market_value_v2_shadow_vins";
export const MAX_SHADOW_COHORT = 50;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface ShadowCohort {
  vins: string[];
  reasons: string[];
}

/**
 * The explicitly configured pilot VINs.
 *
 * Absent is empty. Empty is empty. There is no wildcard, no "*", no `true`,
 * and no reading of a non-array as "all inventory" — a cohort setting that can
 * be widened by a typo is not a cohort.
 *
 * Over the cap the whole list is REJECTED rather than truncated. Silently
 * taking the first fifty of a hundred would run a pilot on a set nobody chose.
 */
export function parseShadowCohort(settings: unknown): ShadowCohort {
  const reasons: string[] = [];
  const bag = settings != null && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : null;
  if (!bag || !Object.prototype.hasOwnProperty.call(bag, SHADOW_COHORT_SETTING)) {
    return { vins: [], reasons: ["shadow_cohort_absent"] };
  }

  const raw = bag[SHADOW_COHORT_SETTING];
  if (!Array.isArray(raw)) {
    // A string, a boolean, an object, `"*"` — none of these is a list of cars.
    return { vins: [], reasons: ["shadow_cohort_not_a_list"] };
  }

  const seen = new Set<string>();
  let rejected = 0;
  for (const entry of raw) {
    const vin = typeof entry === "string" ? entry.trim().toUpperCase() : "";
    if (!VIN_PATTERN.test(vin)) { rejected++; continue; }
    seen.add(vin);
  }
  if (rejected > 0) reasons.push(`shadow_cohort_rejected_${rejected}_malformed`);
  if (raw.length !== seen.size + rejected) reasons.push("shadow_cohort_deduplicated");

  if (seen.size > MAX_SHADOW_COHORT) {
    return { vins: [], reasons: [...reasons, `shadow_cohort_exceeds_${MAX_SHADOW_COHORT}`] };
  }
  if (seen.size === 0) reasons.push("shadow_cohort_empty");
  return { vins: [...seen].sort(), reasons };
}

export const isInShadowCohort = (cohort: ShadowCohort, vin: unknown): boolean =>
  typeof vin === "string" && cohort.vins.includes(vin.trim().toUpperCase());

// ── Material valuation inputs ──────────────────────────────────────────────
//
// A nightly sweep touches photos, descriptions, recall text and days-on-market.
// None of that changes what a car is worth, and re-evaluating on every one of
// them would fill the evidence table with identical rows and bury the day
// something actually moved.
//
// These are the inputs the engine reads. Nothing else may trigger a
// re-evaluation, and every one of them must.

export const MATERIAL_VALUATION_INPUTS = [
  "price",
  "advertised_price_before_doc",
  "website_sale_price",
  "mileage",
  "condition",
  "certified",
  "trim",
  "ymm",
  "drivetrain",
  "dealer_identity",
  "doc_fee",
  "advertised_includes_doc_fee",
  "mandatory_add_ons_usd",
  "mandatory_add_ons_included_in_displayed_price",
] as const;

export type MaterialValuationInput = (typeof MATERIAL_VALUATION_INPUTS)[number];

export interface MaterialInputSource {
  price?: unknown;
  advertisedPriceBeforeDoc?: unknown;
  websiteSalePrice?: unknown;
  mileage?: unknown;
  condition?: unknown;
  /** The RESOLVED certification, not the provider's echo. */
  certified?: unknown;
  trim?: unknown;
  ymm?: unknown;
  drivetrain?: unknown;
  dealerIdentity?: unknown;
  docFee?: unknown;
  advertisedIncludesDocFee?: unknown;
  mandatoryAddOnsUsd?: unknown;
  mandatoryAddOnsIncludedInDisplayedPrice?: unknown;
}

const scalar = (v: unknown): string | number | boolean | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() || null;
  return null;
};

/** Exactly the material inputs, normalized, in a stable shape. */
export function materialValuationInputs(
  source: MaterialInputSource,
): Record<MaterialValuationInput, unknown> {
  return {
    price: scalar(source.price),
    advertised_price_before_doc: scalar(source.advertisedPriceBeforeDoc),
    website_sale_price: scalar(source.websiteSalePrice),
    mileage: scalar(source.mileage),
    condition: scalar(source.condition),
    certified: scalar(source.certified),
    trim: scalar(source.trim),
    ymm: scalar(source.ymm),
    drivetrain: scalar(source.drivetrain),
    // Identity is a structure; hash it so a reordered array is not a change.
    dealer_identity: source.dealerIdentity == null ? null : digest(source.dealerIdentity),
    doc_fee: scalar(source.docFee),
    advertised_includes_doc_fee: scalar(source.advertisedIncludesDocFee),
    mandatory_add_ons_usd: scalar(source.mandatoryAddOnsUsd),
    mandatory_add_ons_included_in_displayed_price:
      scalar(source.mandatoryAddOnsIncludedInDisplayedPrice),
  };
}

/**
 * The fingerprint idempotency is keyed on.
 *
 * Stored in `vehicle_market_valuations.data_provenance` — an existing jsonb
 * column, so no migration is needed to make repeat evaluations detectable.
 */
export function materialInputFingerprint(source: MaterialInputSource): string {
  return digest({ kind: "material_valuation_inputs", ...materialValuationInputs(source) });
}

export interface MaterialChange {
  changed: boolean;
  changedKeys: MaterialValuationInput[];
  fingerprint: string;
}

export function compareMaterialInputs(
  before: MaterialInputSource | null | undefined,
  after: MaterialInputSource,
): MaterialChange {
  const fingerprint = materialInputFingerprint(after);
  if (!before) return { changed: true, changedKeys: [...MATERIAL_VALUATION_INPUTS], fingerprint };
  const a = materialValuationInputs(before);
  const b = materialValuationInputs(after);
  const changedKeys = MATERIAL_VALUATION_INPUTS.filter((k) => a[k] !== b[k]);
  return { changed: changedKeys.length > 0, changedKeys, fingerprint };
}

// ── The decision ───────────────────────────────────────────────────────────

/** A shadow evaluation already on record, as the evidence table holds it. */
export interface ExistingShadowEvaluation {
  materialInputFingerprint: string | null;
  algorithmVersion: string | null;
  status: string | null;
}

/** Statuses that mean the evaluation finished. A crashed run is not a duplicate. */
export const COMPLETED_EVALUATION_STATUSES = ["available", "limited", "unavailable"] as const;

export const isCompletedEvaluation = (status: unknown): boolean =>
  typeof status === "string" && (COMPLETED_EVALUATION_STATUSES as readonly string[]).includes(status);

export interface ShadowRequestDecision {
  invoke: boolean;
  /** Literal type: an edit that tries to let shadow spend does not compile. */
  providerPolicy: "disabled";
  source: ShadowInvocationSource;
  materialInputFingerprint: string | null;
  reasons: string[];
}

export function decideShadowRequest(input: {
  settings: unknown;
  /** The tenant the request is FOR. */
  tenantId: string | null | undefined;
  /** The tenant the listing row actually belongs to. */
  listingTenantId: string | null | undefined;
  vin: unknown;
  source: unknown;
  materialChange: MaterialChange;
  algorithmVersion: string;
  existing: ExistingShadowEvaluation | null | undefined;
}): ShadowRequestDecision {
  const reasons: string[] = [];
  const source = sanitizeInvocationSource(input.source);
  const deny = (): ShadowRequestDecision => ({
    invoke: false,
    providerPolicy: "disabled",
    source,
    materialInputFingerprint: input.materialChange.fingerprint,
    reasons,
  });

  // 1. The flag. `readMarketFlag` accepts only a literal true, so a missing
  //    settings blob, a malformed one and the string "true" all land here.
  if (!readMarketFlag(input.settings, "market_value_v2_shadow")) {
    reasons.push("shadow_flag_off");
    return deny();
  }

  // 2. Approved server-side source.
  if (!isApprovedShadowSource(source)) {
    reasons.push(`shadow_source_rejected_${source}`);
    return deny();
  }

  // 5. Tenant ownership, checked before the cohort so a cross-tenant VIN can
  //    never be answered with "not in the cohort", which would leak whether it
  //    is in someone else's.
  if (!input.tenantId || !input.listingTenantId || input.tenantId !== input.listingTenantId) {
    reasons.push("shadow_tenant_mismatch");
    return deny();
  }

  // 3 and 4. The cohort, which caps itself.
  const cohort = parseShadowCohort(input.settings);
  reasons.push(...cohort.reasons);
  if (cohort.vins.length === 0) {
    reasons.push("shadow_cohort_unusable");
    return deny();
  }
  if (!isInShadowCohort(cohort, input.vin)) {
    reasons.push("shadow_vin_not_in_cohort");
    return deny();
  }

  // 6 and 7 are one question asked against the right baseline.
  //
  // "Did a material input change" is only meaningful relative to the LAST
  // COMPLETED EVALUATION, not to the previous enrichment pass. Comparing
  // passes would re-evaluate a car whose photos changed twice and skip one
  // whose price moved back and forth between sweeps.
  //
  // So the stored material fingerprint is the baseline: equal means nothing
  // the engine reads has moved since we last answered, which is simultaneously
  // "no material change" and "this would be a duplicate row".
  const existing = input.existing ?? null;
  const hasCompletedPrior = !!existing && isCompletedEvaluation(existing.status);
  if (hasCompletedPrior) {
    if (
      existing!.materialInputFingerprint === input.materialChange.fingerprint
      && existing!.algorithmVersion === input.algorithmVersion
    ) {
      reasons.push("shadow_duplicate_material_inputs", "shadow_no_material_change");
      return deny();
    }
    reasons.push(
      existing!.algorithmVersion !== input.algorithmVersion
        ? "shadow_algorithm_version_changed"
        : "shadow_material_inputs_changed",
    );
  } else {
    // Nothing answered yet. A vehicle with no evaluation has, trivially,
    // changed relative to nothing — otherwise a newly cohorted VIN could never
    // get its first one.
    reasons.push("shadow_first_evaluation");
  }

  reasons.push("shadow_authorized", `shadow_source_${source}`);
  return {
    invoke: true,
    providerPolicy: "disabled",
    source,
    materialInputFingerprint: input.materialChange.fingerprint,
    reasons,
  };
}

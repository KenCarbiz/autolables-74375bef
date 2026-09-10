// ──────────────────────────────────────────────────────────────────────
// market-valuation-write — the ONLY writer of market valuation decisions.
//
// Before this function there were three. `marketcheck-market-pricing` had its
// own formula and wrote `market_value` and `market_position` directly;
// `vehicle-enrich` wrote `market_meta` statistics on its own nightly schedule;
// and several front-end components each subtracted a price from whichever of
// those columns they happened to read. Nothing owned the answer, so nothing
// could be held to it — which is how one QX50 came to read "$4,718 above
// market" from a prediction that had priced it as a non-certified car.
//
// Everything about a market decision now happens here, once, in order, and
// leaves an append-only record that can reconstruct it.
//
// What this function will NOT do:
//   • spend money without an atomic reservation (Section 13)
//   • overwrite a still-valid answer because a refresh timed out (Section 14)
//   • write a compatibility column unless the tenant's admin flag is on
//   • return a verdict it cannot evidence
//
// Body: { vin, tenant_id, force?: boolean, dry_run?: boolean }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { createSupabaseContext } from "https://esm.sh/@supabase/server@1.6.0";
import {
  buildSecretKeySet, credentialCarrier, decideUserAuthorization,
  denyForVerifierStatus, jwksSource,
  DENY_UNAUTHENTICATED, type CallerDecision,
} from "../_shared/functionAuth.ts";

import { buildMarketView } from "../_shared/factorySticker/lib/market/marketView.ts";
import {
  buildPredictionRequest, parsePredictionResponse, predictionUrl,
  resolveDealerType, MARKETCHECK_ENDPOINT_VERSION,
} from "../_shared/factorySticker/lib/market/providerAdapter.ts";
import { resolveProviderFreshness, type ProviderAttemptOutcome } from "../_shared/factorySticker/lib/market/freshness.ts";
import { decideReuse } from "../_shared/factorySticker/lib/market/fingerprints.ts";
import { legacyComparableToCandidate } from "../_shared/factorySticker/lib/market/legacyAdapter.ts";
import { readMarketFlag } from "../_shared/factorySticker/lib/market/flags.ts";
import {
  callProviderOnce, failureReason, type ProviderFetch,
} from "../_shared/factorySticker/lib/market/providerTransport.ts";
import { PROVIDER_FRESH_DAYS, PROVIDER_HARD_EXPIRY_DAYS } from "../_shared/factorySticker/lib/market/freshness.ts";
import type { ProviderValuation } from "../_shared/factorySticker/lib/market/types.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com";
const PROVIDER = "marketcheck";
const REQUEST_TIMEOUT_MS = 10_000;

// Trusted server credentials, as a SET so a rotation does not need a code
// change, and the JWKS the project actually publishes so user tokens are
// verified by signature rather than taken on trust.
const SECRET_KEYS = buildSecretKeySet((n) => Deno.env.get(n));
const JWKS_SOURCE = jwksSource((n) => Deno.env.get(n));
const JWKS = JWKS_SOURCE
  ? ("url" in JWKS_SOURCE ? new URL(JWKS_SOURCE.url) : safeJwks(JWKS_SOURCE.inline))
  : null;

function safeJwks(raw: string): { keys: unknown[] } | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.keys) ? parsed : null;
  } catch {
    return null;
  }
}

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * One provider call, classified.
 *
 * The transport itself lives in the shared engine so it can be exercised by
 * unit tests with an injected fetch. This wrapper only supplies the real one.
 */
const callProvider = (url: string) => callProviderOnce(url, fetch as unknown as ProviderFetch, REQUEST_TIMEOUT_MS);

/**
 * Who is calling, and may they act on this tenant.
 *
 * Verification is Supabase's, not ours: `createSupabaseContext` checks a user
 * JWT's signature against the project JWKS, and matches a server credential in
 * constant time against the configured key SET. What used to live here was a
 * single `auth !== SERVICE_KEY`, which admitted exactly one credential, could
 * not see a key presented in the `apikey` header at all, and compared a secret
 * in variable time.
 *
 * Mode order matters. `secret` is tried first because a legacy service-role
 * key is a JWT with no `sub` claim: offered to `user` mode it is not merely
 * unmatched but definitively rejected, which would stop the chain before
 * `secret` ever ran. The `:*` suffix is equally load-bearing — plain `secret`
 * resolves to the key literally named `default`, so a named set would match
 * nothing and 401 every trusted caller.
 */
async function authenticateCaller(
  req: Request,
  tenantId: string,
  admin: ReturnType<typeof adminClient>,
): Promise<CallerDecision> {
  const { data: ctx, error } = await createSupabaseContext(credentialCarrier(req), {
    auth: ["secret:*", "user"],
    env: { secretKeys: SECRET_KEYS, ...(JWKS ? { jwks: JWKS } : {}) },
  });

  if (error) {
    // The CODE only. `error.toJSON()` carries hints and details, and nothing
    // derived from a credential belongs in a log line.
    console.error("writer_auth_denied", error.code);
    return denyForVerifierStatus(error.status);
  }

  // A trusted server credential is not a person: there is no membership row to
  // look for, and the scheduler and the proxy both arrive this way.
  if (ctx.authMode !== "user") return { ok: true, mode: "secret", userId: null };

  const userId = ctx.userClaims?.id ?? null;
  if (!userId) return DENY_UNAUTHENTICATED;

  const { data: isAdmin } = await admin.from("user_roles")
    .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();

  let isTenantMember = false;
  if (!isAdmin) {
    const { data: member } = await admin.from("tenant_members")
      .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
    isTenantMember = !!member;
  }

  return decideUserAuthorization({ userId, isPlatformAdmin: !!isAdmin, isTenantMember });
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const vin = String(body.vin || "").toUpperCase().trim();
  const tenantId: string | null = body.tenant_id || null;
  const dryRun = body.dry_run === true;

  if (!validVin(vin)) return json(400, { error: "invalid_vin" });
  if (!tenantId) return json(400, { error: "tenant_id required" });

  // ── 1. Authorisation ──────────────────────────────────────────────
  // Nothing below this line may run for an unauthenticated caller: no
  // reservation, no provider request, no insert. Section 13 spends money and
  // it is reached only from here.
  const caller = await authenticateCaller(req, tenantId, admin);
  if (!caller.ok) return json(caller.status, { error: caller.error });

  // ── 2-6. Subject and dealer configuration ─────────────────────────
  const { data: listing } = await admin.from("vehicle_listings")
    // ONE string literal, deliberately. supabase-js parses the select list at the
    // TYPE level, and that parser needs a literal. Split across lines with `+`,
    // TypeScript widens the argument to `string`, the parser gives up and returns
    // `GenericStringError` — which is itself a string literal type, so every
    // column access below became "property does not exist on GenericStringError",
    // and `listing.trim` silently resolved to String.prototype.trim. Twenty-one
    // compile errors from one line break. Keep this on one line.
    .select("id, vin, ymm, trim, condition, mileage, price, advertised_price_before_doc, website_sale_price, doc_fee, market_value, market_position, market_checked_at, market_payload, market_meta, comparables, mc_raw, mc_attributes")
    .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!listing) return json(404, { error: "listing_not_found" });

  const { data: profile } = await admin.from("dealer_profiles")
    .select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (profile?.settings ?? {}) as Record<string, unknown>;

  const dealerType = resolveDealerType(settings);
  const zip = (settings.dealer_zip as string) || null;
  const identity = (settings.dealer_identity ?? {}) as Record<string, string[]>;
  // The tenant setting is a DEFAULT for every car on the lot, so it is used
  // only when someone has explicitly confirmed it. An unconfirmed number — and
  // an absent one — resolves to unknown, which makes the basis ambiguous and
  // forecloses red. It never resolves to an assumed zero.
  //
  // There is no per-vehicle column yet, so the vehicle scope is not supplied
  // here; `resolveMandatoryAddOns` still checks it first, which is what the
  // Vehicle File surface uses when a listing carries its own answer.
  const tenantMandatoryAddOns = {
    amountUsd: num(settings.mandatory_add_ons_usd),
    verified: settings.mandatory_add_ons_verified === true,
    includedInDisplayedPrice:
      typeof settings.mandatory_add_ons_included_in_displayed_price === "boolean"
        ? settings.mandatory_add_ons_included_in_displayed_price
        : null,
  };
  const condition = listing.condition === "new" || listing.condition === "used" || listing.condition === "cpo"
    ? listing.condition : null;

  // ── 7-8. Price basis and canonical request ────────────────────────
  const built = buildPredictionRequest({
    vin, mileage: listing.mileage, condition, dealerType, zip,
  });

  // ── 9. Cache: may the paid prediction be reused? ──────────────────
  const stored = (listing.market_payload ?? {}) as Record<string, unknown>;
  const storedFingerprint = (stored.provider_request_fingerprint as string) ?? null;
  const storedCheckedAt = listing.market_checked_at as string | null;
  const lastGoodAgeDays = storedCheckedAt && Number.isFinite(Date.parse(storedCheckedAt))
    ? (Date.now() - Date.parse(storedCheckedAt)) / 86_400_000
    : null;

  const reuse = decideReuse({
    storedProviderFingerprint: storedFingerprint,
    currentProviderFingerprint: built.requestFingerprint,
    // The decision fingerprint is compared after the engine runs; at this point
    // we only need to know whether a PAID CALL can be avoided.
    storedValuationFingerprint: null,
    currentValuationFingerprint: null,
    providerAgeDays: lastGoodAgeDays,
    providerFreshDays: PROVIDER_FRESH_DAYS,
    providerHardExpiryDays: PROVIDER_HARD_EXPIRY_DAYS,
  });

  let provider: ProviderValuation | null = null;
  let attemptOutcome: ProviderAttemptOutcome = "not_attempted";
  let attemptId: string | null = null;
  let reservationOutcome = "not_required";

  if (reuse.providerReusable && !body.force) {
    provider = (stored.provider_valuation as ProviderValuation) ?? null;
  } else if (built.request && MC_KEY && !dryRun) {
    // ── 10-11. Reserve BEFORE spending. One live reservation per
    // fingerprint across every concurrent caller, and the monthly budget is
    // checked under the same row lock, so two functions cannot both decide
    // there is room for one more call.
    const { data: reservation } = await admin.rpc("market_reserve_provider_call", {
      p_tenant_id: tenantId,
      p_provider: PROVIDER,
      p_fingerprint: built.requestFingerprint,
      p_ttl_seconds: 120,
    });
    const slot = Array.isArray(reservation) ? reservation[0] : reservation;
    reservationOutcome = slot?.outcome ?? "unavailable";

    if (reservationOutcome === "reserved") {
      attemptId = slot.attempt_id;
      // ── 12-13. The call itself. Never made in a test: this branch needs a
      // deployed runtime, an API key and a granted reservation.
      const result = await callProvider(predictionUrl(MC_BASE, built.sanitizedParams, MC_KEY));
      attemptOutcome = result.outcome;

      if (result.outcome === "succeeded") {
        // ── 14. Parse current or legacy response shape.
        const parsed = parsePredictionResponse({
          body: result.body,
          requestFingerprint: built.requestFingerprint as string,
          requestedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        });
        provider = parsed.valuation;
      } else {
        // ── Section 14: a transient failure is recorded and does NOT replace
        // a still-valid answer.
        provider = (stored.provider_valuation as ProviderValuation) ?? null;
      }

      await admin.rpc("market_complete_provider_call", {
        p_attempt_id: attemptId,
        p_status: result.outcome === "succeeded" ? "succeeded" : "failed",
        p_actual_cost: null,
        p_failure_reason: result.outcome === "succeeded" ? null : failureReason(result.outcome, result.status),
      });
    } else {
      // Budget exhausted, provider disabled, or another caller already holds
      // the slot. Either way we do not pay again; we reuse what we have.
      provider = (stored.provider_valuation as ProviderValuation) ?? null;
    }
  } else {
    provider = (stored.provider_valuation as ProviderValuation) ?? null;
  }

  // ── 15. Freshness and hard overrides.
  const freshness = resolveProviderFreshness({
    lastGoodAgeDays,
    attemptOutcome,
    certificationMismatch: condition === "cpo" && provider?.providerCertifiedEcho === false,
    subjectMismatch: false,
    priceBasisInvalid: false,
  });
  if (!freshness.useLastGood && attemptOutcome !== "succeeded") provider = null;

  // ── 16-20. Comparables, statistics, confidence, verdict.
  const storedComparables = Array.isArray(listing.comparables) ? listing.comparables : [];
  const { view, explanation } = buildMarketView({
    subject: {
      vin,
      year: num((listing.mc_attributes as Record<string, unknown>)?.year),
      make: ((listing.mc_raw as Record<string, unknown>)?.build as Record<string, unknown>)?.make as string ?? null,
      model: ((listing.mc_raw as Record<string, unknown>)?.build as Record<string, unknown>)?.model as string ?? null,
      trim: listing.trim,
      drivetrain: ((listing.mc_raw as Record<string, unknown>)?.build as Record<string, unknown>)?.drivetrain as string ?? null,
      powertrain: null,
      mileage: listing.mileage,
      certified: condition === "cpo" ? true : condition === null ? null : false,
      price: listing.price,
      advertisedPriceBeforeDoc: listing.advertised_price_before_doc,
      websiteSalePrice: listing.website_sale_price,
      docFee: listing.doc_fee,
      advertisedExcludesDocFee: (settings.advertised_excludes_doc_fee as boolean) ?? null,
      tenantMandatoryAddOns,
      dealerType,
      zip,
    },
    condition,
    // deno-lint-ignore no-explicit-any
    candidates: storedComparables.map((c: any) => legacyComparableToCandidate(c)),
    identity,
    provider,
    materialContradictions: [],
    nowMs: Date.now(),
  });

  const auditReasons = [
    ...view.confidenceReasons,
    ...freshness.reasons,
    ...(reservationOutcome !== "not_required" ? [`reservation_${reservationOutcome}`] : []),
    ...(attemptOutcome !== "not_attempted" ? [`provider_attempt_${attemptOutcome}`] : []),
  ];

  if (dryRun) {
    return json(200, { dry_run: true, view, reasons: auditReasons, request: built.sanitizedParams });
  }

  // ── 21. Commit the decision and its evidence together.
  const valuationRow = {
    tenant_id: tenantId,
    listing_id: listing.id,
    vin,
    algorithm_version: explanation.engineVersion,
    status: view.status,
    checked_at: view.checkedAt,
    stale_at: view.staleAt,
    subject_inputs: built.sanitizedParams,
    displayed_total_price: view.displayedTotalPrice,
    vehicle_comparison_price: view.vehicleComparisonPrice,
    conditional_discounts: explanation.priceBasis.conditionalDiscountsExcluded,
    mandatory_dealer_add_ons: explanation.priceBasis.mandatoryDealerAddOns,
    mandatory_add_ons_included_in_displayed_price:
      explanation.priceBasis.mandatoryAddOnsIncludedInDisplayedPrice,
    mandatory_add_on_source: explanation.priceBasis.mandatoryAddOnSource,
    total_with_mandatory_add_ons: explanation.priceBasis.totalWithMandatoryAddOns,
    doc_fee: view.docFee,
    fee_decomposition: explanation.priceBasis.provenance,
    price_basis_status: explanation.priceBasis.basisStatus,
    price_basis_reasons: explanation.priceBasis.basisReasons,
    provider: view.provider,
    provider_endpoint: MARKETCHECK_ENDPOINT_VERSION,
    provider_selected_field: view.selectedProviderField,
    provider_request_params: built.sanitizedParams,
    provider_request_fingerprint: explanation.providerRequestFingerprint,
    provider_response_hash: provider?.responseHash ?? null,
    provider_prediction: provider?.predictedValue ?? null,
    provider_range_low: provider?.providerRangeLow ?? null,
    provider_range_high: provider?.providerRangeHigh ?? null,
    provider_validation: explanation.providerValidation,
    provider_answered_at: provider?.receivedAt ?? null,
    provider_attempt_status: attemptOutcome,
    certification_match: provider == null ? null
      : provider.providerCertifiedEcho == null ? null
      : provider.providerCertifiedEcho === (condition === "cpo"),
    valuation_input_fingerprint: explanation.valuationInputFingerprint,
    raw_candidate_count: explanation.stats.rawCandidateCount,
    eligible_primary_count: explanation.stats.eligiblePrimaryCount,
    effective_sample_size: explanation.stats.effectiveSampleSize,
    independent_rooftop_count: explanation.stats.independentRooftopCount,
    independent_group_count: explanation.stats.independentGroupCount,
    top_rooftop_share: explanation.stats.topRooftopShare,
    top_group_share: explanation.stats.topGroupShare,
    effective_rooftop_cap: explanation.stats.effectiveRooftopCap,
    effective_group_cap: explanation.stats.effectiveGroupCap,
    strict_concentration_satisfied: explanation.stats.strictConcentrationSatisfied,
    insufficient_market_diversity: explanation.stats.insufficientMarketDiversity,
    winning_tier: explanation.winningTier,
    relaxation_steps: explanation.relaxationSteps,
    comparable_p10: explanation.stats.p10,
    comparable_p25: explanation.stats.p25,
    comparable_p50: explanation.stats.p50,
    comparable_p75: explanation.stats.p75,
    comparable_p90: explanation.stats.p90,
    market_floor: explanation.stats.marketFloor,
    confidence_tier: view.confidence,
    confidence_reasons: [...new Set(auditReasons)],
    verdict: view.verdict,
    verdict_tone: explanation.tone,
    difference: view.difference,
    difference_percent: view.differencePercent,
    price_to_market_percent: view.priceToMarketPercent,
    shadow_composite: explanation.shadowComposite,
    model_versions: { engine: explanation.engineVersion },
    data_provenance: { comparable_snapshot: explanation.comparableSnapshotHash },
  };

  const comparableRows = explanation.comparables.map((c, i) => ({
    subject_vin: vin,
    comparable_vin: c.vin || null,
    evidence_ref: c.vin || `${explanation.comparableSnapshotHash}-${i}`,
    raw_attributes: {},
    year: c.year, make: c.make, model: c.model, trim: c.trim, drivetrain: c.drivetrain,
    mileage: c.mileage,
    advertised_price: c.advertisedPrice,
    normalized_vehicle_price: c.normalizedVehiclePrice,
    price_basis_status: c.priceBasisStatus,
    certified: c.certified,
    certification_program: c.certificationProgram,
    dealer_name: c.dealerName, dealer_id: c.dealerId, rooftop_id: c.rooftopId,
    dealer_group_id: c.dealerGroupId, dealer_group_name: c.dealerGroupName,
    dealer_domain: c.dealerDomain,
    distance_miles: c.distanceMiles, days_on_market: c.daysOnMarket,
    listing_observed_at: c.listingObservedAt,
    history_status: c.historyStatus, condition_status: c.conditionStatus,
    is_duplicate: c.exclusionReasons.includes("duplicate_vin"),
    inclusion_status: c.inclusionStatus,
    tier: explanation.winningTier,
    exclusion_reasons: c.exclusionReasons,
    similarity_components: c.similarityComponents,
    raw_weight: c.rawWeight,
    capped_weight: c.cappedWeight,
    adjusted_price: c.adjustedPrice,
    source_observed_at: c.listingObservedAt,
  }));

  const { data: valuationId, error: commitError } = await admin.rpc("market_valuation_commit", {
    p_valuation: valuationRow,
    p_comparables: comparableRows,
  });
  if (commitError) return json(500, { error: "commit_failed", detail: commitError.message });

  // ── 22. Compatibility columns, ONLY under the tenant's admin flag. With the
  // flag off this function is pure evidence: it records what V2 concluded and
  // changes nothing a dealer or customer can see.
  let compatibilityUpdated = false;
  if (readMarketFlag(settings, "market_value_v2_admin")) {
    await admin.from("vehicle_listings").update({
      market_value: view.marketP50,
      market_position: null,          // the legacy vocabulary is retired here
      market_checked_at: view.checkedAt,
      market_payload: {
        source: PROVIDER,
        rawProvider: PROVIDER,
        provider_valuation: provider,
        provider_request_fingerprint: explanation.providerRequestFingerprint,
        valuation_id: valuationId,
        verdict: view.verdict,
        confidence: view.confidence,
      },
    }).eq("tenant_id", tenantId).eq("vin", vin);
    compatibilityUpdated = true;
  }

  // ── 23. Audit evidence.
  //
  // The column is `details`, as it is for every other function that writes
  // here. This said `metadata` until Gate 14D: PostgREST rejected the unknown
  // column, the rejection was discarded by the empty error handler below, and
  // the audit row this function believed it was writing was never written.
  // The failure is now surfaced, because an audit trail that fails silently is
  // worse than none: it reads as evidence of absence.
  const { error: auditError } = await admin.from("audit_log").insert({
    action: "market_valuation_written",
    entity_type: "vehicle_listing",
    entity_id: listing.id,
    store_id: tenantId,
    details: {
      vin, valuation_id: valuationId, status: view.status, confidence: view.confidence,
      verdict: view.verdict, provider_attempt: attemptOutcome,
      reservation: reservationOutcome, compatibility_updated: compatibilityUpdated,
    },
  });
  if (auditError) console.error("audit_log insert failed", auditError.message);

  // ── 24. One canonical MarketView.
  return json(200, { valuation_id: valuationId, view, compatibility_updated: compatibilityUpdated });
});

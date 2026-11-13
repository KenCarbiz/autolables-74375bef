// GENERATED — do not edit.
// Mirror of src/lib/market/shadowPipeline.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { digest } from "./hash.ts";
import { readMarketFlag } from "./flags.ts";
export type ProviderPolicy = "reserved" | "disabled";
export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = "reserved";
export function readProviderPolicy(value: unknown): ProviderPolicy {
    return value === "disabled" ? "disabled" : "reserved";
}
export function providerCallPermitted(policy: ProviderPolicy): boolean {
    return policy === "reserved";
}
export const APPROVED_SHADOW_SOURCES = [
    "ingestion",
    "enrichment_sweep",
    "server_operator",
] as const;
export type ApprovedShadowSource = (typeof APPROVED_SHADOW_SOURCES)[number];
export type ShadowInvocationSource = ApprovedShadowSource | "browser" | "unknown";
export const isApprovedShadowSource = (s: unknown): s is ApprovedShadowSource => typeof s === "string" && (APPROVED_SHADOW_SOURCES as readonly string[]).includes(s);
export function sanitizeInvocationSource(value: unknown): ShadowInvocationSource {
    if (isApprovedShadowSource(value))
        return value;
    return value === "browser" ? "browser" : "unknown";
}
export const SHADOW_COHORT_SETTING = "market_value_v2_shadow_vins";
export const MAX_SHADOW_COHORT = 50;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
export interface ShadowCohort {
    vins: string[];
    reasons: string[];
}
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
        return { vins: [], reasons: ["shadow_cohort_not_a_list"] };
    }
    const seen = new Set<string>();
    let rejected = 0;
    for (const entry of raw) {
        const vin = typeof entry === "string" ? entry.trim().toUpperCase() : "";
        if (!VIN_PATTERN.test(vin)) {
            rejected++;
            continue;
        }
        seen.add(vin);
    }
    if (rejected > 0)
        reasons.push(`shadow_cohort_rejected_${rejected}_malformed`);
    if (raw.length !== seen.size + rejected)
        reasons.push("shadow_cohort_deduplicated");
    if (seen.size > MAX_SHADOW_COHORT) {
        return { vins: [], reasons: [...reasons, `shadow_cohort_exceeds_${MAX_SHADOW_COHORT}`] };
    }
    if (seen.size === 0)
        reasons.push("shadow_cohort_empty");
    return { vins: [...seen].sort(), reasons };
}
export const isInShadowCohort = (cohort: ShadowCohort, vin: unknown): boolean => typeof vin === "string" && cohort.vins.includes(vin.trim().toUpperCase());
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
    if (v === null || v === undefined)
        return null;
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean")
        return v;
    if (typeof v === "string")
        return v.trim().toLowerCase() || null;
    return null;
};
export function materialValuationInputs(source: MaterialInputSource): Record<MaterialValuationInput, unknown> {
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
        dealer_identity: source.dealerIdentity == null ? null : digest(source.dealerIdentity),
        doc_fee: scalar(source.docFee),
        advertised_includes_doc_fee: scalar(source.advertisedIncludesDocFee),
        mandatory_add_ons_usd: scalar(source.mandatoryAddOnsUsd),
        mandatory_add_ons_included_in_displayed_price: scalar(source.mandatoryAddOnsIncludedInDisplayedPrice),
    };
}
export function materialInputFingerprint(source: MaterialInputSource): string {
    return digest({ kind: "material_valuation_inputs", ...materialValuationInputs(source) });
}
export interface MaterialChange {
    changed: boolean;
    changedKeys: MaterialValuationInput[];
    fingerprint: string;
}
export function compareMaterialInputs(before: MaterialInputSource | null | undefined, after: MaterialInputSource): MaterialChange {
    const fingerprint = materialInputFingerprint(after);
    if (!before)
        return { changed: true, changedKeys: [...MATERIAL_VALUATION_INPUTS], fingerprint };
    const a = materialValuationInputs(before);
    const b = materialValuationInputs(after);
    const changedKeys = MATERIAL_VALUATION_INPUTS.filter((k) => a[k] !== b[k]);
    return { changed: changedKeys.length > 0, changedKeys, fingerprint };
}
export interface ExistingShadowEvaluation {
    materialInputFingerprint: string | null;
    algorithmVersion: string | null;
    status: string | null;
}
export const COMPLETED_EVALUATION_STATUSES = ["available", "limited", "unavailable"] as const;
export const isCompletedEvaluation = (status: unknown): boolean => typeof status === "string" && (COMPLETED_EVALUATION_STATUSES as readonly string[]).includes(status);
export interface ShadowRequestDecision {
    invoke: boolean;
    providerPolicy: "disabled";
    source: ShadowInvocationSource;
    materialInputFingerprint: string | null;
    reasons: string[];
}
export function decideShadowRequest(input: {
    settings: unknown;
    tenantId: string | null | undefined;
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
    if (!readMarketFlag(input.settings, "market_value_v2_shadow")) {
        reasons.push("shadow_flag_off");
        return deny();
    }
    if (!isApprovedShadowSource(source)) {
        reasons.push(`shadow_source_rejected_${source}`);
        return deny();
    }
    if (!input.tenantId || !input.listingTenantId || input.tenantId !== input.listingTenantId) {
        reasons.push("shadow_tenant_mismatch");
        return deny();
    }
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
    const existing = input.existing ?? null;
    const hasCompletedPrior = !!existing && isCompletedEvaluation(existing.status);
    if (hasCompletedPrior) {
        if (existing!.materialInputFingerprint === input.materialChange.fingerprint
            && existing!.algorithmVersion === input.algorithmVersion) {
            reasons.push("shadow_duplicate_material_inputs", "shadow_no_material_change");
            return deny();
        }
        reasons.push(existing!.algorithmVersion !== input.algorithmVersion
            ? "shadow_algorithm_version_changed"
            : "shadow_material_inputs_changed");
    }
    else {
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

// GENERATED — do not edit.
// Mirror of src/lib/market/flags.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const MARKET_FLAGS = {
    market_value_v2_shadow: false,
    market_value_v2_admin: false,
    market_value_v2_public: false,
    marketcheck_current_endpoint: false,
    marketcheck_premium_comparables: false,
    pricing_position_v2_shadow: false,
    market_invalid_claim_suppression: false,
    exact_mds: false,
    current_sales_stats: false,
    sold_summary: false,
    generic_vin_fallback: false,
    available_options_packages: false,
    premium_plus_used_intake: false,
    premium_used_refresh: false,
    autorecalls_vin: false,
    market_intelligence_v3_shadow: false,
    premium_plus_new_intake: false,
    fee_normalized_comps: false,
    nmvtis_auto_verify: false,
    oem_incentives_v2: false,
    provider_webhooks: false,
    blackbook_live: false,
    market_value_v3_shadow: false,
    market_value_v3_public: false,
    vehicle_score_shadow: false,
    vehicle_score_public: false,
    data_confidence: false,
    buyer_recommendation: false,
    passport_2_new: false,
    passport_2_used: false,
    marketpass_v2: false,
} as const;
export type MarketFlag = keyof typeof MARKET_FLAGS;
export const MARKET_FLAG_NAMES = Object.keys(MARKET_FLAGS) as MarketFlag[];
export const isMarketFlag = (v: unknown): v is MarketFlag => typeof v === "string" && (MARKET_FLAG_NAMES as string[]).includes(v);
export function readMarketFlag(settings: unknown, flag: MarketFlag): boolean {
    const bag = (settings ?? null) as {
        market_flags?: Record<string, unknown>;
    } | null;
    return bag?.market_flags?.[flag] === true;
}
export function readMarketFlags(settings: unknown): Record<MarketFlag, boolean> {
    const out = {} as Record<MarketFlag, boolean>;
    for (const flag of MARKET_FLAG_NAMES)
        out[flag] = readMarketFlag(settings, flag);
    return out;
}
export const SHADOW_CONTROL_REQUIREMENTS = [
    "server_side_only",
    "tenant_scoped",
    "no_public_rendering",
    "no_compatibility_column_write",
    "no_automatic_provider_call",
    "no_budget_bypass",
    "append_only_evidence",
    "auditable_invocation_source",
    "immediate_off_switch",
    "no_browser_controlled_provider_spend",
] as const;
export type ShadowControlRequirement = (typeof SHADOW_CONTROL_REQUIREMENTS)[number];
export type ShadowInvocationSource = "server_scheduled" | "server_operator" | "browser" | "unknown";
const SERVER_SOURCES: ShadowInvocationSource[] = ["server_scheduled", "server_operator"];
export interface ShadowDecision {
    run: boolean;
    allowProviderCall: false;
    allowCompatibilityWrite: false;
    allowPublicRender: false;
    reasons: string[];
}
export function decideShadowEvaluation(input: {
    settings: unknown;
    tenantId: string | null | undefined;
    source: ShadowInvocationSource;
}): ShadowDecision {
    const reasons: string[] = [];
    const deny = (): ShadowDecision => ({
        run: false,
        allowProviderCall: false,
        allowCompatibilityWrite: false,
        allowPublicRender: false,
        reasons,
    });
    if (!readMarketFlag(input.settings, "market_value_v2_shadow")) {
        reasons.push("shadow_flag_off");
        return deny();
    }
    if (!input.tenantId) {
        reasons.push("shadow_requires_tenant_scope");
        return deny();
    }
    if (!SERVER_SOURCES.includes(input.source)) {
        reasons.push(`shadow_invocation_source_rejected_${input.source}`);
        reasons.push("no_browser_controlled_provider_spend");
        return deny();
    }
    reasons.push("shadow_enabled", `shadow_invocation_source_${input.source}`);
    return {
        run: true,
        allowProviderCall: false,
        allowCompatibilityWrite: false,
        allowPublicRender: false,
        reasons,
    };
}
export const isInertWithoutReader = (readerCount: number): boolean => readerCount === 0;

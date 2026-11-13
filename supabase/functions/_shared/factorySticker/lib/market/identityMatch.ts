// GENERATED — do not edit.
// Mirror of src/lib/market/identityMatch.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const IDENTITY_MATCH_LEVELS = [
    "EXACT_VIN",
    "EXACT_BUILD",
    "YMMT",
    "YMM",
    "GENERIC_CANDIDATE",
    "UNKNOWN",
] as const;
export type IdentityMatchLevel = (typeof IDENTITY_MATCH_LEVELS)[number];
const RANK: Record<IdentityMatchLevel, number> = {
    EXACT_VIN: 0,
    EXACT_BUILD: 1,
    YMMT: 2,
    YMM: 3,
    GENERIC_CANDIDATE: 4,
    UNKNOWN: 5,
};
export const isIdentityMatchLevel = (v: unknown): v is IdentityMatchLevel => typeof v === "string" && (IDENTITY_MATCH_LEVELS as readonly string[]).includes(v);
export const EXACT_LEVELS: IdentityMatchLevel[] = ["EXACT_VIN", "EXACT_BUILD"];
export const isExactIdentity = (level: IdentityMatchLevel): boolean => EXACT_LEVELS.includes(level);
export const EXACT_ONLY_CLAIMS = [
    "factory_verified",
    "exact_configuration",
    "exact_installed_equipment",
    "exact_trim_version_identity",
    "exact_msrp",
    "vehicle_score_evidence",
] as const;
export type ExactOnlyClaim = (typeof EXACT_ONLY_CLAIMS)[number];
export function mayClaim(claim: ExactOnlyClaim | "market_context" | "price_estimate", level: IdentityMatchLevel): boolean {
    if (level === "UNKNOWN")
        return false;
    if ((EXACT_ONLY_CLAIMS as readonly string[]).includes(claim))
        return isExactIdentity(level);
    return true;
}
export type IdentityConfidenceCeiling = "high" | "moderate" | "limited" | "none";
export function identityConfidenceCeiling(level: IdentityMatchLevel): IdentityConfidenceCeiling {
    switch (level) {
        case "EXACT_VIN":
        case "EXACT_BUILD":
            return "high";
        case "YMMT":
            return "moderate";
        case "YMM":
        case "GENERIC_CANDIDATE":
            return "limited";
        default:
            return "none";
    }
}
export interface IdentityResolution {
    level: IdentityMatchLevel;
    fallbackUsed: boolean;
    providerTier: string | null;
    candidates: unknown[];
    diagnostics: string[];
}
export function readIdentityResolution(args: {
    body: unknown;
    fallbackRequested: boolean;
}): IdentityResolution {
    const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)
        ? args.body : {}) as Record<string, unknown>;
    const diagnostics: string[] = [];
    const genericMarkers = [body.is_generic, body.generic, body.fallback_used, body.used_generic_fallback];
    const genericFlag = genericMarkers.some((v) => v === true || v === "true" || v === 1);
    const candidates = Array.isArray(body.candidates) ? body.candidates
        : Array.isArray(body.generic_candidates) ? body.generic_candidates
            : Array.isArray(body.generic_vehicles) ? body.generic_vehicles
                : [];
    const providerTier = typeof body.match_tier === "string" ? body.match_tier
        : typeof body.match_level === "string" ? body.match_level
            : typeof body.decode_mode === "string" ? body.decode_mode
                : null;
    const exactDenied = genericMarkers.some((v) => v === false || v === "false" || v === 0);
    if (genericFlag || candidates.length > 0) {
        diagnostics.push(genericFlag ? "provider_marked_generic" : "provider_returned_candidates");
        if (!args.fallbackRequested)
            diagnostics.push("generic_answer_without_fallback_request");
        return { level: "GENERIC_CANDIDATE", fallbackUsed: true, providerTier, candidates, diagnostics };
    }
    if (args.fallbackRequested) {
        if (exactDenied) {
            diagnostics.push("fallback_requested_provider_says_exact");
            return { level: "EXACT_VIN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
        }
        diagnostics.push("fallback_requested_no_marker_in_body");
        return { level: "UNKNOWN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
    }
    return { level: "EXACT_VIN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
}
export function mergeByIdentity<T>(held: {
    value: T;
    level: IdentityMatchLevel;
} | null, incoming: {
    value: T;
    level: IdentityMatchLevel;
} | null): {
    value: T;
    level: IdentityMatchLevel;
    reason: string;
} | null {
    if (!incoming)
        return held ? { ...held, reason: "held_only" } : null;
    if (!held)
        return { ...incoming, reason: "incoming_fills_gap" };
    if (RANK[incoming.level] > RANK[held.level])
        return { ...held, reason: "incoming_less_exact_than_held" };
    return { ...incoming, reason: RANK[incoming.level] < RANK[held.level] ? "incoming_more_exact" : "same_level_newer_wins" };
}

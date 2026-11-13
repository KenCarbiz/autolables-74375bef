// GENERATED — do not edit.
// Mirror of src/lib/market/freshness.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const PROVIDER_FRESH_DAYS = 7;
export const PROVIDER_HARD_EXPIRY_DAYS = 14;
export type FreshnessTier = "fresh" | "stale" | "expired" | "none";
export type ProviderAttemptOutcome = "succeeded" | "timeout" | "rate_limited" | "server_error" | "network_error" | "auth_failed" | "not_entitled" | "request_rejected" | "not_attempted";
export const TRANSIENT_OUTCOMES: ProviderAttemptOutcome[] = [
    "timeout",
    "rate_limited",
    "server_error",
    "network_error",
];
export const PERMANENT_OUTCOMES: ProviderAttemptOutcome[] = [
    "auth_failed",
    "not_entitled",
    "request_rejected",
];
export const isTransientFailure = (o: ProviderAttemptOutcome): boolean => TRANSIENT_OUTCOMES.includes(o);
export const isPermanentFailure = (o: ProviderAttemptOutcome): boolean => PERMANENT_OUTCOMES.includes(o);
export const isFailedAttempt = (o: ProviderAttemptOutcome): boolean => isTransientFailure(o) || isPermanentFailure(o);
export interface FreshnessInput {
    lastGoodAgeDays: number | null;
    attemptOutcome: ProviderAttemptOutcome;
    certificationMismatch: boolean;
    subjectMismatch: boolean;
    priceBasisInvalid: boolean;
}
export interface FreshnessDecision {
    tier: FreshnessTier;
    useLastGood: boolean;
    allowRed: boolean;
    showStaleWarning: boolean;
    refreshRecommended: boolean;
    reasons: string[];
}
export function resolveProviderFreshness(input: FreshnessInput): FreshnessDecision {
    const reasons: string[] = [];
    if (isFailedAttempt(input.attemptOutcome)) {
        reasons.push(`provider_attempt_${input.attemptOutcome}`);
        reasons.push("failed_attempt_did_not_replace_last_good");
        if (isPermanentFailure(input.attemptOutcome)) {
            reasons.push("provider_failure_will_not_self_resolve");
        }
    }
    if (input.certificationMismatch)
        reasons.push("certification_mismatch_voids_last_good");
    if (input.subjectMismatch)
        reasons.push("subject_mismatch_voids_last_good");
    if (input.priceBasisInvalid)
        reasons.push("price_basis_invalid_voids_last_good");
    if (input.certificationMismatch || input.subjectMismatch || input.priceBasisInvalid) {
        return {
            tier: "none",
            useLastGood: false,
            allowRed: false,
            showStaleWarning: false,
            refreshRecommended: true,
            reasons,
        };
    }
    const age = input.lastGoodAgeDays;
    if (age == null) {
        reasons.push("no_stored_provider_answer");
        return { tier: "none", useLastGood: false, allowRed: false, showStaleWarning: false, refreshRecommended: true, reasons };
    }
    if (age <= PROVIDER_FRESH_DAYS) {
        return {
            tier: "fresh",
            useLastGood: true,
            allowRed: true,
            showStaleWarning: false,
            refreshRecommended: false,
            reasons,
        };
    }
    if (age <= PROVIDER_HARD_EXPIRY_DAYS) {
        reasons.push("provider_answer_older_than_seven_days");
        return {
            tier: "stale",
            useLastGood: true,
            allowRed: false,
            showStaleWarning: true,
            refreshRecommended: true,
            reasons,
        };
    }
    reasons.push("provider_answer_expired");
    return {
        tier: "expired",
        useLastGood: false,
        allowRed: false,
        showStaleWarning: true,
        refreshRecommended: true,
        reasons,
    };
}

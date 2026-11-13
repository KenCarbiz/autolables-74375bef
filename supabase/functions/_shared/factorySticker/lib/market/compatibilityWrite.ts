// GENERATED — do not edit.
// Mirror of src/lib/market/compatibilityWrite.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { MarketConfidence, MarketViewStatus } from "./types.ts";
export interface LegacyMarketColumns {
    market_value: number | null;
    market_position: string | null;
}
export interface CompatibilityCandidate {
    marketP50: number | null;
    status: MarketViewStatus;
    confidence: MarketConfidence;
    checkedAt: string | null;
    verdict: string;
    effectiveComparableCount: number;
    providerPrediction: number | null;
    approvedPositionMapping: string | null;
}
export interface CompatibilityPatch {
    market_value: number;
    market_position: string;
    market_checked_at: string;
    market_payload: Record<string, unknown>;
}
export interface CompatibilityDecision {
    update: boolean;
    patch: CompatibilityPatch | null;
    reasons: string[];
}
const PUBLISHABLE_CONFIDENCE: MarketConfidence[] = ["high", "medium"];
export function decideCompatibilityWrite(input: {
    flagEnabled: boolean;
    shadow?: boolean;
    legacy: LegacyMarketColumns;
    candidate: CompatibilityCandidate;
    payload: Record<string, unknown>;
}): CompatibilityDecision {
    const reasons: string[] = [];
    const { legacy, candidate } = input;
    const refuse = (): CompatibilityDecision => ({ update: false, patch: null, reasons });
    if (input.shadow === true) {
        reasons.push("shadow_evaluation_never_writes_compatibility_columns");
        return refuse();
    }
    if (!input.flagEnabled) {
        reasons.push("compatibility_flag_off");
        return refuse();
    }
    if (candidate.approvedPositionMapping == null) {
        reasons.push("legacy_position_mapping_not_approved");
        reasons.push("flag_alone_is_not_authorization_for_a_destructive_write");
        return refuse();
    }
    if (candidate.status !== "available") {
        reasons.push(`v2_status_${candidate.status}`);
        if (legacy.market_value != null)
            reasons.push("would_erase_legacy_market_value");
        if (legacy.market_position != null)
            reasons.push("would_erase_legacy_market_position");
        return refuse();
    }
    if (!PUBLISHABLE_CONFIDENCE.includes(candidate.confidence)) {
        reasons.push(`v2_confidence_${candidate.confidence}`);
        return refuse();
    }
    if (candidate.marketP50 == null || !(candidate.marketP50 > 0)) {
        reasons.push("v2_market_value_absent");
        if (legacy.market_value != null)
            reasons.push("would_erase_legacy_market_value");
        return refuse();
    }
    if (candidate.effectiveComparableCount <= 0) {
        reasons.push("no_effective_comparables");
        if (candidate.providerPrediction != null) {
            reasons.push("provider_prediction_is_not_a_market_value");
        }
        return refuse();
    }
    if (!candidate.approvedPositionMapping.trim()) {
        reasons.push("approved_position_mapping_blank");
        if (legacy.market_position != null)
            reasons.push("would_erase_legacy_market_position");
        return refuse();
    }
    if (!candidate.checkedAt) {
        reasons.push("v2_checked_at_absent");
        return refuse();
    }
    reasons.push("compatibility_write_authorized");
    return {
        update: true,
        patch: {
            market_value: candidate.marketP50,
            market_position: candidate.approvedPositionMapping,
            market_checked_at: candidate.checkedAt,
            market_payload: input.payload,
        },
        reasons,
    };
}
export function wouldDestroyLegacyClaim(legacy: LegacyMarketColumns, patch: Partial<Record<"market_value" | "market_position", unknown>> | null): boolean {
    if (!patch)
        return false;
    const value = patch.market_value;
    const position = patch.market_position;
    if (legacy.market_value != null && (value === null || value === undefined))
        return true;
    if (legacy.market_position != null && (position === null || position === undefined))
        return true;
    return false;
}

// GENERATED — do not edit.
// Mirror of src/lib/market/rawPayloadBoundary.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type RawPayloadKind = "syndication_row" | "legacy_market_pricing" | "empty" | "unknown";
export interface RawPayloadClassification {
    kind: RawPayloadKind;
    reasons: string[];
}
export const LEGACY_PRICING_KEYS = ["marketValue", "rawProvider", "listingPrice", "position"] as const;
export const SYNDICATION_ROW_KEYS = ["build", "dealer", "media", "mc_dealership", "inventory_type", "heading"] as const;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function classifyRawPayload(value: unknown): RawPayloadClassification {
    if (value === null || value === undefined)
        return { kind: "empty", reasons: ["null"] };
    if (!isObject(value))
        return { kind: "unknown", reasons: ["not_an_object"] };
    const keys = Object.keys(value);
    if (keys.length === 0)
        return { kind: "empty", reasons: ["no_keys"] };
    const legacyHits = LEGACY_PRICING_KEYS.filter((k) => k in value);
    const rowHits = SYNDICATION_ROW_KEYS.filter((k) => k in value);
    if (rowHits.length >= 2 && legacyHits.length === 0) {
        return { kind: "syndication_row", reasons: rowHits.map((k) => `has_${k}`) };
    }
    if (legacyHits.length >= 2 && rowHits.length === 0) {
        return { kind: "legacy_market_pricing", reasons: legacyHits.map((k) => `has_${k}`) };
    }
    return {
        kind: "unknown",
        reasons: [
            ...rowHits.map((k) => `has_${k}`),
            ...legacyHits.map((k) => `has_${k}`),
            ...(rowHits.length === 0 && legacyHits.length === 0 ? ["no_recognised_keys"] : []),
        ],
    };
}
export const LEGACY_PRICING_SQL_PREDICATE = "(mc_raw ? 'marketValue' AND mc_raw ? 'rawProvider') AND NOT (mc_raw ? 'build') AND NOT (mc_raw ? 'dealer')";

// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/precedence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type SourceKind = "oem_authorized" | "neovin" | "marketcheck" | "dealer_confirmed" | "vin_decode" | "dealer_vdp" | "other_structured" | "ai_inference";
export const SOURCE_KINDS: SourceKind[] = [
    "oem_authorized",
    "neovin",
    "marketcheck",
    "dealer_confirmed",
    "vin_decode",
    "dealer_vdp",
    "other_structured",
    "ai_inference",
];
export type FactAuthority = "manufacturer" | "dealer" | "history_provider" | "shared";
export type Confidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";
const DEFAULT_ORDER: SourceKind[] = [
    "oem_authorized",
    "neovin",
    "marketcheck",
    "dealer_confirmed",
    "vin_decode",
    "dealer_vdp",
    "other_structured",
    "ai_inference",
];
const DEALER_CONTROLLED = new Set([
    "stock_number",
    "mileage",
    "advertised_price",
    "dealer_installed_equipment",
    "dealer_discount",
    "doc_fee",
    "condition_notes",
]);
const MANUFACTURER_CONTROLLED = new Set([
    "manufacturer",
    "make",
    "model_year",
    "base_msrp",
    "destination_charge",
    "total_msrp",
    "factory_option_price",
    "factory_package",
    "factory_option",
    "standard_equipment",
    "drivetrain",
    "engine",
    "transmission",
    "exterior_color_code",
    "interior_color_code",
    "assembly_plant",
    "parts_content",
]);
const HISTORY_PROVIDER_CONTROLLED = new Set([
    "carfax_one_owner",
    "carfax_clean_title",
    "title_brand",
    "accident_history",
    "owner_count",
    "certified_pre_owned",
]);
export function factAuthority(factKey: string): FactAuthority {
    const key = factKey.trim().toLowerCase();
    if (DEALER_CONTROLLED.has(key))
        return "dealer";
    if (MANUFACTURER_CONTROLLED.has(key))
        return "manufacturer";
    if (HISTORY_PROVIDER_CONTROLLED.has(key))
        return "history_provider";
    return "shared";
}
export function precedenceFor(factKey: string): SourceKind[] {
    const authority = factAuthority(factKey);
    if (authority === "dealer") {
        return [
            "dealer_confirmed",
            "oem_authorized",
            "neovin",
            "marketcheck",
            "vin_decode",
            "other_structured",
            "ai_inference",
        ];
    }
    if (authority === "history_provider") {
        return [
            "marketcheck",
            "dealer_vdp",
            "oem_authorized",
            "neovin",
            "other_structured",
            "vin_decode",
            "dealer_confirmed",
            "ai_inference",
        ];
    }
    if (authority === "manufacturer") {
        return [
            "oem_authorized",
            "neovin",
            "marketcheck",
            "vin_decode",
            "other_structured",
            "dealer_confirmed",
            "ai_inference",
        ];
    }
    return [...DEFAULT_ORDER];
}
export function sourceRank(factKey: string, source: SourceKind, configuredOrder?: SourceKind[] | null): number {
    if (configuredOrder?.length) {
        const idx = configuredOrder.indexOf(source);
        if (idx >= 0)
            return idx;
        return configuredOrder.length + precedenceFor(factKey).indexOf(source);
    }
    const order = precedenceFor(factKey);
    const idx = order.indexOf(source);
    return idx < 0 ? order.length : idx;
}
const MAX_CONFIDENCE: Record<SourceKind, Confidence> = {
    oem_authorized: "VERIFIED",
    neovin: "VERIFIED",
    marketcheck: "HIGH",
    dealer_confirmed: "VERIFIED",
    vin_decode: "MEDIUM",
    dealer_vdp: "MEDIUM",
    other_structured: "MEDIUM",
    ai_inference: "LOW",
};
const CONFIDENCE_ORDER: Confidence[] = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"];
export function capConfidence(source: SourceKind, claimed: Confidence): Confidence {
    const ceiling = MAX_CONFIDENCE[source] ?? "UNVERIFIED";
    const claimedIdx = CONFIDENCE_ORDER.indexOf(claimed);
    const ceilingIdx = CONFIDENCE_ORDER.indexOf(ceiling);
    return CONFIDENCE_ORDER[Math.max(claimedIdx < 0 ? CONFIDENCE_ORDER.length - 1 : claimedIdx, ceilingIdx)];
}
export function isVerified(source: SourceKind, claimed: Confidence): boolean {
    return capConfidence(source, claimed) === "VERIFIED";
}
export function canProduceVerifiedFact(source: SourceKind): boolean {
    return MAX_CONFIDENCE[source] === "VERIFIED";
}
export interface CandidateFact<T = unknown> {
    factKey: string;
    value: T;
    source: SourceKind;
    confidence: Confidence;
    sourceTimestamp?: string | null;
}
export interface ResolvedFact<T = unknown> {
    factKey: string;
    value: T;
    source: SourceKind;
    confidence: Confidence;
    conflicting: Array<CandidateFact<T>>;
    disputed: boolean;
    blocking: boolean;
}
export interface ResolveOptions {
    configuredOrder?: SourceKind[] | null;
    conflictBehavior?: "warn" | "block_generation" | "ignore";
}
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function resolveFact<T>(candidates: Array<CandidateFact<T>>, options: ResolveOptions = {}): ResolvedFact<T> | null {
    if (!candidates.length)
        return null;
    const factKey = candidates[0].factKey;
    const configuredOrder = options.configuredOrder ?? null;
    const ranked = [...candidates].sort((a, b) => {
        const byRank = sourceRank(factKey, a.source, configuredOrder)
            - sourceRank(factKey, b.source, configuredOrder);
        if (byRank !== 0)
            return byRank;
        const byConf = CONFIDENCE_ORDER.indexOf(capConfidence(a.source, a.confidence))
            - CONFIDENCE_ORDER.indexOf(capConfidence(b.source, b.confidence));
        if (byConf !== 0)
            return byConf;
        return String(b.sourceTimestamp ?? "").localeCompare(String(a.sourceTimestamp ?? ""));
    });
    const winner = ranked[0];
    const conflicting = ranked.slice(1).filter((c) => !sameValue(c.value, winner.value));
    const naturallyDisputed = conflicting.some((c) => canProduceVerifiedFact(c.source)
        && canProduceVerifiedFact(winner.source)
        && capConfidence(c.source, c.confidence) === "VERIFIED"
        && capConfidence(winner.source, winner.confidence) === "VERIFIED");
    const disputed = options.conflictBehavior === "ignore" ? false : naturallyDisputed;
    return {
        factKey,
        value: winner.value,
        source: winner.source,
        confidence: capConfidence(winner.source, winner.confidence),
        conflicting,
        disputed,
        blocking: disputed && options.conflictBehavior === "block_generation",
    };
}

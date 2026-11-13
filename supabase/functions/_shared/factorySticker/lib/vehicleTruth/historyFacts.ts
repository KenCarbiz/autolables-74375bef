// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/historyFacts.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { Confidence, ResolvedFact, SourceKind } from "./precedence.ts";
import { resolveFact } from "./precedence.ts";
import { candidatesFromHistory, type IngestOptions, type TruthListingRow } from "./ingest.ts";
export const HISTORY_FACT_KEYS = [
    "carfax_one_owner",
    "carfax_clean_title",
    "certified_pre_owned",
    "owner_count",
    "title_brand",
] as const;
export type HistoryFactKey = (typeof HISTORY_FACT_KEYS)[number];
export type HistoryFacts = Partial<Record<HistoryFactKey, ResolvedFact>>;
export function resolveHistoryFacts(listing: TruthListingRow, options: IngestOptions = {}): HistoryFacts {
    const byKey = new Map<string, Parameters<typeof resolveFact>[0]>();
    for (const c of candidatesFromHistory(listing, options)) {
        const arr = byKey.get(c.factKey) ?? [];
        arr.push(c);
        byKey.set(c.factKey, arr);
    }
    const out: HistoryFacts = {};
    for (const key of HISTORY_FACT_KEYS) {
        const resolved = resolveFact(byKey.get(key) ?? []);
        if (resolved)
            out[key] = resolved;
    }
    return out;
}
export function isBadgeworthy(fact: ResolvedFact | undefined): boolean {
    if (!fact)
        return false;
    if (fact.value !== true)
        return false;
    return fact.confidence !== "LOW" && fact.confidence !== "UNVERIFIED";
}
export function badgeAttribution(fact: ResolvedFact): string | null {
    switch (fact.confidence) {
        case "VERIFIED":
        case "HIGH":
            return null;
        case "MEDIUM":
            return fact.source === "dealer_vdp" ? "Per dealer listing" : "Unconfirmed";
        default:
            return "Unconfirmed";
    }
}
export type { Confidence, ResolvedFact, SourceKind };

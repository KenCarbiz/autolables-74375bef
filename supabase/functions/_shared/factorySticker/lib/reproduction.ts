// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/reproduction.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const DISCLOSURE_VERSION = "repro-2026-10-31-v1";
export const REPRODUCTION_BANNER = "REPRODUCTION WINDOW STICKER \u2014 NOT AN ORIGINAL MANUFACTURER LABEL";
export const REPRODUCTION_DISCLOSURE = "Reproduction window sticker prepared by AutoLabels from available vehicle data. " +
    "This document is not the original manufacturer-issued Monroney label and is not issued or " +
    "certified by the vehicle manufacturer. Equipment, pricing, ratings and origin information are " +
    "shown only where supported by the cited sources and may be incomplete. Verify details against " +
    "original manufacturer records.";
export const FACTORY_BUILD_UNVERIFIED = "Original factory build specifications have not been verified.";
export const PASSPORT_QR_CAPTION = "Scan for Vehicle Passport";
export const PASSPORT_PUBLIC_BASE = "https://autolabels.io";
export function canonicalPassportUrl(slug: string): string {
    const s = slug.trim();
    return s ? `${PASSPORT_PUBLIC_BASE}/v/${encodeURIComponent(s)}` : "";
}
export interface FactoryBuildProvenance {
    verified: boolean;
    source: string | null;
}
export function provenanceSentence(provenance: FactoryBuildProvenance | null | undefined): string {
    const source = provenance?.source?.trim();
    if (provenance?.verified === true && source) {
        return `Derived from original factory build specifications supplied by ${source}.`;
    }
    return FACTORY_BUILD_UNVERIFIED;
}
export function reproductionDisclosureLines(provenance: FactoryBuildProvenance | null | undefined): string[] {
    return [REPRODUCTION_DISCLOSURE, provenanceSentence(provenance)];
}

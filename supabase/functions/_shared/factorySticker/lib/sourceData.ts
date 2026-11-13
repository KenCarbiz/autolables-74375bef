// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/sourceData.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface SourceDataState {
    build_sheet?: unknown;
    options?: unknown;
    features?: unknown;
    specs_attempts?: unknown;
    specs_decoded_at?: unknown;
    specs_strict_attempted?: unknown;
}
export const MAX_SPEC_ATTEMPTS = 3;
export interface DecodeDecision {
    decode: boolean;
    reason: "no_build_sheet" | "already_decoded" | "attempt_cap_reached" | "generic_sheet_never_asked_strictly";
    attempts: number;
}
const isGenericSheet = (sheet: unknown): boolean => !!sheet && typeof sheet === "object"
    && (sheet as Record<string, unknown>).generic === true;
export function shouldDecodeVin(mcAttributes: SourceDataState | null | undefined, maxAttempts = MAX_SPEC_ATTEMPTS): DecodeDecision {
    const mc = mcAttributes ?? {};
    const attempts = Number(mc.specs_attempts) || 0;
    const hasBuildSheet = !!mc.build_sheet;
    if (hasBuildSheet) {
        const genericAndNeverAskedStrictly = isGenericSheet(mc.build_sheet) && mc.specs_strict_attempted !== true;
        if (genericAndNeverAskedStrictly && attempts < maxAttempts) {
            return { decode: true, reason: "generic_sheet_never_asked_strictly", attempts };
        }
        return { decode: false, reason: "already_decoded", attempts };
    }
    if (attempts >= maxAttempts)
        return { decode: false, reason: "attempt_cap_reached", attempts };
    return { decode: true, reason: "no_build_sheet", attempts };
}
export function hasStickerSourceData(mcAttributes: SourceDataState | null | undefined): boolean {
    return !!(mcAttributes ?? {}).build_sheet;
}

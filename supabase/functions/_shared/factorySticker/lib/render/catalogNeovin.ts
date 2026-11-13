// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/catalogNeovin.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerRenderData } from "./contract.ts";
const NHTSA_STANDARD = /^standard[\s-]+nhtsa$/i;
const RATING_ROW = /^(overall(?:\s+rating)?|frontal\s+crash(?:\s+rating)?|front\s+crash(?:\s+rating)?|side\s+impact(?:\s+rating)?|side\s+crash(?:\s+rating)?|rollover(?:\s+rating)?|rollover\s+resistance)\s*[-:]\s*([0-5])(?:\s*stars?)?$/i;
type Category = "overall" | "frontal" | "side" | "rollover";
const categoryOf = (label: string): Category => {
    const l = label.toLowerCase();
    if (l.startsWith("overall"))
        return "overall";
    if (l.startsWith("front"))
        return "frontal";
    if (l.startsWith("side"))
        return "side";
    return "rollover";
};
export interface DecodedNhtsa {
    overall: number | null;
    frontal: number | null;
    side: number | null;
    rollover: number | null;
}
export function nhtsaFromRatingMetadata(rows: readonly string[]): DecodedNhtsa | null {
    const trimmed = rows.map((r) => String(r ?? "").trim());
    if (!trimmed.some((r) => NHTSA_STANDARD.test(r)))
        return null;
    const found: Partial<Record<Category, Set<number>>> = {};
    for (const row of trimmed) {
        const m = RATING_ROW.exec(row);
        if (!m)
            continue;
        const cat = categoryOf(m[1]);
        (found[cat] ??= new Set()).add(Number(m[2]));
    }
    const pick = (c: Category): number | null => {
        const set = found[c];
        if (!set || set.size !== 1)
            return null;
        const n = [...set][0];
        return n >= 1 ? n : null;
    };
    return { overall: pick("overall"), frontal: pick("frontal"), side: pick("side"), rollover: pick("rollover") };
}
export function withCatalogNeovin(data: FactoryStickerRenderData): FactoryStickerRenderData {
    const neovin = data.neovin;
    if (!neovin)
        return data;
    let out = data;
    if (!data.safety && !data.nhtsaNotRated) {
        const n = nhtsaFromRatingMetadata(neovin.ratingMetadata);
        if (n && (n.overall || n.frontal || n.side || n.rollover)) {
            out = {
                ...out,
                safety: {
                    overall: n.overall,
                    frontalDriver: null,
                    frontalPassenger: null,
                    sideFront: null,
                    sideRear: null,
                    rollover: n.rollover,
                    frontal: n.frontal,
                    side: n.side,
                    fromDecode: true,
                },
            };
        }
    }
    if (!data.assembly.country && neovin.madeIn)
        out = { ...out, assembly: { ...out.assembly, country: neovin.madeIn } };
    return out;
}
export function withCatalogEpaGuard(data: FactoryStickerRenderData): FactoryStickerRenderData {
    return data.neovin?.epaConflict && data.epa ? { ...data, epa: null } : data;
}

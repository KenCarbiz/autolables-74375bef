// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/catalogNeovin.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// NeoVIN decode facts for the catalog templates only, applied like
// withCatalogEquipment: the approved masters never see this path. NHTSA star
// ratings are read from the decoder's own rating rows, and the country of
// final assembly from the decode's made-in value. Nothing is invented: a
// category the decode lacks stays absent and prints Not Available.

import type { FactoryStickerRenderData } from "./contract.ts";

const NHTSA_STANDARD = /^standard[\s-]+nhtsa$/i;
const RATING_ROW = /^(overall(?:\s+rating)?|frontal\s+crash(?:\s+rating)?|front\s+crash(?:\s+rating)?|side\s+impact(?:\s+rating)?|side\s+crash(?:\s+rating)?|rollover(?:\s+rating)?|rollover\s+resistance)\s*[-:]\s*([0-5])(?:\s*stars?)?$/i;

type Category = "overall" | "frontal" | "side" | "rollover";

const categoryOf = (label: string): Category => {
  const l = label.toLowerCase();
  if (l.startsWith("overall")) return "overall";
  if (l.startsWith("front")) return "frontal";
  if (l.startsWith("side")) return "side";
  return "rollover";
};

export interface DecodedNhtsa {
  overall: number | null;
  frontal: number | null;
  side: number | null;
  rollover: number | null;
}

/** Stars from the decoder's NHTSA rows; null unless the NHTSA standard row is present. IIHS rows never feed stars. */
export function nhtsaFromRatingMetadata(rows: readonly string[]): DecodedNhtsa | null {
  const trimmed = rows.map((r) => String(r ?? "").trim());
  if (!trimmed.some((r) => NHTSA_STANDARD.test(r))) return null;
  const found: Partial<Record<Category, Set<number>>> = {};
  for (const row of trimmed) {
    const m = RATING_ROW.exec(row);
    if (!m) continue;
    const cat = categoryOf(m[1]);
    (found[cat] ??= new Set()).add(Number(m[2]));
  }
  const pick = (c: Category): number | null => {
    const set = found[c];
    if (!set || set.size !== 1) return null;
    const n = [...set][0];
    return n >= 1 ? n : null;
  };
  return { overall: pick("overall"), frontal: pick("frontal"), side: pick("side"), rollover: pick("rollover") };
}

export function withCatalogNeovin(data: FactoryStickerRenderData): FactoryStickerRenderData {
  const neovin = data.neovin;
  if (!neovin) return data;
  let out = data;
  if (!data.safety && !data.nhtsaNotRated) {
    const n = nhtsaFromRatingMetadata(neovin.ratingMetadata);
    if (n && (n.overall || n.frontal || n.side || n.rollover)) {
      out = {
        ...out,
        safety: {
          overall: n.overall, frontalDriver: null, frontalPassenger: null, sideFront: null, sideRear: null,
          rollover: n.rollover, frontal: n.frontal, side: n.side, fromDecode: true,
        },
      };
    }
  }
  if (!data.assembly.country && neovin.madeIn) out = { ...out, assembly: { ...out.assembly, country: neovin.madeIn } };
  return out;
}

type FuelFamily = "gas" | "diesel" | "ev" | "electrified";

function fuelFamily(...texts: Array<string | null | undefined>): FuelFamily | null {
  const t = texts.map((x) => String(x ?? "")).join(" ").toLowerCase();
  if (!t.trim()) return null;
  const electric = /electric|\bev\b|\bbev\b/.test(t);
  const diesel = /diesel/.test(t);
  const gas = /gas|flex|e85|petrol|premium|regular|unleaded/.test(t);
  if (/phev|plug|hybrid/.test(t) || (electric && (gas || diesel))) return "electrified";
  if (electric) return "ev";
  if (diesel) return "diesel";
  return gas ? "gas" : null;
}

/** True when the saved EPA match names a fuel class the decode's own fuel and powertrain contradict. */
export function epaFuelClassConflict(epaFuelType: string | null | undefined, decodeFuelType: string | null | undefined, decodePowertrain?: string | null): boolean {
  const epa = fuelFamily(epaFuelType);
  const decode = fuelFamily(decodeFuelType, decodePowertrain);
  return epa !== null && decode !== null && epa !== decode;
}

/** An EPA match that contradicts the decode is unverified for the catalog templates: no EPA value or fuel-type tag is printed. */
export function withCatalogEpaGuard(data: FactoryStickerRenderData): FactoryStickerRenderData {
  return data.neovin?.epaFuelConflict && data.epa ? { ...data, epa: null } : data;
}

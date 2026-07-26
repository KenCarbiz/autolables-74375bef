// Thin server-side adapter: SAVED listing data → FactoryStickerRenderData.
// The full normalization library lives client-side (src/lib/factorySticker)
// where it is unit-tested; this adapter only reshapes what is already stored
// on vehicle_listings (mc_attributes.build_sheet, epa_economy) and
// dealer_profiles.settings. It performs NO provider calls and invents no
// facts: missing fields stay null and lower the confidence grade.

import type { FactoryStickerRenderData } from "../_shared/factorySticker/render.ts";

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

export interface NormalizeResult {
  data: FactoryStickerRenderData;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  missing: string[];
  /** From build_sheet.pricing when present (sticker-grade fields). */
  baseMsrp: number | null;
  destinationCharge: number | null;
  optionsTotal: number | null;
  statedTotalMsrp: number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s || null;
};

const catMap = (obj: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const names = (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean);
      if (names.length) out[k] = names;
    }
  }
  return out;
};

export function normalizeForSticker(
  listing: AnyRow,
  dealerSettings: Record<string, unknown>,
  passportUrl: string,
  title: string,
): NormalizeResult {
  const mc = (listing.mc_attributes || {}) as AnyRow;
  const sheet = (mc.build_sheet || null) as AnyRow | null;
  const pricing = (sheet?.pricing || {}) as AnyRow;
  const missing: string[] = [];

  const condRaw = String(listing.condition || "used").toLowerCase();
  const condition: "new" | "used" | "cpo" =
    condRaw === "new" ? "new" : (condRaw === "cpo" || condRaw === "certified") ? "cpo" : "used";

  const ymmParts = String(listing.ymm || "").trim().split(/\s+/);
  const identity = {
    year: ymmParts[0] || "",
    make: ymmParts[1] || "",
    model: ymmParts.slice(2).join(" ") || "",
    trim: str(listing.trim),
  };
  if (!identity.year || !identity.make || !identity.model) missing.push("identity");

  const packages = (Array.isArray(sheet?.packages) ? sheet!.packages : []).map((p: AnyRow) => ({
    name: String(p?.name ?? ""),
    code: str(p?.code),
    msrp: num(p?.msrp),
    contents: (Array.isArray(p?.contents) ? p.contents : []).map((c: unknown) => String(c ?? "")).filter(Boolean),
  })).filter((p: { name: string }) => p.name);

  const options = (Array.isArray(sheet?.options) ? sheet!.options : []).map((o: AnyRow) => ({
    name: String(o?.name ?? ""),
    code: str(o?.code),
    msrp: num(o?.msrp),
  })).filter((o: { name: string }) => o.name);

  if (!sheet) missing.push("build_sheet");

  const baseMsrp = num(pricing.base_msrp);
  const destinationCharge = num(pricing.destination_charge);
  const statedTotalMsrp = num(pricing.total_msrp) ?? num(mc.msrp);
  const itemMsrps = [...packages, ...options].map((x) => x.msrp).filter((n): n is number => n != null);
  const optionsTotal = itemMsrps.length ? itemMsrps.reduce((a, b) => a + b, 0) : null;
  if (!baseMsrp) missing.push("base_msrp");
  if (!destinationCharge) missing.push("destination_charge");

  const colorOf = (c: unknown) => {
    if (typeof c === "string") return { name: str(c), code: null };
    const o = (c || {}) as AnyRow;
    return { name: str(o.name), code: str(o.code) };
  };
  const colors = {
    exterior: colorOf(sheet?.colors?.exterior ?? mc.exterior_color),
    interior: colorOf(sheet?.colors?.interior ?? mc.interior_color),
  };

  const assembly = {
    plant: str(sheet?.assembly?.plant),
    city: str(sheet?.assembly?.city),
    country: str(sheet?.assembly?.country),
  };

  const epaRow = (listing.epa_economy || null) as AnyRow | null;
  const epaCombined = epaRow && !epaRow.error ? num(epaRow.combined) : null;
  const epa = epaRow && !epaRow.error ? {
    city: num(epaRow.city),
    highway: num(epaRow.highway),
    combined: epaCombined,
    annualFuelCost: num(epaRow.annualFuelCost),
    ghgScore: num(epaRow.ghgScore),
    rangeMiles: num(epaRow.rangeMiles),
    fuelType: str(epaRow.fuelType),
    gallonsPer100Miles: epaCombined ? Math.round((100 / epaCombined) * 10) / 10 : null,
  } : null;
  if (!epa) missing.push("epa_economy");

  const mechanical = {
    engine: str(mc.engine) ?? str(sheet?.mechanical?.engine),
    transmission: str(mc.transmission) ?? str(sheet?.mechanical?.transmission),
    drivetrain: str(mc.drivetrain) ?? str(sheet?.mechanical?.drivetrain),
  };
  const stockNumber = str(mc.stock_no);

  const s = dealerSettings as Record<string, unknown>;
  const dealer = {
    name: str(s.dealer_name),
    address: str(s.dealer_address),
    city: str(s.dealer_city),
    state: str(s.dealer_state),
    zip: str(s.dealer_zip),
    phone: str(s.dealer_phone),
  };

  const generic = Boolean(sheet?.generic);
  const disclaimers: string[] = [];
  if (condition !== "new") {
    disclaimers.push(
      "Reconstructed factory build record for reference. Not the original manufacturer window sticker.",
    );
  }
  if (generic) {
    disclaimers.push("Equipment shown is typical for this trim; VIN-specific decode was not available.");
  }

  const confidence: NormalizeResult["confidence"] =
    !sheet || generic ? "LOW" : baseMsrp ? "HIGH" : "MEDIUM";

  return {
    data: {
      vin: String(listing.vin || "").toUpperCase(),
      condition,
      title,
      identity,
      pricing: {
        baseMsrp,
        destinationCharge,
        optionsTotal,
        totalMsrp: statedTotalMsrp,
      },
      packages,
      options,
      standardEquipment: catMap(sheet?.standard),
      keyFeatures: catMap(sheet?.key_features),
      colors,
      assembly,
      mechanical,
      stockNumber,
      epa,
      dealer,
      passportUrl,
      barcodePayload: String(listing.vin || "").toUpperCase(),
      generic,
      disclaimers,
    },
    confidence,
    missing,
    baseMsrp,
    destinationCharge,
    optionsTotal,
    statedTotalMsrp,
  };
}

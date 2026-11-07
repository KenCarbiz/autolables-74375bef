// Thin server-side adapter: SAVED listing data → FactoryStickerRenderData.
// The full normalization library lives client-side (src/lib/factorySticker)
// where it is unit-tested; this adapter only reshapes what is already stored
// on vehicle_listings (mc_attributes.build_sheet, epa_economy) and
// dealer_profiles.settings. It performs NO provider calls and invents no
// facts: missing fields stay null and lower the confidence grade.
import { parseYmm } from "../_shared/factorySticker/lib/ymm.ts";
import { decideDrivetrain, isRatingMetadata, splitRatingMetadata, type DrivetrainEvidence } from "../_shared/factorySticker/lib/oem/sourceCorrections.ts";

import { driveOf, listingPowertrain, litersOf, storedEpaConflict } from "../_shared/epaMatch.ts";
import { hasBuiltCatalogTemplates } from "../_shared/factorySticker/lib/oem/templateCatalog.ts";
import type { FactoryStickerRenderData } from "../_shared/factorySticker/lib/render/contract.ts";

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

export interface NormalizeResult {
  data: FactoryStickerRenderData;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  missing: string[];
  /** Options and packages the decode marks verified=false: available for the model, not proven on this VIN. Never printed as installed. */
  unverifiedOptions: string[];
  /** From build_sheet.pricing when present (sticker-grade fields). */
  baseMsrp: number | null;
  destinationCharge: number | null;
  optionsTotal: number | null;
  statedTotalMsrp: number | null;
  /** Source values replaced under a recorded manufacturer rule, and decoder
   *  metadata removed from the equipment list. Persisted for audit. */
  sourceCorrections: {
    drivetrain: { source: string | null; printed: string | null; ruleId: string; evidence: DrivetrainEvidence } | null;
    ratingMetadataRemoved: string[];
  };
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

  // vehicle_listings has no make/model columns — identity comes out of the
  // free-text ymm. parseYmm knows the multi-word brands; a positional split
  // turned "Land Rover Defender" into make "Land" and lost the template.
  const parsed = parseYmm(listing.ymm as string | null | undefined);
  const identity = {
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    trim: str(listing.trim),
  };
  if (!identity.year || !identity.make || !identity.model) missing.push("identity");

  // NeoVIN marks an option verified=false when it is only available for the
  // model; printing it under installed options would misstate the build.
  const unverifiedOptions: string[] = [];
  const installed = (x: AnyRow): boolean => {
    if (x?.verified !== false && x?.verified !== "false") return true;
    const name = String(x?.name ?? "").trim();
    if (name) unverifiedOptions.push(name);
    return false;
  };
  const packages = (Array.isArray(sheet?.packages) ? sheet!.packages : []).filter(installed).map((p: AnyRow) => ({
    name: String(p?.name ?? ""),
    code: str(p?.code),
    msrp: num(p?.msrp),
    contents: (Array.isArray(p?.contents) ? p.contents : []).map((c: unknown) => String(c ?? "")).filter(Boolean),
  })).filter((p: { name: string }) => p.name);

  const options = (Array.isArray(sheet?.options) ? sheet!.options : []).filter(installed).map((o: AnyRow) => ({
    name: String(o?.name ?? ""),
    code: str(o?.code),
    msrp: num(o?.msrp),
  })).filter((o: { name: string }) => o.name);

  if (!sheet) missing.push("build_sheet");
  if (unverifiedOptions.length) missing.push("option_install_unverified");

  // marketcheck-specs lifts base MSRP to the top level precisely so every
  // consumer can read it there, and DECODE_OWNED_KEYS preserves that copy
  // independently of build_sheet. Reading only the nested value threw away
  // an MSRP we already held.
  const baseMsrp = num(pricing.base_msrp) ?? num(mc.base_msrp);
  const destinationCharge = num(pricing.destination_charge);
  // Deliberately NOT falling back to `mc.msrp`. That field is the feed's
  // current asking/market figure, not a manufacturer price: on the real 2019
  // Q50 (JN1FV7AR5KM800521) it reads 27,887 while the vehicle's actual base
  // MSRP was 53,350. Printing it as TOTAL MSRP puts a fabricated
  // manufacturer price on a compliance document. Both sibling normalizers
  // (vehicleTruth/ingest.ts, normalizeNeovin.ts) already refuse it; this is
  // the path that actually renders the PDF, so it has to refuse it too.
  const statedTotalMsrp = num(pricing.total_msrp);
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
    co2TailpipeGpm: num(epaRow.co2TailpipeGpm),
    // Plug-in and electric figures only when the saved row carries them; read for catalog makes only.
    ...(hasBuiltCatalogTemplates(identity.make)
      ? Object.fromEntries(
        (["combinedMpge", "kwhPer100Miles", "chargeTimeHours", "electricRangeMiles", "totalRangeMiles", "smogScore", "fiveYearCostDifference"] as const)
          .flatMap((k) => (num(epaRow[k]) !== null ? [[k, num(epaRow[k])]] : [])),
      ) as { combinedMpge?: number; kwhPer100Miles?: number; chargeTimeHours?: number; electricRangeMiles?: number; totalRangeMiles?: number; smogScore?: number; fiveYearCostDifference?: number }
      : {}),
  } : null;
  if (!epa) missing.push("epa_economy");
  // The shared matcher's verdict on the saved EPA row against this car's own decode (catalog makes only).
  const epaConflict = epa && hasBuiltCatalogTemplates(identity.make)
    ? storedEpaConflict(epaRow, {
      powertrain: listingPowertrain({ powertrainType: mc.powertrain_type, fuelType: mc.fuel_type, trim: listing.trim, model: identity.model }),
      drive: driveOf(str(mc.drivetrain) ?? str(sheet?.mechanical?.drivetrain)),
      liters: litersOf(str(mc.engine) ?? str(sheet?.mechanical?.engine)),
      text: `${identity.model ?? ""} ${listing.trim ?? ""}`,
    })
    : null;

  const drive = decideDrivetrain({ ...identity, source: str(mc.drivetrain) ?? str(sheet?.mechanical?.drivetrain) });
  const mechanical = {
    engine: str(mc.engine) ?? str(sheet?.mechanical?.engine),
    transmission: str(mc.transmission) ?? str(sheet?.mechanical?.transmission),
    drivetrain: drive.value,
  };
  const standard = splitRatingMetadata(catMap(sheet?.standard));
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
  // The reproduction banner and disclosure are painted by the renderer on
  // every page for every condition; only situational notes belong here.
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
      standardEquipment: standard.equipment,
      keyFeatures: catMap(sheet?.key_features),
      colors,
      assembly,
      mechanical,
      stockNumber,
      bodyClass: str(mc.body_type),
      epa,
      dealer,
      passportUrl,
      barcodePayload: String(listing.vin || "").toUpperCase(),
      generic,
      disclaimers,
      // Only makes with catalog templates carry the decode facts; every other
      // make's data (and fingerprint) is unchanged.
      ...(hasBuiltCatalogTemplates(identity.make)
        ? {
            neovin: {
              ratingMetadata: [
                ...standard.ratingMetadata,
                ...Object.values(catMap(sheet?.key_features)).flat().filter(isRatingMetadata),
              ],
              madeIn: str(mc.made_in),
              ...(/diesel/i.test(String(mc.fuel_type ?? "")) ? { fuelType: String(mc.fuel_type) } : {}),
              ...(epaConflict ? { epaConflict } : {}),
              ...(/^(HEV|FHEV)$/i.test(String(mc.powertrain_type ?? "").trim()) ? { hybridDecode: true as const } : {}),
            },
          }
        : {}),
    },
    confidence,
    missing,
    unverifiedOptions,
    baseMsrp,
    destinationCharge,
    optionsTotal,
    statedTotalMsrp,
    sourceCorrections: {
      drivetrain: drive.ruleId && drive.evidence ? { source: drive.sourceValue, printed: drive.value, ruleId: drive.ruleId, evidence: drive.evidence } : null,
      ratingMetadataRemoved: standard.ratingMetadata,
    },
  };
}

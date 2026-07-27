// The renderer side of the orchestrator contract. Declares the frozen
// FactoryStickerRenderData/Theme/Result shapes (mirrored by
// supabase/functions/_shared/factorySticker/render.ts, which re-exports
// them), adapts render data into the FactoryStickerData layout model, and
// runs the shared render pipeline with whichever pdf-lib binding the
// runtime provides (npm in vitest/browser, esm.sh in Deno).

import type {
  ConfidenceLevel,
  EquipmentCategory,
  FactoryStickerData,
  ReconciliationStatus,
  StandardEquipmentGroup,
  StickerOption,
  StickerPackage,
  VehicleCondition,
} from "../types.ts";
import { resolveOem } from "../oem/identity.ts";
import { getTheme, type OemStickerTheme } from "../oem/themes.ts";
import { resolveThemeProfile, type ResolvedThemeProfile } from "../oem/profiles.ts";
import { buildStickerLayout, type LayoutModel, type StickerLayoutInput } from "./layout.ts";
import { realizePdf, type PdfLibModule } from "./toPdf.ts";
import { layoutToSvg } from "./previewSvg.ts";

export const RENDERER_VERSION = "1.0.0";

export interface FactoryStickerTheme {
  oemThemeId: string;
  oemThemeVersion: string;
  canonicalOemId: string | null;
  templateFamilyId: string;
  templateVersion: string;
  logoAssetId: string | null;
  logoAssetVersion: string | null;
}

export interface FactoryStickerRenderData {
  vin: string;
  condition: "new" | "used" | "cpo";
  title: string;
  identity: { year: string; make: string; model: string; trim: string | null };
  pricing: {
    baseMsrp: number | null;
    destinationCharge: number | null;
    optionsTotal: number | null;
    totalMsrp: number | null;
  };
  packages: Array<{ name: string; code: string | null; msrp: number | null; contents: string[] }>;
  options: Array<{ name: string; code: string | null; msrp: number | null; contents?: string[] }>;
  standardEquipment: Record<string, string[]>;
  keyFeatures: Record<string, string[]>;
  colors: {
    exterior: { name: string | null; code: string | null };
    interior: { name: string | null; code: string | null };
  };
  assembly: { plant: string | null; city: string | null; country: string | null };
  /** Powertrain identity for the spec grid; optional for older payloads. */
  mechanical?: { engine: string | null; transmission: string | null; drivetrain: string | null };
  stockNumber?: string | null;
  transportMethod?: string | null;
  /** Factory administrative codes for the Monroney top strip. */
  factoryCodes?: {
    location?: string | null;
    emissions?: string | null;
    sequence?: string | null;
    order?: string | null;
    dealer?: string | null;
  };
  epa: {
    city: number | null;
    highway: number | null;
    combined: number | null;
    annualFuelCost: number | null;
    ghgScore: number | null;
    rangeMiles: number | null;
    fuelType: string | null;
    smogScore?: number | null;
    gasCombinedMpg?: number | null;
    gallonsPer100Miles?: number | null;
    /** Positive = saves vs average new vehicle over 5 years; negative = spends more. */
    fiveYearCostDifference?: number | null;
    classNote?: string | null;
  } | null;
  /** NHTSA star ratings; null field = Not Rated. Omit the block entirely when unverified. */
  safety?: {
    overall: number | null;
    frontalDriver: number | null;
    frontalPassenger: number | null;
    sideFront: number | null;
    sideRear: number | null;
    rollover: number | null;
  } | null;
  dealer: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  };
  /** QR payload — MUST equal the canonical passport URL. */
  passportUrl: string;
  /** Barcode payload — MUST equal the VIN. */
  barcodePayload: string;
  /** Generic (typical-for-trim) decode: the sticker must label, never assert. */
  generic: boolean;
  disclaimers: string[];
}

export interface FactoryStickerRenderResult {
  pdfBytes: Uint8Array;
  previewSvg: string;
  layout: { pages: number; drawnStrings: string[] };
}

const categoryForHint = (hint: string): EquipmentCategory => {
  const key = hint.toLowerCase();
  if (/safety|airbag|security|adas|assist|driver/.test(key)) return "SAFETY_SECURITY";
  if (/tech|infotainment|audio|connect|entertainment/.test(key)) return "TECHNOLOGY";
  if (/interior|seat/.test(key)) return "INTERIOR";
  if (/exterior|wheel|body/.test(key)) return "EXTERIOR";
  if (/mechanical|engine|powertrain|drivetrain|chassis|suspension/.test(key)) return "POWERTRAIN";
  if (/comfort|convenience|climate/.test(key)) return "COMFORT_CONVENIENCE";
  if (/functional|cargo|towing/.test(key)) return "FUNCTIONAL";
  return "OTHER";
};

const CATEGORY_SEQUENCE: EquipmentCategory[] = [
  "EXTERIOR",
  "INTERIOR",
  "COMFORT_CONVENIENCE",
  "FUNCTIONAL",
  "POWERTRAIN",
  "SAFETY_SECURITY",
  "TECHNOLOGY",
  "OTHER",
];

function groupStandardEquipment(
  sources: Array<Record<string, string[]>>,
): StandardEquipmentGroup[] {
  const byCategory = new Map<EquipmentCategory, string[]>();
  const seen = new Set<string>();
  for (const source of sources) {
    for (const [hint, items] of Object.entries(source)) {
      const category = categoryForHint(hint);
      for (const raw of items) {
        const item = raw.trim();
        if (!item) continue;
        const key = item.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = byCategory.get(category);
        if (bucket) bucket.push(item);
        else byCategory.set(category, [item]);
      }
    }
  }
  return CATEGORY_SEQUENCE
    .filter((category) => byCategory.has(category))
    .map((category) => ({ category, items: byCategory.get(category)! }));
}

const mapCondition = (c: FactoryStickerRenderData["condition"]): VehicleCondition =>
  c === "new" ? "NEW" : c === "cpo" ? "CPO" : "USED";

function reconcile(pricing: FactoryStickerRenderData["pricing"]): {
  calculated: number | undefined;
  status: ReconciliationStatus;
} {
  if (pricing.baseMsrp === null) return { calculated: undefined, status: "INSUFFICIENT_DATA" };
  const calculated = pricing.baseMsrp + (pricing.optionsTotal ?? 0) + (pricing.destinationCharge ?? 0);
  if (pricing.totalMsrp === null) return { calculated, status: "INSUFFICIENT_DATA" };
  const diff = Math.abs(calculated - pricing.totalMsrp);
  const status: ReconciliationStatus =
    diff <= 5 ? "MATCHED" : diff <= 100 ? "MINOR_VARIATION" : "REVIEW_REQUIRED";
  return { calculated, status };
}

export function adaptRenderData(d: FactoryStickerRenderData): StickerLayoutInput {
  const year = Number(d.identity.year);
  const confidence: ConfidenceLevel = d.generic ? "LOW" : d.pricing.baseMsrp !== null ? "HIGH" : "MEDIUM";
  const { calculated, status } = reconcile(d.pricing);

  const packages: StickerPackage[] = d.packages.map((p) => ({
    ...(p.code !== null ? { code: p.code } : {}),
    name: p.name,
    ...(p.msrp !== null ? { price: p.msrp } : {}),
    priceStatus: p.msrp !== null ? "PRICED" : "INCLUDED",
    features: p.contents,
  }));
  const options: StickerOption[] = d.options.map((o) => ({
    ...(o.code !== null ? { code: o.code } : {}),
    name: o.name,
    ...(o.msrp !== null ? { price: o.msrp } : {}),
    priceStatus: o.msrp !== null ? "PRICED" : "UNAVAILABLE",
    ...(o.contents && o.contents.length ? { features: o.contents } : {}),
  }));

  const opt = <T>(key: string, value: T | null | undefined): Record<string, T> =>
    value === null || value === undefined ? ({} as Record<string, T>) : ({ [key]: value } as Record<string, T>);

  const data: FactoryStickerData = {
    vehicle: {
      vin: d.vin,
      year: Number.isFinite(year) ? year : 0,
      make: d.identity.make,
      model: d.identity.model,
      ...opt("trim", d.identity.trim),
      condition: mapCondition(d.condition),
      ...opt("exteriorColor", d.colors.exterior.name),
      ...opt("exteriorColorCode", d.colors.exterior.code),
      ...opt("interiorColor", d.colors.interior.name),
      ...opt("interiorColorCode", d.colors.interior.code),
      ...opt("fuelType", d.epa?.fuelType ?? null),
      ...opt("engine", d.mechanical?.engine ?? null),
      ...opt("transmission", d.mechanical?.transmission ?? null),
      ...opt("drivetrain", d.mechanical?.drivetrain ?? null),
      ...opt("stockNumber", d.stockNumber ?? null),
    },
    equipment: {
      standard: groupStandardEquipment([d.standardEquipment, d.keyFeatures]),
      packages,
      options,
    },
    pricing: {
      currency: "USD",
      ...opt("baseMsrp", d.pricing.baseMsrp),
      ...opt("factoryInstalledTotal", d.pricing.optionsTotal),
      ...opt("destinationCharge", d.pricing.destinationCharge),
      ...opt("calculatedTotalMsrp", calculated),
      ...opt("sourceReportedTotalMsrp", d.pricing.totalMsrp),
      reconciliationStatus: status,
    },
    regulatory: {
      ...(d.epa
        ? {
            epaStatus: "VERIFIED" as const,
            ...opt("cityMpg", d.epa.city),
            ...opt("highwayMpg", d.epa.highway),
            ...opt("combinedMpg", d.epa.combined),
            ...opt("annualFuelCost", d.epa.annualFuelCost),
            ...opt("greenhouseGasRating", d.epa.ghgScore),
            ...opt("smogRating", d.epa.smogScore ?? null),
            ...opt("evRangeMiles", d.epa.rangeMiles),
            ...opt("gasolineCombinedMpg", d.epa.gasCombinedMpg ?? null),
            ...opt("gallonsPer100Miles", d.epa.gallonsPer100Miles ?? null),
            ...opt("fiveYearCostDifference", d.epa.fiveYearCostDifference ?? null),
            ...opt("epaClassNote", d.epa.classNote ?? null),
          }
        : { epaStatus: "UNAVAILABLE" as const }),
      ...(d.safety
        ? {
            nhtsaStatus: "VERIFIED" as const,
            ...opt("overallRating", d.safety.overall),
            ...opt("frontalDriverRating", d.safety.frontalDriver),
            ...opt("frontalPassengerRating", d.safety.frontalPassenger),
            ...opt("sideFrontRating", d.safety.sideFront),
            ...opt("sideRearRating", d.safety.sideRear),
            ...opt("rolloverRating", d.safety.rollover),
          }
        : { nhtsaStatus: "UNAVAILABLE" as const }),
    },
    factory: {
      ...opt("assemblyPlant", d.assembly.plant),
      ...opt("assemblyCountry", d.assembly.country),
      ...opt(
        "finalAssemblyPoint",
        d.assembly.city || d.assembly.country
          ? [d.assembly.city, d.assembly.country].filter(Boolean).join(", ")
          : null,
      ),
      ...opt("orderNumber", d.factoryCodes?.order ?? null),
      ...opt("sequenceNumber", d.factoryCodes?.sequence ?? null),
      ...opt("dealerCode", d.factoryCodes?.dealer ?? null),
      ...opt("emissionsCode", d.factoryCodes?.emissions ?? null),
      ...opt("locationCode", d.factoryCodes?.location ?? null),
      ...opt("transportMethod", d.transportMethod ?? null),
    },
    dealer: {
      tenantId: "",
      name: d.dealer.name ?? "",
      ...opt("address", d.dealer.address),
      ...opt("city", d.dealer.city),
      ...opt("state", d.dealer.state),
      ...opt("postalCode", d.dealer.zip),
      ...opt("phone", d.dealer.phone),
    },
    document: {
      vehicleId: "",
      documentId: "",
      sourceProvider: "NEOVIN",
      sourceClassification: d.generic ? "CONFIGURATION_MATCH" : "OEM_BUILD_DATA",
      confidence,
      verificationStatus: confidence === "HIGH" ? "AUTO_VERIFIED" : "REVIEW_REQUIRED",
      generatedAt: "1970-01-01T00:00:00.000Z",
      passportUrl: d.passportUrl,
      templateVersion: "1.0.0",
      rendererVersion: RENDERER_VERSION,
      dataVersion: "render-contract",
    },
  };

  return {
    data,
    title: d.title,
    disclaimers: d.disclaimers,
    barcodePayload: d.barcodePayload,
    generic: d.generic,
  };
}

export function resolveRenderTheme(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
): OemStickerTheme {
  const resolved = resolveOem(data.identity.make);
  if (resolved.confidence !== "UNRESOLVED") return getTheme(resolved.identity.id);
  if (theme.canonicalOemId) {
    return getTheme(theme.canonicalOemId.toUpperCase().replace(/-/g, "_"));
  }
  return getTheme("AUTOLABELS_FALLBACK");
}

/**
 * Model-year-aware profile resolution for the orchestrator: make + model
 * year select a versioned OEM theme profile, so regenerating an older
 * document never silently adopts a future brand identity.
 */
export function resolveRenderProfile(data: FactoryStickerRenderData): ResolvedThemeProfile {
  const year = Number(data.identity.year);
  return resolveThemeProfile(data.identity.make, Number.isFinite(year) ? year : null);
}

export function buildRenderLayout(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
): LayoutModel {
  return buildStickerLayout(adaptRenderData(data), resolveRenderTheme(data, theme));
}

export async function runRenderPipeline(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
  pdfLib: PdfLibModule,
): Promise<FactoryStickerRenderResult> {
  const model = buildRenderLayout(data, theme);
  const pdfBytes = await realizePdf(model, pdfLib);
  const previewSvg = layoutToSvg(model);
  return {
    pdfBytes,
    previewSvg,
    layout: { pages: model.pages.length, drawnStrings: model.drawnStrings },
  };
}

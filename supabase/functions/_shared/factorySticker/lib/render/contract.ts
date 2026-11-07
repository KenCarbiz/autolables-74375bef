// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/contract.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
import { classifyStandardItem } from "../equipment.ts";
import {
  SELECTED_EQUIPMENT_NOTE, normalizeEquipment, selectEquipment,
  type ClassifiedItem, type EquipmentLine, type EquipmentSelectionBase,
} from "../equipmentSelection.ts";
import { resolveReferenceVariant } from "../oem/referenceVariants.ts";
import { withCatalogEquipment } from "./catalogEquipment.ts";
import { withCatalogEpaGuard, withCatalogNeovin } from "./catalogNeovin.ts";
import { CATALOG_LAYOUTS, VARIANT_LAYOUTS, type VariantLayoutBuilder, type VariantRenderInput } from "./variants/index.ts";
import {
  getCatalogTemplate, resolveCatalogTemplate, type CatalogResolution, type CatalogTemplate,
} from "../oem/templateCatalog.ts";
import { getTheme, type OemStickerTheme } from "../oem/themes.ts";
import { resolveThemeProfile, type ResolvedThemeProfile } from "../oem/profiles.ts";
import {
  buildStickerLayout,
  type EquipmentScope, type LayoutFit, type LayoutModel, type StickerLayoutInput,
} from "./layout.ts";
import type { FactoryBuildProvenance } from "../reproduction.ts";
import { realizePdf, type PdfLibModule } from "./toPdf.ts";
import { layoutToSvg } from "./previewSvg.ts";

// 1.5.0: the Letter masters print the Passport QR at 0.90in (quiet zone included)
// in the pricing column, and the payload is the canonical autolabels.io URL.
// 1.4.0: standard equipment prints in full when it fits, else as normalized, ranked
// selected lines with a Passport pointer; applies to every template.
// 1.3.0: an approved make-wide master is always used for its make; content it
// cannot hold under the equipment scope policy is review-required, never generic.
// 1.2.0: exactly one physical page for every OEM layout. No continuation
// pages; content that cannot fit at the validated minimum sizes is a
// review-required fit failure with no PDF. Reproduction banner + disclosure
// (reproduction.ts DISCLOSURE_VERSION) are unchanged. Part of the generation
// fingerprint, so existing documents regenerate as new versions.
export const RENDERER_VERSION = "1.5.0";

/**
 * Make-wide master routing. Every vehicle of a make with verified data
 * renders on that make's approved Figma master, not only the exact reference
 * variant, provided the owner has approved the master and its EPA panel
 * supports the vehicle's fuel class. An unsupported or unknown fuel class
 * falls back to the generic one-page layout; a hybrid or PHEV panel is never
 * printed for a gasoline car, or the reverse. The master takes title and
 * equipment from the record, never from model-specific slots. To add a make,
 * register its master in VARIANT_LAYOUTS and add one row here.
 */
export type FuelClass = "gasoline" | "hybrid" | "phev" | "ev" | "diesel";
export type MasterApproval = "approved" | "pending_owner_approval";

export interface MakeMaster {
  variantKey: string;
  fuel: readonly FuelClass[];
  makeWide: boolean;
}

/**
 * Owner approval of each Figma master. A master pending approval still
 * builds and is tested, but no vehicle is routed to it: those vehicles use
 * the generic one-page layout until the owner confirms.
 */
export const MASTER_APPROVAL: Record<string, MasterApproval> = {
  "infiniti-2026-qx60-sport-awd": "approved",
  "nissan-2026-pathfinder-platinum-4wd": "approved",
  "hyundai-2026-santa-fe-hybrid-se-awd": "approved",
  "jeep-2024-grand-cherokee-4xe-phev": "approved",
  "ford-2025-transit-250-cargo-rwd-e85-carb": "approved",
  "mitsubishi-2025-outlander-se-s-awc": "pending_owner_approval",
  "chrysler-2024-pacifica-select-phev": "pending_owner_approval",
};

export const MAKE_WIDE_MASTERS: Record<string, MakeMaster> = {
  INFINITI: { variantKey: "infiniti-2026-qx60-sport-awd", fuel: ["gasoline"], makeWide: true },
  NISSAN: { variantKey: "nissan-2026-pathfinder-platinum-4wd", fuel: ["gasoline"], makeWide: true },
  HYUNDAI: { variantKey: "hyundai-2026-santa-fe-hybrid-se-awd", fuel: ["hybrid"], makeWide: true },
  JEEP: { variantKey: "jeep-2024-grand-cherokee-4xe-phev", fuel: ["phev"], makeWide: true },
  MITSUBISHI: { variantKey: "mitsubishi-2025-outlander-se-s-awc", fuel: ["gasoline"], makeWide: true },
  CHRYSLER: { variantKey: "chrysler-2024-pacifica-select-phev", fuel: ["phev"], makeWide: true },
  FORD: { variantKey: "ford-2025-transit-250-cargo-rwd-e85-carb", fuel: ["gasoline"], makeWide: false },
};

/** Null when the record does not state a fuel type: such a vehicle is never routed to a master. */
export function fuelClassOf(...types: Array<string | null | undefined>): FuelClass | null {
  const t = types.map((x) => String(x ?? "")).join(" ").toLowerCase();
  if (!t.trim()) return null;
  if (/phev|plug/.test(t)) return "phev";
  if (/electric|\bev\b|\bbev\b/.test(t) && !/gasoline|hybrid/.test(t)) return "ev";
  if (/hybrid/.test(t)) return "hybrid";
  if (/diesel/.test(t)) return "diesel";
  if (/gas|flex|e85|petrol|premium|regular|unleaded/.test(t)) return "gasoline";
  return null;
}

export function masterFor(data: {
  identity: { make: string };
  epa?: { fuelType?: string | null } | null;
}): MakeMaster | null {
  const master = MAKE_WIDE_MASTERS[data.identity.make.trim().toUpperCase()];
  if (!master || !master.makeWide || MASTER_APPROVAL[master.variantKey] !== "approved") return null;
  const cls = fuelClassOf(data.epa?.fuelType);
  return cls && master.fuel.includes(cls) ? master : null;
}

export interface FactoryStickerTheme {
  oemThemeId: string;
  oemThemeVersion: string;
  canonicalOemId: string | null;
  templateFamilyId: string;
  templateVersion: string;
  logoAssetId: string | null;
  logoAssetVersion: string | null;
  /** Authorized manual template override; absent means automatic selection. */
  templateOverrideKey?: string | null;
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
    /** Port-installed accessory total; participates in reconciliation when present. */
    portOptionsTotal?: number | null;
    /** Federal gas-guzzler tax; only when applicable and on the source record. */
    gasGuzzlerTax?: number | null;
    /** Manufacturer-labeled import costs; only when on the source price record. */
    importCharge?: number | null;
  };
  packages: Array<{ name: string; code: string | null; msrp: number | null; contents: string[] }>;
  options: Array<{
    name: string;
    code: string | null;
    msrp: number | null;
    contents?: string[];
    /** No-cost configuration item carried at zero on the manufacturer price
     *  record — rendered INCLUDED, never as an unpriced/unknown line. */
    included?: boolean;
  }>;
  /** Port-installed accessories: separate from factory options; never dealer-installed items. */
  portOptions?: Array<{ name: string; code: string | null; msrp: number | null }>;
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
  /** Body style from the record (mc_attributes.body_type); used only to match catalog templates. */
  bodyClass?: string | null;
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
    combinedMpge?: number | null;
    kwhPer100Miles?: number | null;
    chargeTimeHours?: number | null;
    electricRangeMiles?: number | null;
    totalRangeMiles?: number | null;
    gallonsPer100Miles?: number | null;
    co2TailpipeGpm?: number | null;
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
    /** Combined category values when the source gives one frontal and one side rating. */
    frontal?: number | null;
    side?: number | null;
    /** Ratings read from NHTSA rows in the NeoVIN decode: an absent category is Not Available. */
    fromDecode?: boolean;
  } | null;
  /** Tested-but-unrated / not-applicable NHTSA state. Renders the honest
   *  not-rated panel; stars are never fabricated to fill it. */
  nhtsaNotRated?: boolean;
  /**
   * NeoVIN decode facts that only catalog templates read (see catalogNeovin.ts).
   * Set only for makes that have catalog templates, so other makes' data is unchanged.
   */
  neovin?: { ratingMetadata: string[]; madeIn: string | null; /** Present only when the decode states a diesel fuel; the catalog matcher's fuel evidence when there is no EPA match. */ fuelType?: string; /** Set only when the saved EPA match contradicts the decode: "powertrain", "drivetrain" or "engine" (storedEpaConflict). */ epaConflict?: string; /** Set only when the decode states a full hybrid powertrain (HEV); a hybrid saved under a gasoline EPA fuel name is never plain gasoline for catalog matching. */ hybridDecode?: true };
  /** Which dealer the block describes. Only a proven original selling or
   *  delivery dealer may print; the current listing rooftop never does. */
  dealerRole?: "original_delivery" | null;
  dealer: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  };
  /** Verified factory warranty summary lines; omit entirely when unverified. */
  warranty?: {
    basic: string | null;
    powertrain: string | null;
    corrosion: string | null;
    roadside: string | null;
    emissions: string | null;
  } | null;
  /** Verified AALA parts-content disclosures; omit entirely when unverified. */
  partsContent?: Array<{ label: string; value: string }> | null;
  /** QR payload — MUST equal the canonical passport URL. */
  passportUrl: string;
  /** Barcode payload — MUST equal the VIN. */
  barcodePayload: string;
  /** Generic (typical-for-trim) decode: the sticker must label, never assert. */
  generic: boolean;
  disclaimers: string[];
  /** Authenticated original factory-build evidence. Absent or unverified
   *  prints "Original factory build specifications have not been verified." */
  factoryBuild?: FactoryBuildProvenance | null;
}

export interface FactoryStickerRenderResult {
  pdfBytes: Uint8Array;
  previewSvg: string;
  layout: {
    pages: number;
    drawnStrings: string[];
    /** Actual page geometry, validated against the template registry. */
    widthPt: number;
    heightPt: number;
    /** ok:false means REVIEW_REQUIRED: pdfBytes and previewSvg are empty. */
    fit: LayoutFit;
    printedEquipment: string[];
  };
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

// Order of the OEM reference sticker: mechanical, comfort, safety and driver
// assistance, audio and infotainment, then exterior and interior.
const CATEGORY_SEQUENCE: EquipmentCategory[] = [
  "POWERTRAIN",
  "FUNCTIONAL",
  "COMFORT_CONVENIENCE",
  "SAFETY_SECURITY",
  "TECHNOLOGY",
  "EXTERIOR",
  "INTERIOR",
  "OTHER",
];

function groupStandardEquipment(
  sources: Array<Record<string, string[]>>,
): StandardEquipmentGroup[] {
  const byCategory = new Map<EquipmentCategory, string[]>();
  const seen = new Set<string>();
  for (const source of sources) {
    for (const [hint, items] of Object.entries(source)) {
      const hinted = categoryForHint(hint);
      for (const raw of items) {
        const item = raw.trim();
        if (!item) continue;
        const key = item.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const category = hinted === "OTHER" ? classifyStandardItem(item) : hinted;
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
  const calculated = pricing.baseMsrp + (pricing.optionsTotal ?? 0) +
    (pricing.portOptionsTotal ?? 0) + (pricing.destinationCharge ?? 0) +
    (pricing.gasGuzzlerTax ?? 0) + (pricing.importCharge ?? 0);
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
  const dealer = d.dealerRole === "original_delivery"
    ? d.dealer
    : { name: null, address: null, city: null, state: null, zip: null, phone: null };

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
    priceStatus: o.included ? "INCLUDED" : o.msrp !== null ? "PRICED" : "UNAVAILABLE",
    ...(o.contents && o.contents.length ? { features: o.contents } : {}),
  }));
  const portInstalled: StickerOption[] = (d.portOptions ?? []).map((o) => ({
    ...(o.code !== null ? { code: o.code } : {}),
    name: o.name,
    ...(o.msrp !== null ? { price: o.msrp } : {}),
    priceStatus: o.msrp === null ? "UNAVAILABLE" : o.msrp === 0 ? "NO_CHARGE" : "PRICED",
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
      ...opt("fuelType", d.epa?.fuelType ?? d.neovin?.fuelType ?? null),
      ...opt("engine", d.mechanical?.engine ?? null),
      ...opt("transmission", d.mechanical?.transmission ?? null),
      ...opt("drivetrain", d.mechanical?.drivetrain ?? null),
      ...opt("stockNumber", d.stockNumber ?? null),
    },
    equipment: {
      standard: groupStandardEquipment([d.standardEquipment, d.keyFeatures]),
      packages,
      options,
      ...(portInstalled.length ? { portInstalled } : {}),
    },
    pricing: {
      currency: "USD",
      ...opt("baseMsrp", d.pricing.baseMsrp),
      ...opt("factoryInstalledTotal", d.pricing.optionsTotal),
      ...opt("portOptionsTotal", d.pricing.portOptionsTotal ?? null),
      ...opt("gasGuzzlerTax", d.pricing.gasGuzzlerTax ?? null),
      ...opt("importCharge", d.pricing.importCharge ?? null),
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
            ...opt("combinedMpge", d.epa.combinedMpge ?? null),
            ...opt("kwhPer100Miles", d.epa.kwhPer100Miles ?? null),
            ...opt("chargeTimeHours", d.epa.chargeTimeHours ?? null),
            ...opt("electricRangeMiles", d.epa.electricRangeMiles ?? null),
            ...opt("totalRangeMiles", d.epa.totalRangeMiles ?? null),
            ...opt("gallonsPer100Miles", d.epa.gallonsPer100Miles ?? null),
            ...opt("co2TailpipeGpm", d.epa.co2TailpipeGpm ?? null),
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
            ...opt("frontalRating", d.safety.frontal ?? null),
            ...opt("sideRating", d.safety.side ?? null),
            ...(d.safety.fromDecode ? { nhtsaDecodeOnly: true } : {}),
          }
        : d.nhtsaNotRated
          ? { nhtsaStatus: "NOT_RATED" as const }
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
      ...(d.partsContent && d.partsContent.length
        ? { partsContent: d.partsContent.map((e) => ({ label: e.label, value: e.value, sourceVerified: true })) }
        : {}),
    },
    ...(d.warranty && [d.warranty.basic, d.warranty.powertrain, d.warranty.corrosion, d.warranty.roadside, d.warranty.emissions].some((v) => v)
      ? {
          warranty: {
            ...opt("basic", d.warranty.basic),
            ...opt("powertrain", d.warranty.powertrain),
            ...opt("corrosion", d.warranty.corrosion),
            ...opt("roadside", d.warranty.roadside),
            ...opt("emissions", d.warranty.emissions),
            sourceVerified: true,
          },
        }
      : {}),
    dealer: {
      tenantId: "",
      name: dealer.name ?? "",
      ...opt("address", dealer.address),
      ...opt("city", dealer.city),
      ...opt("state", dealer.state),
      ...opt("postalCode", dealer.zip),
      ...opt("phone", dealer.phone),
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
    factoryBuild: d.factoryBuild ?? null,
  };
}

export function resolveRenderTheme(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
): OemStickerTheme {
  // An authorized template override wins over automatic resolution. The
  // compatibility gate upstream has already refused anything but this
  // vehicle's own brand or the neutral AutoLabels template, so honouring
  // it here can never put one manufacturer's design on another's car.
  const override = String(theme.templateOverrideKey ?? "").trim().toLowerCase();
  if (override) {
    const id = override.replace(/^oem-/, "").toUpperCase().replace(/-/g, "_");
    if (id === "AUTOLABELS_FALLBACK") return getTheme("AUTOLABELS_FALLBACK");
    const overridden = resolveOem(id);
    if (overridden.confidence !== "UNRESOLVED") return getTheme(overridden.identity.id);
  }
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

/**
 * How much standard equipment a sticker may print, in order:
 * full_then_selected - every verified item when it fits, else the most
 *   significant normalized items that fit, with a fixed Passport pointer line;
 * full_only - every verified item, else REVIEW_REQUIRED.
 * Priced options and packages are never ranked away. A make with an approved
 * master that cannot hold the permitted content is REVIEW_REQUIRED, never
 * generic.
 */
export type EquipmentScopePolicy = "full_then_selected" | "full_only";
export const EQUIPMENT_SCOPE_POLICY: EquipmentScopePolicy = "full_then_selected";

/** Source-order hints the masters map to their own sections. */
export const CATEGORY_MASTER_HINT: Record<EquipmentCategory, string> = {
  EXTERIOR: "exterior",
  INTERIOR: "interior",
  COMFORT_CONVENIENCE: "comfort convenience",
  FUNCTIONAL: "functional",
  POWERTRAIN: "mechanical",
  SAFETY_SECURITY: "safety",
  TECHNOLOGY: "technology",
  OTHER: "other",
};

/** Verified standard items with their classified category, source order and key-feature flag. */
export function classifiedEquipment(data: FactoryStickerRenderData): ClassifiedItem[] {
  const keyItems = new Set(Object.values(data.keyFeatures ?? {}).flat().map((i) => i.trim().toUpperCase()));
  const out: ClassifiedItem[] = [];
  const seen = new Set<string>();
  for (const source of [data.standardEquipment, data.keyFeatures ?? {}]) {
    for (const [hint, items] of Object.entries(source)) {
      const hinted = categoryForHint(hint);
      for (const raw of items) {
        const item = raw.trim();
        if (!item || seen.has(item.toUpperCase())) continue;
        seen.add(item.toUpperCase());
        out.push({
          item, order: out.length, key: keyItems.has(item.toUpperCase()),
          category: hinted === "OTHER" ? classifyStandardItem(item) : hinted,
        });
      }
    }
  }
  return out;
}

export const equipmentBase = (data: FactoryStickerRenderData): EquipmentSelectionBase =>
  normalizeEquipment(classifiedEquipment(data));

/** The lines a sticker prints when `lineCount` lines fit, as the layout and the completeness check both derive them. */
export const selectedEquipmentLines = (data: FactoryStickerRenderData, lineCount: number): EquipmentLine[] =>
  selectEquipment(equipmentBase(data).lines, lineCount);

const CATEGORY_ORDER = CATEGORY_SEQUENCE;

function linesToGroups(lines: EquipmentLine[]): StandardEquipmentGroup[] {
  return CATEGORY_ORDER.filter((c) => lines.some((l) => l.category === c))
    .map((category) => ({ category, items: lines.filter((l) => l.category === category).map((l) => l.text) }));
}

function withLines(input: StickerLayoutInput, lines: EquipmentLine[], note: boolean): StickerLayoutInput {
  return {
    ...input,
    data: { ...input.data, equipment: { ...input.data.equipment, standard: linesToGroups(lines) } },
    ...(note ? { equipmentNote: SELECTED_EQUIPMENT_NOTE } : {}),
  };
}

const masterGroups = (groups: StandardEquipmentGroup[]): Array<{ hint: string; items: string[] }> =>
  groups.map((g) => ({ hint: CATEGORY_MASTER_HINT[g.category], items: g.items }));

export interface BuildRenderOptions {
  /**
   * Explicit sample render of one catalog template, for owner review and
   * tests. It ignores approval but never production routing: the automatic
   * path never passes it.
   */
  sampleTemplateId?: string;
}

export function buildRenderLayout(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
  policy: EquipmentScopePolicy = EQUIPMENT_SCOPE_POLICY,
  options: BuildRenderOptions = {},
): LayoutModel {
  const baseInput = adaptRenderData(data);
  const route = resolveVariantRoute(data, theme, baseInput, options.sampleTemplateId ?? null);
  const isCatalog = !!route && !!CATALOG_LAYOUTS[route.variantKey];
  if (isCatalog) data = withCatalogEpaGuard(withCatalogNeovin(withCatalogEquipment(data, route!.variantKey)));
  const input = isCatalog ? adaptRenderData(data) : baseInput;
  const genericTheme = resolveRenderTheme(data, theme);
  const base = equipmentBase(data);
  const displayMake = data.identity.make.trim().toUpperCase() === "INFINITI" ? "INFINITI" : titleCase(data.identity.make);
  const state: { hold: LayoutModel | null } = { hold: null };

  const tag = (m: LayoutModel, scope: EquipmentScope, printed: number, lines: number, master: boolean): LayoutModel =>
    (!m.fit.ok ? m : { ...m, fit: { ...m.fit, equipmentScope: scope, equipmentCounts: { printed, total: base.total, lines }, ...(master ? { figmaMaster: true } : {}) } });

  const tryTarget = (target: "variant" | "generic"): LayoutModel | null => {
    const masterRouted = target === "variant" && !!route?.masterRouted;
    const build = (selected: EquipmentLine[] | null): LayoutModel | null => {
      const printed = selected ? selected.reduce((n, l) => n + l.sources.length, 0) : base.total;
      const inp = selected ? withLines(input, selected, printed < base.total) : input;
      let m: LayoutModel | null;
      if (target === "variant") {
        const groups = selected || masterRouted ? masterGroups(inp.data.equipment.standard)
          : Object.entries(data.standardEquipment).map(([hint, items]) => ({ hint, items }));
        m = route!.build({ layout: inp, equipmentGroups: groups, displayMake, ...(inp.equipmentNote ? { equipmentNote: inp.equipmentNote } : {}) });
      } else {
        m = buildStickerLayout(inp, genericTheme);
        if (m && !m.fit.ok) {
          if (!selected) state.hold = m;
          m = null;
        }
      }
      return m && m.fit.ok ? m : null;
    };

    const full = build(null);
    if (full) return tag(full, "full", base.total, base.lines.length, masterRouted);
    if (policy === "full_only" || !base.lines.length) return null;

    const cache = new Map<number, LayoutModel | null>();
    const probe = (n: number): LayoutModel | null => {
      if (!cache.has(n)) cache.set(n, build(selectEquipment(base.lines, n)));
      return cache.get(n)!;
    };
    if (!probe(1)) return null;
    let lo = 1;
    let hi = base.lines.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (probe(mid)) lo = mid;
      else hi = mid - 1;
    }
    const lines = selectEquipment(base.lines, lo);
    const printed = lines.reduce((n, l) => n + l.sources.length, 0);
    return tag(probe(lo)!, printed < base.total ? "selected" : "full", printed, lo, masterRouted);
  };

  const viaVariant = route ? tryTarget("variant") : null;
  if (viaVariant) return viaVariant;
  if (route?.masterRouted) return masterHold(route.variantKey, policy, buildStickerLayout(input, genericTheme));
  const viaGeneric = tryTarget("generic");
  return viaGeneric ?? state.hold ?? buildStickerLayout(input, genericTheme);
}

function masterHold(variantKey: string, policy: EquipmentScopePolicy, base: LayoutModel): LayoutModel {
  return {
    ...base,
    mode: "REVIEW_REQUIRED",
    printedEquipment: [],
    fit: {
      ok: false,
      reason: "one_page_fit_failed",
      overflowPt: base.fit.ok ? 1 : base.fit.overflowPt,
      equipmentFontPt: 5.5,
      columns: 2,
      detail: `verified mandatory content (priced options and packages, pricing, regulatory blocks) does not fit the approved ${variantKey} master at 5.5pt or above under the ${policy} equipment scope; an approved one-page layout adjustment is required`,
    },
  };
}

interface VariantRoute {
  variantKey: string;
  masterRouted: boolean;
  build: VariantLayoutBuilder;
}

/**
 * Dedicated reference layout, used for an exact registry match whose layout
 * is implemented, or for the approved make-wide master of the vehicle's make
 * and fuel class, and only when no template override is in force. A
 * make-wide master is always used for its make; anything with no approved
 * master, or a fuel class the master does not support, renders on the
 * generic reproduction layout.
 */
function resolveVariantRoute(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
  input: StickerLayoutInput,
  sampleTemplateId: string | null = null,
): VariantRoute | null {
  if (sampleTemplateId) {
    const build = CATALOG_LAYOUTS[sampleTemplateId];
    const masterKey = getCatalogTemplate(sampleTemplateId)?.existingMasterKey;
    if (masterKey && build) {
      const production = resolveVariantRoute(data, theme, input);
      return { variantKey: masterKey, masterRouted: production?.variantKey === masterKey ? production.masterRouted : true, build };
    }
    return build && getCatalogTemplate(sampleTemplateId) ? { variantKey: sampleTemplateId, masterRouted: true, build } : null;
  }
  if (String(theme.templateOverrideKey ?? "").trim()) return null;
  const year = Number(data.identity.year);
  const match = resolveReferenceVariant({
    make: data.identity.make,
    modelYear: Number.isFinite(year) ? year : null,
    model: data.identity.model,
    trim: data.identity.trim,
    drivetrain: data.mechanical?.drivetrain ?? null,
    fuelType: data.epa?.fuelType ?? null,
  });
  const exact = match.status === "matched" && match.rendering === "variant_layout" && !!match.variant;
  const master = exact ? null : masterFor(data);
  if (exact && MASTER_APPROVAL[match.variant!.key] !== "approved") return null;
  if (!exact && !master && !input.generic) {
    const resolved = catalogResolutionFor(data);
    const build = resolved.template ? CATALOG_LAYOUTS[resolved.template.id] : undefined;
    return resolved.status === "approved_match" && resolved.template && build
      ? { variantKey: resolved.template.id, masterRouted: true, build } : null;
  }
  if (!exact && (!master || input.generic)) return null;
  const variantKey = exact ? match.variant!.key : master!.variantKey;
  const build = VARIANT_LAYOUTS[variantKey];
  if (!build) return null;
  return { variantKey, masterRouted: !exact, build };
}

/** The layout production routing picks for this record: a variant or catalog key, or null for the generic layout. */
export function productionLayoutKey(data: FactoryStickerRenderData, theme: FactoryStickerTheme): string | null {
  return resolveVariantRoute(data, theme, adaptRenderData(data))?.variantKey ?? null;
}

export function catalogResolutionFor(data: FactoryStickerRenderData): CatalogResolution {
  const year = Number(data.identity.year);
  return resolveCatalogTemplate({
    make: data.identity.make,
    modelYear: Number.isFinite(year) ? year : null,
    model: data.identity.model,
    trim: data.identity.trim,
    bodyClass: data.bodyClass ?? null,
    fuelClass: catalogFuelClass(data),
    drivetrain: data.mechanical?.drivetrain ?? null,
  });
}

function catalogFuelClass(data: FactoryStickerRenderData): ReturnType<typeof fuelClassOf> {
  const base = catalogFuelClassOf((data.neovin?.epaConflict ? null : data.epa?.fuelType) ?? data.neovin?.fuelType);
  return data.neovin?.hybridDecode && (base === "gasoline" || base === null) ? "hybrid" : base;
}

/** EPA names a plug-in hybrid "Gasoline and Electricity"; for catalog matching that is never plain gasoline. */
function catalogFuelClassOf(fuelType: string | null | undefined): ReturnType<typeof fuelClassOf> {
  const text = String(fuelType ?? "");
  if (/electric/i.test(text) && /gas|premium|regular|unleaded|e85|petrol|diesel/i.test(text) && !/hybrid/i.test(text)) return "phev";
  return fuelClassOf(fuelType);
}

/**
 * Recorded template-routing facts for one vehicle: which catalog template
 * (if any) matches, and the flags to persist. A vehicle already served by an
 * approved master or reference variant carries no flag: its routing is
 * unchanged and complete. Rendering never depends on the flags.
 */
export function templateRoutingFacts(data: FactoryStickerRenderData): CatalogResolution & { servedByApprovedMaster: boolean } {
  const catalog = catalogResolutionFor(data);
  const year = Number(data.identity.year);
  const exact = resolveReferenceVariant({
    make: data.identity.make, modelYear: Number.isFinite(year) ? year : null, model: data.identity.model,
    trim: data.identity.trim, drivetrain: data.mechanical?.drivetrain ?? null, fuelType: data.epa?.fuelType ?? null,
  });
  const servedByApprovedMaster = !data.generic && (
    (exact.status === "matched" && exact.rendering === "variant_layout" && !!exact.variant &&
      MASTER_APPROVAL[exact.variant.key] === "approved") || masterFor(data) !== null
  );
  if (servedByApprovedMaster) return { ...catalog, flags: [], servedByApprovedMaster };
  const conflict = data.neovin?.epaConflict && catalog.status !== "no_catalog_for_make";
  return { ...catalog, flags: conflict ? [...catalog.flags, "epa_match_conflict"] : catalog.flags, servedByApprovedMaster };
}

export type { CatalogTemplate };

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function runRenderPipeline(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
  pdfLib: PdfLibModule,
): Promise<FactoryStickerRenderResult> {
  const model = buildRenderLayout(data, theme);
  const layout = {
    pages: model.pages.length,
    drawnStrings: model.drawnStrings,
    widthPt: model.width,
    heightPt: model.height,
    fit: model.fit,
    printedEquipment: model.printedEquipment,
  };
  if (!model.fit.ok) {
    return { pdfBytes: new Uint8Array(0), previewSvg: "", layout };
  }
  const pdfBytes = await realizePdf(model, pdfLib);
  return { pdfBytes, previewSvg: layoutToSvg(model), layout };
}

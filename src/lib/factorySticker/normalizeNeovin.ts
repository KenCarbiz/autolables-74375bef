import { parseYmm } from "./ymm.ts";
import type {
  ConfidenceLevel,
  FactoryStickerData,
  SourceClassification,
  StickerWarranty,
  VehicleCondition,
  VerificationStatus,
} from "./types.ts";
import { vinNormalize } from "./validate.ts";
import { buildEquipment, type RawOptionInput, type RawPackageInput, type RawStandardItem } from "./equipment.ts";
import { derivePriceStatus, reconcileMsrp } from "./pricing.ts";

export class VinMismatchError extends Error {
  readonly listingVin: string;
  readonly payloadVin: string;
  constructor(listingVin: string, payloadVin: string) {
    super(`payload VIN ${payloadVin} does not match listing VIN ${listingVin}`);
    this.name = "VinMismatchError";
    this.listingVin = listingVin;
    this.payloadVin = payloadVin;
  }
}

export class NeovinNormalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeovinNormalizeError";
  }
}

export interface NormalizeNeovinInput {
  listing: {
    id: string;
    vin: string;
    ymm?: string | null;
    trim?: string | null;
    condition?: string | null;
    features?: unknown;
    mc_attributes?: Record<string, unknown> | null;
    warranty_info?: Record<string, unknown> | null;
  };
  dealer: {
    tenantId: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    phone?: string;
    website?: string;
    authorizedLogoUrl?: string;
  };
  document: {
    documentId: string;
    passportUrl: string;
    templateVersion: string;
    rendererVersion: string;
    dataVersion: string;
    generatedAt?: string;
  };
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

const posNum = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const numAny = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// One parser, not two. This module used to carry its own copy that knew
// five multi-word makes and no sub-brand remap, so the same ymm could
// resolve to a different make here than in the renderer.
function parseYmmStrict(ymm: string): { year: number; make: string; model: string } {
  const parsed = parseYmm(ymm);
  const year = Number(parsed.year);
  if (!Number.isInteger(year) || year < 1950 || year > 2100 || !parsed.make || !parsed.model) {
    throw new NeovinNormalizeError(`cannot parse year/make/model from ymm "${ymm}"`);
  }
  return { year, make: parsed.make, model: parsed.model };
}

const mapCondition = (raw: string | null | undefined): VehicleCondition => {
  const c = String(raw ?? "").trim().toLowerCase();
  if (c === "new") return "NEW";
  if (c === "cpo" || c === "certified" || c === "certified pre-owned") return "CPO";
  if (c === "demo" || c === "demonstrator") return "DEMO";
  return "USED";
};

const nameList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : str((x as Record<string, unknown>)?.name) ?? ""))
    .map((s) => s.trim())
    .filter(Boolean);

interface RawSheetItem {
  name?: unknown;
  msrp?: unknown;
  price?: unknown;
  contents?: unknown;
  included?: unknown;
  price_status?: unknown;
  no_charge?: unknown;
  oem_credit?: unknown;
  code?: unknown;
  description?: unknown;
}

const toPricedFields = (item: RawSheetItem) => {
  const price = numAny(item.msrp ?? item.price);
  return derivePriceStatus({
    price,
    explicitIncluded: item.included === true || String(item.price_status ?? "").toLowerCase() === "included",
    explicitNoCharge: item.no_charge === true || String(item.price_status ?? "").toLowerCase() === "no_charge",
    oemCredit: item.oem_credit === true,
  });
};

export function normalizeNeovin(input: NormalizeNeovinInput): FactoryStickerData {
  const { listing, dealer, document } = input;
  const mc = (listing.mc_attributes ?? {}) as Record<string, unknown>;

  const vin = vinNormalize(listing.vin);
  const payloadVinRaw = str(mc.vin);
  if (payloadVinRaw) {
    const payloadVin = vinNormalize(payloadVinRaw);
    if (payloadVin !== vin) throw new VinMismatchError(vin, payloadVin);
  }

  const ymm = str(listing.ymm);
  if (!ymm) throw new NeovinNormalizeError("listing.ymm is required to establish vehicle identity");
  const { year, make, model } = parseYmmStrict(ymm);

  const sheet = (mc.build_sheet && typeof mc.build_sheet === "object" ? mc.build_sheet : null) as
    | ({ packages?: unknown; options?: unknown; key_features?: unknown; standard?: unknown; generic?: unknown; source?: unknown } & Record<string, unknown>)
    | null;
  const sheetGeneric = sheet?.generic === true;
  const isNeovin = String(mc.specs_source ?? "") === "neovin" || String(sheet?.source ?? "") === "neovin";
  const hasOptionsArray = Array.isArray(mc.options);

  const packages: RawPackageInput[] = [];
  const options: RawOptionInput[] = [];
  const standard: RawStandardItem[] = [];

  if (sheet) {
    for (const raw of (Array.isArray(sheet.packages) ? sheet.packages : []) as RawSheetItem[]) {
      const name = str(raw?.name);
      if (!name) continue;
      packages.push({
        ...(str(raw?.code) !== undefined ? { code: str(raw?.code) } : {}),
        name,
        ...(str(raw?.description) !== undefined ? { description: str(raw?.description) } : {}),
        ...toPricedFields(raw),
        features: nameList(raw?.contents),
      });
    }
    for (const raw of (Array.isArray(sheet.options) ? sheet.options : []) as RawSheetItem[]) {
      const name = str(raw?.name);
      if (!name) continue;
      options.push({
        ...(str(raw?.code) !== undefined ? { code: str(raw?.code) } : {}),
        name,
        ...(str(raw?.description) !== undefined ? { description: str(raw?.description) } : {}),
        ...toPricedFields(raw),
      });
    }
    for (const src of [sheet.key_features, sheet.standard]) {
      if (src && typeof src === "object" && !Array.isArray(src)) {
        for (const [cat, items] of Object.entries(src as Record<string, unknown>)) {
          for (const name of nameList(items)) standard.push({ name, categoryHint: cat });
        }
      }
    }
  } else {
    for (const name of nameList(mc.options)) options.push({ name, priceStatus: "UNAVAILABLE" });
    for (const name of nameList(mc.features)) standard.push({ name });
  }
  if (!standard.length && !options.length && !packages.length) {
    for (const name of nameList(listing.features)) standard.push({ name });
  }

  const equipmentResult = buildEquipment({ standard, packages, options });

  const pricing = reconcileMsrp({
    baseMsrp: posNum(mc.base_msrp ?? mc.msrp),
    destinationCharge: posNum(mc.delivery_charges ?? mc.destination_charge),
    sourceReportedTotalMsrp: posNum(mc.total_msrp ?? mc.sticker_total_msrp),
    // A negative price can only have survived derivePriceStatus via an explicit
    // oem_credit flag, so re-flag it for the reconciler.
    packages: equipmentResult.packages.map((p) => ({
      name: p.name, price: p.price, priceStatus: p.priceStatus, oemCredit: (p.price ?? 0) < 0,
    })),
    options: equipmentResult.options.map((o) => ({
      name: o.name, price: o.price, priceStatus: o.priceStatus, oemCredit: (o.price ?? 0) < 0,
    })),
  });

  let sourceClassification: SourceClassification;
  let confidence: ConfidenceLevel;
  if (isNeovin && hasOptionsArray && !sheetGeneric) {
    sourceClassification = "OEM_BUILD_DATA";
    confidence = "HIGH";
  } else if (standard.length || options.length || packages.length) {
    sourceClassification = "CONFIGURATION_MATCH";
    confidence = "MEDIUM";
  } else {
    sourceClassification = "CONFIGURATION_MATCH";
    confidence = "LOW";
  }
  const verificationStatus: VerificationStatus = confidence === "HIGH" ? "AUTO_VERIFIED" : "REVIEW_REQUIRED";

  const cityMpg = posNum(mc.city_mpg);
  const highwayMpg = posNum(mc.highway_mpg);
  const combinedMpg = posNum(mc.combined_mpg);
  const hasEpa = cityMpg !== undefined || highwayMpg !== undefined || combinedMpg !== undefined;

  const w = (listing.warranty_info ?? {}) as Record<string, unknown>;
  const warrantyFields = {
    basic: str(w.basic ?? w.basic_warranty),
    powertrain: str(w.powertrain ?? w.powertrain_warranty),
    corrosion: str(w.corrosion),
    roadside: str(w.roadside ?? w.roadside_assistance),
    emissions: str(w.emissions),
  };
  const hasWarranty = Object.values(warrantyFields).some((v) => v !== undefined);
  const warranty: StickerWarranty | undefined = hasWarranty
    ? {
        ...(warrantyFields.basic !== undefined ? { basic: warrantyFields.basic } : {}),
        ...(warrantyFields.powertrain !== undefined ? { powertrain: warrantyFields.powertrain } : {}),
        ...(warrantyFields.corrosion !== undefined ? { corrosion: warrantyFields.corrosion } : {}),
        ...(warrantyFields.roadside !== undefined ? { roadside: warrantyFields.roadside } : {}),
        ...(warrantyFields.emissions !== undefined ? { emissions: warrantyFields.emissions } : {}),
        sourceVerified: w.source_verified === true || w.verified === true,
      }
    : undefined;

  const optional = <T>(key: string, value: T | undefined): Record<string, T> =>
    value === undefined ? ({} as Record<string, T>) : ({ [key]: value } as Record<string, T>);

  return {
    vehicle: {
      vin,
      year,
      make,
      model,
      ...optional("trim", str(listing.trim) ?? str(mc.trim)),
      ...optional("series", str(mc.series)),
      ...optional("bodyStyle", str(mc.body_type)),
      ...optional("stockNumber", str(mc.stock_no)),
      condition: mapCondition(listing.condition),
      ...optional("exteriorColor", str(mc.exterior_color) ?? str(mc.base_ext_color)),
      ...optional("exteriorColorCode", str(mc.ext_color_code)),
      ...optional("interiorColor", str(mc.interior_color) ?? str(mc.base_int_color)),
      ...optional("interiorColorCode", str(mc.int_color_code)),
      ...optional("engine", str(mc.engine)),
      ...optional("transmission", str(mc.transmission)),
      ...optional("drivetrain", str(mc.drivetrain)),
      ...optional("fuelType", str(mc.fuel_type)),
    },
    equipment: {
      standard: equipmentResult.standard,
      packages: equipmentResult.packages,
      options: equipmentResult.options,
    },
    pricing: {
      currency: pricing.currency,
      ...optional("baseMsrp", pricing.baseMsrp),
      ...optional("packagesTotal", pricing.packagesTotal),
      ...optional("optionsTotal", pricing.optionsTotal),
      ...optional("factoryInstalledTotal", pricing.factoryInstalledTotal),
      ...optional("destinationCharge", pricing.destinationCharge),
      ...optional("calculatedTotalMsrp", pricing.calculatedTotalMsrp),
      ...optional("sourceReportedTotalMsrp", pricing.sourceReportedTotalMsrp),
      ...optional("reconciliationDifference", pricing.reconciliationDifference),
      reconciliationStatus: pricing.reconciliationStatus,
    },
    regulatory: {
      epaStatus: hasEpa ? "VERIFIED" : "UNAVAILABLE",
      ...optional("cityMpg", cityMpg),
      ...optional("highwayMpg", highwayMpg),
      ...optional("combinedMpg", combinedMpg),
      ...optional("epaSourceReference", hasEpa ? "neovin:build" : undefined),
      nhtsaStatus: "UNAVAILABLE",
    },
    factory: {},
    ...(warranty ? { warranty } : {}),
    dealer: {
      tenantId: dealer.tenantId,
      name: dealer.name,
      ...optional("address", dealer.address),
      ...optional("city", dealer.city),
      ...optional("state", dealer.state),
      ...optional("postalCode", dealer.postalCode),
      ...optional("phone", dealer.phone),
      ...optional("website", dealer.website),
      ...optional("authorizedLogoUrl", dealer.authorizedLogoUrl),
    },
    document: {
      vehicleId: listing.id,
      documentId: document.documentId,
      sourceProvider: "NEOVIN",
      sourceClassification,
      confidence,
      verificationStatus,
      generatedAt: document.generatedAt ?? new Date().toISOString(),
      passportUrl: document.passportUrl,
      templateVersion: document.templateVersion,
      rendererVersion: document.rendererVersion,
      dataVersion: document.dataVersion,
    },
  };
}

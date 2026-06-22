// Inventory ingestion and normalization layer.
// Connecticut-first launch: this becomes the single vehicle object feeding stickers,
// FTC Buyers Guide, K-208, passport, addendums, and audit events.

import type { VehicleInventoryInput } from "./wiring";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type InventoryProviderType =
  | "manual"
  | "csv"
  | "dms"
  | "dealer_website"
  | "marketcheck"
  | "blackbook"
  | "oem_feed"
  | "api";

export type CanonicalVehicleCondition = "new" | "used";

export type CanonicalCertificationType =
  | "none"
  | "oem_cpo"
  | "dealer_cpo"
  | "dealer_upgrade_cpo"
  | "finance_upgrade_cpo"
  | "inspection_only";

export type RawInventoryVehicle = Record<string, unknown> & {
  vin?: unknown;
  stock?: unknown;
  stockNumber?: unknown;
  year?: unknown;
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  mileage?: unknown;
  odometer?: unknown;
  condition?: unknown;
  newUsed?: unknown;
  certified?: unknown;
  cpo?: unknown;
  price?: unknown;
  internetPrice?: unknown;
  advertisedPrice?: unknown;
  sellingPrice?: unknown;
  msrp?: unknown;
  marketValue?: unknown;
  bodyStyle?: unknown;
  exteriorColor?: unknown;
  interiorColor?: unknown;
  engine?: unknown;
  transmission?: unknown;
  drivetrain?: unknown;
  fuelType?: unknown;
  cityMpg?: unknown;
  highwayMpg?: unknown;
  combinedMpg?: unknown;
  imageUrl?: unknown;
  photos?: unknown;
  features?: unknown;
};

export type InventoryIngestionSource = {
  provider: InventoryProviderType;
  providerName?: string;
  dealerId: string;
  importedAt: string;
  feedUrl?: string;
  fileName?: string;
};

export type CanonicalInventoryVehicle = VehicleInventoryInput & {
  source: InventoryIngestionSource;
  canonicalId: string;
  saleState: string;
  bodyStyle?: string;
  exteriorColor?: string;
  interiorColor?: string;
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  fuelType?: string;
  certificationType: CanonicalCertificationType;
  isCertified: boolean;
  isCommercial: boolean;
  isDemo: boolean;
  isServiceLoaner: boolean;
  normalizedAt: string;
  raw: RawInventoryVehicle;
  ingestionWarnings: string[];
};

export type InventoryIngestionResult = {
  vehicles: CanonicalInventoryVehicle[];
  rejected: Array<{ raw: RawInventoryVehicle; reasons: string[] }>;
  warnings: string[];
  summary: {
    totalRaw: number;
    accepted: number;
    rejected: number;
    newCount: number;
    usedCount: number;
    cpoCount: number;
  };
};

const asString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const asNumber = (value: unknown): number | undefined => {
  const text = asString(value);
  if (!text) return undefined;
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const asBoolean = (value: unknown): boolean => {
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "yes", "y", "1", "certified", "cpo"].includes(text);
};

const firstValue = (...values: unknown[]) => values.find((value) => asString(value));

const normalizeCondition = (raw: RawInventoryVehicle): CanonicalVehicleCondition => {
  const text = String(firstValue(raw.condition, raw.newUsed, raw["new_used"], raw["type"]) || "").toLowerCase();
  if (text.includes("new")) return "new";
  return "used";
};

const normalizePhotos = (raw: RawInventoryVehicle): string[] => {
  if (Array.isArray(raw.photos)) return raw.photos.map(asString).filter(Boolean) as string[];
  const photoText = asString(raw.photos);
  if (photoText) return photoText.split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
  const image = asString(raw.imageUrl || raw["image"] || raw["photo"] || raw["primaryPhoto"]);
  return image ? [image] : [];
};

const normalizeFeatures = (raw: RawInventoryVehicle): string[] => {
  if (Array.isArray(raw.features)) return raw.features.map(asString).filter(Boolean) as string[];
  const featureText = asString(raw.features || raw["options"] || raw["equipment"]);
  return featureText ? featureText.split(/[|;,]/).map((item) => item.trim()).filter(Boolean) : [];
};

const normalizeCertificationType = (raw: RawInventoryVehicle): CanonicalCertificationType => {
  const text = String(firstValue(raw["certificationType"], raw["certification"], raw["certified"], raw.cpo) || "").toLowerCase();
  if (text.includes("oem") || text.includes("factory")) return "oem_cpo";
  if (text.includes("upgrade") && text.includes("finance")) return "finance_upgrade_cpo";
  if (text.includes("upgrade")) return "dealer_upgrade_cpo";
  if (text.includes("dealer")) return "dealer_cpo";
  if (text.includes("inspection")) return "inspection_only";
  if (asBoolean(raw.certified) || asBoolean(raw.cpo)) return "dealer_cpo";
  return "none";
};

const containsAny = (source: string, needles: string[]) => needles.some((needle) => source.includes(needle));

const buildTitle = (vehicle: Pick<CanonicalInventoryVehicle, "year" | "make" | "model" | "trim">) =>
  [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");

export const normalizeInventoryVehicle = (input: {
  raw: RawInventoryVehicle;
  source: InventoryIngestionSource;
  saleState?: string;
  imagePreference?: VehicleImagePreference;
}): { vehicle?: CanonicalInventoryVehicle; rejectReasons: string[] } => {
  const raw = input.raw;
  const vin = asString(firstValue(raw.vin, raw["VIN"], raw["vehicleIdentificationNumber"]));
  const stock = asString(firstValue(raw.stock, raw.stockNumber, raw["stock_number"], raw["Stock #"]));
  const year = asNumber(firstValue(raw.year, raw["modelYear"]));
  const make = asString(raw.make);
  const model = asString(raw.model);
  const rejectReasons = [
    !vin ? "Missing VIN" : undefined,
    !year ? "Missing model year" : undefined,
    !make ? "Missing make" : undefined,
    !model ? "Missing model" : undefined,
  ].filter(Boolean) as string[];

  if (rejectReasons.length) return { rejectReasons };

  const condition = normalizeCondition(raw);
  const certificationType = normalizeCertificationType(raw);
  const photos = normalizePhotos(raw);
  const features = normalizeFeatures(raw);
  const titleSource = [year, make, model, asString(raw.trim)].filter(Boolean).join(" ").toLowerCase();
  const bodyStyle = asString(raw.bodyStyle || raw["body"] || raw["body_type"]);
  const bodyText = `${titleSource} ${String(bodyStyle || "").toLowerCase()} ${features.join(" ").toLowerCase()}`;

  const vehicle: CanonicalInventoryVehicle = {
    source: input.source,
    canonicalId: `${input.source.dealerId}:${vin}`,
    saleState: input.saleState || "CT",
    condition,
    vin,
    stock,
    year,
    make,
    model,
    trim: asString(raw.trim),
    mileage: condition === "new" ? 0 : asNumber(firstValue(raw.mileage, raw.odometer)),
    pricing: {
      advertisedPrice: firstValue(raw.advertisedPrice, raw.internetPrice, raw.price, raw.sellingPrice) as string | number | undefined,
      sellingPrice: firstValue(raw.sellingPrice, raw.price) as string | number | undefined,
      websitePrice: firstValue(raw.internetPrice, raw.advertisedPrice, raw.price) as string | number | undefined,
      msrp: firstValue(raw.msrp, raw["MSRP"]) as string | number | undefined,
      marketValue: firstValue(raw.marketValue, raw["market_value"]) as string | number | undefined,
    },
    specs: {
      bodyStyle,
      exteriorColor: asString(raw.exteriorColor || raw["exterior_color"]),
      interiorColor: asString(raw.interiorColor || raw["interior_color"]),
      engine: asString(raw.engine),
      transmission: asString(raw.transmission),
      drivetrain: asString(raw.drivetrain || raw["driveTrain"]),
      fuelType: asString(raw.fuelType || raw["fuel"]),
    },
    fuel: {
      city: asNumber(raw.cityMpg || raw["city_mpg"]),
      highway: asNumber(raw.highwayMpg || raw["highway_mpg"]),
      combined: asNumber(raw.combinedMpg || raw["combined_mpg"]),
    },
    imageUrl: photos[0],
    usedCarPrimaryPhotoUrl: condition === "used" ? photos[0] : undefined,
    newCarImageUrl: condition === "new" ? photos[0] : undefined,
    imagePreference: input.imagePreference || "factory_clean_first",
    features,
    bodyStyle,
    exteriorColor: asString(raw.exteriorColor || raw["exterior_color"]),
    interiorColor: asString(raw.interiorColor || raw["interior_color"]),
    engine: asString(raw.engine),
    transmission: asString(raw.transmission),
    drivetrain: asString(raw.drivetrain || raw["driveTrain"]),
    fuelType: asString(raw.fuelType || raw["fuel"]),
    certificationTierId: certificationType !== "none" ? certificationType : undefined,
    certificationType,
    isCertified: certificationType !== "none",
    cpo: certificationType !== "none",
    isCommercial: containsAny(bodyText, ["commercial", "fleet", "cargo", "chassis", "cutaway", "transit", "promaster", "express"]),
    isDemo: containsAny(bodyText, ["demo", "demonstrator"]),
    isServiceLoaner: containsAny(bodyText, ["loaner", "service loaner"]),
    title: buildTitle({ year, make, model, trim: asString(raw.trim) }),
    normalizedAt: new Date().toISOString(),
    raw,
    ingestionWarnings: [
      !photos.length ? "No vehicle image found; renderer will use fallback." : undefined,
      condition === "used" && !asNumber(firstValue(raw.mileage, raw.odometer)) ? "Used vehicle missing mileage." : undefined,
    ].filter(Boolean) as string[],
  };

  return { vehicle, rejectReasons: [] };
};

export const ingestInventoryVehicles = (input: {
  rows: RawInventoryVehicle[];
  source: Omit<InventoryIngestionSource, "importedAt"> & { importedAt?: string };
  saleState?: string;
  imagePreference?: VehicleImagePreference;
}): InventoryIngestionResult => {
  const source: InventoryIngestionSource = {
    ...input.source,
    importedAt: input.source.importedAt || new Date().toISOString(),
  };

  const accepted: CanonicalInventoryVehicle[] = [];
  const rejected: InventoryIngestionResult["rejected"] = [];

  input.rows.forEach((raw) => {
    const result = normalizeInventoryVehicle({ raw, source, saleState: input.saleState, imagePreference: input.imagePreference });
    if (result.vehicle) accepted.push(result.vehicle);
    else rejected.push({ raw, reasons: result.rejectReasons });
  });

  const warnings = accepted.flatMap((vehicle) => vehicle.ingestionWarnings.map((warning) => `${vehicle.vin}: ${warning}`));

  return {
    vehicles: accepted,
    rejected,
    warnings,
    summary: {
      totalRaw: input.rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      newCount: accepted.filter((vehicle) => vehicle.condition === "new").length,
      usedCount: accepted.filter((vehicle) => vehicle.condition === "used").length,
      cpoCount: accepted.filter((vehicle) => vehicle.isCertified).length,
    },
  };
};

export const toStickerVehicleInput = (vehicle: CanonicalInventoryVehicle): VehicleInventoryInput & Record<string, unknown> => ({
  ...vehicle,
  condition: vehicle.condition,
  title: vehicle.title,
  cpo: vehicle.isCertified,
  isCommercial: vehicle.isCommercial,
  isDemo: vehicle.isDemo,
  isServiceLoaner: vehicle.isServiceLoaner,
  tags: [
    vehicle.condition,
    vehicle.certificationType !== "none" ? vehicle.certificationType : undefined,
    vehicle.isCommercial ? "commercial" : undefined,
    vehicle.isDemo ? "demo" : undefined,
    vehicle.isServiceLoaner ? "service-loaner" : undefined,
  ].filter(Boolean),
});

export const INVENTORY_INGESTION_NEXT_STEPS = [
  "Wire CSV upload/import rows into ingestInventoryVehicles().",
  "Map dealer website/VDP scraper output into RawInventoryVehicle rows.",
  "Map DMS provider fields into RawInventoryVehicle rows.",
  "Persist CanonicalInventoryVehicle snapshots for audit and document generation.",
  "Run Connecticut smoke test against normalized vehicle output.",
];

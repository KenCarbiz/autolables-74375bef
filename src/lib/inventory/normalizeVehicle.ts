export type RawInventoryVehicle = {
  vin?: string | null;
  stock?: string | null;
  stockNumber?: string | null;
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  mileage?: string | number | null;
  odometer?: string | number | null;
  condition?: string | null;
  state?: string | null;
  bodyStyle?: string | null;
  engine?: string | null;
  drivetrain?: string | null;
  transmission?: string | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  fuelType?: string | null;
  fuelEconomyCity?: string | number | null;
  fuelEconomyHighway?: string | number | null;
  mpgCity?: string | number | null;
  mpgHighway?: string | number | null;
  msrp?: string | number | null;
  marketValue?: string | number | null;
  advertisedPrice?: string | number | null;
  sellingPrice?: string | number | null;
  websitePrice?: string | number | null;
  imageUrl?: string | null;
  primaryPhotoUrl?: string | null;
  slug?: string | null;
  cpoStatus?: string | null;
  features?: unknown;
  options?: unknown;
  source?: string | null;
  [key: string]: unknown;
};

export type CanonicalVehicle = {
  vin: string;
  stock: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  title: string;
  mileage: string;
  condition: "new" | "used";
  state: string;
  bodyStyle?: string;
  engine?: string;
  drivetrain?: string;
  transmission?: string;
  exteriorColor?: string;
  interiorColor?: string;
  fuelType?: string;
  fuelEconomyCity?: string;
  fuelEconomyHighway?: string;
  msrp?: string;
  marketValue?: string;
  advertisedPrice?: string;
  sellingPrice?: string;
  websitePrice?: string;
  imageUrl?: string;
  slug?: string;
  cpoStatus: "none" | "dealer" | "oem";
  features: string[];
  options: string[];
  source: string;
  normalizedAt: string;
  warnings: string[];
};

const clean = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const money = (value: unknown): string | undefined => {
  const raw = clean(value);
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return raw;
  return String(Math.round(n));
};

const mileage = (value: unknown): string => {
  const raw = clean(value);
  if (!raw) return "";
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : raw;
};

const list = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (typeof value === "string") return value.split(/[|,;]/).map(clean).filter(Boolean);
  return [];
};

const resolveCondition = (value: unknown, year: string): "new" | "used" => {
  const raw = clean(value).toLowerCase();
  if (raw.includes("new")) return "new";
  if (raw.includes("used") || raw.includes("pre-owned") || raw.includes("preowned")) return "used";
  const currentYear = new Date().getFullYear();
  const parsedYear = Number(year);
  return Number.isFinite(parsedYear) && parsedYear >= currentYear ? "new" : "used";
};

const resolveCpo = (value: unknown): "none" | "dealer" | "oem" => {
  const raw = clean(value).toLowerCase();
  if (!raw || raw === "none" || raw === "false") return "none";
  if (raw.includes("oem") || raw.includes("factory") || raw.includes("manufacturer")) return "oem";
  if (raw.includes("dealer") || raw.includes("certified") || raw === "true") return "dealer";
  return "none";
};

const titleCaseMake = (make: string) => make
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part.length <= 4 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  .join(" ");

export function normalizeVehicle(raw: RawInventoryVehicle): CanonicalVehicle {
  const vin = clean(raw.vin).toUpperCase();
  const stock = clean(raw.stock || raw.stockNumber);
  const year = clean(raw.year);
  const make = titleCaseMake(clean(raw.make));
  const model = clean(raw.model);
  const trim = clean(raw.trim);
  const normalizedMileage = mileage(raw.mileage ?? raw.odometer);
  const condition = resolveCondition(raw.condition, year);
  const state = clean(raw.state).toUpperCase() || "CT";
  const cpoStatus = resolveCpo(raw.cpoStatus);
  const features = list(raw.features);
  const options = list(raw.options);
  const title = [year, make, model, trim].filter(Boolean).join(" ") || "Vehicle Details Pending";
  const warnings: string[] = [];

  if (!vin) warnings.push("VIN missing");
  if (!stock) warnings.push("Stock number missing");
  if (!year) warnings.push("Year missing");
  if (!make) warnings.push("Make missing");
  if (!model) warnings.push("Model missing");
  if (!normalizedMileage && condition === "used") warnings.push("Mileage missing for used vehicle");

  return {
    vin,
    stock,
    year,
    make,
    model,
    trim,
    title,
    mileage: normalizedMileage,
    condition,
    state,
    bodyStyle: clean(raw.bodyStyle) || undefined,
    engine: clean(raw.engine) || undefined,
    drivetrain: clean(raw.drivetrain) || undefined,
    transmission: clean(raw.transmission) || undefined,
    exteriorColor: clean(raw.exteriorColor) || undefined,
    interiorColor: clean(raw.interiorColor) || undefined,
    fuelType: clean(raw.fuelType) || undefined,
    fuelEconomyCity: clean(raw.fuelEconomyCity ?? raw.mpgCity) || undefined,
    fuelEconomyHighway: clean(raw.fuelEconomyHighway ?? raw.mpgHighway) || undefined,
    msrp: money(raw.msrp),
    marketValue: money(raw.marketValue),
    advertisedPrice: money(raw.advertisedPrice),
    sellingPrice: money(raw.sellingPrice),
    websitePrice: money(raw.websitePrice),
    imageUrl: clean(raw.imageUrl || raw.primaryPhotoUrl) || undefined,
    slug: clean(raw.slug) || undefined,
    cpoStatus,
    features,
    options,
    source: clean(raw.source) || "manual",
    normalizedAt: new Date().toISOString(),
    warnings,
  };
}

export function canonicalToCtMvpInput(vehicle: CanonicalVehicle) {
  return {
    vin: vehicle.vin,
    stock: vehicle.stock,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    mileage: vehicle.mileage,
    state: vehicle.state,
    condition: vehicle.condition,
    cpoStatus: vehicle.cpoStatus,
    passportEnabled: true,
  };
}

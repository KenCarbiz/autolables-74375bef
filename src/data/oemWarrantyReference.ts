import { UNLIMITED_MILES } from "@/lib/oemWarranty";

// Curated reference of standard US new-vehicle manufacturer warranties, keyed by
// canonical brand. The Factory & CPO admin panel auto-fills a brand's fields
// from here so dealers don't retype the OEM's terms — but auto-fill always
// leaves the row UNVERIFIED, because these are typical figures that can vary by
// model year, trim, and powertrain (and a customer-facing claim must be the
// dealer's confirmed truth). Federal minimums to remember: EV/hybrid traction
// batteries carry at least 8 yr / 100,000 mi; emissions components have their
// own federal terms. Verify against the model-year warranty booklet.
//
// Miles use the UNLIMITED_MILES sentinel (-1) for unlimited terms (common on
// corrosion and roadside). Months are whole months.

export interface OemWarrantyReferenceEntry {
  basic_months: number;
  basic_miles: number;
  powertrain_months: number;
  powertrain_miles: number;
  corrosion_months?: number;
  corrosion_miles?: number;
  roadside_months?: number;
  roadside_miles?: number;
  ev_battery_months?: number;
  ev_battery_miles?: number;
  maintenance_months?: number;
  maintenance_miles?: number;
  // Subsequent-owner (transferred) terms where the make reduces coverage on
  // transfer. Left blank when fully transferable.
  powertrain_transfer_months?: number;
  powertrain_transfer_miles?: number;
  basic_transfer_months?: number;
  basic_transfer_miles?: number;
  notes?: string;
}

const U = UNLIMITED_MILES;

export const OEM_WARRANTY_REFERENCE: Record<string, OemWarrantyReferenceEntry> = {
  ACURA: { basic_months: 48, basic_miles: 50000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 60, corrosion_miles: U },
  AUDI: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 144, corrosion_miles: U },
  BMW: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 144, corrosion_miles: U, roadside_months: 48, roadside_miles: U, maintenance_months: 36, maintenance_miles: 36000, notes: "BMW Ultimate Care maintenance 3 yr / 36,000 mi." },
  BUICK: { basic_months: 48, basic_miles: 50000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 72, corrosion_miles: 100000 },
  CADILLAC: { basic_months: 48, basic_miles: 50000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 72, corrosion_miles: 100000 },
  CHEVROLET: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 72, corrosion_miles: 100000 },
  CHRYSLER: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  DODGE: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  FORD: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  GENESIS: { basic_months: 60, basic_miles: 60000, powertrain_months: 120, powertrain_miles: 100000, corrosion_months: 84, corrosion_miles: U, roadside_months: 60, roadside_miles: U, maintenance_months: 36, maintenance_miles: 36000, powertrain_transfer_months: 60, powertrain_transfer_miles: 60000, notes: "Powertrain 10 yr / 100k original owner; 5 yr / 60k after transfer." },
  GMC: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 72, corrosion_miles: 100000 },
  HONDA: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  HYUNDAI: { basic_months: 60, basic_miles: 60000, powertrain_months: 120, powertrain_miles: 100000, corrosion_months: 84, corrosion_miles: U, roadside_months: 60, roadside_miles: U, powertrain_transfer_months: 60, powertrain_transfer_miles: 60000, notes: "Powertrain 10 yr / 100k original owner; 5 yr / 60k after transfer." },
  INFINITI: { basic_months: 48, basic_miles: 60000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 84, corrosion_miles: U, roadside_months: 48, roadside_miles: U },
  JAGUAR: { basic_months: 60, basic_miles: 60000, powertrain_months: 60, powertrain_miles: 60000, maintenance_months: 60, maintenance_miles: 60000, notes: "Jaguar EliteCare 5 yr / 60,000 mi incl. maintenance." },
  JEEP: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  KIA: { basic_months: 60, basic_miles: 60000, powertrain_months: 120, powertrain_miles: 100000, corrosion_months: 60, corrosion_miles: 100000, roadside_months: 60, roadside_miles: 60000, powertrain_transfer_months: 60, powertrain_transfer_miles: 60000, notes: "Powertrain 10 yr / 100k original owner; 5 yr / 60k after transfer." },
  "LAND ROVER": { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000 },
  LEXUS: { basic_months: 48, basic_miles: 50000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 72, corrosion_miles: U },
  LINCOLN: { basic_months: 48, basic_miles: 50000, powertrain_months: 72, powertrain_miles: 70000, corrosion_months: 60, corrosion_miles: U },
  MAZDA: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  "MERCEDES-BENZ": { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000 },
  MINI: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 144, corrosion_miles: U },
  MITSUBISHI: { basic_months: 60, basic_miles: 60000, powertrain_months: 120, powertrain_miles: 100000, corrosion_months: 84, corrosion_miles: 100000, roadside_months: 60, roadside_miles: U, powertrain_transfer_months: 60, powertrain_transfer_miles: 60000, notes: "Powertrain 10 yr / 100k original owner; 5 yr / 60k after transfer." },
  NISSAN: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  PORSCHE: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 144, corrosion_miles: U },
  RAM: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  SUBARU: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U },
  TESLA: { basic_months: 48, basic_miles: 50000, powertrain_months: 96, powertrain_miles: 100000, ev_battery_months: 96, ev_battery_miles: 100000, notes: "Battery & drive unit 8 yr; mileage varies 100k–150k by model." },
  TOYOTA: { basic_months: 36, basic_miles: 36000, powertrain_months: 60, powertrain_miles: 60000, corrosion_months: 60, corrosion_miles: U, roadside_months: 24, roadside_miles: U, maintenance_months: 24, maintenance_miles: 25000, ev_battery_months: 120, ev_battery_miles: 150000, notes: "ToyotaCare maintenance 2 yr / 25,000 mi; hybrid battery 10 yr / 150,000 mi on recent model years." },
  VOLKSWAGEN: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 84, corrosion_miles: 100000 },
  VOLVO: { basic_months: 48, basic_miles: 50000, powertrain_months: 48, powertrain_miles: 50000, corrosion_months: 144, corrosion_miles: U },
};

// Common spellings / abbreviations a dealer might type → canonical key.
const BRAND_ALIASES: Record<string, string> = {
  CHEVY: "CHEVROLET",
  VW: "VOLKSWAGEN",
  MERCEDES: "MERCEDES-BENZ",
  "MERCEDES BENZ": "MERCEDES-BENZ",
  BENZ: "MERCEDES-BENZ",
  MB: "MERCEDES-BENZ",
  LANDROVER: "LAND ROVER",
  "RANGE ROVER": "LAND ROVER",
  "ALFA ROMEO": "ALFA ROMEO",
  GENESIS: "GENESIS",
};

// Resolve a brand string (exact, aliased, or contained within a make/ymm) to a
// reference entry, or null when we have no curated terms for it.
export const lookupOemReference = (brand: string | null | undefined): OemWarrantyReferenceEntry | null => {
  const raw = `${brand || ""}`.trim().toUpperCase();
  if (!raw) return null;
  if (OEM_WARRANTY_REFERENCE[raw]) return OEM_WARRANTY_REFERENCE[raw];
  if (BRAND_ALIASES[raw] && OEM_WARRANTY_REFERENCE[BRAND_ALIASES[raw]]) return OEM_WARRANTY_REFERENCE[BRAND_ALIASES[raw]];
  // Contains match (e.g. "2027 INFINITI QX60" or "Mercedes-Benz GLE").
  const key = Object.keys(OEM_WARRANTY_REFERENCE).find((k) => raw.includes(k));
  if (key) return OEM_WARRANTY_REFERENCE[key];
  const aliasKey = Object.keys(BRAND_ALIASES).find((a) => raw.includes(a));
  if (aliasKey) return OEM_WARRANTY_REFERENCE[BRAND_ALIASES[aliasKey]] || null;
  return null;
};

export const hasOemReference = (brand: string | null | undefined): boolean => lookupOemReference(brand) != null;

// OEM factory-warranty + CPO program config. The dealer enters and verifies the
// manufacturer's published warranty terms per franchised brand, plus their CPO
// programs (OEM-certified and dealer-certified). Only VERIFIED factory terms
// feed the public passport — we never assert an unconfirmed warranty.
//
// The same shapes are read server-side by the public-listing-view edge function
// (which fills warranty_info for new/CPO cars from these terms), so keep the
// field names in sync with that function.

export interface OemFactoryWarranty {
  brand: string;                 // franchised make, e.g. "INFINITI"
  basic_months: number;          // bumper-to-bumper
  basic_miles: number;
  powertrain_months: number;
  powertrain_miles: number;
  corrosion_months?: number;     // anti-perforation / rust-through
  corrosion_miles?: number;
  roadside_months?: number;
  roadside_miles?: number;
  ev_battery_months?: number;    // hybrid / EV high-voltage battery
  ev_battery_miles?: number;
  maintenance_months?: number;   // complimentary scheduled maintenance
  maintenance_miles?: number;
  // Subsequent-owner (post-transfer) terms. Several makes — notably Hyundai,
  // Kia, Genesis, Mitsubishi — drop the long original-owner powertrain coverage
  // when the car changes hands (e.g. 10 yr / 100k original → 5 yr / 60k second
  // owner). Used and CPO buyers are subsequent owners, so their passport shows
  // these when present. Leave blank when the term is fully transferable.
  powertrain_transfer_months?: number;
  powertrain_transfer_miles?: number;
  basic_transfer_months?: number;
  basic_transfer_miles?: number;
  notes?: string;
  verified: boolean;             // dealer confirmed these match the OEM's published terms
  verified_at?: string;          // ISO timestamp of the confirmation
  verified_by?: string;
}

export interface CpoProgram {
  id: string;
  name: string;                  // "INFINITI Certified Pre-Owned", "Dealer Certified"
  kind: "oem" | "dealer";
  brand?: string;                // OEM CPO is brand-scoped; dealer CPO applies to any make
  enabled: boolean;
  // CPO limited / powertrain coverage. coverage_from says whether the term runs
  // from the vehicle's original in-service date or from the CPO purchase date.
  basic_months?: number;
  basic_miles?: number;
  powertrain_months?: number;
  powertrain_miles?: number;
  coverage_from: "in_service" | "purchase";
  deductible?: number;
  transferable?: boolean;
  max_age_years?: number;        // eligibility ceiling
  max_mileage?: number;          // eligibility ceiling
  inspection_points?: string;    // "172-point"
  benefits?: string;             // roadside, loaner, trial subscriptions … (free text)
  disclosure?: string;
  show_on_passport: boolean;
}

// Sentinel for an unlimited-mileage term (many luxury basic warranties, and
// most roadside/corrosion coverage). Stored in the miles field so the shape
// stays a plain number; helpers below translate it for display, and downstream
// (passport) an unlimited cap is rendered as a time-only term (no mile bar).
export const UNLIMITED_MILES = -1;
export const isUnlimitedMiles = (n?: number): boolean => n === UNLIMITED_MILES;
// A positive mileage value, or undefined for unset/unlimited (so callers that
// do remaining-mile math never see the sentinel or zero).
export const finiteMiles = (n?: number): number | undefined => (n && n > 0 ? n : undefined);
export const milesLabel = (n?: number): string | null =>
  n === UNLIMITED_MILES ? "Unlimited" : n && n > 0 ? `${(n / 1000).toFixed(0)}K mi` : null;

export const emptyOemWarranty = (brand = ""): OemFactoryWarranty => ({
  brand,
  basic_months: 36,
  basic_miles: 36000,
  powertrain_months: 60,
  powertrain_miles: 60000,
  verified: false,
});

export const emptyCpoProgram = (kind: "oem" | "dealer" = "oem"): CpoProgram => ({
  id: `cpo_${Math.abs(hashStr(kind + Date.now().toString())).toString(36)}`,
  name: kind === "oem" ? "Certified Pre-Owned" : "Dealer Certified",
  kind,
  enabled: true,
  coverage_from: "in_service",
  transferable: true,
  show_on_passport: true,
});

// A vehicle's make string can be multi-word ("Mercedes-Benz", "Land Rover"), so
// match by asking whether the year-make-model line CONTAINS the brand rather
// than splitting on whitespace. Returns the first verified match (or, if
// onlyVerified is false, the first match regardless).
export const resolveFactoryWarranty = (
  warranties: OemFactoryWarranty[] | undefined,
  ymmOrMake: string | null | undefined,
  onlyVerified = true,
): OemFactoryWarranty | null => {
  const hay = `${ymmOrMake || ""}`.toUpperCase();
  if (!hay || !warranties?.length) return null;
  const candidates = warranties.filter((w) => {
    const b = `${w.brand || ""}`.trim().toUpperCase();
    return b.length > 1 && hay.includes(b);
  });
  if (!candidates.length) return null;
  const verified = candidates.find((w) => w.verified);
  return onlyVerified ? (verified ?? null) : (verified ?? candidates[0]);
};

// Build the listing.warranty_info shape the passport already renders. For a new
// car there is no prior in-service date, so the caller passes the sale/listing
// date — a brand-new car carries the full term forward from that point.
export const factoryWarrantyToInfo = (w: OemFactoryWarranty, inServiceDate?: string, subsequentOwner = false) => {
  // A subsequent (used/CPO) owner gets the transferred term where the make
  // reduces it; otherwise the standard term carries over unchanged.
  const basicMonths = subsequentOwner && w.basic_transfer_months ? w.basic_transfer_months : w.basic_months;
  const basicMiles = subsequentOwner && w.basic_transfer_miles ? w.basic_transfer_miles : w.basic_miles;
  const ptMonths = subsequentOwner && w.powertrain_transfer_months ? w.powertrain_transfer_months : w.powertrain_months;
  const ptMiles = subsequentOwner && w.powertrain_transfer_miles ? w.powertrain_transfer_miles : w.powertrain_miles;
  return {
    factory_months: basicMonths || undefined,
    // Unlimited (or unset) → omit the mile cap; the term is then time-only,
    // which is exactly how an unlimited-mileage warranty reads.
    factory_miles: finiteMiles(basicMiles),
    powertrain_months: ptMonths || undefined,
    powertrain_miles: finiteMiles(ptMiles),
    in_service_date: inServiceDate,
  };
};

// CPO programs applicable to a vehicle of the given make — OEM programs whose
// brand matches, plus every enabled dealer program (brand-agnostic).
export const matchCpoPrograms = (
  programs: CpoProgram[] | undefined,
  ymmOrMake: string | null | undefined,
): CpoProgram[] => {
  const hay = `${ymmOrMake || ""}`.toUpperCase();
  return (programs || []).filter((p) => {
    if (!p.enabled) return false;
    if (p.kind === "dealer") return true;
    const b = `${p.brand || ""}`.trim().toUpperCase();
    return b.length > 1 && hay.includes(b);
  });
};

export const warrantyHeadline = (w: OemFactoryWarranty): string => {
  const yr = (mo?: number) => (mo ? `${Math.round(mo / 12)} yr` : null);
  const basic = [yr(w.basic_months), milesLabel(w.basic_miles)].filter(Boolean).join(" / ");
  return basic || "Factory warranty";
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ── OEM Factory Warranty Library — domain types ──────────────────────────────
// Architecture: the warranty database is OEM-RULE driven, never keyed per VIN.
// A VIN identifies the vehicle (year/make/model/trim/powertrain/fuel); those
// attributes are matched to a stored OEM warranty PROGRAM, whose COVERAGES are
// then calculated into a per-VIN display SNAPSHOT.
//
//   VIN → decode → match OEM program → calculate display → snapshot per VIN
//
// See docs/oem-warranty-library.md for the full rationale + verification rules.

export type WarrantyDisplayMode = "new" | "used" | "cpo";

// The coverage buckets a program can carry. `basic` and `bumper_to_bumper` are
// synonyms kept for import compatibility; the matcher treats them the same.
export type CoverageType =
  | "basic"
  | "bumper_to_bumper"
  | "powertrain"
  | "roadside_assistance"
  | "corrosion_perforation"
  | "emissions"
  | "hybrid_ev_components"
  | "safety_restraint"
  | "cpo";

// Where a coverage term begins counting.
export type CoverageStartsAt = "delivery_date" | "in_service_date" | "original_sale_date";

// verified = dealer/OEM source confirmed; needs_review = seeded but unverified
// (must NOT be presented as fact without a source check before production).
export type ConfidenceStatus = "verified" | "needs_review";

export interface OemWarrantySource {
  sourceTitle: string;
  sourceUrl?: string | null;
  sourceDocumentName?: string | null;
  sourceEffectiveDate?: string | null;   // ISO date the OEM terms took effect
  sourceLastVerifiedAt?: string | null;   // ISO date a human last confirmed it
  verifiedBy?: string | null;
  notes?: string | null;
}

export interface OemWarrantyCoverage {
  coverageType: CoverageType;
  displayName: string;                     // "Bumper-to-Bumper"
  subtitle?: string | null;                // "Basic Vehicle Coverage"
  description?: string | null;
  termMonths?: number | null;
  termYears?: number | null;               // convenience; termMonths is authoritative
  mileageLimit?: number | null;            // null/undefined + unlimitedMiles=true → no cap
  unlimitedMiles?: boolean;
  // Reduced terms after the vehicle changes hands. Several makes (Hyundai, Kia,
  // Genesis, Mitsubishi) drop the long original-owner powertrain coverage on
  // transfer. Used/CPO buyers are subsequent owners, so the display model uses
  // these when present. Leave unset when the term is fully transferable.
  subsequentOwnerTermMonths?: number | null;
  subsequentOwnerMileageLimit?: number | null;
  subsequentOwnerUnlimitedMiles?: boolean;
  startsAt: CoverageStartsAt;
  sortOrder: number;
  iconKey?: string | null;                 // maps to a UI icon (roadside, corrosion, …)
  accentColor?: "blue" | "green" | "violet" | null;
}

export interface OemWarrantyProgram {
  id: string;
  oemMake: string;                         // canonical, e.g. "INFINITI"
  brand?: string | null;                   // marketing brand if different
  country: string;                         // market, e.g. "US"
  modelYearStart: number;
  modelYearEnd: number;
  model?: string | null;                   // null = applies to all models for the make
  trim?: string | null;                    // null = any trim
  powertrainType?: string | null;          // "gas" | "hybrid" | "phev" | "ev" | "diesel" | null(any)
  fuelType?: string | null;
  vehicleType?: string | null;             // "suv" | "sedan" | …
  programName: string;
  appliesToNew: boolean;
  appliesToUsed: boolean;
  appliesToCpo: boolean;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  confidenceStatus: ConfidenceStatus;
  coverages: OemWarrantyCoverage[];
  sources: OemWarrantySource[];
}

// Normalized vehicle attributes the services consume — decoupled from the
// VehicleListing row so the matcher/calculator are unit-testable in isolation.
export interface WarrantyVehicleInput {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  fuelType?: string | null;
  powertrainType?: string | null;
  country?: string | null;                 // defaults to "US"
  condition?: string | null;               // "new" | "used" | "cpo" | …
  certified?: boolean | null;              // CPO flags (any of these implies cpo)
  cpo?: boolean | null;
  isCertifiedPreOwned?: boolean | null;
  isNew?: boolean | null;
  inventoryType?: string | null;
  type?: string | null;
  mileage?: number | null;
  inServiceDate?: string | null;           // ISO; original in-service / first-use date
}

// How specific the program match was — drives confidence + audit trail.
export type MatchTier =
  | "exact_trim_powertrain"
  | "model_year_powertrain"
  | "model_year"
  | "make_year_range"
  | "make_default"
  | "none";

export interface WarrantyMatchResult {
  program: OemWarrantyProgram | null;
  matchedBy: MatchTier;
  matchedMake?: string | null;
  matchedModel?: string | null;
  matchedYear?: number | null;
  matchedTrim?: string | null;
  matchedPowertrain?: string | null;
  needsDealerConfirmation: boolean;        // true when no confident program was found
  confidenceStatus: ConfidenceStatus | null;
}

// Result of calculating one coverage's remaining state for a used/CPO vehicle.
export interface CoverageRemaining {
  coverageType: CoverageType;
  expirationDate: string | null;          // null when in-service date unknown
  expirationMileage: number | null;       // null when mileage limit unlimited/unknown
  monthsRemaining: number | null;
  yearsRemaining: number | null;
  milesRemaining: number | null;
  pctRemaining: number | null;            // min of time% and mileage% when both known
  active: boolean | null;                 // null when neither dimension is known
  partial: boolean;                       // true when one dimension is missing
  needsDealerConfirmation: boolean;
}

// A saved per-VIN snapshot (persisted to vehicle_warranty_snapshots). Kept as a
// plain shape so it can round-trip to snapshot_json.
export interface VehicleWarrantySnapshot {
  vin: string;
  vehicleId?: string | null;
  warrantyProgramId: string | null;
  displayMode: WarrantyDisplayMode;
  matchedMake?: string | null;
  matchedModel?: string | null;
  matchedYear?: number | null;
  matchedTrim?: string | null;
  matchedPowertrain?: string | null;
  inServiceDate?: string | null;
  currentMileage?: number | null;
  calculatedAt: string;                   // ISO
  sourceLastVerifiedAt?: string | null;
  needsDealerConfirmation: boolean;
  snapshotJson: WarrantyDisplayModel;
}

// ── The view-model the Factory Warranty modal renders from ────────────────────
export type WarrantyStatus = "ACTIVE" | "INACTIVE" | "EXPIRED" | "NEEDS_CONFIRMATION";

export interface GlanceCoverage {
  coverageType: CoverageType;
  title: string;                          // "Bumper-to-Bumper"
  subtitle: string;                       // "Basic Vehicle Coverage"
  accent: "blue" | "green";
  // NEW mode: term only.
  termYears?: string | null;              // "4 Years"
  termMiles?: string | null;              // "50,000 Miles"
  // USED/CPO mode: calculated remaining.
  pctRemaining?: number | null;
  yearsRemainingLabel?: string | null;    // "4 Years Remaining"
  milesRemainingLabel?: string | null;    // "48,250 Miles Remaining"
  expiresDate?: string | null;            // "Aug 24, 2031"
  expiresMiles?: string | null;           // "60,000 miles"
}

export interface BenefitItem {
  coverageType: CoverageType;
  title: string;                          // "Roadside Assistance"
  term: string;                           // "6 years / 70,000 miles"
  subtitle?: string | null;               // "Federal emissions components"
  iconKey?: string | null;
  accent: "blue" | "green";
}

export interface WarrantyDisplayModel {
  mode: WarrantyDisplayMode;
  title: string;                          // "Factory Warranty"
  subtitle: string;                       // "See what's covered and for how long."
  status: WarrantyStatus;
  statusCopy: string;
  warrantyStartLabel: string;             // "Warranty Start"
  warrantyStartValue: string;             // "At Delivery Date" | "Aug 24, 2027"
  warrantyStartSubcopy?: string | null;   // "(In-Service Date)"
  showWarrantyEnd: boolean;
  warrantyEndLabel?: string | null;       // "Warranty End"
  warrantyEndValue?: string | null;       // "Aug 24, 2033"
  warrantyEndMiles?: number | null;       // secondary "or 70,000 miles"
  showProgress: boolean;
  showRemaining: boolean;
  coverageAtGlance: GlanceCoverage[];
  notice?: string | null;                 // NEW: "Factory coverage begins when you take delivery…"
  additionalFactoryBenefits: BenefitItem[];
  showCpoBanner: boolean;
  cpoBrand?: string | null;
  needsDealerConfirmation: boolean;
  confirmationDisclosure?: string | null; // small, non-hero "Ask dealer to confirm …"
  disclaimers: string[];
  matchedBy: MatchTier;
  confidenceStatus: ConfidenceStatus | null;
}

// ── OEM Warranty Library — seed programs ─────────────────────────────────────
// The rule-driven store of manufacturer warranty PROGRAMS. Each program is keyed
// by make / model-year range / model / market / powertrain, and carries its own
// COVERAGES and SOURCES. VIN-decoded vehicle attributes are matched against this
// library (see src/lib/warranty/match.ts) — we never store warranty per-VIN.
//
// SEED SCOPE (Phase 1): INFINITI, NISSAN, VOLKSWAGEN, HYUNDAI — US market. Make-
// level programs are DERIVED from the app's curated oemWarrantyReference (a
// single source of truth), plus one model-specific INFINITI 2026 QX60 program
// for the demo. Every seeded program is confidence_status "needs_review" with an
// unverified source.
//
// TODO(warranty): Before any OEM program is shown as fact in production it MUST
// have confidenceStatus "verified" with a real source URL/document and a
// sourceLastVerifiedAt date. Add new OEMs in reviewed batches via the import
// template at data/oem-warranty/ — do NOT bulk-fabricate terms. The running
// coverage tracker (src/lib/warranty/coverageReport.ts) lists which makes are
// loaded and which curated makes still need a program.

import type { OemWarrantyCoverage, OemWarrantyProgram, OemWarrantySource } from "@/lib/warranty/types";
import { UNLIMITED_MILES } from "@/lib/oemWarranty";
import { OEM_WARRANTY_REFERENCE, type OemWarrantyReferenceEntry } from "@/data/oemWarrantyReference";

const U = UNLIMITED_MILES;

// Placeholder source used until a real OEM warranty booklet / URL is attached.
const unverifiedSource = (make: string): OemWarrantySource => ({
  sourceTitle: "Dealer/OEM warranty source required",
  sourceUrl: null,
  sourceDocumentName: null,
  sourceEffectiveDate: null,
  sourceLastVerifiedAt: null,
  verifiedBy: null,
  notes: `Seeded for ${make} from the app's curated reference terms. Verify against the model-year warranty booklet before production use.`,
});

const yrs = (mo?: number | null) => (mo ? Math.round(mo / 12) : null);
const milesFields = (mi?: number | null): Pick<OemWarrantyCoverage, "mileageLimit" | "unlimitedMiles"> =>
  mi === U ? { mileageLimit: null, unlimitedMiles: true } : { mileageLimit: mi ?? null, unlimitedMiles: false };

// Convert a curated reference entry into the library's coverage rows. Emissions
// is added as the US federal-standard component term (major components
// 8 yr / 80,000 mi) rather than an invented per-brand figure.
function coveragesFromReference(entry: OemWarrantyReferenceEntry): OemWarrantyCoverage[] {
  let sort = 0;
  const rows: OemWarrantyCoverage[] = [];

  // Bumper-to-bumper — original terms, plus any reduced transfer terms.
  rows.push({
    coverageType: "bumper_to_bumper",
    displayName: "Bumper-to-Bumper",
    subtitle: "Basic Vehicle Coverage",
    termMonths: entry.basic_months,
    termYears: yrs(entry.basic_months),
    ...milesFields(entry.basic_miles),
    subsequentOwnerTermMonths: entry.basic_transfer_months ?? null,
    subsequentOwnerMileageLimit: entry.basic_transfer_miles === U ? null : entry.basic_transfer_miles ?? null,
    subsequentOwnerUnlimitedMiles: entry.basic_transfer_miles === U,
    startsAt: "in_service_date",
    sortOrder: ++sort,
    iconKey: "basic",
    accentColor: "blue",
  });

  // Powertrain — captures the second-owner reduction (e.g. Hyundai 10/100k → 5/60k).
  rows.push({
    coverageType: "powertrain",
    displayName: "Powertrain",
    subtitle: "Engine, Transmission & Drivetrain",
    termMonths: entry.powertrain_months,
    termYears: yrs(entry.powertrain_months),
    ...milesFields(entry.powertrain_miles),
    subsequentOwnerTermMonths: entry.powertrain_transfer_months ?? null,
    subsequentOwnerMileageLimit: entry.powertrain_transfer_miles === U ? null : entry.powertrain_transfer_miles ?? null,
    subsequentOwnerUnlimitedMiles: entry.powertrain_transfer_miles === U,
    startsAt: "in_service_date",
    sortOrder: ++sort,
    iconKey: "powertrain",
    accentColor: "green",
  });

  if (entry.roadside_months || entry.roadside_miles) {
    rows.push({
      coverageType: "roadside_assistance", displayName: "Roadside Assistance", subtitle: null,
      termMonths: entry.roadside_months ?? null, termYears: yrs(entry.roadside_months), ...milesFields(entry.roadside_miles),
      startsAt: "in_service_date", sortOrder: ++sort, iconKey: "roadside", accentColor: "blue",
    });
  }
  if (entry.corrosion_months || entry.corrosion_miles) {
    rows.push({
      coverageType: "corrosion_perforation", displayName: "Corrosion Perforation", subtitle: null,
      termMonths: entry.corrosion_months ?? null, termYears: yrs(entry.corrosion_months), ...milesFields(entry.corrosion_miles),
      startsAt: "in_service_date", sortOrder: ++sort, iconKey: "corrosion", accentColor: "blue",
    });
  }
  // Federal emissions — standard US light-duty major-component coverage.
  rows.push({
    coverageType: "emissions", displayName: "Emissions Coverage", subtitle: "Federal emissions components",
    termMonths: 96, termYears: 8, mileageLimit: 80000, unlimitedMiles: false,
    startsAt: "in_service_date", sortOrder: ++sort, iconKey: "emissions", accentColor: "blue",
  });
  if (entry.ev_battery_months || entry.ev_battery_miles) {
    rows.push({
      coverageType: "hybrid_ev_components", displayName: "Hybrid/Electric Components", subtitle: "High-voltage battery & system",
      termMonths: entry.ev_battery_months ?? null, termYears: yrs(entry.ev_battery_months), ...milesFields(entry.ev_battery_miles),
      startsAt: "in_service_date", sortOrder: ++sort, iconKey: "hybrid_ev_components", accentColor: "green",
    });
  }
  return rows;
}

// Build a make-level default program (model = null → applies to all of that
// make's models) from the curated reference. Model-year range is intentionally
// wide; refine when model-year-specific booklets are verified.
function makeLevelProgram(make: string, yearStart = 2015, yearEnd = 2027): OemWarrantyProgram | null {
  const entry = OEM_WARRANTY_REFERENCE[make];
  if (!entry) return null;
  const pretty = make.charAt(0) + make.slice(1).toLowerCase();
  return {
    id: `${make.toLowerCase()}-us-default`,
    oemMake: make,
    brand: make,
    country: "US",
    modelYearStart: yearStart,
    modelYearEnd: yearEnd,
    model: null,
    trim: null,
    powertrainType: null,
    fuelType: null,
    vehicleType: null,
    programName: `${pretty} New Vehicle Limited Warranty`,
    appliesToNew: true,
    appliesToUsed: true,
    appliesToCpo: true,
    effectiveStartDate: null,
    effectiveEndDate: null,
    confidenceStatus: "needs_review",
    coverages: coveragesFromReference(entry),
    sources: [unverifiedSource(make)],
  };
}

// Model-specific demo program — INFINITI 2026 QX60 (US), matching the approved
// mockup exactly (4 yr / 50k basic, 6 yr / 70k powertrain, plus benefits).
const INFINITI_QX60_2026: OemWarrantyProgram = {
  id: "infiniti-2026-qx60-us",
  oemMake: "INFINITI",
  brand: "INFINITI",
  country: "US",
  modelYearStart: 2026,
  modelYearEnd: 2026,
  model: "QX60",
  trim: null,
  powertrainType: "gas",
  fuelType: "gasoline",
  vehicleType: "suv",
  programName: "INFINITI New Vehicle Limited Warranty",
  appliesToNew: true,
  appliesToUsed: true,
  appliesToCpo: true,
  effectiveStartDate: null,
  effectiveEndDate: null,
  confidenceStatus: "needs_review",
  coverages: [
    { coverageType: "bumper_to_bumper", displayName: "Bumper-to-Bumper", subtitle: "Basic Vehicle Coverage", description: "Covers most vehicle systems and components.", termMonths: 48, termYears: 4, mileageLimit: 50000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 1, iconKey: "basic", accentColor: "blue" },
    { coverageType: "powertrain", displayName: "Powertrain", subtitle: "Engine, Transmission & Drivetrain", description: "Covers the engine, transmission, and drivetrain.", termMonths: 72, termYears: 6, mileageLimit: 70000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 2, iconKey: "powertrain", accentColor: "green" },
    { coverageType: "roadside_assistance", displayName: "Roadside Assistance", subtitle: null, termMonths: 72, termYears: 6, mileageLimit: 70000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 3, iconKey: "roadside", accentColor: "blue" },
    { coverageType: "corrosion_perforation", displayName: "Corrosion Perforation", subtitle: null, termMonths: 84, termYears: 7, mileageLimit: null, unlimitedMiles: true, startsAt: "in_service_date", sortOrder: 4, iconKey: "corrosion", accentColor: "blue" },
    { coverageType: "emissions", displayName: "Emissions Coverage", subtitle: "Federal emissions components", termMonths: 96, termYears: 8, mileageLimit: 80000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 5, iconKey: "emissions", accentColor: "blue" },
    { coverageType: "safety_restraint", displayName: "Safety Restraint Coverage", subtitle: "Seatbelts, airbags, sensors", termMonths: 120, termYears: 10, mileageLimit: null, unlimitedMiles: true, startsAt: "in_service_date", sortOrder: 6, iconKey: "safety_restraint", accentColor: "blue" },
  ],
  sources: [unverifiedSource("INFINITI")],
};

// Makes with a loaded program this phase. Add to this list (and the makes will
// flow into the coverage tracker) as new OEMs are reviewed and seeded.
export const LOADED_MAKES = ["INFINITI", "NISSAN", "VOLKSWAGEN", "HYUNDAI"] as const;

export const OEM_WARRANTY_PROGRAMS: OemWarrantyProgram[] = [
  // Model-specific first (more specific programs win the match ladder).
  INFINITI_QX60_2026,
  // Make-level defaults derived from the curated reference.
  ...LOADED_MAKES.map((m) => makeLevelProgram(m)).filter((p): p is OemWarrantyProgram => p != null),
];

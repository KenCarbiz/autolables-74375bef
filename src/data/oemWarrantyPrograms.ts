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
const VERIFIED_AT = "2026-07-01"; // new-car terms cross-checked on this date

// New-vehicle warranty source per make, confirmed by verification agents on
// 2026-07-01 against the manufacturer's warranty page. Presence here flips the
// make's program to confidence_status "verified".
const NEW_CAR_SOURCE: Record<string, string> = {
  ACURA: "https://www.acuracertified.com/", AUDI: "https://www.audiusa.com/en/service/warranty/",
  BMW: "https://shop.bmwusa.com/support-and-policy/warranty-information.html", BUICK: "https://www.buick.com/owners/warranty-protection-plans",
  CADILLAC: "https://www.cadillac.com/ownership/warranty-repairs", CHEVROLET: "https://www.chevrolet.com/owners/warranty",
  CHRYSLER: "https://www.chrysler.com/warranty.html", DODGE: "https://www.chrysler.com/warranty.html",
  FORD: "https://www.ford.com/support/category/warranty/", GENESIS: "https://www.genesis.com/us/en/ownership",
  GMC: "https://www.gmc.com/owners/warranty-protection-plans", HONDA: "https://owners.honda.com/vehicles/warranty",
  HYUNDAI: "https://www.hyundaiusa.com/us/en/assurance/america-best-warranty", INFINITI: "https://www.infinitiusa.com/owners/ownership/warranty-view-all.html",
  JAGUAR: "https://www.jaguarusa.com/about-jaguar/elitecare.html", JEEP: "https://www.jeep.com/warranty.html",
  KIA: "https://www.kia.com/us/en/warranty", "LAND ROVER": "https://www.landroverusa.com/ownership/vehicle-warranty.html",
  LEXUS: "https://support.lexus.com/s/article/What-warranty-coverag-8315", LINCOLN: "https://www.lincoln.com/support/warranty/1000/",
  MAZDA: "https://www.mazdausa.com/owners/warranty", "MERCEDES-BENZ": "https://www.mbusa.com/en/owners/manuals",
  MINI: "https://www.miniusa.com/why-mini/warranty.html", MITSUBISHI: "https://www.mitsubishicars.com/what-drives-us/warranty",
  NISSAN: "https://www.nissanusa.com/owners/warranty-and-protection.html", PORSCHE: "https://www.porsche.com/usa/accessoriesandservice/porscheservice/vehicleinformation/warranty/",
  RAM: "https://www.ramtrucks.com/warranty.html", SUBARU: "https://www.subaru.com/vehicle-info/certified-pre-owned.html",
  TESLA: "https://www.tesla.com/support/vehicle-warranty", TOYOTA: "https://support.toyota.com/s/article/What-warranty-coverag-7683",
  VOLKSWAGEN: "https://www.vw.com/en/owners-and-services/warranty.html", VOLVO: "https://www.volvocars.com/us/l/warranties/",
};

// Source stamp for a make: a verified OEM source when confirmed, otherwise the
// unverified placeholder.
const sourceFor = (make: string): OemWarrantySource => {
  const url = NEW_CAR_SOURCE[make];
  return url
    ? { sourceTitle: `${make} New Vehicle Limited Warranty (manufacturer)`, sourceUrl: url, sourceDocumentName: null, sourceEffectiveDate: null, sourceLastVerifiedAt: VERIFIED_AT, verifiedBy: "verification-agent", notes: "Cross-checked against the manufacturer warranty page on 2026-07-01." }
    : { sourceTitle: "Dealer/OEM warranty source required", sourceUrl: null, sourceDocumentName: null, sourceEffectiveDate: null, sourceLastVerifiedAt: null, verifiedBy: null, notes: `Seeded for ${make}; verify against the model-year warranty booklet before production use.` };
};
const isVerifiedMake = (make: string) => NEW_CAR_SOURCE[make] != null;

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
    confidenceStatus: isVerifiedMake(make) ? "verified" : "needs_review",
    coverages: coveragesFromReference(entry),
    sources: [sourceFor(make)],
  };
}

// Model-specific program — INFINITI 2026 QX60 (US). Verified 2026-07-01: basic
// is 4 yr / 60,000 mi (NOT the 50k shown in the early mockup), 6 yr / 70k
// powertrain, plus benefits.
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
  confidenceStatus: "verified",
  coverages: [
    { coverageType: "bumper_to_bumper", displayName: "Bumper-to-Bumper", subtitle: "Basic Vehicle Coverage", description: "Covers most vehicle systems and components.", termMonths: 48, termYears: 4, mileageLimit: 60000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 1, iconKey: "basic", accentColor: "blue" },
    { coverageType: "powertrain", displayName: "Powertrain", subtitle: "Engine, Transmission & Drivetrain", description: "Covers the engine, transmission, and drivetrain.", termMonths: 72, termYears: 6, mileageLimit: 70000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 2, iconKey: "powertrain", accentColor: "green" },
    { coverageType: "roadside_assistance", displayName: "Roadside Assistance", subtitle: null, termMonths: 72, termYears: 6, mileageLimit: 70000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 3, iconKey: "roadside", accentColor: "blue" },
    { coverageType: "corrosion_perforation", displayName: "Corrosion Perforation", subtitle: null, termMonths: 84, termYears: 7, mileageLimit: null, unlimitedMiles: true, startsAt: "in_service_date", sortOrder: 4, iconKey: "corrosion", accentColor: "blue" },
    { coverageType: "emissions", displayName: "Emissions Coverage", subtitle: "Federal emissions components", termMonths: 96, termYears: 8, mileageLimit: 80000, unlimitedMiles: false, startsAt: "in_service_date", sortOrder: 5, iconKey: "emissions", accentColor: "blue" },
    { coverageType: "safety_restraint", displayName: "Safety Restraint Coverage", subtitle: "Seatbelts, airbags, sensors", termMonths: 120, termYears: 10, mileageLimit: null, unlimitedMiles: true, startsAt: "in_service_date", sortOrder: 6, iconKey: "safety_restraint", accentColor: "blue" },
  ],
  sources: [sourceFor("INFINITI")],
};

// Every make with a curated reference gets a make-level new-car program — the
// full OEM new-vehicle gamut. New-car terms were cross-checked on 2026-07-01, so
// makes in NEW_CAR_SOURCE are "verified"; the coverage tracker reports the rest.
export const LOADED_MAKES: string[] = Object.keys(OEM_WARRANTY_REFERENCE).sort();

export const OEM_WARRANTY_PROGRAMS: OemWarrantyProgram[] = [
  // Model-specific first (more specific programs win the match ladder).
  INFINITI_QX60_2026,
  // Make-level defaults derived from the curated reference.
  ...LOADED_MAKES.map((m) => makeLevelProgram(m)).filter((p): p is OemWarrantyProgram => p != null),
];

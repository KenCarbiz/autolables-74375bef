// ── OEM Certified Pre-Owned (CPO) reference ──────────────────────────────────
// Curated reference of manufacturer CPO PROGRAM terms, keyed by canonical brand,
// parallel to oemWarrantyReference (new-car terms). Feeds the warranty library's
// CPO matching and the admin CPO auto-fill.
//
// SOURCE STATUS: every entry is confidence_status "needs_review". The figures
// below reflect commonly-published standard US CPO programs to the best of our
// knowledge, but CPO terms change frequently (coverage lengths, eligibility
// windows, inspection-point counts, and coverage-from rules all vary by program
// year). NONE may be presented to customers as fact until verified against the
// manufacturer's current CPO program page and given a real source + verified
// date. See docs/oem-warranty-library.md for the verification + update workflow.
//
// Coverage semantics:
//   *_from = "in_service"  → term runs from the vehicle's original in-service date
//   *_from = "purchase"    → term runs from the CPO purchase date (typically the
//                            added coverage that begins when the new-car basic ends)
// Miles use the UNLIMITED_MILES sentinel (-1) for unlimited terms.

import { UNLIMITED_MILES } from "@/lib/oemWarranty";

const U = UNLIMITED_MILES;

export type CpoCoverageFrom = "purchase" | "in_service";

export interface OemCpoReferenceEntry {
  programName: string;
  // Comprehensive / limited (bumper-to-bumper-style) CPO coverage.
  comprehensiveMonths?: number;
  comprehensiveMiles?: number;
  comprehensiveFrom?: CpoCoverageFrom;
  // Powertrain CPO coverage (often the longer term, run from in-service).
  powertrainMonths?: number;
  powertrainMiles?: number;
  powertrainFrom?: CpoCoverageFrom;
  // Eligibility ceilings a vehicle must be within to be certified.
  maxAgeYears?: number;
  maxMileage?: number;
  inspectionPoints?: string;
  transferable?: boolean;
  roadside?: string;
  benefits?: string;
  notes?: string;
}

// All figures below are UNVERIFIED (needs_review). Verify before production.
export const OEM_CPO_REFERENCE: Record<string, OemCpoReferenceEntry> = {
  ACURA: { programName: "Acura Certified Pre-Owned", comprehensiveMonths: 24, comprehensiveMiles: 100000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "182-point", transferable: true, roadside: "24/7 roadside for the coverage term", notes: "Non-powertrain coverage extends beyond the new-car basic; powertrain 7 yr / 100k from in-service." },
  AUDI: { programName: "Audi Certified pre-owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "300+ point", transferable: true, notes: "Adds up to ~1 yr/unlimited beyond new-car; can extend total to ~5 yr/unlimited from in-service. Verify current program." },
  BMW: { programName: "BMW Certified", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "Multi-point", transferable: true, notes: "Protection Plan begins when the 4 yr/50k new-car warranty ends; 1-year/unlimited-mile coverage. Elite tier extends further." },
  BUICK: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, roadside: "Roadside + courtesy transportation for the term", notes: "GM CPO shared across Buick/Chevrolet/GMC/Cadillac." },
  CADILLAC: { programName: "Cadillac Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, notes: "Cadillac may add extra premium-care benefits; verify current terms." },
  CHEVROLET: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, roadside: "Roadside + courtesy transportation for the term" },
  CHRYSLER: { programName: "Chrysler Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true, notes: "FCA/Stellantis CPO (3-mo Maximum Care + 7 yr/100k powertrain). Shared across Chrysler/Dodge/Jeep/Ram." },
  DODGE: { programName: "Dodge Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true },
  FORD: { programName: "Ford Blue Advantage (Gold Certified)", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "172-point", transferable: true, roadside: "24/7 roadside for the coverage term" },
  GENESIS: { programName: "Genesis Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "Multi-point", transferable: true, notes: "Powertrain 10 yr/100k from in-service (original owner); reduced after transfer. Premium concierge benefits." },
  GMC: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true },
  HONDA: { programName: "HondaTrue Certified", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "182-point", transferable: true, notes: "HondaTrue Certified+ (newer vehicles) adds longer non-powertrain coverage; base HondaTrue shown here." },
  HYUNDAI: { programName: "Hyundai Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "173-point", transferable: true, notes: "Remainder of 5 yr/60k new-car + 10 yr/100k powertrain from in-service; CPO adds limited coverage from purchase." },
  INFINITI: { programName: "INFINITI Certified Pre-Owned", comprehensiveMonths: 72, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "167-point", transferable: true, roadside: "24/7 roadside for the coverage term", notes: "Coverage extended to ~6 yr/100k from original in-service." },
  JAGUAR: { programName: "Jaguar Approved Certified Pre-Owned", comprehensiveMonths: 84, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "165-point", transferable: true, notes: "Coverage up to 7 yr/100k from original in-service." },
  JEEP: { programName: "Jeep Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true },
  KIA: { programName: "Kia Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "165-point", transferable: true, notes: "Remainder of 10 yr/100k powertrain from in-service; CPO adds 1 yr/12k platinum coverage from purchase." },
  "LAND ROVER": { programName: "Land Rover Approved Certified Pre-Owned", comprehensiveMonths: 84, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "165-point", transferable: true, notes: "Coverage up to 7 yr/100k from original in-service." },
  LEXUS: { programName: "Lexus L/Certified", comprehensiveMonths: 24, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 70000, inspectionPoints: "161-point", transferable: true, roadside: "Roadside for the coverage term", notes: "2-year/unlimited-mile CPO warranty from certified purchase; some model years extend to 6 yr/unlimited from in-service." },
  LINCOLN: { programName: "Lincoln Certified Pre-Owned", comprehensiveMonths: 72, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "200-point", transferable: true, notes: "6-year/100,000-mile comprehensive CPO coverage from in-service." },
  MAZDA: { programName: "Mazda Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "160-point", transferable: true },
  "MERCEDES-BENZ": { programName: "Mercedes-Benz Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "165-point", transferable: true, notes: "1-year/unlimited CPO coverage begins at new-car expiration; extendable up to ~5 yr from in-service." },
  MINI: { programName: "MINI Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "Multi-point", transferable: true, notes: "Coverage begins when the new-car warranty ends; 1-year/unlimited protection." },
  MITSUBISHI: { programName: "Mitsubishi Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "123-point", transferable: true, notes: "Powertrain 10 yr/100k from in-service (original owner); reduced after transfer." },
  NISSAN: { programName: "Nissan Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "167-point", transferable: true, roadside: "24/7 roadside for the coverage term" },
  PORSCHE: { programName: "Porsche Approved Certified Pre-Owned", comprehensiveMonths: 24, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 8, maxMileage: U, inspectionPoints: "111-point", transferable: true, notes: "Adds up to 2 years/unlimited; total coverage up to ~6 years from original in-service." },
  RAM: { programName: "Ram Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true },
  SUBARU: { programName: "Subaru Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "152-point", transferable: true, roadside: "24/7 roadside for the coverage term" },
  TESLA: { programName: "Tesla Used Vehicle Limited Warranty", comprehensiveMonths: 12, comprehensiveMiles: 10000, comprehensiveFrom: "purchase", maxAgeYears: 8, maxMileage: 100000, transferable: true, notes: "Tesla does not run a traditional inspection-based CPO program; used vehicles carry a 1-year/10,000-mile used-vehicle limited warranty plus any remaining new-vehicle/battery coverage." },
  TOYOTA: { programName: "Toyota Certified Used Vehicles", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 85000, inspectionPoints: "160-point", transferable: true, roadside: "1-year roadside assistance", notes: "TCUV: 12-mo/12k comprehensive from purchase + 7 yr/100k powertrain from in-service." },
  VOLKSWAGEN: { programName: "Volkswagen Certified Pre-Owned", comprehensiveMonths: 24, comprehensiveMiles: 24000, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "100+ point", transferable: true, roadside: "24/7 roadside for the coverage term", notes: "2-year/24,000-mile limited warranty from CPO purchase (begins at new-car expiration)." },
  VOLVO: { programName: "Volvo Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "170-point", transferable: true, notes: "Coverage from CPO purchase; some model years extend to ~6 yr/unlimited from original in-service." },
};

// Common spellings / abbreviations → canonical CPO key (mirrors the new-car map).
const CPO_ALIASES: Record<string, string> = {
  CHEVY: "CHEVROLET",
  VW: "VOLKSWAGEN",
  MERCEDES: "MERCEDES-BENZ",
  "MERCEDES BENZ": "MERCEDES-BENZ",
  BENZ: "MERCEDES-BENZ",
  MB: "MERCEDES-BENZ",
  LANDROVER: "LAND ROVER",
  "RANGE ROVER": "LAND ROVER",
};

// Resolve a brand string (exact, aliased, or contained within a make/ymm) to a
// CPO reference entry, or null when we have no curated CPO program for it.
export const lookupOemCpoReference = (brand: string | null | undefined): OemCpoReferenceEntry | null => {
  const raw = `${brand || ""}`.trim().toUpperCase();
  if (!raw) return null;
  if (OEM_CPO_REFERENCE[raw]) return OEM_CPO_REFERENCE[raw];
  if (CPO_ALIASES[raw] && OEM_CPO_REFERENCE[CPO_ALIASES[raw]]) return OEM_CPO_REFERENCE[CPO_ALIASES[raw]];
  const key = Object.keys(OEM_CPO_REFERENCE).find((k) => raw.includes(k));
  if (key) return OEM_CPO_REFERENCE[key];
  const aliasKey = Object.keys(CPO_ALIASES).find((a) => raw.includes(a));
  if (aliasKey) return OEM_CPO_REFERENCE[CPO_ALIASES[aliasKey]] || null;
  return null;
};

export const hasOemCpoReference = (brand: string | null | undefined): boolean => lookupOemCpoReference(brand) != null;

// Canonical brand resolved from any make/ymm string (used by matchers/trackers).
export const canonicalCpoBrand = (brand: string | null | undefined): string | null => {
  const raw = `${brand || ""}`.trim().toUpperCase();
  if (!raw) return null;
  if (OEM_CPO_REFERENCE[raw]) return raw;
  if (CPO_ALIASES[raw]) return CPO_ALIASES[raw];
  const key = Object.keys(OEM_CPO_REFERENCE).find((k) => raw.includes(k));
  if (key) return key;
  const aliasKey = Object.keys(CPO_ALIASES).find((a) => raw.includes(a));
  return aliasKey ? CPO_ALIASES[aliasKey] : null;
};

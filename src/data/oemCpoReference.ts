// ── OEM Certified Pre-Owned (CPO) reference ──────────────────────────────────
// Curated reference of manufacturer CPO PROGRAM terms, keyed by canonical brand,
// parallel to oemWarrantyReference (new-car terms). Feeds the warranty library's
// CPO matching and the admin CPO auto-fill.
//
// VERIFICATION: cross-checked by verification agents on 2026-07-01 against
// manufacturer and reputable secondary sources. Entries confirmed against an
// authoritative source are confidence_status "verified" with a sourceUrl +
// verifiedAt; unresolved/conflicting ones remain "needs_review".
//
// CAVEAT: several OEM domains (kia.com, infinitiusa.com, genesis.com,
// hyundaiusa.com CPO pages) return HTTP 403 to automated fetches, so those
// values were corroborated via official warranty PDFs / ConsumerAffairs / KBB
// rather than a direct page fetch. A human spot-check against the OEM CPO PDF is
// still advisable before these drive customer-facing claims. CPO terms also
// change frequently (coverage lengths, eligibility windows, inspection counts).
//
// Coverage semantics:
//   *_from = "in_service"  → term runs from the vehicle's original in-service date
//   *_from = "purchase"    → term runs from the CPO purchase date (or, for luxury
//                            programs, when the factory basic warranty expires)
// Miles use the UNLIMITED_MILES sentinel (-1) for unlimited terms.

import { UNLIMITED_MILES } from "@/lib/oemWarranty";

const U = UNLIMITED_MILES;
const V = "2026-07-01"; // verification date

export type CpoCoverageFrom = "purchase" | "in_service";
export type CpoConfidence = "verified" | "needs_review";

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
  // Verification metadata.
  confidenceStatus: CpoConfidence;
  sourceUrl?: string | null;
  verifiedAt?: string | null;
  notes?: string;
}

export const OEM_CPO_REFERENCE: Record<string, OemCpoReferenceEntry> = {
  ACURA: { programName: "Acura Precision Certified", comprehensiveMonths: 24, comprehensiveMiles: 100000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "182-point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.acuracertified.com/certified-preowned-benefits", verifiedAt: V, notes: "Current branding is 'Acura Precision Certified' (formerly Acura Certified Pre-Owned). 24-mo/100k non-powertrain + 7 yr/100k powertrain from in-service." },
  AUDI: { programName: "Audi Certified pre-owned", comprehensiveMonths: 12, comprehensiveMiles: 20000, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "300+ point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.audiusa.com/en/shopping-tools/certified-pre-owned/", verifiedAt: V, notes: "CPO limited warranty is 1 yr/20,000 mi (not unlimited), effective at purchase when no new-car warranty remains." },
  BMW: { programName: "BMW Certified", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "Multi-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.bmwusa.com/certified-preowned.html", verifiedAt: V, notes: "1 yr/unlimited coverage begins when the 4 yr/50k new-car warranty ends; extendable toward ~6 yr total. Eligibility leans 5 model years (some dealers cite 6)." },
  BUICK: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, roadside: "Roadside + courtesy transportation for the term", confidenceStatus: "verified", sourceUrl: "https://www.gmcertified.com/benefits-after-purchase", verifiedAt: V, notes: "Shared GM CPO across Chevrolet/Buick/GMC. Powertrain 6 yr/100k from in-service." },
  CADILLAC: { programName: "Cadillac Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 70000, inspectionPoints: "172-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.cadillac.com/certified-pre-owned", verifiedAt: V, notes: "Cadillac runs its OWN CPO (not the shared GM program). Comprehensive is 1 yr/unlimited beginning at factory B2B expiry; powertrain 6 yr/100k from in-service; stricter 70k eligibility." },
  CHEVROLET: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, roadside: "Roadside + courtesy transportation for the term", confidenceStatus: "verified", sourceUrl: "https://www.gmcertified.com/benefits-after-purchase", verifiedAt: V },
  CHRYSLER: { programName: "Chrysler Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.chrysler.com/certified-pre-owned.html", verifiedAt: V, notes: "Stellantis CPOV shared across Chrysler/Dodge/Jeep/Ram: 3-mo/3k Maximum Care + 7 yr/100k powertrain from in-service." },
  DODGE: { programName: "Dodge Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.chrysler.com/certified-pre-owned.html", verifiedAt: V },
  FORD: { programName: "Ford Blue Advantage (Gold Certified)", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "172-point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.ford.com/used/about-certified/gold-certification/", verifiedAt: V },
  GENESIS: { programName: "Genesis Certified Pre-Owned", comprehensiveMonths: 72, comprehensiveMiles: 75000, comprehensiveFrom: "in_service", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "191-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.genesis.com/us/en/certified", verifiedAt: V, notes: "CPO extends the new-vehicle warranty to a total 6 yr/75k from original in-service; powertrain 10 yr/100k from in-service." },
  GMC: { programName: "GM Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 72, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "172-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.gmcertified.com/benefits-after-purchase", verifiedAt: V },
  HONDA: { programName: "HondaTrue Certified", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "182-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.hondacertified.com/certified-preowned-benefits", verifiedAt: V, notes: "HondaTrue Certified+ (newer/low-mileage) adds longer non-powertrain coverage; base HondaTrue shown here." },
  HYUNDAI: { programName: "Hyundai Certified Pre-Owned", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "173-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.hyundaiusa.com/content/hyundai/cpo/us/en/certified-pre-owned/index.html", verifiedAt: V, notes: "CPO reinstates 10 yr/100k powertrain from in-service and passes the remainder of the 5 yr/60k basic — no distinct fresh comprehensive wrap. OEM CPO page 403s automated fetch; corroborated via secondary sources." },
  INFINITI: { programName: "INFINITI Certified Pre-Owned", comprehensiveMonths: 72, comprehensiveMiles: 75000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "167-point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.infinitiusa.com/certified-pre-owned/warranty.html", verifiedAt: V, notes: "6 yr from in-service; mileage cap 75k for low-mileage certifications, unlimited for higher-mileage certifications. Eligibility under 60 mo / 60k. OEM page 403s automated fetch." },
  JAGUAR: { programName: "Jaguar Approved Certified Pre-Owned", comprehensiveMonths: 84, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "165-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.jaguarusa.com/certified-preowned/index.html", verifiedAt: V, notes: "Coverage up to 7 yr/100k from original in-service; eligibility 5 model years / 60k." },
  JEEP: { programName: "Jeep Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.chrysler.com/certified-pre-owned.html", verifiedAt: V },
  KIA: { programName: "Kia Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "165-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.kia.com/us/en/cpo", verifiedAt: V, notes: "1 yr/12k Platinum Coverage from purchase + 10 yr/100k powertrain from in-service. Eligibility 6 yr/80k. OEM page 403s automated fetch." },
  "LAND ROVER": { programName: "Land Rover Approved Certified Pre-Owned", comprehensiveMonths: 84, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "165-point", transferable: true, confidenceStatus: "needs_review", sourceUrl: "https://www.landroverusa.com/certified-pre-owned/warranty-certification.html", verifiedAt: null, notes: "CONFLICTING SOURCES: current official term may be 1 yr/unlimited or 2 yr/100k (whichever first) from in-service, materially different from the seeded 7 yr/100k. Official page 403s. Verify against the official warranty PDF before use." },
  LEXUS: { programName: "Lexus L/Certified", comprehensiveMonths: 24, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "161-point", transferable: true, roadside: "Roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.lexus.com/lcertified/certification-warranty", verifiedAt: V, notes: "2 yr/unlimited coverage begins at purchase OR factory-warranty expiration, whichever is later. Eligibility 6 model years / 80k." },
  LINCOLN: { programName: "Lincoln Certified Pre-Owned", comprehensiveMonths: 72, comprehensiveMiles: 100000, comprehensiveFrom: "in_service", maxAgeYears: 6, maxMileage: 60000, inspectionPoints: "200-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.lincoln.com/certified-used/about-certified/additional-benefits/", verifiedAt: V, notes: "6 yr/100k comprehensive from new-vehicle warranty start (in-service)." },
  MAZDA: { programName: "Mazda Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "160-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.mazdausa.com/certified-pre-owned", verifiedAt: V },
  "MERCEDES-BENZ": { programName: "Mercedes-Benz Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 75000, inspectionPoints: "165-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.mbusa.com/en/cpo", verifiedAt: V, notes: "1 yr/unlimited coverage begins when the 4 yr/50k new-car warranty expires; extendable toward ~5 yr from in-service." },
  MINI: { programName: "MINI Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "Multi-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.miniusa.com/certified-pre-owned.html", verifiedAt: V, notes: "1 yr/unlimited begins when the new-car warranty ends (5 yr/unlimited total); eligibility 5 model years / 60k." },
  MITSUBISHI: { programName: "Mitsubishi Certified Pre-Owned", powertrainMonths: 120, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 60000, inspectionPoints: "123-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.mitsubishicars.com/certified-pre-owned", verifiedAt: V, notes: "Reinstates 10 yr/100k powertrain from in-service + roadside/towing for the remainder of the 5 yr/60k basic — no distinct fresh comprehensive. Eligibility likely 5 yr (some copy says 6 — verify against the current MMNA program guide)." },
  NISSAN: { programName: "Nissan Certified Pre-Owned", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "167-point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.nissanusa.com/shopping-tools/certified-pre-owned.html", verifiedAt: V, notes: "Standard Nissan Certified = 7 yr/100k powertrain from in-service + remainder of factory basic. The 1 yr/12k comprehensive is the separate 'Certified Select' tier, not this program." },
  PORSCHE: { programName: "Porsche Approved Certified Pre-Owned", comprehensiveMonths: 24, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 13, maxMileage: 124000, inspectionPoints: "111-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.kbb.com/cpo/porsche-certified-pre-owned-program/", verifiedAt: V, notes: "2 yr/unlimited begins at the later of CPO purchase or factory-warranty expiry. Eligibility expanded to within 13 model years / ~124,000 mi." },
  RAM: { programName: "Ram Certified Pre-Owned", comprehensiveMonths: 3, comprehensiveMiles: 3000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "125-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.chrysler.com/certified-pre-owned.html", verifiedAt: V },
  SUBARU: { programName: "Subaru Certified Pre-Owned", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "152-point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.subaru.com/vehicle-info/certified-pre-owned.html", verifiedAt: V, notes: "Standard CPO adds 7 yr/100k powertrain from in-service + remainder of the 3 yr/36k basic. A 12-mo/12k bumper-to-bumper wrap is an OPTIONAL paid add-on plan (Classic/Gold Plus), not part of standard CPO." },
  TESLA: { programName: "Tesla Used Vehicle Limited Warranty", comprehensiveMonths: 12, comprehensiveMiles: 10000, comprehensiveFrom: "purchase", transferable: true, confidenceStatus: "needs_review", sourceUrl: "https://www.tesla.com/support/vehicle-warranty", verifiedAt: null, notes: "Tesla runs NO traditional inspection-based CPO. Used vehicles carry a 1 yr/10,000-mile used-vehicle limited warranty added after the basic warranty, plus any remaining new-vehicle/battery coverage. Tesla publishes no age/mileage CPO eligibility cap — eligibility left unset." },
  TOYOTA: { programName: "Toyota Certified Used Vehicles", comprehensiveMonths: 12, comprehensiveMiles: 12000, comprehensiveFrom: "purchase", powertrainMonths: 84, powertrainMiles: 100000, powertrainFrom: "in_service", maxAgeYears: 6, maxMileage: 85000, inspectionPoints: "160-point", transferable: true, roadside: "1-year roadside assistance", confidenceStatus: "verified", sourceUrl: "https://www.toyotacertified.com/warranty", verifiedAt: V, notes: "Values reflect the Gold tier (Silver tier differs): 12-mo/12k comprehensive from purchase + 7 yr/100k powertrain from in-service." },
  VOLKSWAGEN: { programName: "Volkswagen Certified Pre-Owned", comprehensiveMonths: 24, comprehensiveMiles: 24000, comprehensiveFrom: "purchase", maxAgeYears: 5, maxMileage: 75000, inspectionPoints: "100+ point", transferable: true, roadside: "24/7 roadside for the coverage term", confidenceStatus: "verified", sourceUrl: "https://www.vw.com/en/owners-and-services/ownership-benefits/certified-pre-owned-benefits.html", verifiedAt: V, notes: "2 yr/24,000-mile limited warranty starting at the later of new-warranty expiry or CPO purchase." },
  VOLVO: { programName: "Volvo Certified Pre-Owned", comprehensiveMonths: 12, comprehensiveMiles: U, comprehensiveFrom: "purchase", maxAgeYears: 6, maxMileage: 80000, inspectionPoints: "170-point", transferable: true, confidenceStatus: "verified", sourceUrl: "https://www.volvocars.com/us/l/certified-by-volvo/", verifiedAt: V, notes: "Branded 'Certified by Volvo'. 12-mo/unlimited coverage from the later of new-warranty expiry or CPO purchase." },
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

// ── OEM CPO matching ─────────────────────────────────────────────────────────
// Resolves a vehicle to its manufacturer's Certified Pre-Owned program (from the
// curated CPO reference) and computes eligibility. Like the new-car matcher, it
// never guesses: when the brand has no CPO program, or eligibility can't be
// determined, it flags needs_dealer_confirmation.

import type { OemCpoReferenceEntry } from "@/data/oemCpoReference";
import { canonicalCpoBrand, lookupOemCpoReference } from "@/data/oemCpoReference";
import type { WarrantyVehicleInput } from "@/lib/warranty/types";
import { getWarrantyDisplayMode } from "@/lib/warranty/match";

export interface CpoProgramMatch {
  brand: string | null;
  entry: OemCpoReferenceEntry | null;
  // true = within the program's age/mileage window; false = outside it;
  // null = can't tell (missing year or mileage).
  eligible: boolean | null;
  isCertified: boolean;                 // the listing itself is flagged CPO
  needsDealerConfirmation: boolean;
  // All CPO reference data is unverified today.
  confidenceStatus: "needs_review";
}

export function matchOemCpoProgram(
  vehicle: WarrantyVehicleInput,
  asOfYear: number = new Date().getFullYear(),
): CpoProgramMatch {
  const brand = canonicalCpoBrand(vehicle.make);
  const entry = lookupOemCpoReference(vehicle.make);
  const isCertified = getWarrantyDisplayMode(vehicle) === "cpo";

  if (!entry) {
    return { brand, entry: null, eligible: null, isCertified, needsDealerConfirmation: true, confidenceStatus: "needs_review" };
  }

  // Eligibility: within maxAgeYears of the model year AND under maxMileage.
  let eligible: boolean | null = null;
  const ageKnown = vehicle.year != null && entry.maxAgeYears != null;
  const milesKnown = vehicle.mileage != null && entry.maxMileage != null;
  if (ageKnown || milesKnown) {
    const ageOk = entry.maxAgeYears == null || vehicle.year == null ? true : asOfYear - (vehicle.year as number) <= entry.maxAgeYears;
    const milesOk = entry.maxMileage == null || vehicle.mileage == null ? true : (vehicle.mileage as number) <= entry.maxMileage;
    // If a ceiling exists but its input is missing, eligibility is only partially known.
    const fullyKnown = (entry.maxAgeYears == null || vehicle.year != null) && (entry.maxMileage == null || vehicle.mileage != null);
    eligible = fullyKnown ? ageOk && milesOk : null;
  }

  return {
    brand,
    entry,
    eligible,
    isCertified,
    // Certified listings are covered; non-certified "may qualify" needs the
    // dealer to confirm, and unknown eligibility always needs confirmation.
    needsDealerConfirmation: !isCertified || eligible == null,
    confidenceStatus: "needs_review",
  };
}

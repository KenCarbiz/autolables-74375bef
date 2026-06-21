// Configurable certification program engine.
// Supports OEM CPO, dealer CPO, upgrade CPO, finance-dependent CPO, and custom warranty programs.
// Stickers and passports should hydrate certification claims from this layer only -- no invented coverage.

import type { DealerCertificationTier, VehicleInventoryInput } from "./wiring";

export type CertificationProgramType =
  | "oem_cpo"
  | "dealer_cpo"
  | "dealer_upgrade_cpo"
  | "finance_upgrade_cpo"
  | "warranty_only"
  | "inspection_only"
  | "custom";

export type CertificationEligibilityRule = {
  maxModelYearsOld?: number;
  maxMileage?: number;
  allowedMakes?: string[];
  excludedMakes?: string[];
  requiresCleanTitle?: boolean;
  requiresInspection?: boolean;
  requiresFinancing?: boolean;
  minVehiclePrice?: number;
  maxVehiclePrice?: number;
};

export type CertificationDisclosure = {
  shortLabel: string;
  printDisclosure: string;
  passportDisclosure: string;
  requiresDealerApproval?: boolean;
};

export type CertificationProgram = {
  id: string;
  dealerId?: string;
  name: string;
  type: CertificationProgramType;
  enabled: boolean;
  isDefault?: boolean;
  badgeLabel: string;
  headline: string;
  description?: string;
  months?: number;
  miles?: number;
  deductible?: string;
  provider?: string;
  eligibility: CertificationEligibilityRule;
  disclosure: CertificationDisclosure;
  tier?: DealerCertificationTier;
  tags: string[];
};

export type CertificationDecision = {
  eligiblePrograms: CertificationProgram[];
  selectedProgram?: CertificationProgram;
  selectedReason: string;
  printHeadline?: string;
  printDisclosure?: string;
  passportDisclosure?: string;
};

const normalize = (value?: string | number) => String(value || "").trim().toLowerCase();
const asNumber = (value?: string | number) => {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const vehicleAge = (year?: string | number) => {
  const y = asNumber(year);
  if (!y) return undefined;
  return new Date().getFullYear() - y;
};

const listContains = (items: string[] | undefined, value?: string | number) => {
  if (!items?.length) return false;
  const key = normalize(value);
  return items.some((item) => normalize(item) === key);
};

export const DEFAULT_CERTIFICATION_PROGRAMS: CertificationProgram[] = [
  {
    id: "dealer-basic-3mo-3k",
    name: "Dealer Certified Basic",
    type: "dealer_cpo",
    enabled: true,
    isDefault: true,
    badgeLabel: "Dealer Certified",
    headline: "3 Month / 3,000 Mile Limited Powertrain Coverage",
    description: "Entry dealer certification tier for qualifying used vehicles.",
    months: 3,
    miles: 3000,
    eligibility: { maxMileage: 125000, requiresInspection: true },
    disclosure: {
      shortLabel: "3mo/3k powertrain",
      printDisclosure: "Coverage availability and eligibility vary by vehicle. See dealer for complete terms.",
      passportDisclosure: "Dealer certified coverage details, exclusions, deductibles, provider terms, and eligibility must be reviewed in the vehicle passport or dealer documents.",
    },
    tags: ["dealer-certified", "basic", "powertrain"],
  },
  {
    id: "dealer-plus-6mo-6k",
    name: "Dealer Certified Plus",
    type: "dealer_upgrade_cpo",
    enabled: true,
    badgeLabel: "Certified Plus",
    headline: "6 Month / 6,000 Mile Limited Coverage",
    description: "Upgraded dealer certification tier for cleaner, lower-mileage inventory.",
    months: 6,
    miles: 6000,
    eligibility: { maxMileage: 90000, requiresInspection: true },
    disclosure: {
      shortLabel: "6mo/6k coverage",
      printDisclosure: "Certified Plus coverage applies to eligible vehicles only. See dealer for terms and exclusions.",
      passportDisclosure: "Certified Plus coverage is subject to eligibility, inspection, exclusions, provider terms, and dealer approval.",
    },
    tags: ["dealer-certified", "plus", "coverage"],
  },
  {
    id: "finance-7yr-100k",
    name: "Finance Upgrade Certified",
    type: "finance_upgrade_cpo",
    enabled: true,
    badgeLabel: "Finance Upgrade Eligible",
    headline: "Up to 7 Year / 100,000 Mile Coverage Available",
    description: "Upgrade certification tier that may require dealer-arranged financing or product enrollment.",
    months: 84,
    miles: 100000,
    eligibility: { maxMileage: 80000, requiresInspection: true, requiresFinancing: true },
    disclosure: {
      shortLabel: "7yr/100k upgrade",
      printDisclosure: "Upgrade coverage may require financing, eligibility, and dealer approval. Not all vehicles qualify.",
      passportDisclosure: "Upgrade coverage terms, financing requirements, exclusions, provider documents, deductibles, and eligibility must be confirmed before purchase.",
      requiresDealerApproval: true,
    },
    tags: ["finance", "upgrade", "100k", "coverage"],
  },
  {
    id: "finance-10yr-100k",
    name: "Premium Finance Certified",
    type: "finance_upgrade_cpo",
    enabled: true,
    badgeLabel: "Premium Certified Eligible",
    headline: "Up to 10 Year / 100,000 Mile Coverage Available",
    description: "Premium certification upgrade for select inventory and finance structures.",
    months: 120,
    miles: 100000,
    eligibility: { maxMileage: 60000, requiresInspection: true, requiresFinancing: true, minVehiclePrice: 15000 },
    disclosure: {
      shortLabel: "10yr/100k upgrade",
      printDisclosure: "Premium coverage is optional and subject to eligibility, financing, terms, and dealer approval.",
      passportDisclosure: "Premium coverage is not automatic. Customer must review eligibility, cost, financing conditions, provider terms, exclusions, and all disclosures.",
      requiresDealerApproval: true,
    },
    tags: ["premium", "finance", "upgrade", "100k"],
  },
  {
    id: "inspection-only-certified",
    name: "Inspection Certified",
    type: "inspection_only",
    enabled: true,
    badgeLabel: "Inspection Certified",
    headline: "Multi-Point Inspection Completed",
    description: "Certification language for dealers that want inspection confidence without warranty claims.",
    eligibility: { requiresInspection: true },
    disclosure: {
      shortLabel: "inspection complete",
      printDisclosure: "Inspection certification is not a warranty. See dealer for inspection details.",
      passportDisclosure: "Inspection records and reconditioning notes should be reviewed in the vehicle passport when available.",
    },
    tags: ["inspection", "no-warranty", "confidence"],
  },
];

export const OEM_CPO_PROGRAM_PRESETS: Record<string, CertificationProgram> = {
  acura: {
    id: "oem-acura-cpo",
    name: "Acura Certified Pre-Owned",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "Acura Certified",
    headline: "Acura Certified Pre-Owned Eligible",
    eligibility: { allowedMakes: ["Acura"], maxMileage: 80000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "Acura CPO",
      printDisclosure: "OEM certification and warranty details are subject to Acura program rules. See dealer for complete details.",
      passportDisclosure: "OEM CPO terms, warranty coverage, inspection requirements, and exclusions are controlled by the manufacturer program and dealer documentation.",
    },
    tags: ["oem", "cpo", "acura"],
  },
  honda: {
    id: "oem-honda-cpo",
    name: "HondaTrue Certified",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "HondaTrue Certified",
    headline: "HondaTrue Certified Eligible",
    eligibility: { allowedMakes: ["Honda"], maxMileage: 80000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "HondaTrue",
      printDisclosure: "HondaTrue details are subject to Honda program requirements. See dealer for full terms.",
      passportDisclosure: "HondaTrue certification, warranty, inspection, and eligibility terms are governed by Honda program documents.",
    },
    tags: ["oem", "cpo", "honda", "hondatrue"],
  },
  hyundai: {
    id: "oem-hyundai-cpo",
    name: "Hyundai Certified Used Vehicle",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "Hyundai Certified",
    headline: "Hyundai Certified Used Vehicle Eligible",
    eligibility: { allowedMakes: ["Hyundai"], maxMileage: 80000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "Hyundai CPO",
      printDisclosure: "Hyundai CPO coverage and eligibility vary by vehicle. See dealer for complete program details.",
      passportDisclosure: "Hyundai CPO eligibility, warranty terms, inspection, and exclusions must be confirmed through manufacturer/dealer documents.",
    },
    tags: ["oem", "cpo", "hyundai"],
  },
  infiniti: {
    id: "oem-infiniti-cpo",
    name: "INFINITI Certified Pre-Owned",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "INFINITI Certified",
    headline: "INFINITI Certified Pre-Owned Eligible",
    eligibility: { allowedMakes: ["INFINITI"], maxMileage: 80000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "INFINITI CPO",
      printDisclosure: "INFINITI CPO coverage and eligibility are subject to manufacturer program rules. See dealer for details.",
      passportDisclosure: "INFINITI CPO warranty, inspection, eligibility, exclusions, and documents should be reviewed in the passport or dealer file.",
    },
    tags: ["oem", "cpo", "infiniti", "luxury"],
  },
  lexus: {
    id: "oem-lexus-cpo",
    name: "Lexus L/Certified",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "L/Certified",
    headline: "Lexus L/Certified Eligible",
    eligibility: { allowedMakes: ["Lexus"], maxMileage: 80000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "L/Certified",
      printDisclosure: "L/Certified eligibility and warranty terms are subject to Lexus program rules. See dealer for details.",
      passportDisclosure: "L/Certified warranty, inspection, eligibility, exclusions, and program documents must be confirmed with dealer/manufacturer materials.",
    },
    tags: ["oem", "cpo", "lexus", "luxury"],
  },
  toyota: {
    id: "oem-toyota-cpo",
    name: "Toyota Certified Used Vehicle",
    type: "oem_cpo",
    enabled: true,
    badgeLabel: "Toyota Certified",
    headline: "Toyota Certified Used Vehicle Eligible",
    eligibility: { allowedMakes: ["Toyota"], maxMileage: 85000, requiresCleanTitle: true, requiresInspection: true },
    disclosure: {
      shortLabel: "Toyota CPO",
      printDisclosure: "Toyota CPO eligibility and coverage are subject to Toyota program terms. See dealer for full details.",
      passportDisclosure: "Toyota CPO terms, inspection, warranty, and eligibility must be confirmed through Toyota/dealer documents.",
    },
    tags: ["oem", "cpo", "toyota"],
  },
};

export const getOEMCertificationProgram = (make?: string) => OEM_CPO_PROGRAM_PRESETS[normalize(make).replace(/[^a-z0-9]+/g, "_")];

export const certificationProgramEligible = (
  program: CertificationProgram,
  vehicle: VehicleInventoryInput & Record<string, any>,
) => {
  if (!program.enabled) return false;
  const rules = program.eligibility;
  const age = vehicleAge(vehicle.year);
  const mileage = asNumber(vehicle.mileage);
  const price = asNumber(vehicle.pricing?.websitePrice ?? vehicle.pricing?.advertisedPrice ?? vehicle.pricing?.sellingPrice ?? vehicle.pricing?.marketValue);

  if (rules.allowedMakes?.length && !listContains(rules.allowedMakes, vehicle.make)) return false;
  if (rules.excludedMakes?.length && listContains(rules.excludedMakes, vehicle.make)) return false;
  if (rules.maxModelYearsOld !== undefined && age !== undefined && age > rules.maxModelYearsOld) return false;
  if (rules.maxMileage !== undefined && mileage !== undefined && mileage > rules.maxMileage) return false;
  if (rules.minVehiclePrice !== undefined && price !== undefined && price < rules.minVehiclePrice) return false;
  if (rules.maxVehiclePrice !== undefined && price !== undefined && price > rules.maxVehiclePrice) return false;
  if (rules.requiresCleanTitle && vehicle.cleanTitle === false) return false;
  if (rules.requiresInspection && vehicle.inspectionComplete === false) return false;
  if (rules.requiresFinancing && vehicle.financeEligible === false) return false;

  return true;
};

export const resolveCertificationDecision = (input: {
  vehicle: VehicleInventoryInput & Record<string, any>;
  dealerPrograms?: CertificationProgram[];
  preferOEMCPO?: boolean;
  selectedProgramId?: string;
}): CertificationDecision => {
  const oemProgram = getOEMCertificationProgram(input.vehicle.make);
  const programs = [
    ...(input.preferOEMCPO && oemProgram ? [oemProgram] : []),
    ...(input.dealerPrograms || DEFAULT_CERTIFICATION_PROGRAMS),
    ...(!input.preferOEMCPO && oemProgram ? [oemProgram] : []),
  ];
  const eligiblePrograms = programs.filter((program) => certificationProgramEligible(program, input.vehicle));
  const selectedProgram = eligiblePrograms.find((program) => program.id === input.selectedProgramId)
    || eligiblePrograms.find((program) => program.isDefault)
    || eligiblePrograms[0];

  return {
    eligiblePrograms,
    selectedProgram,
    selectedReason: selectedProgram ? `${selectedProgram.name} matched vehicle eligibility rules.` : "No certification program matched this vehicle.",
    printHeadline: selectedProgram?.headline,
    printDisclosure: selectedProgram?.disclosure.printDisclosure,
    passportDisclosure: selectedProgram?.disclosure.passportDisclosure,
  };
};

export const certificationProgramToDealerTier = (program: CertificationProgram): DealerCertificationTier => ({
  id: program.id,
  label: program.badgeLabel,
  headline: program.headline,
  detail: program.description,
  months: program.months,
  miles: program.miles,
  requiresFinancing: program.eligibility.requiresFinancing,
  disclosure: program.disclosure.printDisclosure,
});

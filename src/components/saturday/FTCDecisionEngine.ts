// FTC Buyers Guide decision engine.
// Connecticut-first launch, federal Buyers Guide foundation.
// Production launch must compare output to current official FTC PDF and final CT counsel guidance.

import { resolveUsedVehicleWarrantyCompliance, type UsedVehicleWarrantyRuleInput } from "./UsedVehicleWarrantyCompliance";
import { buildDefaultFTCBuyersGuideData, type FTCBuyersGuideData, type FTCWarrantyCoverageLine } from "./FTCBuyersGuide";
import { resolveBuyersGuideForm, type BuyersGuideForm } from "@/lib/buyersGuideForms";

export type FTCDecisionVehicleInput = {
  year: string | number;
  make: string;
  model: string;
  vin: string;
  stock?: string;
  mileage?: string | number;
  saleState: string;
  saleLanguage?: "english" | "spanish";
  manufacturerWarrantyStillApplies?: boolean;
};

export type FTCDecisionDealerInput = {
  name: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  contactNameOrPosition?: string;
  contactPhone?: string;
};

export type FTCDealerWarrantyProgramInput = {
  dealerOffersWrittenWarranty?: boolean;
  fullWarranty?: boolean;
  partsCoveragePercent?: number;
  laborCoveragePercent?: number;
  deductibleDisclosure?: string;
  warrantyTermLabel?: string;
  coverageLines?: FTCWarrantyCoverageLine[];
  serviceContractAvailable?: boolean;
};

export type FTCBuyersGuideDecision = {
  data: FTCBuyersGuideData;
  warrantyCompliance: ReturnType<typeof resolveUsedVehicleWarrantyCompliance>;
  decisionCode: "as_is" | "implied_only" | "limited_warranty" | "full_warranty" | "state_required_warranty";
  required: boolean;
  requiredForms: string[];
  reasons: string[];
  blockingWarnings: string[];
  counselReviewRequired: boolean;
  // Which official Buyers Guide document applies. For Maine and Wisconsin this
  // is their own state form (with an assetUrl to the official PDF) rather than
  // the federal FTC form; usesStateForm short-circuits the FTC data above.
  buyersGuideForm: BuyersGuideForm;
  usesStateForm: boolean;
};

const asNumber = (value?: string | number) => {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const vehicleAge = (year: string | number, currentYear = new Date().getFullYear()) => {
  const modelYear = asNumber(year);
  return modelYear ? currentYear - modelYear : undefined;
};

const defaultCoverageForStateWarranty = (term?: string): FTCWarrantyCoverageLine[] => [
  { system: "State-required used vehicle warranty", duration: term || "State-required term" },
  { system: "See dealer warranty document", duration: "Coverage/exclusions apply" },
];

export const buildFTCDecisionInputForCT = (input: {
  vehicle: FTCDecisionVehicleInput;
  dealerWarranty?: FTCDealerWarrantyProgramInput;
}): UsedVehicleWarrantyRuleInput => ({
  saleState: "CT",
  modelYear: asNumber(input.vehicle.year) || new Date().getFullYear(),
  mileage: asNumber(input.vehicle.mileage),
  saleLanguage: input.vehicle.saleLanguage,
  dealerOffersWrittenWarranty: input.dealerWarranty?.dealerOffersWrittenWarranty,
  dealerWarrantyType: input.dealerWarranty?.fullWarranty ? "full" : "limited",
  manufacturerWarrantyStillApplies: input.vehicle.manufacturerWarrantyStillApplies,
});

export const decideFTCBuyersGuide = (input: {
  vehicle: FTCDecisionVehicleInput;
  dealer: FTCDecisionDealerInput;
  dealerWarranty?: FTCDealerWarrantyProgramInput;
  buyerName?: string;
  currentYear?: number;
}): FTCBuyersGuideDecision => {
  const state = input.vehicle.saleState.toUpperCase();
  const currentYear = input.currentYear || new Date().getFullYear();
  const age = vehicleAge(input.vehicle.year, currentYear);
  // Maine and Wisconsin are exempt from the FTC rule and mandate their own
  // forms — the packet must pull the state PDF, not the federal Buyers Guide.
  const buyersGuideForm = resolveBuyersGuideForm(state);
  const usesStateForm = buyersGuideForm.authority === "state";
  const warrantyCompliance = resolveUsedVehicleWarrantyCompliance({
    saleState: state,
    modelYear: asNumber(input.vehicle.year) || currentYear,
    currentYear,
    mileage: asNumber(input.vehicle.mileage),
    saleLanguage: input.vehicle.saleLanguage,
    dealerOffersWrittenWarranty: input.dealerWarranty?.dealerOffersWrittenWarranty,
    dealerWarrantyType: input.dealerWarranty?.fullWarranty ? "full" : "limited",
    manufacturerWarrantyStillApplies: input.vehicle.manufacturerWarrantyStillApplies,
  });

  const stateRequiresWarranty = warrantyCompliance.disposition === "state_required_warranty";
  const dealerWrittenWarranty = Boolean(input.dealerWarranty?.dealerOffersWrittenWarranty || stateRequiresWarranty);
  const fullWarranty = Boolean(input.dealerWarranty?.fullWarranty || stateRequiresWarranty);
  const warrantyType = dealerWrittenWarranty ? (fullWarranty ? "full" : "limited") : "none";
  const decisionCode: FTCBuyersGuideDecision["decisionCode"] = stateRequiresWarranty
    ? "state_required_warranty"
    : warrantyType === "full"
      ? "full_warranty"
      : warrantyType === "limited"
        ? "limited_warranty"
        : warrantyCompliance.disposition === "as_is_no_dealer_warranty"
          ? "as_is"
          : "implied_only";

  const version = decisionCode === "as_is" ? "as_is_no_dealer_warranty" : "implied_warranties_only";
  const warrantyTermLabel = input.dealerWarranty?.warrantyTermLabel || warrantyCompliance.warrantyTermLabel;
  const coverageLines = input.dealerWarranty?.coverageLines?.length
    ? input.dealerWarranty.coverageLines
    : stateRequiresWarranty
      ? defaultCoverageForStateWarranty(warrantyTermLabel)
      : [];

  const reasons = [
    `Sale state: ${state}`,
    usesStateForm ? `${buyersGuideForm.formName} applies — ${state} is exempt from the FTC rule and mandates its own form.` : undefined,
    age !== undefined ? `Vehicle age: ${age} years` : "Vehicle age unavailable",
    `Warranty disposition: ${warrantyCompliance.disposition}`,
    stateRequiresWarranty ? "State-required warranty path selected." : undefined,
    input.dealerWarranty?.dealerOffersWrittenWarranty ? "Dealer-written warranty selected." : undefined,
    input.vehicle.manufacturerWarrantyStillApplies ? "Manufacturer warranty may still apply." : undefined,
  ].filter(Boolean) as string[];

  const blockingWarnings = [
    state !== "CT" ? "Connecticut-first launch: non-CT state rules are not verified for production." : undefined,
    warrantyCompliance.sourceStatus !== "verified_official" ? `Warranty rule status: ${warrantyCompliance.sourceStatus}. Counsel/official verification required.` : undefined,
    decisionCode === "full_warranty" && !stateRequiresWarranty && !input.dealerWarranty?.coverageLines?.length ? "Full warranty selected without detailed coverage lines." : undefined,
  ].filter(Boolean) as string[];

  const data = buildDefaultFTCBuyersGuideData({
    language: input.vehicle.saleLanguage || "english",
    version,
    warrantyType,
    vehicle: {
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      vin: input.vehicle.vin,
      stock: input.vehicle.stock,
    },
    dealer: input.dealer,
    buyer: { name: input.buyerName },
    partsCoveragePercent: input.dealerWarranty?.partsCoveragePercent ?? warrantyCompliance.partsAndLaborCoveragePercent ?? (stateRequiresWarranty ? 100 : 0),
    laborCoveragePercent: input.dealerWarranty?.laborCoveragePercent ?? warrantyCompliance.partsAndLaborCoveragePercent ?? (stateRequiresWarranty ? 100 : 0),
    deductibleDisclosure: input.dealerWarranty?.deductibleDisclosure,
    warrantyCoverageLines: coverageLines,
    manufacturerWarrantyStillApplies: input.vehicle.manufacturerWarrantyStillApplies,
    serviceContractAvailable: input.dealerWarranty?.serviceContractAvailable,
    stateLawNotes: warrantyCompliance.notes,
  });

  return {
    data,
    warrantyCompliance,
    decisionCode,
    required: true,
    // In Maine/Wisconsin the required document is the state form, not the FTC
    // one; elsewhere it is whatever the warranty rule requires.
    requiredForms: usesStateForm ? [buyersGuideForm.formName] : warrantyCompliance.requiredForms,
    reasons,
    blockingWarnings,
    counselReviewRequired: blockingWarnings.length > 0,
    buyersGuideForm,
    usesStateForm,
  };
};

export const CONNECTICUT_FTC_DECISION_EXAMPLES = [
  {
    label: "CT newer used vehicle with state-required warranty",
    vehicle: { saleState: "CT", year: new Date().getFullYear() - 3, make: "INFINITI", model: "QX60", vin: "SAMPLEVIN123", mileage: 42000 },
    expected: "state_required_warranty",
  },
  {
    label: "CT older used vehicle As-Is path",
    vehicle: { saleState: "CT", year: new Date().getFullYear() - 9, make: "Hyundai", model: "Elantra", vin: "SAMPLEVIN456", mileage: 128000 },
    expected: "as_is",
  },
];

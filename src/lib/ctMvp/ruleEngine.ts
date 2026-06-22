import type { CanonicalVehicle } from "@/lib/inventory/normalizeVehicle";

export type CtMvpVehicleInput = {
  vin: string;
  stock: string;
  year: string;
  make: string;
  model: string;
  mileage: string;
  state: string;
  condition: "new" | "used";
  cpoStatus: "none" | "dealer" | "oem";
  passportEnabled: boolean;
};

export type CtMvpDealerPreferences = {
  state?: string;
  requireFtcBuyersGuide?: boolean;
  requireK208?: boolean;
  autoSelectTemplates?: boolean;
  autoGeneratePassport?: boolean;
  defaultWindowTemplate?: string;
  defaultAddendumTemplate?: string;
  newWindowTemplate?: string;
  usedWindowTemplate?: string;
  dealerCpoTemplate?: string;
  oemCpoTemplate?: string;
  luxuryTemplate?: string;
  trustSourceLabel?: string;
  dealerProgramLabel?: string;
};

export type CtMvpRuleOutput = {
  selectedWindowSticker: string;
  selectedAddendum: string;
  ftcBuyersGuide: "required" | "not_required";
  k208: "required" | "not_required";
  passportStatus: "enabled" | "disabled";
  trustSource: string;
  dealerProgram: string;
  theme: string;
  checklist: { label: string; status: "pass" | "skip"; detail: string }[];
};

const luxuryMakes = new Set(["INFINITI", "ACURA", "AUDI", "BMW", "CADILLAC", "GENESIS", "LEXUS", "LINCOLN", "MERCEDES-BENZ", "PORSCHE", "VOLVO"]);

export const DEFAULT_CT_MVP_INPUT: CtMvpVehicleInput = {
  vin: "5N1DL1FS1RC334921",
  stock: "I24082A",
  year: "2024",
  make: "INFINITI",
  model: "QX60",
  mileage: "18426",
  state: "CT",
  condition: "used",
  cpoStatus: "dealer",
  passportEnabled: true,
};

export const DEFAULT_CT_MVP_DEALER_PREFERENCES: Required<CtMvpDealerPreferences> = {
  state: "CT",
  requireFtcBuyersGuide: true,
  requireK208: true,
  autoSelectTemplates: true,
  autoGeneratePassport: true,
  defaultWindowTemplate: "window-saturday-hero",
  defaultAddendumTemplate: "addendum-saturday-premium",
  newWindowTemplate: "new-car-sticker",
  usedWindowTemplate: "window-saturday-hero",
  dealerCpoTemplate: "window-saturday-hero",
  oemCpoTemplate: "window-saturday-hero",
  luxuryTemplate: "window-saturday-hero",
  trustSourceLabel: "Dealer review source + vehicle passport evidence",
  dealerProgramLabel: "Standard used vehicle",
};

const withDefaults = (preferences?: CtMvpDealerPreferences): Required<CtMvpDealerPreferences> => ({
  ...DEFAULT_CT_MVP_DEALER_PREFERENCES,
  ...(preferences || {}),
});

export function canonicalVehicleToCtMvpInput(vehicle: CanonicalVehicle, preferences?: CtMvpDealerPreferences): CtMvpVehicleInput {
  const dealer = withDefaults(preferences);
  return {
    vin: vehicle.vin,
    stock: vehicle.stock,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    mileage: vehicle.mileage,
    state: vehicle.state || dealer.state,
    condition: vehicle.condition,
    cpoStatus: vehicle.cpoStatus,
    passportEnabled: dealer.autoGeneratePassport,
  };
}

export function evaluateCtMvpRules(input: CtMvpVehicleInput, preferences?: CtMvpDealerPreferences): CtMvpRuleOutput {
  const dealer = withDefaults(preferences);
  const state = (input.state || dealer.state).trim().toUpperCase() || "CT";
  const make = input.make.trim().toUpperCase();
  const isUsed = input.condition === "used";
  const isCt = state === "CT" || state === "CONNECTICUT";
  const isLuxury = luxuryMakes.has(make);
  const isOemCpo = input.cpoStatus === "oem";
  const isDealerCpo = input.cpoStatus === "dealer";

  const baseWindowTemplate = input.condition === "new"
    ? dealer.newWindowTemplate
    : isOemCpo
      ? dealer.oemCpoTemplate
      : isDealerCpo
        ? dealer.dealerCpoTemplate
        : isLuxury
          ? dealer.luxuryTemplate
          : dealer.usedWindowTemplate;

  const selectedWindowSticker = input.condition === "new"
    ? baseWindowTemplate
    : isOemCpo
      ? `${baseWindowTemplate} + OEM CPO badge`
      : isDealerCpo
        ? `${baseWindowTemplate} + Dealer CPO badge`
        : baseWindowTemplate || dealer.defaultWindowTemplate;

  const selectedAddendum = input.condition === "new"
    ? "addendum-modern"
    : dealer.defaultAddendumTemplate;

  const ftcBuyersGuide = isUsed && isCt && dealer.requireFtcBuyersGuide ? "required" : "not_required";
  const k208 = isUsed && isCt && dealer.requireK208 ? "required" : "not_required";
  const passportStatus = input.passportEnabled && dealer.autoGeneratePassport ? "enabled" : "disabled";
  const trustSource = isOemCpo
    ? "OEM CPO program"
    : isDealerCpo
      ? "Dealer CPO / inspection program"
      : dealer.trustSourceLabel;
  const dealerProgram = isOemCpo ? "OEM CPO" : isDealerCpo ? "Dealer CPO" : dealer.dealerProgramLabel;
  const theme = isLuxury ? "Luxury theme" : "Standard AutoLabels theme";

  return {
    selectedWindowSticker,
    selectedAddendum,
    ftcBuyersGuide,
    k208,
    passportStatus,
    trustSource,
    dealerProgram,
    theme,
    checklist: [
      {
        label: "Vehicle normalized",
        status: input.vin && input.stock && input.year && input.make && input.model ? "pass" : "skip",
        detail: `${input.year || "Year pending"} ${input.make || "Make pending"} ${input.model || "Model pending"}`,
      },
      {
        label: "Dealer preferences loaded",
        status: preferences ? "pass" : "skip",
        detail: preferences ? "Using dealer-specific rule and template preferences" : "Using Connecticut MVP defaults",
      },
      {
        label: "Window sticker selected",
        status: dealer.autoSelectTemplates ? "pass" : "skip",
        detail: dealer.autoSelectTemplates ? selectedWindowSticker : "Auto-select templates disabled",
      },
      {
        label: "Addendum selected",
        status: "pass",
        detail: selectedAddendum,
      },
      {
        label: "FTC Buyers Guide",
        status: ftcBuyersGuide === "required" ? "pass" : "skip",
        detail: ftcBuyersGuide === "required" ? "Used + Connecticut requires FTC Buyers Guide" : "Not required for this test vehicle or dealer setting",
      },
      {
        label: "K208",
        status: k208 === "required" ? "pass" : "skip",
        detail: k208 === "required" ? "Used + Connecticut requires K208 flow" : "Not required for this test vehicle or dealer setting",
      },
      {
        label: "Passport",
        status: passportStatus === "enabled" ? "pass" : "skip",
        detail: passportStatus === "enabled" ? "Vehicle passport generated and linked by QR" : "Passport disabled by dealer setting",
      },
      {
        label: "Trust source",
        status: "pass",
        detail: trustSource,
      },
      {
        label: "Dealer program",
        status: "pass",
        detail: dealerProgram,
      },
    ],
  };
}

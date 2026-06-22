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

export function evaluateCtMvpRules(input: CtMvpVehicleInput): CtMvpRuleOutput {
  const state = input.state.trim().toUpperCase() || "CT";
  const make = input.make.trim().toUpperCase();
  const isUsed = input.condition === "used";
  const isCt = state === "CT" || state === "CONNECTICUT";
  const isLuxury = luxuryMakes.has(make);
  const isOemCpo = input.cpoStatus === "oem";
  const isDealerCpo = input.cpoStatus === "dealer";

  const selectedWindowSticker = input.condition === "new"
    ? "new-car-sticker"
    : isOemCpo
      ? "window-saturday-hero + OEM CPO badge"
      : isDealerCpo
        ? "window-saturday-hero + Dealer CPO badge"
        : "window-saturday-classic";

  const selectedAddendum = input.condition === "new"
    ? "addendum-modern"
    : "addendum-saturday-premium";

  const ftcBuyersGuide = isUsed && isCt ? "required" : "not_required";
  const k208 = isUsed && isCt ? "required" : "not_required";
  const passportStatus = input.passportEnabled ? "enabled" : "disabled";
  const trustSource = isOemCpo
    ? "OEM CPO program"
    : isDealerCpo
      ? "Dealer CPO / inspection program"
      : "Dealer review source + vehicle passport evidence";
  const dealerProgram = isOemCpo ? "OEM CPO" : isDealerCpo ? "Dealer CPO" : "Standard used vehicle";
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
        label: "Window sticker selected",
        status: "pass",
        detail: selectedWindowSticker,
      },
      {
        label: "Addendum selected",
        status: "pass",
        detail: selectedAddendum,
      },
      {
        label: "FTC Buyers Guide",
        status: ftcBuyersGuide === "required" ? "pass" : "skip",
        detail: ftcBuyersGuide === "required" ? "Used + Connecticut requires FTC Buyers Guide" : "Not required for this test vehicle",
      },
      {
        label: "K208",
        status: k208 === "required" ? "pass" : "skip",
        detail: k208 === "required" ? "Used + Connecticut requires K208 flow" : "Not required for this test vehicle",
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

// ── Warranty display-model builder ───────────────────────────────────────────
// Turns a VIN-decoded vehicle into the WarrantyDisplayModel the Factory Warranty
// modal renders. New vehicles get term-only figures; used/CPO get calculated
// remaining coverage. No fabrication: an unmatched vehicle or missing data
// yields a confirmation disclosure, never a made-up date/mileage/"Pending".

import type {
  BenefitItem,
  GlanceCoverage,
  OemWarrantyCoverage,
  OemWarrantyProgram,
  WarrantyDisplayModel,
  WarrantyStatus,
  WarrantyVehicleInput,
} from "@/lib/warranty/types";
import { getWarrantyDisplayMode, matchOemWarrantyProgram } from "@/lib/warranty/match";
import { calculateUsedWarrantyRemaining } from "@/lib/warranty/calculate";
import { OEM_WARRANTY_PROGRAMS } from "@/data/oemWarrantyPrograms";

const TITLE = "Factory Warranty";
const SUBTITLE = "See what's covered and for how long.";
const DISCLAIMERS = [
  "Coverage terms may vary by manufacturer, model year, vehicle use, in-service date, mileage, and transfer rules.",
  "Confirm final warranty coverage with the dealer or manufacturer.",
];
const USED_DISCLAIMER = "For pre-owned vehicles, remaining coverage depends on original in-service date and current mileage.";

const yearsWord = (y: number) => `${y} ${y === 1 ? "Year" : "Years"}`;
const coverageYears = (c: OemWarrantyCoverage): number | null =>
  c.termYears ?? (c.termMonths != null ? Math.round(c.termMonths / 12) : null);

const termYearsLabel = (c: OemWarrantyCoverage): string | null => {
  const y = coverageYears(c);
  return y != null ? yearsWord(y) : null;
};
const termMilesLabel = (c: OemWarrantyCoverage): string | null => {
  if (c.unlimitedMiles) return "Unlimited Miles";
  return c.mileageLimit ? `${c.mileageLimit.toLocaleString()} Miles` : null;
};
const benefitTerm = (c: OemWarrantyCoverage): string => {
  const y = coverageYears(c);
  const time = y != null ? `${y} ${y === 1 ? "year" : "years"}` : null;
  const miles = c.unlimitedMiles ? "Unlimited miles" : c.mileageLimit ? `${c.mileageLimit.toLocaleString()} miles` : null;
  return [time, miles].filter(Boolean).join(" / ") || "Included";
};

const findCoverage = (p: OemWarrantyProgram, ...types: OemWarrantyCoverage["coverageType"][]) =>
  p.coverages.find((c) => types.includes(c.coverageType)) || null;

const isBenefit = (c: OemWarrantyCoverage) =>
  !["basic", "bumper_to_bumper", "powertrain", "cpo"].includes(c.coverageType);

const buildBenefits = (program: OemWarrantyProgram): BenefitItem[] =>
  program.coverages
    .filter(isBenefit)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      coverageType: c.coverageType,
      title: c.displayName,
      term: benefitTerm(c),
      subtitle: c.subtitle ?? null,
      iconKey: c.iconKey ?? c.coverageType,
      accent: c.coverageType === "hybrid_ev_components" ? "green" : "blue",
    }));

// Fallback model when no program matched — asks for dealer confirmation without
// inventing any coverage figures.
function unmatchedModel(mode: WarrantyDisplayModel["mode"]): WarrantyDisplayModel {
  return {
    mode,
    title: TITLE,
    subtitle: SUBTITLE,
    status: "NEEDS_CONFIRMATION",
    statusCopy: "Confirm this vehicle's factory warranty with the dealer.",
    warrantyStartLabel: "Warranty Start",
    warrantyStartValue: mode === "new" ? "At Delivery Date" : "See dealer",
    warrantyStartSubcopy: null,
    showWarrantyEnd: false,
    showProgress: false,
    showRemaining: false,
    coverageAtGlance: [],
    notice: null,
    additionalFactoryBenefits: [],
    showCpoBanner: false,
    needsDealerConfirmation: true,
    confirmationDisclosure: "Ask the dealer to confirm the factory warranty terms for this vehicle.",
    disclaimers: mode === "new" ? DISCLAIMERS : [...DISCLAIMERS, USED_DISCLAIMER],
    matchedBy: "none",
    confidenceStatus: null,
  };
}

export function buildWarrantyDisplayModel(
  vehicle: WarrantyVehicleInput,
  programs: OemWarrantyProgram[] = OEM_WARRANTY_PROGRAMS,
): WarrantyDisplayModel {
  const mode = getWarrantyDisplayMode(vehicle);
  const match = matchOemWarrantyProgram(vehicle, programs);
  if (!match.program) return unmatchedModel(mode);
  const program = match.program;

  const basic = findCoverage(program, "bumper_to_bumper", "basic");
  const powertrain = findCoverage(program, "powertrain");
  const benefits = buildBenefits(program);
  const cpoBrand = program.brand || program.oemMake || vehicle.make || null;

  // ── NEW: term figures only, coverage begins at delivery ──
  if (mode === "new") {
    const glance: GlanceCoverage[] = [];
    if (basic) glance.push({ coverageType: basic.coverageType, title: basic.displayName, subtitle: basic.subtitle || "Basic Vehicle Coverage", accent: "blue", termYears: termYearsLabel(basic), termMiles: termMilesLabel(basic) });
    if (powertrain) glance.push({ coverageType: powertrain.coverageType, title: powertrain.displayName, subtitle: powertrain.subtitle || "Engine, Transmission & Drivetrain", accent: "green", termYears: termYearsLabel(powertrain), termMiles: termMilesLabel(powertrain) });
    return {
      mode,
      title: TITLE,
      subtitle: SUBTITLE,
      status: "ACTIVE",
      statusCopy: "Your factory warranty is in effect. You're covered.",
      warrantyStartLabel: "Warranty Start",
      warrantyStartValue: "At Delivery Date",
      warrantyStartSubcopy: null,
      showWarrantyEnd: false,
      showProgress: false,
      showRemaining: false,
      coverageAtGlance: glance,
      notice: "Factory coverage begins when you take delivery of your vehicle.",
      additionalFactoryBenefits: benefits,
      showCpoBanner: false,
      needsDealerConfirmation: match.needsDealerConfirmation,
      confirmationDisclosure: null,
      disclaimers: DISCLAIMERS,
      matchedBy: match.matchedBy,
      confidenceStatus: match.confidenceStatus,
    };
  }

  // ── USED / CPO: calculated remaining coverage ──
  // Used and CPO buyers are SUBSEQUENT owners — apply any reduced transfer terms
  // (e.g. Hyundai powertrain 10/100k original → 5/60k after transfer).
  const asSubsequentOwner = (c: OemWarrantyCoverage): OemWarrantyCoverage => {
    if (c.subsequentOwnerTermMonths == null && c.subsequentOwnerMileageLimit == null && !c.subsequentOwnerUnlimitedMiles) return c;
    return {
      ...c,
      termMonths: c.subsequentOwnerTermMonths ?? c.termMonths,
      termYears: c.subsequentOwnerTermMonths != null ? Math.round(c.subsequentOwnerTermMonths / 12) : c.termYears,
      mileageLimit: c.subsequentOwnerUnlimitedMiles ? null : (c.subsequentOwnerMileageLimit ?? c.mileageLimit),
      unlimitedMiles: c.subsequentOwnerUnlimitedMiles ?? c.unlimitedMiles,
    };
  };
  const asOf = new Date();
  const calc = (c: OemWarrantyCoverage | null) =>
    c ? calculateUsedWarrantyRemaining({ coverage: asSubsequentOwner(c), inServiceDate: vehicle.inServiceDate, currentMileage: vehicle.mileage, asOfDate: asOf }) : null;
  const basicRem = calc(basic);
  const ptRem = calc(powertrain);

  const glance: GlanceCoverage[] = [];
  if (basic && basicRem) {
    glance.push({
      coverageType: basic.coverageType, title: basic.displayName, subtitle: basic.subtitle || "Basic Vehicle Coverage", accent: "blue",
      pctRemaining: basicRem.pctRemaining,
      yearsRemainingLabel: basicRem.yearsRemaining != null ? yearsWord(basicRem.yearsRemaining) + " Remaining" : null,
      milesRemainingLabel: basicRem.milesRemaining != null ? `${basicRem.milesRemaining.toLocaleString()} Miles Remaining` : null,
      expiresDate: basicRem.expirationDate,
      expiresMiles: basicRem.expirationMileage != null ? `${basicRem.expirationMileage.toLocaleString()} miles` : null,
    });
  }
  if (powertrain && ptRem) {
    glance.push({
      coverageType: powertrain.coverageType, title: powertrain.displayName, subtitle: powertrain.subtitle || "Engine, Transmission & Drivetrain", accent: "green",
      pctRemaining: ptRem.pctRemaining,
      yearsRemainingLabel: ptRem.yearsRemaining != null ? yearsWord(ptRem.yearsRemaining) + " Remaining" : null,
      milesRemainingLabel: ptRem.milesRemaining != null ? `${ptRem.milesRemaining.toLocaleString()} Miles Remaining` : null,
      expiresDate: ptRem.expirationDate,
      expiresMiles: ptRem.expirationMileage != null ? `${ptRem.expirationMileage.toLocaleString()} miles` : null,
    });
  }

  // Warranty End = the longest-running of the two coverages (usually powertrain).
  const endSource = [basic ? { c: basic, r: basicRem } : null, powertrain ? { c: powertrain, r: ptRem } : null]
    .filter((x): x is { c: OemWarrantyCoverage; r: ReturnType<typeof calc> } => !!x && !!x.r?.expirationDate)
    .sort((a, b) => (b.c.termMonths ?? 0) - (a.c.termMonths ?? 0))[0] || null;

  const anyActive = [basicRem?.active, ptRem?.active].some((a) => a === true);
  const allKnownExpired = [basicRem, ptRem].some((r) => r) && [basicRem, ptRem].filter((r) => r && r.active != null).every((r) => r!.active === false);
  const needsConfirm = match.needsDealerConfirmation || !!basicRem?.needsDealerConfirmation || !!ptRem?.needsDealerConfirmation;

  let status: WarrantyStatus = "ACTIVE";
  if (allKnownExpired) status = "EXPIRED";
  else if (!anyActive && needsConfirm) status = "NEEDS_CONFIRMATION";

  const hasInService = !!vehicle.inServiceDate;
  const startVal = hasInService
    ? new Date(vehicle.inServiceDate as string).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "See dealer";

  return {
    mode,
    title: TITLE,
    subtitle: SUBTITLE,
    status,
    statusCopy: status === "EXPIRED" ? "Factory coverage has ended for this vehicle."
      : status === "NEEDS_CONFIRMATION" ? "Confirm remaining coverage with the dealer."
      : "Your factory warranty is in effect. You're covered.",
    warrantyStartLabel: "Warranty Start",
    warrantyStartValue: startVal,
    warrantyStartSubcopy: hasInService ? "(In-Service Date)" : null,
    showWarrantyEnd: !!endSource,
    warrantyEndLabel: "Warranty End",
    warrantyEndValue: endSource?.r?.expirationDate ?? null,
    warrantyEndMiles: endSource?.r?.expirationMileage ?? null,
    showProgress: true,
    showRemaining: true,
    coverageAtGlance: glance,
    notice: null,
    additionalFactoryBenefits: benefits,
    // CPO banner: certified vehicles, or used vehicles that MAY qualify for the
    // brand's CPO program (copy says "may qualify" — never asserts eligibility).
    showCpoBanner: mode === "cpo" || (mode === "used" && program.appliesToCpo),
    cpoBrand,
    needsDealerConfirmation: needsConfirm,
    confirmationDisclosure: needsConfirm ? "Some coverage figures depend on the in-service date and mileage — ask the dealer to confirm." : null,
    disclaimers: [...DISCLAIMERS, USED_DISCLAIMER],
    matchedBy: match.matchedBy,
    confidenceStatus: match.confidenceStatus,
  };
}

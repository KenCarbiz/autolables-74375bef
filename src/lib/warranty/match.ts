// ── Warranty matching service ────────────────────────────────────────────────
// Resolves a VIN-decoded vehicle to its OEM warranty program using a strict
// specificity ladder. Never guesses: if nothing matches, it returns a fallback
// that flags needs_dealer_confirmation rather than inventing terms.

import type {
  MatchTier,
  OemWarrantyProgram,
  WarrantyDisplayMode,
  WarrantyMatchResult,
  WarrantyVehicleInput,
} from "@/lib/warranty/types";
import { OEM_WARRANTY_PROGRAMS } from "@/data/oemWarrantyPrograms";

const norm = (s?: string | null) => (s ?? "").trim().toUpperCase();

// A vehicle is CPO if any certified flag is set; new if condition/isNew say so;
// otherwise used. Certified takes priority over a stale "used" condition string.
export function getWarrantyDisplayMode(vehicle: WarrantyVehicleInput): WarrantyDisplayMode {
  const cond = norm(vehicle.condition || vehicle.inventoryType || vehicle.type);
  const isCpo =
    vehicle.certified === true ||
    vehicle.cpo === true ||
    vehicle.isCertifiedPreOwned === true ||
    cond === "CPO" ||
    cond.includes("CERTIFIED");
  if (isCpo) return "cpo";
  if (vehicle.isNew === true || cond === "NEW") return "new";
  return "used";
}

// True when the make token appears in the vehicle's make/model text (handles
// multi-word makes and ymm-style strings).
const makeMatches = (programMake: string, vehicleMake?: string | null) => {
  const b = norm(programMake);
  const hay = norm(vehicleMake);
  return b.length > 1 && (hay === b || hay.includes(b) || b.includes(hay));
};

const modelMatches = (programModel: string | null | undefined, vehicleModel?: string | null) => {
  if (!programModel) return true; // null program model = applies to all models
  const p = norm(programModel);
  const v = norm(vehicleModel);
  return !!v && (v === p || v.includes(p) || p.includes(v));
};

const yearInRange = (p: OemWarrantyProgram, year?: number | null) =>
  year != null && year >= p.modelYearStart && year <= p.modelYearEnd;

const powertrainMatches = (p: OemWarrantyProgram, pt?: string | null) => {
  if (!p.powertrainType) return true;
  return norm(p.powertrainType) === norm(pt);
};

const trimMatches = (p: OemWarrantyProgram, trim?: string | null) => {
  if (!p.trim) return true;
  return norm(p.trim) === norm(trim);
};

// Ordered candidate filters — first tier that yields a match wins, so a precise
// trim+powertrain program is always preferred over a make-level default.
export function matchOemWarrantyProgram(
  vehicle: WarrantyVehicleInput,
  programs: OemWarrantyProgram[] = OEM_WARRANTY_PROGRAMS,
): WarrantyMatchResult {
  const country = norm(vehicle.country || "US");
  const inMarket = programs.filter((p) => norm(p.country) === country && makeMatches(p.oemMake, vehicle.make));

  const pick = (list: OemWarrantyProgram[], tier: MatchTier): WarrantyMatchResult | null => {
    if (!list.length) return null;
    const program = list[0];
    return {
      program,
      matchedBy: tier,
      matchedMake: program.oemMake,
      matchedModel: program.model ?? vehicle.model ?? null,
      matchedYear: vehicle.year ?? program.modelYearStart,
      matchedTrim: program.trim ?? vehicle.trim ?? null,
      matchedPowertrain: program.powertrainType ?? vehicle.powertrainType ?? null,
      needsDealerConfirmation: program.confidenceStatus !== "verified",
      confidenceStatus: program.confidenceStatus,
    };
  };

  // 1. exact make + model + model year + trim + powertrain
  const tier1 = inMarket.filter(
    (p) => modelMatches(p.model, vehicle.model) && yearInRange(p, vehicle.year) && trimMatches(p, vehicle.trim) && powertrainMatches(p, vehicle.powertrainType) && p.trim != null && p.powertrainType != null,
  );
  // 2. make + model + model year + powertrain
  const tier2 = inMarket.filter(
    (p) => modelMatches(p.model, vehicle.model) && yearInRange(p, vehicle.year) && powertrainMatches(p, vehicle.powertrainType) && p.powertrainType != null,
  );
  // 3. make + model + model year
  const tier3 = inMarket.filter((p) => modelMatches(p.model, vehicle.model) && p.model != null && yearInRange(p, vehicle.year));
  // 4. make + model year range (model-agnostic program)
  const tier4 = inMarket.filter((p) => p.model == null && yearInRange(p, vehicle.year));
  // 5. make default for the model year (any make-level program covering the year)
  const tier5 = inMarket.filter((p) => yearInRange(p, vehicle.year));

  const result =
    pick(tier1, "exact_trim_powertrain") ??
    pick(tier2, "model_year_powertrain") ??
    pick(tier3, "model_year") ??
    pick(tier4, "make_year_range") ??
    pick(tier5, "make_default");

  if (result) return result;

  // 6. fallback — no confident match; never invent terms.
  return {
    program: null,
    matchedBy: "none",
    matchedMake: vehicle.make ?? null,
    matchedModel: vehicle.model ?? null,
    matchedYear: vehicle.year ?? null,
    matchedTrim: vehicle.trim ?? null,
    matchedPowertrain: vehicle.powertrainType ?? null,
    needsDealerConfirmation: true,
    confidenceStatus: null,
  };
}

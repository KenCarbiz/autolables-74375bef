// ── Fuel Economy & Running Cost (Phase E, option B) governed derivation ──────
// EPA fuel data ONLY. Governance:
//   • annualFuelCost comes straight from the EPA source (fueleconomy.gov), so it
//     is labeled "EPA estimated annual fuel cost" — never AutoLabels-calculated,
//     and never multiplied out into a five-year / total-cost-to-own figure.
//   • No depreciation / maintenance / insurance / repairs / financing / taxes.
//   • If only MPG is available, we show MPG and say annual cost is unavailable —
//     we never manufacture a cost. No EPA data → an honest unavailable state.
//   • MPG is never inferred from another trim/drivetrain here.

import type { PassportData } from "@/lib/passportV2Data";

export const FUEL_MODULE_HEADING = "Fuel Economy & Running Cost";
export const FUEL_MODULE_DISCLAIMER = "EPA model-level estimates based on standardized driving and fuel-cost assumptions. Figures apply to this model/trim; confirm the exact drivetrain. Your actual fuel cost will vary.";

export interface FuelEconomyView {
  available: boolean;
  fuelType: string | null;
  cityMpg: number | null;
  highwayMpg: number | null;
  combinedMpg: number | null;
  rangeMiles: number | null;
  /** EPA-sourced annual fuel cost, or null when the source didn't provide one. */
  annualFuelCost: number | null;
  annualFuelCostLabel: string | null;  // "EPA estimated annual fuel cost" when present
  note: string;
  source: string | null;               // "EPA · fueleconomy.gov" when data exists
}

const UNAVAILABLE: FuelEconomyView = {
  available: false, fuelType: null, cityMpg: null, highwayMpg: null, combinedMpg: null,
  rangeMiles: null, annualFuelCost: null, annualFuelCostLabel: null,
  note: "Fuel-economy information is currently unavailable for this vehicle.", source: null,
};

export function resolveFuelEconomy(epa: PassportData["epa"]): FuelEconomyView {
  if (!epa || (epa.combined == null && epa.city == null && epa.highway == null)) return UNAVAILABLE;

  const hasCost = epa.annualFuelCost != null && Number.isFinite(epa.annualFuelCost);
  const note = hasCost
    ? FUEL_MODULE_DISCLAIMER
    : "Miles-per-gallon shown from EPA estimates. Annual fuel-cost information is unavailable for this vehicle.";

  return {
    available: true,
    fuelType: epa.fuelType ?? null,
    cityMpg: epa.city ?? null,
    highwayMpg: epa.highway ?? null,
    combinedMpg: epa.combined ?? null,
    rangeMiles: epa.rangeMiles ?? null,
    annualFuelCost: hasCost ? epa.annualFuelCost : null,
    annualFuelCostLabel: hasCost ? "EPA estimated annual fuel cost" : null,
    note,
    source: "EPA · fueleconomy.gov",
  };
}

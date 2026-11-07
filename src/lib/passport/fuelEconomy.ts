// ── Fuel Economy & Running Cost (Phase E, option B) governed derivation ──────
// EPA fuel data ONLY. Governance:
//   • annualFuelCost comes straight from the EPA source (fueleconomy.gov), so it
//     is labeled "EPA estimated annual fuel cost" — never AutoLabels-calculated,
//     and never multiplied out into a five-year / total-cost-to-own figure.
//   • No depreciation / maintenance / insurance / repairs / financing / taxes.
//   • If only MPG is available, we show MPG and say annual cost is unavailable —
//     we never manufacture a cost. No EPA data → an honest unavailable state.
//   • MPG is never inferred from another trim/drivetrain here.
//   • The five-year comparison is fueleconomy.gov's own youSaveSpend figure from
//     the same retrieval as the annual cost, and both carry that retrieval date.

import type { PassportData } from "@/lib/passportV2Data";
import { fiveYearSentence, formatEpaDate } from "../../../supabase/functions/_shared/epaSnapshot";

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
  /** fueleconomy.gov 5-year comparison from the same retrieval as annualFuelCost. */
  fiveYear: { difference: number; amount: number; direction: "save" | "spend" | "same" } | null;
  fiveYearSentence: string | null;
  /** When the cost figures were retrieved; costs change with fuel prices. */
  retrievedAt: string | null;
  retrievedLabel: string | null;       // "Retrieved Nov 5, 2026"
  note: string;
  source: string | null;               // "EPA · fueleconomy.gov" when data exists
}

const UNAVAILABLE: FuelEconomyView = {
  available: false, fuelType: null, cityMpg: null, highwayMpg: null, combinedMpg: null,
  rangeMiles: null, annualFuelCost: null, annualFuelCostLabel: null,
  fiveYear: null, fiveYearSentence: null, retrievedAt: null, retrievedLabel: null,
  note: "Fuel-economy information is currently unavailable for this vehicle.", source: null,
};

export function resolveFuelEconomy(epa: PassportData["epa"]): FuelEconomyView {
  if (!epa || (epa.combined == null && epa.city == null && epa.highway == null)) return UNAVAILABLE;

  const hasCost = epa.annualFuelCost != null && Number.isFinite(epa.annualFuelCost);
  const retrieved = formatEpaDate(epa.retrievedAt);
  const fiveYear = epa.fiveYear ?? null;
  const dated = retrieved && (hasCost || fiveYear)
    ? ` Cost estimates retrieved from fueleconomy.gov on ${retrieved}; they change as fuel prices change.`
    : "";
  const note = hasCost
    ? FUEL_MODULE_DISCLAIMER + dated
    : "Miles-per-gallon shown from EPA estimates. Annual fuel-cost information is unavailable for this vehicle." + dated;

  return {
    available: true,
    fuelType: epa.fuelType ?? null,
    cityMpg: epa.city ?? null,
    highwayMpg: epa.highway ?? null,
    combinedMpg: epa.combined ?? null,
    rangeMiles: epa.rangeMiles ?? null,
    annualFuelCost: hasCost ? epa.annualFuelCost : null,
    // On a plug-in hybrid or flex-fuel vehicle EPA's figure covers the
    // conventional fuel only, so the label says which fuel.
    annualFuelCostLabel: hasCost
      ? epa.annualFuelCostFuel ? `EPA estimated annual fuel cost on ${epa.annualFuelCostFuel} only` : "EPA estimated annual fuel cost"
      : null,
    fiveYear,
    fiveYearSentence: fiveYearSentence(fiveYear),
    retrievedAt: retrieved ? epa.retrievedAt ?? null : null,
    retrievedLabel: retrieved ? `Retrieved ${retrieved}` : null,
    note,
    source: "EPA · fueleconomy.gov",
  };
}

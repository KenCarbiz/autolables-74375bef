// GENERATED — do not edit.
// Mirror of src/lib/passport/fuelEconomy.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { PassportData } from "../passportV2Data.ts";
export const FUEL_MODULE_HEADING = "Fuel Economy & Running Cost";
export const FUEL_MODULE_DISCLAIMER = "EPA model-level estimates based on standardized driving and fuel-cost assumptions. Figures apply to this model/trim; confirm the exact drivetrain. Your actual fuel cost will vary.";
export interface FuelEconomyView {
    available: boolean;
    fuelType: string | null;
    cityMpg: number | null;
    highwayMpg: number | null;
    combinedMpg: number | null;
    rangeMiles: number | null;
    annualFuelCost: number | null;
    annualFuelCostLabel: string | null;
    note: string;
    source: string | null;
}
const UNAVAILABLE: FuelEconomyView = {
    available: false,
    fuelType: null,
    cityMpg: null,
    highwayMpg: null,
    combinedMpg: null,
    rangeMiles: null,
    annualFuelCost: null,
    annualFuelCostLabel: null,
    note: "Fuel-economy information is currently unavailable for this vehicle.",
    source: null,
};
export function resolveFuelEconomy(epa: PassportData["epa"]): FuelEconomyView {
    if (!epa || (epa.combined == null && epa.city == null && epa.highway == null))
        return UNAVAILABLE;
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
        source: "EPA \u00B7 fueleconomy.gov",
    };
}

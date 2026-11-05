// Test inputs for the INFINITI QX60 Sport and Nissan Pathfinder Platinum
// catalog entries, which production serves with the approved Letter masters.
//
// qx60ReferenceMatchData() / pathfinderReferenceMatchData(): synthetic vehicles
// that satisfy the two reference variants; test data for side-by-side visual
// comparison ONLY, never a default for any other vehicle. The saved-record
// stress inputs come from the harteNewInventory acceptance fixture.

import type { FactoryStickerRenderData } from "../contract.ts";
import { infinitiBenchmark, nissanBenchmark } from "./renderData.ts";

export const QX60_REFERENCE_VIN = "5N1DL1HT0TC000001";
export const PATHFINDER_REFERENCE_VIN = "5N1DR3DK0TC000002";

export const qx60ReferenceMatchData = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: QX60_REFERENCE_VIN,
  title: "Reference match (side-by-side comparison only)",
  identity: { year: "2026", make: "INFINITI", model: "QX60", trim: "SPORT" },
  mechanical: { engine: "2.0L VC-TURBO I4", transmission: "9-SPEED A/T", drivetrain: "AWD" },
  warranty: {
    basic: "4-Year/60,000-Mile Basic Limited Warranty",
    powertrain: "6-Year/70,000-Mile Powertrain Limited Warranty",
    corrosion: "7-Year/Unlimited-Mile Corrosion Limited Warranty",
    roadside: null,
    emissions: null,
  },
});

export const pathfinderReferenceMatchData = (): FactoryStickerRenderData => ({
  ...nissanBenchmark(),
  vin: PATHFINDER_REFERENCE_VIN,
  title: "Reference match (side-by-side comparison only)",
  identity: { year: "2026", make: "Nissan", model: "Pathfinder", trim: "PLATINUM" },
  dealerRole: null,
  warranty: {
    basic: "3-Year/36,000-Mile Basic Limited Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "5-Year/Unlimited-Mile Corrosion Limited Warranty",
    roadside: null,
    emissions: null,
  },
});

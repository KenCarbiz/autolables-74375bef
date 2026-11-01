// Dedicated reproduction layout for the Jeep 2024 Grand Cherokee 4xe PHEV
// (Figma master 25:3070, review 25:3334). See stellantisCommon.ts.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter } from "../layout.ts";
import { T, Tfit, buildStellantisPhevLayout, wordmark, type StellantisVariantConfig } from "./stellantisCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

function paintHeader(p: Painter, d: FactoryStickerData, _displayMake: string): void {
  const v = d.vehicle;
  wordmark(p, "JEEP", 95, 101, 66, 168);
  if (v.year > 0) T(p, `${v.year} MODEL YEAR`, 287, 63.03, 25.71, "bold", { spacing: 2.35 });
  const title = [v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  Tfit(p, title, 286.63, 113.82, 50.311, "bold", 760, { spacing: 1.03 });
}

export const JEEP_GRAND_CHEROKEE_4XE_CONFIG: StellantisVariantConfig = {
  variantKey: "jeep-2024-grand-cherokee-4xe-phev",
  frameColor: "#7c8355",
  paintHeader,
  specTitle: (d, displayMake) =>
    [displayMake, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase(),
};

export const buildJeepGrandCherokee4xeLayout: VariantLayoutBuilder = (input) =>
  buildStellantisPhevLayout(JEEP_GRAND_CHEROKEE_4XE_CONFIG, input);

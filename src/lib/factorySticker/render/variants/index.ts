import { buildChryslerPacificaPhevLayout } from "./chryslerPacificaPhev.ts";
import { buildFordTransitCarbLayout } from "./fordTransitCarb.ts";
import { buildHyundaiSantaFeHybridLayout } from "./hyundaiSantaFeHybrid.ts";
import { buildJeepGrandCherokee4xeLayout } from "./jeepGrandCherokee4xe.ts";
import { LETTER_VARIANT_CONFIGS, buildLetterVariantLayout } from "./letterMonroney.ts";
import { buildMitsubishiOutlanderLayout } from "./mitsubishiOutlander.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export type { VariantLayoutBuilder, VariantRenderInput } from "./shared.ts";

/** Dedicated layout builders keyed by reference-variant key. */
export const VARIANT_LAYOUTS: Record<string, VariantLayoutBuilder> = {
  ...Object.fromEntries(
    Object.keys(LETTER_VARIANT_CONFIGS).map((key) => [key, (input) => buildLetterVariantLayout(key, input)] as const),
  ),
  "hyundai-2026-santa-fe-hybrid-se-awd": buildHyundaiSantaFeHybridLayout,
  "mitsubishi-2025-outlander-se-s-awc": buildMitsubishiOutlanderLayout,
  "jeep-2024-grand-cherokee-4xe-phev": buildJeepGrandCherokee4xeLayout,
  "chrysler-2024-pacifica-select-phev": buildChryslerPacificaPhevLayout,
  "ford-2025-transit-250-cargo-rwd-e85-carb": buildFordTransitCarbLayout,
};

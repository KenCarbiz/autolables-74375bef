// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/index.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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

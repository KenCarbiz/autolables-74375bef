// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/index.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { BUICK_ENVISTA_GAS_ID, buildBuickEnvistaGasLayout } from "./buickEnvistaGas.ts";
import { buildChryslerPacificaPhevLayout } from "./chryslerPacificaPhev.ts";
import { CHRYSLER_VOYAGER_GAS_ID, buildChryslerVoyagerGasLayout } from "./chryslerVoyagerGas.ts";
import { DODGE_DURANGO_GAS_ID, buildDodgeDurangoGasLayout } from "./dodgeDurangoGas.ts";
import { buildFordTransitCarbLayout } from "./fordTransitCarb.ts";
import { GENESIS_GV80_GAS_ID, buildGenesisGv80GasLayout } from "./genesisGv80Gas.ts";
import { buildHyundaiSantaFeHybridLayout } from "./hyundaiSantaFeHybrid.ts";
import { HYUNDAI_TUCSON_GAS_ID, buildHyundaiTucsonGasLayout } from "./hyundaiTucsonGas.ts";
import { buildJeepGrandCherokee4xeLayout } from "./jeepGrandCherokee4xe.ts";
import { JEEP_WRANGLER_GAS_ID, buildJeepWranglerGasLayout } from "./jeepWranglerGas.ts";
import { LETTER_VARIANT_CONFIGS, buildLetterVariantLayout } from "./letterMonroney.ts";
import { buildMitsubishiOutlanderLayout } from "./mitsubishiOutlander.ts";
import { KIA_SORENTO_GAS_ID, buildKiaSorentoGasLayout } from "./kiaSorentoGas.ts";
import { MITSUBISHI_OUTLANDER_SPORT_ID, buildMitsubishiOutlanderSportLayout } from "./mitsubishiOutlanderSport.ts";
import { SUBARU_FORESTER_GAS_ID, buildSubaruForesterGasLayout } from "./subaruForesterGas.ts";
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

/** Catalog template layouts keyed by catalog id. Having a builder does not make a template routable; approval does. */
export const CATALOG_LAYOUTS: Partial<Record<string, VariantLayoutBuilder>> = {
  [HYUNDAI_TUCSON_GAS_ID]: buildHyundaiTucsonGasLayout,
  [JEEP_WRANGLER_GAS_ID]: buildJeepWranglerGasLayout,
  [CHRYSLER_VOYAGER_GAS_ID]: buildChryslerVoyagerGasLayout,
  [MITSUBISHI_OUTLANDER_SPORT_ID]: buildMitsubishiOutlanderSportLayout,
  [KIA_SORENTO_GAS_ID]: buildKiaSorentoGasLayout,
  [DODGE_DURANGO_GAS_ID]: buildDodgeDurangoGasLayout,
  [BUICK_ENVISTA_GAS_ID]: buildBuickEnvistaGasLayout,
  [GENESIS_GV80_GAS_ID]: buildGenesisGv80GasLayout,
  [SUBARU_FORESTER_GAS_ID]: buildSubaruForesterGasLayout,
};

import { BUICK_ENVISTA_GAS_ID, buildBuickEnvistaGasLayout } from "./buickEnvistaGas.ts";
import { VOLVO_XC60_B5_ID, buildVolvoXc60B5Layout } from "./volvoXc60B5.ts";
import { HONDA_ODYSSEY_GAS_ID, buildHondaOdysseyGasLayout } from "./hondaOdysseyGas.ts";
import { LEXUS_RX350_GAS_ID, buildLexusRx350GasLayout } from "./lexusRx350Gas.ts";
import { TOYOTA_4RUNNER_GAS_ID, buildToyota4runnerGasLayout } from "./toyota4runnerGas.ts";
import { LAMBORGHINI_URUS_PHEV_ID, buildLamborghiniUrusPhevLayout } from "./lamborghiniUrusPhev.ts";
import { BENTLEY_CONTINENTAL_GT_PHEV_ID, buildBentleyContinentalGtPhevLayout } from "./bentleyContinentalGtPhev.ts";
import { ROLLS_ROYCE_SPECTRE_EV_ID, buildRollsRoyceSpectreEvLayout } from "./rollsRoyceSpectreEv.ts";
import { FIAT_500E_EV_ID, buildFiat500eEvLayout } from "./fiat500eEv.ts";
import { CADILLAC_ESCALADE_IQL_EV_ID, buildCadillacEscaladeIqEvLayout } from "./cadillacEscaladeIqEv.ts";
import { buildChryslerPacificaPhevLayout } from "./chryslerPacificaPhev.ts";
import { CHRYSLER_VOYAGER_GAS_ID, buildChryslerVoyagerGasLayout } from "./chryslerVoyagerGas.ts";
import { DODGE_DURANGO_GAS_ID, buildDodgeDurangoGasLayout } from "./dodgeDurangoGas.ts";
import { FORD_F250_DIESEL_ID, buildFordF250DieselLayout } from "./fordF250Diesel.ts";
import { buildFordTransitCarbLayout } from "./fordTransitCarb.ts";
import { CHEVROLET_SILVERADO_2500_DIESEL_ID, buildChevroletSilverado2500DieselLayout } from "./chevroletSilverado2500Diesel.ts";
import { GMC_SIERRA_3500_DIESEL_ID, buildGmcSierra3500DieselLayout } from "./gmcSierra3500Diesel.ts";
import { RAM_2500_DIESEL_ID, buildRam2500DieselLayout } from "./ramLimitedDiesel.ts";
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
import { ALFA_ROMEO_GIULIA_GAS_ID, buildAlfaRomeoGiuliaGasLayout } from "./alfaRomeoGiuliaGas.ts";
import { MASERATI_GRANTURISMO_GAS_ID, buildMaseratiGranTurismoGasLayout } from "./maseratiGranTurismoTrofeo.ts";
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
  [FORD_F250_DIESEL_ID]: buildFordF250DieselLayout,
  [RAM_2500_DIESEL_ID]: buildRam2500DieselLayout,
  [CHEVROLET_SILVERADO_2500_DIESEL_ID]: buildChevroletSilverado2500DieselLayout,
  [GMC_SIERRA_3500_DIESEL_ID]: buildGmcSierra3500DieselLayout,
  [CADILLAC_ESCALADE_IQL_EV_ID]: buildCadillacEscaladeIqEvLayout,
  [FIAT_500E_EV_ID]: buildFiat500eEvLayout,
  [ROLLS_ROYCE_SPECTRE_EV_ID]: buildRollsRoyceSpectreEvLayout,
  [BENTLEY_CONTINENTAL_GT_PHEV_ID]: buildBentleyContinentalGtPhevLayout,
  [LAMBORGHINI_URUS_PHEV_ID]: buildLamborghiniUrusPhevLayout,
  [LEXUS_RX350_GAS_ID]: buildLexusRx350GasLayout,
  [TOYOTA_4RUNNER_GAS_ID]: buildToyota4runnerGasLayout,
  [VOLVO_XC60_B5_ID]: buildVolvoXc60B5Layout,
  [HONDA_ODYSSEY_GAS_ID]: buildHondaOdysseyGasLayout,
  [ALFA_ROMEO_GIULIA_GAS_ID]: buildAlfaRomeoGiuliaGasLayout,
  [MASERATI_GRANTURISMO_GAS_ID]: buildMaseratiGranTurismoGasLayout,
};

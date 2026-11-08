// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/catalogEquipment.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Equipment hygiene for the catalog templates only. The approved masters keep
// their existing equipment path byte for byte; a catalog template drops decoder
// fragments that are not equipment before selection, so a rating word such as
// "Poor" or a speed threshold never prints on a sticker.

import { isDecoderNoise } from "../equipmentNoise.ts";
import { isRatingMetadata } from "../oem/sourceCorrections.ts";
import type { FactoryStickerRenderData } from "./contract.ts";
import { curationProfileFor } from "./catalogCuration.ts";

const EXTRA_NON_EQUIPMENT: RegExp[] = [
  /-\s*(good|acceptable|marginal|poor)\s*$/i,
  /^(frontal crash rating|rollover rating|side impact|overall|headlights|seat belt reminder)\s*-/i,
  /^(top safety pick status|standard|test revision)\s*-/i,
  /\b(kph|mph)\b/i,
  /^(includes|activates|operates)\b/i,
  /^level\s*\d/i,
  /^autonomous drive\b/i,
  /^brakes at low speed$/i,
  /disc brakes\s*-\s*\d+$/i,
  /^(sub-?compact|compact|(lower |upper )?(medium|mid-?size)|full[- ]size|large|executive|small|mini)( [a-z]+)? (suv|sedan|coupe|crossover|truck|pickup|van|minivan|wagon|hatchback)$/i,
  /^paint\s*-\s*(gloss|metallic|pearl|matte|solid|flat)$/i,
  /^(front|rear) seats head restraints\s*-\s*\d+$/i,
];

// Templates added later also drop bare counts and letters, engine and drive
// labels that the Engine, Transmission and Drivetrain rows already carry.
const POWERTRAIN_FRAGMENTS: RegExp[] = [
  /^\d+$|^[a-z]$/i,
  /^\d+-cyl$|^in-line$|^(short|long|extended) wheelbase$|^(full|mid|compact)[- ]size mpv$|^(unleaded|premium unleaded|regular unleaded|gasoline|diesel)$/i,
  /^(fwd|rwd|awd|4wd|2wd)$|^(four|front|rear|all) wheel drive( type-.*)?$/i,
];

const SIZE_AND_ENGINE_FRAGMENTS = /^(mid|upper|lower|medium|upper medium|lower medium|horizontal|turbo)$/i;

const LATER_TEMPLATES = [
  "kia_2026_sorento_lx", "subaru_2026_forester_wilderness", "genesis_2026_gv80_3.5t_prestige", "dodge_2026_durango_gt_blacktop", "buick_2026_envista_avenir",
  "cadillac_2026_escalade_iql_premium_sport", "fiat_2025_500e_giorgio_armani", "rolls-royce_2026_spectre", "bentley_2026_continental_gt_azure", "lamborghini_2026_urus_se",
  "ford_2026_f250", "ram_2026_2500_limited", "chevrolet_2026_silverado_2500_high_country", "gmc_2026_sierra_3500_denali_ultimate",
  "lexus_2026_rx_350_awd", "toyota_2026_4runner_trd_sport", "honda_2026_odyssey_touring", "volvo_2025_xc60_b5_awd_plus",
  "alfa_romeo_2026_giulia_veloce",
  "maserati_2026_granturismo_trofeo",
  "lincoln_2026_nautilus_premiere",
  "aston_martin_2026_vantage_roadster",
];
const FRAGMENT_TEMPLATES = new Set(["mitsubishi_2026_outlander_sport_s", "chrysler_2026_voyager_lx", ...LATER_TEMPLATES]);

export const isCatalogNonEquipment = (raw: string, templateId?: string): boolean => {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || isRatingMetadata(s) || isDecoderNoise(s) || EXTRA_NON_EQUIPMENT.some((re) => re.test(s))) return true;
  if (!templateId || !FRAGMENT_TEMPLATES.has(templateId)) return false;
  return POWERTRAIN_FRAGMENTS.some((re) => re.test(s)) || (LATER_TEMPLATES.includes(templateId) && SIZE_AND_ENGINE_FRAGMENTS.test(s));
};

const clean = (groups: Record<string, string[]> | undefined, templateId?: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [hint, items] of Object.entries(groups ?? {})) {
    const kept = items.filter((i) => !isCatalogNonEquipment(i, templateId));
    if (kept.length) out[hint] = kept;
  }
  return out;
};

export const withCatalogEquipment = (data: FactoryStickerRenderData, templateId?: string): FactoryStickerRenderData => {
  const curation = curationProfileFor(templateId);
  return {
    ...data,
    standardEquipment: clean(data.standardEquipment, templateId),
    keyFeatures: clean(data.keyFeatures, templateId),
    ...(curation ? { equipmentCuration: curation } : {}),
  };
};

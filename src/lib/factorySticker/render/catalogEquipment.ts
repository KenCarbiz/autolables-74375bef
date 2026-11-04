// Equipment hygiene for the catalog templates only. The approved masters keep
// their existing equipment path byte for byte; a catalog template drops decoder
// fragments that are not equipment before selection, so a rating word such as
// "Poor" or a speed threshold never prints on a sticker.

import { isDecoderNoise } from "../equipmentNoise.ts";
import { isRatingMetadata } from "../oem/sourceCorrections.ts";
import type { FactoryStickerRenderData } from "./contract.ts";

const EXTRA_NON_EQUIPMENT: RegExp[] = [
  /-\s*(good|acceptable|marginal|poor)\s*$/i,
  /^(frontal crash rating|rollover rating|side impact|overall|headlights|latch|seat belt reminder)\s*-/i,
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

export const isCatalogNonEquipment = (raw: string): boolean => {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return !s || isRatingMetadata(s) || isDecoderNoise(s) || EXTRA_NON_EQUIPMENT.some((re) => re.test(s));
};

const clean = (groups: Record<string, string[]> | undefined): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [hint, items] of Object.entries(groups ?? {})) {
    const kept = items.filter((i) => !isCatalogNonEquipment(i));
    if (kept.length) out[hint] = kept;
  }
  return out;
};

export const withCatalogEquipment = (data: FactoryStickerRenderData): FactoryStickerRenderData => ({
  ...data,
  standardEquipment: clean(data.standardEquipment),
  keyFeatures: clean(data.keyFeatures),
});

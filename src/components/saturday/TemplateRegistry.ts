// Unified AutoLabels template registry.
// This is the normalization layer across the first 100 used-vehicle templates:
// 50 used addendums + 50 used window stickers.
// It lets the dealer workflow filter, recommend, audit, and render templates consistently.

import { USED_ADDENDUM_CATALOG_50, type UsedAddendumTemplateDefinition } from "./UsedAddendumCatalog";
import { USED_WINDOW_STICKER_CATALOG_50, type UsedWindowStickerTemplateDefinition } from "./UsedWindowStickerCatalog";
import type { SaturdayAddendumPricingMode, SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";

export type AutoLabelsTemplateKind = "used_addendum" | "used_window_sticker";
export type AutoLabelsVehicleCondition = "new" | "used";
export type AutoLabelsTemplateStatus = "draft" | "active" | "refine" | "disabled";
export type AutoLabelsTemplatePlacement = "inside_window" | "outside_window" | "either";

export type AutoLabelsTemplateRegistryItem = {
  id: string;
  sourceId: string;
  kind: AutoLabelsTemplateKind;
  condition: AutoLabelsVehicleCondition;
  name: string;
  category: string;
  family: string;
  description: string;
  component: UsedAddendumTemplateDefinition["component"] | UsedWindowStickerTemplateDefinition["component"];
  status: AutoLabelsTemplateStatus;
  defaultBadge: string;
  defaultPricingMode: SaturdayAddendumPricingMode;
  recommendedPlacement: AutoLabelsTemplatePlacement;
  supportsDealerTheme: boolean;
  supportsOEMTheme: boolean;
  supportsPassport: boolean;
  supportsMarketTransparency: boolean;
  supportsCPO: boolean;
  supportsFactoryCleanImage: boolean;
  recommendedImagePreference?: "factory_clean_first" | "dealer_photo_first" | "transparent_first";
  suggestedOEMs: string[];
  tags: string[];
  refinementNotes: string[];
};

const PASSPORT_FIRST_MODES: SaturdayAddendumPricingMode[] = ["passport_live_price_only"];
const MARKET_FIRST_MODES: SaturdayAddendumPricingMode[] = ["used_market_value_plus_addendum"];

const normalizeAddendum = (template: UsedAddendumTemplateDefinition): AutoLabelsTemplateRegistryItem => ({
  id: `used-addendum:${template.id}`,
  sourceId: template.id,
  kind: "used_addendum",
  condition: "used",
  name: template.name,
  category: template.category,
  family: template.family,
  description: template.description,
  component: template.component,
  status: "active",
  defaultBadge: template.defaultBadge,
  defaultPricingMode: template.defaultPricingMode,
  recommendedPlacement: template.recommendedPlacement,
  supportsDealerTheme: template.supportsDealerTheme,
  supportsOEMTheme: template.supportsOEMTheme,
  supportsPassport: template.defaultPricingMode === "passport_live_price_only" || template.supportsMarketTransparency,
  supportsMarketTransparency: template.supportsMarketTransparency,
  supportsCPO: template.supportsCPO,
  supportsFactoryCleanImage: false,
  suggestedOEMs: template.suggestedOEMs || [],
  tags: template.tags,
  refinementNotes: [
    "4.5x11 addendum: prioritize installed items, value story, dealer brand, and optional passport CTA.",
    template.supportsMarketTransparency ? "Can show market transparency when dealer settings allow it." : "Market claims should stay hidden unless this template is upgraded.",
    template.defaultPricingMode === "passport_live_price_only" ? "Use stable printed language and drive scan for live price." : "Printed pricing/value follows dealer mode.",
  ],
});

const normalizeWindowSticker = (template: UsedWindowStickerTemplateDefinition): AutoLabelsTemplateRegistryItem => ({
  id: `used-window:${template.id}`,
  sourceId: template.id,
  kind: "used_window_sticker",
  condition: "used",
  name: template.name,
  category: template.category,
  family: template.family,
  description: template.description,
  component: template.component,
  status: "active",
  defaultBadge: template.defaultBadge,
  defaultPricingMode: template.defaultPricingMode,
  recommendedPlacement: template.recommendedPlacement,
  supportsDealerTheme: template.supportsDealerTheme,
  supportsOEMTheme: template.supportsOEMTheme,
  supportsPassport: template.supportsPassport,
  supportsMarketTransparency: template.supportsMarketTransparency,
  supportsCPO: template.supportsCPO,
  supportsFactoryCleanImage: template.supportsFactoryCleanImage,
  recommendedImagePreference: template.recommendedImagePreference,
  suggestedOEMs: template.suggestedOEMs || [],
  tags: template.tags,
  refinementNotes: [
    "8.5x11 window sticker: prioritize vehicle image, vehicle name, value story, specs, MPG, trust, and optional passport/dealer contact.",
    template.supportsFactoryCleanImage ? "Prefers clean factory/API imagery for consistent lot presentation." : "No factory image dependency.",
    template.supportsPassport ? "Can render passport/QR modules when dealer enables passport." : "Must render no-QR dealer-contact version when passport is disabled or unsupported.",
  ],
});

export const AUTO_LABELS_TEMPLATE_REGISTRY: AutoLabelsTemplateRegistryItem[] = [
  ...USED_ADDENDUM_CATALOG_50.map(normalizeAddendum),
  ...USED_WINDOW_STICKER_CATALOG_50.map(normalizeWindowSticker),
];

export const AUTO_LABELS_TEMPLATE_COUNTS = {
  total: AUTO_LABELS_TEMPLATE_REGISTRY.length,
  usedAddendums: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.kind === "used_addendum").length,
  usedWindowStickers: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.kind === "used_window_sticker").length,
  passportCapable: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.supportsPassport).length,
  marketCapable: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.supportsMarketTransparency).length,
  cpoCapable: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.supportsCPO).length,
  factoryImageCapable: AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => template.supportsFactoryCleanImage).length,
};

export type TemplateRegistryFilter = {
  kind?: AutoLabelsTemplateKind;
  category?: string;
  family?: string;
  oem?: string;
  supportsPassport?: boolean;
  supportsMarketTransparency?: boolean;
  supportsCPO?: boolean;
  supportsFactoryCleanImage?: boolean;
  placement?: AutoLabelsTemplatePlacement;
  pricingMode?: SaturdayAddendumPricingMode;
  passportMode?: SaturdayPassportMode;
  marketTransparencyMode?: SaturdayMarketTransparencyMode;
  tags?: string[];
};

const normalized = (value?: string) => String(value || "").trim().toLowerCase();
const oemMatches = (template: AutoLabelsTemplateRegistryItem, oem?: string) => {
  if (!oem) return true;
  const key = normalized(oem);
  return template.suggestedOEMs.some((candidate) => normalized(candidate) === key) || template.tags.some((tag) => normalized(tag) === key);
};

export const filterTemplates = (filter: TemplateRegistryFilter = {}) =>
  AUTO_LABELS_TEMPLATE_REGISTRY.filter((template) => {
    if (filter.kind && template.kind !== filter.kind) return false;
    if (filter.category && template.category !== filter.category) return false;
    if (filter.family && template.family !== filter.family) return false;
    if (filter.oem && !oemMatches(template, filter.oem)) return false;
    if (filter.supportsPassport !== undefined && template.supportsPassport !== filter.supportsPassport) return false;
    if (filter.supportsMarketTransparency !== undefined && template.supportsMarketTransparency !== filter.supportsMarketTransparency) return false;
    if (filter.supportsCPO !== undefined && template.supportsCPO !== filter.supportsCPO) return false;
    if (filter.supportsFactoryCleanImage !== undefined && template.supportsFactoryCleanImage !== filter.supportsFactoryCleanImage) return false;
    if (filter.placement && template.recommendedPlacement !== "either" && template.recommendedPlacement !== filter.placement) return false;
    if (filter.pricingMode && template.defaultPricingMode !== filter.pricingMode) return false;
    if (filter.tags?.length && !filter.tags.every((tag) => template.tags.includes(tag))) return false;
    if (filter.passportMode === "disabled" && template.defaultPricingMode === "passport_live_price_only") return false;
    if (filter.marketTransparencyMode === "off" && template.category === "market_transparency") return false;
    return true;
  });

export type TemplateRecommendationInput = TemplateRegistryFilter & {
  limit?: number;
  storeType?: "franchise" | "independent" | "luxury" | "one_price" | "high_volume" | "commercial" | "special_finance";
};

export const recommendTemplates = (input: TemplateRecommendationInput = {}) => {
  const limit = input.limit || 8;
  return filterTemplates(input)
    .map((template) => {
      let score = 0;
      const reasons: string[] = [];

      if (input.oem && oemMatches(template, input.oem)) {
        score += 24;
        reasons.push("OEM match");
      }

      if (input.supportsCPO && template.supportsCPO) {
        score += 16;
        reasons.push("CPO capable");
      }

      if (input.passportMode !== "disabled" && template.supportsPassport) {
        score += PASSPORT_FIRST_MODES.includes(template.defaultPricingMode) ? 18 : 8;
        reasons.push("passport capable");
      }

      if (input.marketTransparencyMode && input.marketTransparencyMode !== "off" && template.supportsMarketTransparency) {
        score += MARKET_FIRST_MODES.includes(template.defaultPricingMode) ? 18 : 8;
        reasons.push("market capable");
      }

      if (input.kind === "used_window_sticker" && template.supportsFactoryCleanImage) {
        score += 12;
        reasons.push("factory image capable");
      }

      if (input.storeType === "one_price" && template.tags.includes("one-price")) {
        score += 22;
        reasons.push("one-price store fit");
      }

      if (input.storeType === "luxury" && (template.category === "luxury" || template.family === "luxury_black")) {
        score += 18;
        reasons.push("luxury store fit");
      }

      if (input.storeType === "commercial" && template.tags.some((tag) => ["commercial", "fleet", "work-truck"].includes(tag))) {
        score += 18;
        reasons.push("commercial fit");
      }

      if (template.category === "core") {
        score += 4;
        reasons.push("safe fallback");
      }

      return { template, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

export const getTemplateByRegistryId = (id: string) => AUTO_LABELS_TEMPLATE_REGISTRY.find((template) => template.id === id);

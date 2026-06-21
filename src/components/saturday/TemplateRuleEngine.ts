// AutoLabels configurable template rule engine.
// End goal: dealers can turn on/off strategies in admin, override templates, and create rules
// that choose the best sticker/addendum automatically when a vehicle enters inventory.

import {
  AUTO_LABELS_TEMPLATE_REGISTRY,
  recommendTemplates,
  type AutoLabelsTemplateKind,
  type AutoLabelsTemplatePlacement,
  type AutoLabelsTemplateRegistryItem,
} from "./TemplateRegistry";
import { getOEMThemePreset, mergeDealerAndOEMTheme } from "./OEMThemePresets";
import type { SaturdayAddendumPricingMode, SaturdayDealerTheme, SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";
import type { DealerProfileInput, VehicleInventoryInput } from "./wiring";
import { resolveVehicleImageForSticker, type VehicleImagePreference, type VehicleImageResolution } from "./VehicleImagePipeline";

export type DealerStickerStoreType =
  | "franchise"
  | "independent"
  | "luxury"
  | "one_price"
  | "high_volume"
  | "commercial"
  | "special_finance";

export type DealerStickerRuleAction = {
  templateId?: string;
  templateKind?: AutoLabelsTemplateKind;
  forcePassportMode?: SaturdayPassportMode;
  forceMarketTransparencyMode?: SaturdayMarketTransparencyMode;
  forcePricingMode?: SaturdayAddendumPricingMode;
  forcePlacement?: AutoLabelsTemplatePlacement;
  forceImagePreference?: VehicleImagePreference;
  themeOverride?: SaturdayDealerTheme;
};

export type DealerStickerRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: {
    templateKind?: AutoLabelsTemplateKind;
    vehicleCondition?: "new" | "used";
    makes?: string[];
    models?: string[];
    categories?: string[];
    minYear?: number;
    maxYear?: number;
    minMileage?: number;
    maxMileage?: number;
    cpo?: boolean;
    serviceLoaner?: boolean;
    demo?: boolean;
    commercial?: boolean;
    evOrHybrid?: boolean;
    luxury?: boolean;
    onePriceStore?: boolean;
    tags?: string[];
  };
  action: DealerStickerRuleAction;
};

export type DealerStickerAdminConfig = {
  dealerId?: string;
  storeType?: DealerStickerStoreType;
  oem?: string;
  enabled: boolean;
  enabledTemplateKinds: AutoLabelsTemplateKind[];
  enabledTemplateIds: string[];
  disabledTemplateIds: string[];
  defaultUsedWindowTemplateId?: string;
  defaultUsedAddendumTemplateId?: string;
  passportMode: SaturdayPassportMode;
  marketTransparencyMode: SaturdayMarketTransparencyMode;
  addendumPricingMode: SaturdayAddendumPricingMode;
  placement: AutoLabelsTemplatePlacement;
  imagePreference: VehicleImagePreference;
  dealerTheme?: SaturdayDealerTheme;
  useOEMTheme: boolean;
  rules: DealerStickerRule[];
};

export type VehicleRuleFacts = {
  make?: string;
  model?: string;
  year?: number;
  mileage?: number;
  condition: "new" | "used";
  cpo: boolean;
  serviceLoaner: boolean;
  demo: boolean;
  commercial: boolean;
  evOrHybrid: boolean;
  luxury: boolean;
};

export type TemplateRuleDecision = {
  template: AutoLabelsTemplateRegistryItem;
  templateKind: AutoLabelsTemplateKind;
  matchedRule?: DealerStickerRule;
  score: number;
  reasons: string[];
  passportMode: SaturdayPassportMode;
  marketTransparencyMode: SaturdayMarketTransparencyMode;
  pricingMode: SaturdayAddendumPricingMode;
  placement: AutoLabelsTemplatePlacement;
  imagePreference: VehicleImagePreference;
  theme: SaturdayDealerTheme;
  image: VehicleImageResolution;
  recommendations: ReturnType<typeof recommendTemplates>;
};

const normalize = (value?: string | number) => String(value || "").trim().toLowerCase();
const asNumber = (value?: string | number) => {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const LUXURY_MAKES = new Set([
  "acura",
  "audi",
  "bmw",
  "cadillac",
  "genesis",
  "infiniti",
  "lexus",
  "lincoln",
  "mercedes-benz",
  "mercedes",
  "porsche",
  "volvo",
]);

export const DEFAULT_DEALER_STICKER_ADMIN_CONFIG: DealerStickerAdminConfig = {
  enabled: true,
  enabledTemplateKinds: ["used_window_sticker", "used_addendum"],
  enabledTemplateIds: [],
  disabledTemplateIds: [],
  passportMode: "enabled",
  marketTransparencyMode: "passport_only",
  addendumPricingMode: "used_market_value_plus_addendum",
  placement: "inside_window",
  imagePreference: "factory_clean_first",
  useOEMTheme: true,
  rules: [],
};

export const buildVehicleRuleFacts = (vehicle: VehicleInventoryInput & Record<string, any>): VehicleRuleFacts => {
  const make = vehicle.make;
  const model = vehicle.model;
  const year = asNumber(vehicle.year);
  const mileage = asNumber(vehicle.mileage);
  const fuelType = normalize(vehicle.fuelType || vehicle.specs?.fuelType || vehicle.specs?.fuel || "");
  const tags = (vehicle.tags || []) as string[];
  const title = normalize(vehicle.title || [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" "));

  return {
    make,
    model,
    year,
    mileage,
    condition: vehicle.condition || "used",
    cpo: Boolean(vehicle.cpo || vehicle.certificationTierId || tags.includes("cpo") || title.includes("certified")),
    serviceLoaner: Boolean(vehicle.isServiceLoaner || tags.includes("service-loaner") || title.includes("loaner")),
    demo: Boolean(vehicle.isDemo || tags.includes("demo") || title.includes("demo")),
    commercial: Boolean(vehicle.isCommercial || tags.includes("commercial") || title.includes("commercial") || title.includes("fleet")),
    evOrHybrid: ["ev", "electric", "hybrid", "phev", "plug-in"].some((needle) => fuelType.includes(needle) || title.includes(needle)),
    luxury: LUXURY_MAKES.has(normalize(make)),
  };
};

const stringListMatches = (allowed: string[] | undefined, value?: string | number) => {
  if (!allowed?.length) return true;
  const normalizedValue = normalize(value);
  return allowed.some((candidate) => normalize(candidate) === normalizedValue);
};

export const ruleMatchesVehicle = (
  rule: DealerStickerRule,
  facts: VehicleRuleFacts,
  input: { templateKind: AutoLabelsTemplateKind; storeType?: DealerStickerStoreType },
) => {
  if (!rule.enabled) return false;
  const conditions = rule.conditions;

  if (conditions.templateKind && conditions.templateKind !== input.templateKind) return false;
  if (conditions.vehicleCondition && conditions.vehicleCondition !== facts.condition) return false;
  if (!stringListMatches(conditions.makes, facts.make)) return false;
  if (!stringListMatches(conditions.models, facts.model)) return false;
  if (conditions.minYear && (!facts.year || facts.year < conditions.minYear)) return false;
  if (conditions.maxYear && (!facts.year || facts.year > conditions.maxYear)) return false;
  if (conditions.minMileage && (!facts.mileage || facts.mileage < conditions.minMileage)) return false;
  if (conditions.maxMileage && (!facts.mileage || facts.mileage > conditions.maxMileage)) return false;
  if (conditions.cpo !== undefined && conditions.cpo !== facts.cpo) return false;
  if (conditions.serviceLoaner !== undefined && conditions.serviceLoaner !== facts.serviceLoaner) return false;
  if (conditions.demo !== undefined && conditions.demo !== facts.demo) return false;
  if (conditions.commercial !== undefined && conditions.commercial !== facts.commercial) return false;
  if (conditions.evOrHybrid !== undefined && conditions.evOrHybrid !== facts.evOrHybrid) return false;
  if (conditions.luxury !== undefined && conditions.luxury !== facts.luxury) return false;
  if (conditions.onePriceStore !== undefined && conditions.onePriceStore !== (input.storeType === "one_price")) return false;

  return true;
};

export const buildDefaultStickerRules = (config: Partial<DealerStickerAdminConfig> = {}): DealerStickerRule[] => [
  {
    id: "rule-commercial-window",
    name: "Commercial and fleet vehicles use commercial window sticker",
    enabled: true,
    priority: 100,
    conditions: { templateKind: "used_window_sticker", commercial: true },
    action: { templateId: "used-window:used-window-specialty-commercial-fleet", forcePassportMode: "disabled", forcePlacement: "outside_window", forceImagePreference: "dealer_photo_first" },
  },
  {
    id: "rule-service-loaner-window",
    name: "Service loaners use service loaner window sticker",
    enabled: true,
    priority: 95,
    conditions: { templateKind: "used_window_sticker", serviceLoaner: true },
    action: { templateId: "used-window:used-window-specialty-service-loaner", forcePricingMode: "used_market_value_plus_addendum" },
  },
  {
    id: "rule-demo-window",
    name: "Demo vehicles use demo window sticker",
    enabled: true,
    priority: 94,
    conditions: { templateKind: "used_window_sticker", demo: true },
    action: { templateId: "used-window:used-window-specialty-demo", forceImagePreference: "dealer_photo_first" },
  },
  {
    id: "rule-ev-hybrid-window",
    name: "EV and hybrid used vehicles use EV/hybrid window sticker",
    enabled: true,
    priority: 90,
    conditions: { templateKind: "used_window_sticker", evOrHybrid: true },
    action: { templateId: "used-window:used-window-specialty-ev-hybrid" },
  },
  {
    id: "rule-cpo-window",
    name: "Certified used vehicles use CPO-focused window sticker",
    enabled: true,
    priority: 82,
    conditions: { templateKind: "used_window_sticker", cpo: true },
    action: { templateId: "used-window:used-window-cert-oem-cpo", forceMarketTransparencyMode: config.marketTransparencyMode || "passport_only" },
  },
  {
    id: "rule-luxury-window",
    name: "Luxury used vehicles use luxury window sticker",
    enabled: true,
    priority: 72,
    conditions: { templateKind: "used_window_sticker", luxury: true },
    action: { templateId: "used-window:used-window-luxury-executive-black", forceImagePreference: "transparent_first" },
  },
  {
    id: "rule-one-price-window",
    name: "One-price stores use one-price window sticker",
    enabled: true,
    priority: 70,
    conditions: { templateKind: "used_window_sticker", onePriceStore: true },
    action: { templateId: "used-window:used-window-pricing-one-price", forcePricingMode: "used_live_price_plus_addendum" },
  },
  {
    id: "rule-market-window",
    name: "Market transparency enabled stores use market window sticker",
    enabled: config.marketTransparencyMode !== "off",
    priority: 60,
    conditions: { templateKind: "used_window_sticker" },
    action: { templateId: "used-window:used-window-market-passport-truth", forcePricingMode: "passport_live_price_only" },
  },
  {
    id: "rule-cpo-addendum",
    name: "Certified used vehicles use CPO addendum",
    enabled: true,
    priority: 82,
    conditions: { templateKind: "used_addendum", cpo: true },
    action: { templateId: "used-addendum:used-cert-oem-cpo" },
  },
  {
    id: "rule-luxury-addendum",
    name: "Luxury used vehicles use luxury addendum",
    enabled: true,
    priority: 72,
    conditions: { templateKind: "used_addendum", luxury: true },
    action: { templateId: "used-addendum:used-luxury-executive-black" },
  },
  {
    id: "rule-one-price-addendum",
    name: "One-price stores use one-price addendum",
    enabled: true,
    priority: 70,
    conditions: { templateKind: "used_addendum", onePriceStore: true },
    action: { templateId: "used-addendum:used-pricing-one-price", forcePricingMode: "used_live_price_plus_addendum" },
  },
  {
    id: "rule-market-addendum",
    name: "Market transparency enabled stores use market addendum",
    enabled: config.marketTransparencyMode !== "off",
    priority: 60,
    conditions: { templateKind: "used_addendum" },
    action: { templateId: "used-addendum:used-market-vehicle-passport", forcePricingMode: "passport_live_price_only" },
  },
];

const findTemplate = (templateId?: string) => templateId ? AUTO_LABELS_TEMPLATE_REGISTRY.find((template) => template.id === templateId) : undefined;

const selectRule = (
  config: DealerStickerAdminConfig,
  facts: VehicleRuleFacts,
  templateKind: AutoLabelsTemplateKind,
): DealerStickerRule | undefined => {
  const rules = [...(config.rules || []), ...buildDefaultStickerRules(config)]
    .filter((rule) => ruleMatchesVehicle(rule, facts, { templateKind, storeType: config.storeType }))
    .sort((a, b) => b.priority - a.priority);

  return rules[0];
};

export const resolveDealerStickerDecision = (input: {
  dealer: DealerProfileInput;
  vehicle: VehicleInventoryInput & Record<string, any>;
  templateKind: AutoLabelsTemplateKind;
  config?: Partial<DealerStickerAdminConfig>;
}): TemplateRuleDecision => {
  const config: DealerStickerAdminConfig = {
    ...DEFAULT_DEALER_STICKER_ADMIN_CONFIG,
    oem: input.config?.oem || input.vehicle.make,
    dealerTheme: input.dealer.labelSettings?.theme,
    passportMode: input.dealer.labelSettings?.passportMode || input.config?.passportMode || DEFAULT_DEALER_STICKER_ADMIN_CONFIG.passportMode,
    marketTransparencyMode: input.dealer.labelSettings?.marketTransparencyMode || input.config?.marketTransparencyMode || DEFAULT_DEALER_STICKER_ADMIN_CONFIG.marketTransparencyMode,
    addendumPricingMode: input.dealer.labelSettings?.addendumPricingMode || input.config?.addendumPricingMode || DEFAULT_DEALER_STICKER_ADMIN_CONFIG.addendumPricingMode,
    ...input.config,
  };

  const facts = buildVehicleRuleFacts(input.vehicle);
  const matchedRule = selectRule(config, facts, input.templateKind);
  const passportMode = matchedRule?.action.forcePassportMode || config.passportMode;
  const marketTransparencyMode = matchedRule?.action.forceMarketTransparencyMode || config.marketTransparencyMode;
  const pricingMode = matchedRule?.action.forcePricingMode || config.addendumPricingMode;
  const placement = matchedRule?.action.forcePlacement || config.placement;
  const imagePreference = matchedRule?.action.forceImagePreference || input.vehicle.imagePreference || config.imagePreference;
  const oemTheme = config.useOEMTheme ? getOEMThemePreset(config.oem || input.vehicle.make) : undefined;
  const theme = mergeDealerAndOEMTheme(oemTheme, { ...config.dealerTheme, ...matchedRule?.action.themeOverride });

  const directTemplate = findTemplate(matchedRule?.action.templateId)
    || findTemplate(input.templateKind === "used_window_sticker" ? config.defaultUsedWindowTemplateId : config.defaultUsedAddendumTemplateId);

  const recommendations = recommendTemplates({
    kind: input.templateKind,
    oem: config.oem || input.vehicle.make,
    supportsCPO: facts.cpo || undefined,
    supportsPassport: passportMode === "disabled" ? false : undefined,
    supportsMarketTransparency: marketTransparencyMode === "off" ? false : undefined,
    placement,
    pricingMode,
    passportMode,
    marketTransparencyMode,
    storeType: config.storeType,
    limit: 8,
  });

  const fallbackTemplate = recommendations[0]?.template;
  const template = directTemplate || fallbackTemplate || AUTO_LABELS_TEMPLATE_REGISTRY.find((item) => item.kind === input.templateKind) || AUTO_LABELS_TEMPLATE_REGISTRY[0];

  const image = resolveVehicleImageForSticker({
    ...input.vehicle,
    imagePreference,
  });

  return {
    template,
    templateKind: input.templateKind,
    matchedRule,
    score: directTemplate ? 999 : recommendations[0]?.score || 0,
    reasons: directTemplate ? [matchedRule ? `matched rule: ${matchedRule.name}` : "dealer default template"] : recommendations[0]?.reasons || ["fallback template"],
    passportMode,
    marketTransparencyMode,
    pricingMode,
    placement,
    imagePreference,
    theme,
    image,
    recommendations,
  };
};

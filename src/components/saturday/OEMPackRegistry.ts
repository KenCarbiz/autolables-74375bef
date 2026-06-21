// OEM pack registry for AutoLabels.
// A dealer chooses an OEM/store model and the platform can preload theme, template defaults,
// certification program, market/passport rules, and recommended sticker families.

import { getOEMThemePreset, type OEMThemePreset } from "./OEMThemePresets";
import { getOEMCertificationProgram, type CertificationProgram } from "./CertificationPrograms";
import type { DealerStickerRule, DealerStickerStoreType } from "./TemplateRuleEngine";
import type { AutoLabelsTemplateKind } from "./TemplateRegistry";
import type { SaturdayAddendumPricingMode, SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type OEMPackCategory = "mainstream" | "luxury" | "truck" | "commercial" | "ev" | "performance";

export type OEMPack = {
  id: string;
  name: string;
  makes: string[];
  category: OEMPackCategory;
  defaultStoreType: DealerStickerStoreType;
  theme?: OEMThemePreset;
  certificationProgram?: CertificationProgram;
  preferredTemplateIds: {
    usedWindowSticker?: string;
    usedAddendum?: string;
    cpoWindowSticker?: string;
    cpoAddendum?: string;
    marketWindowSticker?: string;
    marketAddendum?: string;
  };
  defaultSettings: {
    passportMode: SaturdayPassportMode;
    marketTransparencyMode: SaturdayMarketTransparencyMode;
    pricingMode: SaturdayAddendumPricingMode;
    imagePreference: VehicleImagePreference;
    enabledTemplateKinds: AutoLabelsTemplateKind[];
  };
  defaultRules: DealerStickerRule[];
  disclosureNotes: string[];
  tags: string[];
};

const normalize = (value?: string) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

const baseRulesForMake = (make: string, templateIds: OEMPack["preferredTemplateIds"]): DealerStickerRule[] => [
  {
    id: `oem-${normalize(make)}-cpo-window`,
    name: `${make} CPO vehicles use OEM CPO window sticker`,
    enabled: Boolean(templateIds.cpoWindowSticker),
    priority: 120,
    conditions: { templateKind: "used_window_sticker", makes: [make], cpo: true },
    action: { templateId: templateIds.cpoWindowSticker, forcePricingMode: "passport_live_price_only" },
  },
  {
    id: `oem-${normalize(make)}-cpo-addendum`,
    name: `${make} CPO vehicles use OEM CPO addendum`,
    enabled: Boolean(templateIds.cpoAddendum),
    priority: 120,
    conditions: { templateKind: "used_addendum", makes: [make], cpo: true },
    action: { templateId: templateIds.cpoAddendum },
  },
  {
    id: `oem-${normalize(make)}-window`,
    name: `${make} used vehicles use OEM window sticker`,
    enabled: Boolean(templateIds.usedWindowSticker),
    priority: 92,
    conditions: { templateKind: "used_window_sticker", makes: [make] },
    action: { templateId: templateIds.usedWindowSticker },
  },
  {
    id: `oem-${normalize(make)}-addendum`,
    name: `${make} used vehicles use OEM addendum`,
    enabled: Boolean(templateIds.usedAddendum),
    priority: 92,
    conditions: { templateKind: "used_addendum", makes: [make] },
    action: { templateId: templateIds.usedAddendum },
  },
];

const createPack = (input: Omit<OEMPack, "id" | "theme" | "certificationProgram" | "defaultRules"> & { id?: string; rules?: DealerStickerRule[] }): OEMPack => {
  const make = input.makes[0];
  return {
    ...input,
    id: input.id || normalize(make),
    theme: getOEMThemePreset(make),
    certificationProgram: getOEMCertificationProgram(make),
    defaultRules: [...baseRulesForMake(make, input.preferredTemplateIds), ...(input.rules || [])],
  };
};

export const OEM_PACK_REGISTRY: OEMPack[] = [
  createPack({
    name: "INFINITI Luxury Pack",
    makes: ["INFINITI"],
    category: "luxury",
    defaultStoreType: "luxury",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-infiniti",
      usedAddendum: "used-addendum:used-oem-infiniti",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-market-passport-truth",
      marketAddendum: "used-addendum:used-market-vehicle-passport",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "passport_live_price_only", imagePreference: "transparent_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Luxury inventory should favor premium themes, clean/transparent images, passport source-of-truth, and OEM CPO language when eligible."],
    tags: ["infiniti", "luxury", "cpo", "passport"],
  }),
  createPack({
    name: "Hyundai Franchise Pack",
    makes: ["Hyundai"],
    category: "mainstream",
    defaultStoreType: "franchise",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-hyundai",
      usedAddendum: "used-addendum:used-oem-hyundai",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-market-transparency",
      marketAddendum: "used-addendum:used-market-transparency",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_market_value_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Hyundai stores should support OEM CPO, mainstream value positioning, and factory clean image presentation."],
    tags: ["hyundai", "mainstream", "franchise", "cpo"],
  }),
  createPack({
    name: "Toyota Franchise Pack",
    makes: ["Toyota"],
    category: "mainstream",
    defaultStoreType: "franchise",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-toyota",
      usedAddendum: "used-addendum:used-oem-toyota",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-market-transparency",
      marketAddendum: "used-addendum:used-market-transparency",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_market_value_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Toyota stores should favor conservative OEM-style layouts and Toyota Certified messaging when eligible."],
    tags: ["toyota", "mainstream", "franchise", "certified"],
  }),
  createPack({
    name: "Honda Franchise Pack",
    makes: ["Honda"],
    category: "mainstream",
    defaultStoreType: "franchise",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-honda",
      usedAddendum: "used-addendum:used-oem-honda",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-market-transparency",
      marketAddendum: "used-addendum:used-market-transparency",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_market_value_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Honda stores should support HondaTrue language, trust-forward layouts, and simple customer readability."],
    tags: ["honda", "mainstream", "hondatrue", "cpo"],
  }),
  createPack({
    name: "Lexus Luxury Pack",
    makes: ["Lexus"],
    category: "luxury",
    defaultStoreType: "luxury",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-lexus",
      usedAddendum: "used-addendum:used-oem-lexus",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-luxury-signature-collection",
      marketAddendum: "used-addendum:used-luxury-executive-black",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "passport_live_price_only", imagePreference: "transparent_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Lexus stores should favor premium whitespace, restrained language, and L/Certified eligibility."],
    tags: ["lexus", "luxury", "l-certified", "premium"],
  }),
  createPack({
    name: "Ford Franchise / Truck Pack",
    makes: ["Ford"],
    category: "truck",
    defaultStoreType: "franchise",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-ford",
      usedAddendum: "used-addendum:used-oem-ford",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-specialty-truck-suv",
      marketAddendum: "used-addendum:used-specialty-truck-suv",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_market_value_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Ford stores need strong truck/SUV support, capability language, and fleet/commercial routing."],
    tags: ["ford", "truck", "suv", "commercial"],
  }),
  createPack({
    name: "Chevrolet Franchise / Truck Pack",
    makes: ["Chevrolet"],
    category: "truck",
    defaultStoreType: "franchise",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-oem-chevrolet",
      usedAddendum: "used-addendum:used-oem-chevrolet",
      cpoWindowSticker: "used-window:used-window-cert-oem-cpo",
      cpoAddendum: "used-addendum:used-cert-oem-cpo",
      marketWindowSticker: "used-window:used-window-specialty-truck-suv",
      marketAddendum: "used-addendum:used-specialty-truck-suv",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_market_value_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Chevrolet stores need OEM-style layouts and truck/SUV capability routing."],
    tags: ["chevrolet", "chevy", "truck", "suv"],
  }),
  createPack({
    name: "Independent One Price Pack",
    makes: ["Generic"],
    category: "mainstream",
    defaultStoreType: "one_price",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-pricing-one-price",
      usedAddendum: "used-addendum:used-pricing-one-price",
      marketWindowSticker: "used-window:used-window-pricing-value-leader",
      marketAddendum: "used-addendum:used-pricing-best-price",
    },
    defaultSettings: { passportMode: "enabled", marketTransparencyMode: "passport_only", pricingMode: "used_live_price_plus_addendum", imagePreference: "factory_clean_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Independent one-price stores should favor price clarity, no-haggle language, and dealer-selected trust source."],
    tags: ["independent", "one-price", "best-price", "no-haggle"],
  }),
  createPack({
    name: "Commercial / Fleet Pack",
    makes: ["Commercial"],
    category: "commercial",
    defaultStoreType: "commercial",
    preferredTemplateIds: {
      usedWindowSticker: "used-window:used-window-specialty-commercial-fleet",
      usedAddendum: "used-addendum:used-specialty-commercial-fleet",
      marketWindowSticker: "used-window:used-window-specialty-truck-suv",
      marketAddendum: "used-addendum:used-specialty-commercial-fleet",
    },
    defaultSettings: { passportMode: "disabled", marketTransparencyMode: "off", pricingMode: "used_addendum_only", imagePreference: "dealer_photo_first", enabledTemplateKinds: ["used_window_sticker", "used_addendum"] },
    disclosureNotes: ["Commercial dealers may prefer no-passport, no-market layouts with dealer-photo-first imagery and direct equipment information."],
    tags: ["commercial", "fleet", "work-truck", "no-passport"],
  }),
];

export const OEM_PACK_BY_ID = Object.fromEntries(OEM_PACK_REGISTRY.map((pack) => [pack.id, pack]));

export const findOEMPack = (make?: string, storeType?: DealerStickerStoreType) => {
  const key = normalize(make);
  const exact = OEM_PACK_REGISTRY.find((pack) => pack.makes.some((candidate) => normalize(candidate) === key));
  if (exact) return exact;
  if (storeType === "one_price") return OEM_PACK_REGISTRY.find((pack) => pack.id === "generic");
  if (storeType === "commercial") return OEM_PACK_REGISTRY.find((pack) => pack.id === "commercial");
  return undefined;
};

export const getOEMPackDefaults = (make?: string, storeType?: DealerStickerStoreType) => {
  const pack = findOEMPack(make, storeType);
  if (!pack) return undefined;

  return {
    storeType: pack.defaultStoreType,
    passportMode: pack.defaultSettings.passportMode,
    marketTransparencyMode: pack.defaultSettings.marketTransparencyMode,
    pricingMode: pack.defaultSettings.pricingMode,
    imagePreference: pack.defaultSettings.imagePreference,
    enabledTemplateKinds: pack.defaultSettings.enabledTemplateKinds,
    defaultUsedWindowTemplateId: pack.preferredTemplateIds.usedWindowSticker,
    defaultUsedAddendumTemplateId: pack.preferredTemplateIds.usedAddendum,
    theme: pack.theme,
    certificationProgram: pack.certificationProgram,
    rules: pack.defaultRules,
  };
};

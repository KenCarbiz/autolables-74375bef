// Dealer Sticker Admin Model
// This is the dealer-facing configuration layer for AutoLabels.
// It defines what a dealer can turn on/off, override, and rule-control in the admin panel.

import type {
  DealerStickerAdminConfig,
  DealerStickerRule,
  DealerStickerStoreType,
} from "./TemplateRuleEngine";
import type {
  AutoLabelsTemplateKind,
  AutoLabelsTemplatePlacement,
} from "./TemplateRegistry";
import type {
  SaturdayAddendumPricingMode,
  SaturdayDealerTheme,
  SaturdayMarketTransparencyMode,
  SaturdayPassportMode,
  SaturdayReviewSourceType,
} from "./types";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type StickerAdminSectionId =
  | "dealer_profile"
  | "template_defaults"
  | "passport"
  | "market_transparency"
  | "pricing_language"
  | "certification"
  | "trust_source"
  | "theme"
  | "image_strategy"
  | "rule_builder";

export type AdminToggleState = "enabled" | "disabled" | "rules_based";

export type DealerPricingLanguageConfig = {
  defaultPriceLabel:
    | "Best Price"
    | "Best Price First"
    | "One Price"
    | "Market Price"
    | "Market Value"
    | "Selling Price"
    | "Internet Price"
    | "Advertised Price"
    | "Asking Price"
    | "Custom";
  customPriceLabel?: string;
  addendumPricingMode: SaturdayAddendumPricingMode;
  allowVehicleLevelOverride: boolean;
};

export type DealerCertificationConfig = {
  enabled: boolean;
  defaultCertificationLabel:
    | "Certified Pre-Owned"
    | "CPO"
    | "OEM Certified Pre-Owned"
    | "Dealer Certified Pre-Owned"
    | "Dealer Certified"
    | "Certified Vehicle"
    | "Inspection Certified"
    | "Warranty Eligible"
    | "Custom";
  customCertificationLabel?: string;
  allowTieredCoverage: boolean;
  allowFinanceUpgradeCoverage: boolean;
};

export type DealerTrustSourceConfig = {
  enabled: boolean;
  sourceType: SaturdayReviewSourceType;
  label: string;
  rating?: number;
  reviewCount?: number;
  profileUrl?: string;
  manuallyEntered: boolean;
  allowAutomatedFetch: boolean;
  showOnWindowSticker: boolean;
  showOnAddendum: boolean;
  showInPassport: boolean;
};

export type DealerPassportAdminConfig = {
  mode: SaturdayPassportMode;
  qrVisibility: "large" | "standard" | "small" | "hidden" | "none";
  destination: "vehicle_passport" | "vdp" | "dealer_website" | "lead_form" | "custom_url";
  customUrl?: string;
  showLivePrice: boolean;
  showMarketData: boolean;
  showInspection: boolean;
  showDealerTrust: boolean;
  showDigitalSigning: boolean;
};

export type DealerThemeAdminConfig = {
  useOEMTheme: boolean;
  allowDealerOverride: boolean;
  dealerTheme?: SaturdayDealerTheme;
  lockedThemeFields?: Array<keyof SaturdayDealerTheme>;
};

export type DealerImageStrategyConfig = {
  preference: VehicleImagePreference;
  requestFactoryCleanImageWhenMissing: boolean;
  allowDealerPhotoFallback: boolean;
  allowTemplateIllustrationFallback: boolean;
};

export type DealerTemplateDefaultsConfig = {
  enabledTemplateKinds: AutoLabelsTemplateKind[];
  defaultUsedWindowTemplateId?: string;
  defaultUsedAddendumTemplateId?: string;
  disabledTemplateIds: string[];
  favoriteTemplateIds: string[];
  placement: AutoLabelsTemplatePlacement;
};

export type DealerStickerAdminPanelConfig = {
  dealerId?: string;
  storeType: DealerStickerStoreType;
  primaryOEM?: string;
  enabled: boolean;
  sections: Record<StickerAdminSectionId, AdminToggleState>;
  templateDefaults: DealerTemplateDefaultsConfig;
  passport: DealerPassportAdminConfig;
  marketTransparencyMode: SaturdayMarketTransparencyMode;
  pricing: DealerPricingLanguageConfig;
  certification: DealerCertificationConfig;
  trustSource: DealerTrustSourceConfig;
  theme: DealerThemeAdminConfig;
  imageStrategy: DealerImageStrategyConfig;
  rules: DealerStickerRule[];
};

export const DEFAULT_DEALER_STICKER_ADMIN_PANEL: DealerStickerAdminPanelConfig = {
  storeType: "franchise",
  enabled: true,
  sections: {
    dealer_profile: "enabled",
    template_defaults: "enabled",
    passport: "enabled",
    market_transparency: "enabled",
    pricing_language: "enabled",
    certification: "enabled",
    trust_source: "enabled",
    theme: "enabled",
    image_strategy: "enabled",
    rule_builder: "rules_based",
  },
  templateDefaults: {
    enabledTemplateKinds: ["used_window_sticker", "used_addendum"],
    disabledTemplateIds: [],
    favoriteTemplateIds: [],
    placement: "inside_window",
  },
  passport: {
    mode: "enabled",
    qrVisibility: "standard",
    destination: "vehicle_passport",
    showLivePrice: true,
    showMarketData: true,
    showInspection: true,
    showDealerTrust: true,
    showDigitalSigning: false,
  },
  marketTransparencyMode: "passport_only",
  pricing: {
    defaultPriceLabel: "Advertised Price",
    addendumPricingMode: "used_market_value_plus_addendum",
    allowVehicleLevelOverride: true,
  },
  certification: {
    enabled: true,
    defaultCertificationLabel: "Certified Pre-Owned",
    allowTieredCoverage: true,
    allowFinanceUpgradeCoverage: true,
  },
  trustSource: {
    enabled: true,
    sourceType: "google",
    label: "Google Reviews",
    manuallyEntered: false,
    allowAutomatedFetch: true,
    showOnWindowSticker: true,
    showOnAddendum: true,
    showInPassport: true,
  },
  theme: {
    useOEMTheme: true,
    allowDealerOverride: true,
  },
  imageStrategy: {
    preference: "factory_clean_first",
    requestFactoryCleanImageWhenMissing: true,
    allowDealerPhotoFallback: true,
    allowTemplateIllustrationFallback: true,
  },
  rules: [],
};

export const toRuleEngineConfig = (admin: DealerStickerAdminPanelConfig): DealerStickerAdminConfig => ({
  dealerId: admin.dealerId,
  storeType: admin.storeType,
  oem: admin.primaryOEM,
  enabled: admin.enabled,
  enabledTemplateKinds: admin.templateDefaults.enabledTemplateKinds,
  enabledTemplateIds: admin.templateDefaults.favoriteTemplateIds,
  disabledTemplateIds: admin.templateDefaults.disabledTemplateIds,
  defaultUsedWindowTemplateId: admin.templateDefaults.defaultUsedWindowTemplateId,
  defaultUsedAddendumTemplateId: admin.templateDefaults.defaultUsedAddendumTemplateId,
  passportMode: admin.passport.mode,
  marketTransparencyMode: admin.marketTransparencyMode,
  addendumPricingMode: admin.pricing.addendumPricingMode,
  placement: admin.templateDefaults.placement,
  imagePreference: admin.imageStrategy.preference,
  dealerTheme: admin.theme.dealerTheme,
  useOEMTheme: admin.theme.useOEMTheme,
  rules: admin.rules,
});

export const ADMIN_RULE_TEMPLATES: DealerStickerRule[] = [
  {
    id: "admin-rule-cpo-used",
    name: "Certified vehicles use CPO templates",
    enabled: true,
    priority: 80,
    conditions: { vehicleCondition: "used", cpo: true },
    action: { forceMarketTransparencyMode: "passport_only" },
  },
  {
    id: "admin-rule-luxury-used",
    name: "Luxury brands use premium templates",
    enabled: true,
    priority: 70,
    conditions: { vehicleCondition: "used", luxury: true },
    action: { forceImagePreference: "transparent_first" },
  },
  {
    id: "admin-rule-commercial-used",
    name: "Commercial vehicles use simple exterior stickers",
    enabled: true,
    priority: 95,
    conditions: { vehicleCondition: "used", commercial: true },
    action: { forcePassportMode: "disabled", forcePlacement: "outside_window", forceImagePreference: "dealer_photo_first" },
  },
  {
    id: "admin-rule-market-passport",
    name: "Market strategy uses passport live price",
    enabled: true,
    priority: 60,
    conditions: { vehicleCondition: "used" },
    action: { forcePricingMode: "passport_live_price_only", forceMarketTransparencyMode: "passport_only" },
  },
];

export const ADMIN_PANEL_SECTIONS: Array<{ id: StickerAdminSectionId; label: string; description: string }> = [
  { id: "dealer_profile", label: "Dealer Profile", description: "Dealer name, address, website, phone, slogan, and rooftop identity." },
  { id: "template_defaults", label: "Template Defaults", description: "Default window sticker, addendum, favorites, disabled templates, and placement." },
  { id: "passport", label: "Passport", description: "Turn vehicle passport and QR strategy on, off, or rules-based." },
  { id: "market_transparency", label: "Market Transparency", description: "Control whether market data appears on print, passport, both, selected templates, or not at all." },
  { id: "pricing_language", label: "Pricing Language", description: "Dealer-selected price label and pricing strategy for print and passport." },
  { id: "certification", label: "Certification", description: "CPO naming, dealer certification, warranty tiers, and finance upgrade coverage." },
  { id: "trust_source", label: "Trust Source", description: "Google, Facebook, BBB, Cars.com, DealerRater, CarGurus, Yelp, or custom review source." },
  { id: "theme", label: "Theme", description: "OEM colors, dealer frame colors, accent colors, and lockable brand fields." },
  { id: "image_strategy", label: "Image Strategy", description: "Factory clean API images, transparent vehicle images, dealer photos, and fallbacks." },
  { id: "rule_builder", label: "Rule Builder", description: "Dealer-created rules for choosing templates and settings by vehicle type." },
];

// Dealer sticker admin configuration model.
// This is the shape the admin panel should save/load so a dealer can turn on the options
// they want, disable what they do not want, and override template selection rules.

import type { SaturdayAddendumPricingMode, SaturdayDealerTheme, SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";
import type { AutoLabelsTemplateKind, AutoLabelsTemplatePlacement } from "./TemplateRegistry";
import type { DealerStickerRule, DealerStickerStoreType } from "./TemplateRuleEngine";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type DealerQRCodeDestination =
  | "vehicle_passport"
  | "dealer_vdp"
  | "lead_form"
  | "dealer_homepage"
  | "service_page"
  | "custom_url";

export type DealerQRVisibility = "featured" | "standard" | "small" | "hidden" | "disabled";

export type DealerTrustSourceMode =
  | "google"
  | "facebook"
  | "bbb"
  | "cars_com"
  | "dealer_rater"
  | "car_gurus"
  | "edmunds"
  | "yelp"
  | "custom"
  | "disabled";

export type DealerStickerAdminState = {
  dealerId: string;
  storeType: DealerStickerStoreType;
  oem?: string;
  enabled: boolean;
  branding: {
    useOEMTheme: boolean;
    dealerTheme?: SaturdayDealerTheme;
    logoUrl?: string;
    slogan?: string;
  };
  passport: {
    mode: SaturdayPassportMode;
    qrDestination: DealerQRCodeDestination;
    qrVisibility: DealerQRVisibility;
    customUrl?: string;
  };
  pricing: {
    label: string;
    customLabel?: string;
    addendumMode: SaturdayAddendumPricingMode;
  };
  marketTransparency: {
    mode: SaturdayMarketTransparencyMode;
    showComps: boolean;
    showBlackBook: boolean;
    showRecentSoldAverage: boolean;
  };
  trust: {
    source: DealerTrustSourceMode;
    customLabel?: string;
    rating?: number;
    reviewCount?: number;
    allowAutomatedFetch: boolean;
  };
  images: {
    preference: VehicleImagePreference;
    requireFactoryCleanWhenAvailable: boolean;
    allowDealerPhotoFallback: boolean;
  };
  print: {
    defaultPlacement: AutoLabelsTemplatePlacement;
    allowOutsideWindowLabels: boolean;
    largeWindowStickerSize: "8.5x11";
    addendumStickerSize: "4.5x11";
  };
  templates: {
    enabledKinds: AutoLabelsTemplateKind[];
    enabledTemplateIds: string[];
    disabledTemplateIds: string[];
    defaultUsedWindowTemplateId?: string;
    defaultUsedAddendumTemplateId?: string;
  };
  rules: DealerStickerRule[];
};

export const DEFAULT_DEALER_STICKER_ADMIN_STATE: DealerStickerAdminState = {
  dealerId: "",
  storeType: "franchise",
  enabled: true,
  branding: {
    useOEMTheme: true,
  },
  passport: {
    mode: "enabled",
    qrDestination: "vehicle_passport",
    qrVisibility: "standard",
  },
  pricing: {
    label: "Advertised Price",
    addendumMode: "used_market_value_plus_addendum",
  },
  marketTransparency: {
    mode: "passport_only",
    showComps: true,
    showBlackBook: true,
    showRecentSoldAverage: true,
  },
  trust: {
    source: "google",
    allowAutomatedFetch: false,
  },
  images: {
    preference: "factory_clean_first",
    requireFactoryCleanWhenAvailable: true,
    allowDealerPhotoFallback: true,
  },
  print: {
    defaultPlacement: "inside_window",
    allowOutsideWindowLabels: true,
    largeWindowStickerSize: "8.5x11",
    addendumStickerSize: "4.5x11",
  },
  templates: {
    enabledKinds: ["used_window_sticker", "used_addendum"],
    enabledTemplateIds: [],
    disabledTemplateIds: [],
  },
  rules: [],
};

export const toRuleEngineConfig = (state: DealerStickerAdminState) => ({
  dealerId: state.dealerId,
  storeType: state.storeType,
  oem: state.oem,
  enabled: state.enabled,
  enabledTemplateKinds: state.templates.enabledKinds,
  enabledTemplateIds: state.templates.enabledTemplateIds,
  disabledTemplateIds: state.templates.disabledTemplateIds,
  defaultUsedWindowTemplateId: state.templates.defaultUsedWindowTemplateId,
  defaultUsedAddendumTemplateId: state.templates.defaultUsedAddendumTemplateId,
  passportMode: state.passport.mode,
  marketTransparencyMode: state.marketTransparency.mode,
  addendumPricingMode: state.pricing.addendumMode,
  placement: state.print.defaultPlacement,
  imagePreference: state.images.preference,
  dealerTheme: state.branding.dealerTheme,
  useOEMTheme: state.branding.useOEMTheme,
  rules: state.rules,
});

export const createDealerStickerAdminState = (overrides: Partial<DealerStickerAdminState> = {}): DealerStickerAdminState => ({
  ...DEFAULT_DEALER_STICKER_ADMIN_STATE,
  ...overrides,
  branding: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.branding, ...overrides.branding },
  passport: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.passport, ...overrides.passport },
  pricing: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.pricing, ...overrides.pricing },
  marketTransparency: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.marketTransparency, ...overrides.marketTransparency },
  trust: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.trust, ...overrides.trust },
  images: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.images, ...overrides.images },
  print: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.print, ...overrides.print },
  templates: { ...DEFAULT_DEALER_STICKER_ADMIN_STATE.templates, ...overrides.templates },
  rules: overrides.rules || DEFAULT_DEALER_STICKER_ADMIN_STATE.rules,
});

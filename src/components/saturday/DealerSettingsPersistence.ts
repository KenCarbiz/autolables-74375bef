// Dealer settings persistence contract for the Connecticut-first AutoLabels launch.
// This file defines the durable settings shape we need before wiring the Supabase tables/UI.
// It intentionally separates dealer-level choices from vehicle/inventory data.

import type { DealerStickerAdminState } from "./DealerStickerAdminConfig";
import type { DealerStickerRule } from "./TemplateRuleEngine";
import type { CertificationProgram } from "./CertificationPrograms";
import type { DealerReviewSelection, DealerProfileInput } from "./wiring";
import type { SaturdayAddendumPricingMode, SaturdayDealerTheme, SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type DealerSettingsPersistenceStatus = "draft" | "active" | "archived";

export type ConnecticutLaunchDocumentToggle = {
  newCarAddendum: boolean;
  usedWindowSticker: boolean;
  usedAddendumSticker: boolean;
  ftcBuyersGuide: boolean;
  ctK208: boolean;
  vehiclePassport: boolean;
};

export type DealerTemplateDefaults = {
  defaultUsedWindowTemplateId?: string;
  defaultUsedAddendumTemplateId?: string;
  defaultNewAddendumTemplateId?: string;
  defaultNewMonroneyTemplateId?: string;
};

export type DealerPricingSettings = {
  priceLabel: string;
  customPriceLabel?: string;
  addendumPricingMode: SaturdayAddendumPricingMode;
  showMsrpOnNewAddendum: boolean;
  showDealerAccessoriesOnNewAddendum: boolean;
  allowMarketAdjustmentOnNewAddendum: boolean;
};

export type DealerPassportSettings = {
  mode: SaturdayPassportMode;
  qrDestination: "vehicle_passport" | "dealer_vdp" | "lead_form" | "dealer_homepage" | "custom_url";
  qrVisibility: "featured" | "standard" | "small" | "hidden" | "disabled";
  customUrl?: string;
};

export type DealerComplianceSettings = {
  launchState: "CT";
  ftcBuyersGuideEnabled: boolean;
  ftcSpanishEnabled: boolean;
  ctK208Enabled: boolean;
  ctK208ServiceSignoffRequired: boolean;
  ctK208CustomerSignatureRequired: boolean;
  warrantyRuleMode: "connecticut_first" | "manual_review";
  counselReviewRequired: boolean;
};

export type DealerImageSettings = {
  preference: VehicleImagePreference;
  requireFactoryCleanWhenAvailable: boolean;
  allowDealerPhotoFallback: boolean;
};

export type DealerPersistentSettings = {
  id: string;
  dealerId: string;
  tenantId?: string;
  status: DealerSettingsPersistenceStatus;
  version: number;
  dealerProfile: DealerProfileInput & {
    city?: string;
    state?: string;
    zip?: string;
    principal?: string;
    dealerLicenseNumber?: string;
    oemBrands?: string[];
  };
  branding: {
    useOEMTheme: boolean;
    theme?: SaturdayDealerTheme;
    logoUrl?: string;
    slogan?: string;
  };
  pricing: DealerPricingSettings;
  passport: DealerPassportSettings;
  marketTransparency: {
    mode: SaturdayMarketTransparencyMode;
    showComps: boolean;
    showBlackBook: boolean;
    showRecentSoldAverage: boolean;
  };
  trust: {
    reviewSource?: DealerReviewSelection;
    allowAutomatedFetch: boolean;
  };
  images: DealerImageSettings;
  templates: DealerTemplateDefaults & {
    enabledTemplateIds: string[];
    disabledTemplateIds: string[];
  };
  certificationPrograms: CertificationProgram[];
  rules: DealerStickerRule[];
  launchDocuments: ConnecticutLaunchDocumentToggle;
  compliance: DealerComplianceSettings;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export const DEFAULT_CONNECTICUT_LAUNCH_DOCUMENTS: ConnecticutLaunchDocumentToggle = {
  newCarAddendum: true,
  usedWindowSticker: true,
  usedAddendumSticker: true,
  ftcBuyersGuide: true,
  ctK208: true,
  vehiclePassport: true,
};

export const createDefaultDealerPersistentSettings = (input: {
  dealerId: string;
  tenantId?: string;
  dealerName?: string;
  updatedBy?: string;
}): DealerPersistentSettings => {
  const now = new Date().toISOString();
  return {
    id: `dealer-settings-${input.dealerId}`,
    dealerId: input.dealerId,
    tenantId: input.tenantId,
    status: "draft",
    version: 1,
    dealerProfile: {
      name: input.dealerName || "Connecticut Dealer",
      address: "",
      phone: "",
      website: "",
      state: "CT",
      oemBrands: [],
      labelSettings: {
        priceLabel: "Advertised Price",
        passportMode: "enabled",
        marketTransparencyMode: "passport_only",
        addendumPricingMode: "used_market_value_plus_addendum",
      },
    },
    branding: {
      useOEMTheme: true,
    },
    pricing: {
      priceLabel: "Advertised Price",
      addendumPricingMode: "used_market_value_plus_addendum",
      showMsrpOnNewAddendum: true,
      showDealerAccessoriesOnNewAddendum: true,
      allowMarketAdjustmentOnNewAddendum: true,
    },
    passport: {
      mode: "enabled",
      qrDestination: "vehicle_passport",
      qrVisibility: "standard",
    },
    marketTransparency: {
      mode: "passport_only",
      showComps: true,
      showBlackBook: true,
      showRecentSoldAverage: true,
    },
    trust: {
      allowAutomatedFetch: false,
    },
    images: {
      preference: "factory_clean_first",
      requireFactoryCleanWhenAvailable: true,
      allowDealerPhotoFallback: true,
    },
    templates: {
      enabledTemplateIds: [],
      disabledTemplateIds: [],
    },
    certificationPrograms: [],
    rules: [],
    launchDocuments: { ...DEFAULT_CONNECTICUT_LAUNCH_DOCUMENTS },
    compliance: {
      launchState: "CT",
      ftcBuyersGuideEnabled: true,
      ftcSpanishEnabled: true,
      ctK208Enabled: true,
      ctK208ServiceSignoffRequired: true,
      ctK208CustomerSignatureRequired: true,
      warrantyRuleMode: "connecticut_first",
      counselReviewRequired: true,
    },
    createdAt: now,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
};

export const mergeDealerPersistentSettings = (
  existing: DealerPersistentSettings,
  patch: Partial<DealerPersistentSettings>,
  updatedBy?: string,
): DealerPersistentSettings => ({
  ...existing,
  ...patch,
  dealerProfile: { ...existing.dealerProfile, ...patch.dealerProfile },
  branding: { ...existing.branding, ...patch.branding },
  pricing: { ...existing.pricing, ...patch.pricing },
  passport: { ...existing.passport, ...patch.passport },
  marketTransparency: { ...existing.marketTransparency, ...patch.marketTransparency },
  trust: { ...existing.trust, ...patch.trust },
  images: { ...existing.images, ...patch.images },
  templates: { ...existing.templates, ...patch.templates },
  launchDocuments: { ...existing.launchDocuments, ...patch.launchDocuments },
  compliance: { ...existing.compliance, ...patch.compliance },
  version: existing.version + 1,
  updatedAt: new Date().toISOString(),
  updatedBy,
});

export const toDealerAdminStateFromPersistentSettings = (settings: DealerPersistentSettings): Partial<DealerStickerAdminState> => ({
  dealerId: settings.dealerId,
  storeType: "franchise",
  oem: settings.dealerProfile.oemBrands?.[0],
  branding: {
    useOEMTheme: settings.branding.useOEMTheme,
    dealerTheme: settings.branding.theme,
    logoUrl: settings.branding.logoUrl,
    slogan: settings.branding.slogan,
  },
  passport: {
    mode: settings.passport.mode,
    qrDestination: settings.passport.qrDestination,
    qrVisibility: settings.passport.qrVisibility,
    customUrl: settings.passport.customUrl,
  },
  pricing: {
    label: settings.pricing.priceLabel,
    customLabel: settings.pricing.customPriceLabel,
    addendumMode: settings.pricing.addendumPricingMode,
  },
  marketTransparency: settings.marketTransparency,
  images: settings.images,
  templates: {
    enabledKinds: ["used_window_sticker", "used_addendum"],
    enabledTemplateIds: settings.templates.enabledTemplateIds,
    disabledTemplateIds: settings.templates.disabledTemplateIds,
    defaultUsedWindowTemplateId: settings.templates.defaultUsedWindowTemplateId,
    defaultUsedAddendumTemplateId: settings.templates.defaultUsedAddendumTemplateId,
  },
  rules: settings.rules,
});

export const DEALER_SETTINGS_SUPABASE_TABLES = [
  {
    table: "dealer_autolabel_settings",
    purpose: "One row per dealer/tenant containing core branding, pricing, passport, market, compliance, and launch document toggles.",
  },
  {
    table: "dealer_template_preferences",
    purpose: "Normalized enabled/disabled/default template selections for queryable template management.",
  },
  {
    table: "dealer_template_rules",
    purpose: "IF/THEN rule builder records that feed TemplateRuleEngine.",
  },
  {
    table: "dealer_certification_programs",
    purpose: "Dealer-defined CPO/warranty upgrade programs and disclosures.",
  },
];

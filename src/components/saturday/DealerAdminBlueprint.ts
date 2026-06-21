// Dealer admin blueprint for AutoLabels.
// This file describes the admin sections and controls needed for dealers to configure
// templates, passport usage, pricing language, OEM themes, certification, and rule overrides.

import type { DealerStickerAdminState } from "./DealerStickerAdminConfig";
import type { DealerStickerRule } from "./TemplateRuleEngine";

export type DealerAdminControlType =
  | "toggle"
  | "select"
  | "multi_select"
  | "text"
  | "url"
  | "number"
  | "color"
  | "template_picker"
  | "rule_builder"
  | "review_source_picker";

export type DealerAdminControl = {
  id: string;
  label: string;
  description: string;
  type: DealerAdminControlType;
  required?: boolean;
  options?: Array<{ label: string; value: string; description?: string }>;
};

export type DealerAdminSection = {
  id: string;
  title: string;
  description: string;
  priority: number;
  controls: DealerAdminControl[];
};

export const DEALER_ADMIN_BLUEPRINT: DealerAdminSection[] = [
  {
    id: "store-profile",
    title: "Store Profile",
    description: "Define the store model so AutoLabels can recommend the right sticker families and OEM pack.",
    priority: 10,
    controls: [
      {
        id: "storeType",
        label: "Store Type",
        description: "Used by the rule engine to favor franchise, luxury, one-price, commercial, or high-volume templates.",
        type: "select",
        required: true,
        options: [
          { label: "Franchise", value: "franchise" },
          { label: "Independent", value: "independent" },
          { label: "Luxury", value: "luxury" },
          { label: "One Price", value: "one_price" },
          { label: "High Volume", value: "high_volume" },
          { label: "Commercial / Fleet", value: "commercial" },
          { label: "Special Finance", value: "special_finance" },
        ],
      },
      { id: "oem", label: "Primary OEM", description: "Loads OEM themes, CPO language, and recommended template packs.", type: "select" },
      { id: "slogan", label: "Dealer Slogan", description: "Optional line shown in header areas when enabled.", type: "text" },
    ],
  },
  {
    id: "branding",
    title: "Branding & Theme",
    description: "Choose whether stickers inherit OEM branding, dealer colors, or a blend of both.",
    priority: 20,
    controls: [
      { id: "branding.useOEMTheme", label: "Use OEM Theme", description: "Start with manufacturer-aligned colors and layout style.", type: "toggle" },
      { id: "branding.logoUrl", label: "Dealer Logo", description: "Optional logo for print and passport headers.", type: "url" },
      { id: "branding.dealerTheme.primaryColor", label: "Primary Color", description: "Main frame/header color.", type: "color" },
      { id: "branding.dealerTheme.secondaryColor", label: "Secondary Color", description: "Supporting color for panels and section headers.", type: "color" },
      { id: "branding.dealerTheme.accentColor", label: "Accent Color", description: "Highlight color for value, savings, badges, and CTAs.", type: "color" },
    ],
  },
  {
    id: "passport",
    title: "Vehicle Passport",
    description: "Decide whether the sticker launches the digital passport, dealer VDP, lead form, or no QR experience.",
    priority: 30,
    controls: [
      {
        id: "passport.mode",
        label: "Passport Mode",
        description: "Controls whether passport/QR modules render on stickers.",
        type: "select",
        required: true,
        options: [
          { label: "Enabled", value: "enabled", description: "Show passport/QR where supported." },
          { label: "Disabled", value: "disabled", description: "No QR or passport language." },
          { label: "Selected Templates Only", value: "selected_templates_only", description: "Only enabled templates can show passport modules." },
        ],
      },
      {
        id: "passport.qrDestination",
        label: "QR Destination",
        description: "Where the QR code should send shoppers.",
        type: "select",
        options: [
          { label: "Vehicle Passport", value: "vehicle_passport" },
          { label: "Dealer VDP", value: "dealer_vdp" },
          { label: "Lead Form", value: "lead_form" },
          { label: "Dealer Homepage", value: "dealer_homepage" },
          { label: "Service Page", value: "service_page" },
          { label: "Custom URL", value: "custom_url" },
        ],
      },
      {
        id: "passport.qrVisibility",
        label: "QR Visibility",
        description: "Controls how prominent the QR is on print.",
        type: "select",
        options: [
          { label: "Featured", value: "featured" },
          { label: "Standard", value: "standard" },
          { label: "Small", value: "small" },
          { label: "Hidden", value: "hidden" },
          { label: "Disabled", value: "disabled" },
        ],
      },
    ],
  },
  {
    id: "pricing",
    title: "Pricing Strategy",
    description: "Controls what printed stickers say versus what the passport/VDP uses as the live source of truth.",
    priority: 40,
    controls: [
      {
        id: "pricing.label",
        label: "Printed Price Label",
        description: "Dealer-selected terminology such as Best Price, Market Value, One Price, or Selling Price.",
        type: "select",
        options: [
          { label: "Advertised Price", value: "Advertised Price" },
          { label: "Best Price", value: "Best Price" },
          { label: "One Price", value: "One Price" },
          { label: "Market Value", value: "Market Value" },
          { label: "Selling Price", value: "Selling Price" },
          { label: "Internet Price", value: "Internet Price" },
          { label: "Custom", value: "Custom" },
        ],
      },
      {
        id: "pricing.addendumMode",
        label: "Used Addendum Pricing Mode",
        description: "Determines whether printed used labels show addendum-only, market value, live price, or passport-only price.",
        type: "select",
        options: [
          { label: "Addendum Only", value: "used_addendum_only" },
          { label: "Market Value + Addendum", value: "used_market_value_plus_addendum" },
          { label: "Advertised Price + Addendum", value: "used_live_price_plus_addendum" },
          { label: "Passport Live Price Only", value: "passport_live_price_only" },
        ],
      },
    ],
  },
  {
    id: "market-transparency",
    title: "Market Transparency",
    description: "Configure how MarketCheck, Black Book, comparable vehicles, and recent sales appear on print and passport.",
    priority: 50,
    controls: [
      {
        id: "marketTransparency.mode",
        label: "Market Transparency Mode",
        description: "Controls whether market data appears on print, passport, selected templates, or not at all.",
        type: "select",
        options: [
          { label: "Off", value: "off" },
          { label: "Passport Only", value: "passport_only" },
          { label: "Print + Passport", value: "print_and_passport" },
          { label: "Selected Templates Only", value: "selected_templates_only" },
        ],
      },
      { id: "marketTransparency.showComps", label: "Show Comparable Count", description: "Shows number of comparable vehicles when data is present.", type: "toggle" },
      { id: "marketTransparency.showBlackBook", label: "Show Black Book", description: "Allows Black Book retail/trade values in the passport and supported print templates.", type: "toggle" },
      { id: "marketTransparency.showRecentSoldAverage", label: "Show Recent Sold Average", description: "Displays recent sold average when available.", type: "toggle" },
    ],
  },
  {
    id: "trust-source",
    title: "Dealer Trust Source",
    description: "Dealer selects the review/trust source. No template should invent ratings or review counts.",
    priority: 60,
    controls: [
      {
        id: "trust.source",
        label: "Trust Source",
        description: "Review source used on stickers and passport.",
        type: "review_source_picker",
        options: [
          { label: "Google", value: "google" },
          { label: "Facebook", value: "facebook" },
          { label: "BBB", value: "bbb" },
          { label: "Cars.com", value: "cars_com" },
          { label: "DealerRater", value: "dealer_rater" },
          { label: "CarGurus", value: "car_gurus" },
          { label: "Custom", value: "custom" },
          { label: "Disabled", value: "disabled" },
        ],
      },
      { id: "trust.allowAutomatedFetch", label: "Allow Automated Fetch", description: "Allows approved integration/fetching where supported.", type: "toggle" },
      { id: "trust.rating", label: "Manual Rating", description: "Optional manually entered rating if dealer uses custom/manual trust source.", type: "number" },
      { id: "trust.reviewCount", label: "Manual Review Count", description: "Optional manually entered review count.", type: "number" },
    ],
  },
  {
    id: "images",
    title: "Vehicle Images",
    description: "Controls factory-clean API images, transparent images, dealer photos, and fallbacks.",
    priority: 70,
    controls: [
      {
        id: "images.preference",
        label: "Image Preference",
        description: "Determines the image pipeline priority.",
        type: "select",
        options: [
          { label: "Factory Clean First", value: "factory_clean_first" },
          { label: "Transparent First", value: "transparent_first" },
          { label: "Dealer Photo First", value: "dealer_photo_first" },
          { label: "API Fallback Only", value: "api_fallback_only" },
        ],
      },
      { id: "images.requireFactoryCleanWhenAvailable", label: "Use Factory Clean When Available", description: "Automatically uses clean/low-background API image when available.", type: "toggle" },
      { id: "images.allowDealerPhotoFallback", label: "Allow Dealer Photo Fallback", description: "Uses dealer photos when clean images are not available.", type: "toggle" },
    ],
  },
  {
    id: "templates",
    title: "Template Selection",
    description: "Dealer selects which template families are active and sets preferred defaults.",
    priority: 80,
    controls: [
      { id: "templates.enabledKinds", label: "Enabled Template Types", description: "Used window stickers, used addendums, and future new-vehicle templates.", type: "multi_select" },
      { id: "templates.enabledTemplateIds", label: "Enabled Templates", description: "Active templates the rule engine may select.", type: "template_picker" },
      { id: "templates.disabledTemplateIds", label: "Disabled Templates", description: "Templates blocked from rule-engine selection.", type: "template_picker" },
      { id: "templates.defaultUsedWindowTemplateId", label: "Default Used Window Sticker", description: "Fallback large sticker when no rule matches.", type: "template_picker" },
      { id: "templates.defaultUsedAddendumTemplateId", label: "Default Used Addendum", description: "Fallback addendum when no rule matches.", type: "template_picker" },
    ],
  },
  {
    id: "rules",
    title: "Rules Builder",
    description: "Dealer can override automatic selection rules by vehicle make, model, year, mileage, CPO type, store type, or pricing strategy.",
    priority: 90,
    controls: [
      { id: "rules", label: "Sticker Rules", description: "IF/THEN rules for template selection and overrides.", type: "rule_builder" },
    ],
  },
];

export const getDealerAdminBlueprint = () => DEALER_ADMIN_BLUEPRINT.sort((a, b) => a.priority - b.priority);

export const getRequiredAdminSectionsForSmokeTest = () =>
  DEALER_ADMIN_BLUEPRINT.filter((section) => ["store-profile", "passport", "pricing", "templates", "rules"].includes(section.id));

export const summarizeDealerAdminState = (state: DealerStickerAdminState) => ({
  dealerId: state.dealerId,
  storeType: state.storeType,
  oem: state.oem,
  passportMode: state.passport.mode,
  qrDestination: state.passport.qrDestination,
  pricingLabel: state.pricing.label,
  addendumMode: state.pricing.addendumMode,
  marketTransparencyMode: state.marketTransparency.mode,
  trustSource: state.trust.source,
  imagePreference: state.images.preference,
  placement: state.print.defaultPlacement,
  enabledTemplateKinds: state.templates.enabledKinds,
  enabledTemplateCount: state.templates.enabledTemplateIds.length,
  disabledTemplateCount: state.templates.disabledTemplateIds.length,
  ruleCount: state.rules.length,
});

export const createRuleDescription = (rule: DealerStickerRule) => {
  const conditions = Object.entries(rule.conditions)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : value}`)
    .join(", ");

  const actions = Object.entries(rule.action)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === "object" ? "custom" : value}`)
    .join(", ");

  return `IF ${conditions || "always"} THEN ${actions || "recommend best template"}`;
};

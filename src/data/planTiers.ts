// ──────────────────────────────────────────────────────────────
// Plan Tier Presets
//
// Each tier enables a specific set of features. When a dealer
// picks a tier during onboarding (or upgrades later), all the
// right feature flags flip automatically.
//
// Pricing (per rooftop/month):
//   - essential      $299 — window stickers + addendums, up to 75 VINs/mo
//   - unlimited      $399 — unlimited VINs, product rules, analytics
//   - compliance_pro $899 — full scan-to-signed FTC compliance flow
//
// Prices anchor to the shared platform catalog (AutoCurb `fallbackCatalog`):
// AutoLabels Basic $399 (unlimited) / Premium $899 (full compliance). The
// $299 essential tier is a standalone capped entry below the catalog Basic.
// ──────────────────────────────────────────────────────────────

import type { DealerSettings } from "@/contexts/DealerSettingsContext";

export type PlanTier = "essential" | "unlimited" | "compliance_pro";

// Canonical AutoLabels plan-tier identifiers — the single source of truth for
// every tier dropdown (platform-admin entitlements + tenant tier). Order is
// cheapest → most complete.
export const PLAN_TIER_IDS: PlanTier[] = ["essential", "unlimited", "compliance_pro"];

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  essential: "Essential",
  unlimited: "Unlimited",
  compliance_pro: "Compliance Pro",
};

// Merge an existing (possibly legacy) value into the canonical list so a tenant
// already set to a retired tier still shows its current value in a dropdown.
export const planTierOptions = (current?: string | null): string[] =>
  current && !(PLAN_TIER_IDS as string[]).includes(current)
    ? [current, ...PLAN_TIER_IDS]
    : [...PLAN_TIER_IDS];

// ── Per-tier monthly VIN ceiling. null = unlimited.
export const TIER_VIN_LIMITS: Record<PlanTier, number | null> = {
  essential: 75,
  unlimited: null,
  compliance_pro: null,
};

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  tagline: string;
  price: string;
  priceNote: string;
  features: string[];
  notIncluded?: string[];
  // Bundled free with any Autocurb.io subscription — surface this
  // on marketing + in the ActivatePaywall flow for autocurb-sourced tenants.
  includedWithAutocurb?: boolean;
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: "essential",
    name: "Essential",
    tagline: "Window stickers + addendums, up to 75 VINs/month. Free with any Autocurb.io subscription.",
    price: "$299",
    priceNote: "per rooftop / month — or free with Autocurb.io",
    includedWithAutocurb: true,
    features: [
      "Up to 75 VINs / month",
      "New + used car window stickers",
      "Full addendum builder",
      "VIN decode (NHTSA)",
      "NHTSA recall + Takata stop-sale banner",
      "Shopper-facing public portal (QR + embed)",
      "Zebra / Brother / DYMO / CUPS print",
      "FTC Buyers Guide (English)",
      "Dealer branding + logo",
      "Email support",
    ],
    notIncluded: [
      "Unlimited VINs",
      "Product rules engine",
      "Leads + analytics",
      "Website price verification + nightly scrape",
      "Per-VIN tamper-evident defense file",
      "Digital signing + audit vault",
      "Prep + install compliance gate",
      "50-state disclosure engine",
      "Multi-language addendums",
      "DMS webhooks",
    ],
  },
  {
    tier: "unlimited",
    name: "Unlimited",
    tagline: "Unlimited vehicles for high-volume dealers.",
    price: "$399",
    priceNote: "per rooftop / month",
    features: [
      "Everything in Essential, plus:",
      "Unlimited VINs",
      "Product rules engine (YMM auto-match)",
      "Custom branding + full logo kit",
      "Leads + analytics dashboard",
      "CSV lead export",
      "Inventory management + CSV import",
      "Mobile lot scanner + GPS",
      "AI vehicle descriptions",
      "Co-buyer signature capture",
      "Priority support",
      "Onboarding assist",
    ],
    notIncluded: [
      "Website price verification — hard signing gate",
      "Nightly MarketCheck inventory + advertised-price sync",
      "Per-VIN tamper-evident defense file",
      "Digital signing + tamper-evident audit vault",
      "Prep + install compliance gate",
      "50-state disclosure engine (CA SB 766, NY, FL, etc.)",
      "Multi-language addendums",
      "DMS webhook integrations",
    ],
  },
  {
    tier: "compliance_pro",
    name: "Compliance Pro",
    tagline: "Full scan-to-signed FTC flow for airtight deals.",
    price: "$899",
    priceNote: "per rooftop / month",
    features: [
      "Everything in Unlimited, plus:",
      "Website price verification — hard signing gate (a deal can't be signed out of price integrity)",
      "Automatic nightly MarketCheck inventory + advertised-price sync (baseline 300 VINs; add-ons available)",
      "One-click instant price re-check on any VIN — confirm the deal still matches your live website before the customer signs",
      "Live re-scrape + timestamped website price screenshot evidence",
      "Per-VIN tamper-evident defense file (SHA-256 chain root)",
      "Verified installer sign-off + photo on pre-installed products",
      "50-state disclosure engine (CA, NY, FL, TX, IL, MA, NJ, +44)",
      "California SB 766 ready (effective Oct 1, 2026)",
      "Prep + install compliance gate (foreman sign-off with photos)",
      "Digital signing (customer + co-buyer + F&I manager)",
      "UETA / E-SIGN tamper-evident content hash",
      "Immutable audit vault with CSV export",
      "Multi-language addendums (en / es / zh / tl / vi / ko)",
      "Financing impact disclosure (TILA-aligned)",
      "Deal jacket + email distribution",
      "DMS webhooks (vAuto / VinSolutions / CDK / Reynolds)",
      "Black Book + OEM factory build sheet",
      "SMS delivery (Twilio)",
      "Dedicated success manager",
    ],
  },
];

// Feature flag presets for each tier
export const TIER_FEATURE_FLAGS: Record<PlanTier, Partial<DealerSettings>> = {
  essential: {
    feature_vin_decode: true,
    feature_buyers_guide: true,
    feature_product_rules: false,
    feature_product_icons: true,
    feature_vin_barcode: true,
    feature_lead_capture: false,
    feature_cobuyer_signature: false,
    feature_custom_branding: false,
    feature_ink_saving: true,
    feature_spanish_buyers_guide: false,
    feature_url_scrape: true,
    feature_inventory: false,
    feature_invoicing: false,
    feature_warranty: false,
    feature_payroll: false,
    feature_analytics: false,
    feature_sms: false,
    feature_ai_descriptions: false,
    feature_blackbook: false,
    feature_price_verification: false,
    feature_marketcheck_sync: false,
    privacy_notice_enabled: false,
  },
  unlimited: {
    feature_vin_decode: true,
    feature_buyers_guide: true,
    feature_product_rules: true,
    feature_product_icons: true,
    feature_vin_barcode: true,
    feature_lead_capture: true,
    feature_cobuyer_signature: true,
    feature_custom_branding: true,
    feature_ink_saving: true,
    feature_spanish_buyers_guide: false,
    feature_url_scrape: true,
    feature_inventory: true,
    feature_invoicing: false,
    feature_warranty: false,
    feature_payroll: false,
    feature_analytics: true,
    feature_sms: false,
    feature_ai_descriptions: true,
    feature_blackbook: false,
    feature_price_verification: false,
    feature_marketcheck_sync: false,
    privacy_notice_enabled: true,
  },
  compliance_pro: {
    feature_vin_decode: true,
    feature_buyers_guide: true,
    feature_product_rules: true,
    feature_product_icons: true,
    feature_vin_barcode: true,
    feature_lead_capture: true,
    feature_cobuyer_signature: true,
    feature_custom_branding: true,
    feature_ink_saving: true,
    feature_spanish_buyers_guide: true,
    feature_url_scrape: true,
    feature_inventory: true,
    feature_invoicing: true,
    feature_warranty: true,
    feature_payroll: true,
    feature_analytics: true,
    feature_sms: true,
    feature_ai_descriptions: true,
    feature_blackbook: true,
    feature_price_verification: true,
    feature_marketcheck_sync: true,
    privacy_notice_enabled: true,
  },
};

// ── Scrape add-on bands. The website verification stack is metered (MarketCheck
// + Firecrawl bill per call), so Compliance Pro bundles a baseline and extra
// nightly VIN volume is sold per rooftop. Each band maps directly to
// marketcheck_sync_config.max_vehicles so billing == config.
export interface ScrapeBand {
  id: string;
  name: string;
  maxVehicles: number;   // nightly VIN ceiling (marketcheck_sync_config.max_vehicles)
  price: string;         // per rooftop / month
  note: string;
}

// Baseline included with Compliance Pro before any add-on.
export const COMPLIANCE_PRO_INCLUDED_VINS = 300;

export const SCRAPE_ADDON_BANDS: ScrapeBand[] = [
  { id: "included", name: "Included", maxVehicles: COMPLIANCE_PRO_INCLUDED_VINS, price: "—", note: "Bundled with Compliance Pro" },
  { id: "band_500", name: "+500 VINs", maxVehicles: 800, price: "$99", note: "Mid-size rooftop" },
  { id: "band_2000", name: "+2,000 VINs", maxVehicles: 2300, price: "$199", note: "Large rooftop" },
  { id: "band_6000", name: "+6,000 VINs", maxVehicles: 6300, price: "$299", note: "Mega-store / group rooftop" },
];

export const applyTierPreset = (tier: PlanTier): Partial<DealerSettings> => {
  return TIER_FEATURE_FLAGS[tier];
};

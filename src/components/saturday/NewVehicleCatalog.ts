// New vehicle Monroney-style and addendum catalog.
// First pass: 50 new-vehicle Monroney-style label definitions + 50 new-vehicle addendum definitions.
// These definitions are metadata-first so the admin panel, rule engine, and smoke-test route can
// select, filter, and render the right new-car experience before visual refinement.

import type { AutoLabelsTemplatePlacement } from "./TemplateRegistry";
import type { SaturdayMarketTransparencyMode, SaturdayPassportMode } from "./types";
import type { VehicleImagePreference } from "./VehicleImagePipeline";

export type NewVehicleTemplateKind = "new_monroney" | "new_addendum";

export type NewVehicleTemplateCategory =
  | "core"
  | "oem"
  | "pricing"
  | "ev_hybrid"
  | "truck_suv"
  | "luxury"
  | "commercial"
  | "compliance"
  | "dealer_value";

export type NewVehicleRendererFamily =
  | "factory_monroney"
  | "oem_monroney"
  | "premium_monroney"
  | "ev_monroney"
  | "truck_monroney"
  | "commercial_monroney"
  | "minimal_monroney"
  | "msrp_addendum"
  | "accessory_addendum"
  | "market_adjustment_addendum"
  | "protection_addendum"
  | "ev_addendum"
  | "truck_addendum"
  | "luxury_addendum"
  | "commercial_addendum"
  | "minimal_addendum";

export type NewVehiclePricingMode =
  | "factory_msrp_only"
  | "msrp_plus_factory_options"
  | "msrp_plus_dealer_accessories"
  | "msrp_plus_market_adjustment"
  | "msrp_plus_protection_package"
  | "passport_live_price_only";

export type NewVehicleTemplateDefinition = {
  id: string;
  kind: NewVehicleTemplateKind;
  name: string;
  category: NewVehicleTemplateCategory;
  family: NewVehicleRendererFamily;
  description: string;
  defaultBadge: string;
  supportsDealerTheme: true;
  supportsOEMTheme: true;
  supportsPassport: boolean;
  supportsMarketTransparency: boolean;
  supportsFactoryCleanImage: true;
  supportsFactoryOptions: boolean;
  supportsDealerAccessories: boolean;
  supportsMarketAdjustment: boolean;
  supportsIncentives: boolean;
  supportsEVData: boolean;
  supportsCommercialData: boolean;
  recommendedPlacement: AutoLabelsTemplatePlacement;
  recommendedImagePreference: VehicleImagePreference;
  defaultPricingMode: NewVehiclePricingMode;
  defaultPassportMode: SaturdayPassportMode;
  defaultMarketTransparencyMode: SaturdayMarketTransparencyMode;
  suggestedOEMs: string[];
  tags: string[];
  rendererKey: string;
  complianceNotes: string[];
};

const core = {
  supportsDealerTheme: true,
  supportsOEMTheme: true,
  supportsFactoryCleanImage: true,
} as const;

const mainstreamOEMs = ["Toyota", "Honda", "Hyundai", "Kia", "Nissan", "Subaru", "Mazda", "Volkswagen"];
const truckOEMs = ["Ford", "Chevrolet", "GMC", "Ram", "Jeep"];
const luxuryOEMs = ["Acura", "Audi", "BMW", "Cadillac", "Genesis", "INFINITI", "Lexus", "Lincoln", "Mercedes-Benz", "Volvo"];
const evOEMs = ["Tesla", "Hyundai", "Kia", "Ford", "Chevrolet", "Volkswagen", "Volvo"];

const monroney = (input: Partial<NewVehicleTemplateDefinition> & Pick<NewVehicleTemplateDefinition, "id" | "name" | "category" | "family" | "description" | "defaultBadge" | "rendererKey">): NewVehicleTemplateDefinition => ({
  kind: "new_monroney",
  ...core,
  supportsPassport: input.supportsPassport ?? true,
  supportsMarketTransparency: input.supportsMarketTransparency ?? false,
  supportsFactoryOptions: input.supportsFactoryOptions ?? true,
  supportsDealerAccessories: input.supportsDealerAccessories ?? false,
  supportsMarketAdjustment: input.supportsMarketAdjustment ?? false,
  supportsIncentives: input.supportsIncentives ?? true,
  supportsEVData: input.supportsEVData ?? false,
  supportsCommercialData: input.supportsCommercialData ?? false,
  recommendedPlacement: input.recommendedPlacement ?? "inside_window",
  recommendedImagePreference: input.recommendedImagePreference ?? "factory_clean_first",
  defaultPricingMode: input.defaultPricingMode ?? "msrp_plus_factory_options",
  defaultPassportMode: input.defaultPassportMode ?? "enabled",
  defaultMarketTransparencyMode: input.defaultMarketTransparencyMode ?? "off",
  suggestedOEMs: input.suggestedOEMs ?? [],
  tags: input.tags ?? [],
  complianceNotes: input.complianceNotes ?? ["New vehicle labels must keep OEM Monroney data distinct from dealer addendum data."],
  ...input,
});

const addendum = (input: Partial<NewVehicleTemplateDefinition> & Pick<NewVehicleTemplateDefinition, "id" | "name" | "category" | "family" | "description" | "defaultBadge" | "rendererKey">): NewVehicleTemplateDefinition => ({
  kind: "new_addendum",
  ...core,
  supportsPassport: input.supportsPassport ?? true,
  supportsMarketTransparency: input.supportsMarketTransparency ?? false,
  supportsFactoryOptions: input.supportsFactoryOptions ?? false,
  supportsDealerAccessories: input.supportsDealerAccessories ?? true,
  supportsMarketAdjustment: input.supportsMarketAdjustment ?? false,
  supportsIncentives: input.supportsIncentives ?? true,
  supportsEVData: input.supportsEVData ?? false,
  supportsCommercialData: input.supportsCommercialData ?? false,
  recommendedPlacement: input.recommendedPlacement ?? "outside_window",
  recommendedImagePreference: input.recommendedImagePreference ?? "factory_clean_first",
  defaultPricingMode: input.defaultPricingMode ?? "msrp_plus_dealer_accessories",
  defaultPassportMode: input.defaultPassportMode ?? "enabled",
  defaultMarketTransparencyMode: input.defaultMarketTransparencyMode ?? "off",
  suggestedOEMs: input.suggestedOEMs ?? [],
  tags: input.tags ?? [],
  complianceNotes: input.complianceNotes ?? ["Dealer addendum must clearly separate dealer-installed accessories, protection products, and market adjustments from factory MSRP."],
  ...input,
});

const oemMonroney = (make: string): NewVehicleTemplateDefinition => monroney({
  id: `new-monroney-oem-${make.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `${make} New Vehicle Monroney Companion`,
  category: "oem",
  family: luxuryOEMs.includes(make) ? "premium_monroney" : truckOEMs.includes(make) ? "truck_monroney" : "oem_monroney",
  description: `${make}-aligned new vehicle label companion for MSRP, factory options, incentives, fuel/MPGe, image, and optional passport.` ,
  defaultBadge: `${make} New Vehicle`,
  rendererKey: `new.monroney.oem.${make.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  suggestedOEMs: [make],
  supportsEVData: evOEMs.includes(make),
  supportsCommercialData: ["Ford", "Chevrolet", "GMC", "Ram"].includes(make),
  tags: [make.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "new", "monroney", "oem", luxuryOEMs.includes(make) ? "luxury" : "franchise"],
});

const oemAddendum = (make: string): NewVehicleTemplateDefinition => addendum({
  id: `new-addendum-oem-${make.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `${make} New Vehicle Addendum`,
  category: "oem",
  family: luxuryOEMs.includes(make) ? "luxury_addendum" : truckOEMs.includes(make) ? "truck_addendum" : "accessory_addendum",
  description: `${make}-aligned addendum for dealer accessories, protection products, market adjustment, incentives, and passport/VDP QR.` ,
  defaultBadge: `${make} Addendum`,
  rendererKey: `new.addendum.oem.${make.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  suggestedOEMs: [make],
  supportsMarketAdjustment: true,
  supportsEVData: evOEMs.includes(make),
  supportsCommercialData: ["Ford", "Chevrolet", "GMC", "Ram"].includes(make),
  tags: [make.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "new", "addendum", "dealer-installed", luxuryOEMs.includes(make) ? "luxury" : "franchise"],
});

export const NEW_MONRONEY_CATALOG_50: NewVehicleTemplateDefinition[] = [
  monroney({ id: "new-monroney-core-factory-companion", name: "Factory Monroney Companion", category: "core", family: "factory_monroney", description: "Core new vehicle companion label for factory MSRP, options, fuel economy, incentives, vehicle image, and passport link.", defaultBadge: "Factory MSRP Companion", rendererKey: "new.monroney.core.factory_companion", tags: ["core", "factory", "msrp", "options"] }),
  monroney({ id: "new-monroney-core-clean-summary", name: "Clean MSRP Summary", category: "core", family: "minimal_monroney", description: "Simple customer-readable new vehicle summary that does not replace the OEM Monroney.", defaultBadge: "New Vehicle Summary", rendererKey: "new.monroney.core.clean_summary", supportsPassport: false, tags: ["core", "minimal", "no-passport"] }),
  monroney({ id: "new-monroney-core-passport-source", name: "Passport Source-of-Truth Monroney Companion", category: "core", family: "factory_monroney", description: "Printed snapshot with vehicle passport as live source for price, incentives, availability, and disclosures.", defaultBadge: "Scan For Live Details", rendererKey: "new.monroney.core.passport_source", defaultPricingMode: "passport_live_price_only", tags: ["core", "passport", "live-price"] }),
  monroney({ id: "new-monroney-pricing-incentive-summary", name: "Factory Incentive Summary", category: "pricing", family: "factory_monroney", description: "New vehicle label focused on MSRP, factory incentives, dealer discounts, and current offer transparency.", defaultBadge: "Incentive Summary", rendererKey: "new.monroney.pricing.incentives", supportsIncentives: true, tags: ["incentives", "pricing", "factory"] }),
  monroney({ id: "new-monroney-pricing-one-price", name: "New Vehicle One Price Summary", category: "pricing", family: "minimal_monroney", description: "One-price new vehicle presentation with MSRP and dealer-selected final-price strategy.", defaultBadge: "One Price New Vehicle", rendererKey: "new.monroney.pricing.one_price", defaultPricingMode: "passport_live_price_only", tags: ["one-price", "pricing", "new"] }),
  monroney({ id: "new-monroney-pricing-market-adjustment-aware", name: "Market Adjustment Aware Summary", category: "pricing", family: "factory_monroney", description: "New vehicle label companion that can identify MSRP separately from dealer market adjustment when enabled.", defaultBadge: "MSRP + Dealer Addendum", rendererKey: "new.monroney.pricing.market_adjustment", supportsMarketAdjustment: true, tags: ["market-adjustment", "msrp", "dealer-addendum"] }),
  monroney({ id: "new-monroney-ev-core", name: "EV Monroney Companion", category: "ev_hybrid", family: "ev_monroney", description: "New EV label for MSRP, MPGe/range fields, charging highlights, incentives, and passport.", defaultBadge: "Electric Vehicle", rendererKey: "new.monroney.ev.core", supportsEVData: true, tags: ["ev", "mpge", "range", "charging"] }),
  monroney({ id: "new-monroney-hybrid-core", name: "Hybrid Monroney Companion", category: "ev_hybrid", family: "ev_monroney", description: "Hybrid/PHEV new vehicle label with fuel, electric range, incentives, and efficiency story.", defaultBadge: "Hybrid Vehicle", rendererKey: "new.monroney.hybrid.core", supportsEVData: true, tags: ["hybrid", "phev", "mpg", "efficiency"] }),
  monroney({ id: "new-monroney-truck-capability", name: "Truck Capability Monroney Companion", category: "truck_suv", family: "truck_monroney", description: "Truck/SUV new vehicle label with capability, towing, drivetrain, factory options, and MSRP.", defaultBadge: "Truck Capability", rendererKey: "new.monroney.truck.capability", supportsCommercialData: true, suggestedOEMs: truckOEMs, tags: ["truck", "suv", "towing", "capability"] }),
  monroney({ id: "new-monroney-commercial-fleet", name: "Commercial Fleet Monroney Companion", category: "commercial", family: "commercial_monroney", description: "Commercial new vehicle companion for vans, chassis, fleet units, payload, upfit readiness, and MSRP.", defaultBadge: "Commercial Vehicle", rendererKey: "new.monroney.commercial.fleet", supportsPassport: false, supportsCommercialData: true, suggestedOEMs: ["Ford", "Chevrolet", "GMC", "Ram"], tags: ["commercial", "fleet", "van", "work-truck"] }),
  ...[...mainstreamOEMs, ...truckOEMs, ...luxuryOEMs].map(oemMonroney),
  monroney({ id: "new-monroney-luxury-executive", name: "Luxury Executive Monroney Companion", category: "luxury", family: "premium_monroney", description: "Premium new vehicle label companion for luxury stores with restrained hierarchy and passport support.", defaultBadge: "Executive New Vehicle", rendererKey: "new.monroney.luxury.executive", suggestedOEMs: luxuryOEMs, tags: ["luxury", "executive", "premium"] }),
  monroney({ id: "new-monroney-luxury-ev", name: "Luxury EV Monroney Companion", category: "luxury", family: "ev_monroney", description: "Luxury EV new vehicle label for MPGe/range, incentives, premium features, and passport.", defaultBadge: "Luxury EV", rendererKey: "new.monroney.luxury.ev", supportsEVData: true, suggestedOEMs: ["BMW", "Mercedes-Benz", "Audi", "Volvo", "Cadillac"], tags: ["luxury", "ev", "mpge"] }),
  monroney({ id: "new-monroney-compliance-no-qr", name: "Compliance No-QR New Vehicle Summary", category: "compliance", family: "minimal_monroney", description: "No-QR new vehicle companion label for stores that want print-only information.", defaultBadge: "New Vehicle Information", rendererKey: "new.monroney.compliance.no_qr", supportsPassport: false, defaultPassportMode: "disabled", tags: ["compliance", "no-qr", "minimal"] }),
  monroney({ id: "new-monroney-dealer-value", name: "New Vehicle Dealer Value Summary", category: "dealer_value", family: "factory_monroney", description: "New vehicle companion label that adds dealer benefits without mixing them into factory MSRP.", defaultBadge: "Dealer Value Included", rendererKey: "new.monroney.dealer_value.core", supportsDealerAccessories: true, tags: ["dealer-value", "benefits", "msrp"] }),
  monroney({ id: "new-monroney-incoming-unit", name: "Incoming Unit Monroney Companion", category: "core", family: "minimal_monroney", description: "For inbound/in-transit inventory where final photo or full addendum may not be ready.", defaultBadge: "Incoming Vehicle", rendererKey: "new.monroney.core.incoming", tags: ["incoming", "in-transit", "pre-sale"] }),
  monroney({ id: "new-monroney-reserved-unit", name: "Reserved Unit Monroney Companion", category: "core", family: "minimal_monroney", description: "For incoming or on-lot vehicles that are reserved, pending, or order-linked.", defaultBadge: "Reserved Vehicle", rendererKey: "new.monroney.core.reserved", tags: ["reserved", "pending", "order"] }),
  monroney({ id: "new-monroney-demo-new", name: "New Demo Vehicle Summary", category: "dealer_value", family: "factory_monroney", description: "For demonstrator vehicles still presented through a new-vehicle workflow with mileage disclosure.", defaultBadge: "Demo Vehicle", rendererKey: "new.monroney.dealer_value.demo", supportsDealerAccessories: true, tags: ["demo", "new", "mileage-disclosure"] }),
];

export const NEW_ADDENDUM_CATALOG_50: NewVehicleTemplateDefinition[] = [
  addendum({ id: "new-addendum-core-msrp-plus-accessories", name: "MSRP + Dealer Accessories Addendum", category: "core", family: "msrp_addendum", description: "Core new vehicle addendum for MSRP plus dealer-installed accessories and dealer disclosures.", defaultBadge: "Dealer Addendum", rendererKey: "new.addendum.core.msrp_plus_accessories", tags: ["core", "msrp", "dealer-installed", "accessories"] }),
  addendum({ id: "new-addendum-core-accessory-only", name: "Accessory Only Addendum", category: "core", family: "accessory_addendum", description: "Dealer addendum focused only on installed accessories, no market adjustment emphasis.", defaultBadge: "Installed Accessories", rendererKey: "new.addendum.core.accessory_only", supportsMarketAdjustment: false, tags: ["accessories", "dealer-installed", "no-market-adjustment"] }),
  addendum({ id: "new-addendum-core-passport-live", name: "Passport Live Price Addendum", category: "core", family: "msrp_addendum", description: "Stable printed addendum with live price, incentives, and availability in the vehicle passport.", defaultBadge: "Scan For Live Offer", rendererKey: "new.addendum.core.passport_live", defaultPricingMode: "passport_live_price_only", tags: ["passport", "live-price", "stable-print"] }),
  addendum({ id: "new-addendum-pricing-market-adjustment", name: "Market Adjustment Addendum", category: "pricing", family: "market_adjustment_addendum", description: "Dealer addendum that clearly separates MSRP, dealer accessories, and market adjustment.", defaultBadge: "Market Adjustment", rendererKey: "new.addendum.pricing.market_adjustment", supportsMarketAdjustment: true, defaultPricingMode: "msrp_plus_market_adjustment", tags: ["market-adjustment", "pricing", "msrp"] }),
  addendum({ id: "new-addendum-pricing-one-price", name: "New Vehicle One Price Addendum", category: "pricing", family: "minimal_addendum", description: "One-price new-vehicle addendum with dealer-selected offer language and optional passport.", defaultBadge: "One Price", rendererKey: "new.addendum.pricing.one_price", defaultPricingMode: "passport_live_price_only", tags: ["one-price", "new", "pricing"] }),
  addendum({ id: "new-addendum-protection-package", name: "Protection Package Addendum", category: "dealer_value", family: "protection_addendum", description: "Addendum for paint/fabric protection, theft, appearance, or other protection packages.", defaultBadge: "Protection Package", rendererKey: "new.addendum.dealer_value.protection", defaultPricingMode: "msrp_plus_protection_package", tags: ["protection", "appearance", "dealer-value"] }),
  addendum({ id: "new-addendum-ev-charging", name: "EV Charging Addendum", category: "ev_hybrid", family: "ev_addendum", description: "EV addendum for charging cables, home charger offers, EV incentives, and electric-specific disclosures.", defaultBadge: "EV Addendum", rendererKey: "new.addendum.ev.charging", supportsEVData: true, tags: ["ev", "charging", "incentives"] }),
  addendum({ id: "new-addendum-hybrid-efficiency", name: "Hybrid Efficiency Addendum", category: "ev_hybrid", family: "ev_addendum", description: "Hybrid/PHEV addendum for efficiency equipment, charging, and incentive notes.", defaultBadge: "Hybrid Addendum", rendererKey: "new.addendum.hybrid.efficiency", supportsEVData: true, tags: ["hybrid", "phev", "efficiency"] }),
  addendum({ id: "new-addendum-truck-capability", name: "Truck Capability Addendum", category: "truck_suv", family: "truck_addendum", description: "Truck/SUV addendum for towing packages, bedliner, steps, guards, upfits, and capability items.", defaultBadge: "Truck Addendum", rendererKey: "new.addendum.truck.capability", supportsCommercialData: true, suggestedOEMs: truckOEMs, tags: ["truck", "suv", "towing", "upfit"] }),
  addendum({ id: "new-addendum-commercial-upfit", name: "Commercial Upfit Addendum", category: "commercial", family: "commercial_addendum", description: "Commercial/fleet addendum for shelving, ladder racks, wraps, commercial packages, and upfit readiness.", defaultBadge: "Commercial Upfit", rendererKey: "new.addendum.commercial.upfit", supportsPassport: false, defaultPassportMode: "disabled", supportsCommercialData: true, suggestedOEMs: ["Ford", "Chevrolet", "GMC", "Ram"], tags: ["commercial", "fleet", "upfit", "work-truck"] }),
  ...[...mainstreamOEMs, ...truckOEMs, ...luxuryOEMs].map(oemAddendum),
  addendum({ id: "new-addendum-luxury-premium", name: "Luxury Premium Addendum", category: "luxury", family: "luxury_addendum", description: "Premium dealer addendum for luxury stores with restrained presentation and clear value separation.", defaultBadge: "Premium Addendum", rendererKey: "new.addendum.luxury.premium", suggestedOEMs: luxuryOEMs, tags: ["luxury", "premium", "dealer-installed"] }),
  addendum({ id: "new-addendum-luxury-protection", name: "Luxury Protection Addendum", category: "luxury", family: "luxury_addendum", description: "Luxury addendum for appearance, protection, concierge, and premium ownership packages.", defaultBadge: "Luxury Protection", rendererKey: "new.addendum.luxury.protection", defaultPricingMode: "msrp_plus_protection_package", suggestedOEMs: luxuryOEMs, tags: ["luxury", "protection", "concierge"] }),
  addendum({ id: "new-addendum-compliance-no-qr", name: "Compliance No-QR Addendum", category: "compliance", family: "minimal_addendum", description: "No-QR new vehicle addendum for dealers that want print-only addendum information.", defaultBadge: "Dealer Addendum", rendererKey: "new.addendum.compliance.no_qr", supportsPassport: false, defaultPassportMode: "disabled", tags: ["compliance", "no-qr", "minimal"] }),
  addendum({ id: "new-addendum-incoming-unit", name: "Incoming Unit Addendum", category: "core", family: "minimal_addendum", description: "For inbound/in-transit new inventory where dealer accessories and final pricing may still be pending.", defaultBadge: "Incoming Addendum", rendererKey: "new.addendum.core.incoming", tags: ["incoming", "in-transit", "pending"] }),
  addendum({ id: "new-addendum-demo-new", name: "New Demo Addendum", category: "dealer_value", family: "accessory_addendum", description: "For demo vehicles handled through a new workflow with mileage and dealer-installed item disclosure.", defaultBadge: "Demo Addendum", rendererKey: "new.addendum.dealer_value.demo", tags: ["demo", "mileage-disclosure", "new"] }),
];

export const NEW_VEHICLE_TEMPLATE_CATALOG = [...NEW_MONRONEY_CATALOG_50, ...NEW_ADDENDUM_CATALOG_50];

export const NEW_VEHICLE_TEMPLATE_COUNTS = {
  total: NEW_VEHICLE_TEMPLATE_CATALOG.length,
  monroney: NEW_MONRONEY_CATALOG_50.length,
  addendums: NEW_ADDENDUM_CATALOG_50.length,
  passportCapable: NEW_VEHICLE_TEMPLATE_CATALOG.filter((template) => template.supportsPassport).length,
  marketAdjustmentCapable: NEW_VEHICLE_TEMPLATE_CATALOG.filter((template) => template.supportsMarketAdjustment).length,
  evCapable: NEW_VEHICLE_TEMPLATE_CATALOG.filter((template) => template.supportsEVData).length,
  commercialCapable: NEW_VEHICLE_TEMPLATE_CATALOG.filter((template) => template.supportsCommercialData).length,
};

export const NEW_VEHICLE_TEMPLATE_BY_ID = Object.fromEntries(NEW_VEHICLE_TEMPLATE_CATALOG.map((template) => [template.id, template]));

import type { SaturdayAddendumPricingMode, SaturdayDealer, SaturdayDealerTheme, SaturdayMarketData, SaturdayMarketTransparencyMode, SaturdayPassportMode, SaturdaySticker, SaturdayVehicle } from "./types";
import { resolveVehicleImageForSticker, type VehicleImagePreference } from "./VehicleImagePipeline";

export const PRICE_LABEL_OPTIONS = [
  "Best Price",
  "Best Price First",
  "One Price",
  "Market Price",
  "Market Value Price",
  "Selling Price",
  "Internet Price",
  "Advertised Price",
  "Asking Price",
  "Our Price",
  "Your Price",
  "Manager's Special",
  "No-Haggle Price",
  "Custom",
] as const;

export const CERTIFICATION_LABEL_OPTIONS = [
  "Certified Pre-Owned",
  "CPO",
  "OEM Certified Pre-Owned",
  "Dealer Certified Pre-Owned",
  "Dealer Certified",
  "Certified Vehicle",
  "Inspection Certified",
  "Warranty Eligible",
  "Custom",
] as const;

export const REVIEW_SOURCE_OPTIONS = [
  "google",
  "facebook",
  "bbb",
  "cars_com",
  "dealer_rater",
  "car_gurus",
  "edmunds",
  "yelp",
  "custom",
] as const;

export const LABEL_PLACEMENT_OPTIONS = [
  "inside_window",
  "outside_window",
  "adhesive_outside",
  "static_cling_inside",
  "paper_sleeve_inside",
] as const;

export type DealerReviewSourceType = (typeof REVIEW_SOURCE_OPTIONS)[number];
export type LabelPlacementOption = (typeof LABEL_PLACEMENT_OPTIONS)[number];

export type DealerReviewSelection = {
  type: DealerReviewSourceType;
  label: string;
  rating?: number;
  reviewCount?: number;
  profileUrl?: string;
  manuallyEntered?: boolean;
  allowAutomatedFetch?: boolean;
};

export type DealerCertificationTier = {
  id: string;
  label: string;
  headline: string;
  detail?: string;
  months?: number;
  miles?: number;
  requiresFinancing?: boolean;
  priceAddOn?: number;
  isDefault?: boolean;
  disclosure?: string;
};

export type DealerLabelSettings = {
  priceLabel?: string;
  customPriceLabel?: string;
  certificationLabel?: string;
  customCertificationLabel?: string;
  valueProps?: string[];
  reviewSource?: DealerReviewSelection;
  certificationTiers?: DealerCertificationTier[];
  addendumPricingMode?: SaturdayAddendumPricingMode;
  marketTransparencyMode?: SaturdayMarketTransparencyMode;
  passportMode?: SaturdayPassportMode;
  defaultLabelPlacement?: LabelPlacementOption;
  theme?: SaturdayDealerTheme;
};

export type DealerProfileInput = {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  slogan?: string;
  labelSettings?: DealerLabelSettings;
};

export type VehicleInventoryInput = {
  title?: string;
  year?: string | number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  stock?: string;
  mileage?: number | string;
  condition?: "new" | "used";
  imageUrl?: string;
  factoryCleanImageUrl?: string;
  transparentVehicleImageUrl?: string;
  imagePreference?: VehicleImagePreference;
  newCarImageUrl?: string;
  usedCarPrimaryPhotoUrl?: string;
  apiFallbackImageUrl?: string;
  pricing?: {
    advertisedPrice?: number | string;
    sellingPrice?: number | string;
    websitePrice?: number | string;
    msrp?: number | string;
    marketValue?: number | string;
    dealerPriceLabelOverride?: string;
  };
  specs?: Record<string, string | number | undefined>;
  features?: string[];
  fuel?: { city?: number; highway?: number; combined?: number };
  certificationTierId?: string;
};

export type MarketIntelligenceInput = {
  marketAverage?: number | string;
  delta?: number | string;
  radius?: string;
  comparableCount?: number;
  recentSoldAverage?: number | string;
  blackBookRetail?: number | string;
  blackBookTrade?: number | string;
  sourceLabel?: string;
};

const asString = (value?: number | string): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
};

export const resolvePriceLabel = (dealer?: DealerProfileInput, vehicle?: VehicleInventoryInput): string => {
  const vehicleOverride = vehicle?.pricing?.dealerPriceLabelOverride?.trim();
  if (vehicleOverride) return vehicleOverride;
  const settings = dealer?.labelSettings;
  if (settings?.priceLabel === "Custom" && settings.customPriceLabel?.trim()) return settings.customPriceLabel.trim();
  return settings?.priceLabel?.trim() || "Advertised Price";
};

export const resolveCertificationLabel = (dealer?: DealerProfileInput): string => {
  const settings = dealer?.labelSettings;
  if (settings?.certificationLabel === "Custom" && settings.customCertificationLabel?.trim()) {
    return settings.customCertificationLabel.trim();
  }
  return settings?.certificationLabel?.trim() || "Certified Pre-Owned";
};

export const resolveSellingPrice = (vehicle: VehicleInventoryInput): string | undefined => {
  return asString(vehicle.pricing?.websitePrice ?? vehicle.pricing?.advertisedPrice ?? vehicle.pricing?.sellingPrice);
};

export const resolveMarketValue = (vehicle: VehicleInventoryInput, market?: MarketIntelligenceInput): string | undefined => {
  return asString(vehicle.pricing?.marketValue ?? market?.marketAverage ?? market?.recentSoldAverage);
};

export const resolveAddendumPricingMode = (dealer: DealerProfileInput, vehicle: VehicleInventoryInput): SaturdayAddendumPricingMode => {
  if (dealer.labelSettings?.addendumPricingMode) return dealer.labelSettings.addendumPricingMode;
  return vehicle.condition === "new" ? "new_msrp_plus_addendum" : "used_market_value_plus_addendum";
};

export const resolvePrintedBasePrice = (
  dealer: DealerProfileInput,
  vehicle: VehicleInventoryInput,
  market?: MarketIntelligenceInput,
): string | undefined => {
  const mode = resolveAddendumPricingMode(dealer, vehicle);

  switch (mode) {
    case "new_msrp_plus_addendum":
      return asString(vehicle.pricing?.msrp);
    case "used_market_value_plus_addendum":
      return resolveMarketValue(vehicle, market);
    case "used_live_price_plus_addendum":
      return resolveSellingPrice(vehicle);
    case "used_addendum_only":
    case "passport_live_price_only":
      return undefined;
    default:
      return resolveSellingPrice(vehicle);
  }
};

export const resolvePrintedPriceLabel = (dealer: DealerProfileInput, vehicle: VehicleInventoryInput): string => {
  const mode = resolveAddendumPricingMode(dealer, vehicle);
  if (mode === "new_msrp_plus_addendum") return "Factory MSRP";
  if (mode === "used_market_value_plus_addendum") return "Market Value";
  if (mode === "passport_live_price_only") return "Scan for Live Price";
  if (mode === "used_addendum_only") return "Installed Equipment";
  return resolvePriceLabel(dealer, vehicle);
};

export const resolveVehicleImage = (vehicle: VehicleInventoryInput): string | undefined => {
  return resolveVehicleImageForSticker(vehicle).url;
};

export const resolveCertificationTier = (dealer: DealerProfileInput, vehicle: VehicleInventoryInput): DealerCertificationTier | undefined => {
  const tiers = dealer.labelSettings?.certificationTiers || [];
  if (!tiers.length) return undefined;
  if (vehicle.certificationTierId) return tiers.find((tier) => tier.id === vehicle.certificationTierId);
  return tiers.find((tier) => tier.isDefault) || tiers[0];
};

export const buildMarketData = (market?: MarketIntelligenceInput): SaturdayMarketData | undefined => {
  if (!market) return undefined;
  if (!market.marketAverage && !market.recentSoldAverage && !market.delta && !market.comparableCount) return undefined;
  return {
    status: market.delta ? "Great Value" : undefined,
    marketAverage: asString(market.marketAverage),
    recentSoldAverage: asString(market.recentSoldAverage),
    delta: asString(market.delta),
    radius: market.radius,
    comparableCount: market.comparableCount,
    sourceLabel: market.sourceLabel || "Market data",
  };
};

export const buildSaturdayDealer = (dealer: DealerProfileInput): SaturdayDealer => ({
  name: dealer.name,
  address: dealer.address || "",
  phone: dealer.phone || "",
  website: dealer.website || "",
  slogan: dealer.slogan,
  pricingLabel: resolvePriceLabel(dealer),
  valueProps: dealer.labelSettings?.valueProps,
  reviewSources: dealer.labelSettings?.reviewSource ? [dealer.labelSettings.reviewSource] : undefined,
  theme: dealer.labelSettings?.theme,
  addendumPricingMode: dealer.labelSettings?.addendumPricingMode,
  marketTransparencyMode: dealer.labelSettings?.marketTransparencyMode,
  passportMode: dealer.labelSettings?.passportMode,
});

export const buildSaturdayVehicle = (dealer: DealerProfileInput, vehicle: VehicleInventoryInput, market?: MarketIntelligenceInput): SaturdayVehicle => {
  const title = vehicle.title || [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
  const printedBasePrice = resolvePrintedBasePrice(dealer, vehicle, market);
  return {
    title: title || "Vehicle Details Pending",
    vin: vehicle.vin || "VIN Pending",
    stock: vehicle.stock || "Stock Pending",
    mileage: vehicle.mileage === undefined ? undefined : String(vehicle.mileage),
    msrp: asString(vehicle.pricing?.msrp),
    condition: vehicle.condition || "used",
    price: printedBasePrice || "Call for Price",
    priceLabel: resolvePrintedPriceLabel(dealer, vehicle),
    imageUrl: resolveVehicleImage(vehicle),
  };
};

export const buildSaturdayStickerData = (input: {
  dealer: DealerProfileInput;
  vehicle: VehicleInventoryInput;
  market?: MarketIntelligenceInput;
  benefits?: string[];
  qrUrl: string;
  disclaimer?: string;
}): SaturdaySticker => {
  const tier = resolveCertificationTier(input.dealer, input.vehicle);
  const defaultBenefits = [...(input.dealer.labelSettings?.valueProps || []), ...(tier ? [tier.headline] : [])];

  return {
    dealer: buildSaturdayDealer(input.dealer),
    vehicle: buildSaturdayVehicle(input.dealer, input.vehicle, input.market),
    specs: [
      { label: "Year", value: String(input.vehicle.year || "") },
      { label: "Mileage", value: input.vehicle.mileage === undefined ? "" : `${input.vehicle.mileage} mi` },
      { label: "Drivetrain", value: String(input.vehicle.specs?.drivetrain || "") },
      { label: "Engine", value: String(input.vehicle.specs?.engine || "") },
      { label: "Trans", value: String(input.vehicle.specs?.transmission || "") },
      { label: "Exterior Color", value: String(input.vehicle.specs?.exteriorColor || "") },
      { label: "Interior Color", value: String(input.vehicle.specs?.interiorColor || "") },
    ].filter((spec) => spec.value),
    highlights: input.vehicle.features || [],
    fuel: {
      city: input.vehicle.fuel?.city || 0,
      highway: input.vehicle.fuel?.highway || 0,
      combined: input.vehicle.fuel?.combined || 0,
    },
    benefits: input.benefits?.length ? input.benefits : defaultBenefits,
    qrUrl: input.qrUrl,
    disclaimer: input.disclaimer || "Information deemed reliable but not guaranteed. See dealer for complete details.",
    market: buildMarketData(input.market),
  };
};

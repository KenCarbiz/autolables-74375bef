import type { SaturdayAddendumPricingMode, SaturdayMarketTransparencyMode } from "./types";
import type { DealerProfileInput, MarketIntelligenceInput, VehicleInventoryInput } from "./wiring";

export type PassportTruthPrice = {
  label: string;
  value?: string;
  source: "website" | "advertised_feed" | "selling_price" | "msrp" | "market" | "none";
  isLive: boolean;
  note: string;
};

export type PassportPrintPrice = {
  label: string;
  value?: string;
  source: "msrp" | "market" | "live_price" | "addendum_only" | "passport_only" | "none";
  mode: SaturdayAddendumPricingMode;
  shouldPrintValue: boolean;
  scanPrompt: string;
};

export type PassportTruthSummary = {
  vehicleCondition: "new" | "used";
  livePrice: PassportTruthPrice;
  printPrice: PassportPrintPrice;
  marketTransparencyMode: SaturdayMarketTransparencyMode;
  showMarketOnPrint: boolean;
  showMarketInPassport: boolean;
  labelPlacement: string;
  qrReason: string;
};

const clean = (value?: number | string) => {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
};

export const resolveLivePassportPrice = (vehicle: VehicleInventoryInput, priceLabel = "Advertised Price"): PassportTruthPrice => {
  const website = clean(vehicle.pricing?.websitePrice);
  if (website) {
    return {
      label: priceLabel,
      value: website,
      source: "website",
      isLive: true,
      note: "Current website advertised price. This is the live price customers should trust in the passport.",
    };
  }

  const advertised = clean(vehicle.pricing?.advertisedPrice);
  if (advertised) {
    return {
      label: priceLabel,
      value: advertised,
      source: "advertised_feed",
      isLive: true,
      note: "Current advertised price from inventory feed.",
    };
  }

  const selling = clean(vehicle.pricing?.sellingPrice);
  if (selling) {
    return {
      label: priceLabel,
      value: selling,
      source: "selling_price",
      isLive: true,
      note: "Selling price from dealer inventory data.",
    };
  }

  return {
    label: "Live Price",
    source: "none",
    isLive: true,
    note: "No live advertised price was provided. Do not invent a price; show a scan/call prompt instead.",
  };
};

export const resolveMarketValueForPrint = (vehicle: VehicleInventoryInput, market?: MarketIntelligenceInput) => {
  return clean(vehicle.pricing?.marketValue ?? market?.marketAverage ?? market?.recentSoldAverage);
};

export const resolveAddendumMode = (dealer: DealerProfileInput, vehicle: VehicleInventoryInput): SaturdayAddendumPricingMode => {
  if (dealer.labelSettings?.addendumPricingMode) return dealer.labelSettings.addendumPricingMode;
  return vehicle.condition === "new" ? "new_msrp_plus_addendum" : "used_market_value_plus_addendum";
};

export const resolveMarketTransparencyMode = (dealer: DealerProfileInput): SaturdayMarketTransparencyMode => {
  return dealer.labelSettings?.marketTransparencyMode || "passport_only";
};

export const resolvePrintPrice = (
  dealer: DealerProfileInput,
  vehicle: VehicleInventoryInput,
  market?: MarketIntelligenceInput,
  priceLabel = "Advertised Price",
): PassportPrintPrice => {
  const mode = resolveAddendumMode(dealer, vehicle);

  if (mode === "new_msrp_plus_addendum") {
    const msrp = clean(vehicle.pricing?.msrp);
    return {
      label: "Factory MSRP",
      value: msrp,
      source: msrp ? "msrp" : "none",
      mode,
      shouldPrintValue: Boolean(msrp),
      scanPrompt: "Scan for current advertised price, incentives, availability, and digital passport.",
    };
  }

  if (mode === "used_market_value_plus_addendum") {
    const marketValue = resolveMarketValueForPrint(vehicle, market);
    return {
      label: "Market Value",
      value: marketValue,
      source: marketValue ? "market" : "none",
      mode,
      shouldPrintValue: Boolean(marketValue),
      scanPrompt: "Scan for today's live selling price, market comparison, and vehicle passport.",
    };
  }

  if (mode === "used_live_price_plus_addendum") {
    const live = resolveLivePassportPrice(vehicle, priceLabel);
    return {
      label: priceLabel,
      value: live.value,
      source: live.value ? "live_price" : "none",
      mode,
      shouldPrintValue: Boolean(live.value),
      scanPrompt: "Scan to confirm current live price and disclosures.",
    };
  }

  if (mode === "used_addendum_only") {
    return {
      label: "Installed Equipment",
      source: "addendum_only",
      mode,
      shouldPrintValue: false,
      scanPrompt: "Scan for live price, market comparison, and full vehicle passport.",
    };
  }

  return {
    label: "Live Price",
    source: "passport_only",
    mode,
    shouldPrintValue: false,
    scanPrompt: "Scan for today's live selling price and complete vehicle passport.",
  };
};

export const buildPassportTruthSummary = (input: {
  dealer: DealerProfileInput;
  vehicle: VehicleInventoryInput;
  market?: MarketIntelligenceInput;
  priceLabel?: string;
}): PassportTruthSummary => {
  const vehicleCondition = input.vehicle.condition || "used";
  const livePrice = resolveLivePassportPrice(input.vehicle, input.priceLabel);
  const printPrice = resolvePrintPrice(input.dealer, input.vehicle, input.market, input.priceLabel);
  const marketTransparencyMode = resolveMarketTransparencyMode(input.dealer);
  const labelPlacement = input.dealer.labelSettings?.defaultLabelPlacement || "inside_window";

  return {
    vehicleCondition,
    livePrice,
    printPrice,
    marketTransparencyMode,
    showMarketOnPrint: marketTransparencyMode === "print_and_passport",
    showMarketInPassport: marketTransparencyMode !== "off",
    labelPlacement,
    qrReason: printPrice.scanPrompt,
  };
};

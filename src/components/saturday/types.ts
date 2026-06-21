// Shared types for Saturday-series sticker templates.
// Presentational only — independent from sticker_templates registry.
// These fields are intentionally tenant-safe so the same template can be branded per dealer
// and hydrated from dealer profile, MarketCheck, Black Book, DMS, CRM, and AutoLabels passport data.

export type SaturdayReviewSourceType =
  | "google"
  | "facebook"
  | "bbb"
  | "cars_com"
  | "dealer_rater"
  | "car_gurus"
  | "edmunds"
  | "yelp"
  | "custom";

export type SaturdayReviewSource = {
  type: SaturdayReviewSourceType;
  label: string;
  rating?: number;
  reviewCount?: number;
  profileUrl?: string;
  /** True when the dealer typed the rating/review count manually instead of AutoLabels fetching it. */
  manuallyEntered?: boolean;
  /** True when AutoLabels may attempt an approved fetch/scrape/integration for this source. */
  allowAutomatedFetch?: boolean;
};

export type SaturdayDealerTheme = {
  /** Main frame/header color chosen by the dealer or inherited from OEM branding. */
  primaryColor?: string;
  /** Supporting accent color for highlights, icons, and CTAs. */
  secondaryColor?: string;
  /** Premium highlight color for price, savings, or certified badges. */
  accentColor?: string;
  /** Soft panel background color. */
  softColor?: string;
  /** Border/frame color. */
  borderColor?: string;
};

export type SaturdayAddendumPricingMode =
  | "new_msrp_plus_addendum"
  | "used_addendum_only"
  | "used_market_value_plus_addendum"
  | "used_live_price_plus_addendum"
  | "passport_live_price_only";

export type SaturdayMarketTransparencyMode = "off" | "print_and_passport" | "passport_only" | "selected_templates_only";

export type SaturdayPassportMode = "enabled" | "disabled" | "selected_templates_only";

export type SaturdayDealer = {
  name: string;
  address: string;
  phone: string;
  website: string;
  /** Optional dealer slogan/tagline, for example "Driven by trust. Backed by service." */
  slogan?: string;
  /** Optional dealer-specific pricing terminology, for example "Best Price", "One Price", "Market Price", or "Selling Price". */
  pricingLabel?: string;
  /** Optional dealer value propositions shown on buyer-facing labels. */
  valueProps?: string[];
  /** Dealer-selected review sources shown on labels/passports. */
  reviewSources?: SaturdayReviewSource[];
  /** Dealer/OEM color controls for frame, headers, accents, and borders. */
  theme?: SaturdayDealerTheme;
  /** Controls whether addendum print shows MSRP, addendum-only, market value, live price, or passport-only live price. */
  addendumPricingMode?: SaturdayAddendumPricingMode;
  /** Controls whether market transparency appears on print, passport, selected templates, or not at all. */
  marketTransparencyMode?: SaturdayMarketTransparencyMode;
  /** Controls whether large window stickers and addendums show/pass through the QR vehicle passport experience. */
  passportMode?: SaturdayPassportMode;
};

export type SaturdayVehicle = {
  title: string;
  vin: string;
  stock: string;
  price: string;
  msrp?: string;
  mileage?: string;
  condition?: "new" | "used";
  /** Optional per-vehicle override for the price label. Falls back to dealer.pricingLabel. */
  priceLabel?: string;
  /** Optional real inventory photo URL. When absent, templates render a print-safe illustration fallback. */
  imageUrl?: string;
};

export type SaturdaySpec = { label: string; value: string };

export type SaturdayFuel = { city: number; highway: number; combined: number };

export type SaturdayMarketData = {
  label?: string;
  status?: string;
  marketAverage?: string;
  delta?: string;
  radius?: string;
  comparableCount?: number;
  recentSoldAverage?: string;
  sourceLabel?: string;
};

export type SaturdaySticker = {
  dealer: SaturdayDealer;
  vehicle: SaturdayVehicle;
  specs: SaturdaySpec[];
  highlights: string[];
  fuel: SaturdayFuel;
  benefits: string[];
  qrUrl: string;
  disclaimer: string;
  /** Optional market-pricing intelligence sourced from MarketCheck, Black Book, and/or dealer data. */
  market?: SaturdayMarketData;
};

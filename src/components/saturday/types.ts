// Shared types for Saturday-series sticker templates.
// Presentational only — independent from sticker_templates registry.
// These fields are intentionally tenant-safe so the same template can be branded per dealer
// and hydrated from dealer profile, MarketCheck, Black Book, DMS, CRM, and AutoLabels passport data.

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
};

export type SaturdayVehicle = {
  title: string;
  vin: string;
  stock: string;
  price: string;
  msrp?: string;
  mileage?: string;
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

// Shared types for Saturday-series sticker templates.
// Presentational only — independent from sticker_templates registry.

export type SaturdayDealer = {
  name: string;
  address: string;
  phone: string;
  website: string;
};

export type SaturdayVehicle = {
  title: string;
  vin: string;
  stock: string;
  price: string;
  msrp?: string;
  mileage?: string;
};

export type SaturdaySpec = { label: string; value: string };

export type SaturdayFuel = { city: number; highway: number; combined: number };

export type SaturdaySticker = {
  dealer: SaturdayDealer;
  vehicle: SaturdayVehicle;
  specs: SaturdaySpec[];
  highlights: string[];
  fuel: SaturdayFuel;
  benefits: string[];
  qrUrl: string;
  disclaimer: string;
};

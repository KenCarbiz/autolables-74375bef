// Synthetic listing rows for the read-model tests. Every identifier is an
// example value; nothing here comes from a production row.

import type { ListingRowLike } from "../listingFacts.ts";

export const NOW = Date.parse("2026-10-28T12:00:00Z");
export const DAY = 86_400_000;
export const iso = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString();
export const epoch = (daysAgo: number): number => Math.floor((NOW - daysAgo * DAY) / 1000);

export const exactSheet = () => ({
  generic: false,
  decoded_at: iso(3),
  source: "neovin",
  taxonomy: { record_source: "build_oem" },
  version: "AUTOGRAPH AWD",
  packages: [
    { name: "Vision Package", code: "VIS", msrp: 1500 },
    { name: "Premium Paint", code: "PNT", msrp: 995 },
  ],
  pricing: { base_msrp: 66150, destination_charge: 1395, total_msrp: 70965 },
  colors: { exterior: { name: "Black Obsidian" }, interior: { name: "Graphite" } },
});

export const factoryWarranty = () => ({
  basis: "original_factory",
  source: "neovin",
  terms: [
    { type: "basic", months: 48, miles: 60000 },
    { type: "powertrain", months: 72, miles: 70000 },
  ],
});

export const vinClear = (daysAgo: number, closed = 0) => ({
  recall_status: "verified_clear",
  open_recall_count: 0,
  closed_recall_count: closed,
  recall_checked_at: iso(daysAgo),
  recall_check: {
    scope: "vin", state: "verified_clear", source: "marketcheck", checked_at: iso(daysAgo),
    open_count: 0, closed_count: closed, has_open: false, campaigns: [],
  },
});

export const vinOpen = (daysAgo: number) => ({
  recall_status: "open_recalls",
  open_recall_count: 1,
  closed_recall_count: 0,
  recall_checked_at: iso(daysAgo),
  recall_check: {
    scope: "vin", state: "open_recalls", source: "marketcheck", checked_at: iso(daysAgo),
    open_count: 1, closed_count: 0, has_open: true,
    campaigns: [{ campaignNumber: "26V000", component: "BRAKES", summary: "Example campaign", status: "open" }],
  },
});

export const vinFailed = (note: string) => ({
  recall_status: null,
  open_recall_count: null,
  closed_recall_count: null,
  recall_checked_at: null,
  recall_check: { scope: "vin", state: "unknown", source: "marketcheck", attempted_at: iso(1), campaigns: [], note },
});

export const noRecall = () => ({
  recall_status: null,
  open_recall_count: null,
  closed_recall_count: null,
  recall_checked_at: null,
  recall_check: null,
  recall_payload: null,
});

export const usedRow = (): ListingRowLike => ({
  vin: "EXAMPLEVIN0000001",
  ymm: "2025 INFINITI QX60",
  trim: "AUTOGRAPH",
  mileage: 41287,
  condition: "used",
  price: 40995,
  mc_attributes: {
    drivetrain: "AWD",
    engine: "3.5L V6",
    transmission: "Automatic",
    exterior_color: "Black",
    interior_color: "Graphite",
    msrp: 69500,
    fees: 895,
    price_includes_fees: false,
    build_sheet: exactSheet(),
    base_msrp: 66150,
    delivery_charges: 1395,
    total_msrp: 70965,
    installed_options_msrp: 3420,
    neovin_confidence: { record_confidence: 98 },
    factory_warranty: factoryWarranty(),
  },
  mc_raw: { last_seen_at: epoch(0.5), in_transit: false, vehicle_status: "available" },
  market_meta: {
    market_days_supply: 38,
    mds_match_level: "YMMT",
    checked_at: iso(2),
    trend: "stable",
    sold_stats: {
      count: 12, dom_median: 27, price_median: 41500, miles_median: 39000, scope: "model_year_state",
      window_days: 90, checked_at: iso(5), source: "marketcheck_recents",
    },
  },
  ...vinClear(7),
  hero_image_url: "https://example.invalid/hero.jpg",
  photos: ["https://example.invalid/1.jpg", { url: "https://example.invalid/2.jpg" }],
  photo_count: 2,
  website_sale_price: 40995,
  website_price_term: "Selling Price",
  price_last_verified_at: iso(1),
  doc_fee: 499,
  in_service_date: "2025-03-14",
  updated_at: iso(0.5),
});

export const newRow = (): ListingRowLike => ({
  vin: "EXAMPLEVIN0000002",
  ymm: "2027 INFINITI QX60",
  trim: "AUTOGRAPH",
  mileage: 12,
  condition: "new",
  price: 68995,
  mc_attributes: {
    drivetrain: "AWD",
    engine: "3.5L V6",
    transmission: "Automatic",
    exterior_color: "Black",
    interior_color: "Graphite",
    msrp: 70965,
    fees: 895,
    price_includes_fees: false,
    build_sheet: exactSheet(),
    base_msrp: 66150,
    delivery_charges: 1395,
    total_msrp: 70965,
    installed_options_msrp: 3420,
    neovin_confidence: { record_confidence: 99 },
    factory_warranty: factoryWarranty(),
  },
  mc_raw: { last_seen_at: epoch(0.5), in_transit: false, vehicle_status: "available" },
  ...vinClear(7),
  hero_image_url: "https://example.invalid/hero-new.jpg",
  photos: ["https://example.invalid/n1.jpg"],
  photo_count: 1,
  website_sale_price: 68995,
  website_price_term: "Selling Price",
  price_last_verified_at: iso(1),
  doc_fee: 499,
  updated_at: iso(0.5),
});

// Synthetic MarketPass rows. Every VIN, dealer, price and date is an example
// value; nothing here comes from a production row.

import type { MarketPassRow } from "../rowEvidence.ts";

export const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
export const iso = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString();
const epoch = (daysAgo: number): number => Math.floor((NOW - daysAgo * DAY) / 1000);

export const TENANT = "00000000-0000-4000-8000-000000000001";
export const OTHER_TENANT = "00000000-0000-4000-8000-000000000002";

/** Doc fee excluded from the advertised price, add-ons answered, dealer type and ZIP known. */
export const settings = (flagOn = true) => ({
  advertised_includes_doc_fee: false,
  mandatory_add_ons_usd: 0,
  mandatory_add_ons_verified: true,
  mandatory_add_ons_included_in_displayed_price: true,
  dealer_type: "franchise",
  dealer_zip: "06001",
  dealer_identity: { rooftopIds: ["rooftop-self"] },
  market_flags: { marketpass_v2: flagOn },
});

const sheet = () => ({
  generic: false,
  decoded_at: iso(20),
  source: "neovin",
  taxonomy: { record_source: "build_oem" },
  version: "SPORT AWD",
  pricing: { base_msrp: 44000, destination_charge: 1200, total_msrp: 47000 },
});

/** Five price-independent comparables: same year, model and trim, within 50 miles, mileage within 20%. */
export const comparableRows = () => [30000, 30500, 31000, 31500, 32000].map((price, i) => ({
  vin: `EXAMPLECOMP00000${i}`,
  ymm: "2023 EXAMPLE MOTORS ROADSTER SPORT",
  trim: "SPORT",
  miles: 30000,
  price,
  dist: 20,
  dealer: `Example Dealer ${i}`,
  dom: 30,
  certified: false,
  doc_fee_included: false,
}));

const vinClear = () => ({
  recall_status: "verified_clear",
  open_recall_count: 0,
  closed_recall_count: 0,
  recall_checked_at: iso(5),
  recall_check: { scope: "vin", state: "verified_clear", source: "marketcheck", checked_at: iso(5), open_count: 0, closed_count: 0, has_open: false, campaigns: [] },
});

export const usedRow = (over: Partial<MarketPassRow> = {}): MarketPassRow => ({
  id: "listing-used-1",
  tenant_id: TENANT,
  slug: "1EXAMPLE2VN000101",
  status: "published",
  vin: "1EXAMPLE2VN000101",
  ymm: "2023 EXAMPLE MOTORS ROADSTER",
  trim: "SPORT",
  mileage: 30000,
  condition: "used",
  price: 29900,
  advertised_price_before_doc: 29900,
  doc_fee: 499,
  mc_attributes: { drivetrain: "AWD", build_sheet: sheet(), neovin_confidence: { record_confidence: 96 } },
  mc_raw: { last_seen_at: epoch(0.5) },
  market_meta: {
    checked_at: iso(2),
    search_checked_at: iso(2),
    similar_count: 212,
    comp_selection: { price_independent: true, total_matches: 212, radius_miles: 50, zip: "06001", checked_at: iso(2) },
    market_days_supply: 48,
    inventory_count: 64,
    mds_checked_at: iso(2),
    sold_stats: { count: 14, dom_median: 34, price_median: 31200, scope: "model_year_state", window_days: 90, checked_at: iso(4), source: "marketcheck_recents" },
  },
  comparables: comparableRows(),
  title_verification: { status: "clean", verified_at: iso(10), verified_by: null, source: "nmvtis", report_generated_at: iso(10), report_expires_at: null, brand_note: null },
  ...vinClear(),
  updated_at: iso(0.5),
  view_count: 7,
  ...over,
});

export const newRow = (over: Partial<MarketPassRow> = {}): MarketPassRow => ({
  id: "listing-new-1",
  tenant_id: TENANT,
  slug: "1EXAMPLE2VN000202",
  status: "published",
  vin: "1EXAMPLE2VN000202",
  ymm: "2027 EXAMPLE MOTORS ROADSTER",
  trim: "SPORT",
  mileage: 8,
  condition: "new",
  price: 46000,
  advertised_price_before_doc: 46000,
  doc_fee: 499,
  mc_attributes: { drivetrain: "AWD", build_sheet: sheet(), total_msrp: 47000, base_msrp: 44000, delivery_charges: 1200, neovin_confidence: { record_confidence: 99 } },
  mc_raw: { last_seen_at: epoch(0.5) },
  market_meta: {},
  comparables: [],
  ...vinClear(),
  updated_at: iso(0.5),
  ...over,
});

export const providerValuation = (predictedValue: number, daysAgo = 3) => ({
  provider: "marketcheck",
  endpointVersion: "us/marketcheck_price@2026-09",
  selectedField: "marketcheck_price",
  predictedValue,
  providerRangeLow: predictedValue - 1500,
  providerRangeHigh: predictedValue + 1500,
  providerRangeMeaning: null,
  providerCertifiedEcho: null,
  requestFingerprint: "example-fingerprint",
  responseHash: "example-hash",
  requestedAt: iso(daysAgo),
  receivedAt: iso(daysAgo),
  rawResponseSanitized: {},
});

/** The row as stored before a comparable writer records its selection: no comp_selection, no per-comp fee basis. */
export const legacyUsedRow = (over: Partial<MarketPassRow> = {}): MarketPassRow => {
  const row = usedRow(over);
  const meta = { ...(row.market_meta as Record<string, unknown>) };
  delete meta.comp_selection;
  return { ...row, market_meta: meta, ...over };
};

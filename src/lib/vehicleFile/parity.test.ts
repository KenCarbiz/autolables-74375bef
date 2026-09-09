import { describe, expect, it } from "vitest";
import { compareVehicle, summariseParity } from "./parity.ts";
import { buildVehicleFileReadModel } from "./readModel.ts";
import type { CriticalField, ParityRow } from "./readModelTypes.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const LISTING_ID = "dd71281a-ea9e-42c3-8eaf-91376656017a";
const VIN = "ZASPAKBN5L7C99407";
const FEED_LAST_SEEN = 1788761804;

// The pilot tenant's 2020 Alfa Romeo Stelvio on 2026-09-09. It is the vehicle
// the maps use for the two-word make defect: the header splits `ymm` on
// whitespace, so the page reads "Alfa" / "Romeo Stelvio" while every source
// agrees the car is an Alfa Romeo Stelvio. Everything else about it agrees.
const listingRow = (over: Row = {}): Row => ({
  id: LISTING_ID,
  tenant_id: TENANT,
  vin: VIN,
  ymm: "2020 Alfa Romeo Stelvio",
  trim: "Ti Sport Carbon",
  condition: "used",
  mileage: 48720,
  price: 20876,
  doc_fee: 895,
  website_sale_price: 20876,
  advertised_price_before_doc: 19981,
  status: "published",
  slug: "alfa-romeo-stelvio-c99407",
  created_at: "2026-07-25T03:07:27.977Z",
  updated_at: "2026-09-09T03:07:23.119Z",
  published_at: "2026-07-28T02:04:24.905Z",
  archived_at: null,
  price_last_verified_at: "2026-09-09T03:07:22.870Z",
  mc_raw: {
    vin: VIN,
    price: 20876,
    miles: 48720,
    stock_no: "I21880SA",
    inventory_type: "used",
    last_seen_at: FEED_LAST_SEEN,
    build: { year: 2020, make: "Alfa Romeo", model: "Stelvio", trim: "Ti Sport Carbon" },
  },
  mc_attributes: {
    year: 2020,
    make: "Alfa Romeo",
    model: "Stelvio",
    trim: "Ti Sport Carbon",
    engine: "2.0L I4",
    drivetrain: "4WD",
    msrp: 24156,
    total_msrp: 60195,
    specs_source: "neovin",
    specs_decoded_at: "2026-07-28T03:15:52.576Z",
    last_seen_at: FEED_LAST_SEEN,
    mc_listing_id: "ZASPAKBN5L7C99407-0468f24c-0ac3",
    build_sheet: {
      source: "neovin",
      decoded_at: "2026-07-28T01:28:49.070Z",
      pricing: { base_msrp: 52300, destination_charge: 1345, total_msrp: 60195 },
    },
  },
  ...over,
});

const fileRow = (over: Row = {}): Row => ({
  tenant_id: TENANT,
  vin: VIN,
  stock_number: "I21880SA",
  mileage: 48720,
  condition: "used",
  year: "2020",
  make: "Alfa Romeo",
  model: "Stelvio",
  trim: "Ti Sport Carbon",
  msrp: "0.00",
  market_value: "0.00",
  created_at: "2026-07-25T03:07:27.938Z",
  updated_at: "2026-09-09T03:07:22.849Z",
  ...over,
});

const factRow = (key: string, value: unknown, kind: string, confidence: string, over: Row = {}): Row => ({
  vehicle_id: LISTING_ID,
  fact_key: key,
  fact_value: { v: value },
  source_kind: kind,
  confidence,
  observed_at: "2026-07-29T13:30:08.551Z",
  evidence: {},
  ...over,
});

const facts = (over: Row[] = []): Row[] => [
  factRow("advertised_price", 23981, "dealer_confirmed", "VERIFIED"),
  factRow("condition", "used", "dealer_confirmed", "VERIFIED"),
  factRow("drivetrain", "4WD", "marketcheck", "HIGH"),
  factRow("engine", "2.0L I4", "marketcheck", "HIGH"),
  factRow("make", "Alfa Romeo", "marketcheck", "HIGH"),
  factRow("mileage", 48720, "dealer_confirmed", "VERIFIED"),
  factRow("model", "Stelvio", "marketcheck", "HIGH"),
  factRow("model_year", 2020, "marketcheck", "HIGH"),
  factRow("total_msrp", 60195, "neovin", "VERIFIED"),
  factRow("trim", "Ti Sport Carbon", "marketcheck", "HIGH"),
  ...over,
];

// The live endpoint with its api_key parameter removed; the builders only test
// it for the substring "neovin".
const neovinRow = (payload: Row = {}): Row => ({
  vin: VIN,
  endpoint: "https://api.marketcheck.com/v2/decode/car/neovin/ZASPAKBN5L7C99407/specs",
  fetched_at: "2026-07-28T01:28:49.070Z",
  payload: {
    vin: VIN,
    year: 2020,
    make: "Alfa Romeo",
    model: "Stelvio",
    trim: "Ti Sport Carbon",
    engine: "2.0L I4",
    drivetrain: "4WD",
    transmission_description: "Automatic With Manual Mode Trans",
    body_type: "SUV",
    fuel_type: "Premium Unleaded",
    msrp: 52300,
    combined_msrp: 60195,
    ...payload,
  },
});

const snapshotRow = (): Row => ({
  id: "3bb73c24-09aa-4d1c-92e5-201a51508168",
  vehicle_id: LISTING_ID,
  created_at: "2026-07-28T02:04:24.905Z",
  snapshot_json: {
    pricing: {
      advertisedPrice: 23981,
      baseMsrp: 52300,
      destinationCharge: 1345,
      factoryOptionsTotal: 7750,
      totalMsrp: 60195,
    },
  },
});

const profileRow = (): Row => ({
  tenant_id: TENANT,
  updated_at: "2026-08-12T14:44:57.554Z",
  settings: {
    doc_fee_enabled: "true",
    doc_fee_amount: "895",
    doc_fee_state: "CT",
    advertised_includes_doc_fee: "true",
    price_display_mode: "website_sale_price",
  },
});

const stelvio = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  listing: listingRow(),
  file: fileRow(),
  facts: facts(),
  snapshot: snapshotRow(),
  neovin: neovinRow(),
  dealerProfile: profileRow(),
  ...over,
});

const compare = (sources: VehicleFileSources): ParityRow[] =>
  compareVehicle(sources, buildVehicleFileReadModel(sources, { now: NOW }));

const row = (rows: ParityRow[], field: CriticalField): ParityRow => {
  const found = rows.find((r) => r.field === field);
  if (!found) throw new Error(`no parity row for ${field}`);
  return found;
};

const verdicts = (rows: ParityRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.field, r.verdict]));

describe("compareVehicle", () => {
  it("compares all twelve fields, and on a real vehicle only the ymm splitter differs", () => {
    const rows = compare(stelvio());

    expect(rows.length).toBe(12);
    expect(verdicts(rows)).toEqual({
      vin: "MATCH",
      year: "MATCH",
      make: "CURRENT_OLD_VALUE_WRONG",
      model: "CURRENT_OLD_VALUE_WRONG",
      trim: "MATCH",
      stock: "MATCH",
      mileage: "MATCH",
      advertised_retail: "MATCH",
      msrp: "MATCH",
      engine: "MATCH",
      drivetrain: "MATCH",
      condition: "MATCH",
    });

    const price = row(rows, "advertised_retail");
    expect(price.currentValue).toBe(20876);
    expect(price.resolvedValue).toBe(20876);
    expect(price.currentOrigin).toContain("vehicle_listings.price");
    expect(price.resolvedOrigin).toBe("vehicle_listings.price");
    expect(price.resolvedProvider).not.toBeNull();
    expect(price.freshness).toBe("CURRENT");
    expect(price.observedAt).toBe("2026-09-09T03:07:22.870Z");
    expect(rows.every((r) => r.vin === VIN && r.vehicleId === LISTING_ID && r.tenantId === TENANT)).toBe(true);
    expect(rows.every((r) => r.explanation.length > 0)).toBe(true);
  });

  it("names the two-word make split, on both halves of it", () => {
    const rows = compare(stelvio());

    const make = row(rows, "make");
    expect(make.currentValue).toBe("Alfa");
    expect(make.resolvedValue).toBe("Alfa Romeo");
    expect(make.explanation).toContain("OemDocFinders.tsx:33-40");
    expect(make.explanation).toContain("ZASPAKBN5L7C99407");

    const model = row(rows, "model");
    expect(model.currentValue).toBe("Romeo Stelvio");
    expect(model.resolvedValue).toBe("Stelvio");
    expect(model.explanation).toContain("Romeo");
  });

  it("does not blame the splitter when the make is one word", () => {
    const rows = compare(stelvio({
      listing: listingRow({
        ymm: "2023 Jeep Wrangler 4-Door",
        mc_attributes: { ...(listingRow().mc_attributes as Row), make: "Jeep", model: "Wrangler 4-Door" },
      }),
      neovin: neovinRow({ make: "Jeep", model: "Wrangler 4-Door" }),
      file: fileRow({ make: "Jeep", model: "Wrangler 4-Door" }),
      facts: facts().filter((f) => f.fact_key !== "make" && f.fact_key !== "model"),
    }));

    expect(row(rows, "make").verdict).toBe("MATCH");
    expect(row(rows, "model").verdict).toBe("MATCH");
  });

  it("treats a fee-inclusive total against a fee-exclusive dealer confirmation as an expected difference", () => {
    const rows = compare(stelvio({
      advertisedPrices: [{
        tenant_id: TENANT,
        vin: VIN,
        advertised_price: 19981,
        captured_method: "manual_dealer_confirmation",
        source_channel: "manual",
        captured_at: "2026-09-09T09:00:00.000Z",
      }],
    }));

    const price = row(rows, "advertised_retail");
    expect(price.currentValue).toBe(20876);
    expect(price.resolvedValue).toBe(19981);
    expect(price.verdict).toBe("EXPECTED_SOURCE_DIFFERENCE");
    expect(price.explanation).toContain("895");
    expect(price.explanation).toContain("doc fee");
  });

  it("leaves a price difference that is not the doc fee UNEXPLAINED, and §51 then fails", () => {
    const rows = compare(stelvio({
      advertisedPrices: [{
        tenant_id: TENANT,
        vin: VIN,
        advertised_price: 18500,
        captured_method: "manual_dealer_confirmation",
        source_channel: "manual",
        captured_at: "2026-09-09T09:00:00.000Z",
      }],
    }));

    const price = row(rows, "advertised_retail");
    expect(price.verdict).toBe("UNEXPLAINED");
    expect(price.explanation).toContain("No rule explains the difference");

    const summary = summariseParity(rows, 130);
    expect(summary.fullyExplained.advertised_retail).toBe(false);
    expect(summary.fullyExplained.vin).toBe(true);
    expect(summary.unexplained.map((r) => r.field)).toEqual(["advertised_retail"]);
  });

  it("never lets a refused page reading become the advertised retail answer", () => {
    const sources = stelvio({
      crawlRefusals: [{
        action: "advertised_price_crawl_skipped",
        entity_type: "advertised_price",
        entity_id: VIN,
        store_id: TENANT,
        created_at: "2026-09-09T06:42:13.775Z",
        details: { vin: VIN, reason: "advertised_above_feed", scraped: 63100, feed: 20876 },
      }],
      crawlAttempt: { vin: VIN, outcome: "price_rejected", last_attempt_at: "2026-09-09T06:42:13.800Z" },
    });
    const model = buildVehicleFileReadModel(sources, { now: NOW });
    const rows = compareVehicle(sources, model);

    expect(row(rows, "advertised_retail").verdict).toBe("MATCH");
    expect(row(rows, "advertised_retail").resolvedValue).toBe(20876);
    expect(model.publicAdvertisement.observedPrice.value).toBeNull();
    expect(model.publicAdvertisement.lastRefused).toEqual({
      scraped: 63100,
      feed: 20876,
      at: "2026-09-09T06:42:13.775Z",
    });
  });

  it("reports the truth card showing nothing when the vehicle has no snapshot", () => {
    const rows = compare(stelvio({ snapshot: null }));

    const msrp = row(rows, "msrp");
    expect(msrp.currentValue).toBeNull();
    expect(msrp.currentOrigin).toContain("VehicleTruthCard.tsx:182");
    expect(msrp.resolvedValue).toBe(60195);
    expect(msrp.verdict).toBe("CURRENT_OLD_VALUE_WRONG");
    expect(row(rows, "engine").verdict).toBe("CURRENT_OLD_VALUE_WRONG");
  });

  it("says plainly when neither surface shows a value", () => {
    const rows = compare(emptySources(TENANT));

    expect(rows.length).toBe(12);
    expect(rows.every((r) => r.verdict === "MATCH")).toBe(true);
    expect(rows.every((r) => r.explanation.startsWith("Neither surface shows a value."))).toBe(true);
    expect(row(rows, "stock").explanation).toContain("Vehicle not found");
  });

  it("reports the feed echo of a stock number as the current path being wrong", () => {
    const rows = compare(stelvio({
      listing: listingRow({
        mc_attributes: { ...(listingRow().mc_attributes as Row), stock_no: "OLD123" },
      }),
    }));

    const stock = row(rows, "stock");
    expect(stock.currentValue).toBe("OLD123");
    expect(stock.currentOrigin).toBe("vehicle_listings.mc_attributes->stock_no");
    expect(stock.resolvedValue).toBe("I21880SA");
    expect(stock.verdict).toBe("CURRENT_OLD_VALUE_WRONG");
    expect(stock.explanation).toContain("vehicleStockNumber.ts:32-47");
  });

  it("reports AWD against All Wheel Drive as one drivetrain written two ways", () => {
    const rows = compare(stelvio({
      neovin: neovinRow({ drivetrain: "All Wheel Drive" }),
      facts: facts().map((f) => (f.fact_key === "drivetrain" ? factRow("drivetrain", "AWD", "marketcheck", "HIGH") : f)),
    }));

    const drivetrain = row(rows, "drivetrain");
    expect(drivetrain.currentValue).toBe("AWD");
    expect(drivetrain.resolvedValue).toBe("All Wheel Drive");
    expect(drivetrain.verdict).toBe("EXPECTED_SOURCE_DIFFERENCE");
    expect(drivetrain.explanation).toContain("same drivetrain");
  });

  it("reports a longer NeoVIN engine description as a source difference, not a mismatch", () => {
    const rows = compare(stelvio({
      neovin: neovinRow({ engine: "2.0L I4 DOHC DI Turbo" }),
    }));

    const engine = row(rows, "engine");
    expect(engine.currentValue).toBe("2.0L I4");
    expect(engine.resolvedValue).toBe("2.0L I4 DOHC DI Turbo");
    expect(engine.verdict).toBe("EXPECTED_SOURCE_DIFFERENCE");
  });

  it("proves the card is an older copy when the orchestrator wrote before the source observed", () => {
    const rows = compare(stelvio({
      facts: facts().map((f) => (
        f.fact_key === "total_msrp"
          ? factRow("total_msrp", 58000, "neovin", "VERIFIED", { observed_at: "2026-07-01T00:00:00.000Z" })
          : f
      )),
    }));

    const msrp = row(rows, "msrp");
    expect(msrp.currentValue).toBe(58000);
    expect(msrp.resolvedValue).toBe(60195);
    expect(msrp.verdict).toBe("CURRENT_OLD_VALUE_WRONG");
    expect(msrp.explanation).toContain("orchestration time");
    expect(msrp.explanation).toContain("2026-07-01T00:00:00.000Z");
  });

  it("does not call the card an older copy when it was written after the source observed", () => {
    const rows = compare(stelvio({
      facts: facts().map((f) => (
        f.fact_key === "total_msrp"
          ? factRow("total_msrp", 58000, "neovin", "VERIFIED", { observed_at: "2026-09-01T00:00:00.000Z" })
          : f
      )),
    }));

    expect(row(rows, "msrp").verdict).toBe("UNEXPLAINED");
  });

  it("calls the new-car mileage zero an expected difference against no reading at all", () => {
    // Synthetic on purpose: no pilot listing carries a mileage of 0 today, so
    // this rule guards a shape that the maps name (the new-car 0-vs-null split)
    // but that the sync's refusal to store a feed zero keeps off the listing row.
    const rows = compare(stelvio({
      listing: listingRow({
        condition: "new",
        mileage: 0,
        mc_raw: { ...(listingRow().mc_raw as Row), miles: null, inventory_type: "new" },
      }),
      file: fileRow({ condition: "new", mileage: 0 }),
      facts: facts().filter((f) => f.fact_key !== "mileage" && f.fact_key !== "condition"),
    }));

    const mileage = row(rows, "mileage");
    expect(mileage.currentValue).toBe(0);
    expect(mileage.resolvedValue).toBeNull();
    expect(mileage.verdict).toBe("EXPECTED_SOURCE_DIFFERENCE");
    expect(mileage.explanation).toContain("marketcheck-sync/index.ts:1054");
  });

  it("reports the live new-car shape as an absence on both sides", () => {
    // The 43 live new cars: the listing has no reading and vehicle_files holds
    // 0 as a placeholder, which dealerState refuses to read as a mileage. Both
    // arms therefore show nothing, and the row says so rather than agreeing.
    const rows = compare(stelvio({
      listing: listingRow({
        condition: "new",
        mileage: null,
        mc_raw: { ...(listingRow().mc_raw as Row), miles: null, inventory_type: "new" },
      }),
      file: fileRow({ condition: "new", mileage: 0 }),
      facts: facts().filter((f) => f.fact_key !== "mileage" && f.fact_key !== "condition"),
    }));

    const mileage = row(rows, "mileage");
    expect(mileage.verdict).toBe("MATCH");
    expect(mileage.explanation.startsWith("Neither surface shows a value.")).toBe(true);
    expect(mileage.explanation).toContain("vehicle_files.mileage");
  });
});

describe("summariseParity", () => {
  it("rolls up the fields, the totals and the §51 verdict", () => {
    const rows = compare(stelvio());
    const summary = summariseParity(rows, 130, ["advertised_prices: query timed out"]);

    expect(summary.activeVins).toBe(130);
    expect(summary.comparedVins).toBe(1);
    expect(summary.totals.MATCH).toBe(10);
    expect(summary.totals.CURRENT_OLD_VALUE_WRONG).toBe(2);
    expect(summary.totals.UNEXPLAINED).toBe(0);
    expect(summary.byField.make.CURRENT_OLD_VALUE_WRONG).toBe(1);
    expect(summary.byField.vin.MATCH).toBe(1);
    expect(summary.byField.msrp.UNEXPLAINED).toBe(0);
    expect(summary.unexplained).toEqual([]);
    expect(summary.fullyExplained).toEqual({
      vin: true,
      stock: true,
      mileage: true,
      advertised_retail: true,
    });
    expect(summary.missingSources).toEqual({ "advertised_prices: query timed out": 1 });
  });

  it("counts one UNEXPLAINED on a §51 field as a failure for the whole population", () => {
    const good = compare(stelvio());
    const bad = compare(stelvio({
      listing: listingRow({ id: "other-listing", vin: "1C4HJXDN4PW657311" }),
      file: fileRow({ vin: "1C4HJXDN4PW657311", stock_number: "4694NA" }),
      advertisedPrices: [{
        tenant_id: TENANT,
        vin: "1C4HJXDN4PW657311",
        advertised_price: 18500,
        captured_method: "manual_dealer_confirmation",
        source_channel: "manual",
        captured_at: "2026-09-09T09:00:00.000Z",
      }],
    }));

    const summary = summariseParity([...good, ...bad], 130);
    expect(summary.comparedVins).toBe(2);
    expect(summary.fullyExplained.advertised_retail).toBe(false);
    expect(summary.unexplained.length).toBeGreaterThan(0);
    expect(summary.unexplained.every((r) => r.explanation.length > 0)).toBe(true);
  });

  it("counts stale and conflicted resolutions from the rows", () => {
    const rows = compare(stelvio({
      listing: listingRow({
        price_last_verified_at: "2026-07-01T03:07:22.870Z",
        mc_raw: { ...(listingRow().mc_raw as Row), last_seen_at: 1782874800 },
        mc_attributes: { ...(listingRow().mc_attributes as Row), last_seen_at: 1782874800 },
      }),
    }));

    const summary = summariseParity(rows, 130);
    expect(summary.staleValues).toBeGreaterThan(0);
    expect(row(rows, "advertised_retail").freshness).toBe("STALE");
  });

  it("zeroes every field and every class, so an absent field is visible as zero", () => {
    const summary = summariseParity([], 130);

    expect(summary.comparedVins).toBe(0);
    expect(Object.keys(summary.byField).length).toBe(12);
    expect(summary.byField.engine).toEqual({
      MATCH: 0,
      SEMANTIC_MATCH: 0,
      CURRENT_OLD_VALUE_WRONG: 0,
      NEW_VALUE_WRONG: 0,
      EXPECTED_SOURCE_DIFFERENCE: 0,
      UNEXPLAINED: 0,
    });
    expect(summary.missingSources).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { buildVehicleFileReadModel } from "./readModel.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const OTHER_TENANT = "93ae75c1-0000-0000-0000-000000000000";
const LISTING_ID = "dd71281a-ea9e-42c3-8eaf-91376656017a";
const VIN = "ZASPAKBN5L7C99407";

// Every shape below is the pilot tenant's 2020 Alfa Romeo Stelvio as it stood
// on 2026-09-09: the vehicle the maps use for the two-word make defect, whose
// truth ledger still holds the 23,981 it was published at while the feed price
// is 20,876.
const FEED_LAST_SEEN = 1788761804;

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
  dealer_discount: null,
  status: "published",
  slug: "alfa-romeo-stelvio-c99407",
  created_at: "2026-07-25T03:07:27.977Z",
  updated_at: "2026-09-09T03:07:23.119Z",
  published_at: "2026-07-28T02:04:24.905Z",
  archived_at: null,
  price_last_verified_at: "2026-09-09T03:07:22.870Z",
  photos: ["https://images.dealer.com/harte/stelvio-1.jpg"],
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

const factRow = (key: string, value: unknown, kind: string, confidence: string): Row => ({
  vehicle_id: LISTING_ID,
  fact_key: key,
  fact_value: { v: value },
  source_kind: kind,
  confidence,
  observed_at: "2026-07-29T13:30:08.551Z",
  evidence: {},
});

const facts = (): Row[] => [
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
];

// `endpoint` is the live value with its api_key parameter removed: the builders
// only test it for the substring "neovin", and a key never belongs in a fixture.
const neovinRow = (over: Row = {}): Row => ({
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
  },
  ...over,
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

const profileRow = (settings: Row = {}): Row => ({
  tenant_id: TENANT,
  updated_at: "2026-08-12T14:44:57.554Z",
  settings: {
    doc_fee_enabled: "true",
    doc_fee_amount: "895",
    doc_fee_state: "CT",
    advertised_includes_doc_fee: "true",
    price_display_mode: "website_sale_price",
    ...settings,
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

describe("buildVehicleFileReadModel", () => {
  it("assembles every section of one vehicle from one bundle", () => {
    const model = buildVehicleFileReadModel(stelvio(), { now: NOW });

    expect(model.version).toBe(1);
    expect(model.tenantId).toBe(TENANT);
    expect(model.vehicleId).toBe(LISTING_ID);
    expect(model.vin).toBe(VIN);
    expect(model.generatedAt).toBe("2026-09-09T12:00:00.000Z");
    expect(model.warnings).toEqual([]);

    expect(model.identity.vin.value).toBe(VIN);
    expect(model.identity.make.value).toBe("Alfa Romeo");
    expect(model.identity.model.value).toBe("Stelvio");
    expect(model.identity.engine.value).toBe("2.0L I4");
    expect(model.dealerState.stock.value).toBe("I21880SA");
    expect(model.dealerState.mileage.value).toBe(48720);
    expect(model.dealerState.condition.value).toBe("used");
    expect(model.pricing.advertisedRetail.value).toBe(20876);
    expect(model.pricing.docFee.value).toBe(895);
    expect(model.pricing.msrpFactory.value).toBe(60195);
    expect(model.pricing.advertisedIncludesDocFee).toBe(true);
    expect(model.media.photoCount).toBe(1);
    expect(model.customer.passportSlug).toBe("alfa-romeo-stelvio-c99407");
    expect(model.sourceHealth.length).toBeGreaterThan(0);
    expect(Array.isArray(model.recentChanges)).toBe(true);
  });

  it("passes the resolved price to publishing rather than letting it resolve a second one", () => {
    const fresh = buildVehicleFileReadModel(stelvio(), { now: NOW });
    expect(fresh.pricing.advertisedRetail.freshness).toBe("CURRENT");
    expect(fresh.publishing.autofilmEligible).toBe(true);

    // Every feed candidate has to be aged, not just the column: `mc_raw.price`
    // carries the same 20,876 under MarketCheck's own last_seen_at, and on a
    // stamp tie-break it would win and report CURRENT.
    const old = listingRow();
    const stale = buildVehicleFileReadModel(
      stelvio({
        listing: listingRow({
          price_last_verified_at: "2026-07-01T03:07:22.870Z",
          mc_raw: { ...(old.mc_raw as Row), last_seen_at: 1782874800 },
          mc_attributes: { ...(old.mc_attributes as Row), last_seen_at: 1782874800 },
        }),
      }),
      { now: NOW },
    );
    expect(stale.pricing.advertisedRetail.freshness).toBe("STALE");
    expect(stale.publishing.autofilmEligible).toBe(false);
  });

  it("keeps the stale ledger copy of the price visible as a conflict", () => {
    const model = buildVehicleFileReadModel(stelvio(), { now: NOW });
    const priceConflicts = model.conflicts.filter((c) => c.field === "advertised_retail");

    expect(priceConflicts.length).toBeGreaterThan(0);
    expect(priceConflicts.every((c) => c.winner.origin === "vehicle_listings.price")).toBe(true);
    expect(priceConflicts.some((c) => c.loser.value === 23981)).toBe(true);
    expect(priceConflicts.some((c) => c.loser.origin.startsWith("vehicle_facts"))).toBe(true);
    expect(priceConflicts.every((c) => c.disputed === false)).toBe(true);
  });

  it("carries the resolver's expected-disagreement sentence onto the conflict", () => {
    const model = buildVehicleFileReadModel(stelvio(), { now: NOW });
    const declared = model.conflicts.filter((c) => c.expectedBecause !== null);
    for (const conflict of declared) {
      expect(conflict.expectedBecause).not.toBe("");
      expect(conflict.disputed).toBe(false);
    }
  });

  it("gives every resolved field a key that is unique across sections", () => {
    const model = buildVehicleFileReadModel(stelvio(), { now: NOW });
    const keys = [
      model.identity.vin, model.identity.year, model.identity.make, model.identity.model,
      model.identity.trim, model.identity.bodyStyle, model.identity.exteriorColor,
      model.identity.interiorColor, model.identity.engine, model.identity.drivetrain,
      model.identity.transmission, model.identity.fuelType,
      model.dealerState.stock, model.dealerState.mileage, model.dealerState.condition,
      model.dealerState.certified, model.dealerState.inTransit, model.dealerState.listingStatus,
      model.dealerState.daysInInventory,
      model.pricing.advertisedRetail, model.pricing.sellingPrice, model.pricing.docFee,
      model.pricing.dealerDiscount, model.pricing.msrpFactory, model.pricing.msrpFeed,
      model.publicAdvertisement.observedPrice, model.publicAdvertisement.observedBeforeDocFee,
      model.publicAdvertisement.observedDocFee, model.publicAdvertisement.observedDiscount,
      model.marketIntelligence.marketValue, model.marketIntelligence.daysOnMarket,
      model.marketIntelligence.comparableCount, model.marketIntelligence.marketDaysSupply,
      model.marketIntelligence.priceChangePercent, model.marketIntelligence.referencePrice,
      model.compliance.recallStatus, model.compliance.openRecallCount,
      model.compliance.titleStatus, model.compliance.titleVerification,
    ].map((field) => field.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives the attention line from the assembled sections", () => {
    const model = buildVehicleFileReadModel(stelvio(), { now: NOW });
    expect(model.blocker).toContain("Buyers Guide");
    expect(model.currentOwner).toBe("Compliance/Admin");
    expect(model.nextAction).not.toBeNull();
  });

  it("returns a whole model for a vehicle that has nothing but a listing row", () => {
    const sources = { ...emptySources(TENANT), listing: listingRow() };
    const model = buildVehicleFileReadModel(sources, { now: NOW });

    expect(model.vin).toBe(VIN);
    expect(model.identity.make.value).toBe("Alfa Romeo");
    expect(model.dealerState.stock.value).toBe("I21880SA");
    expect(model.getReady.stage).toBeNull();
    expect(model.documents.counts.generated).toBe(0);
    // `missingSources` names a section that emitted NO candidate at all, which
    // is not the same as a section whose candidates were all empty: market
    // intelligence still reports six null candidates and explains each in its
    // own reason, while the crawl ledger was never consulted.
    expect(model.missingSources).toContain(
      "publicAdvertisement: no source supplied a candidate for any field in this section.",
    );
    expect(model.marketIntelligence.marketValue.candidates.length).toBeGreaterThan(0);
  });

  it("names the gap when there is no listing row at all, and still returns a model", () => {
    const model = buildVehicleFileReadModel(emptySources(TENANT), { now: NOW });

    expect(model.vin).toBe("");
    expect(model.vehicleId).toBe("");
    expect(model.identity.vin.value).toBeNull();
    expect(model.warnings.some((w) => w.includes("No vehicle_listings row"))).toBe(true);
    expect(model.warnings.some((w) => w.includes("No VIN on any source"))).toBe(true);
    expect(model.missingSources.some((line) => line.startsWith("identity:"))).toBe(true);
  });

  it("carries the bundle's own read failures into missingSources", () => {
    const sources = stelvio({ missing: ["advertised_prices: query timed out"] });
    const model = buildVehicleFileReadModel(sources, { now: NOW });
    expect(model.missingSources[0]).toBe("advertised_prices: query timed out");
  });

  it("warns when the listing belongs to a different tenant than the bundle", () => {
    const sources = stelvio({ listing: listingRow({ tenant_id: OTHER_TENANT }) });
    const model = buildVehicleFileReadModel(sources, { now: NOW });

    expect(model.tenantId).toBe(OTHER_TENANT);
    expect(model.warnings.some((w) => w.includes(OTHER_TENANT) && w.includes(TENANT))).toBe(true);
  });

  it("warns when the stored VIN cannot be validated, and still reports the vehicle", () => {
    const sources = stelvio({
      listing: listingRow({ vin: "NOTAVIN", mc_raw: { price: 20876, last_seen_at: FEED_LAST_SEEN } }),
      file: null,
      neovin: null,
    });
    const model = buildVehicleFileReadModel(sources, { now: NOW });

    expect(model.identity.vin.value).toBeNull();
    expect(model.vin).toBe("NOTAVIN");
    expect(model.warnings.some((w) => w.includes("ISO 3779"))).toBe(true);
  });

  it("never throws when a store cannot be read: the section is empty and the failure is named", () => {
    const unreadable = new Proxy({} as Row, {
      get() {
        throw new Error("row unreadable");
      },
    });
    const model = buildVehicleFileReadModel(stelvio({ engagement: [unreadable] }), { now: NOW });

    expect(model.customer.scans).toBe(0);
    expect(model.customer.lastActivityAt).toBeNull();
    expect(model.warnings.some((w) => w.startsWith("customer could not be assembled"))).toBe(true);
    expect(model.identity.make.value).toBe("Alfa Romeo");
    expect(model.pricing.advertisedRetail.value).toBe(20876);
  });
});

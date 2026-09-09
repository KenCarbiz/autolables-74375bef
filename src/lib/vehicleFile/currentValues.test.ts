import { describe, expect, it } from "vitest";
import { currentDisplayedValues } from "./currentValues.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";
import { vehicleStockNumber } from "../vehicleStockNumber.ts";

// Fixtures are live pilot-tenant shapes (Harte Infiniti,
// 3f0f97f5-4151-4e32-88ef-e2d6fc5a3142), read 2026-09-09.
//
// ZASPAKBN5L7C99407 is the vehicle the Gate 1 maps name for two of the defects
// this mirror has to reproduce: its ymm is "2020 Alfa Romeo Stelvio" (a
// two-word make, VEHICLE_FILE_CURRENT_STATE_MAP §6) and its `advertised_price`
// fact (23,981, observed 2026-07-29) is two months older than the
// `vehicle_listings.price` the header actually prints (20,876).

const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VEHICLE_ID = "dd71281a-ea9e-42c3-8eaf-91376656017a";
const VIN = "ZASPAKBN5L7C99407";

const listing = (over: Row = {}): Row => ({
  id: VEHICLE_ID,
  tenant_id: TENANT,
  vin: VIN,
  ymm: "2020 Alfa Romeo Stelvio",
  trim: "Ti Sport Carbon",
  condition: "used",
  status: "published",
  mileage: 48720,
  price: 20876,
  website_sale_price: 19981,
  advertised_price_before_doc: 19981,
  mc_attributes: { make: "Alfa Romeo", model: "Stelvio", engine: "2.0L I4", drivetrain: "4WD", msrp: 60195 },
  sticker_snapshot: {},
  ...over,
});

const file = (over: Row = {}): Row => ({
  tenant_id: TENANT,
  vin: VIN,
  stock_number: "I21880SA",
  year: "2020",
  make: "Alfa Romeo",
  model: "Stelvio",
  trim: "Ti Sport Carbon",
  mileage: 48720,
  msrp: "0.00",
  condition: "used",
  ...over,
});

const snapshot = (): Row => ({
  id: "3bb73c24-09aa-4d1c-92e5-201a51508168",
  snapshot_version: 1,
  content_checksum: "08f4a96d9f94110a1dcd751a80fc8f76befb075d4f12a14eff22b017de3487bd",
  has_unresolved_conflicts: false,
  created_at: "2026-07-28T02:04:24.905Z",
});

const fact = (fact_key: string, v: unknown, over: Row = {}): Row => ({
  fact_key,
  fact_value: { v },
  source_kind: "marketcheck",
  confidence: "HIGH",
  authority: "shared",
  usable_in_copy: true,
  evidence: {},
  observed_at: "2026-07-29T13:30:08.551Z",
  overridden_by: null,
  ...over,
});

const liveFacts = (): Row[] => [
  fact("advertised_price", 23981, { source_kind: "dealer_confirmed", confidence: "VERIFIED", authority: "dealer" }),
  fact("base_msrp", 52300, { source_kind: "neovin", confidence: "VERIFIED", authority: "manufacturer" }),
  fact("condition", "used", { source_kind: "dealer_confirmed", confidence: "VERIFIED" }),
  fact("drivetrain", "4WD", { authority: "manufacturer" }),
  fact("engine", "2.0L I4", { authority: "manufacturer" }),
  fact("make", "Alfa Romeo", { authority: "manufacturer" }),
  fact("mileage", 48720, { source_kind: "dealer_confirmed", confidence: "VERIFIED" }),
  fact("model", "Stelvio"),
  fact("model_year", 2020, { authority: "manufacturer" }),
  fact("total_msrp", 60195, { source_kind: "neovin", confidence: "VERIFIED", authority: "manufacturer" }),
  fact("trim", "Ti Sport Carbon"),
];

const live = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  listing: listing(),
  file: file(),
  snapshot: snapshot(),
  facts: liveFacts(),
  ...over,
});

describe("currentDisplayedValues — happy path (live pilot vehicle)", () => {
  const shown = currentDisplayedValues(live());

  it("reads VIN, trim, mileage, condition and price straight off vehicle_listings", () => {
    expect(shown.vin).toEqual({ value: VIN, origin: "vehicle_listings.vin" });
    expect(shown.trim).toEqual({ value: "Ti Sport Carbon", origin: "vehicle_listings.trim" });
    expect(shown.mileage).toEqual({ value: 48720, origin: "vehicle_listings.mileage" });
    expect(shown.condition).toEqual({ value: "used", origin: "vehicle_listings.condition" });
  });

  it("takes advertised retail from vehicle_listings.price, the column the header prints", () => {
    expect(shown.advertised_retail.value).toBe(20876);
    expect(shown.advertised_retail.origin).toContain("vehicle_listings.price");
    expect(shown.advertised_retail.origin).toContain("VehicleFile.tsx:311");
  });

  it("returns raw values, not the strings the page formats them into", () => {
    expect(shown.advertised_retail.value).not.toBe("$20,876");
    expect(shown.mileage.value).not.toBe("48,720 mi");
  });

  it("resolves every one of the twelve fields", () => {
    expect(Object.keys(shown).sort()).toEqual([
      "advertised_retail", "condition", "drivetrain", "engine", "make", "mileage",
      "model", "msrp", "stock", "trim", "vin", "year",
    ]);
    for (const [field, current] of Object.entries(shown)) {
      expect(current.origin, `${field} must always name an origin`).not.toBe("");
    }
  });
});

describe("currentDisplayedValues — the ymm defect the maps named, now closed", () => {
  it("keeps a two-word make whole, from the feed's own key rather than a split", () => {
    const shown = currentDisplayedValues(live());
    expect(shown.year.value).toBe(2020);
    expect(shown.make.value).toBe("Alfa Romeo");
    expect(shown.model.value).toBe("Stelvio");
    expect(shown.make.origin).toContain("mc_attributes");
  });

  it("leaves a single-word make untouched", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ ymm: "2026 INFINITI QX60", mc_attributes: { make: "INFINITI", model: "QX60" } }),
    }));
    expect(shown.year.value).toBe(2026);
    expect(shown.make.value).toBe("INFINITI");
    expect(shown.model.value).toBe("QX60");
  });

  it("falls back to the shared parser when the row carries no structured key", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ ymm: "2024 Land Rover Defender 110", mc_attributes: {} }),
    }));
    expect(shown.make.value).toBe("Land Rover");
    expect(shown.model.value).toBe("Defender 110");
    expect(shown.make.origin).toContain("parseYmm");
  });

  it("reports year, make and model as absent when nothing states them", () => {
    const shown = currentDisplayedValues(live({ listing: listing({ ymm: null, mc_attributes: {} }) }));
    expect(shown.year.value).toBeNull();
    expect(shown.make.value).toBeNull();
    expect(shown.model.value).toBeNull();
    expect(shown.year.origin).toContain("Vehicle needs a VIN decode");
  });
});

describe("currentDisplayedValues — stock precedence", () => {
  it("reaches vehicle_files.stock_number only third, which is the pilot tenant's only source", () => {
    const shown = currentDisplayedValues(live());
    expect(shown.stock.value).toBe("I21880SA");
    expect(shown.stock.origin).toContain("vehicle_files.stock_number");
    expect(shown.stock.origin).toContain("VehicleFile.tsx:105-112");
  });

  it("lets mc_attributes.stock_no outrank the DMS number when the feed carries one", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ mc_attributes: { stock_no: "FEED-1" } }),
    }));
    expect(shown.stock.value).toBe("FEED-1");
    expect(shown.stock.origin).toBe("vehicle_listings.mc_attributes->stock_no");
  });

  it("takes mc_attributes.dealer.stock_no ahead of vehicle_files", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ mc_attributes: { dealer: { stock_no: "DEALER-2" } } }),
    }));
    expect(shown.stock.value).toBe("DEALER-2");
    expect(shown.stock.origin).toBe("vehicle_listings.mc_attributes->dealer->stock_no");
  });

  it("falls through the sticker snapshot slots when nothing earlier carries one", () => {
    const snap = (s: Row) => currentDisplayedValues(live({
      listing: listing({ sticker_snapshot: s }),
      file: null,
    }));
    expect(snap({ stock_number: "S1" }).stock.origin).toBe("vehicle_listings.sticker_snapshot->stock_number");
    expect(snap({ stock: "S2" }).stock.value).toBe("S2");
    expect(snap({ decoded: { stock_number: "S3" } }).stock.value).toBe("S3");
    expect(snap({ decoded: { stock: "S4" } }).stock.origin)
      .toBe("vehicle_listings.sticker_snapshot->decoded->stock");
  });

  it("says so, rather than crashing, when no vehicle_files row exists", () => {
    const shown = currentDisplayedValues(live({ file: null }));
    expect(shown.stock.value).toBeNull();
    expect(shown.stock.origin).toContain("Stock # not on the feed");
  });

  it("agrees with vehicleStockNumber() on every shape, so the mirror cannot drift", () => {
    const shapes: Array<{ l: Row; f: Row | null }> = [
      { l: listing(), f: file() },
      { l: listing(), f: null },
      { l: listing({ mc_attributes: { stock_no: "FEED-1", dealer: { stock_no: "DEALER-2" } } }), f: file() },
      { l: listing({ mc_attributes: { dealer: { stock_no: "DEALER-2" } } }), f: file() },
      { l: listing({ sticker_snapshot: { stock: "S2" } }), f: null },
      { l: listing({ sticker_snapshot: { decoded: { stock_number: "S3" } } }), f: null },
      { l: listing({ mc_attributes: { stock_no: "  " } }), f: file({ stock_number: 4021 }) },
      { l: listing(), f: file({ stock_number: "   " }) },
    ];
    for (const shape of shapes) {
      const patched = String(shape.f?.stock_number ?? "").trim();
      const asThePageSeesIt = patched
        ? { ...shape.l, stock_number: patched }
        : shape.l;
      expect(currentDisplayedValues(live({ listing: shape.l, file: shape.f })).stock.value)
        .toEqual(vehicleStockNumber(asThePageSeesIt));
    }
  });
});

describe("currentDisplayedValues — MSRP, engine and drivetrain come only from the truth card", () => {
  it("renders total_msrp, engine and drivetrain from vehicle_facts", () => {
    const shown = currentDisplayedValues(live());
    expect(shown.msrp.value).toBe(60195);
    expect(shown.msrp.origin).toContain("fact_key='total_msrp'");
    expect(shown.engine.value).toBe("2.0L I4");
    expect(shown.drivetrain.value).toBe("4WD");
  });

  it("shows none of the three when no vehicle_snapshots row exists (5 of 130 pilot listings)", () => {
    const shown = currentDisplayedValues(live({ snapshot: null }));
    expect(shown.msrp.value).toBeNull();
    expect(shown.engine.value).toBeNull();
    expect(shown.drivetrain.value).toBeNull();
    expect(shown.engine.origin).toContain("VehicleTruthCard.tsx:182");
  });

  it("ignores the mc_attributes candidates the page holds but never renders", () => {
    const shown = currentDisplayedValues(live({
      snapshot: null,
      listing: listing({ mc_attributes: { msrp: 60195, engine: "2.0L I4", drivetrain: "4WD" } }),
    }));
    expect(shown.msrp.value).toBeNull();
    expect(shown.engine.value).toBeNull();
    expect(shown.drivetrain.value).toBeNull();
  });

  it("shows nothing when the fact row is missing for that key", () => {
    const shown = currentDisplayedValues(live({
      facts: liveFacts().filter((f) => f.fact_key !== "engine"),
    }));
    expect(shown.engine.value).toBeNull();
    expect(shown.engine.origin).toContain("no vehicle_facts row with fact_key 'engine'");
    expect(shown.drivetrain.value).toBe("4WD");
  });

  it("shows nothing when the listing has no tenant_id, as useVehicleTruth returns EMPTY", () => {
    const shown = currentDisplayedValues(live({ listing: listing({ tenant_id: null }) }));
    expect(shown.msrp.value).toBeNull();
    expect(shown.msrp.origin).toContain("useVehicleTruth.ts:66");
  });

  it("prefers a VERIFIED row over a held non-VERIFIED one, as VehicleTruthCard.tsx:98-109 does", () => {
    const shown = currentDisplayedValues(live({
      facts: [
        fact("total_msrp", 11111, { source_kind: "marketcheck", confidence: "HIGH" }),
        fact("total_msrp", 60195, { source_kind: "neovin", confidence: "VERIFIED" }),
      ],
    }));
    expect(shown.msrp.value).toBe(60195);
  });

  it("keeps the first row when a later one is no stronger", () => {
    const shown = currentDisplayedValues(live({
      facts: [
        fact("engine", "2.0L I4"),
        fact("engine", "3.0L V6"),
      ],
    }));
    expect(shown.engine.value).toBe("2.0L I4");
  });

  it("treats an empty fact_value as the em dash the card prints", () => {
    const shown = currentDisplayedValues(live({ facts: [fact("engine", null)] }));
    expect(shown.engine.value).toBeNull();
    expect(shown.engine.origin).toContain("is empty");
  });
});

describe("currentDisplayedValues — disagreement between the two price surfaces", () => {
  // VEHICLE_FILE_CURRENT_STATE_MAP §6: the truth card's `advertised_price` fact
  // is STALE against `vehicle_listings.price` on 99 of the 117 pilot listings
  // that carry it. The header does not read the fact, so the mirror must report
  // the header's number and leave the disagreement for the parity report.
  it("returns the header's price, not the older advertised_price fact", () => {
    const shown = currentDisplayedValues(live());
    const staleFact = liveFacts().find((f) => f.fact_key === "advertised_price");
    expect((staleFact?.fact_value as { v: number }).v).toBe(23981);
    expect(shown.advertised_retail.value).toBe(20876);
    expect(shown.advertised_retail.origin).not.toContain("vehicle_facts");
  });

  it("returns the listing's mileage and condition even when the facts disagree", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ mileage: 48999, condition: "cpo" }),
    }));
    expect(shown.mileage.value).toBe(48999);
    expect(shown.condition.value).toBe("cpo");
  });

  it("reads the listing's own structured keys, not vehicle_files, when both exist", () => {
    const shown = currentDisplayedValues(live({
      file: file({ make: "Alfa Romeo", model: "Stelvio", year: "2020" }),
    }));
    expect(shown.make.value).toBe("Alfa Romeo");
    expect(shown.model.value).toBe("Stelvio");
    expect(shown.make.origin).toContain("mc_attributes");
  });
});

describe("currentDisplayedValues — missing sources", () => {
  it("reports all twelve as not rendered when there is no listing row", () => {
    const shown = currentDisplayedValues(emptySources(TENANT));
    for (const [field, current] of Object.entries(shown)) {
      expect(current.value, field).toBeNull();
      expect(current.origin, field).toContain("Vehicle not found");
    }
  });

  it("distinguishes an unpriced, unmileaged, undecoded listing from a missing one", () => {
    const shown = currentDisplayedValues(live({
      listing: listing({ price: null, mileage: null, condition: null, trim: null }),
      file: null,
    }));
    expect(shown.advertised_retail.value).toBeNull();
    expect(shown.advertised_retail.origin).toContain("Not priced");
    expect(shown.mileage.origin).toContain("Mileage not recorded");
    expect(shown.trim.origin).toContain("Not decoded");
  });

  it("returns null for a null condition rather than the literal 'unknown' the header prints", () => {
    const shown = currentDisplayedValues(live({ listing: listing({ condition: null }) }));
    expect(shown.condition.value).toBeNull();
    expect(shown.condition.origin).toContain("prints the literal \"unknown\"");
  });

  it("survives a listing whose jsonb columns are absent entirely", () => {
    const bare: Row = { id: VEHICLE_ID, tenant_id: TENANT, vin: VIN };
    const shown = currentDisplayedValues(live({ listing: bare, file: null, snapshot: null, facts: [] }));
    expect(shown.vin.value).toBe(VIN);
    expect(shown.stock.value).toBeNull();
    expect(shown.year.value).toBeNull();
    expect(shown.advertised_retail.value).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildDealerState } from "./dealerState.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VIN = "3PCAJ5KR0SF101800";

// Shapes copied from the pilot tenant on 2026-09-09: a published CPO Infiniti
// whose feed row carries `is_certified` as the NUMBER 1, its stamps as UNIX
// seconds, and whose Get Ready copy has a blank stock number and has collapsed
// cpo to used.
const listingRow = (over: Row = {}): Row => ({
  id: "listing-1",
  vin: VIN,
  status: "published",
  condition: "cpo",
  mileage: 15794,
  certification: null,
  created_at: "2026-06-19T16:21:09.279Z",
  published_at: "2026-06-29T03:30:22.861Z",
  updated_at: "2026-09-09T08:08:19.503Z",
  archived_at: null,
  archive_reason: null,
  mc_attributes: {
    ref_miles: 15794,
    first_seen_at: 1787469084,
    last_seen_at: 1788761807,
    in_transit: false,
    dom: 130,
  },
  mc_raw: {
    vin: VIN,
    stock_no: "IL21874",
    miles: 15794,
    inventory_type: "used",
    is_certified: 1,
    in_transit: false,
    first_seen_at: 1787469084,
    first_seen_at_date: "2026-08-23T07:11:24.000Z",
    last_seen_at: 1788761807,
    last_seen_at_date: "2026-09-07T06:16:47.000Z",
    scraped_at: 1787469084,
    dom: 130,
  },
  ...over,
});

const fileRow = (over: Row = {}): Row => ({
  vin: VIN,
  stock_number: "IL21874",
  condition: "cpo",
  mileage: 15794,
  msrp: 0,
  market_value: 0,
  updated_at: "2026-09-09T03:07:15.909Z",
  ...over,
});

const getReadyRow = (over: Row = {}): Row => ({
  vin: VIN,
  stock_number: "",
  condition: "used",
  status: "pending",
  updated_at: "2026-06-29T03:31:00.000Z",
  ...over,
});

const src = (
  listing: Row | null,
  file: Row | null,
  extra: Partial<VehicleFileSources> = {},
): VehicleFileSources => ({ ...emptySources(TENANT), listing, file, ...extra });

const build = (listing: Row | null, file: Row | null, extra: Partial<VehicleFileSources> = {}) =>
  buildDealerState(src(listing, file, extra), { now: NOW });

const origins = (field: { candidates: Array<{ origin: string }> }) =>
  field.candidates.map((c) => c.origin);

describe("buildDealerState — stock", () => {
  it("resolves the dealer file, the only populated home, and keeps the feed as provenance", () => {
    const { stock } = build(listingRow(), fileRow());
    expect(stock.value).toBe("IL21874");
    expect(stock.chosen?.origin).toBe("vehicle_files.stock_number");
    expect(stock.chosen?.provider).toBe("Dealer inventory file (writer untagged)");
    expect(stock.chosen?.license).toBe("CUSTOMER_DISPLAY_CLEARED");
    expect(stock.freshness).toBe("CURRENT");
    expect(origins(stock)).toContain("vehicle_listings.mc_raw->stock_no");
    expect(stock.disagreeing).toHaveLength(0);
  });

  it("shows the feed's own answer as a disagreement when the file has drifted", () => {
    const { stock } = build(
      listingRow({ mc_raw: { ...(listingRow().mc_raw as Row), stock_no: "IL21899" } }),
      fileRow(),
    );
    expect(stock.value).toBe("IL21874");
    expect(stock.disagreeing.map((c) => c.value)).toEqual(["IL21899"]);
    expect(stock.disagreeing[0].provider).toBe("MarketCheck syndication feed");
    // Neither source may verify a stock number on its own evidence, so the
    // difference is reported, not escalated to a dispute a person must settle.
    expect(stock.disputed).toBe(false);
  });

  it("never admits the Get Ready frozen copy, which is blank on 24 of 130 pilot cars", () => {
    const { stock } = build(listingRow(), fileRow(), { getReady: getReadyRow() });
    expect(stock.value).toBe("IL21874");
    expect(origins(stock).join(" ")).not.toContain("get_ready_records");
  });

  it("reads mc_attributes.stock_no only when the verbatim feed payload has none", () => {
    const raw = { ...(listingRow().mc_raw as Row) };
    delete raw.stock_no;
    const { stock } = build(
      listingRow({ mc_raw: raw, mc_attributes: { stock_no: "IL21874" } }),
      null,
    );
    expect(stock.value).toBe("IL21874");
    expect(stock.chosen?.origin).toBe("vehicle_listings.mc_attributes->stock_no");
  });

  it("resolves UNKNOWN without crashing when the vehicle has no vehicle_files row", () => {
    const raw = { ...(listingRow().mc_raw as Row) };
    delete raw.stock_no;
    const { stock } = build(listingRow({ mc_raw: raw, mc_attributes: {} }), null);
    expect(stock.value).toBeNull();
    expect(stock.freshness).toBe("UNKNOWN");
    expect(stock.reason).toContain("vehicle_listings has no stock column");
  });

  it("never answers with a fragment of the VIN", () => {
    const raw = { ...(listingRow().mc_raw as Row) };
    delete raw.stock_no;
    const { stock } = build(listingRow({ mc_raw: raw, mc_attributes: {} }), null);
    expect(stock.value).not.toBe(VIN.slice(-6));
    expect(stock.candidates.every((c) => c.value !== VIN.slice(-6))).toBe(true);
  });
});

describe("buildDealerState — mileage", () => {
  it("resolves the dealer's own reading and ages it by the writer's stamp", () => {
    const { mileage } = build(listingRow(), fileRow());
    expect(mileage.value).toBe(15794);
    expect(mileage.chosen?.origin).toBe("vehicle_listings.mileage");
    expect(mileage.freshness).toBe("CURRENT");
    expect(mileage.ageDays).toBeLessThan(1);
  });

  it("reports UNKNOWN rather than inventing 0 on a new car with no reading", () => {
    const { mileage } = build(
      listingRow({
        condition: "new",
        mileage: null,
        mc_raw: { ...(listingRow().mc_raw as Row), miles: 0, inventory_type: "new", is_certified: undefined },
      }),
      fileRow({ condition: "new", mileage: 0 }),
    );
    expect(mileage.value).toBeNull();
    expect(mileage.freshness).toBe("UNKNOWN");
    expect(mileage.reason).toContain("vehicle_listings.mileage");
    expect(mileage.reason).toContain("vehicle_files.mileage");
    expect(mileage.reason).toContain("vehicle_listings.mc_raw->miles");
    // The zeros stay named, with the reason they are not odometer readings.
    const zeroNotes = mileage.candidates.filter((c) => (c.note ?? "").includes("not an odometer reading"));
    expect(zeroNotes.map((c) => c.origin).sort()).toEqual([
      "vehicle_files.mileage",
      "vehicle_listings.mc_raw->miles",
    ]);
  });

  it("keeps a real reading when only the file holds the placeholder zero", () => {
    const { mileage } = build(listingRow({ mileage: 47925 }), fileRow({ mileage: 0 }));
    expect(mileage.value).toBe(47925);
    expect(mileage.disagreeing.map((c) => c.value)).not.toContain(0);
  });

  it("never reads mc_attributes.ref_miles, which is the comparable set's mileage", () => {
    const { mileage } = build(
      listingRow({ mileage: null, mc_attributes: { ref_miles: 99999 } }),
      fileRow({ mileage: 0 }),
    );
    expect(mileage.value).not.toBe(99999);
    expect(origins(mileage).join(" ")).not.toContain("ref_miles");
    expect(mileage.candidates.every((c) => c.value !== 99999)).toBe(true);
  });

  it("reports STALE when the newest dealer claim is older than the 14-day policy", () => {
    const { mileage } = build(
      listingRow({ updated_at: "2026-08-01T00:00:00.000Z", mc_raw: {}, mc_attributes: {} }),
      null,
    );
    expect(mileage.value).toBe(15794);
    expect(mileage.freshness).toBe("STALE");
    expect(mileage.reason).toContain("policy for mileage is 14 days");
  });
});

describe("buildDealerState — condition", () => {
  it("derives cpo from the feed's inventory_type and its numeric certified flag", () => {
    const { condition } = build(listingRow(), fileRow());
    expect(condition.value).toBe("cpo");
    expect(condition.chosen?.origin)
      .toBe("vehicle_listings.mc_raw->inventory_type + vehicle_listings.mc_raw->is_certified");
    expect(condition.chosen?.provider).toBe("MarketCheck syndication feed");
    expect(condition.disagreeing).toHaveLength(0);
  });

  it("does not let the Get Ready copy collapse cpo to used", () => {
    const { condition } = build(listingRow(), fileRow(), { getReady: getReadyRow() });
    expect(condition.value).toBe("cpo");
    expect(origins(condition).join(" ")).not.toContain("get_ready_records");
  });

  it("surfaces the stored column as a disagreement when the feed has moved", () => {
    const { condition } = build(
      listingRow({
        condition: "used",
        mc_raw: { ...(listingRow().mc_raw as Row), inventory_type: "new", is_certified: undefined },
      }),
      fileRow({ condition: "used" }),
    );
    expect(condition.value).toBe("new");
    expect(condition.disagreeing.map((c) => c.origin)).toEqual([
      "vehicle_listings.condition",
      "vehicle_files.condition",
    ]);
  });

  it("asks new before certified, so a new unit carrying a flag is not buried in cpo", () => {
    const { condition } = build(
      listingRow({ mc_raw: { ...(listingRow().mc_raw as Row), inventory_type: "New", is_certified: 1 } }),
      null,
    );
    expect(condition.value).toBe("new");
  });
});

describe("buildDealerState — certified", () => {
  it("reads the feed's numeric 1 as certified rather than as unknown", () => {
    const { certified } = build(listingRow(), fileRow());
    expect(certified.value).toBe(true);
    expect(certified.chosen?.origin).toBe("vehicle_listings.mc_raw->is_certified");
    expect(certified.freshness).toBe("CURRENT");
  });

  it("emits the dealer VDP badge as its own candidate so the conflict stays visible", () => {
    const { certified } = build(
      listingRow({
        condition: "new",
        certification: { certified: true, source: "dealer_vdp", verified_at: "2026-09-09T06:41:53.155Z" },
        mc_raw: { ...(listingRow().mc_raw as Row), inventory_type: "new", is_certified: undefined },
      }),
      null,
    );
    expect(certified.value).toBe(false);
    expect(certified.chosen?.origin).toBe("vehicle_listings.condition");
    const badge = certified.disagreeing.find((c) => c.source === "dealer_vdp");
    expect(badge?.value).toBe(true);
    expect(badge?.origin).toBe("vehicle_listings.certification->certified");
    expect(badge?.provider).toBe("Dealer VDP observation (CPO badge read by crawl-advertised-prices)");
    expect(badge?.license).toBe("INTERNAL_USE_CLEARED");
    expect(badge?.observedAt).toBe("2026-09-09T06:41:53.155Z");
    // A badge is read off a page, not off the certifying program's record, so
    // it can never reach VERIFIED and never raises a dispute on its own.
    expect(certified.disputed).toBe(false);
  });

  it("treats an absent feed flag as no answer, not as a denial", () => {
    const raw = { ...(listingRow().mc_raw as Row) };
    delete raw.is_certified;
    const { certified } = build(listingRow({ condition: "used", mc_raw: raw }), null);
    expect(certified.value).toBe(false);
    expect(certified.chosen?.origin).toBe("vehicle_listings.condition");
    const feedCandidate = certified.candidates.find((c) => c.origin.includes("is_certified"));
    expect(feedCandidate).toBeUndefined();
  });
});

describe("buildDealerState — in transit", () => {
  it("surfaces the feed's false as an answer, stamped by the feed's own observation", () => {
    const { inTransit } = build(listingRow(), fileRow());
    expect(inTransit.value).toBe(false);
    expect(inTransit.chosen?.origin).toBe("vehicle_listings.mc_raw->in_transit");
    expect(inTransit.chosen?.observedAt).toBe("2026-09-07T06:16:47.000Z");
    expect(inTransit.freshness).toBe("CURRENT");
    expect(inTransit.chosen?.license).toBe("UNKNOWN_REVIEW_REQUIRED");
  });

  it("reports UNKNOWN when no feed payload is stored, instead of asserting readiness", () => {
    const { inTransit } = build(listingRow({ mc_raw: {}, mc_attributes: {} }), fileRow());
    expect(inTransit.value).toBeNull();
    expect(inTransit.freshness).toBe("UNKNOWN");
    expect(inTransit.reason).toContain("No MarketCheck feed payload");
  });

  it("reports the feed's true when a car really is in transit", () => {
    const { inTransit } = build(
      listingRow({ mc_raw: { ...(listingRow().mc_raw as Row), in_transit: true } }),
      fileRow(),
    );
    expect(inTransit.value).toBe(true);
  });
});

describe("buildDealerState — listing status", () => {
  it("reports our own record's state, which does not expire", () => {
    const { listingStatus } = build(listingRow(), fileRow());
    expect(listingStatus.value).toBe("published");
    expect(listingStatus.freshness).toBe("CURRENT");
    expect(listingStatus.chosen?.license).toBe("INTERNAL_USE_CLEARED");
  });

  it("carries the archive reason when the feed pruned the listing", () => {
    const { listingStatus } = build(
      listingRow({
        status: "archived",
        archived_at: "2026-09-01T04:00:00.000Z",
        archive_reason: "left_feed",
      }),
      fileRow(),
    );
    expect(listingStatus.value).toBe("archived");
    expect(listingStatus.chosen?.note).toContain("left_feed");
  });
});

describe("buildDealerState — days in inventory", () => {
  it("prefers the feed's first_seen, parses its epoch seconds, and keeps ours as the loser", () => {
    const { daysInInventory } = build(listingRow(), fileRow());
    expect(daysInInventory.value).toBe(17);
    expect(daysInInventory.chosen?.origin).toBe("vehicle_listings.mc_raw->first_seen_at");
    expect(daysInInventory.chosen?.provider).toBe("MarketCheck syndication feed (first_seen_at)");
    expect(daysInInventory.disagreeing.map((c) => c.origin)).toEqual(["vehicle_listings.created_at"]);
    expect(daysInInventory.disagreeing[0].value).toBe(81);
  });

  it("says so when the feed's first_seen post-dates our own listing record", () => {
    const { daysInInventory } = build(listingRow(), fileRow());
    expect(daysInInventory.chosen?.note).toContain("dates the current feed record");
  });

  it("parses the epoch form even when the ISO twin is missing", () => {
    const raw = { ...(listingRow().mc_raw as Row) };
    delete raw.first_seen_at_date;
    const { daysInInventory } = build(listingRow({ mc_raw: raw }), fileRow());
    expect(daysInInventory.value).toBe(17);
  });

  it("falls back to the listing record when the feed carries no first_seen", () => {
    const { daysInInventory } = build(
      listingRow({ mc_raw: {}, mc_attributes: {} }),
      fileRow(),
    );
    expect(daysInInventory.value).toBe(81);
    expect(daysInInventory.chosen?.origin).toBe("vehicle_listings.created_at");
    expect(daysInInventory.chosen?.note).toContain("A floor, not an arrival date");
  });

  it("has no freshness policy, and says that rather than claiming CURRENT", () => {
    const { daysInInventory } = build(listingRow(), fileRow());
    expect(daysInInventory.freshness).toBe("UNKNOWN");
    expect(daysInInventory.reason).toContain("no freshness policy is defined for days_in_inventory");
  });
});

describe("buildDealerState — missing sources", () => {
  it("returns every field UNKNOWN, and does not crash, when there is no listing row", () => {
    const section = buildDealerState(src(null, null), { now: NOW });
    for (const field of Object.values(section)) {
      expect(field.value).toBeNull();
      expect(field.freshness).toBe("UNKNOWN");
      expect(field.candidates).toHaveLength(0);
      expect(field.reason).toBe("No vehicle_listings row was read for this vehicle.");
    }
  });

  it("resolves what the listing alone can answer when no other source was read", () => {
    const { condition, listingStatus, stock } = build(
      listingRow({ mc_raw: {}, mc_attributes: {} }),
      null,
    );
    expect(condition.value).toBe("cpo");
    expect(condition.chosen?.origin).toBe("vehicle_listings.condition");
    expect(listingStatus.value).toBe("published");
    expect(stock.value).toBeNull();
    expect(stock.reason).toContain("No vehicle_files row was read");
  });
});

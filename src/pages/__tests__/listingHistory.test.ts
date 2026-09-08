import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildListingHistory,
  describeListingPeriod,
  describeListingOdometer,
  describeListingSpan,
  type ListingHistoryEntry,
} from "@/pages/VehiclePassportHistory";

// history_payload.entries is marketplace ADVERTISING data. The whole risk of
// surfacing it is that it reads like a vehicle history report or like an
// accusation ("the price kept dropping"). These assert the two disciplines the
// page depends on: nothing is invented from a missing field, and nothing about
// a price movement is characterised.

const e = (o: Partial<ListingHistoryEntry>): ListingHistoryEntry => ({
  price: null, miles: null, seller_type: "dealer", inventory_type: "used",
  dealer: null, first_seen: null, last_seen: null, ...o,
});

const APR10 = "2025-04-10T05:13:06.000Z";
const APR12 = "2025-04-12T04:17:28.000Z";
const MAY01 = "2025-05-01T00:00:00.000Z";
const JUN01 = "2025-06-01T00:00:00.000Z";

describe("buildListingHistory — nothing to show renders nothing", () => {
  it("returns null for absent, empty, or unusable input", () => {
    expect(buildListingHistory(null)).toBeNull();
    expect(buildListingHistory(undefined)).toBeNull();
    expect(buildListingHistory([])).toBeNull();
    expect(buildListingHistory([null as unknown as ListingHistoryEntry])).toBeNull();
  });

  it("keeps a record that has only a dealer name, with every other field null", () => {
    const h = buildListingHistory([e({ dealer: "Lia Nissan Of Colonie" })]);
    expect(h?.records).toHaveLength(1);
    const r = h!.records[0];
    expect(r.dealer).toBe("Lia Nissan Of Colonie");
    expect(r.firstPrice).toBeNull();
    expect(r.lastPrice).toBeNull();
    expect(r.lowMiles).toBeNull();
    expect(r.from).toBeNull();
    expect(r.days).toBeNull();
    expect(describeListingPeriod(r)).toBeNull();
    expect(describeListingOdometer(r)).toBeNull();
  });

  it("treats a zero price or zero odometer as absent, never as $0 / 0 mi", () => {
    const h = buildListingHistory([e({ dealer: "A", price: 0, miles: 0, first_seen: APR10 })]);
    const r = h!.records[0];
    expect(r.lastPrice).toBeNull();
    expect(r.lowMiles).toBeNull();
    expect(describeListingOdometer(r)).toBeNull();
  });

  it("carries an entry with no dealer name without inventing one", () => {
    const h = buildListingHistory([e({ price: 22977, first_seen: APR10 })]);
    expect(h!.records[0].dealer).toBeNull();
    expect(h!.records[0].lastPrice).toBe(22977);
  });
});

describe("buildListingHistory — folding sightings", () => {
  it("folds repeated sightings of one dealer into a single record spanning them", () => {
    const h = buildListingHistory([
      e({ dealer: "Lia Nissan", price: 22977, miles: 31150, first_seen: APR10, last_seen: APR10 }),
      e({ dealer: "Lia Nissan", price: 22977, miles: 31150, first_seen: APR12, last_seen: APR12 }),
    ]);
    expect(h!.records).toHaveLength(1);
    const r = h!.records[0];
    expect(r.sightings).toBe(2);
    expect(r.from).toBe(Date.parse(APR10));
    expect(r.to).toBe(Date.parse(APR12));
    expect(r.days).toBe(Math.max(1, Math.round((Date.parse(APR12) - Date.parse(APR10)) / 86400000)));
    expect(h!.sightings).toBe(2);
  });

  it("never merges two dealer names that only look alike", () => {
    const h = buildListingHistory([
      e({ dealer: "Holman", first_seen: APR10 }),
      e({ dealer: "Holman Infiniti", first_seen: APR10 }),
    ]);
    expect(h!.records).toHaveLength(2);
    expect(h!.records.map((r) => r.dealer).sort()).toEqual(["Holman", "Holman Infiniti"]);
  });

  it("folds the same name written with different case or padding", () => {
    const h = buildListingHistory([
      e({ dealer: "Harte Infiniti", first_seen: APR10 }),
      e({ dealer: "  harte infiniti ", first_seen: APR12 }),
    ]);
    expect(h!.records).toHaveLength(1);
    expect(h!.records[0].sightings).toBe(2);
  });

  it("orders records by the most recent sighting, undated ones last", () => {
    const h = buildListingHistory([
      e({ dealer: "Undated" }),
      e({ dealer: "Older", first_seen: APR10, last_seen: APR12 }),
      e({ dealer: "Newer", first_seen: MAY01, last_seen: JUN01 }),
    ]);
    expect(h!.records.map((r) => r.dealer)).toEqual(["Newer", "Older", "Undated"]);
  });

  it("reports the span across every record", () => {
    const h = buildListingHistory([
      e({ dealer: "Older", first_seen: APR10, last_seen: APR12 }),
      e({ dealer: "Newer", first_seen: MAY01, last_seen: JUN01 }),
    ]);
    expect(h!.from).toBe(Date.parse(APR10));
    expect(h!.to).toBe(Date.parse(JUN01));
    expect(describeListingSpan(h!)).toContain("–");
    expect(describeListingSpan({ from: null, to: null })).toBeNull();
  });

  it("flags the source's 50-record ceiling so the UI can say the list is capped", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => e({ dealer: `D${i}`, first_seen: APR10 }));
    expect(buildListingHistory(fifty)!.atSourceCap).toBe(true);
    expect(buildListingHistory(fifty.slice(0, 49))!.atSourceCap).toBe(false);
  });
});

describe("buildListingHistory — asking prices are reported, never characterised", () => {
  it("takes first and last price in date order, not array order", () => {
    const h = buildListingHistory([
      e({ dealer: "A", price: 21900, first_seen: JUN01 }),
      e({ dealer: "A", price: 23900, first_seen: APR10 }),
      e({ dealer: "A", price: 22900, first_seen: MAY01 }),
    ]);
    const r = h!.records[0];
    expect(r.firstPrice).toBe(23900);
    expect(r.lastPrice).toBe(21900);
    expect(r.priceMoves).toBe(2);
  });

  it("collapses to one price when it never moved", () => {
    const h = buildListingHistory([
      e({ dealer: "A", price: 60804, first_seen: APR10 }),
      e({ dealer: "A", price: 60804, first_seen: MAY01 }),
    ]);
    expect(h!.records[0].firstPrice).toBe(h!.records[0].lastPrice);
    expect(h!.records[0].priceMoves).toBe(0);
  });

  it("drops an undated price from the sequence rather than guessing where it sits", () => {
    const h = buildListingHistory([
      e({ dealer: "A", price: 23900, first_seen: APR10 }),
      e({ dealer: "A", price: 21900, first_seen: MAY01 }),
      e({ dealer: "A", price: 99999 }),
    ]);
    expect(h!.records[0].firstPrice).toBe(23900);
    expect(h!.records[0].lastPrice).toBe(21900);
  });

  it("still shows an undated price when it is all there is", () => {
    const h = buildListingHistory([e({ dealer: "A", price: 21900 })]);
    expect(h!.records[0].lastPrice).toBe(21900);
  });
});

describe("buildListingHistory — odometer is a range, never a direction", () => {
  it("reports low and high regardless of the order the sightings arrived in", () => {
    const a = buildListingHistory([
      e({ dealer: "A", miles: 33020, first_seen: MAY01 }),
      e({ dealer: "A", miles: 31150, first_seen: APR10 }),
    ]);
    const b = buildListingHistory([
      e({ dealer: "A", miles: 31150, first_seen: APR10 }),
      e({ dealer: "A", miles: 33020, first_seen: MAY01 }),
    ]);
    for (const h of [a, b]) {
      expect(h!.records[0].lowMiles).toBe(31150);
      expect(h!.records[0].highMiles).toBe(33020);
      expect(describeListingOdometer(h!.records[0])).toBe("31,150 – 33,020 mi");
    }
  });

  it("shows a single figure when every sighting agrees", () => {
    const h = buildListingHistory([e({ dealer: "A", miles: 31150, first_seen: APR10 })]);
    expect(describeListingOdometer(h!.records[0])).toBe("31,150 mi");
  });
});

describe("buildListingHistory — seller and inventory tags", () => {
  it("tags a record advertised as new only when every sighting says so", () => {
    const all = buildListingHistory([
      e({ dealer: "A", inventory_type: "new", first_seen: APR10 }),
      e({ dealer: "A", inventory_type: "new", first_seen: MAY01 }),
    ]);
    const mixed = buildListingHistory([
      e({ dealer: "A", inventory_type: "new", first_seen: APR10 }),
      e({ dealer: "A", inventory_type: "used", first_seen: MAY01 }),
    ]);
    expect(all!.records[0].advertisedNew).toBe(true);
    expect(mixed!.records[0].advertisedNew).toBe(false);
  });

  it("surfaces a private-seller or auction listing, and stays silent on a dealer or a mix", () => {
    const fsbo = buildListingHistory([e({ dealer: "A", seller_type: "fsbo", first_seen: APR10 })]);
    const dealer = buildListingHistory([e({ dealer: "A", seller_type: "dealer", first_seen: APR10 })]);
    const mixed = buildListingHistory([
      e({ dealer: "A", seller_type: "fsbo", first_seen: APR10 }),
      e({ dealer: "A", seller_type: "dealer", first_seen: MAY01 }),
    ]);
    expect(fsbo!.records[0].sellerType).toBe("fsbo");
    expect(dealer!.records[0].sellerType).toBeNull();
    expect(mixed!.records[0].sellerType).toBeNull();
  });
});

describe("describeListingPeriod", () => {
  it("states a single sighting as one date", () => {
    const at = Date.parse(APR10);
    expect(describeListingPeriod({ from: at, to: at, days: 1 })).toMatch(/^Seen /);
  });

  it("states a span, with the day count only once it is worth stating", () => {
    const from = Date.parse(APR10), to = Date.parse(JUN01);
    expect(describeListingPeriod({ from, to, days: 52 })).toContain("52 days on record");
    expect(describeListingPeriod({ from, to, days: 1 })).not.toContain("days on record");
  });

  it("renders nothing when no date survived", () => {
    expect(describeListingPeriod({ from: null, to: null, days: null })).toBeNull();
  });
});

describe("the real MarketCheck entry shape", () => {
  it("reads a production row end to end", () => {
    const h = buildListingHistory([
      {
        miles: 31150, price: 22977, dealer: "Lia Nissan Of Colonie",
        seller_type: "dealer", inventory_type: "used",
        last_seen: "2025-04-12T04:17:28.000Z", first_seen: "2025-04-10T05:13:06.000Z",
      },
    ]);
    const r = h!.records[0];
    expect(r.dealer).toBe("Lia Nissan Of Colonie");
    expect(r.lastPrice).toBe(22977);
    expect(describeListingOdometer(r)).toBe("31,150 mi");
    expect(describeListingPeriod(r)).toContain("–");
  });

  it("folds a 50-record VIN quickly and without duplicate keys", () => {
    const rows: ListingHistoryEntry[] = Array.from({ length: 50 }, (_, i) => e({
      dealer: `Dealer ${i % 7}`,
      price: 30000 - i * 25,
      miles: 10000 + i * 40,
      first_seen: new Date(Date.parse(APR10) + i * 86400000).toISOString(),
      last_seen: new Date(Date.parse(APR10) + (i + 1) * 86400000).toISOString(),
    }));
    const started = Date.now();
    const h = buildListingHistory(rows)!;
    expect(Date.now() - started).toBeLessThan(100);
    expect(h.records).toHaveLength(7);
    expect(new Set(h.records.map((r) => r.key)).size).toBe(7);
    expect(h.sightings).toBe(50);
    expect(h.atSourceCap).toBe(true);
  });
});

describe("the page's own copy", () => {
  const src = readFileSync(join(__dirname, "..", "VehiclePassportHistory.tsx"), "utf8");
  // Everything between the section title and the end of the disclosure card.
  const advertising = src.slice(src.indexOf("Advertising history —"));

  it("says plainly that this is not a vehicle history report", () => {
    expect(advertising).toContain("not a vehicle history report");
    expect(advertising).toContain("no accident, title, service, or ownership records");
  });

  it("never characterises a price movement as a drop, a cut, or a reduction", () => {
    for (const word of [/price drop/i, /\bprice cut\b/i, /\breduced\b/i, /\bslashed\b/i, /\bmarked down\b/i, /\bdiscounted\b/i]) {
      expect(advertising).not.toMatch(word);
    }
  });

  it("never labels these records as CARFAX, AutoCheck, or verified", () => {
    const disclosure = advertising.slice(0, advertising.indexOf("const ListingSection"));
    for (const word of [/carfax/i, /autocheck/i, /\bverified\b/i]) {
      expect(disclosure).not.toMatch(word);
    }
  });
});

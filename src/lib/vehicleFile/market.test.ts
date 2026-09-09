import { describe, expect, it } from "vitest";
import { buildListingLifecycle, buildMarketIntelligence } from "./market.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VIN = "5N1AL1FW1TC358865";

// Shapes copied from the pilot tenant on 2026-09-09: a published 2026 QX60
// whose feed stamps are UNIX seconds, whose ref_price_dt runs three weeks
// behind last_seen_at, and whose market_meta.similar_count (14) stands against
// a stored comparables page of 13.
const listingRow = (over: Row = {}): Row => ({
  id: "listing-1",
  vin: VIN,
  status: "published",
  created_at: "2026-06-19T16:21:09.279Z",
  published_at: "2026-07-04T03:07:14.030Z",
  updated_at: "2026-09-09T08:12:50.080Z",
  archived_at: null,
  archive_reason: null,
  market_value: "61759.00",
  market_position: "below_market",
  market_checked_at: "2026-09-09T08:12:49.965Z",
  market_payload: {
    low: 57926,
    high: 67335,
    position: "below_market",
    checked_at: "2026-09-09T08:12:49.965Z",
    belowMarket: 3377,
    marketValue: 61759,
  },
  market_meta: {
    avg_dom: 204,
    checked_at: "2026-09-09T08:12:48.913Z",
    dom_median: 179,
    like_count: 13,
    similar_count: 14,
    inventory_count: 14,
    search_radius: 100,
    market_days_supply: 788,
    price_percentile: 7,
  },
  comparables: Array.from({ length: 13 }, (_, i) => ({ price: 60000 + i, miles: 10 })),
  mc_attributes: {
    dom: 173,
    dom_active: 173,
    dom_180: 173,
    price_change_percent: 1.56,
    ref_price: 57487,
    ref_miles: 17,
    first_seen_at: 1787190598,
    last_seen_at: 1788921659,
    scraped_at: 1787190598,
  },
  mc_raw: {
    vin: VIN,
    dom: 173,
    dom_active: 173,
    dom_180: 173,
    dos_active: 146,
    price_change_percent: 1.56,
    ref_price: 57487,
    ref_price_dt: 1787103911,
    first_seen_at: 1787190598,
    first_seen_at_date: "2026-08-20T01:49:58.000Z",
    first_seen_at_mc: 1774071928,
    first_seen_at_source: 1774226577,
    last_seen_at: 1788921659,
    last_seen_at_date: "2026-09-09T02:40:59.000Z",
    scraped_at: 1787190598,
    scraped_at_date: "2026-08-20T01:49:58.000Z",
  },
  ...over,
});

const withListing = (over: Row = {}, extra: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  listing: listingRow(over),
  ...extra,
});

const build = (over: Row = {}, extra: Partial<VehicleFileSources> = {}) =>
  buildMarketIntelligence(withListing(over, extra), { now: NOW });

describe("buildMarketIntelligence — happy path", () => {
  it("resolves all six analytical fields from the pilot row", () => {
    const m = build();

    expect(m.kind).toBe("analysis");
    expect(m.marketValue.value).toBe(61759);
    expect(m.daysOnMarket.value).toBe(173);
    expect(m.comparableCount.value).toBe(14);
    expect(m.marketDaysSupply.value).toBe(788);
    expect(m.priceChangePercent.value).toBe(1.56);
    expect(m.referencePrice.value).toBe(57487);
  });

  it("names the physical origin and the provider separately on every candidate", () => {
    const m = build();

    expect(m.marketValue.chosen?.origin).toBe("vehicle_listings.market_value");
    expect(m.marketValue.chosen?.provider).toBe("MarketCheck price prediction (/v2/predict/car/price)");
    expect(m.daysOnMarket.chosen?.origin).toBe("vehicle_listings.mc_raw->dom");
    expect(m.daysOnMarket.chosen?.provider).toBe("MarketCheck syndication feed");
    expect(m.comparableCount.chosen?.origin).toBe("vehicle_listings.market_meta->similar_count");
    expect(m.comparableCount.chosen?.provider).toBe(
      "MarketCheck active-listing search (/v2/search/car/active)",
    );
    expect(m.marketDaysSupply.chosen?.origin).toBe("vehicle_listings.market_meta->market_days_supply");
    expect(m.marketDaysSupply.chosen?.provider).toBe("MarketCheck market days supply (/v2/mds/car)");
    expect(m.priceChangePercent.chosen?.origin).toBe("vehicle_listings.mc_raw->price_change_percent");
    expect(m.referencePrice.chosen?.origin).toBe("vehicle_listings.mc_raw->ref_price");
  });

  it("classes every analytical family UNKNOWN-REVIEW REQUIRED so a projection can withhold it", () => {
    const m = build();
    const fields = [
      m.marketValue,
      m.daysOnMarket,
      m.comparableCount,
      m.marketDaysSupply,
      m.priceChangePercent,
      m.referencePrice,
    ];
    for (const field of fields) {
      for (const c of field.candidates) {
        expect(c.license).toBe("UNKNOWN_REVIEW_REQUIRED");
      }
    }
  });

  it("decodes the feed's UNIX-second stamps instead of reporting UNKNOWN freshness", () => {
    const m = build();

    expect(m.daysOnMarket.chosen?.observedAt).toBe("2026-09-09T02:40:59.000Z");
    expect(m.daysOnMarket.freshness).toBe("CURRENT");
    expect(m.priceChangePercent.chosen?.observedAt).toBe("2026-09-09T02:40:59.000Z");
    expect(m.priceChangePercent.freshness).toBe("CURRENT");
  });

  it("ages market value and the comps run by their own writer stamps", () => {
    const m = build();

    expect(m.marketValue.chosen?.observedAt).toBe("2026-09-09T08:12:49.965Z");
    expect(m.marketValue.freshness).toBe("CURRENT");
    expect(m.comparableCount.chosen?.observedAt).toBe("2026-09-09T08:12:48.913Z");
    expect(m.marketDaysSupply.chosen?.observedAt).toBe("2026-09-09T08:12:48.913Z");
    expect(m.marketDaysSupply.freshness).toBe("CURRENT");
  });
});

describe("buildMarketIntelligence — the defects the maps named", () => {
  it("ages the reference price by ref_price_dt, which runs three weeks behind the sync", () => {
    const m = build();

    expect(m.referencePrice.chosen?.observedAt).toBe("2026-08-19T01:45:11.000Z");
    expect(m.referencePrice.ageDays).toBeGreaterThan(21);
    expect(m.referencePrice.freshness).toBe("STALE");
    // The same row's days-on-market is CURRENT, so the staleness belongs to
    // the field and not to the vehicle.
    expect(m.daysOnMarket.freshness).toBe("CURRENT");
  });

  it("falls back to the feed's last-seen stamp, and says so, when ref_price_dt is absent", () => {
    const raw = listingRow().mc_raw as Row;
    const { ref_price_dt: _dropped, ...withoutDate } = raw;
    const m = build({ mc_raw: withoutDate });

    expect(m.referencePrice.chosen?.observedAt).toBe("2026-09-09T02:40:59.000Z");
    expect(m.referencePrice.chosen?.note).toContain("ref_price_dt is absent");
  });

  it("reads mc_attributes only where mc_raw lacks the key, and names which answered", () => {
    const m = build({ mc_raw: { vin: VIN, last_seen_at: 1788921659 } });

    expect(m.daysOnMarket.chosen?.origin).toBe("vehicle_listings.mc_attributes->dom");
    expect(m.daysOnMarket.value).toBe(173);
    expect(m.priceChangePercent.chosen?.origin).toBe("vehicle_listings.mc_attributes->price_change_percent");
    expect(m.referencePrice.chosen?.origin).toBe("vehicle_listings.mc_attributes->ref_price");
  });

  it("never treats the feed-rebuilt column as a second opinion on the verbatim payload", () => {
    // mc_attributes is rebuilt from the same feed listing mc_raw stores, so
    // one statement must not appear as two agreeing sources.
    const m = build();
    expect(m.daysOnMarket.candidates).toHaveLength(1);
    expect(m.priceChangePercent.candidates).toHaveLength(1);
    expect(m.referencePrice.candidates).toHaveLength(1);
  });

  it("keeps dom_active, dom_180 and dos_active out of daysOnMarket", () => {
    const m = build({
      mc_raw: { ...(listingRow().mc_raw as Row), dom: 68, dom_active: 38, dom_180: 68, dos_active: 37 },
      mc_attributes: { ...(listingRow().mc_attributes as Row), dom: 68, dom_active: 38 },
    });

    expect(m.daysOnMarket.value).toBe(68);
    expect(m.daysOnMarket.candidates).toHaveLength(1);
    expect(m.daysOnMarket.disagreeing).toHaveLength(0);
    expect(m.daysOnMarket.chosen?.note).toContain("dom_active 38");
  });

  it("keeps dos_active out of market days supply", () => {
    const meta = listingRow().market_meta as Row;
    const { market_days_supply: _dropped, ...withoutMds } = meta;
    const m = build({ market_meta: withoutMds });

    // mc_raw.dos_active is 146 on this row; days on SITE is not days of supply.
    expect(m.marketDaysSupply.value).toBeNull();
    expect(m.marketDaysSupply.freshness).toBe("UNKNOWN");
  });

  it("excludes the zero placeholder on vehicle_files.market_value", () => {
    const m = build({}, { file: { vin: VIN, market_value: 0, msrp: 0, updated_at: NOW } });

    expect(m.marketValue.value).toBe(61759);
    for (const c of m.marketValue.candidates) {
      expect(c.origin).not.toContain("vehicle_files");
    }
  });

  it("names the comps median rather than the price model when that is what answered", () => {
    const m = build({
      market_value: "60488.00",
      market_payload: { marketValue: 60488, source: "comps_median", checked_at: "2026-09-09T08:12:46.612Z" },
    });

    expect(m.marketValue.chosen?.provider).toBe("MarketCheck comparable-listing median (vehicle-enrich)");
    expect(m.marketValue.chosen?.note).toContain("comps_median");
  });

  it("falls back to market_payload when the column never received the write", () => {
    const m = build({ market_value: null });

    expect(m.marketValue.value).toBe(61759);
    expect(m.marketValue.chosen?.origin).toBe("vehicle_listings.market_payload->marketValue");
  });
});

describe("buildMarketIntelligence — disagreement", () => {
  it("declares the similar_count vs stored-comparables gap expected, not a conflict", () => {
    const m = build();

    expect(m.comparableCount.value).toBe(14);
    expect(m.comparableCount.disagreeing).toHaveLength(1);
    expect(m.comparableCount.disagreeing[0].value).toBe(13);
    expect(m.comparableCount.disagreeing[0].origin).toBe("vehicle_listings.comparables (array length)");
    expect(m.comparableCount.disputed).toBe(false);
    expect(m.comparableCount.reason).toContain("Disagreement is expected");
  });

  it("holds when the stored page is a fraction of the match set", () => {
    const m = build({
      market_meta: { ...(listingRow().market_meta as Row), similar_count: 456 },
      comparables: Array.from({ length: 16 }, () => ({ price: 60000 })),
    });

    expect(m.comparableCount.value).toBe(456);
    expect(m.comparableCount.disagreeing[0].value).toBe(16);
    expect(m.comparableCount.disputed).toBe(false);
  });

  it("surfaces a value-history snapshot that disagrees with the column", () => {
    const m = build({}, {
      valueHistory: [
        {
          source: "market_pricing",
          market_value: "62900.00",
          captured_at: "2026-09-09T09:00:00.000Z",
        },
        { source: "marketcheck_sync", market_value: null, captured_at: "2026-09-09T03:00:00.000Z" },
      ],
    });

    expect(m.marketValue.value).toBe(61759);
    expect(m.marketValue.disagreeing).toHaveLength(1);
    expect(m.marketValue.disagreeing[0].value).toBe(62900);
    expect(m.marketValue.disagreeing[0].origin).toBe("vehicle_value_history.market_value");
    expect(m.marketValue.disagreeing[0].provider).toContain("marketcheck-market-pricing");
    // Both are MarketCheck analysis, neither can be VERIFIED, so no person is
    // asked to arbitrate an estimate against itself.
    expect(m.marketValue.disputed).toBe(false);
  });

  it("skips value-history rows that carry no value at all", () => {
    const m = build({}, {
      valueHistory: [
        { source: "marketcheck_sync", market_value: null, captured_at: "2026-09-09T09:00:00.000Z" },
        { source: "vehicle_enrich", market_value: "61759.00", captured_at: "2026-09-08T09:00:00.000Z" },
      ],
    });

    expect(m.marketValue.candidates).toHaveLength(2);
    expect(m.marketValue.disagreeing).toHaveLength(0);
    expect(m.marketValue.candidates[1].provider).toContain("vehicle-enrich");
  });
});

describe("buildMarketIntelligence — missing sources", () => {
  it("reports UNKNOWN for every field when no listing was read", () => {
    const m = buildMarketIntelligence(emptySources(TENANT), { now: NOW });

    expect(m.kind).toBe("analysis");
    for (const field of [
      m.marketValue,
      m.daysOnMarket,
      m.comparableCount,
      m.marketDaysSupply,
      m.priceChangePercent,
      m.referencePrice,
    ]) {
      expect(field.value).toBeNull();
      expect(field.freshness).toBe("UNKNOWN");
      expect(field.candidates).toHaveLength(0);
      expect(field.reason).toContain("No vehicle_listings row");
    }
  });

  it("names the origin it looked in when a listing has no feed payload at all", () => {
    const m = build({ mc_raw: null, mc_attributes: null, market_meta: null, market_payload: null, market_value: null, comparables: null });

    expect(m.daysOnMarket.value).toBeNull();
    expect(m.daysOnMarket.freshness).toBe("UNKNOWN");
    expect(m.daysOnMarket.reason).toContain("vehicle_listings.mc_raw->dom");
    expect(m.marketValue.reason).toContain("vehicle_listings.market_payload->marketValue");
    expect(m.comparableCount.reason).toContain("vehicle_listings.market_meta->similar_count");
  });

  it("reports UNKNOWN freshness rather than CURRENT when nothing stamps the answer", () => {
    const m = build({
      market_checked_at: null,
      market_payload: { marketValue: 61759 },
      market_meta: { similar_count: 14, market_days_supply: 788 },
    });

    expect(m.marketValue.value).toBe(61759);
    expect(m.marketValue.chosen?.observedAt).toBeNull();
    expect(m.marketValue.freshness).toBe("UNKNOWN");
    expect(m.marketDaysSupply.freshness).toBe("UNKNOWN");
  });

  it("reports STALE, not CURRENT, when the market run is older than its policy window", () => {
    const m = build({
      market_checked_at: "2026-08-01T08:12:49.965Z",
      market_payload: { marketValue: 61759, checked_at: "2026-08-01T08:12:49.965Z" },
    });

    expect(m.marketValue.freshness).toBe("STALE");
    expect(m.marketValue.reason).toContain("policy for market_value is 7 days");
  });
});

describe("buildListingLifecycle", () => {
  it("takes the feed stamps, not the row's updated_at", () => {
    const lc = buildListingLifecycle(withListing());

    expect(lc.firstSeenAt).toBe("2026-03-21T05:45:28.000Z");
    expect(lc.lastSeenAt).toBe("2026-09-09T02:40:59.000Z");
    expect(lc.publishedAt).toBe("2026-07-04T03:07:14.030Z");
    expect(lc.archivedAt).toBeNull();
    expect(lc.archiveReason).toBeNull();
  });

  it("prefers the earliest first-seen stamp over the reissued feed record", () => {
    // first_seen_at (2026-08-20) postdates our own created_at; first_seen_at_mc
    // and first_seen_at_source sit five months earlier on the same row.
    const lc = buildListingLifecycle(withListing());
    expect(lc.firstSeenAt).not.toBe("2026-08-20T01:49:58.000Z");
  });

  it("falls back to mc_attributes when mc_raw carries no first-seen stamp", () => {
    const lc = buildListingLifecycle(withListing({ mc_raw: { vin: VIN } }));

    expect(lc.firstSeenAt).toBe("2026-08-20T01:49:58.000Z");
    expect(lc.lastSeenAt).toBe("2026-09-09T02:40:59.000Z");
  });

  it("reports the archive reason our own record holds", () => {
    const lc = buildListingLifecycle(withListing({
      status: "archived",
      archived_at: "2026-08-27T03:20:00.000Z",
      archive_reason: "left_feed",
    }));

    expect(lc.archivedAt).toBe("2026-08-27T03:20:00.000Z");
    expect(lc.archiveReason).toBe("left_feed");
  });

  it("flags REMOVED-while-published, the state 9 pilot vehicles are in", () => {
    const lc = buildListingLifecycle(withListing({}, {
      lifecycle: {
        state: "REMOVED",
        previous_state: "SERVICE_UNASSIGNED",
        state_changed_at: "2026-08-01T03:20:00.212Z",
        gate_reason: "grandfathered at lifecycle rollout",
      },
    }));

    expect(lc.lifecycleStage).toBe("REMOVED");
    expect(lc.lifecycleContradiction).toContain("REMOVED since 2026-08-01T03:20:00.212Z");
    expect(lc.lifecycleContradiction).toContain("previously SERVICE_UNASSIGNED");
    expect(lc.lifecycleContradiction).toContain("status is published");
    expect(lc.lifecycleContradiction).toContain("invisible to every service role");
  });

  it("raises no contradiction when REMOVED matches an archived listing", () => {
    const lc = buildListingLifecycle(withListing(
      { status: "archived", archived_at: "2026-08-27T03:20:00.000Z", archive_reason: "left_feed" },
      { lifecycle: { state: "REMOVED", state_changed_at: "2026-08-27T03:20:00.000Z" } },
    ));

    expect(lc.lifecycleStage).toBe("REMOVED");
    expect(lc.lifecycleContradiction).toBeNull();
  });

  it("raises no contradiction for a live car in an ordinary stage", () => {
    const lc = buildListingLifecycle(withListing({}, {
      lifecycle: { state: "AWAITING_MANAGER_AUTHORIZATION", state_changed_at: "2026-08-02T03:20:00.228Z" },
    }));

    expect(lc.lifecycleStage).toBe("AWAITING_MANAGER_AUTHORIZATION");
    expect(lc.lifecycleContradiction).toBeNull();
  });

  it("returns nulls rather than guesses when nothing was read", () => {
    const lc = buildListingLifecycle(emptySources(TENANT));

    expect(lc).toEqual({
      firstSeenAt: null,
      lastSeenAt: null,
      publishedAt: null,
      archivedAt: null,
      archiveReason: null,
      lifecycleStage: null,
      lifecycleContradiction: null,
    });
  });
});

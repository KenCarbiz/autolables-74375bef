import { describe, expect, it } from "vitest";
import { buildPricing, buildPublicAdvertisement } from "./pricing.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VIN = "5N1AL1FWXTC358105";

const epoch = (isoString: string): number => Math.floor(Date.parse(isoString) / 1000);

// Every shape below is copied from the pilot tenant on 2026-09-09. This VIN is
// worked example 1 of DUPLICATE_READ_PATHS.md §C1: the feed says 58,382, the
// dealer's own page said 57,487 the same morning, the crawler ladder stored
// 56,592 as "before doc", and the truth ledger still holds 62,885 from
// 2026-08-10.
const listingRow = (over: Row = {}): Row => ({
  id: "listing-1",
  vin: VIN,
  price: 58382,
  advertised_price_before_doc: 56592,
  website_sale_price: 57487,
  doc_fee: 895,
  dealer_discount: 8693,
  retail_cash: null,
  price_parse_status: "ok",
  price_last_verified_at: "2026-09-09T06:01:50.218Z",
  price_source_url: "https://www.harteinfiniti.com/viewdetails/new/5n1al1fwxtc358105/2026-infiniti-qx60-sport-utility",
  source_url: "https://www.harteinfiniti.com/viewdetails/new/5n1al1fwxtc358105/2026-infiniti-qx60-sport-utility",
  mc_raw: {
    vin: VIN,
    price: 58382,
    msrp: 66180,
    last_seen_at: epoch("2026-09-09T02:41:07.000Z"),
  },
  mc_attributes: {
    msrp: 66180,
    total_msrp: 65395,
    base_msrp: 61700,
    delivery_charges: 1350,
    specs_source: "neovin",
    specs_decoded_at: "2026-08-10T03:15:09.561Z",
    mc_listing_id: "5N1AL1FWXTC358105-0468f24c-0ac3",
    last_seen_at: epoch("2026-09-09T02:41:07.000Z"),
    build_sheet: { pricing: { base_msrp: 61700, destination_charge: 1350, total_msrp: 65395 } },
  },
  ...over,
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

const feedCapture = (over: Row = {}): Row => ({
  vin: VIN,
  advertised_price: 58382,
  source_channel: "feed",
  captured_method: "marketcheck_syndication",
  captured_at: "2026-09-08T16:45:44.927Z",
  captured_by: null,
  source_url: "https://www.harteinfiniti.com/viewdetails/new/5n1al1fwxtc358105/2026-infiniti-qx60-sport-utility",
  screenshot_url: null,
  screenshot_sha256: null,
  screenshot_bucket: "price-evidence",
  notes: "MarketCheck new · $58,382",
  ...over,
});

const webObservation = (over: Row = {}): Row => ({
  vin: VIN,
  advertised_price: 57487,
  source_channel: "website",
  captured_method: "dealer_vdp_observation",
  captured_at: "2026-09-09T06:01:50.252Z",
  captured_by: null,
  source_url: "https://www.harteinfiniti.com/viewdetails/new/5n1al1fwxtc358105/2026-infiniti-qx60-sport-utility",
  screenshot_url: `${TENANT}/${VIN}/1788936777101.png`,
  screenshot_sha256: "a6aba7e3855b90492cd6c2a544885a9612a30bbab27eece7bd4b4601402b2e68",
  screenshot_bucket: "price-evidence",
  notes: "Nightly crawl (dom_label) · unchanged $57,487",
  ...over,
});

const neovinRow = (over: Row = {}): Row => ({
  vin: VIN,
  endpoint: "https://api.marketcheck.com/v2/decode/car/neovin/5N1AL1FWXTC358105/specs?api_key=***",
  fetched_at: "2026-08-10T03:15:09.355Z",
  payload: { vin: VIN, msrp: 61700, delivery_charges: 1350, combined_msrp: 65395 },
  ...over,
});

// vehicle_facts stores the value as {v: n} and stamps observed_at with the
// orchestration time; the ledger copy of the price is two 2026-08-10 dollars
// off the column it was copied from.
const factRow = (factKey: string, value: number, over: Row = {}): Row => ({
  fact_key: factKey,
  fact_value: { v: value },
  source_kind: factKey === "advertised_price" ? "dealer_confirmed" : "neovin",
  confidence: "VERIFIED",
  authority: factKey === "advertised_price" ? "dealer" : "manufacturer",
  observed_at: "2026-08-10T03:15:09.561Z",
  evidence: {},
  ...over,
});

const refusalRow = (over: Row = {}): Row => ({
  action: "advertised_price_crawl_skipped",
  entity_type: "advertised_price",
  entity_id: VIN,
  store_id: TENANT,
  created_at: "2026-09-09T06:42:13.775Z",
  details: {
    vin: VIN,
    reason: "advertised_above_feed",
    scraped: 63100,
    feed: 60890,
    url: "https://www.harteinfiniti.com/viewdetails/new/5n1al1f83vc338945/2027-infiniti-qx60-sport-utility",
    screenshot_path: `${TENANT}/${VIN}/1788936132128.png`,
  },
  ...over,
});

const pilot = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  listing: listingRow(),
  dealerProfile: profileRow(),
  neovin: neovinRow(),
  advertisedPrices: [webObservation(), feedCapture()],
  facts: [factRow("advertised_price", 62885), factRow("total_msrp", 65395)],
  snapshot: { snapshot_json: { pricing: { advertisedPrice: 62885, totalMsrp: 65395 } } },
  ...over,
});

const opts = { now: NOW };

describe("buildPricing — happy path (pilot tenant, fee-inclusive)", () => {
  const pricing = buildPricing(pilot(), opts);

  it("serves the feed total the Passport shows, from the column it shows it from", () => {
    expect(pricing.advertisedRetail.value).toBe(58382);
    expect(pricing.advertisedRetail.chosen?.origin).toBe("vehicle_listings.price");
    expect(pricing.advertisedRetail.chosen?.provider).toBe("MarketCheck syndication feed");
    expect(pricing.advertisedRetail.freshness).toBe("CURRENT");
    expect(pricing.advertisedRetail.chosen?.license).toBe("CUSTOMER_DISPLAY_CLEARED");
    expect(pricing.advertisedRetail.chosen?.note).toContain("UNKNOWN-REVIEW REQUIRED");
  });

  it("derives the selling price as total minus the doc fee, in one place", () => {
    expect(pricing.sellingPrice.value).toBe(58382 - 895);
    expect(pricing.sellingPrice.chosen?.origin).toBe("vehicle_listings.price - vehicle_listings.doc_fee");
  });

  it("takes the doc fee from the tenant setting, not from the copy on the row", () => {
    expect(pricing.docFee.value).toBe(895);
    expect(pricing.docFee.chosen?.origin).toBe("dealer_profiles.settings.doc_fee_amount");
    expect(pricing.docFee.freshness).toBe("CURRENT");
  });

  it("reads the dealer discount as a page observation, dated by the observation", () => {
    expect(pricing.dealerDiscount.value).toBe(8693);
    expect(pricing.dealerDiscount.chosen?.source).toBe("dealer_vdp");
    expect(pricing.dealerDiscount.chosen?.observedAt).toBe("2026-09-09T06:01:50.252Z");
  });

  it("echoes the tenant's fee basis and display mode", () => {
    expect(pricing.advertisedIncludesDocFee).toBe(true);
    expect(pricing.priceDisplayMode).toBe("website_sale_price");
  });

  it("ages the feed value by MarketCheck's own epoch stamp", () => {
    const raw = pricing.advertisedRetail.candidates.find((c) => c.origin === "vehicle_listings.mc_raw->>'price'");
    expect(raw?.observedAt).toBe("2026-09-09T02:41:07.000Z");
  });

  it("accepts a numeric column that arrives as a string", () => {
    const stringy = buildPricing(pilot({ listing: listingRow({ price: "58382.00", doc_fee: "895" }) }), opts);
    expect(stringy.advertisedRetail.value).toBe(58382);
    expect(stringy.sellingPrice.value).toBe(57487);
  });
});

describe("buildPricing — MSRP is two questions", () => {
  const pricing = buildPricing(pilot(), opts);

  it("answers msrpFactory from the provider's verbatim decode, stamped by its own retrieval", () => {
    expect(pricing.msrpFactory.value).toBe(65395);
    expect(pricing.msrpFactory.chosen?.origin).toBe("neovin_snapshots.payload->>'combined_msrp'");
    expect(pricing.msrpFactory.chosen?.source).toBe("neovin");
    expect(pricing.msrpFactory.chosen?.observedAt).toBe("2026-08-10T03:15:09.355Z");
    expect(pricing.msrpFactory.freshness).toBe("CURRENT");
    expect(pricing.msrpFactory.chosen?.license).toBe("UNKNOWN_REVIEW_REQUIRED");
  });

  it("never reads NeoVIN's `msrp` key, which is the base price, as the total", () => {
    expect(pricing.msrpFactory.candidates.map((c) => c.value)).not.toContain(61700);
  });

  it("answers msrpFeed from the feed field and marks its semantics unknown", () => {
    expect(pricing.msrpFeed.value).toBe(66180);
    expect(pricing.msrpFeed.chosen?.origin).toBe("vehicle_listings.mc_attributes->>'msrp'");
    expect(pricing.msrpFeed.chosen?.note).toContain("unknown semantics");
  });

  it("keeps the two candidate sets disjoint, so neither reports a conflict against the other", () => {
    const factoryValues = pricing.msrpFactory.candidates.map((c) => c.value);
    const feedValues = pricing.msrpFeed.candidates.map((c) => c.value);
    expect(factoryValues).not.toContain(66180);
    expect(feedValues).not.toContain(65395);
    expect(pricing.msrpFactory.disputed).toBe(false);
    expect(pricing.msrpFeed.disputed).toBe(false);
    expect(pricing.msrpFactory.freshness).not.toBe("CONFLICTED");
    expect(pricing.msrpFeed.freshness).not.toBe("CONFLICTED");
  });

  it("caps a generic build sheet below a VIN-specific decode", () => {
    const generic = buildPricing(
      pilot({
        neovin: null,
        listing: listingRow({
          mc_attributes: {
            ...(listingRow().mc_attributes as Row),
            specs_source: "basic",
            build_sheet: { generic: true, pricing: { total_msrp: 65395 } },
          },
        }),
      }),
      opts,
    );
    expect(generic.msrpFactory.value).toBe(65395);
    expect(generic.msrpFactory.chosen?.source).toBe("other_structured");
    expect(generic.msrpFactory.chosen?.provider).toContain("Generic build sheet");
  });
});

describe("buildPricing — disagreement", () => {
  const pricing = buildPricing(pilot(), opts);

  it("shows the dealer's own page disagreeing with the feed without letting it win", () => {
    const page = pricing.advertisedRetail.disagreeing.find((c) => c.source === "dealer_vdp"
      && c.origin.includes("captured_method=dealer_vdp_observation"));
    expect(page?.value).toBe(57487);
    expect(pricing.advertisedRetail.value).toBe(58382);
    expect(pricing.advertisedRetail.disputed).toBe(false);
  });

  it("shows the stale truth-ledger copy disagreeing, unstamped, and losing", () => {
    const ledger = pricing.advertisedRetail.disagreeing.find((c) => c.origin.startsWith("vehicle_facts"));
    expect(ledger?.value).toBe(62885);
    expect(ledger?.observedAt).toBeNull();
    expect(ledger?.source).toBe("marketcheck");
    expect(ledger?.provider).toContain("AutoLabels truth ledger");
    expect(pricing.advertisedRetail.freshness).toBe("CURRENT");
  });

  it("keeps the crawler's before-doc column out of the selling price and names its writer", () => {
    expect(pricing.sellingPrice.value).toBe(57487);
    const stored = pricing.sellingPrice.disagreeing.find(
      (c) => c.origin === "vehicle_listings.advertised_price_before_doc",
    );
    expect(stored?.value).toBe(56592);
    expect(stored?.source).toBe("dealer_vdp");
    expect(stored?.note).toContain("VDP crawl wrote it");
  });

  it("lets a dealer's manual confirmation outrank the feed", () => {
    const manual = buildPricing(
      pilot({
        advertisedPrices: [
          webObservation(),
          feedCapture(),
          feedCapture({
            advertised_price: 57900,
            captured_method: "manual_dealer_confirmation",
            source_channel: "manual",
            captured_at: "2026-09-09T09:00:00.000Z",
          }),
        ],
      }),
      opts,
    );
    expect(manual.advertisedRetail.value).toBe(57900);
    expect(manual.advertisedRetail.chosen?.source).toBe("dealer_confirmed");
    expect(manual.sellingPrice.value).toBe(57900 - 895);
  });

  it("reports STALE when every price stamp is older than the three-day policy", () => {
    const stale = buildPricing(
      pilot({
        listing: listingRow({
          price_last_verified_at: "2026-08-20T03:07:00.000Z",
          mc_raw: { vin: VIN, price: 58382, msrp: 66180, last_seen_at: epoch("2026-08-20T03:07:00.000Z") },
        }),
        advertisedPrices: [feedCapture({ captured_at: "2026-08-20T03:07:00.000Z" })],
      }),
      opts,
    );
    expect(stale.advertisedRetail.value).toBe(58382);
    expect(stale.advertisedRetail.freshness).toBe("STALE");
    expect(stale.advertisedRetail.reason).toContain("policy for advertised_price is 3 days");
  });

  it("prefers the profile fee over a listing copy that is behind", () => {
    const drift = buildPricing(pilot({ listing: listingRow({ doc_fee: 495 }) }), opts);
    expect(drift.docFee.value).toBe(895);
    expect(drift.docFee.disagreeing[0]?.origin).toBe("vehicle_listings.doc_fee");
    expect(drift.sellingPrice.value).toBe(58382 - 895);
  });
});

describe("buildPricing — fee-exclusive tenant and missing inputs", () => {
  it("treats the advertised total as the selling price when the fee is excluded", () => {
    const exclusive = buildPricing(
      pilot({ dealerProfile: profileRow({ advertised_includes_doc_fee: "false" }) }),
      opts,
    );
    expect(exclusive.advertisedIncludesDocFee).toBe(false);
    expect(exclusive.sellingPrice.value).toBe(58382);
    expect(exclusive.sellingPrice.chosen?.origin).toBe("vehicle_listings.price");
  });

  it("does not offer the fee-inclusive ladder as the advertised total of a fee-exclusive tenant", () => {
    const exclusive = buildPricing(
      pilot({ dealerProfile: profileRow({ advertised_includes_doc_fee: "false" }) }),
      opts,
    );
    expect(exclusive.advertisedRetail.candidates.map((c) => c.origin))
      .not.toContain("vehicle_listings.website_sale_price");
    expect(exclusive.advertisedRetail.value).toBe(58382);
  });

  it("returns zero, not silence, for a tenant whose doc fee is switched off", () => {
    const noFee = buildPricing(
      pilot({ dealerProfile: profileRow({ doc_fee_enabled: "false" }) }),
      opts,
    );
    expect(noFee.docFee.value).toBe(0);
    expect(noFee.sellingPrice.value).toBe(58382);
  });

  it("leaves the selling price unknown when a fee-inclusive tenant has no fee on file", () => {
    const unknownFee = buildPricing(
      pilot({ dealerProfile: null, listing: listingRow({ doc_fee: null, advertised_price_before_doc: null }) }),
      opts,
    );
    expect(unknownFee.docFee.value).toBeNull();
    expect(unknownFee.advertisedIncludesDocFee).toBe(false);
    expect(unknownFee.sellingPrice.value).toBe(58382);
  });

  it("does not claim a dealer confirmation for a row no feed record backs", () => {
    const handEntered = buildPricing(
      pilot({
        listing: listingRow({ mc_raw: {}, mc_attributes: {} }),
        advertisedPrices: [],
        facts: [],
        snapshot: null,
      }),
      opts,
    );
    expect(handEntered.advertisedRetail.chosen?.source).toBe("dealer_confirmed");
    expect(handEntered.advertisedRetail.chosen?.confidence).toBe("MEDIUM");
    expect(handEntered.advertisedRetail.chosen?.note).toContain("UNKNOWN");
  });

  it("reports every field UNKNOWN and nothing invented when no source was read", () => {
    const empty = buildPricing(emptySources(TENANT), opts);
    for (const field of [
      empty.advertisedRetail,
      empty.sellingPrice,
      empty.docFee,
      empty.dealerDiscount,
      empty.msrpFactory,
      empty.msrpFeed,
    ]) {
      expect(field.value).toBeNull();
      expect(field.chosen).toBeNull();
      expect(field.freshness).toBe("UNKNOWN");
      expect(field.reason.length).toBeGreaterThan(0);
    }
    expect(empty.advertisedIncludesDocFee).toBe(false);
    expect(empty.priceDisplayMode).toBeNull();
  });

  it("does not launder an unrecognised display mode into a default", () => {
    const bogus = buildPricing(pilot({ dealerProfile: profileRow({ price_display_mode: "bogus" }) }), opts);
    expect(bogus.priceDisplayMode).toBeNull();
  });
});

describe("buildPublicAdvertisement", () => {
  it("reports what the shopper saw, on the observation's own stamp", () => {
    const ad = buildPublicAdvertisement(pilot(), opts);
    expect(ad.observedPrice.value).toBe(57487);
    expect(ad.observedPrice.chosen?.source).toBe("dealer_vdp");
    expect(ad.observedPrice.freshness).toBe("CURRENT");
    expect(ad.observedAt).toBe("2026-09-09T06:01:50.252Z");
    expect(ad.observedBeforeDocFee.value).toBe(57487 - 895);
    expect(ad.observedDiscount.value).toBe(8693);
    expect(ad.vdpUrl).toContain("harteinfiniti.com");
  });

  it("names the stored doc fee as the configured fee, not a page reading", () => {
    const ad = buildPublicAdvertisement(pilot(), opts);
    expect(ad.observedDocFee.value).toBe(895);
    expect(ad.observedDocFee.chosen?.origin).toBe("vehicle_listings.doc_fee");
    expect(ad.observedDocFee.chosen?.note).toContain("Not a page reading");
  });

  it("returns a storage path and a hash, never a URL", () => {
    const ad = buildPublicAdvertisement(pilot(), opts);
    expect(ad.evidencePath).toBe(`${TENANT}/${VIN}/1788936777101.png`);
    expect(ad.evidencePath?.startsWith("http")).toBe(false);
    expect(ad.evidenceSha256).toHaveLength(64);
  });

  it("keeps the newest render when the newest observation carried none", () => {
    const ad = buildPublicAdvertisement(
      pilot({
        advertisedPrices: [
          webObservation({ captured_at: "2026-09-09T10:00:00.000Z", screenshot_url: null, screenshot_sha256: null }),
          webObservation(),
          feedCapture(),
        ],
      }),
      opts,
    );
    expect(ad.observedAt).toBe("2026-09-09T10:00:00.000Z");
    expect(ad.evidencePath).toBe(`${TENANT}/${VIN}/1788936777101.png`);
  });

  it("refuses to read a feed row as an observation of the dealer's page", () => {
    const ad = buildPublicAdvertisement(pilot({ advertisedPrices: [feedCapture()] }), opts);
    expect(ad.observedPrice.value).toBeNull();
    expect(ad.observedPrice.candidates).toHaveLength(0);
    expect(ad.observedPrice.reason).toContain("the feed's answer, not an observation");
    expect(ad.observedAt).toBeNull();
  });

  it("never reads a crawl seed or an unmethoded row as a price", () => {
    const ad = buildPublicAdvertisement(
      pilot({
        advertisedPrices: [
          feedCapture({ advertised_price: 58382, captured_method: "crawl_seed", source_channel: "website",
            captured_at: "2026-09-09T11:00:00.000Z", notes: "Seeded website URL for nightly crawl" }),
          feedCapture({ advertised_price: 12345, captured_method: null, source_channel: "website",
            captured_at: "2026-09-09T11:30:00.000Z", captured_by: "discovery" }),
          webObservation(),
        ],
      }),
      opts,
    );
    expect(ad.observedPrice.value).toBe(57487);
    expect(ad.observedPrice.candidates.map((c) => c.value)).not.toContain(12345);
    const pricing = buildPricing(
      pilot({
        advertisedPrices: [
          feedCapture({ advertised_price: 99999, captured_method: "crawl_seed", source_channel: "website" }),
        ],
      }),
      opts,
    );
    expect(pricing.advertisedRetail.candidates.map((c) => c.value)).not.toContain(99999);
  });

  it("marks the accepted observation SUPERSEDED by a later refusal without adopting it", () => {
    const ad = buildPublicAdvertisement(pilot({ crawlRefusals: [refusalRow()] }), opts);
    expect(ad.observedPrice.value).toBe(57487);
    expect(ad.observedPrice.freshness).toBe("SUPERSEDED");
    const refused = ad.observedPrice.disagreeing[0];
    expect(refused.value).toBe(63100 + 895);
    expect(refused.origin).toContain("advertised_price_crawl_skipped");
    expect(refused.confidence).toBe("LOW");
  });

  it("reports the audit numbers verbatim, on their own bases", () => {
    const ad = buildPublicAdvertisement(
      pilot({
        crawlRefusals: [refusalRow({ created_at: "2026-09-08T06:42:13.775Z" }), refusalRow()],
        crawlAttempt: { vin: VIN, outcome: "price_rejected", last_attempt_at: "2026-09-09T06:42:13.800Z" },
      }),
      opts,
    );
    expect(ad.lastRefused).toEqual({ scraped: 63100, feed: 60890, at: "2026-09-09T06:42:13.775Z" });
    expect(ad.lastOutcome).toBe("price_rejected");
  });

  it("explains the four warning VINs, where the refusal is the only page reading", () => {
    const ad = buildPublicAdvertisement(
      pilot({
        advertisedPrices: [feedCapture()],
        crawlRefusals: [refusalRow()],
        crawlAttempt: { vin: VIN, outcome: "price_rejected", last_attempt_at: "2026-09-09T06:42:13.800Z" },
      }),
      opts,
    );
    expect(ad.observedPrice.value).toBeNull();
    expect(ad.observedPrice.reason).toContain("refused by the misparse guard");
    expect(ad.observedBeforeDocFee.value).toBeNull();
    expect(ad.lastRefused?.scraped).toBe(63100);
    expect(ad.observedAt).toBeNull();
  });

  it("ages a page observation on its own seven-day policy, not the feed's three", () => {
    const ad = buildPublicAdvertisement(
      pilot({ advertisedPrices: [webObservation({ captured_at: "2026-09-04T06:00:00.000Z" }), feedCapture()] }),
      opts,
    );
    expect(ad.observedPrice.freshness).toBe("CURRENT");
    const stale = buildPublicAdvertisement(
      pilot({ advertisedPrices: [webObservation({ captured_at: "2026-07-05T00:01:09.414Z" }), feedCapture()] }),
      opts,
    );
    expect(stale.observedPrice.freshness).toBe("STALE");
  });

  it("drops the stored ladder column once the feed has rewritten it", () => {
    const ad = buildPublicAdvertisement(
      pilot({ listing: listingRow({ advertised_price_before_doc: 57487 }) }),
      opts,
    );
    expect(ad.observedBeforeDocFee.value).toBe(56592);
    expect(ad.observedBeforeDocFee.candidates.map((c) => c.origin))
      .not.toContain("vehicle_listings.advertised_price_before_doc");
  });

  it("returns nothing rather than something when no source was read", () => {
    const ad = buildPublicAdvertisement(emptySources(TENANT), opts);
    expect(ad.observedPrice.value).toBeNull();
    expect(ad.observedBeforeDocFee.value).toBeNull();
    expect(ad.observedDocFee.value).toBeNull();
    expect(ad.observedDiscount.value).toBeNull();
    expect(ad.vdpUrl).toBeNull();
    expect(ad.observedAt).toBeNull();
    expect(ad.evidencePath).toBeNull();
    expect(ad.evidenceSha256).toBeNull();
    expect(ad.lastOutcome).toBeNull();
    expect(ad.lastRefused).toBeNull();
  });
});

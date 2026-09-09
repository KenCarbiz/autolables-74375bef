import { describe, expect, it } from "vitest";
import {
  buildCustomer,
  buildMedia,
  buildPublishing,
  buildSourceHealth,
  buildTimeline,
  deriveAttention,
  hostOf,
  type AttentionInput,
} from "./presentation.ts";
import { emptyField } from "./resolveField.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";
import type {
  FieldCandidate,
  PricingSection,
  ResolvedField,
} from "./readModelTypes.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VIN = "3VWEM7BU8RM082795";

// Photo URLs copied from the pilot tenant on 2026-09-09. Four CDNs serve
// Harte's photos; `api.marketcheck.com` image-cache links carry an api_key
// query parameter (8 of the 44 query-carrying URLs live).
const CAI = "https://assets.cai-media-management.com/resize/640x640/common-vehicle-media/aaf473fb-4fb4-415a-a53f-c8011a419b58.jpg";
const CAI_2 = "https://assets.cai-media-management.com/resize/640x640/common-vehicle-media/fab353fe-23d7-4886-a852-7d769a4077c9.jpeg";
const HOMENET = "https://content.homenetiol.com/2016128/191098234/0x0/dc2f9d9e5c2f4b0a9c9b4b6b0e3c2a11.jpg";
const MC_IMAGE = "https://api.marketcheck.com/v2/image/cache/car/JN8AZ3CC0S9602059-25cb2c4f-d951/bc11f7dd120?api_key=REDACTED_IN_TEST";

const withSources = (over: Partial<VehicleFileSources>): VehicleFileSources => ({
  ...emptySources(TENANT),
  ...over,
});

const listingRow = (over: Row = {}): Row => ({
  id: "6c1a3f4e-0000-4000-8000-000000000001",
  vin: VIN,
  slug: "2024-volkswagen-jetta-082795",
  status: "published",
  published_at: "2026-08-03T03:07:28.308Z",
  archived_at: null,
  archive_reason: null,
  hero_image_url: CAI,
  photos: [CAI, CAI_2, HOMENET],
  photo_count: 3,
  view_count: 67,
  source_url: "https://www.harteinfiniti.com/inventory/used-2024-volkswagen-jetta",
  ...over,
});

// ── buildMedia ──────────────────────────────────────────────────────

describe("buildMedia", () => {
  it("counts the renderable photos and reports one host per CDN", () => {
    const media = buildMedia(withSources({ listing: listingRow() }));

    expect(media.heroImageUrl).toBe(CAI);
    // The hero is photos[0] on 128 of 128 pilot rows with photos, so it must
    // not be counted twice.
    expect(media.photoCount).toBe(3);
    expect(media.photoHosts).toEqual([
      "assets.cai-media-management.com",
      "content.homenetiol.com",
    ]);
  });

  it("never lets a photo URL's query string reach photoHosts", () => {
    const media = buildMedia(withSources({
      listing: listingRow({ photos: [CAI, MC_IMAGE], hero_image_url: CAI }),
    }));

    expect(media.photoHosts).toEqual([
      "api.marketcheck.com",
      "assets.cai-media-management.com",
    ]);
    for (const host of media.photoHosts) {
      expect(host).not.toContain("?");
      expect(host).not.toContain("api_key");
    }
  });

  it("reads the {url} photo shape that listingGallery also accepts", () => {
    const media = buildMedia(withSources({
      listing: listingRow({ photos: [{ url: CAI }, { url: CAI_2 }], hero_image_url: null }),
    }));

    expect(media.photoCount).toBe(2);
    expect(media.heroImageUrl).toBeNull();
  });

  it("counts a hero with no photo array as one image", () => {
    const media = buildMedia(withSources({
      listing: listingRow({ photos: [], photo_count: null, hero_image_url: CAI }),
    }));

    expect(media.photoCount).toBe(1);
    expect(media.photoHosts).toEqual(["assets.cai-media-management.com"]);
  });

  it("reports nothing rather than guessing when no listing was read", () => {
    expect(buildMedia(emptySources(TENANT))).toEqual({
      heroImageUrl: null,
      photoCount: 0,
      photoHosts: [],
    });
  });

  it("drops a photo entry that is not a usable URL", () => {
    const media = buildMedia(withSources({
      listing: listingRow({ photos: ["", "not a url", CAI], hero_image_url: null }),
    }));

    expect(media.photoHosts).toEqual(["assets.cai-media-management.com"]);
  });
});

describe("hostOf", () => {
  it("strips scheme, userinfo, port, path, query and fragment", () => {
    expect(hostOf("https://user:pw@Assets.CAI-Media-Management.com:443/a/b?x=1#y"))
      .toBe("assets.cai-media-management.com");
    expect(hostOf("https://www.harteinfiniti.com/inventory")).toBe("harteinfiniti.com");
    expect(hostOf("data:image/png;base64,AAAA")).toBeNull();
    expect(hostOf("/relative/path.jpg")).toBeNull();
  });
});

// ── buildCustomer ───────────────────────────────────────────────────

describe("buildCustomer", () => {
  // Shapes from the three tables the bundle merges into `engagement`.
  const qrScan: Row = {
    id: "qr-1",
    qr_code_id: "code-1",
    vehicle_id: "6c1a3f4e-0000-4000-8000-000000000001",
    scanned_at: "2026-09-01T14:00:00.000Z",
  };
  const passportOpened: Row = {
    id: "cee-1",
    vin: VIN,
    event_type: "passport_opened",
    surface: "vehicle_passport",
    occurred_at: "2026-09-05T13:59:00.000Z",
  };
  const ctaClicked: Row = {
    id: "cee-2",
    vin: VIN,
    event_type: "cta_clicked",
    surface: "vehicle_passport",
    occurred_at: "2026-09-05T14:01:00.000Z",
  };
  const leadFormOpened: Row = {
    id: "cee-3",
    vin: VIN,
    event_type: "lead_form_opened",
    surface: "lead_form",
    occurred_at: "2026-09-05T14:02:11.061Z",
  };
  const ping = (n: number): Row => ({
    id: `cee-ping-${n}`,
    vin: VIN,
    event_type: "engagement_ping",
    surface: "vehicle_passport",
    occurred_at: `2026-09-05T14:0${n}:30.000Z`,
  });
  const moduleDwell: Row = {
    id: "pe-1",
    vin: VIN,
    slug: "2024-volkswagen-jetta-082795",
    session_id: "sess-1",
    module: "market_intelligence",
    seconds: 41,
    first_at: "2026-09-05T14:00:10.000Z",
    last_at: "2026-09-05T14:03:00.000Z",
  };

  it("separates opens, deliberate actions and passive telemetry", () => {
    const customer = buildCustomer(withSources({
      listing: listingRow(),
      engagement: [qrScan, passportOpened, ctaClicked, leadFormOpened, ping(1), ping(2), ping(3), moduleDwell],
    }));

    expect(customer.passportSlug).toBe("2024-volkswagen-jetta-082795");
    expect(customer.passportPublishedAt).toBe("2026-08-03T03:07:28.308Z");
    // A QR scan and a passport open; not the three pings.
    expect(customer.scans).toBe(2);
    // cta_clicked and lead_form_opened only: 843 pings stand against 63 cta
    // clicks live, so pings may never be counted as engagement.
    expect(customer.engagements).toBe(2);
    expect(customer.leads).toBe(0);
    expect(customer.lastActivityAt).toBe("2026-09-05T14:03:30.000Z");
  });

  it("counts leads and lets a lead move lastActivityAt", () => {
    const customer = buildCustomer(withSources({
      listing: listingRow(),
      engagement: [passportOpened],
      leads: [{
        id: "lead-1",
        vehicle_vin: VIN,
        source: "vehicle_passport",
        captured_at: "2026-09-08T18:30:00.000Z",
        created_at: "2026-09-08T18:30:00.000Z",
      }],
    }));

    expect(customer.leads).toBe(1);
    expect(customer.lastActivityAt).toBe("2026-09-08T18:30:00.000Z");
  });

  it("reports zeroes and nulls when nothing was read", () => {
    expect(buildCustomer(emptySources(TENANT))).toEqual({
      passportSlug: null,
      passportPublishedAt: null,
      scans: 0,
      engagements: 0,
      leads: 0,
      lastActivityAt: null,
    });
  });

  it("does not invent a published stamp for an unpublished listing", () => {
    const customer = buildCustomer(withSources({
      listing: listingRow({ published_at: null, slug: null }),
    }));
    expect(customer.passportPublishedAt).toBeNull();
    expect(customer.passportSlug).toBeNull();
  });
});

// ── buildPublishing ─────────────────────────────────────────────────

const channelRow = (channel: string, validation_status: string, over: Row = {}): Row => ({
  id: `dcv-${channel}`,
  tenant_id: TENANT,
  channel,
  validation_status,
  locked: false,
  potentially_stale: false,
  created_at: "2026-09-09T03:10:00.000Z",
  updated_at: "2026-09-09T03:10:29.955Z",
  ...over,
});

// The live shape: `channel` is null on VALIDATION_FAILED and the real codes
// live in details_json.findings[].validator_code, scoped by fact_path.
const validationFailed = (over: Row = {}): Row => ({
  id: "ex-1",
  tenant_id: TENANT,
  exception_type: "VALIDATION_FAILED",
  severity: "high",
  status: "open",
  blocking: true,
  channel: null,
  title: "Description blocked by validation",
  details_json: {
    findings: [
      {
        blocking: true,
        severity: "blocking",
        fact_path: "channel:autotrader",
        validator_code: "CHANNEL_PRICE_NOT_ALLOWED",
        message: "AutoTrader publishes its own pricing; a price in the description body is not permitted.",
      },
      {
        blocking: true,
        severity: "blocking",
        fact_path: "channel:cargurus",
        validator_code: "CHANNEL_PRICE_NOT_ALLOWED",
        message: "CarGurus publishes its own pricing; a price in the description body is not permitted.",
      },
      {
        blocking: true,
        severity: "blocking",
        validator_code: "REQUIRED_DISCLOSURE_MISSING",
        message: "Required disclosure text is missing.",
      },
    ],
  },
  created_at: "2026-09-09T03:10:00.000Z",
  ...over,
});

const pricingWith = (over: Partial<ResolvedField<number>>): PricingSection => {
  const candidate: FieldCandidate<number> = {
    value: 58382,
    source: "marketcheck",
    origin: "vehicle_listings.price",
    provider: "MarketCheck syndication feed",
    observedAt: "2026-09-09T03:07:22.304Z",
    confidence: "HIGH",
    license: "UNKNOWN_REVIEW_REQUIRED",
  };
  const advertisedRetail: ResolvedField<number> = {
    key: "advertised_retail",
    value: 58382,
    chosen: candidate,
    freshness: "CURRENT",
    ageDays: 0.4,
    candidates: [candidate],
    disagreeing: [],
    disputed: false,
    reason: "MarketCheck syndication feed via vehicle_listings.price, observed 0.4 days ago.",
    ...over,
  };
  return {
    advertisedRetail,
    sellingPrice: emptyField<number>("selling_price", "not needed for this test"),
    docFee: emptyField<number>("doc_fee", "not needed for this test"),
    dealerDiscount: emptyField<number>("dealer_discount", "not needed for this test"),
    msrpFactory: emptyField<number>("msrp_factory", "not needed for this test"),
    msrpFeed: emptyField<number>("msrp_feed", "not needed for this test"),
    advertisedIncludesDocFee: true,
    priceDisplayMode: "website_sale_price",
  };
};

describe("buildPublishing", () => {
  const channels = [
    channelRow("autotrader", "blocked"),
    channelRow("cars_com", "blocked"),
    channelRow("cargurus", "blocked"),
    channelRow("facebook", "blocked"),
    channelRow("google_seo", "blocked"),
    channelRow("vauto", "blocked"),
    channelRow("vehicle_passport", "passed"),
    channelRow("dealer_website", "passed"),
  ];

  it("splits published from blocked and names the live blocking codes", () => {
    const publishing = buildPublishing(withSources({
      listing: listingRow(),
      descriptionChannels: channels,
      descriptionExceptions: [validationFailed()],
      descriptionVersion: {
        id: "dv-1",
        version_number: 3,
        created_at: "2026-09-09T03:09:00.000Z",
        approved_at: "2026-09-09T03:10:14.987Z",
      },
    }));

    expect(publishing.channelsPublished).toEqual(["dealer_website", "vehicle_passport"]);
    expect(publishing.descriptionVersionId).toBe("dv-1");
    expect(publishing.descriptionUpdatedAt).toBe("2026-09-09T03:10:14.987Z");

    // A code from fact_path lands on its own channel; the unscoped
    // REQUIRED_DISCLOSURE_MISSING is raised against the master copy and
    // applies to every channel that is blocked.
    expect(publishing.channelsBlocked).toContainEqual({
      channel: "autotrader",
      code: "CHANNEL_PRICE_NOT_ALLOWED",
    });
    expect(publishing.channelsBlocked).toContainEqual({
      channel: "autotrader",
      code: "REQUIRED_DISCLOSURE_MISSING",
    });
    expect(publishing.channelsBlocked).toContainEqual({
      channel: "cars_com",
      code: "REQUIRED_DISCLOSURE_MISSING",
    });
    // A passed channel is never given a blocking code.
    expect(publishing.channelsBlocked.map((entry) => entry.channel))
      .not.toContain("vehicle_passport");
  });

  it("ignores dismissed and resolved exceptions", () => {
    const publishing = buildPublishing(withSources({
      descriptionChannels: [channelRow("vehicle_passport", "passed")],
      descriptionExceptions: [
        validationFailed({ id: "ex-dismissed", status: "dismissed" }),
        {
          id: "ex-resolved",
          exception_type: "EQUIPMENT_CONFLICT",
          status: "resolved",
          blocking: true,
          channel: "vehicle_passport",
          details_json: {},
        },
      ],
    }));

    expect(publishing.channelsPublished).toEqual(["vehicle_passport"]);
    expect(publishing.channelsBlocked).toEqual([]);
  });

  it("blocks a channel named only by an exception, with no channel row", () => {
    const publishing = buildPublishing(withSources({
      descriptionChannels: [channelRow("vehicle_passport", "passed")],
      descriptionExceptions: [{
        id: "ex-2",
        exception_type: "UNSUPPORTED_FEATURE_CLAIM",
        status: "open",
        blocking: true,
        channel: "facebook",
        details_json: {
          findings: [{
            blocking: true,
            severity: "blocking",
            validator_code: "UNSUPPORTED_FEATURE_CLAIM",
            message: "The copy claims equipment no source verifies.",
          }],
        },
      }],
    }));

    expect(publishing.channelsBlocked).toEqual([
      { channel: "facebook", code: "UNSUPPORTED_FEATURE_CLAIM" },
    ]);
    expect(publishing.channelsPublished).toEqual(["vehicle_passport"]);
  });

  it("says the reason is not recorded rather than inventing one", () => {
    const publishing = buildPublishing(withSources({
      descriptionChannels: [channelRow("vauto", "blocked")],
    }));

    expect(publishing.channelsBlocked).toEqual([
      { channel: "vauto", code: "BLOCKED_REASON_NOT_RECORDED" },
    ]);
  });

  it("prefers the newest row when a channel has several", () => {
    const publishing = buildPublishing(withSources({
      descriptionChannels: [
        channelRow("vehicle_passport", "blocked", {
          id: "old",
          updated_at: "2026-09-01T01:00:00.000Z",
        }),
        channelRow("vehicle_passport", "passed", {
          id: "new",
          updated_at: "2026-09-09T03:10:14.987Z",
        }),
      ],
    }));

    expect(publishing.channelsPublished).toEqual(["vehicle_passport"]);
    expect(publishing.channelsBlocked).toEqual([]);
  });

  it("clears AutoFilm only for a current, undisputed price", () => {
    const base = withSources({ listing: listingRow(), descriptionChannels: channels });

    expect(buildPublishing(base, { pricing: pricingWith({}) }).autofilmEligible).toBe(true);
  });

  it("refuses AutoFilm on a stale advertised retail (directive 41)", () => {
    const base = withSources({ listing: listingRow() });
    expect(buildPublishing(base, {
      pricing: pricingWith({ freshness: "STALE" }),
    }).autofilmEligible).toBe(false);
    expect(buildPublishing(base, {
      pricing: pricingWith({ freshness: "SUPERSEDED" }),
    }).autofilmEligible).toBe(false);
  });

  it("refuses AutoFilm on a conflicted or disputed price", () => {
    const base = withSources({ listing: listingRow() });
    expect(buildPublishing(base, {
      pricing: pricingWith({ freshness: "CONFLICTED", disputed: true }),
    }).autofilmEligible).toBe(false);
    expect(buildPublishing(base, {
      pricing: pricingWith({ disputed: true }),
    }).autofilmEligible).toBe(false);
  });

  it("fails closed when it cannot see a price at all", () => {
    expect(buildPublishing(emptySources(TENANT)).autofilmEligible).toBe(false);
    expect(buildPublishing(emptySources(TENANT), {
      pricing: pricingWith({ value: null, chosen: null, freshness: "UNKNOWN" }),
    }).autofilmEligible).toBe(false);
  });

  it("reports an empty publishing section when nothing was read", () => {
    expect(buildPublishing(emptySources(TENANT))).toEqual({
      descriptionVersionId: null,
      descriptionUpdatedAt: null,
      channelsPublished: [],
      channelsBlocked: [],
      autofilmEligible: false,
    });
  });
});

// ── buildTimeline ───────────────────────────────────────────────────

const changeRow = (over: Row): Row => ({
  id: "ch-x",
  tenant_id: TENANT,
  vin: VIN,
  source: "marketcheck",
  change_origin: "automatic",
  requires_new_document: false,
  ...over,
});

describe("buildTimeline", () => {
  it("collapses the nightly repeat of one lifecycle transition", () => {
    // The prune rewrites live -> removed_from_feed every night for a car that
    // is already gone: 5,840 rows over 268 pilot VINs, 53 on the worst one.
    const nightly = [1, 2, 3, 4, 5].map((day) => changeRow({
      id: `lc-${day}`,
      field_key: "_lifecycle",
      previous_value: "live",
      new_value: "removed_from_feed",
      changed_at: `2026-09-0${day}T03:07:58.970Z`,
    }));

    const events = buildTimeline(withSources({ changeHistory: nightly }));

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Left the dealer feed");
    expect(events[0].at).toBe("2026-09-01T03:07:58.970Z");
    expect(events[0].origin).toBe("vehicle_change_history");
  });

  it("keeps a genuine relist and the removal that follows it", () => {
    const rows = [
      changeRow({ id: "a", field_key: "_lifecycle", previous_value: null, new_value: "new_vehicle", changed_at: "2026-06-19T16:21:09.279Z" }),
      changeRow({ id: "b", field_key: "_lifecycle", previous_value: "live", new_value: "removed_from_feed", changed_at: "2026-07-01T03:07:58.970Z" }),
      changeRow({ id: "c", field_key: "_lifecycle", previous_value: "live", new_value: "removed_from_feed", changed_at: "2026-07-02T03:07:58.970Z" }),
      changeRow({ id: "d", field_key: "_lifecycle", previous_value: "removed_from_feed", new_value: "relisted", changed_at: "2026-07-10T03:07:58.970Z" }),
      changeRow({ id: "e", field_key: "_lifecycle", previous_value: "live", new_value: "removed_from_feed", changed_at: "2026-08-01T03:07:58.970Z" }),
    ];

    const events = buildTimeline(withSources({ changeHistory: rows }));

    expect(events.map((event) => event.summary)).toEqual([
      "Left the dealer feed",
      "Returned to the dealer feed",
      "Left the dealer feed",
      "First seen in the dealer feed",
    ]);
  });

  it("states a price move in money and carries the document consequence", () => {
    const events = buildTimeline(withSources({
      changeHistory: [changeRow({
        id: "p1",
        field_key: "price",
        previous_value: "39860",
        new_value: "40883",
        changed_at: "2026-09-08T03:07:22.304Z",
        requires_new_document: true,
        created_exception_id: "ad7af955-5c64-4f3a-84ab-557684b541dd",
      })],
    }));

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("price_changed");
    expect(events[0].summary)
      .toBe("Advertised price $39,860 to $40,883 (up $1,023); a new document is required");
  });

  it("describes mileage, condition and an unmapped lifecycle value plainly", () => {
    const events = buildTimeline(withSources({
      changeHistory: [
        changeRow({ id: "m", field_key: "mileage", previous_value: "11500", new_value: "12400", changed_at: "2026-08-29T03:07:05.614Z" }),
        changeRow({ id: "c", field_key: "condition", previous_value: "used", new_value: "cpo", changed_at: "2026-09-07T03:07:17.054Z", requires_new_document: true }),
        changeRow({ id: "l", field_key: "_lifecycle", previous_value: "live", new_value: "sold", changed_at: "2026-09-08T03:07:17.054Z" }),
      ],
    }));

    expect(events.map((event) => event.summary)).toEqual([
      "Listing state live to sold",
      "Condition used to cpo; a new document is required",
      "Mileage 11,500 to 12,400",
    ]);
  });

  it("emits a market value event only when the value moved", () => {
    const events = buildTimeline(withSources({
      valueHistory: [
        { id: "v4", source: "marketcheck_sync", market_value: null, captured_at: "2026-09-09T03:07:30.000Z" },
        { id: "v3", source: "vehicle_enrich", market_value: "60100.00", captured_at: "2026-09-08T08:12:49.965Z" },
        { id: "v2", source: "vehicle_enrich", market_value: "61759.00", captured_at: "2026-09-05T08:12:49.965Z" },
        { id: "v1", source: "market_pricing", market_value: "61759.00", captured_at: "2026-09-01T08:12:49.965Z" },
      ],
    }));

    expect(events.map((event) => event.summary)).toEqual([
      "Market value $61,759 to $60,100",
      "Market value first recorded at $61,759",
    ]);
    expect(events[0].origin).toBe("vehicle_value_history");
  });

  it("carries document lifecycle, passport publish and description events", () => {
    const events = buildTimeline(withSources({
      listing: listingRow({ archived_at: "2026-09-09T03:07:58.970Z", archive_reason: "removed_from_feed" }),
      generatedDocuments: [{
        id: "gd-1",
        document_type: "buyers_guide",
        version: 2,
        created_at: "2026-08-01T15:00:00.000Z",
        published_at: "2026-08-01T15:05:00.000Z",
        superseded_at: null,
        rejected_at: null,
      }],
      signedDocuments: [{
        id: "sd-1",
        doc_type: "addendum",
        vin: VIN,
        created_at: "2026-08-20T18:00:00.000Z",
      }],
      descriptionVersion: {
        id: "dv-1",
        version_number: 3,
        created_at: "2026-09-09T03:09:00.000Z",
        approved_at: "2026-09-09T03:10:14.987Z",
      },
    }));

    expect(events.map((event) => [event.kind, event.origin])).toEqual([
      ["description_updated", "description_versions"],
      ["listing_archived", "vehicle_listings.archived_at"],
      ["document_signed", "signed_document_archive"],
      ["passport_published", "vehicle_listings.published_at"],
      ["document_published", "generated_documents"],
      ["document_generated", "generated_documents"],
    ]);
    expect(events[3].summary).toBe("Vehicle Passport published at /v/2024-volkswagen-jetta-082795");
    expect(events[5].summary).toBe("Generated buyers_guide (v2)");
  });

  it("orders newest first and applies the limit", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((day) => changeRow({
      id: `p-${day}`,
      field_key: "price",
      previous_value: String(30000 + day),
      new_value: String(30100 + day),
      changed_at: `2026-09-0${day}T03:07:22.304Z`,
    }));

    const events = buildTimeline(withSources({ changeHistory: rows }), 3);

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.at)).toEqual([
      "2026-09-06T03:07:22.304Z",
      "2026-09-05T03:07:22.304Z",
      "2026-09-04T03:07:22.304Z",
    ]);
  });

  it("breaks a same-instant tie deterministically", () => {
    const at = "2026-09-09T03:07:22.304Z";
    const first = buildTimeline(withSources({
      changeHistory: [
        changeRow({ id: "1", field_key: "price", previous_value: "1", new_value: "2", changed_at: at }),
        changeRow({ id: "2", field_key: "mileage", previous_value: "10", new_value: "20", changed_at: at }),
      ],
    }));
    const reversed = buildTimeline(withSources({
      changeHistory: [
        changeRow({ id: "2", field_key: "mileage", previous_value: "10", new_value: "20", changed_at: at }),
        changeRow({ id: "1", field_key: "price", previous_value: "1", new_value: "2", changed_at: at }),
      ],
    }));

    expect(first).toEqual(reversed);
  });

  it("never reads the audit_log tail, even when the bundle carries refusals", () => {
    const events = buildTimeline(withSources({
      crawlRefusals: [{
        id: "al-1",
        action: "advertised_price_crawl_skipped",
        created_at: "2026-09-09T06:42:13.800Z",
        details: { vin: VIN, scraped: 90403, feed: 78084 },
      }],
      facts: [{ id: "f-1", fact_key: "advertised_price", observed_at: "2026-08-10T00:00:00.000Z" }],
    }));

    expect(events).toEqual([]);
  });

  it("returns nothing when nothing was read", () => {
    expect(buildTimeline(emptySources(TENANT))).toEqual([]);
  });
});

// ── buildSourceHealth ───────────────────────────────────────────────

const healthOf = (entries: ReturnType<typeof buildSourceHealth>, source: string) => {
  const entry = entries.find((row) => row.source === source);
  if (!entry) throw new Error(`no source health entry for ${source}`);
  return entry;
};

describe("buildSourceHealth", () => {
  const syncConfig: Row = {
    tenant_id: TENANT,
    allowed: true,
    enabled: true,
    frequency: "nightly",
    run_hour: 3,
    last_run_at: "2026-09-09T03:07:02.440Z",
    last_good_at: "2026-09-09T03:07:59.368Z",
    last_status: { seen: 128, removed: 2, provider_refused: false },
  };
  const successRun: Row = {
    id: "run-1",
    tenant_id: TENANT,
    status: "success",
    started_at: "2026-09-09T03:07:02.599Z",
    finished_at: "2026-09-09T03:07:59.368Z",
    seen: 128,
    error_summary: null,
  };
  // 190 of the pilot's 250 runs carry this status; it is the scheduler
  // declining, not a failure.
  const skippedRun: Row = {
    id: "run-2",
    tenant_id: TENANT,
    status: "skipped",
    started_at: "2026-09-09T08:07:02.599Z",
    finished_at: "2026-09-09T08:07:02.599Z",
    error_summary: "skipped: ran_5h_ago",
  };

  const healthySources = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => withSources({
    listing: listingRow({
      market_checked_at: "2026-09-09T08:12:49.965Z",
      market_value: "61759.00",
      market_meta: { checked_at: "2026-09-09T08:12:48.913Z", similar_count: 14 },
      market_payload: { marketValue: 61759, checked_at: "2026-09-09T08:12:49.965Z" },
      mc_attributes: { specs_source: "neovin", specs_decoded_at: "2026-09-08T16:46:13.771Z", build_sheet: { total_msrp: 62130 } },
      recall_checked_at: "2026-09-04T16:43:52.593Z",
      recall_payload: { source: "nhtsa", checked_at: "2026-09-09T03:08:00.000Z" },
      recall_status: "clear",
      epa_checked_at: "2026-09-09T04:45:07.717Z",
      epa_economy: { city: 29, highway: 40 },
      oem_sticker_checked_at: null,
    }),
    syncConfig,
    syncRuns: [skippedRun, successRun],
    neovin: { id: "nv-1", vin: VIN, fetched_at: "2026-09-08T16:46:13.771Z", payload: { vin: VIN } },
    providerShapes: [{
      provider: "marketcheck_neovin",
      endpoint: "https://api.marketcheck.com/v2/decode/car/neovin/5N1BT3BB2TC779545/specs?api_key=***",
      observations: 1,
      parse_failed: false,
      last_seen_at: "2026-09-08T16:46:13.771Z",
    }],
    advertisedPrices: [{
      id: "ap-1",
      vin: VIN,
      source_channel: "website",
      captured_method: "dealer_vdp_observation",
      advertised_price: "57487.00",
      captured_at: "2026-09-09T06:52:57.544Z",
    }],
    crawlAttempt: {
      id: "ca-1",
      vin: VIN,
      outcome: "captured",
      attempts: 1,
      last_attempt_at: "2026-09-09T06:52:57.544Z",
      resolved_at: "2026-09-09T06:52:57.544Z",
    },
    getReady: { id: "gr-1", vin: VIN, status: "pending", inspection_required: true, inspection_complete: false },
    ...over,
  });

  it("returns one entry per source, in a stable order", () => {
    const entries = buildSourceHealth(healthySources(), { now: NOW });

    expect(entries.map((entry) => entry.source)).toEqual([
      "MarketCheck inventory",
      "Market intelligence",
      "NeoVIN build sheet",
      "Dealer website (Firecrawl)",
      "NHTSA recall",
      "EPA fuel economy",
      "NMVTIS title history",
      "OEM incentives",
      "OEM window sticker",
      "Get Ready",
    ]);
  });

  it("does not treat a skipped sync run as a failure", () => {
    const entry = healthOf(buildSourceHealth(healthySources(), { now: NOW }), "MarketCheck inventory");

    expect(entry.state).toBe("CURRENT");
    expect(entry.lastFailureAt).toBeNull();
    expect(entry.lastSuccessAt).toBe("2026-09-09T03:07:59.368Z");
    expect(entry.attention).toBeNull();
  });

  it("reports a real sync failure with the provider's own summary", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      syncRuns: [skippedRun, {
        id: "run-3",
        status: "failed",
        started_at: "2026-09-09T09:07:00.000Z",
        finished_at: "2026-09-09T09:07:03.822Z",
        error_summary: "No MarketCheck feed returned cars for harteinfiniti.com.",
      }, successRun],
      syncConfig: { ...syncConfig, last_good_at: null },
    }), { now: NOW }), "MarketCheck inventory");

    expect(entry.state).toBe("FAILING");
    expect(entry.lastFailureAt).toBe("2026-09-09T09:07:03.822Z");
    expect(entry.attention).toContain("No MarketCheck feed returned cars");
  });

  it("calls the sync DISABLED when the tenant switch is off", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      syncConfig: { ...syncConfig, enabled: false },
    }), { now: NOW }), "MarketCheck inventory");

    expect(entry.state).toBe("DISABLED");
  });

  it("goes STALE when no sync has succeeded inside the nightly window", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      syncRuns: [{ ...successRun, finished_at: "2026-09-01T03:07:59.368Z" }],
      syncConfig: { ...syncConfig, last_good_at: "2026-09-01T03:07:59.368Z" },
    }), { now: NOW }), "MarketCheck inventory");

    expect(entry.state).toBe("STALE");
    expect(entry.attention).toContain("2 days");
  });

  it("ages the recall by the greatest of its three stamps", () => {
    const entries = buildSourceHealth(healthySources(), { now: NOW });
    const recall = healthOf(entries, "NHTSA recall");

    // recall_checked_at is 5 days old and would read STALE alone; the payload
    // stamp written by vehicle-enrich is today's.
    expect(recall.lastSuccessAt).toBe("2026-09-09T03:08:00.000Z");
    expect(recall.state).toBe("CURRENT");
    expect(recall.lastFailureAt).toBeNull();
  });

  it("names a recall payload stored without a status", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      listing: listingRow({
        recall_payload: { source: "nhtsa", checked_at: "2026-09-09T03:08:00.000Z" },
        recall_status: null,
      }),
    }), { now: NOW }), "NHTSA recall");

    expect(entry.attention).toContain("without a recall status");
  });

  it("reports the crawl as FAILING on a render refusal", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      advertisedPrices: [],
      crawlAttempt: {
        id: "ca-2",
        vin: VIN,
        outcome: "render_cost_refused",
        attempts: 20,
        last_attempt_at: "2026-09-09T00:00:14.237Z",
        resolved_at: null,
        source_url: "https://www.harteinfiniti.com/inventory/used-2024-volkswagen-jetta",
        detail: "render budget exhausted for FIRECRAWL_API_KEY_1",
      },
    }), { now: NOW }), "Dealer website (Firecrawl)");

    expect(entry.state).toBe("FAILING");
    expect(entry.lastFailureAt).toBe("2026-09-09T00:00:14.237Z");
    expect(entry.attention).toBe("The last crawl of this vehicle's page ended render_cost_refused.");
  });

  it("says NOT CONFIGURED for a listing with no VDP URL", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      listing: listingRow({ source_url: null, price_source_url: null }),
      advertisedPrices: [],
      crawlAttempt: null,
    }), { now: NOW }), "Dealer website (Firecrawl)");

    expect(entry.state).toBe("NOT_CONFIGURED");
  });

  it("ignores a feed-sourced price row when dating the website observation", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      advertisedPrices: [{
        id: "ap-feed",
        source_channel: "feed",
        captured_method: "marketcheck_syndication",
        captured_at: "2026-09-09T03:07:22.304Z",
      }],
      crawlAttempt: null,
    }), { now: NOW }), "Dealer website (Firecrawl)");

    expect(entry.lastSuccessAt).toBeNull();
    expect(entry.state).toBe("UNKNOWN");
  });

  it("holds NMVTIS at NOT CONFIGURED and OEM incentives at DISABLED", () => {
    const entries = buildSourceHealth(healthySources(), { now: NOW });

    expect(healthOf(entries, "NMVTIS title history").state).toBe("NOT_CONFIGURED");
    expect(healthOf(entries, "NMVTIS title history").attention).toContain("ledger does not exist");
    expect(healthOf(entries, "OEM incentives").state).toBe("DISABLED");
    expect(healthOf(entries, "OEM window sticker").state).toBe("NOT_CONFIGURED");
  });

  it("treats a seeded Get Ready record as supplying no operational fact", () => {
    const entry = healthOf(buildSourceHealth(healthySources(), { now: NOW }), "Get Ready");

    expect(entry.state).toBe("UNKNOWN");
    expect(entry.lastSuccessAt).toBeNull();
    expect(entry.attention).toContain("no completed work");
  });

  it("turns Get Ready CURRENT once a real workflow event exists", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      getReady: { id: "gr-1", vin: VIN, status: "complete", inspection_date: "2026-09-02T15:00:00.000Z" },
      prepSignOffs: [{ id: "ps-1", vin: VIN, signed_at: "2026-09-03T16:00:00.000Z" }],
    }), { now: NOW }), "Get Ready");

    expect(entry.state).toBe("CURRENT");
    expect(entry.lastSuccessAt).toBe("2026-09-03T16:00:00.000Z");
  });

  it("flags a NeoVIN payload that could not be parsed", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      providerShapes: [{
        provider: "marketcheck_neovin",
        endpoint: "https://api.marketcheck.com/v2/decode/car/neovin/JTMABABA5PA005774/specs?api_key=***",
        parse_failed: true,
        observations: 4,
        last_seen_at: "2026-09-07T08:45:07.741Z",
      }],
    }), { now: NOW }), "NeoVIN build sheet");

    expect(entry.attention).toContain("could not be parsed");
  });

  it("never puts a URL or a credential name in a health line", () => {
    const entries = buildSourceHealth(healthySources({
      crawlAttempt: {
        id: "ca-3",
        outcome: "render_rate_limited",
        last_attempt_at: "2026-09-09T00:00:17.791Z",
        source_url: "https://www.harteinfiniti.com/inventory?utm=1",
        detail: "FIRECRAWL_API_KEY_2 rate limited",
      },
    }), { now: NOW });

    const text = JSON.stringify(entries);
    expect(text).not.toContain("http");
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("FIRECRAWL");
  });

  it("reports every source honestly when nothing was read", () => {
    const entries = buildSourceHealth(emptySources(TENANT), { now: NOW });

    expect(entries).toHaveLength(10);
    expect(healthOf(entries, "MarketCheck inventory").state).toBe("NOT_CONFIGURED");
    expect(healthOf(entries, "Market intelligence").state).toBe("UNKNOWN");
    expect(healthOf(entries, "NeoVIN build sheet").state).toBe("UNKNOWN");
    expect(healthOf(entries, "Dealer website (Firecrawl)").state).toBe("NOT_CONFIGURED");
    expect(healthOf(entries, "NHTSA recall").state).toBe("UNKNOWN");
    expect(healthOf(entries, "EPA fuel economy").state).toBe("UNKNOWN");
    expect(healthOf(entries, "Get Ready").state).toBe("NOT_CONFIGURED");
    for (const entry of entries) {
      expect(entry.supplies.length).toBeGreaterThan(0);
    }
  });

  it("names an EPA lookup that ran and matched nothing", () => {
    const entry = healthOf(buildSourceHealth(healthySources({
      listing: listingRow({ epa_checked_at: "2026-09-09T04:45:07.717Z", epa_economy: null }),
    }), { now: NOW }), "EPA fuel economy");

    expect(entry.state).toBe("CURRENT");
    expect(entry.attention).toContain("matched no vehicle");
  });
});

// ── deriveAttention ─────────────────────────────────────────────────

const resolved = <T>(key: string, value: T): ResolvedField<T> => {
  const candidate: FieldCandidate<T> = {
    value,
    source: "marketcheck",
    origin: `vehicle_listings.${key}`,
    provider: "MarketCheck syndication feed",
    observedAt: "2026-09-09T03:07:22.304Z",
    confidence: "HIGH",
    license: "UNKNOWN_REVIEW_REQUIRED",
  };
  return {
    key,
    value,
    chosen: candidate,
    freshness: "CURRENT",
    ageDays: 0.4,
    candidates: [candidate],
    disagreeing: [],
    disputed: false,
    reason: `MarketCheck syndication feed via vehicle_listings.${key}, observed 0.4 days ago.`,
  };
};

const attentionModel = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  version: 1,
  tenantId: TENANT,
  vehicleId: "6c1a3f4e-0000-4000-8000-000000000001",
  vin: VIN,
  generatedAt: "2026-09-09T12:00:00.000Z",
  identity: {
    vin: resolved("vin", VIN),
    year: resolved("year", 2024),
    make: resolved("make", "Volkswagen"),
    model: resolved("model", "Jetta"),
    trim: resolved("trim", "SE"),
    bodyStyle: emptyField<string>("body_style", "not needed"),
    exteriorColor: emptyField<string>("exterior_color", "not needed"),
    interiorColor: emptyField<string>("interior_color", "not needed"),
    engine: emptyField<string>("engine", "not needed"),
    drivetrain: emptyField<string>("drivetrain", "not needed"),
    transmission: emptyField<string>("transmission", "not needed"),
    fuelType: emptyField<string>("fuel_type", "not needed"),
  },
  dealerState: {
    stock: resolved("stock", "H12345"),
    mileage: resolved("mileage", 12400),
    condition: resolved("condition", "used"),
    certified: resolved("certified", false),
    inTransit: resolved("in_transit", false),
    listingStatus: resolved("status", "published"),
    daysInInventory: resolved("days_in_inventory", 37),
  },
  pricing: pricingWith({}),
  publicAdvertisement: {
    observedPrice: emptyField<number>("observed_price", "not needed"),
    observedBeforeDocFee: emptyField<number>("observed_before_doc_fee", "not needed"),
    observedDocFee: emptyField<number>("observed_doc_fee", "not needed"),
    observedDiscount: emptyField<number>("observed_discount", "not needed"),
    vdpUrl: null,
    observedAt: null,
    evidencePath: null,
    evidenceSha256: null,
    lastOutcome: null,
    lastRefused: null,
  },
  marketIntelligence: {
    marketValue: emptyField<number>("market_value", "not needed"),
    daysOnMarket: emptyField<number>("days_on_market", "not needed"),
    comparableCount: emptyField<number>("comparable_count", "not needed"),
    marketDaysSupply: emptyField<number>("market_days_supply", "not needed"),
    priceChangePercent: emptyField<number>("price_change_percent", "not needed"),
    referencePrice: emptyField<number>("reference_price", "not needed"),
    kind: "analysis",
  },
  listingLifecycle: {
    firstSeenAt: null,
    lastSeenAt: null,
    publishedAt: "2026-08-03T03:07:28.308Z",
    archivedAt: null,
    archiveReason: null,
    lifecycleStage: "LIVE",
    lifecycleContradiction: null,
  },
  getReady: {
    stage: "pending",
    status: "pending",
    fromCompletedWork: false,
    inspectionSigned: true,
    reconApproved: true,
    prepSignedOff: true,
    deliveryCleared: true,
    openWorkItems: 0,
    blockers: [],
  },
  documents: {
    buyersGuide: { present: true, source: "generated_documents", documentId: "gd-1" },
    windowSticker: { present: true, source: "generated_documents", documentId: "gd-2" },
    addendum: { present: false, documentId: null },
    oemSticker: { present: false, url: null },
    staleFlags: [],
    counts: { generated: 2, signed: 0, stale: 0 },
  },
  compliance: {
    recallStatus: resolved("recall_status", "clear"),
    openRecallCount: resolved("open_recall_count", 0),
    doNotDrive: false,
    titleStatus: emptyField<string>("title_status", "not needed"),
    titleVerification: emptyField<string>("title_verification", "column absent live"),
    ctMvpStatus: null,
    blockers: [],
  },
  media: { heroImageUrl: CAI, photoCount: 3, photoHosts: ["assets.cai-media-management.com"] },
  customer: {
    passportSlug: "2024-volkswagen-jetta-082795",
    passportPublishedAt: "2026-08-03T03:07:28.308Z",
    scans: 2,
    engagements: 2,
    leads: 0,
    lastActivityAt: "2026-09-05T14:03:30.000Z",
  },
  publishing: {
    descriptionVersionId: "dv-1",
    descriptionUpdatedAt: "2026-09-09T03:10:14.987Z",
    channelsPublished: ["dealer_website", "vehicle_passport"],
    channelsBlocked: [],
    autofilmEligible: true,
  },
  sourceHealth: [],
  conflicts: [],
  recentChanges: [],
  missingSources: [],
  warnings: [],
  ...over,
});

describe("deriveAttention", () => {
  it("returns nothing when nothing is wrong", () => {
    expect(deriveAttention(attentionModel())).toEqual({
      blocker: null,
      nextAction: null,
      currentOwner: null,
    });
  });

  it("puts a do-not-drive recall above every other blocker", () => {
    const attention = deriveAttention(attentionModel({
      compliance: { ...attentionModel().compliance, doNotDrive: true, blockers: ["Title not verified"] },
      documents: {
        ...attentionModel().documents,
        buyersGuide: { present: false, source: "none", documentId: null },
      },
      getReady: { ...attentionModel().getReady, inspectionSigned: false, blockers: ["blocked_inspection_not_started"] },
      pricing: pricingWith({ freshness: "STALE" }),
    }));

    expect(attention.blocker).toContain("do-not-drive");
    expect(attention.currentOwner).toBe("Service Manager");
    expect(attention.nextAction).toContain("Do not move");
  });

  it("puts a missing Buyers Guide above an unstarted inspection", () => {
    const base = attentionModel();
    const attention = deriveAttention(attentionModel({
      documents: { ...base.documents, buyersGuide: { present: false, source: "none", documentId: null } },
      getReady: { ...base.getReady, inspectionSigned: false },
      pricing: pricingWith({ freshness: "STALE" }),
    }));

    expect(attention.blocker).toContain("Buyers Guide");
    expect(attention.currentOwner).toBe("Compliance/Admin");
  });

  it("does not demand a Buyers Guide on a new vehicle", () => {
    const base = attentionModel();
    const attention = deriveAttention(attentionModel({
      dealerState: { ...base.dealerState, condition: resolved("condition", "new") },
      documents: { ...base.documents, buyersGuide: { present: false, source: "none", documentId: null } },
    }));

    expect(attention.blocker).toBeNull();
  });

  it("raises the Get Ready blocker before a price problem", () => {
    const base = attentionModel();
    const attention = deriveAttention(attentionModel({
      getReady: { ...base.getReady, blockers: ["blocked_inspection_not_started"], inspectionSigned: false },
      pricing: pricingWith({ freshness: "STALE" }),
    }));

    expect(attention.blocker).toBe("blocked_inspection_not_started");
    expect(attention.currentOwner).toBe("Service Manager");
  });

  it("names an unsigned inspection on a used vehicle with no explicit blocker", () => {
    const base = attentionModel();
    const attention = deriveAttention(attentionModel({
      getReady: { ...base.getReady, inspectionSigned: false },
    }));

    expect(attention.blocker).toContain("safety inspection has not been signed");
    expect(attention.currentOwner).toBe("Service Manager");
  });

  it("reports a conflicted price with the resolver's own reason", () => {
    const attention = deriveAttention(attentionModel({
      pricing: pricingWith({
        freshness: "CONFLICTED",
        disputed: true,
        reason: "MarketCheck syndication feed says 58382 and Dealer VDP observation says 90403; both may verify advertised_price, so a person decides.",
      }),
    }));

    expect(attention.blocker).toContain("Two sources disagree");
    expect(attention.blocker).toContain("90403");
    expect(attention.currentOwner).toBe("Used Car Manager");
  });

  it("reports a stale price", () => {
    const attention = deriveAttention(attentionModel({
      pricing: pricingWith({
        freshness: "STALE",
        reason: "MarketCheck syndication feed via vehicle_listings.price, last observed 31.0 days ago; policy for advertised_price is 3 days.",
      }),
    }));

    expect(attention.blocker).toContain("not current");
    expect(attention.currentOwner).toBe("Used Car Manager");
  });

  it("reports a vehicle with no price at all", () => {
    const attention = deriveAttention(attentionModel({
      pricing: pricingWith({
        value: null,
        chosen: null,
        freshness: "UNKNOWN",
        reason: "No source supplies advertised_retail for this vehicle.",
      }),
    }));

    expect(attention.blocker).toBe("No source supplies an advertised price for this vehicle.");
    expect(attention.currentOwner).toBe("Used Car Manager");
  });

  it("is deterministic for the same model", () => {
    const model = attentionModel({ pricing: pricingWith({ freshness: "STALE" }) });
    expect(deriveAttention(model)).toEqual(deriveAttention(model));
  });
});

describe("buildSourceHealth Get Ready evidence", () => {
  it("does not count a voided inspection or an edit stamp as completed work", () => {
    const entries = buildSourceHealth(withSources({
      getReady: { id: "gr-1", vin: VIN, status: "pending" },
      safetyInspections: [{
        id: "si-1",
        vin: VIN,
        signed_at: "2026-09-02T15:00:00.000Z",
        voided_at: "2026-09-03T09:00:00.000Z",
        updated_at: "2026-09-08T09:00:00.000Z",
      }],
    }), { now: NOW });
    const entry = entries.find((row) => row.source === "Get Ready");

    expect(entry?.state).toBe("UNKNOWN");
    expect(entry?.lastSuccessAt).toBeNull();
  });

  it("counts a signed, unvoided inspection", () => {
    const entries = buildSourceHealth(withSources({
      getReady: { id: "gr-1", vin: VIN, status: "pending" },
      safetyInspections: [{ id: "si-2", vin: VIN, signed_at: "2026-09-02T15:00:00.000Z", voided_at: null }],
    }), { now: NOW });
    const entry = entries.find((row) => row.source === "Get Ready");

    expect(entry?.state).toBe("CURRENT");
    expect(entry?.lastSuccessAt).toBe("2026-09-02T15:00:00.000Z");
  });
});

import { describe, it, expect } from "vitest";
import {
  availabilityFromRow, decodeAuthorityOf, dealerOfferFromRow, identityFromRow, incentivesFromRow, listingFacts, LISTING_FACTS_VERSION,
  marketContextFromRow, mediaFromRow, msrpFromRow, parseYmm, priceIntegrityFromRow, providerStamp, READ_MODEL_TTL_DAYS,
  recallSummaryFromRow, stateFromFreshness, warrantyFromRow, type ListingRowLike,
} from "./listingFacts";
import { containsForbiddenKey, resolveFreshness } from "../contracts";
import { COHORT_MATCH_LEVELS } from "../../market/cohortLadder";
import { epoch, exactSheet, iso, noRecall, NOW, usedRow, vinClear, vinFailed, vinOpen } from "./__fixtures__/rows";

const attrs = (row: ListingRowLike): Record<string, unknown> => row.mc_attributes as Record<string, unknown>;
const withAttrs = (patch: Record<string, unknown>): ListingRowLike => {
  const row = usedRow();
  return { ...row, mc_attributes: { ...attrs(row), ...patch } };
};
const withoutAttr = (...keys: string[]): ListingRowLike => {
  const row = usedRow();
  const mc = { ...attrs(row) };
  for (const k of keys) delete mc[k];
  return { ...row, mc_attributes: mc };
};

describe("helpers", () => {
  it("parses a year make model string and tolerates partial ones", () => {
    expect(parseYmm("2025 INFINITI QX60")).toEqual({ year: 2025, make: "INFINITI", model: "QX60" });
    expect(parseYmm("2025 Land Rover Range Rover Sport")).toEqual({ year: 2025, make: "Land", model: "Rover Range Rover Sport" });
    expect(parseYmm("INFINITI QX60")).toEqual({ year: null, make: "INFINITI", model: "QX60" });
    expect(parseYmm("")).toEqual({ year: null, make: null, model: null });
  });

  it("reads provider stamps in epoch seconds, epoch milliseconds and ISO form", () => {
    expect(providerStamp(epoch(1))).toBe(iso(1));
    expect(providerStamp(String(epoch(1)))).toBe(iso(1));
    expect(providerStamp(NOW - 86_400_000)).toBe(iso(1));
    expect(providerStamp(iso(1))).toBe(iso(1));
    expect(providerStamp("yesterday")).toBeNull();
    expect(providerStamp(0)).toBeNull();
    expect(providerStamp(null)).toBeNull();
  });

  it("turns freshness into a public state, treating an undated no-TTL fact as current", () => {
    expect(stateFromFreshness(resolveFreshness({ checkedAt: iso(1), ttlDays: 7, nowMs: NOW }))).toBe("verified");
    expect(stateFromFreshness(resolveFreshness({ checkedAt: iso(10), ttlDays: 7, nowMs: NOW }))).toBe("stale");
    expect(stateFromFreshness(resolveFreshness({ checkedAt: null, ttlDays: 7, nowMs: NOW }))).toBe("unknown");
    expect(stateFromFreshness(resolveFreshness({ checkedAt: null, ttlDays: null, nowMs: NOW }))).toBe("verified");
  });

  it("takes its TTLs from the registry cadence, with the feed window widened by one run", () => {
    expect(READ_MODEL_TTL_DAYS.feed).toBeGreaterThanOrEqual(2);
    expect(READ_MODEL_TTL_DAYS.marketDaysSupply).toBe(7);
    expect(READ_MODEL_TTL_DAYS.salesStats).toBe(30);
    expect(READ_MODEL_TTL_DAYS.recall).toBe(30);
    expect(READ_MODEL_TTL_DAYS.factoryDecode).toBeNull();
  });
});

describe("identity", () => {
  it("an exact VIN decoded from listings identifies the VIN but is not factory verified", () => {
    const id = identityFromRow(withAttrs({ build_sheet: { ...exactSheet(), taxonomy: { record_source: "used_mc_listing" } } }), NOW);
    expect(id.matchLevel).toBe("EXACT_VIN");
    expect(id.decodeAuthority).toBe("listing_derived");
    expect(id.factoryVerified).toBe(false);
    const unknownSource = identityFromRow(withAttrs({ build_sheet: { ...exactSheet(), taxonomy: undefined } }), NOW);
    expect(unknownSource.decodeAuthority).toBe("unknown");
    expect(unknownSource.factoryVerified).toBe(false);
  });

  it("high decoder confidence alone never makes a listing-sourced record factory verified", () => {
    const id = identityFromRow(withAttrs({
      build_sheet: { ...exactSheet(), taxonomy: { record_source: "combined_mc_listing" } },
      neovin_confidence: { record_confidence: 100 },
    }), NOW);
    expect(id.providerConfidence).toBe(1);
    expect(id.decodeAuthority).toBe("listing_derived");
    expect(id.factoryVerified).toBe(false);
  });

  it("a basic decoder answer is a trim-line match, never an exact VIN build", () => {
    const id = identityFromRow(withAttrs({ build_sheet: { ...exactSheet(), source: "basic_decode", request_tier: "basic_decoder" } }), NOW);
    expect(id.matchLevel).toBe("YMMT");
    expect(id.decodeSource).toBe("basic_decode");
    expect(id.factoryVerified).toBe(false);
  });

  it("normalizes NeoVIN record_confidence from its documented 0-100 scale and keeps the raw value", () => {
    const id = identityFromRow(withAttrs({ neovin_confidence: { record_confidence: 65 } }), NOW);
    expect(id.providerConfidence).toBe(0.65);
    expect(id.providerConfidenceRaw).toBe(65);
    expect(id.providerConfidenceScale).toBe("percent_0_100");
  });

  it("an out-of-range or categorical confidence keeps its raw form with no numeric reading", () => {
    const big = identityFromRow(withAttrs({ neovin_confidence: { record_confidence: 140 } }), NOW);
    expect(big.providerConfidence).toBeNull();
    expect(big.providerConfidenceRaw).toBe(140);
    expect(big.providerConfidenceScale).toBe("unknown");
    const cat = identityFromRow(withAttrs({ neovin_confidence: { record_confidence: undefined, trim_confidence: "equipment_code" } }), NOW);
    expect(cat.providerConfidence).toBeNull();
    expect(cat.providerConfidenceScale).toBe("unknown");
  });

  it("is EXACT_VIN and factory verified on an exact NeoVIN sheet", () => {
    const id = identityFromRow(usedRow(), NOW);
    expect(id.matchLevel).toBe("EXACT_VIN");
    expect(id.factoryVerified).toBe(true);
    expect(id.decodeSource).toBe("neovin");
    expect(id).toMatchObject({ vin: "EXAMPLEVIN0000001", year: 2025, make: "INFINITI", model: "QX60", trim: "AUTOGRAPH", mileage: 41287 });
    expect(id.version).toBe("AUTOGRAPH AWD");
    expect(id.exteriorColor).toBe("Black Obsidian");
    expect(id.interiorColor).toBe("Graphite");
    expect(id.drivetrain).toBe("AWD");
    expect(id.providerConfidence).toBe(0.98);
    expect(id.freshness.state).toBe("current");
    expect(id.freshness.ttlDays).toBeNull();
  });

  it("is GENERIC_CANDIDATE, never factory verified, and drops the sheet's version and colors on a generic sheet", () => {
    const id = identityFromRow(withAttrs({ build_sheet: { ...exactSheet(), generic: true } }), NOW);
    expect(id.matchLevel).toBe("GENERIC_CANDIDATE");
    expect(id.factoryVerified).toBe(false);
    expect(id.decodeSource).toBe("neovin");
    expect(id.version).toBeNull();
    expect(id.exteriorColor).toBe("Black");
    expect(id.trim).toBe("AUTOGRAPH");
  });

  it("falls to YMM from the feed without a sheet and to UNKNOWN without a parsable row", () => {
    const ymm = identityFromRow(withoutAttr("build_sheet"), NOW);
    expect(ymm.matchLevel).toBe("YMM");
    expect(ymm.factoryVerified).toBe(false);
    expect(ymm.decodeSource).toBe("feed");
    expect(ymm.providerConfidence).toBeNull();
    expect(ymm.freshness.state).toBe("unknown");

    const unknown = identityFromRow({ vin: "examplevin0000003", ymm: null, mileage: "41,287", mc_attributes: null }, NOW);
    expect(unknown.matchLevel).toBe("UNKNOWN");
    expect(unknown.decodeSource).toBe("none");
    expect(unknown.vin).toBe("EXAMPLEVIN0000003");
    expect(unknown.mileage).toBe(41287);
  });
});

describe("msrp", () => {
  it("reads the configured breakdown and installed packages from an exact decode", () => {
    const m = msrpFromRow(usedRow(), NOW);
    expect(m).toMatchObject({ baseMsrp: 66150, installedOptionsMsrp: 3420, destination: 1395, configuredMsrp: 70965, source: "neovin", state: "verified" });
    expect(m.packages).toEqual([
      { name: "Vision Package", msrp: 1500, installed: true },
      { name: "Premium Paint", msrp: 995, installed: true },
    ]);
  });

  it("uses the sheet's own pricing block when the lifted keys are absent", () => {
    const row = withoutAttr("base_msrp", "delivery_charges", "total_msrp", "installed_options_msrp");
    const m = msrpFromRow(row, NOW);
    expect(m).toMatchObject({ baseMsrp: 66150, destination: 1395, configuredMsrp: 70965, source: "neovin" });
  });

  it("never presents a generic decode's figures as this vehicle's MSRP", () => {
    const m = msrpFromRow(withAttrs({ build_sheet: { ...exactSheet(), generic: true } }), NOW);
    expect(m.baseMsrp).toBeNull();
    expect(m.installedOptionsMsrp).toBeNull();
    expect(m.destination).toBeNull();
    expect(m.packages).toEqual([]);
    expect(m.configuredMsrp).toBe(69500);
    expect(m.source).toBe("feed");
    expect(m.state).toBe("warning");
  });

  it("is unknown with no decode and no listed MSRP", () => {
    const m = msrpFromRow(withoutAttr("build_sheet", "msrp", "base_msrp", "delivery_charges", "total_msrp", "installed_options_msrp"), NOW);
    expect(m).toMatchObject({ configuredMsrp: null, source: "none", state: "unknown" });
  });
});

describe("dealer offer", () => {
  it("carries the feed price, the stated fee basis and the website observation side by side", () => {
    const o = dealerOfferFromRow(usedRow(), NOW);
    expect(o).toMatchObject({
      advertisedPrice: 40995, feeBasis: "excluded", fees: 895, docFee: 499, websiteSalePrice: 40995,
      priceTerm: "Selling Price", channel: "feed", state: "verified",
    });
    expect(o.observedAt).toBe(iso(0.5));
    expect(o.freshness.ttlDays).toBe(READ_MODEL_TTL_DAYS.feed);
  });

  it("reports an unstated fee basis as unknown with null fees, never zero", () => {
    const o = dealerOfferFromRow(withoutAttr("fees", "price_includes_fees"), NOW);
    expect(o.feeBasis).toBe("unknown");
    expect(o.fees).toBeNull();
  });

  it("falls back to the website channel with its own window, and is unknown without any price", () => {
    const web = dealerOfferFromRow({ ...usedRow(), price: null }, NOW);
    expect(web.channel).toBe("website");
    expect(web.advertisedPrice).toBe(40995);
    expect(web.observedAt).toBe(iso(1));
    expect(web.freshness.ttlDays).toBe(READ_MODEL_TTL_DAYS.websitePrice);

    const none = dealerOfferFromRow({ ...usedRow(), price: null, website_sale_price: null }, NOW);
    expect(none.channel).toBeNull();
    expect(none.advertisedPrice).toBeNull();
    expect(none.state).toBe("unknown");
  });

  it("goes stale when the feed has not seen the vehicle inside the window", () => {
    const o = dealerOfferFromRow({ ...usedRow(), mc_raw: { last_seen_at: epoch(5) } }, NOW);
    expect(o.freshness.state).toBe("stale");
    expect(o.state).toBe("stale");
  });
});

describe("price integrity", () => {
  it("is consistent when the channels agree within tolerance", () => {
    expect(priceIntegrityFromRow(usedRow())).toMatchObject({ state: "consistent", maxDeltaDollars: 0, reasons: [] });
    expect(priceIntegrityFromRow({ ...usedRow(), website_sale_price: 40900 }).state).toBe("consistent");
  });

  it("is a mismatch when the channels differ beyond tolerance", () => {
    const p = priceIntegrityFromRow({ ...usedRow(), website_sale_price: 39995 });
    expect(p.state).toBe("channel_mismatch");
    expect(p.maxDeltaDollars).toBe(1000);
    expect(p.reasons[0]).toContain("1000");
    expect(p.channels.map((c) => c.channel)).toEqual(["feed", "website"]);
  });

  it("is single channel or unknown when fewer than two prices exist", () => {
    expect(priceIntegrityFromRow({ ...usedRow(), website_sale_price: null })).toMatchObject({ state: "single_channel", reasons: ["only_feed_observed"] });
    expect(priceIntegrityFromRow({ ...usedRow(), price: null, website_sale_price: null }).state).toBe("unknown");
  });

  it("refuses to compare channels observed too far apart or without a time", () => {
    const stale = priceIntegrityFromRow({ ...usedRow(), price_last_verified_at: iso(10) });
    expect(stale.state).toBe("stale_channel");
    expect(stale.reasons[0]).toMatch(/^website_observation_is_\d+_days_older$/);
    expect(priceIntegrityFromRow({ ...usedRow(), price_last_verified_at: null })).toMatchObject({ state: "stale_channel", reasons: ["a_channel_has_no_observation_time"] });
    expect(priceIntegrityFromRow({ ...usedRow(), price_last_verified_at: iso(10) }, { staleChannelDays: 14 }).state).toBe("consistent");
  });
});

describe("availability", () => {
  it("is available only while the feed has seen the vehicle inside the window", () => {
    const a = availabilityFromRow(usedRow(), NOW);
    expect(a).toMatchObject({ state: "available", inTransit: false, vehicleStatus: "available" });
    expect(a.lastSeenInFeedAt).toBe(iso(0.5));
    const old = availabilityFromRow({ ...usedRow(), mc_raw: { last_seen_at: epoch(5), in_transit: false } }, NOW);
    expect(old.state).toBe("unknown");
    expect(old.freshness.state).toBe("stale");
  });

  it("reads in-transit, sold, pending and archived states", () => {
    expect(availabilityFromRow({ ...usedRow(), mc_raw: { last_seen_at: epoch(0.5), in_transit: true } }, NOW).state).toBe("in_transit");
    expect(availabilityFromRow({ ...usedRow(), mc_raw: { last_seen_at: epoch(0.5), vehicle_status: "Sold" } }, NOW).state).toBe("sold");
    expect(availabilityFromRow({ ...usedRow(), mc_raw: { last_seen_at: epoch(0.5), vehicle_status: "sale pending" } }, NOW).state).toBe("pending");
    const archived = availabilityFromRow({ ...usedRow(), archived_at: iso(1) }, NOW);
    expect(archived.state).toBe("unknown");
    expect(archived.vehicleStatus).toBe("archived");
  });
});

describe("warranty", () => {
  it("reads the factory terms from the decode and the in-service date from the row", () => {
    const w = warrantyFromRow(usedRow(), NOW);
    expect(w.terms).toEqual([
      { name: "basic", months: 48, miles: 60000 },
      { name: "powertrain", months: 72, miles: 70000 },
    ]);
    expect(w).toMatchObject({ basis: "original_factory", inServiceDate: "2025-03-14", remainingCoverage: "unknown", source: "neovin", state: "verified" });
  });

  it("says why remaining coverage is not calculated when no in-service date exists", () => {
    const w = warrantyFromRow({ ...usedRow(), in_service_date: null }, NOW);
    expect(w.remainingCoverage).toBe("not_calculated_without_in_service_date");
    // A listing-history date is advertising chronology, never a warranty start.
    const fromHistory = warrantyFromRow({ ...usedRow(), in_service_date: null, history_payload: { inServiceDate: "2025-04-01" } }, NOW);
    expect(fromHistory.inServiceDate).toBeNull();
    const proxyColumn = warrantyFromRow({ ...usedRow(), in_service_date: "2025-04-01", history_payload: { firstSeen: "2025-04-01T10:00:00Z" } }, NOW);
    expect(proxyColumn.inServiceDate).toBeNull();
    expect(proxyColumn.remainingCoverage).toBe("not_calculated_without_in_service_date");
  });

  it("falls back to the stored warranty_info and is unknown without either", () => {
    const info = warrantyFromRow({
      ...withoutAttr("factory_warranty"),
      warranty_info: { factory_months: 36, factory_miles: 36000, powertrain_months: 60, powertrain_miles: 60000 },
    }, NOW);
    expect(info.source).toBe("warranty_info");
    expect(info.terms.map((t) => t.name)).toEqual(["basic", "powertrain"]);
    const none = warrantyFromRow(withoutAttr("factory_warranty"), NOW);
    expect(none).toMatchObject({ terms: [], basis: "unknown", remainingCoverage: "unknown", source: null, state: "unknown" });
  });
});

describe("market context", () => {
  it("reads velocity from the inferred sales figure when it is thick enough, and always says it is inferred", () => {
    const m = marketContextFromRow(usedRow(), NOW);
    expect(m).toMatchObject({
      mdsDays: 38, mdsScope: "YMMT", salesVelocity: "strong", velocityBasis: "inferred_sales_stats",
      trend: "stable", trendBasis: "sold_summary", inferredSoldWording: true,
    });
    expect(m.mdsCheckedAt).toBe(iso(2));
    expect(m.freshness.state).toBe("current");
    expect(m.freshness.ttlDays).toBe(7);
    expect(COHORT_MATCH_LEVELS).toContain(m.mdsScope);
  });

  it("falls back to the days-supply estimate when the sold figure is thin or make-wide", () => {
    const row = usedRow();
    const meta = row.market_meta as Record<string, unknown>;
    const sold = meta.sold_stats as Record<string, unknown>;
    const thin = marketContextFromRow({ ...row, market_meta: { ...meta, sold_stats: { ...sold, count: 3 } } }, NOW);
    expect(thin).toMatchObject({ salesVelocity: "strong", velocityBasis: "mds_estimate" });
    const wide = marketContextFromRow({ ...row, market_meta: { ...meta, sold_stats: { ...sold, scope: "make_state" } } }, NOW);
    expect(wide.velocityBasis).toBe("mds_estimate");
    const slow = marketContextFromRow({ ...row, market_meta: { ...meta, market_days_supply: 120, sold_stats: null } }, NOW);
    expect(slow.salesVelocity).toBe("slow");
  });

  it("dates a sales-only answer by the sales window, and is unknown with nothing stored", () => {
    const row = usedRow();
    const meta = row.market_meta as Record<string, unknown>;
    const sold = meta.sold_stats as Record<string, unknown>;
    const salesOnly = marketContextFromRow({ ...row, market_meta: { sold_stats: { ...sold, dom_median: 70 } } }, NOW);
    expect(salesOnly).toMatchObject({ mdsDays: null, mdsScope: null, salesVelocity: "slow", velocityBasis: "inferred_sales_stats" });
    expect(salesOnly.freshness.ttlDays).toBe(30);
    const none = marketContextFromRow({ ...row, market_meta: null }, NOW);
    expect(none).toMatchObject({ mdsDays: null, salesVelocity: "unknown", velocityBasis: "none", trend: "unknown", trendBasis: "none", inferredSoldWording: true });
    expect(none.freshness.state).toBe("unknown");
    const bogus = marketContextFromRow({ ...row, market_meta: { ...meta, trend: "moonward", mds_match_level: "exact_build_local" } }, NOW);
    expect(bogus.trend).toBe("unknown");
    expect(bogus.mdsScope).toBeNull();
  });

  it("reads a recorded cohort answer when the writer stores one", () => {
    const m = marketContextFromRow({
      ...usedRow(),
      market_meta: { mds_cohort: { match_level: "VIN_EXACT", value: 22, checked_at: iso(1), sample_size: 40, rungs_tried: [] } },
    }, NOW);
    expect(m).toMatchObject({ mdsDays: 22, mdsScope: "VIN_EXACT", salesVelocity: "strong", velocityBasis: "mds_estimate" });
    expect(m.mdsCheckedAt).toBe(iso(1));
  });
});

describe("media and incentives", () => {
  it("reads the hero and the photo list in either stored shape", () => {
    expect(mediaFromRow(usedRow())).toEqual({
      heroImageUrl: "https://example.invalid/hero.jpg",
      photoCount: 2,
      photos: ["https://example.invalid/1.jpg", "https://example.invalid/2.jpg"],
    });
    expect(mediaFromRow({ ...usedRow(), hero_image_url: null, photo_count: null }).heroImageUrl).toBe("https://example.invalid/1.jpg");
    expect(mediaFromRow({ vin: "EXAMPLEVIN0000003" })).toEqual({ heroImageUrl: null, photoCount: 0, photos: [] });
  });

  it("never invents an incentive", () => {
    expect(incentivesFromRow(usedRow())).toEqual([]);
  });
});

describe("recall", () => {
  it("states a verified no-open answer with its date", () => {
    const r = recallSummaryFromRow(usedRow(), NOW);
    expect(r).toMatchObject({ vinState: "NO_OPEN", truthState: "VERIFIED_CLEAR", openCount: 0, closedCount: 0, doNotDrive: false, publicState: "verified" });
    expect(r.checkedAt).toBe(iso(7));
    expect(r.publicStatement).toBe("No open recall campaigns reported on this VIN as of 2026-10-21.");
    expect(r.freshness.ttlDays).toBe(30);
  });

  it("distinguishes a VIN whose only campaigns are completed", () => {
    const r = recallSummaryFromRow({ ...usedRow(), ...vinClear(7, 1) }, NOW);
    expect(r.vinState).toBe("CLOSED_CAMPAIGN_ONLY");
    expect(r.closedCount).toBe(1);
    expect(r.publicState).toBe("verified");
    expect(r.publicStatement).toContain("1 completed campaign on record");
  });

  it("is adverse with the open count on an open answer", () => {
    const r = recallSummaryFromRow({ ...usedRow(), ...vinOpen(2) }, NOW);
    expect(r).toMatchObject({ vinState: "OPEN", truthState: "OPEN", openCount: 1, publicState: "adverse" });
    expect(r.publicStatement).toBe("1 open recall campaign reported on this VIN as of 2026-10-26.");
  });

  it("reports a failed or blocked check as unavailable, never as no-open", () => {
    const limited = recallSummaryFromRow({ ...usedRow(), ...vinFailed("marketcheck_rate_limited") }, NOW);
    expect(limited).toMatchObject({ vinState: "PROVIDER_UNAVAILABLE", truthState: "UNKNOWN", openCount: null, checkedAt: null, publicState: "unavailable" });
    expect(limited.publicStatement).toContain("not verified");
    const blocked = recallSummaryFromRow({ ...usedRow(), ...vinFailed("marketcheck_http_403") }, NOW);
    expect(blocked.vinState).toBe("ENTITLEMENT_BLOCKED");
    expect(blocked.publicState).toBe("unavailable");
    const notOnFile = recallSummaryFromRow({ ...usedRow(), ...vinFailed("marketcheck_vin_not_on_file") }, NOW);
    expect(notOnFile.vinState).toBe("UNKNOWN");
    expect(notOnFile.publicState).toBe("unknown");
  });

  it("never clears a VIN from a legacy row that did not declare its scope", () => {
    const r = recallSummaryFromRow({
      ...usedRow(),
      recall_check: { state: "verified_clear", source: "marketcheck", checked_at: iso(7), open_count: 0, campaigns: [] },
    }, NOW);
    expect(r.vinState).toBe("UNKNOWN");
    expect(r.publicState).toBe("unknown");
    expect(r.publicStatement).toBe("No VIN-level recall answer is on record for this vehicle.");
  });

  it("ages a no-open answer past the window into stale, not into a claim", () => {
    const r = recallSummaryFromRow({ ...usedRow(), ...vinClear(45) }, NOW);
    expect(r).toMatchObject({ vinState: "UNKNOWN", truthState: "STALE", publicState: "stale" });
    expect(r.freshness.state).toBe("stale");
    expect(r.publicStatement).toContain("older than 30 days");
  });

  it("warns on model-level campaigns while the VIN answer stays unknown", () => {
    const r = recallSummaryFromRow({
      ...usedRow(),
      ...noRecall(),
      recall_payload: {
        scope: "model", state: "model_campaigns_found", source: "nhtsa", checked_at: iso(3), campaign_count: 1, has_open: true,
        campaigns: [{ campaignNumber: "26V001", component: "AIR BAGS", summary: "Example model campaign", status: "open" }],
      },
    }, NOW);
    expect(r).toMatchObject({ vinState: "UNKNOWN", publicState: "warning", modelState: "MODEL_CAMPAIGNS_FOUND", modelCampaignCount: 1, openCount: null });
    expect(r.publicStatement).toContain("model line");
  });

  it("is plainly unknown with nothing on record", () => {
    const r = recallSummaryFromRow({ ...usedRow(), ...noRecall() }, NOW);
    expect(r).toMatchObject({ vinState: "UNKNOWN", truthState: "UNKNOWN", publicState: "unknown", modelState: null, checkedAt: null });
    expect(r.freshness.state).toBe("unknown");
  });
});

describe("the bundle", () => {
  it("carries a version and no raw provider material", () => {
    const facts = listingFacts(usedRow(), NOW);
    expect(facts.version).toBe(LISTING_FACTS_VERSION);
    expect(containsForbiddenKey(facts)).toBeNull();
    expect(JSON.stringify(facts)).not.toContain("mc_raw");
  });
});

describe("record_source values observed in production snapshots (2026-10-31)", () => {
  it("does not treat a partial build record as factory build data", () => {
    expect(decodeAuthorityOf("partial_build_specs")).toBe("unknown");
    expect(decodeAuthorityOf("partial_build_oem")).toBe("unknown");
    expect(decodeAuthorityOf("build_specs")).toBe("factory_build");
    expect(decodeAuthorityOf("combined_mc_listing")).toBe("listing_derived");
    expect(decodeAuthorityOf(null)).toBe("unknown");
  });
});

describe("factory verification and the re-promotion cache", () => {
  const sheet = (extra: Record<string, unknown>) => ({
    packages: [], options: [{ name: "Sensory Package" }], key_features: {}, standard: {}, generic: false,
    source: "neovin", request_tier: "neovin_strict", decoded_at: "2026-10-01T00:00:00.000Z",
    taxonomy: { record_source: "build_specs" }, ...extra,
  });
  const row = (bs: Record<string, unknown>) => ({ ...usedRow(), mc_attributes: { ...(usedRow().mc_attributes as Record<string, unknown>), build_sheet: bs } }) as ListingRowLike;

  it("a record_source lifted from the cache is preserved but does not verify the factory build", () => {
    const id = identityFromRow(row(sheet({ repromoted_from: { snapshot_id: "s1", added_keys: ["build_sheet.taxonomy", "taxonomy"] } })), NOW);
    expect(id.recordSource).toBe("build_specs");
    expect(id.decodeAuthority).toBe("factory_build");
    expect(id.recordSourceCached).toBe(true);
    expect(id.factoryVerified).toBe(false);
  });

  it("a live decode that later gained cached extras keeps its own verification", () => {
    const id = identityFromRow(row(sheet({ repromoted_from: { snapshot_id: "s1", added_keys: ["factory_warranty"] } })), NOW);
    expect(id.recordSourceCached).toBe(false);
    expect(id.factoryVerified).toBe(id.matchLevel === "EXACT_VIN");
  });

  it("partial_build_* stays unknown and its raw value is kept", () => {
    const id = identityFromRow(row(sheet({ taxonomy: { record_source: "partial_build_specs" } })), NOW);
    expect(id.recordSource).toBe("partial_build_specs");
    expect(id.decodeAuthority).toBe("unknown");
    expect(id.factoryVerified).toBe(false);
  });
});

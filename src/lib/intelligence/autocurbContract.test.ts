import { describe, it, expect } from "vitest";
import {
  ACQUISITION_FORMULA_KEYS, AUTOCURB_CONTRACT_VERSION, AUTOCURB_RESERVED, buildAutocurbHandoff,
  normalizeHistoryEpisodes, summarizeVinHistory, validateAutocurbHandoff, type AutocurbHandoffParts,
} from "./autocurbContract";
import { unknownFact } from "./contracts";

const NOW = Date.parse("2026-10-28T00:00:00Z");
const VIN = "1ABCD23EFGH456789";
const fresh = { checkedAt: "2026-10-27T00:00:00Z", observedAt: null, ttlDays: 30, staleAt: "2026-11-26T00:00:00.000Z", state: "current" as const };

const parts = (): AutocurbHandoffParts => ({
  vin: VIN,
  identity: {
    vin: VIN, year: 2025, make: "EXAMPLE", model: "MODEL", trim: "TRIM", version: null, drivetrain: "AWD",
    engine: null, transmission: null, exteriorColor: null, interiorColor: null, mileage: 41287,
    matchLevel: "EXACT_VIN", factoryVerified: true, decodeSource: "neovin",
    decodeAuthority: "factory_build", recordSource: "build_oem", providerConfidence: 0.98, providerConfidenceRaw: 98, providerConfidenceScale: "percent_0_100", freshness: fresh,
  },
  mileage: { current: 41287, observedAt: "2026-10-27T00:00:00Z", source: "feed", authority: "provider_listing", chronologyConsistent: true },
  titleOdometer: {
    state: "VERIFIED_NO_ADVERSE_REPORTED", titleBrandsReported: [], junkSalvageTotalLossReported: [], odometerStatus: "consistent",
    readings: [], reportDate: "2026-10-20", checkedAt: "2026-10-20T00:00:00Z",
    publicStatement: "No NMVTIS title brands reported as of 2026-10-20.", entitlementBlocked: false, providerFailed: false, reasons: [], freshness: fresh,
  },
  vinHistory: summarizeVinHistory([], { checkedAt: "2026-10-27T00:00:00Z", ttlDays: 30, nowMs: NOW }),
  condition: { state: "verified", source: "autofilm", inspectionDate: "2026-10-18", tires32nds: [8, 8, 7, 7], brakesMm: [7, 6], openItems: 0, completedRecon: 2, findings: [], reasons: [], freshness: fresh },
  provenance: { designation: "known_since_new", soldHere: true, servicedHere: true, serviceVisits: 12, serviceShare: 0.9, yearsKnown: 3, autofilmInspections: 10, directTrade: true, facts: ["Originally sold here"], source: "dms", freshness: fresh },
  marketValue: {
    algorithmVersion: "market-value-v3.0.0-shadow", estimatedValue: 41900, rangeLow: 41100, rangeHigh: 42700, confidence: "high", confidenceReasons: [],
    qualifiedCompCount: 63, effectiveSampleSize: 22, matchingTier: "A", identityLevel: "EXACT_VIN",
    geography: { zip: "00000", radiusMiles: 100, scope: "local" }, signals: [], providerAgreement: "agree", disagreementPct: 0.01,
    investigationFlagged: false, checkedAt: "2026-10-27T00:00:00Z", freshness: fresh, publishable: false,
  },
  mds: { days: 38, tier: "VIN_EXACT", geography: "local_100mi", sampleSize: 41, checkedAt: "2026-10-27T00:00:00Z" },
  salesStats: { inferredSoldCount: 17, medianLastAdvertisedPrice: 42100, medianDaysToSell: 29, tier: "YMMT", geography: "state", periodDays: 90, checkedAt: "2026-10-01T00:00:00Z", wording: "inferred_sold" },
  trend: { direction: "stable", basis: "none", months: null, checkedAt: null },
  recall: { vinState: "UNKNOWN", truthState: "UNKNOWN", openCount: null, closedCount: null, modelState: null, modelCampaignCount: null, doNotDrive: false, checkedAt: null, publicState: "unknown", publicStatement: "No VIN-level recall check has answered.", freshness: { ...fresh, state: "unknown", checkedAt: null } },
  providerTimestamps: { syndication: "2026-10-27T03:07:00Z", neovin: "2026-09-01T00:00:00Z", history: "2026-10-27T00:00:00Z", mds: "2026-10-27T00:00:00Z", salesStats: "2026-10-01T00:00:00Z", soldSummary: null, recall: null, valuation: "2026-10-27T00:00:00Z", title: "2026-10-20T00:00:00Z" },
});

describe("buildAutocurbHandoff", () => {
  it("assembles a versioned payload that names the reserved capabilities and passes validation", () => {
    const h = buildAutocurbHandoff(parts(), { generatedAt: "2026-10-28T00:00:00Z" });
    expect(h.contractVersion).toBe(AUTOCURB_CONTRACT_VERSION);
    expect(h.reserved.capabilities).toEqual(AUTOCURB_RESERVED);
    expect(AUTOCURB_RESERVED).toEqual(["marketmatch", "marketmatch_dealers", "auction", "fsbo"]);
    expect(validateAutocurbHandoff(h)).toEqual({ ok: true, problems: [] });
  });

  it("carries no acquisition-formula field by type or by key", () => {
    const h = buildAutocurbHandoff(parts(), { generatedAt: "2026-10-28T00:00:00Z" });
    const keys = JSON.stringify(h).toLowerCase();
    for (const k of ACQUISITION_FORMULA_KEYS) expect(keys).not.toContain(`"${k}"`);
    expect(keys).not.toContain("ownercount");
    expect(keys).not.toContain("accidentcount");
  });
});

describe("validateAutocurbHandoff", () => {
  it("refuses a suggested offer, a camel-cased max acquisition, provider raw material and an owner count", () => {
    const base = buildAutocurbHandoff(parts(), { generatedAt: "2026-10-28T00:00:00Z" });
    const withOffer = { ...base, suggested_offer: 39000 } as never;
    expect(validateAutocurbHandoff(withOffer).problems).toContain("acquisition_or_uninferable_key_suggested_offer");
    const withCamel = { ...base, mds: { ...base.mds, recommendedMaxAcquisition: 1 } } as never;
    expect(validateAutocurbHandoff(withCamel).problems[0]).toMatch(/recommendedMaxAcquisition/);
    const withRaw = { ...base, marketValue: { ...base.marketValue, mc_raw: {} } } as never;
    expect(validateAutocurbHandoff(withRaw).problems).toContain("forbidden_key_mc_raw");
    const withOwners = { ...base, vinHistory: { ...base.vinHistory, owner_count: 2 } } as never;
    expect(validateAutocurbHandoff(withOwners).problems).toContain("acquisition_or_uninferable_key_owner_count");
  });

  it("refuses reserved data, an altered reserved list, a bad VIN and the wrong sold wording", () => {
    const base = buildAutocurbHandoff(parts(), { generatedAt: "2026-10-28T00:00:00Z" });
    expect(validateAutocurbHandoff({ ...base, marketmatch: { rank: 1 } } as never).problems).toContain("reserved_data_present_marketmatch");
    expect(validateAutocurbHandoff({ ...base, reserved: { capabilities: ["auction"], note: "" } } as never).problems).toContain("reserved_list_altered");
    expect(validateAutocurbHandoff({ ...base, vin: "SHORT" }).problems).toContain("vin_invalid");
    expect(validateAutocurbHandoff({ ...base, salesStats: { ...base.salesStats, wording: "sold" } } as never).problems).toContain("sales_stats_wording");
  });
});

describe("VIN history normalisation (section 15)", () => {
  const entries = [
    // Epoch seconds for 2026-09-01 and 2026-10-01, as the provider stamps them.
    { price: "31,500", miles: 30100, seller_type: "franchise dealer", inventory_type: "used", source: "siteb.example", first_seen_at: 1788220800, last_seen_at: 1790812800 },
    { listing_price: 32995, mileage: 28000, dealer_type: "independent", car_type: "certified", seller_name: "sitea.example", first_seen: "2026-06-01T00:00:00Z", last_seen: "2026-07-15T00:00:00Z" },
    { price: 30999, odometer: 30900, seller_type: "fsbo", condition: "used", site: "sitea.example", first_seen_at: "2026-10-05T00:00:00Z", last_seen_at: "2026-10-20T00:00:00Z" },
    "not an entry",
  ];

  it("reads the provider's spellings into ordered episodes without owner or accident counts", () => {
    const eps = normalizeHistoryEpisodes(entries);
    expect(eps.map((e) => e.episode)).toEqual([1, 2, 3]);
    expect(eps[0]).toMatchObject({ price: 32995, mileage: 28000, sellerType: "dealer", inventoryType: "certified", source: "sitea.example", firstSeenAt: "2026-06-01T00:00:00.000Z" });
    expect(eps[1]).toMatchObject({ price: 31500, mileage: 30100, sellerType: "dealer", inventoryType: "used", firstSeenAt: "2026-09-01T00:00:00.000Z" });
    expect(eps[2]).toMatchObject({ sellerType: "private", inventoryType: "used" });
    for (const e of eps) {
      expect(Object.keys(e)).not.toContain("ownerCount");
      expect(Object.keys(e)).not.toContain("accidentCount");
    }
  });

  it("summarises chronology, exposure, relisting and a return to the same source", () => {
    const s = summarizeVinHistory(entries, { checkedAt: "2026-10-27T00:00:00Z", ttlDays: 30, nowMs: NOW });
    expect(s.mileageChronology.map((r) => r.mileage)).toEqual([28000, 30100, 30900]);
    expect(s.mileageConflict).toBe(false);
    expect(s.priorMarketExposureDays).toBe(44 + 30 + 15);
    expect(s.relistedCount).toBe(2);
    expect(s.returnedToDealer).toBe(true);
    expect(s.freshness.state).toBe("current");
  });

  it("flags a mileage that goes backwards and reports nothing from nothing", () => {
    const back = summarizeVinHistory([
      { miles: 50000, first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-02-01T00:00:00Z" },
      { miles: 42000, first_seen_at: "2026-05-01T00:00:00Z", last_seen_at: "2026-05-20T00:00:00Z" },
    ], { checkedAt: null, ttlDays: 30, nowMs: NOW });
    expect(back.mileageConflict).toBe(true);
    expect(back.freshness.state).toBe("unknown");
    const empty = summarizeVinHistory(null, { checkedAt: null, ttlDays: 30, nowMs: NOW });
    expect(empty.episodes).toEqual([]);
    expect(empty.priorMarketExposureDays).toBeNull();
    expect(empty.relistedCount).toBeNull();
    expect(empty.returnedToDealer).toBeNull();
    expect(empty.mileageConflict).toBeNull();
    expect(unknownFact("x").state).toBe("unknown");
  });
});

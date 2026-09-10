import { describe, it, expect } from "vitest";
import {
  classifyOwnership, groupKey, rooftopKey, identityConfigIssues,
  tenantIdentityStability, normalizeDealerName,
  type TenantDealerIdentity,
} from "./dealerIdentity.ts";
import { buildMarketView } from "./marketView.ts";
import type { ComparableCandidate, ProviderValuation } from "./types.ts";

// Harte INFINITI as MarketCheck actually describes it: a numeric dealer id, a
// domain, and a group that is only ever named — the provider exposes no
// group_id for it. This is the shape the tenant mapping has to survive.
const HARTE: TenantDealerIdentity = {
  dealerIds: ["1013372"],
  websiteIds: [],
  rooftopIds: [],
  groupIds: [],
  groupNames: ["Harte Auto Group"],
  domains: ["harteinfiniti.com"],
  names: ["Harte Infiniti"],
};

describe("dealer identity — stable identifiers", () => {
  it("matches an exact dealer id", () => {
    const v = classifyOwnership({ dealerId: "1013372", dealerName: "Nothing Alike" }, HARTE);
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("dealer_id");
    expect(v.identityConfidence).toBe("stable");
    expect(v.cautions).toEqual([]);
  });

  it("matches an exact rooftop id", () => {
    const v = classifyOwnership({ rooftopId: "RT-77" }, { ...HARTE, rooftopIds: ["RT-77"] });
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("rooftop_id");
    expect(v.identityConfidence).toBe("stable");
  });

  it("matches an exact group id as own_group, not own_rooftop", () => {
    const v = classifyOwnership({ dealerGroupId: "G-4412" }, { ...HARTE, groupIds: ["G-4412"] });
    expect(v.relation).toBe("own_group");
    expect(v.matchedOn).toBe("dealer_group_id");
    expect(v.identityConfidence).toBe("stable");
  });

  it("matches a domain after normalizing scheme, www and path", () => {
    const v = classifyOwnership({ dealerDomain: "HTTPS://WWW.HarteInfiniti.com/inventory/used" }, HARTE);
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("dealer_domain");
    expect(v.identityConfidence).toBe("stable");
  });

  it("prefers the stable id over a contradicting name", () => {
    // The rooftop id says ours; the name says a competitor. The id wins and the
    // answer is stable, because that is the whole point of having the id.
    const v = classifyOwnership(
      { rooftopId: "RT-77", dealerName: "Completely Different Motors" },
      { ...HARTE, rooftopIds: ["RT-77"] },
    );
    expect(v.matchedOn).toBe("rooftop_id");
    expect(v.identityConfidence).toBe("stable");
  });
});

describe("dealer identity — name fallbacks", () => {
  it("falls back to the dealer name and marks it name_only", () => {
    const v = classifyOwnership({ dealerName: "Harte Infiniti", dealerId: "9999" }, HARTE);
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("dealer_name");
    expect(v.identityConfidence).toBe("name_only");
    expect(v.cautions).toContain("own_rooftop_matched_by_name_only");
  });

  it("falls back to the group name and marks it name_only", () => {
    const v = classifyOwnership(
      { dealerName: "Harte Nissan", dealerGroupName: "Harte Auto Group", dealerId: "1028492" },
      HARTE,
    );
    expect(v.relation).toBe("own_group");
    expect(v.matchedOn).toBe("dealer_group_name");
    expect(v.identityConfidence).toBe("name_only");
    expect(v.cautions).toContain("own_group_matched_by_name_only");
  });

  it("separates our own rooftop from an affiliated group rooftop", () => {
    const own = classifyOwnership({ dealerId: "1013372", dealerGroupName: "Harte Auto Group" }, HARTE);
    const sibling = classifyOwnership({ dealerId: "1028492", dealerGroupName: "Harte Auto Group" }, HARTE);
    expect(own.relation).toBe("own_rooftop");
    expect(sibling.relation).toBe("own_group");
    // Both are excluded from the market, but they are not the same fact and the
    // audit row has to be able to tell them apart.
    expect(own.matchedOn).not.toBe(sibling.matchedOn);
  });

  it("does not match a similar but unrelated dealer name", () => {
    const v = classifyOwnership({ dealerName: "Hartford Toyota", dealerId: "5555" }, HARTE);
    expect(v.relation).toBe("external");
    expect(v.matchedOn).toBeNull();
  });

  it("does not match a similar but unrelated group name", () => {
    const v = classifyOwnership(
      { dealerName: "Hartman Ford", dealerGroupName: "Hartman Automotive Group", dealerId: "5556" },
      HARTE,
    );
    expect(v.relation).toBe("external");
    expect(normalizeDealerName("Hartman Automotive Group")).not.toBe(normalizeDealerName("Harte Auto Group"));
  });

  it("keeps a neighbouring dealer at the same coordinates in the market", () => {
    // Distance is never identity. Dealerships share a plaza and MarketCheck
    // reports them at zero miles from each other; deleting them would remove
    // the competitors a shopper actually cross-shops.
    const v = classifyOwnership(
      { dealerName: "Plaza Kia", dealerId: "7777", distanceMiles: 0 },
      HARTE,
    );
    expect(v.relation).toBe("external");
    expect(v.identityConfidence).toBe("stable");
    expect(v.cautions).toContain("adjacent_rooftop_kept_as_external");
  });
});

describe("dealer identity — names are not identifiers", () => {
  it("counts group names as name_only, never as stable identity", () => {
    expect(tenantIdentityStability({ groupNames: ["Harte Auto Group"] })).toBe("name_only");
    expect(tenantIdentityStability({ names: ["Harte Infiniti"], groupNames: ["Harte Auto Group"] }))
      .toBe("name_only");
    expect(tenantIdentityStability({ groupIds: ["G-4412"] })).toBe("stable");
    expect(tenantIdentityStability(HARTE)).toBe("stable");
    expect(tenantIdentityStability({})).toBe("none");
  });

  it("flags a trading name parked in an identifier field", () => {
    // The failure this catches is silent: compared against dealer.group_id it
    // never matches, yet it still reports the tenant as stably identified.
    expect(identityConfigIssues({ groupIds: ["Harte Auto Group"] }))
      .toContain("group_id_looks_like_a_name:Harte Auto Group");
    expect(identityConfigIssues(HARTE)).toEqual([]);
  });

  it("collapses two rooftops of one named group into a single group key", () => {
    const a = { dealerId: "1013372", dealerGroupName: "Harte Auto Group" };
    const b = { dealerId: "1028492", dealerGroupName: "Harte AUTO Group" };
    expect(groupKey(a)).toBe(groupKey(b));
    expect(rooftopKey(a)).not.toBe(rooftopKey(b));
  });

  it("prefers a real group id over the group name", () => {
    expect(groupKey({ dealerGroupId: "G-4412", dealerGroupName: "Harte Auto Group" })).toBe("G-4412");
  });
});

describe("dealer identity — a name-only tenant cannot reach high confidence", () => {
  const OBSERVED = "2026-09-09T00:00:00.000Z";
  const NOW = Date.parse("2026-09-10T00:00:00.000Z");

  const comps = (): ComparableCandidate[] =>
    [43500, 43900, 44200, 44600, 45100, 45400, 45800].map((price, i) => ({
      vin: `IDENTITYCM${String(i).padStart(7, "0")}`,
      year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
      drivetrain: "AWD", mileage: 12000 + i * 100, price,
      certified: true, docFeeIncluded: false,
      dealerName: `Dealer ${i}`, rooftopId: `rooftop-${i}`, dealerGroupId: `group-${i}`,
      distanceMiles: 20 + i, observedAt: OBSERVED,
      historyStatus: "clean", conditionStatus: "verified",
    }));

  const provider: ProviderValuation = {
    provider: "marketcheck", endpointVersion: "us/marketcheck_price@2026-09",
    selectedField: "marketcheck_price", predictedValue: 44500,
    providerRangeLow: 42275, providerRangeHigh: 46725,
    providerRangeMeaning: "Provider Estimated Range", providerCertifiedEcho: true,
    requestFingerprint: "fp", responseHash: "0000000000000000",
    requestedAt: OBSERVED, receivedAt: OBSERVED, rawResponseSanitized: {},
  };

  const subject = {
    vin: "3PCAJ5FB1SF109999",
    year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
    drivetrain: "AWD", powertrain: null, mileage: 12912, certified: true,
    price: 43876, advertisedPriceBeforeDoc: 42981, websiteSalePrice: 43876,
    docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0,
    dealerType: "franchise" as const, zip: "06120",
  };

  const run = (identity: TenantDealerIdentity) =>
    buildMarketView({ subject, condition: "cpo", candidates: comps(), identity, provider, nowMs: NOW });

  it("reaches high confidence with a stable id and loses it with names alone", () => {
    const stable = run({ rooftopIds: ["own-rooftop"], names: ["Harte Infiniti"] });
    expect(stable.view.confidence).toBe("high");

    const named = run({ names: ["Harte Infiniti"], groupNames: ["Harte Auto Group"] });
    expect(named.view.confidence).not.toBe("high");
    expect(named.view.confidenceReasons).toContain("dealer_identity_name_only");
  });
});

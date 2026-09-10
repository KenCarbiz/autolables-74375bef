import { describe, it, expect } from "vitest";
import {
  providerRequestFingerprint, valuationInputFingerprint, comparableSnapshotHash, decideReuse,
  CONFIDENCE_RULES_VERSION, VERDICT_RULES_VERSION, DEALER_IDENTITY_VERSION,
} from "./fingerprints.ts";
import { buildPredictionRequest } from "./providerAdapter.ts";
import { buildMarketView } from "./marketView.ts";
import type { ComparableCandidate, ProviderValuation } from "./types.ts";

const PROVIDER = {
  provider: "marketcheck", endpointVersion: "us/marketcheck_price@2026-09",
  vin: "3PCAJ5FB1SF109708", miles: 12912, dealerType: "franchise",
  zip: "06120", isCertified: true, requestVersion: "v2.0.0",
};

const VALUATION = {
  algorithmVersion: "v2.0.0-shadow",
  providerRequestFingerprint: "pf",
  providerResponseHash: "rh",
  vehicleComparisonPrice: 42981,
  priceBasisStatus: "verified",
  docFee: 895,
  conditionalDiscounts: null,
  mandatoryDealerAddOns: 0,
  comparableSnapshotHash: "cs",
  dealerIdentityVersion: DEALER_IDENTITY_VERSION,
  similarityVersion: "similarity-v1-shadow",
  confidenceRulesVersion: CONFIDENCE_RULES_VERSION,
  verdictRulesVersion: VERDICT_RULES_VERSION,
};

describe("the provider fingerprint answers only 'may I reuse the paid call'", () => {
  it("is stable for identical provider inputs", () => {
    expect(providerRequestFingerprint(PROVIDER)).toBe(providerRequestFingerprint({ ...PROVIDER }));
  });

  it("moves for every input the provider is actually given", () => {
    for (const patch of [
      { vin: "JN8AZ3CC5T9624253" }, { miles: 13000 }, { dealerType: "independent" },
      { zip: "06001" }, { isCertified: false }, { endpointVersion: "other" },
      { requestVersion: "v3" }, { provider: "other" },
    ]) {
      expect(providerRequestFingerprint({ ...PROVIDER, ...patch }), JSON.stringify(patch))
        .not.toBe(providerRequestFingerprint(PROVIDER));
    }
  });

  it("ignores city and state when a zip is present", () => {
    expect(providerRequestFingerprint({ ...PROVIDER, city: "Hartford", state: "CT" }))
      .toBe(providerRequestFingerprint(PROVIDER));
  });

  it("contains no asking price, so a price change cannot buy the same call twice", () => {
    const built = buildPredictionRequest({
      vin: PROVIDER.vin, mileage: PROVIDER.miles, condition: "cpo",
      dealerType: "franchise", zip: PROVIDER.zip,
    });
    // The adapter's fingerprint is the provider one, computed the same way.
    expect(built.requestFingerprint).toBe(providerRequestFingerprint(PROVIDER));
  });
});

describe("the valuation fingerprint answers 'may I reuse the decision'", () => {
  it("moves when the subject price moves, even though the provider inputs did not", () => {
    const cheaper = valuationInputFingerprint({ ...VALUATION, vehicleComparisonPrice: 41000 });
    expect(cheaper).not.toBe(valuationInputFingerprint(VALUATION));
  });

  it("moves for the fee, conditional money, add-ons and the basis status", () => {
    for (const patch of [
      { docFee: 500 }, { conditionalDiscounts: 1000 }, { mandatoryDealerAddOns: 1495 },
      { priceBasisStatus: "ambiguous" },
    ]) {
      expect(valuationInputFingerprint({ ...VALUATION, ...patch }), JSON.stringify(patch))
        .not.toBe(valuationInputFingerprint(VALUATION));
    }
  });

  it("moves when any rule version moves", () => {
    for (const patch of [
      { algorithmVersion: "x" }, { similarityVersion: "x" }, { confidenceRulesVersion: "x" },
      { verdictRulesVersion: "x" }, { dealerIdentityVersion: "x" },
    ]) {
      expect(valuationInputFingerprint({ ...VALUATION, ...patch }), JSON.stringify(patch))
        .not.toBe(valuationInputFingerprint(VALUATION));
    }
  });

  it("moves when the comparable snapshot moves", () => {
    expect(valuationInputFingerprint({ ...VALUATION, comparableSnapshotHash: "other" }))
      .not.toBe(valuationInputFingerprint(VALUATION));
  });

  it("is never equal to the provider fingerprint it contains", () => {
    expect(valuationInputFingerprint(VALUATION)).not.toBe(VALUATION.providerRequestFingerprint);
    expect(valuationInputFingerprint(VALUATION)).not.toBe(providerRequestFingerprint(PROVIDER));
  });
});

describe("comparable snapshot hash", () => {
  const rows = [
    { vin: "AAA", normalizedVehiclePrice: 1, mileage: 1, certified: true, rooftopKey: "r1", observedAt: "t" },
    { vin: "BBB", normalizedVehiclePrice: 2, mileage: 2, certified: null, rooftopKey: "r2", observedAt: "t" },
  ];
  it("does not care what order the market was discovered in", () => {
    expect(comparableSnapshotHash(rows)).toBe(comparableSnapshotHash([...rows].reverse()));
  });
  it("does care when a comparable changes", () => {
    expect(comparableSnapshotHash([{ ...rows[0], normalizedVehiclePrice: 9 }, rows[1]]))
      .not.toBe(comparableSnapshotHash(rows));
  });
});

describe("reuse decision", () => {
  const base = {
    storedProviderFingerprint: "pf", currentProviderFingerprint: "pf",
    storedValuationFingerprint: "vf", currentValuationFingerprint: "vf",
    providerAgeDays: 2, providerFreshDays: 7, providerHardExpiryDays: 14,
  };

  it("reuses both when nothing changed", () => {
    const r = decideReuse(base);
    expect(r.providerReusable).toBe(true);
    expect(r.valuationReusable).toBe(true);
  });

  it("after a price change: reuse the paid prediction, recompute the decision", () => {
    const r = decideReuse({ ...base, currentValuationFingerprint: "vf2" });
    expect(r.providerReusable).toBe(true);
    expect(r.valuationReusable).toBe(false);
    expect(r.reasons).toContain("valuation_inputs_changed");
  });

  it("does not reuse a prediction when the provider inputs changed", () => {
    const r = decideReuse({ ...base, currentProviderFingerprint: "pf2" });
    expect(r.providerReusable).toBe(false);
    expect(r.reasons).toContain("provider_inputs_changed");
  });

  it("does not reuse an expired prediction", () => {
    expect(decideReuse({ ...base, providerAgeDays: 20 }).providerReusable).toBe(false);
    expect(decideReuse({ ...base, providerAgeDays: null }).providerReusable).toBe(false);
  });

  it("marks a stale-but-usable prediction without refusing it", () => {
    const r = decideReuse({ ...base, providerAgeDays: 10 });
    expect(r.providerReusable).toBe(true);
    expect(r.reasons).toContain("provider_answer_stale_but_usable");
  });
});

describe("the engine publishes both fingerprints", () => {
  const NOW = Date.parse("2026-09-10T00:00:00.000Z");
  const provider: ProviderValuation = {
    provider: "marketcheck", endpointVersion: "us/marketcheck_price@2026-09",
    selectedField: "marketcheck_price", predictedValue: 42000,
    providerRangeLow: null, providerRangeHigh: null, providerRangeMeaning: null,
    providerCertifiedEcho: true, requestFingerprint: "pf", responseHash: "rh",
    requestedAt: "2026-09-09T00:00:00.000Z", receivedAt: "2026-09-09T00:00:00.000Z",
    rawResponseSanitized: {},
  };
  const candidates: ComparableCandidate[] = [41000, 41500, 42000].map((price, i) => ({
    vin: `FPCOMP${String(i).padStart(11, "0")}`,
    year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD",
    mileage: 12500 + i * 100, price, certified: true, docFeeIncluded: false,
    dealerName: `D${i}`, rooftopId: `r${i}`, dealerGroupId: `g${i}`,
    distanceMiles: 20, observedAt: "2026-09-09T00:00:00.000Z",
    historyStatus: "clean", conditionStatus: "verified",
  }));
  const run = (price: number) => buildMarketView({
    subject: {
      vin: "3PCAJ5FB1SF109999", year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
      drivetrain: "AWD", powertrain: null, mileage: 12912, certified: true,
      price, advertisedPriceBeforeDoc: price - 895, websiteSalePrice: price,
      docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0,
      dealerType: "franchise", zip: "06120",
    },
    condition: "cpo", candidates, identity: {}, provider, nowMs: NOW,
  });

  it("carries both, and they differ", () => {
    const { explanation } = run(43876);
    expect(explanation.providerRequestFingerprint).toBe("pf");
    expect(explanation.valuationInputFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(explanation.valuationInputFingerprint).not.toBe(explanation.providerRequestFingerprint);
  });

  it("a price change moves only the valuation fingerprint", () => {
    const a = run(43876).explanation;
    const b = run(41000).explanation;
    expect(b.providerRequestFingerprint).toBe(a.providerRequestFingerprint);
    expect(b.comparableSnapshotHash).toBe(a.comparableSnapshotHash);
    expect(b.valuationInputFingerprint).not.toBe(a.valuationInputFingerprint);
    // And the conclusion is genuinely recomputed, not reused.
    expect(b.verdict.difference).not.toBe(a.verdict.difference);
  });
});

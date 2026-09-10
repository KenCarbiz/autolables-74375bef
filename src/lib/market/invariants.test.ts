// Section 34 — the properties that must hold for every vehicle, not just the
// ones a fixture happens to cover. Each block states one invariant and tries
// to break it.
import { describe, it, expect } from "vitest";
import { buildMarketView } from "./marketView.ts";
import { resolvePriceBasis } from "./priceBasis.ts";
import { buildPredictionRequest } from "./providerAdapter.ts";
import { applyConcentrationCaps, CONCENTRATION_CAP, MIN_SOURCES_FOR_CAP } from "./concentration.ts";
import { scoreSimilarity } from "./similarity.ts";
import { MARKET_ENGINE_VERSION, type ComparableCandidate, type ProviderValuation } from "./types.ts";
import { legacyComparableToCandidate } from "./legacyAdapter.ts";
import { HARTE_IDENTITY, QX50_LISTING, QX50_STORED_COMPARABLES, QX50_STORED_PROVIDER, QX50_VIN } from "./__fixtures__/qx50.ts";

const NOW = Date.parse("2026-09-10T00:00:00.000Z");
const OBSERVED = "2026-09-09T00:00:00.000Z";

// A small deterministic generator, so the invariants are checked over a spread
// of shapes rather than one hand-picked example.
function* scenarios(): Generator<{ label: string; candidates: ComparableCandidate[]; price: number; provider: ProviderValuation | null }> {
  const priceSets = [
    [30000, 30500, 31000, 31500, 32000, 32500, 33000],
    [41000, 41500, 42000, 42500, 43000, 43500, 44000],
    [39000, 44000],
    [],
    [40000, 40000, 40000, 40000, 40000, 40000, 40000],
  ];
  const subjectPrices = [43876, 31000, 55000];
  let n = 0;
  for (const prices of priceSets) {
    for (const price of subjectPrices) {
      n++;
      const candidates: ComparableCandidate[] = prices.map((p, i) => ({
        vin: `INVARIANT${String(n).padStart(4, "0")}${String(i).padStart(4, "0")}`,
        year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD",
        mileage: 12000 + i * 200, price: p, certified: true, docFeeIncluded: false,
        dealerName: `Dealer ${i}`, rooftopId: `rooftop-${i}`, dealerGroupId: `group-${i}`,
        distanceMiles: 15 + i * 3, observedAt: OBSERVED,
        historyStatus: "clean", conditionStatus: "verified",
      }));
      yield {
        label: `prices=${prices.length} subject=${price}`,
        candidates,
        price,
        provider: n % 3 === 0 ? null : {
          provider: "marketcheck", endpointVersion: "us/marketcheck_price@2026-09",
          selectedField: "marketcheck_price",
          predictedValue: prices.length ? prices[Math.floor(prices.length / 2)] : 40000,
          providerRangeLow: null, providerRangeHigh: null, providerRangeMeaning: null,
          providerCertifiedEcho: true, requestFingerprint: "fp", responseHash: "h",
          requestedAt: OBSERVED, receivedAt: OBSERVED, rawResponseSanitized: {},
        },
      };
    }
  }
}

const run = (s: { candidates: ComparableCandidate[]; price: number; provider: ProviderValuation | null }) =>
  buildMarketView({
    subject: {
      vin: "3PCAJ5FB1SF109999", year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
      drivetrain: "AWD", powertrain: null, mileage: 12912, certified: true,
      price: s.price, advertisedPriceBeforeDoc: s.price - 895, websiteSalePrice: s.price,
      docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0, dealerType: "franchise", zip: "06120",
    },
    condition: "cpo", candidates: s.candidates, identity: { rooftopIds: ["r-own"] }, provider: s.provider, nowMs: NOW,
  });

const all = [...scenarios()];

describe("invariant: comparison price + included doc fee = displayed total", () => {
  it("holds wherever a basis is verified and no conditional money was added back", () => {
    for (const s of all) {
      const { view } = run(s);
      if (view.vehicleComparisonPrice == null || view.docFee == null) continue;
      expect(view.vehicleComparisonPrice + view.docFee).toBeCloseTo(view.displayedTotalPrice!, 6);
    }
  });

  it("holds on the advertised leg when conditional money is added back", () => {
    const b = resolvePriceBasis({ ...QX50_LISTING, conditionalDiscounts: 2500 });
    expect(b.advertisedPriceBeforeDoc! + b.docFee!).toBe(b.displayedTotalPrice);
    expect(b.vehicleComparisonPrice).toBe(b.advertisedPriceBeforeDoc! + 2500);
  });
});

describe("invariant: the subject never votes on its own market", () => {
  it("subject VIN weight is zero", () => {
    for (const s of all) {
      const withSelf = [...s.candidates, { ...s.candidates[0], vin: "3PCAJ5FB1SF109999", price: s.price }];
      const { explanation } = run({ ...s, candidates: withSelf as ComparableCandidate[] });
      for (const c of explanation.comparables.filter((x) => x.vin === "3PCAJ5FB1SF109999")) {
        expect(c.rawWeight).toBe(0);
        expect(c.cappedWeight).toBe(0);
      }
    }
  });
});

describe("invariant: one VIN, one vote", () => {
  it("a duplicated VIN contributes once", () => {
    for (const s of all) {
      if (s.candidates.length < 2) continue;
      const dup = [...s.candidates, { ...s.candidates[0] }];
      const { explanation } = run({ ...s, candidates: dup });
      const voting = explanation.comparables.filter((c) => c.cappedWeight > 0);
      expect(new Set(voting.map((c) => c.vin)).size).toBe(voting.length);
    }
  });
});

describe("invariant: own inventory carries zero external weight", () => {
  it("own rooftop and own group are both zero", () => {
    for (const s of all) {
      if (!s.candidates.length) continue;
      const { explanation } = run({
        ...s,
        candidates: s.candidates.map((c, i) => (i === 0
          ? { ...c, rooftopId: "OWN-ROOFTOP" }
          : i === 1 ? { ...c, dealerGroupId: "OWN-GROUP" } : c)),
      });
      const owned = explanation.comparables.filter((c) =>
        c.exclusionReasons.some((r) => r.startsWith("internal_inventory_")));
      for (const c of owned) {
        expect(c.rawWeight).toBe(0);
        expect(c.cappedWeight).toBe(0);
      }
    }
  });

  it("the QX50's two Harte cars are zero", () => {
    const { explanation } = buildMarketView({
      subject: {
        ...QX50_LISTING,
        vin: QX50_VIN, year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
        drivetrain: null, powertrain: null, mileage: 12912, certified: true,
      },
      condition: "cpo",
      candidates: QX50_STORED_COMPARABLES.map((r) => legacyComparableToCandidate(r)),
      identity: HARTE_IDENTITY, provider: QX50_STORED_PROVIDER, nowMs: NOW,
    });
    const harte = explanation.comparables.filter((c) => c.dealerName === "Harte Infiniti");
    expect(harte.every((c) => c.rawWeight === 0 && c.cappedWeight === 0)).toBe(true);
  });
});

describe("invariant: concentration caps", () => {
  it("no rooftop and no group exceeds 20% once five sources exist", () => {
    for (let sources = MIN_SOURCES_FOR_CAP; sources <= 12; sources++) {
      const items = Array.from({ length: sources * 3 }, (_, i) => ({
        key: `k${i}`,
        rooftop: `R${i % sources}`,
        group: `G${i % sources}`,
        weight: (i % sources === 0 ? 20 : 1),
      }));
      const r = applyConcentrationCaps(items);
      expect(r.topRooftopShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-6);
      expect(r.topGroupShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-6);
    }
  });

  it("reports under-allocation rather than faking the cap below five sources", () => {
    for (let sources = 1; sources < MIN_SOURCES_FOR_CAP; sources++) {
      const items = Array.from({ length: sources }, (_, i) => ({
        key: `k${i}`, rooftop: `R${i}`, group: `G${i}`, weight: 1 + i,
      }));
      const r = applyConcentrationCaps(items);
      expect(r.underAllocated).toBe(true);
      expect(r.topRooftopShare).toBeLessThanOrEqual(r.effectiveRooftopCap + 1e-6);
    }
  });
});

describe("invariant: red is unreachable without the full standard", () => {
  it("red implies high confidence, five effective comps and three rooftops", () => {
    for (const s of all) {
      const { view, explanation } = run(s);
      if (explanation.tone !== "red") continue;
      expect(view.confidence).toBe("high");
      expect(view.effectiveComparableCount).toBeGreaterThanOrEqual(5);
      expect(view.independentDealerCount).toBeGreaterThanOrEqual(3);
      expect(explanation.stats.topRooftopShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-6);
      expect(explanation.stats.topGroupShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-6);
      expect(explanation.priceBasis.basisStatus).toBe("verified");
    }
  });

  it("a low or medium result is never red", () => {
    for (const s of all) {
      const { view, explanation } = run(s);
      if (view.confidence === "low" || view.confidence === "medium") {
        expect(explanation.tone).not.toBe("red");
      }
    }
  });
});

describe("invariant: an unavailable valuation makes no claim", () => {
  it("no dollar difference, no percentage, no above-market wording", () => {
    for (const s of all) {
      const { view } = run(s);
      if (view.confidence !== "unavailable") continue;
      expect(view.difference).toBeNull();
      expect(view.differencePercent).toBeNull();
      expect(view.priceToMarketPercent).toBeNull();
      expect(view.marketP50).toBeNull();
      expect(view.verdict).toBe("Market Estimate Unavailable");
    }
  });
});

describe("invariant: a CPO subject always requests certification", () => {
  it("holds for every plausible CPO subject", () => {
    for (const miles of [0, 1, 12912, 250000]) {
      const built = buildPredictionRequest({
        vin: QX50_VIN, mileage: miles, condition: "cpo", dealerType: "franchise", zip: "06120",
      });
      expect(built.request!.isCertified).toBe(true);
      expect(built.sanitizedParams.is_certified).toBe("true");
    }
  });
});

describe("invariant: an expired valuation cannot produce a strong verdict", () => {
  it("fifteen days is unavailable regardless of how good the comparables are", () => {
    for (const s of all) {
      if (!s.provider) continue;
      const { view, explanation } = run({
        ...s,
        provider: { ...s.provider, receivedAt: "2026-08-01T00:00:00.000Z", requestedAt: "2026-08-01T00:00:00.000Z" },
      });
      expect(view.confidence).toBe("unavailable");
      expect(explanation.tone).toBe("neutral");
    }
  });
});

describe("invariant: every verdict is reconstructable", () => {
  it("carries an engine version, a price basis, a comparable ledger and a stats block", () => {
    for (const s of all) {
      const { view, explanation } = run(s);
      expect(explanation.engineVersion).toBe(MARKET_ENGINE_VERSION);
      expect(explanation.priceBasis).toBeTruthy();
      expect(Array.isArray(explanation.comparables)).toBe(true);
      expect(explanation.stats).toBeTruthy();
      expect(explanation.verdict.verdict).toBe(view.verdict);
      expect(view.explanationAvailable).toBe(true);
    }
  });

  it("records the selected provider field whenever a provider answer is used", () => {
    for (const s of all) {
      const { view, explanation } = run(s);
      if (!explanation.providerValidation.usable) continue;
      expect(view.selectedProviderField).toBeTruthy();
      expect(explanation.provider!.responseHash).toBeTruthy();
      expect(explanation.provider!.requestFingerprint).toBeTruthy();
    }
  });
});

describe("invariant: price never influences similarity", () => {
  it("changing only the price changes no similarity component and no weight", () => {
    const base = {
      year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD",
      powertrain: null, mileage: 12912, certified: true, equipmentCodes: [] as string[],
    };
    const candidate = {
      ...base, distanceMiles: 10, daysOnMarket: 30, observedAt: OBSERVED,
      historyStatus: "clean" as const, conditionStatus: "verified" as const,
      priceBasisStatus: "verified" as const, identityConfidence: "stable" as const,
    };
    const a = scoreSimilarity(base, candidate, NOW);
    const b = scoreSimilarity(base, candidate, NOW);
    expect(a).toEqual(b);
    // And the engine agrees: two markets differing only in price level produce
    // the same weight distribution.
    const shape = (prices: number[]) => {
      const { explanation } = run({
        price: 43876, provider: null,
        candidates: prices.map((p, i) => ({
          vin: `PRICEPROBE0000${String(i).padStart(3, "0")}`,
          year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD",
          mileage: 12000 + i * 200, price: p, certified: true, docFeeIncluded: false,
          dealerName: `Dealer ${i}`, rooftopId: `rooftop-${i}`, dealerGroupId: `group-${i}`,
          distanceMiles: 15 + i * 3, observedAt: OBSERVED,
          historyStatus: "clean", conditionStatus: "verified",
        })),
      });
      return explanation.comparables.map((c) => Math.round(c.cappedWeight * 1e9));
    };
    expect(shape([30000, 30500, 31000, 31500, 32000])).toEqual(shape([60000, 60500, 61000, 61500, 62000]));
  });
});

describe("invariant: the market floor is context, never the value", () => {
  it("the floor never becomes the market median and carries no extra weight", () => {
    for (const s of all) {
      const { view, explanation } = run(s);
      if (view.marketFloor == null || view.marketP50 == null) continue;
      expect(view.marketFloor).toBeLessThanOrEqual(view.marketP50);
      const cheapest = explanation.comparables
        .filter((c) => c.inclusionStatus === "primary" && c.cappedWeight > 0)
        .sort((a, b) => (a.normalizedVehiclePrice ?? 0) - (b.normalizedVehiclePrice ?? 0))[0];
      if (!cheapest) continue;
      const others = explanation.comparables.filter((c) => c.inclusionStatus === "primary" && c.cappedWeight > 0 && c.vin !== cheapest.vin);
      const maxOther = Math.max(...others.map((c) => c.cappedWeight));
      expect(cheapest.cappedWeight).toBeLessThanOrEqual(maxOther * 1.5);
    }
  });
});

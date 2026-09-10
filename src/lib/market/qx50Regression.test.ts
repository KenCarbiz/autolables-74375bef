import { describe, it, expect } from "vitest";
import { buildMarketView } from "./marketView.ts";
import { buildPredictionRequest } from "./providerAdapter.ts";
import { resolvePriceBasis } from "./priceBasis.ts";
import { legacyComparableToCandidate } from "./legacyAdapter.ts";
import { trueMedian } from "./statistics.ts";
import { isInternalInventory } from "./comparables.ts";
import {
  HARTE_IDENTITY, QX50_CORRECTED_REQUEST, QX50_CURRENT_UI, QX50_LISTING,
  QX50_STORED_COMPARABLES, QX50_STORED_PROVIDER, QX50_VIN, VAUTO_CPO_EVIDENCE,
} from "./__fixtures__/qx50.ts";

const NOW = Date.parse("2026-09-10T00:00:00.000Z");

const run = (overrides: Partial<Parameters<typeof buildMarketView>[0]> = {}) =>
  buildMarketView({
    subject: {
      vin: QX50_VIN,
      year: QX50_LISTING.year, make: QX50_LISTING.make, model: QX50_LISTING.model,
      trim: QX50_LISTING.trim, drivetrain: null, powertrain: null,
      mileage: QX50_LISTING.mileage, certified: true,
      price: QX50_LISTING.price,
      advertisedPriceBeforeDoc: QX50_LISTING.advertisedPriceBeforeDoc,
      websiteSalePrice: QX50_LISTING.websiteSalePrice,
      docFee: QX50_LISTING.docFee,
      advertisedExcludesDocFee: QX50_LISTING.advertisedExcludesDocFee, mandatoryDealerAddOns: 0,
      dealerType: QX50_LISTING.dealerType,
      zip: QX50_LISTING.zip,
    },
    condition: "cpo",
    candidates: QX50_STORED_COMPARABLES.map((r) => legacyComparableToCandidate(r)),
    identity: HARTE_IDENTITY,
    provider: QX50_STORED_PROVIDER,
    providerSpecs: null,
    nowMs: NOW,
    ...overrides,
  });

describe("QX50 — price basis", () => {
  it("separates the customer total from the vehicle comparison price", () => {
    const b = resolvePriceBasis(QX50_LISTING);
    expect(b.displayedTotalPrice).toBe(43876);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.docFee).toBe(895);
    expect(b.basisStatus).toBe("verified");
  });
});

describe("QX50 — the stored provider answer is quarantined", () => {
  it("is unavailable, not merely fee-corrected", () => {
    const { view, explanation } = run();
    expect(explanation.providerValidation.rejections).toContain("provider_input_mismatch");
    expect(view.confidence).toBe("unavailable");
    expect(view.verdict).toBe("Market Estimate Unavailable");
    expect(explanation.tone).toBe("neutral");
  });

  it("shows neither the current $4,718 nor the fee-corrected $3,823", () => {
    const { view } = run();
    expect(view.difference).toBeNull();
    expect(view.differencePercent).toBeNull();
    expect(view.priceToMarketPercent).toBeNull();
    expect(view.difference).not.toBe(QX50_CURRENT_UI.displayedDifference);
    expect(view.difference).not.toBe(QX50_CURRENT_UI.feeCorrectedDifference);
  });

  it("makes no above-market claim of any kind", () => {
    const { view } = run();
    expect(view.verdict.toLowerCase()).not.toContain("above");
    expect(view.marketP50).toBeNull();
    expect(view.rangeLow).toBeNull();
    expect(view.rangeHigh).toBeNull();
  });

  it("names the reason a person can act on", () => {
    const { view } = run();
    expect(view.confidenceReasons).toContain("provider_provider_input_mismatch");
  });
});

describe("QX50 — the corrected request", () => {
  it("sends is_certified=true and the documented parameters", () => {
    const built = buildPredictionRequest({
      vin: QX50_VIN, mileage: QX50_LISTING.mileage, condition: "cpo",
      dealerType: QX50_LISTING.dealerType, zip: QX50_LISTING.zip,
    });
    expect(built.sanitizedParams).toEqual(QX50_CORRECTED_REQUEST);
  });
});

describe("QX50 — the comparable set", () => {
  it("excludes the subject VIN from any weight", () => {
    const { explanation } = run({
      candidates: [
        ...QX50_STORED_COMPARABLES.map((r) => legacyComparableToCandidate(r)),
        legacyComparableToCandidate({ vin: QX50_VIN, ymm: "2025 INFINITI QX50 SPORT", trim: "Sport", miles: 12912, price: 43876, dist: 0, dealer: "Harte Infiniti", dom: 10 }),
      ],
    });
    const subject = explanation.comparables.find((c) => c.vin === QX50_VIN);
    expect(subject!.exclusionReasons).toContain("subject_vin");
    expect(subject!.cappedWeight).toBe(0);
    expect(subject!.rawWeight).toBe(0);
  });

  it("keeps both Harte cars out of the external market", () => {
    const { explanation } = run();
    const harte = explanation.comparables.filter((c) => c.dealerName === "Harte Infiniti");
    expect(harte).toHaveLength(2);
    for (const car of harte) {
      expect(car.inclusionStatus).toBe("excluded");
      expect(car.exclusionReasons).toContain("internal_inventory_own_rooftop");
      expect(car.rawWeight).toBe(0);
      expect(car.cappedWeight).toBe(0);
      expect(isInternalInventory(car)).toBe(true);
    }
  });

  it("does not fall for the 0.32-mile distance the old exclusion missed", () => {
    // The production rule tested dist === 0. These are 0.32.
    expect(QX50_STORED_COMPARABLES.filter((c) => c.dealer === "Harte Infiniti").every((c) => c.dist !== 0)).toBe(true);
  });

  it("records the Lynbrook concentration", () => {
    const lynbrook = QX50_STORED_COMPARABLES.filter((c) => c.dealer === "Infiniti Of Lynbrook");
    expect(lynbrook).toHaveLength(3);
    const { explanation } = run();
    const stored = explanation.comparables.filter((c) => c.dealerName === "Infiniti Of Lynbrook");
    expect(stored).toHaveLength(3);
  });

  it("stores every comparable certification as unknown, never as false", () => {
    const { explanation } = run();
    for (const c of explanation.comparables.filter((x) => x.vin !== QX50_VIN)) {
      expect(c.certified).toBeNull();
    }
  });

  it("cannot reach a primary tier because CPO comparability is not established", () => {
    const { explanation } = run();
    expect(explanation.winningTier).toBeNull();
    const external = explanation.comparables.filter((c) => c.dealerName !== "Harte Infiniti" && c.vin !== QX50_VIN);
    expect(external.length).toBe(5);
    for (const c of external) {
      expect(c.inclusionStatus).toBe("context_only");
      expect(c.exclusionReasons).toContain("comparable_certification_unknown");
    }
  });

  it("parses each stored heading through the shared parser without a second one", () => {
    const parsed = QX50_STORED_COMPARABLES.map((r) => legacyComparableToCandidate(r));
    for (const c of parsed) {
      expect(c.year).toBe(2025);
      expect(c.make).toBe("INFINITI");
      expect(c.model).toBe("QX50");
    }
  });
});

describe("QX50 — even-length median", () => {
  it("the two mileage-qualified prices average, they do not round up", () => {
    expect(trueMedian([38431, 43876])).toBe(41153.5);
  });

  it("41,153.50 is not the subject's own asking price", () => {
    expect(trueMedian([38431, 43876])).not.toBe(QX50_LISTING.price);
  });
});

describe("QX50 — confidence and red", () => {
  it("never shows red, whatever else changes", () => {
    const { explanation } = run();
    expect(explanation.tone).not.toBe("red");
  });

  it("stays out of red even if the provider answer is withdrawn entirely", () => {
    const { view, explanation } = run({ provider: null });
    expect(explanation.tone).not.toBe("red");
    expect(view.confidence).not.toBe("high");
  });

  it("is still not red once a correctly certified provider answer arrives, because the comparables remain uncertified", () => {
    const { view, explanation } = run({
      provider: { ...QX50_STORED_PROVIDER, providerCertifiedEcho: true, predictedValue: 41800, receivedAt: "2026-09-09T08:10:27.352Z" },
    });
    expect(explanation.providerValidation.usable).toBe(true);
    expect(view.confidence).toBe("low");
    expect(view.verdict).toBe("Limited Market Evidence");
    expect(explanation.tone).toBe("neutral");
  });
});

describe("vAuto validation fixture", () => {
  it("reproduces the supplied arithmetic", () => {
    const midpoint = trueMedian(VAUTO_CPO_EVIDENCE.prices)!;
    expect(midpoint).toBe(VAUTO_CPO_EVIDENCE.midpoint);
    const ptm = (VAUTO_CPO_EVIDENCE.subjectComparisonPrice / midpoint) * 100;
    expect(Math.round(ptm * 10) / 10).toBe(VAUTO_CPO_EVIDENCE.priceToMarketPercent);
    expect(VAUTO_CPO_EVIDENCE.subjectComparisonPrice - Math.max(...VAUTO_CPO_EVIDENCE.prices))
      .toBe(VAUTO_CPO_EVIDENCE.differenceFromHighestComp);
  });

  it("two qualified CPO comparisons are low confidence and never red", () => {
    const { view, explanation } = run({
      candidates: VAUTO_CPO_EVIDENCE.prices.map((price, i) => ({
        vin: `VAUTOCPO00000000${i}`,
        year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
        mileage: VAUTO_CPO_EVIDENCE.mileages[i], price,
        certified: true, dealerName: `Independent CPO Dealer ${i}`,
        rooftopId: `rooftop-${i}`, distanceMiles: 40,
        observedAt: "2026-09-09T00:00:00.000Z",
        docFeeIncluded: false,
      })),
      provider: null,
    });
    expect(view.confidence).toBe("low");
    expect(view.verdict).toBe("Limited Market Evidence");
    expect(explanation.tone).toBe("neutral");
    expect(view.effectiveComparableCount).toBeLessThan(5);
  });
});

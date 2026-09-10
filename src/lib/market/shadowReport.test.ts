import { describe, it, expect } from "vitest";
import { shadowFleet, shadowVehicle, legacyProviderValuation, subjectIdentity, type ShadowListingRow } from "./shadowReport.ts";
import { QX50_LISTING, QX50_STORED_COMPARABLES, QX50_VIN } from "./__fixtures__/qx50.ts";

const NOW = Date.parse("2026-09-10T00:00:00.000Z");
const OPTS = {
  identity: { names: ["Harte Infiniti"] },
  dealerType: "franchise" as const,
  zip: "06120",
  nowMs: NOW,
  providerCallCostUsd: 0.07,
};

const QX50_ROW: ShadowListingRow = {
  vin: QX50_VIN,
  ymm: "2025 INFINITI QX50",
  trim: "Sport",
  condition: "cpo",
  mileage: 12912,
  price: 43876,
  advertised_price_before_doc: 42981,
  website_sale_price: 43876,
  doc_fee: 895,
  advertised_excludes_doc_fee: false,
  market_value: 39158,
  market_position: "above_market",
  market_checked_at: "2026-09-09T08:10:27.352Z",
  market_payload: { low: 37203, high: 41513, raw: { specs: { is_certified: false } } },
  market_meta: { similar_count: 8, like_count: 2 },
  comparables: QX50_STORED_COMPARABLES,
};

describe("subject identity", () => {
  it("prefers stored structured columns", () => {
    expect(subjectIdentity({ ...QX50_ROW, year: 2025, make: "INFINITI", model: "QX50" }))
      .toEqual({ year: 2025, make: "INFINITI", model: "QX50" });
  });

  it("falls back to the shared parser, which knows two-word makes", () => {
    expect(subjectIdentity({ vin: "X", ymm: "2025 INFINITI QX50" }))
      .toEqual({ year: 2025, make: "INFINITI", model: "QX50" });
    expect(subjectIdentity({ vin: "X", ymm: "2024 ALFA ROMEO STELVIO" }).make).toBe("ALFA ROMEO");
  });
});

describe("legacyProviderValuation", () => {
  it("names the legacy endpoint truthfully and carries the certification echo", () => {
    const p = legacyProviderValuation(QX50_ROW)!;
    expect(p.endpointVersion).toBe("legacy/predict/car/price");
    expect(p.providerCertifiedEcho).toBe(false);
    expect(p.predictedValue).toBe(39158);
    expect(p.requestFingerprint).toBe("legacy-unreconstructable");
  });

  it("is null when nothing was stored", () => {
    expect(legacyProviderValuation({ ...QX50_ROW, market_value: null, market_payload: null })).toBeNull();
  });
});

describe("shadowVehicle on the QX50", () => {
  const result = shadowVehicle(QX50_ROW, OPTS);

  it("shows what production shows today", () => {
    expect(result.legacy.displayedDifference).toBe(4718);
    expect(result.legacy.storedPosition).toBe("above_market");
  });

  it("shows what V2 would show instead", () => {
    expect(result.v2.confidence).toBe("unavailable");
    expect(result.v2.verdict).toBe("Market Estimate Unavailable");
    expect(result.v2.difference).toBeNull();
  });

  it("names every defect this vehicle carries", () => {
    expect(result.findings).toContain("cpo_flattened_to_used");
    expect(result.findings).toContain("price_basis_fee_inclusive_comparison");
    expect(result.findings).toContain("own_rooftop_in_market");
    expect(result.findings).toContain("missing_certification_on_comparables");
    expect(result.findings).toContain("provider_request_not_reconstructable");
    expect(result.findings).toContain("contradictory_surface_amounts");  // grid $4,718 vs Passport $3,823
    expect(result.findings).toContain("mandatory_add_on_treatment_unknown");
  });

  it("counts the corrected provider call this vehicle needs", () => {
    expect(result.needsProviderCall).toBe(true);
  });

  it("records the above-market claim as suppressed", () => {
    expect(result.redSuppressed).toBe(true);
    expect(result.verdictChanged).toBe(true);
  });
});

describe("shadowFleet", () => {
  it("aggregates and prices the correction", () => {
    const report = shadowFleet([QX50_ROW], OPTS, "2026-09-10T00:00:00.000Z", "test");
    expect(report.totalEvaluated).toBe(1);
    expect(report.unavailable).toBe(1);
    expect(report.providerCallsRequired).toBe(1);
    expect(report.providerBudgetUsd).toBeCloseTo(0.07, 2);
    expect(report.findingCounts.cpo_flattened_to_used).toBe(1);
  });

  it("reports an unconfigured dealer type as a blocker rather than assuming one", () => {
    const report = shadowFleet([QX50_ROW], { ...OPTS, dealerType: null }, "2026-09-10T00:00:00.000Z", "test");
    expect(report.blockedByConfiguration.some((b) => b.includes("dealer_type"))).toBe(true);
    expect(report.providerCallsRequired).toBe(0);
  });

  it("flags a tenant with no stable dealer identity", () => {
    const report = shadowFleet([QX50_ROW], { ...OPTS, identity: { names: ["Harte Infiniti"] } }, "2026-09-10T00:00:00.000Z", "test");
    expect(report.blockedByConfiguration.some((b) => b.includes("stable dealer identity"))).toBe(true);
  });

  it("writes nothing: the report is a pure function of its input", () => {
    const snapshot = JSON.stringify(QX50_ROW);
    shadowFleet([QX50_ROW], OPTS, "2026-09-10T00:00:00.000Z", "test");
    expect(JSON.stringify(QX50_ROW)).toBe(snapshot);
  });
});

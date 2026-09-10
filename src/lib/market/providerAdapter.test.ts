import { describe, it, expect } from "vitest";
import {
  MARKETCHECK_PREDICT_PATH, MARKETCHECK_ENDPOINT_VERSION,
  buildPredictionRequest, parsePredictionResponse, predictionUrl,
  readCertifiedEcho, readHistoryFlag, resolveDealerType, sanitizeForAudit,
  validateProviderValuation, isCertifiedForCondition,
} from "./providerAdapter.ts";

const NOW = Date.parse("2026-09-10T00:00:00.000Z");

const HARTE_QX50 = {
  vin: "3PCAJ5FB1SF109708",
  mileage: 12912,
  condition: "cpo" as const,
  dealerType: "franchise" as const,
  zip: "06120",
};

const parse = (body: unknown, receivedAt = "2026-09-09T08:10:27.352Z") =>
  parsePendingResponse(body, receivedAt);

const parsePendingResponse = (body: unknown, receivedAt: string) =>
  parsePredictionResponse({
    body,
    requestFingerprint: "fingerprint",
    requestedAt: receivedAt,
    receivedAt,
  });

describe("request building — the QX50 certification fix", () => {
  it("sends is_certified=true for a CPO subject", () => {
    const built = buildPredictionRequest(HARTE_QX50);
    expect(built.blockers).toEqual([]);
    expect(built.request).toEqual({
      vin: "3PCAJ5FB1SF109708",
      miles: 12912,
      dealerType: "franchise",
      zip: "06120",
      isCertified: true,
      subjectCondition: "cpo",
      requestVersion: "v2.0.0",
    });
    expect(built.sanitizedParams).toEqual({
      vin: "3PCAJ5FB1SF109708", miles: "12912", dealer_type: "franchise",
      is_certified: "true", zip: "06120",
    });
  });

  it("uses the documented US endpoint, not the legacy predict path", () => {
    expect(MARKETCHECK_PREDICT_PATH).toBe("/v2/predict/car/us/marketcheck_price");
    expect(buildPredictionRequest(HARTE_QX50).path).toBe(MARKETCHECK_PREDICT_PATH);
  });

  it("never emits a car_type parameter in place of certification", () => {
    const params = buildPredictionRequest(HARTE_QX50).sanitizedParams;
    expect(Object.keys(params)).not.toContain("car_type");
    expect(params.is_certified).toBe("true");
  });

  it("sends is_certified=false for ordinary used and for new", () => {
    expect(isCertifiedForCondition("used")).toBe(false);
    expect(isCertifiedForCondition("new")).toBe(false);
    expect(isCertifiedForCondition("cpo")).toBe(true);
    expect(buildPredictionRequest({ ...HARTE_QX50, condition: "used" }).sanitizedParams.is_certified).toBe("false");
  });

  it("keeps the api key out of the fingerprint and the stored params", () => {
    const built = buildPredictionRequest(HARTE_QX50);
    expect(JSON.stringify(built.sanitizedParams)).not.toContain("api_key");
    const url = predictionUrl("https://api.marketcheck.com", built.sanitizedParams, "SECRET123");
    expect(url).toContain("api_key=SECRET123");
    expect(built.requestFingerprint).not.toContain("SECRET123");
  });

  it("is stable: the same subject fingerprints identically", () => {
    expect(buildPredictionRequest(HARTE_QX50).requestFingerprint)
      .toBe(buildPredictionRequest({ ...HARTE_QX50 }).requestFingerprint);
  });

  it("changes fingerprint when certification changes", () => {
    expect(buildPredictionRequest(HARTE_QX50).requestFingerprint)
      .not.toBe(buildPredictionRequest({ ...HARTE_QX50, condition: "used" }).requestFingerprint);
  });
});

describe("request building — blockers", () => {
  it("blocks an invalid VIN", () => {
    expect(buildPredictionRequest({ ...HARTE_QX50, vin: "NOTAVIN" }).blockers).toContain("invalid_vin");
  });
  it("blocks missing and implausible mileage", () => {
    expect(buildPredictionRequest({ ...HARTE_QX50, mileage: null }).blockers).toContain("missing_mileage");
    expect(buildPredictionRequest({ ...HARTE_QX50, mileage: 900000 }).blockers).toContain("implausible_mileage");
  });
  it("blocks a missing dealer type rather than defaulting to franchise", () => {
    const built = buildPredictionRequest({ ...HARTE_QX50, dealerType: null });
    expect(built.blockers).toContain("missing_dealer_type");
    expect(built.request).toBeNull();
  });
  it("blocks a missing location, and accepts city+state instead of zip", () => {
    expect(buildPredictionRequest({ ...HARTE_QX50, zip: null }).blockers).toContain("missing_location");
    const built = buildPredictionRequest({ ...HARTE_QX50, zip: null, city: "Hartford", state: "CT" });
    expect(built.blockers).toEqual([]);
    expect(built.sanitizedParams.city).toBe("Hartford");
  });
});

describe("resolveDealerType", () => {
  it("reads a configured dealer type", () => {
    expect(resolveDealerType({ dealer_type: "independent" })).toBe("independent");
  });
  it("returns null rather than guessing", () => {
    expect(resolveDealerType(null)).toBeNull();
    expect(resolveDealerType({})).toBeNull();
    expect(resolveDealerType({ dealer_type: "Franchise" })).toBeNull();
  });
});

describe("response parsing", () => {
  it("reads the current marketcheck_price field", () => {
    const { valuation } = parse({ marketcheck_price: 39158, price_range: { lower_bound: 37203, upper_bound: 41513 } });
    expect(valuation!.selectedField).toBe("marketcheck_price");
    expect(valuation!.predictedValue).toBe(39158);
    expect(valuation!.providerRangeLow).toBe(37203);
    expect(valuation!.providerRangeHigh).toBe(41513);
    expect(valuation!.providerRangeMeaning).toBe("Provider Estimated Range");
    expect(valuation!.endpointVersion).toBe(MARKETCHECK_ENDPOINT_VERSION);
  });

  it("falls back to the legacy predicted_price field", () => {
    const { valuation } = parse({ predicted_price: 39158 });
    expect(valuation!.selectedField).toBe("predicted_price");
    expect(valuation!.predictedValue).toBe(39158);
  });

  it("prefers the current field when both are present", () => {
    const { valuation } = parse({ marketcheck_price: 40000, predicted_price: 39158 });
    expect(valuation!.selectedField).toBe("marketcheck_price");
    expect(valuation!.predictedValue).toBe(40000);
  });

  it("supports each documented fallback field", () => {
    expect(parse({ price: 1000 }).valuation!.selectedField).toBe("price");
    expect(parse({ market_price: 1000 }).valuation!.selectedField).toBe("market_price");
    expect(parse({ mean_price: 1000 }).valuation!.selectedField).toBe("mean_price");
    expect(parse({ price_stats: { mean: 1000 } }).valuation!.selectedField).toBe("price_stats.mean");
  });

  it("rejects a malformed, missing or non-positive prediction", () => {
    for (const body of [null, undefined, "nope", [], {}, { marketcheck_price: 0 }, { marketcheck_price: -5 }]) {
      const r = parse(body);
      expect(r.valuation).toBeNull();
      expect(r.parseErrors.length).toBeGreaterThan(0);
    }
  });

  it("drops an inverted range rather than presenting it", () => {
    const r = parse({ marketcheck_price: 39158, price_range: { lower_bound: 41513, upper_bound: 37203 } });
    expect(r.parseErrors).toContain("inverted_range");
    expect(r.valuation!.providerRangeLow).toBeNull();
    expect(r.valuation!.providerRangeHigh).toBeNull();
  });

  it("records a missing range without failing", () => {
    const { valuation } = parse({ marketcheck_price: 39158 });
    expect(valuation!.providerRangeLow).toBeNull();
    expect(valuation!.providerRangeMeaning).toBeNull();
  });

  it("never records a null provider or an empty response hash", () => {
    const { valuation } = parse({ marketcheck_price: 39158 });
    expect(valuation!.provider).toBe("marketcheck");
    expect(valuation!.responseHash).toMatch(/^[0-9a-f]{16}$/);
    expect(valuation!.requestFingerprint).toBe("fingerprint");
  });

  it("keeps secrets out of the stored response", () => {
    const { valuation } = parse({ marketcheck_price: 39158, api_key: "SECRET", meta: { Authorization: "Bearer x", ok: 1 } });
    const stored = JSON.stringify(valuation!.rawResponseSanitized);
    expect(stored).not.toContain("SECRET");
    expect(stored).not.toContain("Bearer");
    expect(valuation!.rawResponseSanitized.meta).toEqual({ ok: 1 });
  });
});

describe("sanitizeForAudit", () => {
  it("strips every credential-shaped key at any depth", () => {
    const clean = sanitizeForAudit({ apiKey: "x", nested: { api_key: "y", token: "z", keep: 1 } });
    expect(clean).toEqual({ nested: { keep: 1 } });
  });
  it("returns an object for non-object input", () => {
    expect(sanitizeForAudit("string")).toEqual({});
    expect(sanitizeForAudit(null)).toEqual({});
  });
});

describe("certification echo and history flags", () => {
  it("reads three states, and a missing echo is null not false", () => {
    expect(readCertifiedEcho({ specs: { is_certified: false } })).toBe(false);
    expect(readCertifiedEcho({ is_certified: true })).toBe(true);
    expect(readCertifiedEcho({})).toBeNull();
  });

  it("never turns a false history flag into proven damage", () => {
    expect(readHistoryFlag(false)).toBe("unknown");
    expect(readHistoryFlag(undefined)).toBe("unknown");
    expect(readHistoryFlag(null)).toBe("unknown");
    expect(readHistoryFlag(true)).toBe(true);
  });
});

describe("validation — the QX50 quarantine", () => {
  const built = buildPredictionRequest(HARTE_QX50);

  it("quarantines the stored response that priced a CPO car as non-certified", () => {
    const { valuation } = parse({ marketcheck_price: 39158, specs: { is_certified: false } });
    const v = validateProviderValuation({ subject: HARTE_QX50, built, valuation, nowMs: NOW });
    expect(v.usable).toBe(false);
    expect(v.rejections).toContain("provider_input_mismatch");
  });

  it("accepts a correctly certified answer", () => {
    const { valuation } = parse({ marketcheck_price: 41800, specs: { is_certified: true } });
    const v = validateProviderValuation({ subject: HARTE_QX50, built, valuation, nowMs: NOW });
    expect(v.usable).toBe(true);
    expect(v.rejections).toEqual([]);
  });

  it("does not quarantine a correct request merely because the endpoint does not echo", () => {
    const { valuation } = parse({ marketcheck_price: 41800 });
    const v = validateProviderValuation({ subject: HARTE_QX50, built, valuation, nowMs: NOW });
    expect(v.usable).toBe(true);
    expect(v.cautions).toContain("provider_did_not_echo_certification");
  });

  it("flags a non-CPO subject answered as certified", () => {
    const usedSubject = { ...HARTE_QX50, condition: "used" as const };
    const usedBuilt = buildPredictionRequest(usedSubject);
    const { valuation } = parse({ marketcheck_price: 39158, specs: { is_certified: true } });
    const v = validateProviderValuation({ subject: usedSubject, built: usedBuilt, valuation, nowMs: NOW });
    expect(v.rejections).toContain("provider_certification_conflict");
  });

  it("rejects a response about a different VIN", () => {
    const { valuation } = parse({ marketcheck_price: 39158 });
    const v = validateProviderValuation({
      subject: HARTE_QX50, built, valuation, nowMs: NOW,
      providerSpecs: { vin: "1FTFW1E50MFA00000" },
    });
    expect(v.rejections).toContain("specification_conflict");
  });

  it("rejects a response about a different model", () => {
    const { valuation } = parse({ marketcheck_price: 39158 });
    const v = validateProviderValuation({
      subject: HARTE_QX50, built, valuation, nowMs: NOW,
      providerSpecs: { make: "INFINITI", model: "QX60" }, subjectMake: "INFINITI", subjectModel: "QX50",
    });
    expect(v.rejections).toContain("specification_conflict");
  });

  it("expires a response past the hard TTL and cautions past the fresh TTL", () => {
    const fresh = parse({ marketcheck_price: 39158, specs: { is_certified: true } }, "2026-09-09T00:00:00.000Z");
    expect(validateProviderValuation({ subject: HARTE_QX50, built, valuation: fresh.valuation, nowMs: NOW }).usable).toBe(true);

    const aging = parse({ marketcheck_price: 39158, specs: { is_certified: true } }, "2026-09-01T00:00:00.000Z");
    const agingV = validateProviderValuation({ subject: HARTE_QX50, built, valuation: aging.valuation, nowMs: NOW });
    expect(agingV.usable).toBe(true);
    expect(agingV.cautions).toContain("provider_answer_older_than_seven_days");

    const dead = parse({ marketcheck_price: 39158, specs: { is_certified: true } }, "2026-08-01T00:00:00.000Z");
    expect(validateProviderValuation({ subject: HARTE_QX50, built, valuation: dead.valuation, nowMs: NOW }).rejections)
      .toContain("stale_response");
  });

  it("propagates request blockers into the validation", () => {
    const noType = buildPredictionRequest({ ...HARTE_QX50, dealerType: null });
    const v = validateProviderValuation({
      subject: { ...HARTE_QX50, dealerType: null }, built: noType, valuation: null, nowMs: NOW,
    });
    expect(v.usable).toBe(false);
    expect(v.rejections).toContain("missing_dealer_type");
  });

  it("cautions when a fallback field supplied the prediction", () => {
    const { valuation } = parse({ predicted_price: 39158, specs: { is_certified: true } });
    const v = validateProviderValuation({ subject: HARTE_QX50, built, valuation, nowMs: NOW });
    expect(v.cautions).toContain("provider_field_fallback_predicted_price");
  });
});

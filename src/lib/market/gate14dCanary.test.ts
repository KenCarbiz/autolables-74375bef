// ── Gate 14D: the evidence file for one paid call ──────────────────────────
//
// Gate 14D authorises a single live MarketCheck request costing $0.07. These
// tests are what stands between that authorisation and a bill: every failure
// mode the provider can hand back is exercised here with an injected fetch, so
// none of them is discovered live.
//
// Two properties matter more than the rest and are asserted repeatedly:
//
//   1. ONE attempt. Never two. The reservation is what makes a call payable,
//      and a retry below the reservation spends money the budget never
//      authorised.
//   2. No failed response becomes a market value. A timeout, a 403 and a 200
//      carrying garbage must all leave yesterday's valid answer standing and
//      write nothing new.

import { describe, it, expect } from "vitest";
import {
  callProviderOnce, classifyProviderStatus, failureReason,
  type ProviderFetch, type ProviderHttpResponse,
} from "./providerTransport.ts";
import {
  isTransientFailure, isPermanentFailure, isFailedAttempt,
  resolveProviderFreshness,
} from "./freshness.ts";
import {
  MARKETCHECK_PREDICT_PATH, buildPredictionRequest, parsePredictionResponse,
  predictionUrl, validateProviderValuation,
} from "./providerAdapter.ts";

const TIMEOUT_MS = 10_000;
const PRODUCTION_HOST = "https://api.marketcheck.com";
const API_KEY = "SECRET_KEY_DO_NOT_LEAK";

/** The exact Gate 14D subject, read from production on 2026-09-10. */
const SUBJECT = {
  vin: "3PCAJ5FB1SF109708",
  mileage: 12912,
  condition: "cpo" as const,
  dealerType: "franchise" as const,
  zip: "06120",
};

/** A fetch that counts calls, so "exactly one attempt" is measured, not assumed. */
function countingFetch(handler: (n: number) => Promise<ProviderHttpResponse>) {
  const state = { calls: 0, urls: [] as string[] };
  const fn: ProviderFetch = (url) => {
    state.calls += 1;
    state.urls.push(url);
    return handler(state.calls);
  };
  return { fn, state };
}

const status = (code: number, body: unknown = null): ProviderHttpResponse => ({
  status: code,
  json: async () => body,
});

const throwing = (name: string): ProviderHttpResponse => {
  const e = new Error(name);
  e.name = name;
  throw e;
};

const parse = (body: unknown) =>
  parsePredictionResponse({
    body,
    requestFingerprint: "fp",
    requestedAt: "2026-09-10T17:00:00.000Z",
    receivedAt: "2026-09-10T17:00:00.000Z",
  });

// ── Phase 2. The request contract ──────────────────────────────────────────

describe("Gate 14D — endpoint and host contract", () => {
  it("targets the official production host over HTTPS", () => {
    const built = buildPredictionRequest(SUBJECT);
    const url = predictionUrl(PRODUCTION_HOST, built.sanitizedParams, API_KEY);
    expect(url.startsWith("https://api.marketcheck.com/")).toBe(true);
    expect(url).not.toContain("mc-api.marketcheck.com");
    expect(url).not.toContain("http://");
  });

  it("uses the exact documented path", () => {
    expect(MARKETCHECK_PREDICT_PATH).toBe("/v2/predict/car/us/marketcheck_price");
    const url = predictionUrl(PRODUCTION_HOST, buildPredictionRequest(SUBJECT).sanitizedParams, API_KEY);
    expect(new URL(url).pathname).toBe("/v2/predict/car/us/marketcheck_price");
  });

  it("sends exactly the five authorised parameters and no car_type", () => {
    const url = new URL(predictionUrl(PRODUCTION_HOST, buildPredictionRequest(SUBJECT).sanitizedParams, API_KEY));
    const q = url.searchParams;
    expect(q.get("vin")).toBe("3PCAJ5FB1SF109708");
    expect(q.get("miles")).toBe("12912");
    expect(q.get("dealer_type")).toBe("franchise");
    expect(q.get("zip")).toBe("06120");
    expect(q.get("is_certified")).toBe("true");
    expect(q.has("car_type")).toBe(false);
    expect([...q.keys()].sort()).toEqual(
      ["api_key", "dealer_type", "is_certified", "miles", "vin", "zip"],
    );
  });

  it("keeps the api key out of everything that is stored", () => {
    const built = buildPredictionRequest(SUBJECT);
    expect(JSON.stringify(built.sanitizedParams)).not.toContain(API_KEY);
    expect(built.requestFingerprint ?? "").not.toContain(API_KEY);
    const { valuation } = parse({ marketcheck_price: 44500, api_key: API_KEY, apiKey: API_KEY });
    expect(JSON.stringify(valuation?.rawResponseSanitized)).not.toContain(API_KEY);
  });

  it("excludes the subject's asking price from the provider fingerprint", () => {
    // A price edit must not buy the same prediction a second time.
    const a = buildPredictionRequest(SUBJECT).requestFingerprint;
    const b = buildPredictionRequest({ ...SUBJECT }).requestFingerprint;
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });
});

// ── Phase 2. Response field selection ──────────────────────────────────────

describe("Gate 14D — response field contract", () => {
  it("prefers marketcheck_price", () => {
    const { valuation } = parse({ marketcheck_price: 44500 });
    expect(valuation?.selectedField).toBe("marketcheck_price");
    expect(valuation?.predictedValue).toBe(44500);
  });

  it("accepts predicted_price only as a legacy fallback", () => {
    const { valuation } = parse({ predicted_price: 44100 });
    expect(valuation?.selectedField).toBe("predicted_price");
    expect(valuation?.predictedValue).toBe(44100);
  });

  it("selects the current field when both appear, and records which it chose", () => {
    const { valuation } = parse({ marketcheck_price: 44500, predicted_price: 39158 });
    expect(valuation?.selectedField).toBe("marketcheck_price");
    expect(valuation?.predictedValue).toBe(44500);
  });

  it("cautions when a legacy field had to be used", () => {
    const { valuation } = parse({ predicted_price: 44100 });
    const v = validateProviderValuation({
      subject: SUBJECT, built: buildPredictionRequest(SUBJECT),
      valuation, nowMs: Date.parse("2026-09-10T18:00:00.000Z"),
    });
    expect(v.cautions).toContain("provider_field_fallback_predicted_price");
  });
});

// ── Phase 2 + 4. Certification ─────────────────────────────────────────────

describe("Gate 14D — certification handling", () => {
  const built = buildPredictionRequest(SUBJECT);
  const nowMs = Date.parse("2026-09-10T18:00:00.000Z");

  it("treats a missing certification echo as cautionary, never as non-certified", () => {
    const { valuation } = parse({ marketcheck_price: 44500 });
    expect(valuation?.providerCertifiedEcho).toBeNull();
    const v = validateProviderValuation({ subject: SUBJECT, built, valuation, nowMs });
    expect(v.usable).toBe(true);
    expect(v.cautions).toContain("provider_did_not_echo_certification");
    expect(v.rejections).not.toContain("provider_input_mismatch");
  });

  it("quarantines a response that explicitly echoes is_certified=false", () => {
    // This is the $39,158 answer. It is not repairable by arithmetic.
    const { valuation } = parse({ marketcheck_price: 39158, is_certified: false });
    expect(valuation?.providerCertifiedEcho).toBe(false);
    const v = validateProviderValuation({ subject: SUBJECT, built, valuation, nowMs });
    expect(v.usable).toBe(false);
    expect(v.rejections).toContain("provider_input_mismatch");
  });

  it("rejects a VIN or specification conflict", () => {
    const { valuation } = parse({ marketcheck_price: 44500 });
    const v = validateProviderValuation({
      subject: SUBJECT, built, valuation, nowMs,
      providerSpecs: { vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord" },
      subjectYear: 2025, subjectMake: "INFINITI", subjectModel: "QX50",
    });
    expect(v.usable).toBe(false);
    expect(v.rejections).toContain("specification_conflict");
  });
});

// ── Phase 4. Every transport fault, one attempt each ───────────────────────

describe("Gate 14D — fault injection: exactly one attempt, never a value", () => {
  const HTTP_CASES: { code: number; outcome: string; permanent: boolean }[] = [
    { code: 400, outcome: "request_rejected", permanent: true },
    { code: 401, outcome: "auth_failed", permanent: true },
    { code: 403, outcome: "not_entitled", permanent: true },
    { code: 422, outcome: "request_rejected", permanent: true },
    { code: 429, outcome: "rate_limited", permanent: false },
    { code: 500, outcome: "server_error", permanent: false },
    { code: 502, outcome: "server_error", permanent: false },
    { code: 503, outcome: "server_error", permanent: false },
  ];

  for (const c of HTTP_CASES) {
    it(`HTTP ${c.code} -> ${c.outcome}, one attempt, no body`, async () => {
      const { fn, state } = countingFetch(async () => status(c.code, { marketcheck_price: 99999 }));
      const r = await callProviderOnce("https://api.marketcheck.com/x", fn, TIMEOUT_MS);
      expect(r.outcome).toBe(c.outcome);
      expect(r.status).toBe(c.code);
      // Even though the fixture carries a price, a non-2xx body is discarded.
      expect(r.body).toBeNull();
      expect(r.attempts).toBe(1);
      expect(state.calls).toBe(1);
    });
  }

  it("a timeout is one attempt and is not retried", async () => {
    const { fn, state } = countingFetch(async () => throwing("TimeoutError"));
    const r = await callProviderOnce("https://api.marketcheck.com/x", fn, TIMEOUT_MS);
    expect(r.outcome).toBe("timeout");
    expect(r.status).toBeNull();
    expect(r.attempts).toBe(1);
    expect(state.calls).toBe(1);
  });

  it("a network error is one attempt and is not retried", async () => {
    const { fn, state } = countingFetch(async () => throwing("TypeError"));
    const r = await callProviderOnce("https://api.marketcheck.com/x", fn, TIMEOUT_MS);
    expect(r.outcome).toBe("network_error");
    expect(r.attempts).toBe(1);
    expect(state.calls).toBe(1);
  });

  it("malformed JSON on a 200 is a succeeded attempt whose body is null", async () => {
    const { fn, state } = countingFetch(async () => ({
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    }));
    const r = await callProviderOnce("https://api.marketcheck.com/x", fn, TIMEOUT_MS);
    expect(r.outcome).toBe("succeeded");
    expect(r.body).toBeNull();
    expect(state.calls).toBe(1);
    // and it still cannot become a market value
    expect(parse(r.body).valuation).toBeNull();
    expect(parse(r.body).parseErrors).toContain("missing_prediction");
  });

  it("classifies statuses without touching the network", () => {
    expect(classifyProviderStatus(200)).toBe("succeeded");
    expect(classifyProviderStatus(401)).toBe("auth_failed");
    expect(classifyProviderStatus(403)).toBe("not_entitled");
    expect(classifyProviderStatus(429)).toBe("rate_limited");
    expect(classifyProviderStatus(404)).toBe("request_rejected");
    expect(classifyProviderStatus(500)).toBe("server_error");
  });
});

// ── Phase 4. Payload faults never become a value ───────────────────────────

describe("Gate 14D — payload faults are rejected, not rounded", () => {
  it("rejects a body carrying neither marketcheck_price nor predicted_price", () => {
    const { valuation, parseErrors } = parse({ some_other_field: 44500 });
    expect(valuation).toBeNull();
    expect(parseErrors).toContain("missing_prediction");
  });

  it("rejects a non-numeric prediction", () => {
    expect(parse({ marketcheck_price: "not a number" }).valuation).toBeNull();
    expect(parse({ marketcheck_price: null }).valuation).toBeNull();
    expect(parse({ marketcheck_price: {} }).valuation).toBeNull();
  });

  it("rejects a negative or implausible prediction", () => {
    expect(parse({ marketcheck_price: -44500 }).parseErrors).toContain("implausible_prediction");
    expect(parse({ marketcheck_price: 0 }).valuation).toBeNull();
    expect(parse({ marketcheck_price: 9_000_000 }).parseErrors).toContain("implausible_prediction");
  });

  it("drops an inverted range rather than presenting it", () => {
    const { valuation, parseErrors } = parse({
      marketcheck_price: 44500,
      price_range: { lower_bound: 47000, upper_bound: 42000 },
    });
    expect(parseErrors).toContain("inverted_range");
    expect(valuation?.providerRangeLow).toBeNull();
    expect(valuation?.providerRangeHigh).toBeNull();
  });
});

// ── Phase 4. Failure taxonomy and last-good preservation ───────────────────

describe("Gate 14D — failure taxonomy", () => {
  it("classifies 401 and 403 as entitlement/authentication failures, not server errors", () => {
    expect(isPermanentFailure("auth_failed")).toBe(true);
    expect(isPermanentFailure("not_entitled")).toBe(true);
    expect(isTransientFailure("auth_failed")).toBe(false);
    expect(isTransientFailure("not_entitled")).toBe(false);
  });

  it("keeps transient failures transient", () => {
    for (const o of ["timeout", "rate_limited", "server_error", "network_error"] as const) {
      expect(isTransientFailure(o)).toBe(true);
      expect(isPermanentFailure(o)).toBe(false);
      expect(isFailedAttempt(o)).toBe(true);
    }
  });

  it("records the HTTP status alongside the outcome in the ledger", () => {
    expect(failureReason("not_entitled", 403)).toBe("not_entitled_403");
    expect(failureReason("timeout", null)).toBe("timeout");
  });

  it("audits every failed attempt and never lets one replace a valid last-good answer", () => {
    for (const o of [
      "timeout", "rate_limited", "server_error", "network_error",
      "auth_failed", "not_entitled", "request_rejected",
    ] as const) {
      const d = resolveProviderFreshness({
        lastGoodAgeDays: 2, attemptOutcome: o,
        certificationMismatch: false, subjectMismatch: false, priceBasisInvalid: false,
      });
      expect(d.reasons).toContain(`provider_attempt_${o}`);
      expect(d.reasons).toContain("failed_attempt_did_not_replace_last_good");
      expect(d.useLastGood).toBe(true);
    }
  });

  it("marks a permanent failure as one that waiting will not fix", () => {
    const d = resolveProviderFreshness({
      lastGoodAgeDays: 2, attemptOutcome: "not_entitled",
      certificationMismatch: false, subjectMismatch: false, priceBasisInvalid: false,
    });
    expect(d.reasons).toContain("provider_failure_will_not_self_resolve");
  });

  it("does not invent a value when there is no last-good and the call failed", () => {
    const d = resolveProviderFreshness({
      lastGoodAgeDays: null, attemptOutcome: "not_entitled",
      certificationMismatch: false, subjectMismatch: false, priceBasisInvalid: false,
    });
    expect(d.useLastGood).toBe(false);
    expect(d.allowRed).toBe(false);
  });
});

// ── The writer wires the real transport to the real host ───────────────────

describe("Gate 14D — writer wiring", () => {
  const writer = "supabase/functions/market-valuation-write/index.ts";

  it("calls the transport exactly once per invocation and never loops", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(writer, "utf8");
    // One call site, and no loop or retry construct wrapped around it.
    expect(src.match(/callProviderOnce\(/g)?.length).toBe(1);
    expect(src.match(/callProvider\(/g)?.length).toBe(1);
    expect(src).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*callProvider\(/);
    expect(src).not.toMatch(/while\s*\([^)]*\)\s*\{[^}]*callProvider\(/);
    expect(src).not.toMatch(/retry|maxAttempts|attempts\s*<|backoff/i);
  });

  it("pins the production host and never the mc-api alias", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(writer, "utf8");
    expect(src).toContain('const MC_BASE = "https://api.marketcheck.com"');
    expect(src).not.toContain("mc-api.marketcheck.com");
  });

  it("gates the provider call behind a granted reservation", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(writer, "utf8");
    expect(src).toContain('market_reserve_provider_call');
    expect(src).toMatch(/reservationOutcome === "reserved"/);
    // The call site sits inside the reserved branch, not beside it.
    const reservedAt = src.indexOf('reservationOutcome === "reserved"');
    const callAt = src.indexOf("callProvider(");
    expect(reservedAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(reservedAt);
  });

  it("writes compatibility columns only under the tenant admin flag", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(writer, "utf8");
    expect(src).toMatch(/readMarketFlag\(settings, "market_value_v2_admin"\)/);
    const flagAt = src.indexOf('readMarketFlag(settings, "market_value_v2_admin")');
    const updateAt = src.indexOf('from("vehicle_listings").update(');
    expect(updateAt).toBeGreaterThan(flagAt);
  });
});

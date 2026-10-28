import { describe, it, expect } from "vitest";
import { buildProviderEnvelope, classifyOutcome, envelopeFresh, filtersDiverged } from "./providerEnvelope.ts";

const base = {
  capabilityKey: "sold_summary",
  endpoint: "/v2/sold-vehicles/summary",
  contractVersion: "sold-summary@2026-10",
  subjectVin: null,
  requestedFilters: { make: "Example", model: "Model", state: "CT", months: 6 },
  fetchedAt: "2026-10-27T20:00:00.000Z",
  outcome: "succeeded" as const,
  httpStatus: 200,
  sampleSize: 42,
  responseKeys: ["stats", "applied", "warnings"],
};

describe("provider applied filters and warnings are persisted", () => {
  it("stores the provider's applied section verbatim and flags a divergence as a warning", () => {
    const e = buildProviderEnvelope({
      ...base,
      applied: { make: "Example", model: "Model", state: "CT", months: 3 },
      warnings: ["months clamped to 3"],
      notices: { note: "state applied as region" },
    });
    expect(e.appliedFilters).toEqual({ make: "Example", model: "Model", state: "CT", months: 3 });
    expect(e.filtersDiverged).toBe(true);
    expect(e.warnings).toContain("months clamped to 3");
    expect(e.warnings).toContain("provider_applied_filters_differ_from_request");
    expect(e.notices).toEqual(['{"note":"state applied as region"}']);
  });

  it("does not invent a divergence when the provider echoes the request or says nothing", () => {
    expect(filtersDiverged({ a: 1 }, { a: 1 })).toBe(false);
    expect(filtersDiverged({ a: 1 }, null)).toBe(false);
    expect(filtersDiverged({ a: 1 }, { b: 2 })).toBe(false);
    const e = buildProviderEnvelope({ ...base, applied: undefined });
    expect(e.appliedFilters).toBeNull();
    expect(e.filtersDiverged).toBe(false);
    expect(e.warnings).toEqual([]);
  });
});

describe("cost telemetry uses configurable pricing", () => {
  it("takes the registry list default, labelled as such", () => {
    const e = buildProviderEnvelope({ ...base, capabilityKey: "mds", endpoint: "/v2/mds/car" });
    expect(e.costUsd).toBe(0.002);
    expect(e.costSource).toBe("list_default");
  });

  it("prefers a configured override, labelled as such", () => {
    const e = buildProviderEnvelope({ ...base, capabilityKey: "mds", endpoint: "/v2/mds/car", costOverrides: { mds: 0.0015 } });
    expect(e.costUsd).toBe(0.0015);
    expect(e.costSource).toBe("configured");
  });

  it("records zero cost for a call that was never attempted and unpriced for an unknown product", () => {
    expect(buildProviderEnvelope({ ...base, outcome: "not_attempted" }).costUsd).toBe(0);
    const e = buildProviderEnvelope({ ...base, capabilityKey: "webhooks", endpoint: "/webhooks/marketcheck" });
    expect(e.costSource).toBe("unpriced");
  });
});

describe("classification and freshness", () => {
  it("classifies outcomes into the five economic buckets", () => {
    expect(classifyOutcome("succeeded", 10)).toBe("success");
    expect(classifyOutcome("succeeded", 0)).toBe("no_result");
    expect(classifyOutcome("not_entitled", null)).toBe("entitlement_failure");
    expect(classifyOutcome("auth_failed", null)).toBe("entitlement_failure");
    expect(classifyOutcome("rate_limited", null)).toBe("rate_limited");
    expect(classifyOutcome("request_rejected", null)).toBe("request_rejected");
    expect(classifyOutcome("server_error", null)).toBe("provider_failure");
    expect(classifyOutcome("timeout", null)).toBe("provider_failure");
  });

  it("derives expiry from the registry TTL and reports freshness against it", () => {
    const e = buildProviderEnvelope({ ...base, capabilityKey: "mds", endpoint: "/v2/mds/car" });
    expect(e.expiresAt).toBe("2026-11-03T20:00:00.000Z");
    expect(envelopeFresh(e, Date.parse("2026-10-30T00:00:00Z"))).toBe(true);
    expect(envelopeFresh(e, Date.parse("2026-11-04T00:00:00Z"))).toBe(false);
  });

  it("has no expiry for an immutable capability", () => {
    const e = buildProviderEnvelope({ ...base, capabilityKey: "neovin", endpoint: "/v2/decode/car/neovin/x/specs" });
    expect(e.expiresAt).toBeNull();
    expect(envelopeFresh(e, Date.now())).toBe(true);
  });

  it("reads entitlement from the outcome when the caller does not say", () => {
    expect(buildProviderEnvelope({ ...base, outcome: "not_entitled" }).entitlementState).toBe("not_entitled");
    expect(buildProviderEnvelope({ ...base, outcome: "succeeded" }).entitlementState).toBe("entitled");
    expect(buildProviderEnvelope({ ...base, outcome: "timeout" }).entitlementState).toBe("unknown");
  });

  it("fingerprints the request and the response shape deterministically", () => {
    const a = buildProviderEnvelope(base);
    const b = buildProviderEnvelope({ ...base, responseKeys: ["warnings", "applied", "stats"] });
    expect(a.requestFingerprint).toBe(b.requestFingerprint);
    expect(a.responseShapeVersion).toBe(b.responseShapeVersion);
    const c = buildProviderEnvelope({ ...base, requestedFilters: { ...base.requestedFilters, months: 12 } });
    expect(c.requestFingerprint).not.toBe(a.requestFingerprint);
  });
});

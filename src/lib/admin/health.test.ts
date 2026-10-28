import { describe, it, expect } from "vitest";
import {
  classifyRunOutcome,
  countDisplay,
  deriveFeedHealth,
  deriveJobHealth,
  deriveProviderHealth,
  freshnessState,
  knownCount,
  worstOf,
} from "./health";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("health precedence", () => {
  it("lets the most severe known state stand", () => {
    expect(worstOf(["healthy", "degraded", "healthy"])).toBe("degraded");
    expect(worstOf(["unknown", "healthy"])).toBe("unknown");
    expect(worstOf(["stale", "down"])).toBe("down");
    expect(worstOf(["disabled", "down"])).toBe("disabled");
    expect(worstOf([])).toBe("unknown");
  });

  it("treats a missing timestamp as unknown, never fresh", () => {
    expect(freshnessState(null, 24, NOW)).toBe("unknown");
    expect(freshnessState(hoursAgo(20), 24, NOW)).toBe("healthy");
    expect(freshnessState(hoursAgo(49), 24, NOW)).toBe("stale");
    expect(freshnessState(hoursAgo(31), 1, NOW)).toBe("stale");
    expect(freshnessState(hoursAgo(29), 1, NOW)).toBe("healthy");
  });
});

describe("run outcome classification", () => {
  it("reads a 429 as a rate limit even when the old sync called it a rooftop mismatch", () => {
    expect(classifyRunOutcome({ status: "failed", http_status: 429, error_summary: "pinned_scope_failed_validation" })).toBe("provider_rate_limited");
    expect(classifyRunOutcome({ status: "failed", http_status: null, error_summary: "provider_refused_429" })).toBe("provider_rate_limited");
  });

  it("separates authentication, provider error, transport and identity", () => {
    expect(classifyRunOutcome({ status: "failed", http_status: 401, error_summary: null })).toBe("provider_auth_failed");
    expect(classifyRunOutcome({ status: "failed", http_status: 503, error_summary: "upstream" })).toBe("provider_error");
    expect(classifyRunOutcome({ status: "failed", http_status: null, error_summary: "fetch failed: ECONNRESET" })).toBe("transport_error");
    expect(classifyRunOutcome({ status: "failed", http_status: 200, error_summary: "pinned_scope_failed_validation: rooftop mismatch" })).toBe("identity_hold");
  });

  it("keeps a valid empty answer distinct from a failure and a skip distinct from both", () => {
    expect(classifyRunOutcome({ status: "empty_valid", http_status: 200, error_summary: null })).toBe("valid_empty");
    expect(classifyRunOutcome({ status: "skipped", http_status: null, error_summary: "ran_5h_ago" })).toBe("skipped");
    expect(classifyRunOutcome({ status: "failed", http_status: null, error_summary: null })).toBe("failed_unknown");
  });
});

describe("feed health", () => {
  const base = { configured: true, enabled: true, cadenceHours: 24, now: NOW };

  it("reports a rate-limited run as degraded with inventory preserved, never as an identity failure", () => {
    const v = deriveFeedHealth({ ...base, latestRun: { status: "skipped", http_status: null, error_summary: "ran_5h_ago" }, latestRealRun: { status: "failed", http_status: 429, error_summary: "pinned_scope_failed_validation" }, lastSuccessAt: hoursAgo(20) });
    expect(v.state).toBe("degraded");
    expect(v.headline).toMatch(/rate limited/i);
    expect(v.headline).not.toMatch(/identity|mismatch/i);
    expect(v.inventoryPreserved).toBe(true);
  });

  it("never reports healthy from a skip when the last success is old", () => {
    const v = deriveFeedHealth({ ...base, latestRun: { status: "skipped", http_status: null, error_summary: "ran_5h_ago" }, latestRealRun: { status: "success", http_status: 200, error_summary: null }, lastSuccessAt: hoursAgo(20 * 24) });
    expect(v.state).toBe("stale");
  });

  it("reports healthy only for a fresh success", () => {
    const v = deriveFeedHealth({ ...base, latestRun: { status: "success", http_status: 200, error_summary: null }, latestRealRun: { status: "success", http_status: 200, error_summary: null }, lastSuccessAt: hoursAgo(6) });
    expect(v.state).toBe("healthy");
  });

  it("is unknown when the ledger failed to load or holds no runs", () => {
    expect(deriveFeedHealth({ ...base, latestRun: null, latestRealRun: null, lastSuccessAt: null, loadFailed: true }).state).toBe("unknown");
    expect(deriveFeedHealth({ ...base, latestRun: null, latestRealRun: null, lastSuccessAt: null }).state).toBe("unknown");
  });

  it("distinguishes not configured and disabled from any failure", () => {
    expect(deriveFeedHealth({ ...base, configured: false, latestRun: null, latestRealRun: null, lastSuccessAt: null }).state).toBe("not_configured");
    expect(deriveFeedHealth({ ...base, enabled: false, latestRun: null, latestRealRun: null, lastSuccessAt: null }).state).toBe("disabled");
  });
});

describe("job health", () => {
  const base = { cadenceHours: 24, affectedOutput: "x", now: NOW };

  it("never reads a cron row alone as healthy", () => {
    const v = deriveJobHealth({ ...base, scheduled: true, active: true, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null });
    expect(v.state).toBe("unknown");
  });

  it("reports a paused schedule as disabled and a failed-only history as down", () => {
    expect(deriveJobHealth({ ...base, scheduled: true, active: false, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null }).state).toBe("disabled");
    expect(deriveJobHealth({ ...base, scheduled: true, active: true, lastAttemptAt: hoursAgo(1), lastSuccessAt: null, lastOutcome: "failed" }).state).toBe("down");
  });

  it("reports stale when the last success is past twice the cadence", () => {
    expect(deriveJobHealth({ ...base, scheduled: true, active: true, lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(60), lastOutcome: "succeeded" }).state).toBe("stale");
    expect(deriveJobHealth({ ...base, scheduled: true, active: true, lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(10), lastOutcome: "succeeded" }).state).toBe("healthy");
  });
});

describe("provider health", () => {
  const base = { configured: true, entitlement: "entitled" as const, ttlHours: 24, affectedOutput: "x", now: NOW };

  it("reports an entitlement refusal as blocked, not as an outage", () => {
    expect(deriveProviderHealth({ ...base, entitlement: "refused", lastAttemptAt: hoursAgo(1), lastSuccessAt: null, lastOutcome: "http_error" }).state).toBe("entitlement_blocked");
  });

  it("reports a quota refusal as degraded with cached answers in use", () => {
    const v = deriveProviderHealth({ ...base, lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(5), lastOutcome: "refused_quota" });
    expect(v.state).toBe("degraded");
    expect(v.detail).toMatch(/cached/i);
  });

  it("is unknown with configuration but no attempts", () => {
    expect(deriveProviderHealth({ ...base, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null }).state).toBe("unknown");
  });

  it("is healthy only with a fresh successful call", () => {
    expect(deriveProviderHealth({ ...base, lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(1), lastOutcome: "ok" }).state).toBe("healthy");
    expect(deriveProviderHealth({ ...base, lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(100), lastOutcome: "ok" }).state).toBe("stale");
  });
});

describe("counts", () => {
  it("never renders an unknown read as zero", () => {
    expect(countDisplay({ kind: "failed" })).toBe("Unavailable");
    expect(countDisplay(null)).toBe("Unknown");
    expect(countDisplay(knownCount(0))).toBe("0");
    expect(countDisplay(knownCount(500, true))).toBe("500+");
  });
});

import { describe, it, expect } from "vitest";
import { classifyRunOutcome, type RunOutcome } from "@/lib/admin/health";
import {
  buildRunTimeline,
  canonicalRunLike,
  detailsLabel,
  diagnosisFor,
  httpReason,
  inventoryChangesLabel,
  inventoryWrites,
  nextStepFor,
  outcomeForRun,
  redactEvidence,
  REDACTED,
  runImpact,
  sourceHost,
  type SyncRunRow,
} from "./runs";

const base: SyncRunRow = {
  id: "run-1",
  source: "example-dealer.test",
  started_at: "2026-10-24T06:07:04Z",
  finished_at: "2026-10-24T06:07:09Z",
  status: "failed",
  num_found: 0,
  seen: 0,
  new_vehicles: 0,
  updated_vehicles: 0,
  prices_recorded: 0,
  removed: 0,
  http_status: 429,
  matched_dealer: null,
  error_summary: "rate-limited or over quota (HTTP 429)",
  raw: { kind: "provider_refused", error: "refused_429" },
};
const run = (patch: Partial<SyncRunRow>): SyncRunRow => ({ ...base, ...patch });

describe("outcomeForRun", () => {
  it("reads the typed refusal kind before any text", () => {
    expect(outcomeForRun(run({ error_summary: "pinned_scope rooftop mismatch", raw: { kind: "provider_refused" }, http_status: 429 }))).toBe("provider_rate_limited");
  });

  it("maps auth, provider and transport refusals by HTTP status", () => {
    expect(outcomeForRun(run({ http_status: 401 }))).toBe("provider_auth_failed");
    expect(outcomeForRun(run({ http_status: 403 }))).toBe("provider_auth_failed");
    expect(outcomeForRun(run({ http_status: 503 }))).toBe("provider_error");
    expect(outcomeForRun(run({ http_status: 0 }))).toBe("transport_error");
  });

  it("maps the empty-answer and scope-mismatch kinds", () => {
    expect(outcomeForRun(run({ http_status: 200, raw: { kind: "empty_answer" } }))).toBe("valid_empty");
    expect(outcomeForRun(run({ http_status: 200, raw: { kind: "scope_mismatch" } }))).toBe("identity_hold");
  });

  it("falls back to the keystone classifier for untyped rows", () => {
    expect(outcomeForRun(run({ status: "success", http_status: 200, raw: null }))).toBe("success");
    expect(outcomeForRun(run({ status: "skipped", http_status: null, raw: null }))).toBe("skipped");
    expect(outcomeForRun(run({ raw: null }))).toBe("provider_rate_limited");
    expect(outcomeForRun(run({ raw: null, http_status: null, error_summary: "fetch failed: timeout" }))).toBe("transport_error");
  });
});

describe("canonicalRunLike", () => {
  it("round-trips every outcome through the keystone classifier", () => {
    const outcomes: RunOutcome[] = ["success", "partial", "valid_empty", "skipped", "provider_rate_limited", "provider_auth_failed", "provider_error", "identity_hold", "transport_error", "failed_unknown"];
    for (const o of outcomes) expect(classifyRunOutcome(canonicalRunLike(run({ error_summary: "rate limit text that must not win" }), o))).toBe(o);
  });
});

describe("redactEvidence", () => {
  it("removes credential-like keys at any depth and keeps the facts", () => {
    const out = redactEvidence({
      http_status: 429,
      api_key: "do-not-show",
      headers: { Authorization: "Bearer do-not-show", cookie: "session=do-not-show", "x-request-id": "ok" },
      nested: { deeper: { ApiToken: "do-not-show", fine: 1 } },
    }) as Record<string, unknown>;
    expect(out.http_status).toBe(429);
    expect(out.api_key).toBe(REDACTED);
    expect((out.headers as Record<string, unknown>).Authorization).toBe(REDACTED);
    expect((out.headers as Record<string, unknown>).cookie).toBe(REDACTED);
    expect((out.headers as Record<string, unknown>)["x-request-id"]).toBe("ok");
    expect(((out.nested as Record<string, unknown>).deeper as Record<string, unknown>).ApiToken).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain("do-not-show");
  });

  it("bounds arrays, strings and depth", () => {
    const arr = redactEvidence(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
    expect(arr).toHaveLength(21);
    expect(arr[20]).toBe("… 5 more");
    expect(String(redactEvidence("x".repeat(500)))).toMatch(/… \(500 chars\)$/);
    const deep = redactEvidence({ a: { b: { c: { d: { e: 1 } } } } }) as Record<string, unknown>;
    expect(JSON.stringify(deep)).toContain("[nested]");
  });
});

describe("buildRunTimeline", () => {
  it("derives the rate-limit story from the row without inventing timestamps", () => {
    const events = buildRunTimeline(base, "provider_rate_limited", "example-dealer.test");
    expect(events.map((e) => e.label)).toEqual(["Scheduled run started", "Provider returned 429", "Inventory preservation applied", "Retry pending review"]);
    expect(events[0].at).toBe(base.started_at);
    expect(events.slice(1).every((e) => e.at === base.finished_at)).toBe(true);
    expect(events[2].detail).toMatch(/Existing rooftop identity retained/);
  });

  it("keeps a skip to two events and a success to three", () => {
    expect(buildRunTimeline(run({ status: "skipped", http_status: null, raw: { reason: "cadence" } }), "skipped", null)).toHaveLength(2);
    const ok = buildRunTimeline(run({ status: "success", http_status: 200, seen: 128, num_found: 131, new_vehicles: 2, updated_vehicles: 126 }), "success", null);
    expect(ok).toHaveLength(3);
    expect(ok[2].detail).toContain("2 new, 126 updated");
  });
});

describe("impact and labels", () => {
  it("records zero writes for a refusal and unknown writes for an unclassified failure", () => {
    expect(inventoryWrites(runImpact(base, "provider_rate_limited"))).toBe(0);
    expect(inventoryWrites(runImpact(run({ raw: null, http_status: null, error_summary: null }), "failed_unknown"))).toBeNull();
    expect(runImpact(run({ status: "success", new_vehicles: 2, updated_vehicles: 126, removed: 1 }), "success")).toEqual({ newVehicles: 2, updated: 126, retired: 1, prices: 0 });
  });

  it("uses the reference wording", () => {
    expect(httpReason(429)).toBe("Too Many Requests");
    expect(httpReason(null)).toBeNull();
    expect(inventoryChangesLabel(base, "provider_rate_limited")).toBe("None (retained)");
    expect(detailsLabel(base, "provider_rate_limited")).toBe("Rate limit from provider");
    expect(detailsLabel(run({ status: "skipped", raw: { reason: "cadence" } }), "skipped")).toBe("Scheduled run (cadence)");
    expect(inventoryChangesLabel(run({ status: "success", seen: 128 }), "success")).toBe("128 seen");
    expect(detailsLabel(run({ status: "success" }), "success")).toBe("Inventory updated");
  });

  it("derives diagnosis and next step from the outcome type, never from the raw text", () => {
    expect(diagnosisFor("provider_rate_limited", base).title).toBe("The provider declined this request");
    expect(nextStepFor("provider_rate_limited", 429).title).toBe("Review provider quota and retry policy");
    expect(nextStepFor("identity_hold", 200).detail).toMatch(/separate, confirmed action/);
  });

  it("reduces a source to its host", () => {
    expect(sourceHost(run({ source: "https://example-dealer.test/inventory" }), null)).toBe("example-dealer.test");
    expect(sourceHost(run({ source: null, raw: null }), "fallback.test")).toBe("fallback.test");
    expect(sourceHost(null, null)).toBeNull();
  });
});

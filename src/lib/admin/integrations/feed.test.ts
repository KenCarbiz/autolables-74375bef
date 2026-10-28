import { describe, it, expect } from "vitest";
import { cadenceHoursFor, deriveFeedSnapshot, pageSlice, pageWindow, scheduleLabel, type FeedConfigRow, type FeedSnapshotInput } from "./feed";
import type { SyncRunRow } from "./runs";

const NOW = Date.parse("2026-10-24T14:30:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const cfg: FeedConfigRow = {
  enabled: true,
  allowed: true,
  source: "example-dealer.test",
  frequency: "nightly",
  run_hour: 6,
  day_of_week: 0,
  max_vehicles: 1000,
  last_run_at: hoursAgo(8),
  mc_scope_param: "dealer_id",
  mc_scope_value: "example-pin-0001",
  rooftop_name: "Example Motors",
  rooftop_street: "100 Example Way",
  rooftop_zip: "00000",
  rooftop_verified_at: hoursAgo(56),
  strict_rooftop: true,
  last_good_count: 128,
  last_good_at: hoursAgo(56),
};

const runRow = (patch: Partial<SyncRunRow>): SyncRunRow => ({
  id: "r",
  source: "example-dealer.test",
  started_at: hoursAgo(8),
  finished_at: hoursAgo(8),
  status: "failed",
  num_found: 0,
  seen: 0,
  new_vehicles: 0,
  updated_vehicles: 0,
  prices_recorded: 0,
  removed: 0,
  http_status: 429,
  matched_dealer: null,
  error_summary: null,
  raw: { kind: "provider_refused" },
  ...patch,
});

const rateLimited = runRow({});
const identityHold = runRow({ http_status: 200, raw: { kind: "scope_mismatch" } });
const success = runRow({ status: "success", http_status: 200, seen: 128, raw: null, started_at: hoursAgo(8) });

const known = (value: number) => ({ kind: "known" as const, value });
const input = (patch: Partial<FeedSnapshotInput>): FeedSnapshotInput => ({
  config: cfg,
  latestRun: rateLimited,
  latestRealRun: rateLimited,
  lastSuccessAt: hoursAgo(56),
  activeVehicles: known(130),
  coverage: { new: known(79), used: known(31), cpo: known(20) },
  actorCanClearScope: true,
  now: NOW,
  ...patch,
});

describe("deriveFeedSnapshot under a provider rate limit", () => {
  const snap = deriveFeedSnapshot(input({}));

  it("reports degraded health with inventory preserved", () => {
    expect(snap.health.state).toBe("degraded");
    expect(snap.health.headline).toBe("Provider rate limited (HTTP 429)");
    expect(snap.health.inventoryPreserved).toBe(true);
    expect(snap.outcome).toBe("provider_rate_limited");
  });

  it("keeps the identity as previously validated and disables review with the exact reason", () => {
    expect(snap.source.identity).toBe("previously_validated");
    expect(snap.tiles.sourceIdentity.value).toBe("Previously validated");
    expect(snap.source.review.enabled).toBe(false);
    expect(snap.source.review.reason).toBe("Review source is disabled while a provider error is active.");
    expect(snap.source.retainedLabel).toBe("Verified source retained");
    expect(snap.source.note).toMatch(/Do not clear identity on provider rate limits/);
  });

  it("never offers to clear the pin on a refusal, even to an owner", () => {
    expect(snap.source.review.allowClearScope).toBe(false);
  });

  it("is on schedule while the last attempt sits inside the cadence window", () => {
    expect(snap.refresh.status).toBe("on_schedule");
    expect(snap.refresh.statusLabel).toBe("On schedule");
    expect(snap.refresh.schedule).toBe("Every 24 hours, 06:00 UTC");
  });
});

describe("identity hold", () => {
  it("enables review and allows the clear-pin path only for an owner or admin", () => {
    const owner = deriveFeedSnapshot(input({ latestRun: identityHold, latestRealRun: identityHold }));
    expect(owner.outcome).toBe("identity_hold");
    expect(owner.health.headline).toBe("Source identity needs review");
    expect(owner.source.identity).toBe("needs_review");
    expect(owner.source.review.enabled).toBe(true);
    expect(owner.source.review.allowClearScope).toBe(true);
    const staff = deriveFeedSnapshot(input({ latestRun: identityHold, latestRealRun: identityHold, actorCanClearScope: false }));
    expect(staff.source.review.allowClearScope).toBe(false);
  });
});

describe("refresh status", () => {
  it("is overdue once the last attempt falls outside cadence plus grace", () => {
    const late = runRow({ started_at: hoursAgo(40) });
    const snap = deriveFeedSnapshot(input({ latestRun: late, latestRealRun: late }));
    expect(snap.refresh.status).toBe("overdue");
    expect(snap.refresh.statusLabel).toBe("Overdue by 16 h");
  });

  it("reads paused, not granted and not configured from the configuration", () => {
    expect(deriveFeedSnapshot(input({ config: { ...cfg, enabled: false } })).refresh.status).toBe("paused");
    expect(deriveFeedSnapshot(input({ config: { ...cfg, allowed: false } })).refresh.status).toBe("not_granted");
    expect(deriveFeedSnapshot(input({ config: null, latestRun: null, latestRealRun: null })).refresh.status).toBe("not_configured");
    expect(deriveFeedSnapshot(input({ config: { ...cfg, enabled: false } })).health.state).toBe("disabled");
  });

  it("turns everything unknown when the configuration could not be read", () => {
    const snap = deriveFeedSnapshot(input({ config: null, configLoadFailed: true }));
    expect(snap.health.state).toBe("unknown");
    expect(snap.source.identity).toBe("unknown");
    expect(snap.tiles.sourceIdentity.value).toBe("Unknown");
    expect(snap.refresh.status).toBe("unknown");
    expect(snap.source.review.enabled).toBe(false);
  });
});

describe("verified identity", () => {
  it("is verified when the provider answered and the last success follows the validation", () => {
    const snap = deriveFeedSnapshot(input({ latestRun: success, latestRealRun: success, lastSuccessAt: success.started_at }));
    expect(snap.source.identity).toBe("verified");
    expect(snap.health.state).toBe("healthy");
    expect(snap.source.review.enabled).toBe(true);
    expect(snap.source.review.allowClearScope).toBe(false);
  });

  it("is not pinned when the configuration has no scope value", () => {
    expect(deriveFeedSnapshot(input({ config: { ...cfg, mc_scope_value: null } })).source.identity).toBe("not_pinned");
  });
});

describe("schedule helpers", () => {
  it("maps frequency to cadence hours and labels", () => {
    expect(cadenceHoursFor("nightly")).toBe(24);
    expect(cadenceHoursFor("weekly")).toBe(168);
    expect(cadenceHoursFor(undefined)).toBe(24);
    expect(scheduleLabel({ ...cfg, frequency: "weekly", day_of_week: 2, run_hour: 3 })).toBe("Weekly, Tuesday 03:00 UTC");
    expect(scheduleLabel(null)).toBe("Not configured");
  });
});

describe("paging", () => {
  it("slices a complete list", () => {
    const s = pageSlice([1, 2, 3], 1, 25);
    expect(s).toMatchObject({ from: 1, to: 3, total: 3, pages: 1, page: 1 });
    const p3 = pageSlice(Array.from({ length: 60 }, (_, i) => i), 3, 25);
    expect(p3.rows).toHaveLength(10);
    expect(p3).toMatchObject({ from: 51, to: 60, pages: 3 });
    expect(pageSlice([], 4, 25)).toMatchObject({ from: 0, to: 0, page: 1 });
  });

  it("describes a server window without re-slicing it", () => {
    const w = pageWindow([1, 2, 3], 2, 25, 28);
    expect(w.rows).toEqual([1, 2, 3]);
    expect(w).toMatchObject({ from: 26, to: 28, total: 28, pages: 2, page: 2 });
    const unknownTotal = pageWindow(Array.from({ length: 25 }, (_, i) => i), 1, 25, null);
    expect(unknownTotal.pages).toBe(2);
  });
});

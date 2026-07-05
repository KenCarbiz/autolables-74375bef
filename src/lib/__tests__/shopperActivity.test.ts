import { describe, it, expect } from "vitest";
import {
  buildShopperActivity,
  emptyShopperActivity,
  rangeSince,
  type RawEngagementEventRow,
  type RawPassportEngagementRow,
} from "../shopperActivity";

// ──────────────────────────────────────────────────────────────
// buildShopperActivity — the pure data layer behind the internal
// Shopper Activity slide-out. These tests pin the counting math,
// the section rollup, the transparent score, and the honesty rule
// (empty rows never fabricate a value / never produce NaN).
// ──────────────────────────────────────────────────────────────

const engagement: RawPassportEngagementRow[] = [
  { session_id: "s1", module: "warranty", seconds: 120, first_at: "2026-07-01T10:00:00Z", last_at: "2026-07-01T10:02:00Z" },
  { session_id: "s1", module: "gallery", seconds: 30, first_at: "2026-07-01T10:02:00Z", last_at: "2026-07-01T10:02:30Z" },
  { session_id: "s2", module: "warranty", seconds: 60, first_at: "2026-07-02T09:00:00Z", last_at: "2026-07-02T09:01:00Z" },
  { session_id: "s2", module: "market-price", seconds: 90, first_at: "2026-07-02T09:01:00Z", last_at: "2026-07-02T09:02:30Z" },
];

const events: RawEngagementEventRow[] = [
  { session_id: "e1", visitor_id: "v1", vin: "VIN123", event_type: "passport_opened", device_type: "mobile", browser: "Safari", os: "iOS", city: "Hartford", region: "CT", occurred_at: "2026-07-01T10:00:00Z" },
  { session_id: "e1", visitor_id: "v1", vin: "VIN123", event_type: "lead_form_opened", device_type: "mobile", occurred_at: "2026-07-01T10:03:00Z" },
  { session_id: "e2", visitor_id: "v1", vin: "VIN123", event_type: "cta_clicked", device_type: "desktop", browser: "Chrome", occurred_at: "2026-07-03T12:00:00Z" },
  { session_id: "e3", visitor_id: "v2", vin: "VIN123", event_type: "scroll_depth", metadata: { depth: 75 }, occurred_at: "2026-07-03T13:00:00Z" },
];

describe("buildShopperActivity — empty", () => {
  it("returns an honest empty summary with no fabricated values or NaN", () => {
    const s = buildShopperActivity({ viewCount: 0 });
    expect(s.hasAnyData).toBe(false);
    expect(s.totals.sessions).toBe(0);
    expect(s.totals.totalSeconds).toBe(0);
    expect(s.score.score).toBe(0);
    expect(s.score.level).toBe("Low");
    expect(s.sectionEngagement).toEqual([]);
    expect(s.sessions).toEqual([]);
    // no NaN anywhere in the score factors
    for (const f of s.score.factors) expect(Number.isNaN(f.points)).toBe(false);
    // scroll depth / returning visitors are "not tracked yet", not zero
    const scroll = s.metrics.find((m) => m.key === "scrollDepth");
    expect(scroll?.tracked).toBe(false);
    expect(scroll?.display).toBe("Not tracked yet");
  });

  it("emptyShopperActivity with null viewCount marks views untracked", () => {
    const s = emptyShopperActivity(null);
    const views = s.metrics.find((m) => m.key === "views");
    expect(views?.tracked).toBe(false);
    expect(s.totals.views).toBeNull();
  });
});

describe("buildShopperActivity — populated", () => {
  const summary = buildShopperActivity({ currentVin: "VIN123", viewCount: 12, engagement, events });

  it("rolls section dwell time up correctly and orders by seconds", () => {
    const warranty = summary.sectionEngagement.find((s) => s.module === "warranty")!;
    expect(warranty.seconds).toBe(180); // 120 + 60
    expect(warranty.sessions).toBe(2); // s1 + s2 touched it
    expect(summary.sectionEngagement[0].module).toBe("warranty"); // top by time
    expect(summary.totals.totalSeconds).toBe(300); // 120+30+60+90
    // pcts sum to ~100
    const pctSum = summary.sectionEngagement.reduce((a, s) => a + s.pct, 0);
    expect(Math.round(pctSum)).toBe(100);
  });

  it("counts distinct sessions across both passport dwell and events", () => {
    // s1, s2 (passport) + e1, e2, e3 (events) = 5 distinct session ids
    expect(summary.totals.sessions).toBe(5);
  });

  it("tallies CTA clicks, lead-form opens and scroll depth from real events", () => {
    expect(summary.totals.ctaClicks).toBe(1);
    expect(summary.totals.leadFormOpens).toBe(1);
    expect(summary.totals.maxScrollDepth).toBe(75);
  });

  it("detects a returning visitor (v1 appears in two sessions)", () => {
    expect(summary.totals.returningVisitors).toBe(1);
    const trig = summary.behaviorTriggers.find((t) => t.key === "returning")!;
    expect(trig.state).toBe("active");
  });

  it("flags a lead-form abandonment (opened, never submitted in session e1)", () => {
    const e1 = summary.sessions.find((s) => s.sessionId === "e1")!;
    expect(e1.leadFormAbandoned).toBe(true);
    const trig = summary.behaviorTriggers.find((t) => t.key === "lead-abandoned")!;
    expect(trig.state).toBe("active");
  });

  it("produces a bounded, transparent score with factor breakdown", () => {
    expect(summary.score.score).toBeGreaterThan(0);
    expect(summary.score.score).toBeLessThanOrEqual(100);
    const sum = summary.score.factors.reduce((a, f) => a + f.points, 0);
    expect(Math.min(100, sum)).toBe(summary.score.score);
    expect(summary.score.factors.map((f) => f.key)).toContain("focus");
  });

  it("emits at least one data-driven insight", () => {
    expect(summary.insights.length).toBeGreaterThan(0);
    expect(summary.insights[0]).toMatch(/warranty|attention|session|view/i);
  });

  it("omits similar vehicles when no cross-vehicle events are supplied", () => {
    expect(summary.similarVehicles).toEqual([]);
  });
});

describe("buildShopperActivity — similar vehicles", () => {
  it("aggregates other vins the same visitor viewed", () => {
    const cross = [
      { visitor_id: "v1", vin: "VIN999", event_type: "passport_opened", occurred_at: "2026-07-04T10:00:00Z" },
      { visitor_id: "v1", vin: "VIN999", event_type: "cta_clicked", occurred_at: "2026-07-04T10:05:00Z" },
      { visitor_id: "v1", vin: "VIN123", event_type: "passport_opened", occurred_at: "2026-07-04T11:00:00Z" }, // current vin, excluded
    ];
    const s = buildShopperActivity({ currentVin: "VIN123", viewCount: 3, events, crossVehicleEvents: cross });
    expect(s.similarVehicles).toHaveLength(1);
    expect(s.similarVehicles[0].vin).toBe("VIN999");
    expect(s.similarVehicles[0].events).toBe(2);
    expect(s.similarVehicles[0].visitors).toBe(1);
  });
});

describe("rangeSince", () => {
  const now = Date.parse("2026-07-05T00:00:00Z");
  it("returns null for all time", () => expect(rangeSince("all", now)).toBeNull());
  it("returns a 24h cutoff", () => expect(rangeSince("24h", now)).toBe("2026-07-04T00:00:00.000Z"));
  it("returns a 7d cutoff", () => expect(rangeSince("7d", now)).toBe("2026-06-28T00:00:00.000Z"));
});

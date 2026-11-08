import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { buildFeatureGroups, buildMetrics, describePlan, featureCounts, tierColumns, zonedMonthStart, type EntitlementFacts, type UsageState } from "./planModel";

const NOW = Date.parse("2026-11-08T15:00:00Z");
const facts = (over: Partial<EntitlementFacts>): EntitlementFacts => ({ planTier: "pro", status: "active", trialEndsAt: null, expiresAt: null, activatedAt: null, hasSubscription: true, seatLimit: null, ...over });

describe("describePlan keeps plan, trial, renewal and suspension apart", () => {
  it("does not show a past trial date on an active plan", () => {
    const p = describePlan(facts({ trialEndsAt: "2026-02-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" }), NOW, "America/New_York");
    expect(p.status).toBe("active");
    expect(p.lines.map((l) => l.label)).toEqual(["Current period ends"]);
    expect(JSON.stringify(p)).not.toMatch(/trial/i);
  });
  it("names a running trial and its end", () => {
    const p = describePlan(facts({ status: "trial", trialEndsAt: "2026-11-20T00:00:00Z" }), NOW, null);
    expect(p).toMatchObject({ status: "trial", statusLabel: "Trial", accessActive: true });
    expect(p.lines[0].label).toBe("Trial ends");
  });
  it("says so when a trial date passed but billing still says trial", () => {
    const p = describePlan(facts({ status: "trial", trialEndsAt: "2026-11-01T00:00:00Z" }), NOW, null);
    expect(p.lines[0].label).toBe("Trial end date passed");
    expect(p.headline).toMatch(/has not changed/);
  });
  it("treats past due, suspended, canceled and expired as inactive", () => {
    expect(describePlan(facts({ status: "past_due" }), NOW, null)).toMatchObject({ status: "past_due", accessActive: false });
    expect(describePlan(facts({ status: "paused" }), NOW, null)).toMatchObject({ status: "paused", statusLabel: "Suspended", accessActive: false });
    expect(describePlan(facts({ status: "canceled" }), NOW, null)).toMatchObject({ status: "canceled", accessActive: false });
    expect(describePlan(facts({ expiresAt: "2026-11-01T00:00:00Z" }), NOW, null)).toMatchObject({ status: "expired", accessActive: false });
  });
  it("reports no entitlement as no plan, and separates a manual entitlement from a subscription", () => {
    expect(describePlan(null, NOW, null).status).toBe("none");
    expect(describePlan(facts({ hasSubscription: false }), NOW, null).source).toMatch(/Manual entitlement/);
    expect(describePlan(facts({}), NOW, null).source).toBe("Autocurb subscription");
  });
});

describe("buildMetrics", () => {
  const ready: UsageState = { kind: "ready", snapshot: { monthLabel: "November 2026", timeZone: "UTC", scope: "x", updatedAt: "2026-11-08T00:00:00Z", metrics: { stickers_generated: { value: 100, events: 10, lastEventAt: null } } } };
  it("returns five metrics and keeps unrecorded activity unavailable instead of zero", () => {
    const m = buildMetrics(ready, "pro");
    expect(m.map((x) => x.spec.key)).toEqual(["stickers_generated", "documents_published", "template_customizations", "batch_jobs", "evidence_exports"]);
    expect(m.find((x) => x.spec.key === "batch_jobs")).toMatchObject({ value: null });
    expect(m.find((x) => x.spec.key === "evidence_exports")?.reason).toMatch(/not recorded/i);
    expect(m.find((x) => x.spec.key === "documents_published")?.value).toBe(0);
  });
  it("gives a limited metric a percent and an unlimited one none", () => {
    expect(buildMetrics(ready, "pro")[0]).toMatchObject({ percent: 4, limit: { kind: "limited", hard: 2500 } });
    const unlimited = buildMetrics(ready, "compliance")[0];
    expect(unlimited.limit.kind).toBe("unlimited");
    expect(unlimited.percent).toBeNull();
  });
  it("does not call an undefined limit unlimited", () => {
    expect(buildMetrics(ready, "pro").find((x) => x.spec.key === "documents_published")?.limit.kind).toBe("undefined");
  });
  it("shows a failed read as unavailable for every metric", () => {
    const m = buildMetrics({ kind: "failed", reason: "nope" }, "pro");
    expect(m.every((x) => x.value === null && x.percent === null)).toBe(true);
  });
});

describe("feature groups", () => {
  const settings = { passport_contact_routing: DEFAULT_SETTINGS.passport_contact_routing, passport_agents: [], feature_custom_branding: false };
  it("separates included, setup required, requires upgrade and unavailable", () => {
    const groups = buildFeatureGroups({ tier: "pro", accessActive: true, isPlatformAdmin: false, settings });
    const rows = groups.flatMap((g) => g.rows);
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by("window_stickers").status).toBe("included");
    expect(by("template_customization").status).toBe("setup_required");
    expect(by("evidence_packet_export").status).toBe("requires_upgrade");
    expect(by("team_permissions").status).toBe("platform_only");
    expect(groups.map((g) => g.label)).toEqual(["Documents & Printing", "Customization & Workflow", "Compliance & Evidence"]);
    const counts = featureCounts(groups);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
  });
  it("locks everything while the plan is not active", () => {
    const rows = buildFeatureGroups({ tier: "pro", accessActive: false, isPlatformAdmin: false, settings }).flatMap((g) => g.rows);
    expect(rows.every((r) => r.status === "unavailable" || r.status === "platform_only")).toBe(true);
  });
});

describe("compare plans and the reporting month", () => {
  it("builds three tiers from the repo's tier map", () => {
    const cols = tierColumns();
    expect(cols.map((c) => c.label)).toEqual(["Starter", "Pro", "Compliance"]);
    expect(cols[2].limits[0].value).toBe("Unlimited");
    expect(cols[1].billingPlans).toContain("Essential");
  });
  it("finds the month start in the named zone", () => {
    const ny = zonedMonthStart(Date.parse("2026-11-08T15:00:00Z"), "America/New_York");
    expect(ny.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(ny.end.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(ny.label).toBe("November 2026");
    expect(zonedMonthStart(Date.parse("2026-11-01T02:00:00Z"), "America/New_York").label).toBe("October 2026");
    expect(zonedMonthStart(Date.parse("2026-12-15T00:00:00Z"), "UTC").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("gives no percent when the limit is zero or the plan is unknown (E1, E2)", () => {
    const zero: UsageState = { kind: "ready", snapshot: { monthLabel: "November 2026", timeZone: "UTC", scope: "x", updatedAt: "2026-11-08T00:00:00Z", metrics: {} } };
    const none = buildMetrics(zero, "none")[0];
    expect(none.percent).toBeNull();
    const unknown = buildMetrics(zero, "none", false);
    expect(unknown.every((x) => x.limit.kind === "unknown" && x.percent === null)).toBe(true);
    const rows = buildFeatureGroups({ tier: "none", accessActive: false, isPlatformAdmin: false, settings: DEFAULT_SETTINGS, planKnown: false }).flatMap((g) => g.rows);
    const dealer = rows.filter((r) => r.status !== "platform_only");
    expect(dealer.every((r) => r.status === "unavailable" && r.detail === "Plan could not be loaded.")).toBe(true);
  });
});

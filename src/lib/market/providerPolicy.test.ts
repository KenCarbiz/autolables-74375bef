import { describe, it, expect } from "vitest";
import {
  decideProviderCall, ENRICHMENT_VISIT_CAPABILITIES, MATERIAL_EVENT_REFRESH, planVisit, readTenantProviderPolicy,
  summarizePlan, tenantTtlHours,
} from "./providerPolicy.ts";
import { effectiveCost } from "./providerRegistry.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const never: Record<string, string | null> = {};
const stamped = (h: number) => Object.fromEntries(ENRICHMENT_VISIT_CAPABILITIES.map((k) => [k, hoursAgo(h)]));
const reasonsOf = (plan: ReturnType<typeof planVisit>) => Object.fromEntries(plan.skipped.map((d) => [d.key, d.reason]));

describe("a new vehicle visit buys only what section 19 allows", () => {
  it("on a scheduled visit with nothing stored: the daily price-integrity search, nothing from the used endpoints", () => {
    const plan = planVisit({ vehicleType: "new", trigger: "scheduled", lastChecked: never, nowMs: NOW });
    expect(plan.order).toEqual(["active_search"]);
    const why = reasonsOf(plan);
    expect(why.vin_history).toBe("not_for_new");
    expect(why.mds).toBe("tenant_opt_in_required:new");
    expect(why.sales_stats).toBe("tenant_opt_in_required:new");
    expect(why.recents).toBe("tenant_opt_in_required:new");
    expect(why.autorecalls).toBe("entitlement_blocked");
  });

  it("a tenant may opt a new vehicle into MDS for management use, and the registry cadence then applies", () => {
    const settings = { provider_policy: { new: { mds: true } } };
    const plan = planVisit({ vehicleType: "new", trigger: "scheduled", lastChecked: never, settings, nowMs: NOW });
    expect(plan.order).toEqual(["active_search", "mds"]);
  });

  it("NMVTIS, MarketMatch, auction and FSBO are never due for a new vehicle", () => {
    for (const key of ["vindata_access", "vindata_generate", "marketmatch", "auction", "fsbo"]) {
      const d = decideProviderCall({ key, vehicleType: "new", trigger: "operator", lastCheckedAt: null, nowMs: NOW });
      expect(d.due, key).toBe(false);
    }
  });
});

describe("a used intake buys the section 20 list", () => {
  it("search, days supply, sales stats, recents and history; recall and Premium Plus wait on their entitlements", () => {
    const plan = planVisit({
      vehicleType: "used", trigger: "intake", lastChecked: never, nowMs: NOW,
      candidates: [...ENRICHMENT_VISIT_CAPABILITIES, "price_premium_plus"],
    });
    expect(plan.order).toEqual(["active_search", "mds", "sales_stats", "vin_history"]);
    const why = reasonsOf(plan);
    expect(why.recents).toBe("trigger_not_allowed:intake");
    expect(why.autorecalls).toBe("entitlement_blocked");
    expect(why.price_premium_plus).toBe("entitlement_blocked");
    expect(why.sold_summary).toBe("entitlement_blocked");
  });

  it("a CPO vehicle follows the used policy", () => {
    const plan = planVisit({ vehicleType: "cpo", trigger: "intake", lastChecked: never, nowMs: NOW });
    expect(plan.order).toContain("vin_history");
  });

  it("a scheduled visit on a never-enriched used car buys the same list", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "scheduled", lastChecked: never, nowMs: NOW });
    expect(plan.order).toEqual(["active_search", "mds", "sales_stats", "recents", "vin_history"]);
  });
});

describe("the next day, a used vehicle buys only the daily items", () => {
  it("search is due again after 24 hours; days supply, sales stats, recents and history are fresh", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "scheduled", lastChecked: stamped(25), nowMs: NOW });
    expect(plan.order).toEqual(["active_search"]);
    const why = reasonsOf(plan);
    expect(why.mds).toBe("fresh");
    expect(why.vin_history).toBe("fresh");
    expect(why.sales_stats).toBe("fresh");
    expect(why.recents).toBe("fresh");
  });

  it("each refresh comes due when its own TTL elapses", () => {
    const mds = decideProviderCall({ key: "mds", vehicleType: "used", trigger: "scheduled", lastCheckedAt: hoursAgo(24 * 7 + 1), nowMs: NOW });
    expect(mds.due).toBe(true);
    expect(mds.reason).toBe("ttl_elapsed");
    expect(mds.ttlHours).toBe(24 * 7);
    expect(mds.ttlSource).toBe("registry");
    const history = decideProviderCall({ key: "vin_history", vehicleType: "used", trigger: "scheduled", lastCheckedAt: hoursAgo(24 * 29), nowMs: NOW });
    expect(history.due).toBe(false);
    expect(history.ageHours).toBeCloseTo(24 * 29, 5);
  });

  it("a stamp that cannot be parsed counts as never checked", () => {
    const d = decideProviderCall({ key: "mds", vehicleType: "used", trigger: "scheduled", lastCheckedAt: "not a date", nowMs: NOW });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("never_checked");
  });
});

describe("material events", () => {
  it("a price change brings the active search forward and never a decode", () => {
    const plan = planVisit({
      vehicleType: "used", trigger: "material_event", materialEvents: ["price_change"],
      lastChecked: { ...stamped(1), neovin: hoursAgo(24 * 200) }, nowMs: NOW,
      candidates: [...ENRICHMENT_VISIT_CAPABILITIES, "neovin"],
    });
    expect(plan.order).toEqual(["active_search"]);
    expect(plan.due[0].reason).toBe("material_event:price_change");
    const why = reasonsOf(plan);
    expect(why.neovin).toBe("immutable_already_held");
    expect(why.mds).toBe("fresh");
    expect(MATERIAL_EVENT_REFRESH.price_change).not.toContain("neovin");
    expect(MATERIAL_EVENT_REFRESH.price_change).not.toContain("price_base");
  });

  it("a mileage change beyond the band also brings days supply and history forward", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "material_event", materialEvents: ["mileage_change"], lastChecked: stamped(1), nowMs: NOW });
    expect(plan.order).toEqual(["active_search", "mds", "vin_history"]);
  });

  it("a dealer condition change refreshes nothing from the provider", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "material_event", materialEvents: ["condition_change"], lastChecked: stamped(1), nowMs: NOW });
    expect(plan.order).toEqual([]);
  });

  it("a decode is bought once, on intake, and never again", () => {
    expect(decideProviderCall({ key: "neovin", vehicleType: "used", trigger: "intake", lastCheckedAt: null, nowMs: NOW }).reason).toBe("never_checked");
    expect(decideProviderCall({ key: "neovin", vehicleType: "used", trigger: "intake", lastCheckedAt: hoursAgo(1), nowMs: NOW }).reason).toBe("immutable_already_held");
    expect(decideProviderCall({ key: "neovin", vehicleType: "used", trigger: "scheduled", lastCheckedAt: hoursAgo(24 * 400), nowMs: NOW }).due).toBe(false);
  });
});

describe("public browse buys nothing", () => {
  it("whatever the vehicle, trigger history or settings", () => {
    const settings = { provider_policy: { used: { mds_days: 0.01 } }, market_flags: { sold_summary: true } };
    const plan = planVisit({ vehicleType: "used", trigger: "public_browse", lastChecked: never, settings, nowMs: NOW });
    expect(plan.order).toEqual([]);
    expect(plan.estimatedCostUsd).toBe(0);
    for (const d of plan.skipped) expect(d.reason).toBe("public_browse_never_triggers");
  });
});

describe("flags and entitlements", () => {
  it("a capability behind an OFF flag is skipped with the flag named", () => {
    const d = decideProviderCall({
      key: "sold_summary", vehicleType: "used", trigger: "scheduled", lastCheckedAt: null, nowMs: NOW,
      entitlements: { sold_summary: "entitled" },
    });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("flag_off:sold_summary");
  });

  it("with the flag on and the entitlement granted, the monthly trend buy is due", () => {
    const d = decideProviderCall({
      key: "sold_summary", vehicleType: "used", trigger: "scheduled", lastCheckedAt: null, nowMs: NOW,
      settings: { market_flags: { sold_summary: true } }, entitlements: { sold_summary: "entitled" },
    });
    expect(d.due).toBe(true);
    expect(d.ttlHours).toBe(24 * 30);
  });

  it("an entitlement granted in the tenant blob switches a blocked capability on without a code change", () => {
    const settings = { market_flags: { autorecalls_vin: true }, provider_policy: { entitlements: { autorecalls: "entitled" } } };
    const d = decideProviderCall({ key: "autorecalls", vehicleType: "used", trigger: "intake", lastCheckedAt: null, settings, nowMs: NOW });
    expect(d.due).toBe(true);
    expect(d.entitlement).toBe("entitled");
  });

  it("reserved, deprecated and never-triggered capabilities are refused with the registry's reason", () => {
    expect(decideProviderCall({ key: "marketmatch", vehicleType: "used", trigger: "operator", lastCheckedAt: null, nowMs: NOW }).reasons).toContain("autocurb_reserved");
    expect(decideProviderCall({ key: "autorecalls_legacy", vehicleType: "used", trigger: "operator", lastCheckedAt: null, nowMs: NOW }).reasons).toContain("deprecated_replaced");
    expect(decideProviderCall({ key: "no_such_capability", vehicleType: "used", trigger: "operator", lastCheckedAt: null, nowMs: NOW }).reason).toBe("unknown_capability");
  });

  it("an operator request is due whatever the age, but still inside the flag and entitlement gates", () => {
    expect(decideProviderCall({ key: "mds", vehicleType: "used", trigger: "operator", lastCheckedAt: hoursAgo(1), nowMs: NOW }).reason).toBe("operator_requested");
    expect(decideProviderCall({ key: "autorecalls", vehicleType: "used", trigger: "operator", lastCheckedAt: null, nowMs: NOW }).reason).toBe("entitlement_blocked");
  });
});

describe("tenant TTL overrides", () => {
  const settings = { provider_policy: { used: { mds_days: 1, history_days: 2, ttl_days: { active_search: 3 } } } };

  it("are read from the policy document's keys and the generic ttl_days map, in hours", () => {
    const policy = readTenantProviderPolicy(settings);
    expect(tenantTtlHours(policy, "used", "mds")).toBe(24);
    expect(tenantTtlHours(policy, "used", "vin_history")).toBe(48);
    expect(tenantTtlHours(policy, "used", "active_search")).toBe(72);
    expect(tenantTtlHours(policy, "used", "sales_stats")).toBeNull();
    expect(tenantTtlHours(policy, "new", "mds")).toBeNull();
  });

  it("change what is due", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "scheduled", lastChecked: stamped(48), settings, nowMs: NOW });
    expect(plan.order).toEqual(["mds", "vin_history"]);
    const mds = plan.due.find((d) => d.key === "mds");
    expect(mds?.ttlSource).toBe("tenant");
    expect(mds?.ttlHours).toBe(24);
  });

  it("a new vehicle's price-integrity search slows to weekly when the tenant turns the daily check off", () => {
    const weekly = { provider_policy: { new: { price_integrity_daily: false } } };
    const d = decideProviderCall({ key: "active_search", vehicleType: "new", trigger: "scheduled", lastCheckedAt: hoursAgo(25), settings: weekly, nowMs: NOW });
    expect(d.due).toBe(false);
    expect(d.ttlHours).toBe(24 * 7);
    expect(d.ttlSource).toBe("tenant");
    const daily = decideProviderCall({ key: "active_search", vehicleType: "new", trigger: "scheduled", lastCheckedAt: hoursAgo(25), nowMs: NOW });
    expect(daily.due).toBe(true);
    expect(tenantTtlHours(readTenantProviderPolicy(weekly), "used", "active_search")).toBeNull();
  });

  it("an automatic NMVTIS pull needs the tenant's say-so; a manual one does not", () => {
    const auto = decideProviderCall({ key: "vindata_access", vehicleType: "used", trigger: "material_event", materialEvents: ["feed_reappearance"], lastCheckedAt: null, nowMs: NOW });
    expect(auto.due).toBe(false);
    expect(auto.reason).toBe("nmvtis_auto_verify_off");
    const allowed = decideProviderCall({
      key: "vindata_access", vehicleType: "used", trigger: "scheduled", lastCheckedAt: null, nowMs: NOW,
      settings: { provider_policy: { used: { nmvtis_auto_verify: true } } },
    });
    expect(allowed.reason).not.toBe("nmvtis_auto_verify_off");
    const manual = decideProviderCall({ key: "vindata_access", vehicleType: "used", trigger: "operator", lastCheckedAt: null, nowMs: NOW });
    expect(manual.due).toBe(true);
  });

  it("ignore nonsense values", () => {
    const policy = readTenantProviderPolicy({ provider_policy: { used: { mds_days: -3, history_days: "soon" } } });
    expect(tenantTtlHours(policy, "used", "mds")).toBeNull();
    expect(tenantTtlHours(policy, "used", "vin_history")).toBeNull();
    expect(readTenantProviderPolicy(null).entitlements).toEqual({});
    expect(readTenantProviderPolicy({ provider_policy: "yes" }).used).toEqual({});
  });
});

describe("cost totals use effectiveCost with the tenant's overrides", () => {
  it("defaults come from the registry and overrides replace them, times the calls a capability costs", () => {
    const base = planVisit({ vehicleType: "used", trigger: "intake", lastChecked: never, nowMs: NOW, callsPerCapability: { active_search: 4 } });
    const expected = 4 * (effectiveCost("active_search") ?? 0) + (effectiveCost("mds") ?? 0) + (effectiveCost("sales_stats") ?? 0)
      + (effectiveCost("vin_history") ?? 0);
    expect(base.estimatedCostUsd).toBeCloseTo(Math.round(expected * 100) / 100, 2);
    expect(base.estimatedCalls).toBe(7);

    const settings = { provider_policy: { used: { cost_overrides_usd: { active_search: 0.01, vin_history: 0 } } } };
    const over = planVisit({ vehicleType: "used", trigger: "intake", lastChecked: never, settings, nowMs: NOW, callsPerCapability: { active_search: 4 } });
    expect(over.due.find((d) => d.key === "active_search")?.estimatedCostUsd).toBe(0.01);
    expect(over.due.find((d) => d.key === "vin_history")?.estimatedCostUsd).toBe(0);
    const overExpected = 0.04 + (effectiveCost("mds") ?? 0) + (effectiveCost("sales_stats") ?? 0);
    expect(over.estimatedCostUsd).toBeCloseTo(Math.round(overExpected * 100) / 100, 2);
  });

  it("carries a cache key built from the registry's dimensions", () => {
    const d = decideProviderCall({
      key: "mds", vehicleType: "used", trigger: "intake", lastCheckedAt: null, nowMs: NOW,
      subject: { match_level: "YMMT", vin_or_ymmt: "2024|EXAMPLE|MODEL|TRIM", zip: "00000", radius: 100, car_type: "used" },
    });
    expect(d.cacheKey.startsWith("mds|")).toBe(true);
    expect(d.cacheKey).toContain("zip=00000");
    expect(d.cacheKey).toContain("car_type=used");
  });

  it("summarises a plan for storage", () => {
    const plan = planVisit({ vehicleType: "used", trigger: "scheduled", lastChecked: stamped(25), nowMs: NOW });
    const s = summarizePlan(plan);
    expect(s.due).toEqual(["active_search"]);
    expect(s.skipped.mds).toBe("fresh");
    expect(s.decided_at).toBe("2026-10-28T12:00:00.000Z");
    expect(s.estimated_calls).toBe(1);
  });
});

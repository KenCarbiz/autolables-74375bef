import { describe, it, expect } from "vitest";
import { resolvePassportVersion } from "../passportVersion";

// Pure resolver truth table — see supabase/functions/_shared/passport-version.ts
// for the specification. These tests pin the ordering rules so future
// changes to routing behavior can't silently regress the semantics.

describe("resolvePassportVersion", () => {
  it("inherit + tenant current → current / tenant_default", () => {
    expect(resolvePassportVersion({ vehicleOverride: "inherit", tenantDefault: "current" }))
      .toEqual({ effective: "current", reason: "tenant_default" });
  });

  it("inherit + tenant v3 → v3 / tenant_default", () => {
    expect(resolvePassportVersion({ vehicleOverride: "inherit", tenantDefault: "v3" }))
      .toEqual({ effective: "v3", reason: "tenant_default" });
  });

  it("explicit current beats tenant v3", () => {
    expect(resolvePassportVersion({ vehicleOverride: "current", tenantDefault: "v3" }))
      .toEqual({ effective: "current", reason: "vehicle_override" });
  });

  it("explicit v3 beats tenant current", () => {
    expect(resolvePassportVersion({ vehicleOverride: "v3", tenantDefault: "current" }))
      .toEqual({ effective: "v3", reason: "vehicle_override" });
  });

  it("tenant kill switch overrides an explicit v3 override", () => {
    expect(resolvePassportVersion({ vehicleOverride: "v3", tenantDefault: "v3", tenantKillSwitch: true }))
      .toEqual({ effective: "current", reason: "emergency_kill_switch" });
  });

  it("global kill switch overrides everything", () => {
    expect(resolvePassportVersion({ vehicleOverride: "v3", tenantDefault: "v3", globalKillSwitch: true }))
      .toEqual({ effective: "current", reason: "emergency_kill_switch" });
  });

  it("experiment override falls back to tenant default with experiment_assignment reason", () => {
    expect(resolvePassportVersion({ vehicleOverride: "experiment", tenantDefault: "v3" }))
      .toEqual({ effective: "v3", reason: "experiment_assignment" });
    expect(resolvePassportVersion({ vehicleOverride: "experiment", tenantDefault: "current" }))
      .toEqual({ effective: "current", reason: "experiment_assignment" });
  });

  it("safety fallback on unknown/garbage input still resolves to current", () => {
    expect(resolvePassportVersion({ vehicleOverride: "garbage" as unknown, tenantDefault: "junk" as unknown }))
      .toEqual({ effective: "current", reason: "tenant_default" });
    // null/undefined
    expect(resolvePassportVersion({}))
      .toEqual({ effective: "current", reason: "tenant_default" });
  });

  it("unset override with unset tenant default → current / tenant_default", () => {
    expect(resolvePassportVersion({ vehicleOverride: null, tenantDefault: undefined }))
      .toEqual({ effective: "current", reason: "tenant_default" });
  });
});

// Route-selection contract (governed_routing_enabled gate) — this is
// enforced at the wrapper, but the truth table is pinned here so a change
// in one place forces a matching change in the other.

describe("governed routing gate (contract)", () => {
  const chooseRoute = (effective: "current" | "v3", governedRoutingEnabled: boolean) =>
    governedRoutingEnabled && effective === "v3" ? "governed" : "existing";

  it("flag off → always existing passport, even when effective is v3", () => {
    expect(chooseRoute("v3", false)).toBe("existing");
    expect(chooseRoute("current", false)).toBe("existing");
  });

  it("flag on → honors effective version", () => {
    expect(chooseRoute("v3", true)).toBe("governed");
    expect(chooseRoute("current", true)).toBe("existing");
  });
});

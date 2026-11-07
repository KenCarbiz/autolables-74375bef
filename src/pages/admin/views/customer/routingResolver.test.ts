import { describe, expect, it } from "vitest";
import { DEFAULT_CONTACT_ROUTING, type CustomerPassportContactSettings, type PassportAgent } from "@/lib/passportRouting";
import { simulateRoute, tierRows, traceTiers, validateRouting, readRouting, routingToPatch, sliceOf } from "./routingModel";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";

const NOON_UTC = new Date("2026-11-04T17:00:00Z");
const NIGHT_UTC = new Date("2026-11-04T03:00:00Z");
const agent = (id: string, extra: Partial<PassportAgent> = {}): PassportAgent => ({ id, name: `Agent ${id}`, status: "available", acceptsPassportLeads: true, workingHours: [], ...extra });
const cfg = (r: Partial<CustomerPassportContactSettings> = {}): CustomerPassportContactSettings => ({
  ...DEFAULT_CONTACT_ROUTING,
  timezone: "UTC",
  showAgentProfile: true,
  dealershipDefaultContact: { salesPhone: "555-0100", salesEmail: "s@example.test" },
  bdcSettings: { enabled: true, showBdcAsTeam: true, bdcPhone: "555-0140" },
  managerFallback: { enabled: true, managerEmail: "m@example.test" },
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "19:00" })),
  ...r,
});
const run = (r: CustomerPassportContactSettings, agents: PassportAgent[], extra: Partial<Parameters<typeof simulateRoute>[0]> = {}) => simulateRoute({ routing: r, agents, now: NOON_UTC, ...extra });

describe("route simulation uses the shared resolver", () => {
  it("routes to the CRM owner first", () => {
    const res = run(cfg(), [agent("a"), agent("b")], { crmOwnerAgentId: "b", assignedAgentId: "a" });
    expect(res.routingTargetType).toBe("crm_owner");
    expect(res.routingTargetId).toBe("b");
  });
  it("skips an unavailable assigned user and falls to rotation", () => {
    const res = run(cfg(), [agent("a", { manualOverride: "unavailable" }), agent("b")], { assignedAgentId: "a" });
    expect(res.routingTargetType).toBe("sales_rotation");
    expect(res.routingTargetId).toBe("b");
  });
  it("falls to the BDC when the rotation is empty", () => {
    expect(run(cfg(), [], {}).routingTargetType).toBe("bdc");
  });
  it("skips the BDC when it is off and uses the manager", () => {
    expect(run(cfg({ bdcSettings: { enabled: false, showBdcAsTeam: true } }), []).routingTargetType).toBe("sales_manager");
  });
  it("skips the manager when it is off and uses the store contact", () => {
    const res = run(cfg({ bdcSettings: { enabled: false, showBdcAsTeam: true }, managerFallback: { enabled: false } }), []);
    expect(res.routingTargetType).toBe("dealership_default");
    expect(res.phone).toBe("555-0100");
  });
  it("ends at the store contact with no phone or email when the fallback is missing", () => {
    const res = run(cfg({ bdcSettings: undefined, managerFallback: undefined, dealershipDefaultContact: { salesPhone: "", salesEmail: "" } }), []);
    expect(res.routingTargetType).toBe("dealership_default");
    expect(res.phone).toBeUndefined();
    expect(res.email).toBeUndefined();
  });
  it("skips live people after hours", () => {
    const res = simulateRoute({ routing: cfg(), agents: [agent("a")], assignedAgentId: "a", now: NIGHT_UTC });
    expect(res.afterHours).toBe(true);
    expect(res.routingTargetType).toBe("dealership_default");
  });
  it("never routes to a user outside the account roster", () => {
    const res = run(cfg(), [agent("a")], { assignedAgentId: "other-tenant-user", crmOwnerAgentId: "other-tenant-user" });
    expect(res.routingTargetId).not.toBe("other-tenant-user");
    expect(res.routingTargetType).toBe("sales_rotation");
  });
  it("traces each step with the same resolver", () => {
    const t = traceTiers({ routing: cfg(), agents: [], now: NOON_UTC });
    expect(t.map((x) => x.takes)).toEqual([false, false, false, true, true, true]);
  });
});

describe("routing model", () => {
  it("keeps all six tiers visible and distinct, BDC separate from manager", () => {
    const rows = tierRows(sliceOf(readRouting(DEFAULT_SETTINGS)));
    expect(rows.map((r) => r.key)).toEqual(["crm_owner", "vehicle_assigned_agent", "available_sales_rotation", "bdc", "sales_manager", "dealership_default"]);
  });
  it("shows a tier missing from the saved order as skipped", () => {
    const d = readRouting(DEFAULT_SETTINGS);
    const rows = tierRows(sliceOf({ ...d, routingPriority: ["crm_owner", "bdc", "dealership_default"] }));
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.state === "not_in_order")).toHaveLength(3);
  });
  it("validates emails and writes only changed keys", () => {
    const d = readRouting(DEFAULT_SETTINGS);
    expect(validateRouting({ ...d, dealershipDefaultContact: { salesPhone: "", salesEmail: "nope" } }).dealershipDefaultContact).toBeTruthy();
    const patch = routingToPatch({ contactMode: "bdc" }, DEFAULT_SETTINGS);
    expect(Object.keys(patch)).toEqual(["passport_contact_routing"]);
  });
});

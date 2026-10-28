import { describe, it, expect } from "vitest";
import { DEFAULT_CONTACT_ROUTING, type PassportAgent } from "@/lib/passportRouting";
import {
  deliveryActivityFromAudit,
  escalationComplete,
  notificationMethodRows,
  routingApplyGate,
  routingChangeRows,
  routingOrderRows,
  routingSliceFrom,
  validateRoutingDraft,
  withEmailMethod,
} from "./routingDraft";

const agent = (id: string, over: Partial<PassportAgent> = {}): PassportAgent => ({ id, name: `Example ${id}`, status: "available", acceptsPassportLeads: true, workingHours: [], ...over });

const base = () => routingSliceFrom({ ...DEFAULT_CONTACT_ROUTING, dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" }, escalationRules: { ...DEFAULT_CONTACT_ROUTING.escalationRules, enabled: false } }, [agent("a"), agent("b")]);

describe("routing order rows", () => {
  it("describes the six resolver steps with their real state", () => {
    const rows = routingOrderRows(base());
    expect(rows.map((r) => r.title)).toEqual(["CRM owner", "Assigned salesperson", "Sales rotation", "BDC", "Manager fallback", "Store contact"]);
    expect(rows[2]).toMatchObject({ owner: "2 salespeople", ownerDetail: "Round robin", state: "ok" });
    expect(rows[3]).toMatchObject({ state: "off" });
    expect(rows[5]).toMatchObject({ state: "ok" });
  });

  it("marks an enabled route without a destination as incomplete, not off", () => {
    const s = base();
    s.routing = { ...s.routing, bdcSettings: { enabled: true, showBdcAsTeam: true }, managerFallback: { enabled: true }, dealershipDefaultContact: { salesPhone: "", salesEmail: "" } };
    const rows = routingOrderRows(s);
    expect(rows[3].state).toBe("incomplete");
    expect(rows[4].state).toBe("incomplete");
    expect(rows[5].state).toBe("incomplete");
  });

  it("marks rotation incomplete when it is on with nobody able to receive leads", () => {
    const s = routingSliceFrom(base().routing, []);
    expect(routingOrderRows(s)[2]).toMatchObject({ state: "incomplete", owner: "0 salespeople" });
  });
});

describe("apply gate", () => {
  it("refuses an unchanged draft", () => {
    const s = base();
    expect(routingApplyGate(s, s)).toMatchObject({ ok: false, reason: "Nothing has changed." });
  });

  it("refuses a change that enables a route with no destination", () => {
    const s = base();
    const draft = { ...s, routing: { ...s.routing, managerFallback: { enabled: true } } };
    const gate = routingApplyGate(s, draft);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/valid fallback/i);
    expect(gate.newBlockers).toHaveLength(1);
  });

  it("allows a change that leaves an existing gap alone and reports it as remaining", () => {
    const s = base();
    s.routing = { ...s.routing, managerFallback: { enabled: true } };
    const draft = { ...s, routing: { ...s.routing, showAgentProfile: true } };
    const gate = routingApplyGate(s, draft);
    expect(gate.ok).toBe(true);
    expect(gate.remainingBlockers).toHaveLength(1);
    expect(gate.newBlockers).toEqual([]);
  });

  it("allows a change that fixes a gap", () => {
    const s = base();
    s.routing = { ...s.routing, managerFallback: { enabled: true } };
    const draft = { ...s, routing: { ...s.routing, managerFallback: { enabled: true, managerEmail: "manager@example.test" } } };
    expect(routingApplyGate(s, draft)).toMatchObject({ ok: true, remainingBlockers: [], readinessAfter: { ready: true } });
  });
});

describe("validation and change rows", () => {
  it("rejects malformed addresses and a zero response target", () => {
    const s = base();
    s.routing = { ...s.routing, dealershipDefaultContact: { salesPhone: "", salesEmail: "nope" }, escalationRules: { ...s.routing.escalationRules, enabled: true, firstResponseSlaMinutes: 0 } };
    const errors = validateRoutingDraft(s);
    expect(errors).toHaveLength(2);
  });

  it("lists readable before and after values for what changed, including the roster", () => {
    const s = base();
    const draft = { routing: { ...s.routing, contactMode: "dealership_default" as const }, agents: [agent("a")] };
    const rows = routingChangeRows(s, draft);
    expect(rows).toEqual([
      { field: "contactMode", label: "Contact mode", before: "Smart routing", after: "Dealership default" },
      { field: "agents", label: "Sales team roster", before: "2 salespeople", after: "1 salespeople" },
    ]);
  });
});

describe("notification methods and escalation completeness", () => {
  it("exposes email as the only selectable method and reads the legacy default as on", () => {
    const rows = notificationMethodRows(DEFAULT_CONTACT_ROUTING.escalationRules);
    expect(rows.map((r) => [r.key, r.supported, r.enabled])).toEqual([["email", true, true], ["sms", false, false], ["in_app", false, false], ["push", false, false]]);
  });

  it("turns email off with an explicit empty list and back on without losing other entries", () => {
    const off = withEmailMethod({ ...DEFAULT_CONTACT_ROUTING.escalationRules, notifyMethods: ["email"] }, false);
    expect(off.notifyMethods).toEqual([]);
    const on = withEmailMethod({ ...DEFAULT_CONTACT_ROUTING.escalationRules, notifyMethods: ["sms"] }, true);
    expect(on.notifyMethods).toEqual(["email", "sms"]);
    expect(notificationMethodRows(off)[0].enabled).toBe(false);
  });

  it("is complete only when every timed tier has a destination", () => {
    const s = base();
    s.routing = { ...s.routing, escalationRules: { ...s.routing.escalationRules, enabled: true } };
    expect(escalationComplete(s)).toMatchObject({ complete: false });
    s.routing = { ...s.routing, bdcSettings: { enabled: true, showBdcAsTeam: true, bdcEmail: "bdc@example.test" }, managerFallback: { enabled: true, managerEmail: "m@example.test" } };
    expect(escalationComplete(s)).toEqual({ complete: true, missing: [] });
  });
});

describe("delivery activity", () => {
  it("reads outcomes from audit rows and never promotes a legacy row to accepted", () => {
    const rows = deliveryActivityFromAudit(
      [
        { id: "1", action: "customer_passport_escalated", entity_id: "abcdef12-0000", created_at: "2026-10-28T10:14:00Z", details: { level: 1, outcome: "accepted", method: "email", store_id: "s1" } },
        { id: "2", action: "customer_passport_escalation_failed", entity_id: "fedcba21-0000", created_at: "2026-10-28T10:20:00Z", details: { level: 2, outcome: "failed", method: "email" } },
        { id: "3", action: "customer_passport_escalated", entity_id: "11112222-0000", created_at: "2026-10-01T10:20:00Z", details: { level: 1, to: "BDC" } },
      ],
      (id) => (id === "s1" ? "Example rooftop" : "This rooftop"),
    );
    expect(rows.map((r) => r.result)).toEqual(["accepted", "failed", "attempted"]);
    expect(rows[0]).toMatchObject({ requestLabel: "Request abcdef12", rooftop: "Example rooftop", channel: "Email", attempt: 1 });
    expect(rows[2].rooftop).toBe("This rooftop");
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveCustomerPassportRouting,
  isAgentAvailable,
  isWithinHours,
  closedPillCopy,
  normalizeContactRouting,
  DEFAULT_CONTACT_ROUTING,
  type PassportAgent,
  type CustomerPassportContactSettings,
} from "./passportRouting";

const agent = (over: Partial<PassportAgent> = {}): PassportAgent => ({
  id: "a1",
  name: "Sarah Miller",
  title: "Vehicle Specialist",
  phone: "8605551212",
  smsNumber: "8605551212",
  email: "sarah@dealer.com",
  status: "available",
  acceptsPassportLeads: true,
  workingHours: [],
  ...over,
});

const settings = (over: Partial<CustomerPassportContactSettings> = {}): CustomerPassportContactSettings => ({
  ...DEFAULT_CONTACT_ROUTING,
  dealershipDefaultContact: { salesPhone: "8605550000", salesEmail: "sales@dealer.com" },
  showAgentProfile: true,
  ...over,
});

// A Wednesday at noon UTC keeps hour-window tests deterministic.
const NOON = new Date("2026-07-01T12:00:00Z");

describe("isWithinHours", () => {
  it("returns the fallback for an empty schedule", () => {
    expect(isWithinHours([], NOON, "UTC", true)).toBe(true);
    expect(isWithinHours([], NOON, "UTC", false)).toBe(false);
  });
  it("matches a block covering the current time", () => {
    expect(isWithinHours([{ dayOfWeek: 3, startTime: "09:00", endTime: "17:00" }], NOON, "UTC", false)).toBe(true);
  });
  it("misses a block on another day or outside the window", () => {
    expect(isWithinHours([{ dayOfWeek: 4, startTime: "09:00", endTime: "17:00" }], NOON, "UTC", true)).toBe(false);
    expect(isWithinHours([{ dayOfWeek: 3, startTime: "13:00", endTime: "17:00" }], NOON, "UTC", true)).toBe(false);
  });
});

describe("isAgentAvailable", () => {
  it("rejects agents who opted out, are overridden, or are offline", () => {
    expect(isAgentAvailable(agent({ acceptsPassportLeads: false }), NOON)).toBe(false);
    expect(isAgentAvailable(agent({ manualOverride: "unavailable" }), NOON)).toBe(false);
    expect(isAgentAvailable(agent({ status: "offline" }), NOON)).toBe(false);
    expect(isAgentAvailable(agent({ status: "away" }), NOON)).toBe(false);
  });
  it("manual available override wins over status and hours", () => {
    expect(isAgentAvailable(agent({ status: "offline", manualOverride: "available" }), NOON)).toBe(true);
  });
  it("enforces the open-lead cap", () => {
    expect(isAgentAvailable(agent({ maxOpenLeads: 2, openLeadCount: 2 }), NOON)).toBe(false);
    expect(isAgentAvailable(agent({ maxOpenLeads: 2, openLeadCount: 1 }), NOON)).toBe(true);
  });
});

describe("resolveCustomerPassportRouting", () => {
  it("never returns null — empty everything still yields dealership default", () => {
    const r = resolveCustomerPassportRouting(undefined, { agents: [], now: NOON });
    expect(r.routingTargetType).toBe("dealership_default");
    expect(r.displayMode).toBe("dealership");
  });

  it("dealership_default mode ignores agents", () => {
    const r = resolveCustomerPassportRouting(settings({ contactMode: "dealership_default" }), {
      agents: [agent()], assignedAgentId: "a1", now: NOON,
    });
    expect(r.routingTargetType).toBe("dealership_default");
    expect(r.callLabel).toBe("Call Sales");
  });

  it("bdc mode routes to BDC and shows team language", () => {
    const r = resolveCustomerPassportRouting(
      settings({ contactMode: "bdc", bdcSettings: { enabled: true, bdcPhone: "8605559999", bdcEmail: "bdc@dealer.com", showBdcAsTeam: true } }),
      { agents: [agent()], now: NOON },
    );
    expect(r.routingTargetType).toBe("bdc");
    expect(r.displayMode).toBe("team");
    expect(r.phone).toBe("8605559999");
    expect(r.routingReason).toBe("dealer_bdc_mode");
  });

  it("bdc mode without configuration falls back to dealership", () => {
    const r = resolveCustomerPassportRouting(settings({ contactMode: "bdc" }), { agents: [], now: NOON });
    expect(r.routingTargetType).toBe("dealership_default");
  });

  it("assigned agent mode shows the agent when available", () => {
    const r = resolveCustomerPassportRouting(settings({ contactMode: "assigned_agent" }), {
      agents: [agent()], assignedAgentId: "a1", now: NOON,
    });
    expect(r.routingTargetType).toBe("vehicle_assigned_agent");
    expect(r.displayName).toBe("Sarah is here to help.");
    expect(r.callLabel).toBe("Call Sarah");
    expect(r.contactLabel).toBe("Text Sarah");
  });

  it("hides the person behind dealership language when showAgentProfile is off", () => {
    const r = resolveCustomerPassportRouting(settings({ contactMode: "assigned_agent", showAgentProfile: false }), {
      agents: [agent()], assignedAgentId: "a1", now: NOON,
    });
    expect(r.routingTargetType).toBe("vehicle_assigned_agent");
    expect(r.routingTargetId).toBe("a1");
    expect(r.displayMode).toBe("dealership");
    expect(r.displayName).toBe("Our specialists are here to help.");
    expect(r.phone).toBe("8605551212"); // still rings the agent
  });

  it("unavailable assigned agent falls through the priority ladder", () => {
    const r = resolveCustomerPassportRouting(
      settings({ contactMode: "assigned_agent", bdcSettings: { enabled: true, bdcPhone: "8605559999", showBdcAsTeam: true } }),
      { agents: [agent({ manualOverride: "unavailable" })], assignedAgentId: "a1", now: NOON },
    );
    expect(r.routingTargetType).toBe("bdc");
  });

  it("smart routing prefers the CRM owner over the assigned agent", () => {
    const owner = agent({ id: "owner", name: "Mike Chen" });
    const r = resolveCustomerPassportRouting(settings(), {
      agents: [agent(), owner], assignedAgentId: "a1", crmOwnerAgentId: "owner", now: NOON,
    });
    expect(r.routingTargetType).toBe("crm_owner");
    expect(r.callLabel).toBe("Call Mike");
  });

  it("rotation picks the longest-idle available agent and skips unavailable ones", () => {
    const a = agent({ id: "a", name: "Amy Ortiz" });
    const b = agent({ id: "b", name: "Ben Lee" });
    const c = agent({ id: "c", name: "Cara Diaz", status: "offline" });
    const r = resolveCustomerPassportRouting(settings(), {
      agents: [a, b, c],
      rotationState: { a: "2026-07-01T10:00:00Z", b: "2026-06-30T10:00:00Z", c: "2026-01-01T00:00:00Z" },
      now: NOON,
    });
    expect(r.routingTargetType).toBe("sales_rotation");
    expect(r.routingTargetId).toBe("b");
  });

  it("after hours skips live tiers, uses capture copy, and never says Available now", () => {
    const r = resolveCustomerPassportRouting(
      settings({ businessHours: [{ dayOfWeek: 3, startTime: "09:00", endTime: "10:00" }], timezone: "UTC" }),
      { agents: [agent()], assignedAgentId: "a1", now: NOON },
    );
    expect(r.afterHours).toBe(true);
    expect(r.displayMode).toBe("dealership");
    expect(r.availabilityLabel).toBeUndefined();
    expect(r.contactLabel).toBe("Send Message");
    expect(r.afterHoursMessage).toContain("closed right now");
  });

  it("after hours honors bdc_capture", () => {
    const r = resolveCustomerPassportRouting(
      settings({
        businessHours: [{ dayOfWeek: 3, startTime: "09:00", endTime: "10:00" }], timezone: "UTC",
        afterHoursBehavior: { mode: "bdc_capture", message: "We follow up at open." },
        bdcSettings: { enabled: true, bdcEmail: "bdc@dealer.com", showBdcAsTeam: true },
      }),
      { agents: [], now: NOON },
    );
    expect(r.routingTargetType).toBe("bdc");
    expect(r.afterHours).toBe(true);
  });
});

describe("closedPillCopy", () => {
  it("mirrors the resolved display mode", () => {
    const agentR = resolveCustomerPassportRouting(settings({ contactMode: "assigned_agent" }), {
      agents: [agent()], assignedAgentId: "a1", now: NOON,
    });
    expect(closedPillCopy(agentR)).toEqual({ title: "Sarah is ready to help", sub: "Reserve · Trade · Ask Sarah" });
    expect(closedPillCopy(null).sub).toBe("Reserve · Trade · Talk to us");
  });
});

describe("normalizeContactRouting", () => {
  it("layers stored partials over defaults", () => {
    const n = normalizeContactRouting({ contactMode: "bdc", agentDisplayRules: { nameDisplay: "full_name" } });
    expect(n.contactMode).toBe("bdc");
    expect(n.agentDisplayRules.nameDisplay).toBe("full_name");
    expect(n.agentDisplayRules.showPhoto).toBe(true);
    expect(n.routingPriority[0]).toBe("crm_owner");
  });
});

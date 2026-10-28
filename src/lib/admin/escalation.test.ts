import { describe, it, expect } from "vitest";
import {
  auditDetails,
  buildTierPlan,
  classifySendResponse,
  cutoffIso,
  dueLeads,
  effectiveMethods,
  escalationHtml,
  readyTiers,
  shouldAdvance,
  unansweredMinutes,
  unseenIds,
} from "../../../supabase/functions/_shared/escalation";
import { DEFAULT_CONTACT_ROUTING } from "@/lib/passportRouting";

const NOW = Date.parse("2026-10-28T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("notification methods", () => {
  it("sends email for a missing list and for the untouched legacy default, which predates the choice", () => {
    expect(effectiveMethods({ notifyMethods: ["crm_task", "dashboard_alert"] })).toEqual(["email"]);
    expect(effectiveMethods({})).toEqual(["email"]);
    expect(effectiveMethods(undefined)).toEqual(["email"]);
  });

  it("honours an explicit choice: email when chosen, nothing when the list is empty or only unsupported", () => {
    expect(effectiveMethods({ notifyMethods: ["email", "sms"] })).toEqual(["email"]);
    expect(effectiveMethods({ notifyMethods: [] })).toEqual([]);
    expect(effectiveMethods({ notifyMethods: ["sms"] })).toEqual([]);
    expect(effectiveMethods({ notifyMethods: ["dashboard_alert"] })).toEqual([]);
  });
});

describe("tier plan", () => {
  it("reads the default rules as two tiers with no destination, so nothing can send", () => {
    const plan = buildTierPlan(DEFAULT_CONTACT_ROUTING);
    expect(plan.enabled).toBe(true);
    expect(plan.tiers.map((t) => [t.key, t.afterMinutes])).toEqual([["bdc", 5], ["manager", 10]]);
    expect(plan.blockers).toHaveLength(2);
    expect(readyTiers(plan)).toEqual([]);
  });

  it("resolves destinations from the BDC and manager settings and keeps the first response as a target, not a tier", () => {
    const plan = buildTierPlan({
      escalationRules: { enabled: true, firstResponseSlaMinutes: 5, escalateToBdcAfterMinutes: 5, escalateToManagerAfterMinutes: 10 },
      bdcSettings: { bdcEmail: "bdc@example.test" },
      managerFallback: { managerEmail: "manager@example.test" },
    });
    expect(plan.firstResponseSlaMinutes).toBe(5);
    expect(readyTiers(plan).map((t) => t.to)).toEqual(["bdc@example.test", "manager@example.test"]);
    expect(plan.blockers).toEqual([]);
  });

  it("rejects a malformed destination and a disabled rule set", () => {
    const plan = buildTierPlan({ escalationRules: { enabled: true, firstResponseSlaMinutes: 5, escalateToManagerAfterMinutes: 10 }, bdcSettings: { bdcEmail: "not an email" } });
    expect(plan.tiers.find((t) => t.key === "bdc")?.to).toBeNull();
    const off = buildTierPlan({ escalationRules: { enabled: false, firstResponseSlaMinutes: 5, escalateToBdcAfterMinutes: 5 }, bdcSettings: { bdcEmail: "bdc@example.test" } });
    expect(readyTiers(off)).toEqual([]);
  });

  it("drops a tier whose time is zero or missing", () => {
    const plan = buildTierPlan({ escalationRules: { enabled: true, firstResponseSlaMinutes: 0, escalateToBdcAfterMinutes: 0, escalateToManagerAfterMinutes: 10 }, managerFallback: { managerEmail: "m@example.test" } });
    expect(plan.tiers.map((t) => t.key)).toEqual(["manager"]);
  });
});

describe("due leads", () => {
  const tier = { level: 1 as const, key: "bdc" as const, label: "BDC desk", afterMinutes: 5, to: "bdc@example.test" };

  it("selects unanswered leads older than the cutoff that have not reached the tier", () => {
    const leads = [
      { id: "old", created_at: minutesAgo(6), escalation_level: 0 },
      { id: "fresh", created_at: minutesAgo(2), escalation_level: 0 },
      { id: "done", created_at: minutesAgo(30), escalation_level: 1 },
      { id: "null-level", created_at: minutesAgo(30), escalation_level: null },
      { id: "answered", created_at: minutesAgo(30), escalation_level: 0, first_response_at: minutesAgo(1) },
      { id: "closed", created_at: minutesAgo(30), escalation_level: 0, status: "won" },
    ];
    expect(dueLeads(leads, tier, NOW).map((l) => l.id)).toEqual(["old", "null-level"]);
  });

  it("derives the cutoff from the reference clock", () => {
    expect(cutoffIso(5, NOW)).toBe(minutesAgo(5));
    expect(unansweredMinutes(minutesAgo(7), NOW)).toBe(7);
  });
});

describe("delivery outcome", () => {
  it("treats a 2xx as accepted, never as delivered, and anything else as failed", () => {
    expect(classifySendResponse({ ok: true, status: 200 })).toBe("accepted");
    expect(classifySendResponse({ ok: false, status: 500 })).toBe("failed");
    expect(classifySendResponse({ ok: false, status: 429 })).toBe("failed");
    expect(classifySendResponse(null)).toBe("failed");
    expect(classifySendResponse({ ok: true, status: 200 }, new Error("network"))).toBe("failed");
  });

  it("advances a lead only on acceptance", () => {
    expect(shouldAdvance("accepted")).toBe(true);
    expect(shouldAdvance("failed")).toBe(false);
    expect(shouldAdvance("no_supported_method")).toBe(false);
  });

  it("records no recipient details in the audit row", () => {
    const d = auditDetails({ level: 1, label: "BDC desk", unansweredMinutes: 7, outcome: "accepted", method: "email", httpStatus: 202, storeId: "store-1" });
    expect(d).toEqual({ level: 1, to: "BDC desk", unanswered_minutes: 7, outcome: "accepted", method: "email", http_status: 202, store_id: "store-1" });
    expect(JSON.stringify(d)).not.toMatch(/@/);
  });

  it("escapes the lead details in the email body", () => {
    const html = escalationHtml({ name: "<b>Example</b>", phone: null, email: "e@example.test", vehicle_interest: "Example", vehicle_vin: "X" }, { level: 1, key: "bdc", label: "BDC desk", afterMinutes: 5, to: "b@example.test" }, 7);
    expect(html).toContain("&lt;b&gt;Example&lt;/b&gt;");
    expect(html).not.toContain("<b>Example</b>");
  });

  it("ends a page loop when nothing new comes back", () => {
    expect(unseenIds(["a", "b"], new Set(["a"]))).toEqual(["b"]);
    expect(unseenIds(["a"], new Set(["a"]))).toEqual([]);
  });
});

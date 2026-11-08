// L04: the audited routing configuration is reported as NOT ready, with the
// exact missing pieces, and nothing is filled in on the owner's behalf.
import { describe, it, expect } from "vitest";
import { deriveRoutingReadiness } from "./effectivePolicy";

describe("L04 — routing readiness blocks an unsupported launch claim", () => {
  it("smart routing + rotation on, no salespeople, fallbacks off, no store contact or hours", () => {
    const r = deriveRoutingReadiness({
      salesRotationSettings: { enabled: true },
      managerFallback: { enabled: false },
      bdcSettings: { enabled: false },
      dealershipDefaultContact: { salesPhone: "", salesEmail: "" },
      businessHours: [],
      escalationRules: { enabled: true, escalateToBdcAfterMinutes: 10, escalateToManagerAfterMinutes: 30 },
    } as never, []);
    expect(r.ready).toBe(false);
    const keys = r.checks.filter((c) => c.state === "missing").map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["default_contact", "sales_rotation", "escalation"]));
    expect(r.warnings.join(" ")).toMatch(/No business hours/);
  });
});

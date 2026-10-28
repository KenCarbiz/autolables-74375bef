import { describe, it, expect } from "vitest";
import { deriveEffectivePolicy, deriveRoutingReadiness } from "./effectivePolicy";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { DEFAULT_CONTACT_ROUTING } from "@/lib/passportRouting";

const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe("routing readiness", () => {
  it("is incomplete when the store has no default contact", () => {
    const r = deriveRoutingReadiness(DEFAULT_CONTACT_ROUTING, []);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/store contact/i);
  });

  it("lists the default configuration's two gaps: rotation with no roster and escalation tiers with no destination", () => {
    const r = deriveRoutingReadiness({ ...DEFAULT_CONTACT_ROUTING, dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" } }, []);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === "sales_rotation")?.state).toBe("missing");
    expect(r.checks.find((c) => c.key === "escalation")?.state).toBe("missing");
  });

  it("is ready once a default contact exists and every enabled fallback has a destination", () => {
    const cfg = {
      ...DEFAULT_CONTACT_ROUTING,
      dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" },
      salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, enabled: false },
      escalationRules: { ...DEFAULT_CONTACT_ROUTING.escalationRules, enabled: false },
      managerFallback: { enabled: true, managerEmail: "manager@example.test", managerPhone: "" },
    };
    const r = deriveRoutingReadiness(cfg, []);
    expect(r.blockers).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("accepts escalation when both tiers resolve to a destination", () => {
    const cfg = {
      ...DEFAULT_CONTACT_ROUTING,
      dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" },
      salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, enabled: false },
      bdcSettings: { enabled: true, showBdcAsTeam: true, bdcEmail: "bdc@example.test" },
      managerFallback: { enabled: true, managerEmail: "manager@example.test" },
    };
    expect(deriveRoutingReadiness(cfg, []).ready).toBe(true);
  });

  it("blocks when a fallback is enabled without a destination", () => {
    const cfg = {
      ...DEFAULT_CONTACT_ROUTING,
      dealershipDefaultContact: { ...DEFAULT_CONTACT_ROUTING.dealershipDefaultContact, salesEmail: "sales@example.test" },
      managerFallback: { enabled: true, managerEmail: "", managerPhone: "" },
    };
    const r = deriveRoutingReadiness(cfg, []);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === "manager_recipient")?.state).toBe("missing");
  });

  it("blocks rotation with no salesperson able to receive leads", () => {
    const cfg = {
      ...DEFAULT_CONTACT_ROUTING,
      dealershipDefaultContact: { salesPhone: "", salesEmail: "sales@example.test" },
      salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, enabled: true },
      escalationRules: { ...DEFAULT_CONTACT_ROUTING.escalationRules, enabled: false },
    };
    expect(deriveRoutingReadiness(cfg, []).ready).toBe(false);
    const one = deriveRoutingReadiness(cfg, [{ id: "a", name: "Example", status: "available", acceptsPassportLeads: true, workingHours: [] }]);
    expect(one.ready).toBe(true);
    expect(one.checks.find((c) => c.key === "sales_rotation")?.state).toBe("warning");
  });
});

describe("effective policy summary", () => {
  it("reads the price basis from the doc fee keys", () => {
    const rows = deriveEffectivePolicy({ settings: settings({ doc_fee_enabled: true, doc_fee_amount: 895 }) });
    const price = rows.find((r) => r.key === "price_basis")!;
    expect(price.value).toBe("Doc fee included");
    expect(price.detail).toMatch(/\$895/);
    expect(price.href).toContain("price-rules");
  });

  it("reports review rules when manager approval before publish is on", () => {
    const rows = deriveEffectivePolicy({ settings: settings({ ingest_auto_publish: false, document_rules: { requireApprovalBeforePublish: true } }) });
    expect(rows.find((r) => r.key === "publishing")?.value).toBe("Review rules");
  });

  it("flags auto-publish and review-before-publish as a conflict instead of hiding one", () => {
    const rows = deriveEffectivePolicy({ settings: settings({ ingest_auto_publish: true, document_rules: { requireApprovalBeforePublish: true } }) });
    expect(rows.find((r) => r.key === "publishing")?.state).toBe("conflict");
  });

  it("reports the used/CPO inspection gate from the server-enforced key", () => {
    expect(deriveEffectivePolicy({ settings: settings({ require_safety_inspection: true }) }).find((r) => r.key === "used_cpo")?.value).toBe("K208 where applicable");
    expect(deriveEffectivePolicy({ settings: settings({ require_safety_inspection: false }) }).find((r) => r.key === "used_cpo")?.value).toBe("No inspection gate");
  });

  it("reports routing as incomplete from the same readiness rule the editor uses", () => {
    const rows = deriveEffectivePolicy({ settings: settings() });
    const routing = rows.find((r) => r.key === "routing")!;
    expect(routing.state).toBe("incomplete");
    expect(routing.value).toBe("Fallback incomplete");
  });
});

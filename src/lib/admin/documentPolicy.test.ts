import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_RULES, type DocumentRules } from "@/lib/documentRules";
import { knownCount } from "@/lib/admin/health";
import type { AuditLogEntry } from "@/types/tenant";
import {
  deriveDocumentReadiness,
  describeRuleChanges,
  documentRuleRows,
  documentRuleWarnings,
  familyPolicySentence,
  formatServiceValue,
  latestPolicyChange,
  servicePolicyFromSettings,
  servicePolicyValidation,
  servicePolicyWarnings,
  type ServiceGateContext,
  type ServicePolicy,
} from "./documentPolicy";

const gatesOff: ServiceGateContext = { k208Required: false, k208Roles: [], licenseeCertification: false, installVerification: false };
const NOW = Date.UTC(2031, 2, 20, 12, 0, 0);

describe("documentRuleRows", () => {
  it("derives approval and refresh text from the rules in force", () => {
    const rows = documentRuleRows(DEFAULT_DOCUMENT_RULES, gatesOff);
    expect(rows.map((r) => r.document)).toEqual(["Window sticker", "Buyers Guide", "Addendum", "Inspection record"]);
    expect(rows[0].approval).toBe("Manager before publish");
    expect(rows[0].refreshAfter).toBe("Price, MSRP, Sold or removed");
    expect(rows[2].approval).toBe("Manager before publish, packet send");
    expect(rows[2].refreshAfter).toBe("Price, Products, Sold or removed");
    expect(rows[3].approval).toBe("Not required before signing");
  });

  it("reads the inspection row from the service gates, not the document rules", () => {
    const rows = documentRuleRows(DEFAULT_DOCUMENT_RULES, { ...gatesOff, k208Required: true, k208Roles: ["service_manager"], licenseeCertification: true });
    expect(rows[3].appliesTo).toBe("Used & CPO, before signing");
    expect(rows[3].approval).toBe("Authorized signer (Service Manager) + licensee certification");
  });

  it("says Never and No approval gate when everything is off", () => {
    const off = Object.fromEntries(Object.keys(DEFAULT_DOCUMENT_RULES).map((k) => [k, false])) as unknown as DocumentRules;
    const rows = documentRuleRows(off, gatesOff);
    expect(rows[0].approval).toBe("No approval gate");
    expect(rows[0].refreshAfter).toBe("Never");
    expect(familyPolicySentence("window_sticker", off, gatesOff)).toBe("Window sticker documents are not marked for review by vehicle changes.");
    expect(familyPolicySentence("addendum", DEFAULT_DOCUMENT_RULES, gatesOff)).toBe("Addendum documents are marked for review when price, products, sold or removed changes.");
    expect(familyPolicySentence("inspection_record", DEFAULT_DOCUMENT_RULES, { ...gatesOff, k208Required: true })).toMatch(/required before customer signing/);
  });
});

describe("describeRuleChanges and warnings", () => {
  it("lists only the keys that differ and warns on removed gates and automation", () => {
    const after = { ...DEFAULT_DOCUMENT_RULES, requireApprovalBeforePublish: false, autoPublishApprovedWindow: true };
    const changes = describeRuleChanges(DEFAULT_DOCUMENT_RULES, after);
    expect(changes.map((c) => c.key).sort()).toEqual(["autoPublishApprovedWindow", "requireApprovalBeforePublish"]);
    const warnings = documentRuleWarnings(DEFAULT_DOCUMENT_RULES, after);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.startsWith("Removes a gate"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("Automatic behavior"))).toBe(true);
  });

  it("is empty when nothing changed", () => {
    expect(describeRuleChanges(DEFAULT_DOCUMENT_RULES, { ...DEFAULT_DOCUMENT_RULES })).toEqual([]);
    expect(documentRuleWarnings(DEFAULT_DOCUMENT_RULES, { ...DEFAULT_DOCUMENT_RULES })).toEqual([]);
  });
});

describe("deriveDocumentReadiness", () => {
  it("renders a failed read as Unknown, never as zero", () => {
    const items = deriveDocumentReadiness({ calibration: { kind: "failed" }, templatesConfigured: { kind: "failed" }, disclosuresMissing: { kind: "failed" }, templateSlots: 4, now: NOW });
    expect(items.map((i) => i.chip)).toEqual(["Unknown", "Unknown", "Unknown"]);
    expect(items.every((i) => i.state === "unknown")).toBe(true);
    expect(JSON.stringify(items)).not.toMatch(/"0 /);
  });

  it("needs setup without a profile and needs a test when no test is recorded", () => {
    const none = deriveDocumentReadiness({ calibration: { kind: "known", saved: false, savedAt: null, testedAt: null }, templatesConfigured: knownCount(0), disclosuresMissing: knownCount(0), templateSlots: 4, now: NOW });
    expect(none[0].chip).toBe("Needs setup");
    expect(none[1].chip).toBe("None configured");
    expect(none[2].chip).toBe("Complete");

    const saved = deriveDocumentReadiness({
      calibration: { kind: "known", saved: true, savedAt: new Date(NOW - 5 * 3_600_000).toISOString(), testedAt: null },
      templatesConfigured: knownCount(4),
      disclosuresMissing: knownCount(2),
      templateSlots: 4,
      now: NOW,
    });
    expect(saved[0].chip).toBe("Needs test");
    expect(saved[0].detailValue).toBe("5 h ago, no test recorded");
    expect(saved[1].chip).toBe("4 configured");
    expect(saved[2].chip).toBe("Review required");
    expect(saved[2].detailValue).toBe("2 missing disclosure text");
  });

  it("counts a partial slot set and a capped scan honestly", () => {
    const items = deriveDocumentReadiness({ calibration: { kind: "loading" }, templatesConfigured: knownCount(2), disclosuresMissing: knownCount(500, true), templateSlots: 4, now: NOW });
    expect(items[0].chip).toBe("Checking");
    expect(items[1].chip).toBe("2 of 4 configured");
    expect(items[2].detailValue).toBe("500+ missing disclosure text");
  });
});

describe("service policy", () => {
  const base: ServicePolicy = {
    require_safety_inspection: true,
    k208_authority_roles: ["service_manager"],
    require_k208_licensee_certification: false,
    require_install_verification: true,
    recon_auto_approve_amount: 500,
    recon_approval_email: "",
    prep_require_ro: true,
    prep_detail_photos_required: false,
    prep_service_photo_tasks: "Mud flaps installed",
  };

  it("normalizes a sparse settings row into a complete snapshot", () => {
    const p = servicePolicyFromSettings({ ...base, recon_auto_approve_amount: Number.NaN, k208_authority_roles: undefined as unknown as string[], recon_approval_email: undefined as unknown as string });
    expect(p.recon_auto_approve_amount).toBe(500);
    expect(p.k208_authority_roles).toEqual([]);
    expect(p.recon_approval_email).toBe("");
    expect(p.k208_authority_roles).not.toBe(base.k208_authority_roles);
  });

  it("warns when a gate is removed or an amount is raised", () => {
    expect(servicePolicyWarnings(base, { ...base, require_safety_inspection: false })[0]).toMatch(/without a completed K-208/);
    expect(servicePolicyWarnings(base, { ...base, k208_authority_roles: [] })[0]).toMatch(/anonymous QR sign-off/);
    expect(servicePolicyWarnings(base, { ...base, recon_auto_approve_amount: 800 })[0]).toMatch(/\$800/);
    expect(servicePolicyWarnings(base, { ...base })).toEqual([]);
  });

  it("validates recipients and amounts", () => {
    expect(servicePolicyValidation({ ...base, recon_approval_email: "not-an-email" })).toHaveLength(1);
    expect(servicePolicyValidation({ ...base, recon_approval_email: "a@example.test, b@example.test" })).toEqual([]);
    expect(servicePolicyValidation({ ...base, recon_auto_approve_amount: -1 })).toHaveLength(1);
  });

  it("formats values for the review table", () => {
    expect(formatServiceValue("k208_authority_roles", [])).toBe("Any signed K-208");
    expect(formatServiceValue("k208_authority_roles", ["service_manager", "owner"])).toBe("Service Manager, Owner");
    expect(formatServiceValue("recon_auto_approve_amount", 750)).toBe("$750");
    expect(formatServiceValue("prep_require_ro", true)).toBe("On");
    expect(formatServiceValue("recon_approval_email", "  ")).toBe("None");
  });
});

describe("latestPolicyChange", () => {
  const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
    id: "x",
    store_id: "t",
    user_id: "u",
    action: "settings_updated",
    entity_type: "dealer_settings",
    entity_id: "t",
    details: {},
    ip_address: "",
    created_at: "2031-03-01T00:00:00Z",
    ...over,
  });

  it("finds the newest row mentioning one of the keys, in either audit shape", () => {
    const rows = [
      entry({ id: "a", created_at: "2031-03-01T00:00:00Z", details: { keys: ["document_rules"] } }),
      entry({ id: "b", action: "service_policy_changed", created_at: "2031-03-05T00:00:00Z", details: { keys: ["require_safety_inspection"], prev: {}, next: {} }, user_email: "manager@example.test" }),
      entry({ id: "c", action: "listing_published", created_at: "2031-03-09T00:00:00Z", details: { keys: ["document_rules"] } }),
      entry({ id: "d", created_at: "2031-02-20T00:00:00Z", details: { document_rules: { trackQrScans: false } } }),
    ];
    expect(latestPolicyChange(rows, ["document_rules"])?.at).toBe("2031-03-01T00:00:00Z");
    expect(latestPolicyChange(rows, ["require_safety_inspection"])?.by).toBe("manager@example.test");
    expect(latestPolicyChange(rows, ["doc_fee"])).toBeNull();
    expect(latestPolicyChange([], ["document_rules"])).toBeNull();
  });
});

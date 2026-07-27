import { describe, it, expect } from "vitest";
import {
  classifyStaleness,
  evaluateApprovalEligibility,
  configurationChecksum,
  canAcknowledge,
  NON_ACKNOWLEDGEABLE_FINDINGS,
  type StoredConfig,
  type ApprovalEligibilityInput,
} from "../../../supabase/functions/_shared/description-approval";

// Approval is a server-side decision. These tests pin the two properties that
// make it trustworthy: a blocking defect can never be waived, and a foreign
// tenant learns nothing from the answer it gets.

const NOW = "2026-07-27T12:00:00.000Z";

const CONFIG: StoredConfig = {
  truthSnapshotVersion: "sdv_aaaa",
  channelPolicyVersion: "cp_autotrader_1.abcdef",
  voiceProfileVersion: "vp_1",
  toneVersion: "tone_1",
  localSeoVersion: "seo_1",
  mileage: 13127,
  price: 48995,
  priceIncludedInCopy: false,
  condition: "used",
  cpoStatus: null,
  warrantyStatus: "remaining factory coverage",
  dealerName: "Harte INFINITI",
  dealerCity: "Manchester",
  requiredDisclosures: ["Plus tax, title and dealer fees."],
  ctaText: "Contact Harte INFINITI to schedule a test drive.",
  vehicleStatus: "active",
};

const cfg = (over: Partial<StoredConfig> = {}): StoredConfig => ({ ...CONFIG, ...over });

const FRESH = classifyStaleness(CONFIG, CONFIG);

const base = (over: Partial<ApprovalEligibilityInput> = {}): ApprovalEligibilityInput => ({
  versionExists: true,
  versionTenantId: "t1",
  callerTenantId: "t1",
  isWorkingDraft: false,
  isSuperseded: false,
  isWithdrawn: false,
  validationComplete: true,
  automatedFindings: [],
  humanFindings: [],
  requiredReviewsCompleted: 1,
  requiredReviewCount: 1,
  checklistComplete: true,
  reviewPolicyActive: true,
  channelPolicyActive: true,
  disclosuresPresent: true,
  ctaValid: true,
  scoreComplete: true,
  staleness: FRESH,
  hasApprovalPermission: true,
  attestationAccepted: true,
  acknowledgedWarnings: [],
  policyAllowsWarningAcknowledgement: true,
  now: NOW,
  ...over,
});

describe("evaluateApprovalEligibility", () => {
  it("approves a version where every requirement is satisfied", () => {
    const r = evaluateApprovalEligibility(base());
    expect(r.verdict).toBe("eligible");
    expect(r.blockingRuleIds).toEqual([]);
    expect(r.warningRuleIds).toEqual([]);
    expect(r.evaluatedAt).toBe(NOW);
    expect(r.requiredNextAction.length).toBeGreaterThan(0);
  });

  it("blocks on an automated blocking finding", () => {
    const r = evaluateApprovalEligibility(base({
      automatedFindings: [{ validator_code: "CPO_CLAIM", blocking: true, severity: "blocking" }],
    }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("CPO_CLAIM");
    expect(r.requiredNextAction).toMatch(/cannot be acknowledged/i);
  });

  it("blocks on a human blocking finding just as hard", () => {
    const r = evaluateApprovalEligibility(base({
      humanFindings: [{ validator_code: "REVIEWER_REJECTED_CLAIM", blocking: true, severity: "blocking" }],
    }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("REVIEWER_REJECTED_CLAIM");
  });

  it("blocks even when a blocking finding was 'acknowledged'", () => {
    const r = evaluateApprovalEligibility(base({
      automatedFindings: [{ validator_code: "SOURCE_CONFLICT_UNRESOLVED", blocking: true, severity: "blocking" }],
      acknowledgedWarnings: ["SOURCE_CONFLICT_UNRESOLVED"],
    }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("SOURCE_CONFLICT_UNRESOLVED");
  });

  it("allows an acknowledged warning when policy permits", () => {
    const r = evaluateApprovalEligibility(base({
      automatedFindings: [{ validator_code: "CTA_MISSING", blocking: false, severity: "warning" }],
      acknowledgedWarnings: ["CTA_MISSING"],
      policyAllowsWarningAcknowledgement: true,
    }));
    expect(r.verdict).toBe("eligible_with_warnings");
    expect(r.warningRuleIds).toEqual(["CTA_MISSING"]);
    expect(r.blockingRuleIds).toEqual([]);
  });

  it("refuses an unacknowledged warning, and refuses acknowledgement when policy forbids it", () => {
    const withWarning = {
      automatedFindings: [{ validator_code: "CTA_MISSING", blocking: false, severity: "warning" as const }],
    };
    const unacknowledged = evaluateApprovalEligibility(base(withWarning));
    expect(unacknowledged.verdict).toBe("ineligible");
    expect(unacknowledged.blockingRuleIds).toContain("WARNING_NOT_ACKNOWLEDGED");

    const forbidden = evaluateApprovalEligibility(base({
      ...withWarning,
      policyAllowsWarningAcknowledgement: false,
    }));
    expect(forbidden.verdict).toBe("ineligible");
    expect(forbidden.blockingRuleIds).toContain("WARNING_ACKNOWLEDGEMENT_NOT_PERMITTED");
  });

  it("never lets a fact-bearing code be acknowledged, even at warning severity", () => {
    for (const code of ["CPO_CLAIM", "WARRANTY_CLAIM", "REQUIRED_DISCLOSURE_MISSING",
                        "SOURCE_CONFLICT_UNRESOLVED", "UNSUPPORTED_FEATURE_CLAIM",
                        "DEALER_ADDED_AS_FACTORY", "IDENTITY_YEAR_CONFLICT",
                        "OWNERSHIP_CLAIM", "HISTORY_CLAIM", "EXCLUDED_CLAIM_PRESENT"]) {
      expect(canAcknowledge(code)).toBe(false);
      expect(NON_ACKNOWLEDGEABLE_FINDINGS.has(code)).toBe(true);
      const r = evaluateApprovalEligibility(base({
        automatedFindings: [{ validator_code: code, blocking: false, severity: "warning" }],
        acknowledgedWarnings: [code],
        policyAllowsWarningAcknowledgement: true,
      }));
      expect(r.verdict).toBe("ineligible");
      expect(r.blockingRuleIds).toContain(code);
      expect(r.warningRuleIds).not.toContain(code);
    }
    expect(canAcknowledge("CTA_MISSING")).toBe(true);
    expect(canAcknowledge("LENGTH_BELOW_MINIMUM")).toBe(true);
  });

  it("refuses a cross-tenant version without revealing that it exists", () => {
    const foreign = evaluateApprovalEligibility(base({ versionTenantId: "t2" }));
    const missing = evaluateApprovalEligibility(base({ versionExists: false, versionTenantId: null }));
    expect(foreign.verdict).toBe("ineligible");
    expect(missing.verdict).toBe("ineligible");
    expect(foreign.blockingRuleIds).toEqual(["VERSION_NOT_AVAILABLE"]);
    expect(foreign.reasons).toEqual(missing.reasons);
    expect(foreign.blockingRuleIds).toEqual(missing.blockingRuleIds);
    expect(foreign.requiredNextAction).toBe(missing.requiredNextAction);
  });

  it("refuses a working draft", () => {
    const r = evaluateApprovalEligibility(base({ isWorkingDraft: true }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("VERSION_IS_WORKING_DRAFT");
  });

  it("refuses a superseded version", () => {
    const r = evaluateApprovalEligibility(base({ isSuperseded: true }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("VERSION_SUPERSEDED");
  });

  it("refuses a withdrawn version", () => {
    const r = evaluateApprovalEligibility(base({ isWithdrawn: true }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("VERSION_WITHDRAWN");
  });

  it("refuses an approver without permission", () => {
    const r = evaluateApprovalEligibility(base({ hasApprovalPermission: false }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("APPROVAL_PERMISSION_MISSING");
  });

  it("refuses an approval without the attestation", () => {
    const r = evaluateApprovalEligibility(base({ attestationAccepted: false }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("ATTESTATION_NOT_ACCEPTED");
  });

  it("refuses an incomplete checklist", () => {
    const r = evaluateApprovalEligibility(base({ checklistComplete: false }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("CHECKLIST_INCOMPLETE");
  });

  it("refuses when the required review count is not met", () => {
    const r = evaluateApprovalEligibility(base({ requiredReviewCount: 2, requiredReviewsCompleted: 1 }));
    expect(r.verdict).toBe("ineligible");
    expect(r.blockingRuleIds).toContain("REQUIRED_REVIEWS_INCOMPLETE");
    expect(r.requiredNextAction).toMatch(/1 more review/);
  });

  it("refuses when validation or scoring has not finished", () => {
    expect(evaluateApprovalEligibility(base({ validationComplete: false })).blockingRuleIds)
      .toContain("VALIDATION_INCOMPLETE");
    expect(evaluateApprovalEligibility(base({ scoreComplete: false })).blockingRuleIds)
      .toContain("SCORE_INCOMPLETE");
  });

  it("blocks approval when staleness requires reapproval, and not when it is informational", () => {
    const material = evaluateApprovalEligibility(base({
      staleness: classifyStaleness(CONFIG, cfg({ truthSnapshotVersion: "sdv_bbbb" })),
    }));
    expect(material.verdict).toBe("ineligible");
    expect(material.blockingRuleIds).toContain("STALE_REAPPROVAL_REQUIRED");

    const harmless = evaluateApprovalEligibility(base({
      staleness: classifyStaleness(CONFIG, cfg({ toneVersion: "tone_2" })),
    }));
    expect(harmless.verdict).toBe("eligible");
  });
});

describe("classifyStaleness", () => {
  it("reports nothing when nothing changed", () => {
    const r = classifyStaleness(CONFIG, CONFIG);
    expect(r.signals).toEqual([]);
    expect(r.worst).toBe("none");
  });

  it("treats a price change as informational when the copy states no price", () => {
    const r = classifyStaleness(CONFIG, cfg({ price: 47500 }));
    expect(r.worst).toBe("informational");
    const s = r.signals.find((x) => x.field === "price");
    expect(s?.classification).toBe("informational");
    expect(s?.from).toBe("48995");
    expect(s?.to).toBe("47500");
  });

  it("treats a price change as material when the copy states a price", () => {
    const stored = cfg({ priceIncludedInCopy: true });
    const r = classifyStaleness(stored, { ...stored, price: 47500 });
    expect(r.worst).toBe("reapproval_required");
    expect(r.signals.find((x) => x.field === "price")?.classification).toBe("reapproval_required");
  });

  it("requires reapproval when the truth snapshot changes", () => {
    const r = classifyStaleness(CONFIG, cfg({ truthSnapshotVersion: "sdv_bbbb" }));
    expect(r.worst).toBe("reapproval_required");
    expect(r.signals.find((x) => x.field === "truth_snapshot_version")?.classification)
      .toBe("reapproval_required");
  });

  it("requires reapproval when required disclosures change", () => {
    const r = classifyStaleness(CONFIG, cfg({
      requiredDisclosures: ["Plus tax, title and dealer fees.", "Dealer doc fee $85."],
    }));
    expect(r.worst).toBe("reapproval_required");
    expect(r.signals.find((x) => x.field === "required_disclosures")?.classification)
      .toBe("reapproval_required");
  });

  it("ignores disclosure re-ordering", () => {
    const stored = cfg({ requiredDisclosures: ["A disclosure.", "B disclosure."] });
    const r = classifyStaleness(stored, { ...stored, requiredDisclosures: ["B disclosure.", "A disclosure."] });
    expect(r.worst).toBe("none");
  });

  it("requires reapproval on CPO, warranty and dealer-location changes", () => {
    expect(classifyStaleness(CONFIG, cfg({ cpoStatus: "Certified Pre-Owned" })).worst)
      .toBe("reapproval_required");
    expect(classifyStaleness(CONFIG, cfg({ warrantyStatus: null })).worst)
      .toBe("reapproval_required");
    expect(classifyStaleness(CONFIG, cfg({ dealerCity: "Hartford" })).worst)
      .toBe("reapproval_required");
  });

  it("requires revalidation on mileage and channel-policy changes", () => {
    expect(classifyStaleness(CONFIG, cfg({ mileage: 13500 })).worst).toBe("revalidation_required");
    expect(classifyStaleness(CONFIG, cfg({ channelPolicyVersion: "cp_autotrader_1.ffffff" })).worst)
      .toBe("revalidation_required");
  });

  it("blocks publication when the vehicle is no longer sellable", () => {
    const r = classifyStaleness(CONFIG, cfg({ vehicleStatus: "sold" }));
    expect(r.worst).toBe("publication_blocked");
    expect(r.signals.find((x) => x.field === "vehicle_status")?.classification)
      .toBe("publication_blocked");
  });
});

describe("configurationChecksum", () => {
  it("is deterministic and independent of key order", async () => {
    const a = await configurationChecksum({
      truth: "sdv_aaaa", policy: "cp_1", voice: "vp_1", cta: null,
    });
    const b = await configurationChecksum({
      cta: null, voice: "vp_1", policy: "cp_1", truth: "sdv_aaaa",
    });
    const c = await configurationChecksum({
      truth: "sdv_aaaa", policy: "cp_1", voice: "vp_1", cta: null,
    });
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toMatch(/^acfg_[0-9a-f]{24}$/);
  });

  it("changes when any part changes", async () => {
    const a = await configurationChecksum({ truth: "sdv_aaaa", policy: "cp_1" });
    const b = await configurationChecksum({ truth: "sdv_bbbb", policy: "cp_1" });
    expect(a).not.toBe(b);
  });
});

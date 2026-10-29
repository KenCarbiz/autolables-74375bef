import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { knownCount } from "@/lib/admin/health";
import {
  POLICY_ACTION_TERMS,
  classifyHistoryAction,
  publishingPolicyVersion,
  deriveClassDetail,
  derivePublishingMatrix,
  describePublishingImpact,
  publishingDraftFrom,
  publishingDraftWarnings,
  publishingPatchFromDraft,
  validatePublishingDraft,
  type DescriptionPolicy,
} from "./publishingPolicy";

const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });
const description: DescriptionPolicy = { reviewMode: "manual_review", reviewModeByClass: { new: "auto", used: "manual_review" }, internalPublicationEnabled: true };

describe("publishing matrix", () => {
  it("rests listing visibility on the recall triggers and the intake switch for every class", () => {
    const rows = derivePublishingMatrix({ settings: settings({ ingest_auto_publish: true }), description });
    expect(rows.map((r) => r.vehicleClass)).toEqual(["new", "used", "cpo"]);
    for (const r of rows) {
      expect(r.listingVisibility.label).toBe("Auto on intake + recall policy");
      expect(r.listingVisibility.enforcer).toMatch(/enforce_prep_gate/);
      expect(r.listingVisibility.enforcer).toMatch(/trg_recall_unpublish_guard/);
      expect(r.listingVisibility.state).toBe("enforced");
    }
    expect(derivePublishingMatrix({ settings: settings({ ingest_auto_publish: false }), description })[0].listingVisibility.label).toBe("Manual publish + recall policy");
  });

  it("reads document publication from the document rules and the per-class description review mode", () => {
    const rows = derivePublishingMatrix({ settings: settings({ document_rules: { requireApprovalBeforePublish: true } }), description });
    expect(rows[0].documentPublication.label).toBe("Manager approval");
    expect(rows[0].documentPublication.detail).toMatch(/Descriptions: automatic/);
    expect(rows[1].documentPublication.detail).toMatch(/Descriptions: manual review/);
    expect(rows[2].documentPublication.detail).toMatch(/Descriptions: manual review/);
    const open = derivePublishingMatrix({ settings: settings({ document_rules: { requireApprovalBeforePublish: false, autoPublishApprovedWindow: true } }), description });
    expect(open[0].documentPublication.label).toBe("Auto-publish approved");
    expect(open[0].documentPublication.detail).toMatch(/window stickers publish automatically/);
  });

  it("marks document publication unknown when description settings could not be read, never auto", () => {
    const rows = derivePublishingMatrix({ settings: settings(), description: null });
    expect(rows[1].documentPublication.state).toBe("unknown");
    expect(rows[1].documentPublication.label).toMatch(/descriptions unknown/);
    expect(rows[1].documentPublication.detail).toMatch(/could not be read/);
  });

  it("gives new vehicles pre-delivery checks and used or CPO vehicles the inspection gate, from the server-read keys", () => {
    const rows = derivePublishingMatrix({ settings: settings({ require_safety_inspection: true, require_install_verification: true }), description });
    expect(rows[0].retailReadiness.label).toBe("Pre-delivery checks");
    expect(rows[0].retailReadiness.detail).not.toMatch(/K-208/);
    expect(rows[1].retailReadiness.label).toBe("Service + inspection");
    expect(rows[1].retailReadiness.detail).toMatch(/K-208/);
    expect(rows[2].retailReadiness.label).toBe("Service + CPO checks");
    expect(rows[2].retailReadiness.detail).toMatch(/dealer-attested, not a server gate/);
    const none = derivePublishingMatrix({ settings: settings({ require_safety_inspection: false, require_install_verification: false }), description });
    expect(none[0].retailReadiness.state).toBe("open");
    expect(none[1].retailReadiness.label).toBe("No inspection gate");
  });

  it("never claims a prep sign-off gate the live trigger does not read", () => {
    const rows = derivePublishingMatrix({ settings: settings(), description });
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toMatch(/listing_unlocked|foreman/i);
    }
  });

  it("describes overrides by their real authorities", () => {
    const rows = derivePublishingMatrix({ settings: settings({ k208_authority_roles: ["service_manager"] }), description });
    expect(rows[0].overrides.label).toBe("Authorized manager");
    expect(rows[0].overrides.detail).toMatch(/platform admin with a recorded override/);
    expect(rows[0].overrides.detail).toMatch(/authorized roles/);
    const none = derivePublishingMatrix({ settings: settings({ k208_authority_roles: [], document_rules: { allowWarningOverrideWithReason: false } }), description });
    expect(none[0].overrides.label).toBe("Admin only");
    expect(none[0].overrides.detail).toMatch(/warnings: no one/);
  });
});

describe("class detail", () => {
  it("explains the three states without inventing counts", () => {
    const rows = derivePublishingMatrix({ settings: settings({ require_safety_inspection: true, document_rules: { requireApprovalBeforePublish: true } }), description });
    const d = deriveClassDetail(rows[1], settings({ require_safety_inspection: true, document_rules: { requireApprovalBeforePublish: true } }));
    expect(d.cards.map((c) => c.title)).toEqual(["Listing can be visible", "Documents awaiting approval", "Not retail ready"]);
    expect(d.cards[2].explanation).toMatch(/does not prevent the listing from being visible/);
    expect(d.ruleText).toMatch(/^A used vehicle can be listed/);
    expect(d.ruleText).toMatch(/approved before publication/);
    expect(d.approvalRulesHref).toBe("/admin?tab=approval-rules");
    expect(JSON.stringify(d)).not.toMatch(/\d+ vehicles/);
  });

  it("names the retail-readiness gates as a readable list", () => {
    const s = settings({ require_safety_inspection: true, require_install_verification: true, document_rules: { requireApprovalBeforePublish: true } });
    const rows = derivePublishingMatrix({ settings: s, description });
    expect(deriveClassDetail(rows[1], s).ruleText).toMatch(/the vehicle needs a completed K-208 inspection and verified installs to be retail ready\.$/);
    expect(rows[1].retailReadiness.detail).toBe("Signing waits for a completed K-208 inspection and verified installs.");
  });

  it("changes the card titles when no gate applies", () => {
    const s = settings({ require_safety_inspection: false, require_install_verification: false, document_rules: { requireApprovalBeforePublish: false } });
    const d = deriveClassDetail(derivePublishingMatrix({ settings: s, description })[0], s);
    expect(d.cards[1].title).toBe("Documents publish without approval");
    expect(d.cards[2].title).toBe("No retail gate");
  });
});

describe("publishing draft", () => {
  it("reads the six owned keys from settings and writes them back as a merged patch", () => {
    const s = settings({ ingest_auto_publish: false, document_rules: { requireApprovalBeforePublish: false, trackQrScans: false } });
    const draft = publishingDraftFrom(s);
    expect(draft).toEqual({ ingest_auto_publish: false, requireApprovalBeforePublish: false, autoPublishApprovedWindow: false, autoPublishApprovedAddendum: false, autoUnpublishStale: false, hideSupersededPublic: true });
    const patch = publishingPatchFromDraft({ ...draft, autoUnpublishStale: true }, s);
    expect(patch.ingest_auto_publish).toBe(false);
    expect(patch.document_rules?.autoUnpublishStale).toBe(true);
    expect(patch.document_rules?.trackQrScans).toBe(false);
    expect(patch.document_rules?.requireStickerMatchBeforeSigning).toBe(true);
  });

  it("validates shape and warns about contradictory combinations", () => {
    const draft = publishingDraftFrom(settings());
    expect(validatePublishingDraft(draft)).toEqual([]);
    expect(validatePublishingDraft({ ...draft, ingest_auto_publish: "yes" as unknown as boolean })).toHaveLength(1);
    const w = publishingDraftWarnings({ ...draft, ingest_auto_publish: true, requireApprovalBeforePublish: true });
    expect(w.join(" ")).toMatch(/both on/);
    const noApproval = publishingDraftWarnings({ ...draft, requireApprovalBeforePublish: false, autoPublishApprovedWindow: true });
    expect(noApproval.join(" ")).toMatch(/no effect/);
  });

  it("builds an impact that rewrites nothing and blocks apply on an unreadable count", () => {
    const original = publishingDraftFrom(settings());
    const draft = { ...original, autoUnpublishStale: true };
    const counts = {
      activeByClass: { new: knownCount(10), used: knownCount(5), cpo: knownCount(2) },
      publishedByClass: { new: knownCount(9), used: knownCount(4), cpo: knownCount(2) },
    };
    const impact = describePublishingImpact(draft, original, counts, 7, "2026-10-28T00:00:00Z");
    expect(impact.counts).toEqual({ active_listings: 17, published_listings: 15, changed_rules: 1 });
    expect(impact.samples).toEqual([{ field: "autoUnpublishStale", before: false, after: true }]);
    expect(impact.warnings.join(" ")).toMatch(/not rewritten/);
    expect(impact.exclusions).toContain("Archived listings");
    const failed = describePublishingImpact(draft, original, { ...counts, activeByClass: { ...counts.activeByClass, used: { kind: "failed" } } }, 7, "2026-10-28T00:00:00Z");
    expect(failed.counts.active_listings).toBeNull();
  });
});

describe("change history classification", () => {
  it("separates configuration changes from provider and job events", () => {
    expect(classifyHistoryAction("publishing_policy_changed")).toBe("policy");
    expect(classifyHistoryAction("service_policy_changed")).toBe("policy");
    expect(classifyHistoryAction("description_settings_saved")).toBe("policy");
    expect(classifyHistoryAction("product_sale_mode_changed")).toBe("policy");
    expect(classifyHistoryAction("dealer_settings_seeded")).toBe("policy");
    expect(classifyHistoryAction("customer_passport_escalated")).toBe("job");
    expect(classifyHistoryAction("recall_do_not_drive_unpublished")).toBe("job");
    expect(classifyHistoryAction("autocurb_pull_completed")).toBe("job");
    expect(classifyHistoryAction("marketcheck_sync_invoked")).toBe("job");
    expect(classifyHistoryAction("advertised_price_crawl_run")).toBe("job");
    expect(classifyHistoryAction("intake_draft_sweep_run")).toBe("job");
    expect(classifyHistoryAction("addendum_signed")).toBe("other");
  });

  it("does not mistake one vehicle's publication for a policy change", () => {
    expect(classifyHistoryAction("factory_sticker.published")).toBe("other");
    expect(classifyHistoryAction("listing_published")).toBe("other");
    expect(classifyHistoryAction("description_published_internal")).toBe("other");
    expect(classifyHistoryAction("publish_price_untracked_acknowledged")).toBe("other");
  });

  it("prefilters the query with the same terms the classifier accepts", () => {
    for (const term of POLICY_ACTION_TERMS) expect(classifyHistoryAction(`x_${term}_changed`)).toBe("policy");
  });
});

describe("policy version fingerprint", () => {
  it("changes when an owned key changes and is stable otherwise", () => {
    const a = publishingDraftFrom(settings());
    const b = publishingDraftFrom(settings());
    expect(publishingPolicyVersion(a)).toBe(publishingPolicyVersion(b));
    expect(publishingPolicyVersion({ ...a, autoUnpublishStale: !a.autoUnpublishStale })).not.toBe(publishingPolicyVersion(a));
  });

  it("reads the same draft from the typed settings and from a raw settings row", () => {
    const raw = { ingest_auto_publish: false, document_rules: { autoUnpublishStale: true } };
    const fromRaw = publishingDraftFrom(raw);
    const fromTyped = publishingDraftFrom(settings({ ingest_auto_publish: false, document_rules: { ...DEFAULT_SETTINGS.document_rules, autoUnpublishStale: true } }));
    expect(fromRaw).toEqual(fromTyped);
    expect(publishingPolicyVersion(fromRaw)).toBe(publishingPolicyVersion(fromTyped));
  });
});

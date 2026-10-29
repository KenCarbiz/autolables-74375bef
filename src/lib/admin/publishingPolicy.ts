import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { getDealerDocumentRules, type DocumentRules } from "@/lib/documentRules";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { type CountValue, countDisplay } from "@/lib/admin/health";
import { diffFields, isUnchanged, type ImpactSnapshot } from "@/lib/admin/reviewApply";

// The publishing policy in force, derived from the enforcers that actually
// run, never from the names of functions or from marketing copy:
//
//   listing visibility   enforce_prep_gate (trigger on vehicle_listings):
//                        a transition into `published` is refused when
//                        recall_check.do_not_drive is true and no
//                        recall_override_by is recorded; platform admins
//                        bypass. unpublish_on_do_not_drive_recall (trigger
//                        trg_recall_unpublish_guard): a live listing whose
//                        recall_check turns do-not-drive goes back to draft
//                        unless an override is recorded. ingest_auto_publish
//                        decides whether intake publishes at all.
//   document publication document_rules.* (dealer_profiles.settings) read by
//                        the document workflow; descriptions by
//                        description_settings.review_mode[_by_class], read by
//                        description_publish_allowed.
//   retail readiness     require_safety_inspection (+ licensee certification),
//                        require_install_verification, read by the signing
//                        flow; signer authority by k208_signer_allowed.
//   overrides            recall_override_by (admin), k208_authority_roles,
//                        document_rules.allowWarningOverrideWithReason.
//
// Nothing here enforces anything; it reports.

export type VehicleClass = "new" | "used" | "cpo";

export const VEHICLE_CLASSES: readonly VehicleClass[] = ["new", "used", "cpo"];

export const VEHICLE_CLASS_LABEL: Readonly<Record<VehicleClass, string>> = { new: "New", used: "Used", cpo: "CPO" };

export type PublishingSettingsSlice = Pick<
  DealerSettings,
  | "ingest_auto_publish"
  | "require_safety_inspection"
  | "require_k208_licensee_certification"
  | "require_install_verification"
  | "k208_authority_roles"
  | "feature_price_verification"
  | "document_rules"
>;

/** description_settings as read for the tenant; null when the row could not be read. */
export interface DescriptionPolicy {
  reviewMode: string | null;
  reviewModeByClass: Record<string, string> | null;
  internalPublicationEnabled: boolean | null;
}

export type CellState = "enforced" | "configured" | "open" | "unknown";

export interface PolicyCell {
  /** Short matrix label. */
  label: string;
  /** One or two sentences a manager can act on. */
  detail: string;
  /** The server object or settings key the claim rests on. */
  enforcer: string;
  state: CellState;
}

export interface PublishingRow {
  vehicleClass: VehicleClass;
  label: string;
  listingVisibility: PolicyCell;
  documentPublication: PolicyCell;
  retailReadiness: PolicyCell;
  overrides: PolicyCell;
}

export interface PublishingInputs {
  settings: PublishingSettingsSlice;
  description: DescriptionPolicy | null;
}

const reviewModeFor = (d: DescriptionPolicy | null, cls: VehicleClass): string | null => {
  if (!d) return null;
  const byClass = d.reviewModeByClass ?? {};
  return byClass[cls] ?? byClass[cls === "cpo" ? "used" : cls] ?? d.reviewMode ?? null;
};

const describeReviewMode = (mode: string | null): string => {
  if (mode === null) return "unknown";
  const m = mode.toLowerCase();
  if (m.includes("manual") || m.includes("review") || m.includes("approval")) return "manual review";
  if (m.includes("auto")) return "automatic";
  return m.replace(/_/g, " ");
};

export function deriveListingVisibility(settings: PublishingSettingsSlice): PolicyCell {
  const auto = settings.ingest_auto_publish !== false;
  return {
    label: auto ? "Auto on intake + recall policy" : "Manual publish + recall policy",
    detail: auto
      ? "The Passport is published when a vehicle is ingested. A do-not-drive recall blocks publishing and un-publishes a live listing unless an admin records an override."
      : "A person publishes each Passport. A do-not-drive recall blocks publishing and un-publishes a live listing unless an admin records an override.",
    enforcer: "ingest_auto_publish; triggers enforce_prep_gate and trg_recall_unpublish_guard on vehicle_listings",
    state: "enforced",
  };
}

export function deriveDocumentPublication(rules: DocumentRules, description: DescriptionPolicy | null, cls: VehicleClass): PolicyCell {
  const review = describeReviewMode(reviewModeFor(description, cls));
  const approval = rules.requireApprovalBeforePublish;
  const autoApproved = rules.autoPublishApprovedWindow || rules.autoPublishApprovedAddendum;
  const label = approval ? "Manager approval" : autoApproved ? "Auto-publish approved" : "Manual publication";
  const docs = approval
    ? "Stickers and addendums need manager approval before they are published to the Passport."
    : autoApproved
      ? `Approved ${[rules.autoPublishApprovedWindow ? "window stickers" : null, rules.autoPublishApprovedAddendum ? "addendums" : null].filter(Boolean).join(" and ")} publish automatically; other documents are published by a person.`
      : "Documents are published by a person; no approval gate is set.";
  const desc = review === "unknown" ? "Description review mode could not be read." : `Descriptions: ${review}.`;
  const stale = rules.autoUnpublishStale ? "Stale public documents are withdrawn automatically." : rules.requireManagerReviewStale ? "Stale documents wait for manager review." : "Stale documents stay public until a person acts.";
  return {
    label: review === "unknown" ? `${label} (descriptions unknown)` : label,
    detail: `${docs} ${desc} ${stale}`,
    enforcer: "document_rules.requireApprovalBeforePublish, autoPublishApprovedWindow, autoPublishApprovedAddendum, autoUnpublishStale; description_settings.review_mode read by description_publish_allowed",
    state: review === "unknown" ? "unknown" : "configured",
  };
}

const listOf = (parts: string[]): string => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

export function deriveRetailReadiness(settings: PublishingSettingsSlice, cls: VehicleClass): PolicyCell {
  const installs = settings.require_install_verification === true;
  const price = settings.feature_price_verification === true;
  if (cls === "new") {
    const parts = [installs ? "verified installs" : null, price ? "verified price" : null].filter(Boolean);
    return {
      label: parts.length ? "Pre-delivery checks" : "No pre-delivery gate",
      detail: parts.length
        ? `Signing waits for ${listOf(parts as string[])}. New vehicles have no inspection gate.`
        : "Customer disclosures can be signed without a pre-delivery gate on new vehicles.",
      enforcer: "require_install_verification; feature_price_verification with enforce_price_verified_before_sign",
      state: parts.length ? "configured" : "open",
    };
  }
  const k208 = settings.require_safety_inspection === true;
  const licensee = k208 && settings.require_k208_licensee_certification === true;
  const parts = [k208 ? (licensee ? "a completed K-208 certified by a licensee" : "a completed K-208 inspection") : null, installs ? "verified installs" : null, price ? "verified price" : null].filter(Boolean);
  return {
    label: k208 ? (cls === "cpo" ? "Service + CPO checks" : "Service + inspection") : parts.length ? "Pre-delivery checks" : "No inspection gate",
    detail: parts.length
      ? `Signing waits for ${listOf(parts as string[])}.${cls === "cpo" ? " CPO program evidence is dealer-attested, not a server gate." : ""}`
      : `Customer disclosures can be signed without an inspection gate on ${cls === "cpo" ? "CPO" : "used"} vehicles.`,
    enforcer: "require_safety_inspection, require_k208_licensee_certification, require_install_verification read by the signing flow; k208_signer_allowed",
    state: parts.length ? "configured" : "open",
  };
}

export function deriveOverrides(settings: PublishingSettingsSlice, rules: DocumentRules): PolicyCell {
  const roles = settings.k208_authority_roles ?? [];
  const signer = roles.length ? "a signer in the authorized roles" : "any signed inspection";
  const mismatch = rules.allowWarningOverrideWithReason ? "a manager with a recorded reason" : "no one";
  return {
    label: roles.length || rules.allowWarningOverrideWithReason ? "Authorized manager" : "Admin only",
    detail: `Recall gate: platform admin with a recorded override. Inspection: ${signer}. Sticker or packet mismatch warnings: ${mismatch}.`,
    enforcer: "recall_override_by with has_role(admin); k208_authority_roles; document_rules.allowWarningOverrideWithReason",
    state: "enforced",
  };
}

export function derivePublishingMatrix({ settings, description }: PublishingInputs): PublishingRow[] {
  const rules = getDealerDocumentRules(settings);
  return VEHICLE_CLASSES.map((cls) => ({
    vehicleClass: cls,
    label: VEHICLE_CLASS_LABEL[cls],
    listingVisibility: deriveListingVisibility(settings),
    documentPublication: deriveDocumentPublication(rules, description, cls),
    retailReadiness: deriveRetailReadiness(settings, cls),
    overrides: deriveOverrides(settings, rules),
  }));
}

export interface ClassDetailCard {
  key: "visibility" | "documents" | "readiness";
  title: string;
  summary: string;
  explanation: string;
  tone: "info" | "warning" | "danger" | "success";
}

export interface ClassDetail {
  cards: ClassDetailCard[];
  ruleText: string;
  approvalRulesHref: string;
}

/** State explanations for the selected class. Not counts: policy, in words. */
export function deriveClassDetail(row: PublishingRow, settings: PublishingSettingsSlice): ClassDetail {
  const rules = getDealerDocumentRules(settings);
  const auto = settings.ingest_auto_publish !== false;
  const approval = rules.requireApprovalBeforePublish;
  const gated = row.retailReadiness.state === "configured";
  const cls = row.label.toLowerCase();
  return {
    cards: [
      {
        key: "visibility",
        title: "Listing can be visible",
        summary: "Meets the recall policy.",
        explanation: auto
          ? "The vehicle may appear on approved destinations while documents and retail readiness are in progress."
          : "The vehicle appears once a person publishes it; documents and retail readiness can still be in progress.",
        tone: "info",
      },
      {
        key: "documents",
        title: approval ? "Documents awaiting approval" : "Documents publish without approval",
        summary: approval ? "Uploaded documents are pending manager review." : "No approval gate is set for documents.",
        explanation: approval
          ? "The listing remains visible. Document publication occurs after approval per this policy."
          : "A generated document becomes public as soon as it is published; set manager approval in Documents & Service to change that.",
        tone: approval ? "warning" : "info",
      },
      {
        key: "readiness",
        title: gated ? "Not retail ready" : "No retail gate",
        summary: gated ? "Service and inspection requirements are not complete." : `No pre-delivery gate applies to ${cls} vehicles.`,
        explanation: gated
          ? "The vehicle is not retail ready until the checks complete. This does not prevent the listing from being visible."
          : "Customer disclosures can be signed as soon as the price and documents are in order.",
        tone: gated ? "danger" : "info",
      },
    ],
    ruleText: `A ${cls} vehicle can be listed when it meets the recall policy${auto ? " and is published on intake" : " and a person publishes it"}. ${approval ? "Documents must be approved before publication" : "Documents publish without an approval gate"}${gated ? `, and the vehicle needs ${row.retailReadiness.detail.replace(/^Signing waits for /, "").replace(/\.$/, "").replace(/\. .*$/, "")} to be retail ready.` : ", and no retail-readiness gate applies."}`,
    approvalRulesHref: adminTabHref("approval-rules"),
  };
}

// ── The keys Publishing edits (Review & Apply over merge_dealer_settings) ──
//
// Every other key shown on these screens belongs to another editor:
// require_safety_inspection and the install gate to Documents & Service >
// Service policy, print and packet approvals to Documents & Service >
// Approval rules, description review modes to Publishing > Destinations.

export interface PublishingDraft {
  ingest_auto_publish: boolean;
  requireApprovalBeforePublish: boolean;
  autoPublishApprovedWindow: boolean;
  autoPublishApprovedAddendum: boolean;
  autoUnpublishStale: boolean;
  hideSupersededPublic: boolean;
}

export const PUBLISHING_DRAFT_LABELS: Readonly<Record<keyof PublishingDraft, string>> = {
  ingest_auto_publish: "Publish the Passport on intake",
  requireApprovalBeforePublish: "Manager approval before publishing documents",
  autoPublishApprovedWindow: "Auto-publish approved window stickers",
  autoPublishApprovedAddendum: "Auto-publish approved addendums",
  autoUnpublishStale: "Withdraw stale public documents automatically",
  hideSupersededPublic: "Hide superseded documents from the public page",
};

export const PUBLISHING_DRAFT_KEYS = Object.keys(PUBLISHING_DRAFT_LABELS) as Array<keyof PublishingDraft>;

/** The two settings keys a draft reads; the stored jsonb row satisfies this as well as the typed settings. */
export type PublishingDraftSource = Partial<Pick<DealerSettings, "ingest_auto_publish" | "document_rules">>;

export function publishingDraftFrom(settings: PublishingDraftSource): PublishingDraft {
  const rules = getDealerDocumentRules(settings);
  return {
    ingest_auto_publish: settings.ingest_auto_publish !== false,
    requireApprovalBeforePublish: rules.requireApprovalBeforePublish,
    autoPublishApprovedWindow: rules.autoPublishApprovedWindow,
    autoPublishApprovedAddendum: rules.autoPublishApprovedAddendum,
    autoUnpublishStale: rules.autoUnpublishStale,
    hideSupersededPublic: rules.hideSupersededPublic,
  };
}

export function validatePublishingDraft(draft: PublishingDraft): string[] {
  const errors: string[] = [];
  for (const k of PUBLISHING_DRAFT_KEYS) if (typeof draft[k] !== "boolean") errors.push(`${PUBLISHING_DRAFT_LABELS[k]} must be on or off.`);
  return errors;
}

export function publishingDraftWarnings(draft: PublishingDraft): string[] {
  const w: string[] = [];
  if (draft.ingest_auto_publish && draft.requireApprovalBeforePublish) {
    w.push("Intake auto-publish and manager approval before publishing are both on: the listing goes live on intake while its documents wait for approval.");
  }
  if (!draft.requireApprovalBeforePublish && (draft.autoPublishApprovedWindow || draft.autoPublishApprovedAddendum)) {
    w.push("Auto-publish of approved documents has no effect while no approval step exists.");
  }
  if (!draft.autoUnpublishStale) w.push("A document that goes stale after a price or equipment change stays public until a person withdraws it.");
  return w;
}

/** The settings patch for merge_dealer_settings: the nested rules object is merged, not replaced. */
export function publishingPatchFromDraft(draft: PublishingDraft, settings: PublishingDraftSource): Pick<DealerSettings, "ingest_auto_publish" | "document_rules"> {
  const rules = getDealerDocumentRules(settings);
  return {
    ingest_auto_publish: draft.ingest_auto_publish,
    document_rules: {
      ...rules,
      requireApprovalBeforePublish: draft.requireApprovalBeforePublish,
      autoPublishApprovedWindow: draft.autoPublishApprovedWindow,
      autoPublishApprovedAddendum: draft.autoPublishApprovedAddendum,
      autoUnpublishStale: draft.autoUnpublishStale,
      hideSupersededPublic: draft.hideSupersededPublic,
    },
  };
}

export interface ListingCounts {
  activeByClass: Record<VehicleClass, CountValue>;
  publishedByClass: Record<VehicleClass, CountValue>;
}

const countNumber = (c: CountValue): number | null => (c.kind === "known" ? c.value : null);

/**
 * Impact of a policy change. Applying it changes future publication
 * decisions; it rewrites no listing, so the counts are context (what the
 * policy will govern), and a count that could not be read blocks apply.
 */
export function describePublishingImpact(draft: PublishingDraft, original: PublishingDraft, counts: ListingCounts | null, version: string | number | null, computedAt: string): ImpactSnapshot {
  const changed = diffFields(original as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>);
  const active = counts ? VEHICLE_CLASSES.reduce<number | null>((acc, c) => (acc === null ? null : countNumber(counts.activeByClass[c]) === null ? null : acc + (countNumber(counts.activeByClass[c]) as number)), 0) : null;
  const published = counts ? VEHICLE_CLASSES.reduce<number | null>((acc, c) => (acc === null ? null : countNumber(counts.publishedByClass[c]) === null ? null : acc + (countNumber(counts.publishedByClass[c]) as number)), 0) : null;
  return {
    computedAt,
    version,
    counts: { active_listings: active, published_listings: published, changed_rules: changed.length },
    samples: changed.map((d) => ({ field: d.field, before: d.before, after: d.after })),
    warnings: [...publishingDraftWarnings(draft), "Existing listings and published documents are not rewritten by this change; it governs publication decisions from now on."],
    exclusions: ["Archived listings", "Signed and approved historical documents"],
  };
}

export const publishingDraftUnchanged = (a: PublishingDraft, b: PublishingDraft): boolean => isUnchanged(a, b);

/** Fingerprint of the keys Publishing owns. Apply re-reads the stored copy and refuses when the fingerprint moved after review. */
export function publishingPolicyVersion(draft: PublishingDraft): string {
  const bits = PUBLISHING_DRAFT_KEYS.map((k) => (draft[k] ? "1" : "0")).join("");
  return `v${parseInt(bits, 2).toString(36)}`;
}

export const describeCounts = (counts: ListingCounts | null, cls: VehicleClass): { active: string; published: string } => ({
  active: counts ? countDisplay(counts.activeByClass[cls]) : "Unknown",
  published: counts ? countDisplay(counts.publishedByClass[cls]) : "Unknown",
});

// ── Change history ────────────────────────────────────────────────────────

/**
 * Terms that mark an audit_log action as a configuration or policy change.
 * The change-history query prefilters with the same terms (ILIKE), so what
 * the server returns and what the classifier accepts stay in lockstep. A
 * single vehicle's sticker, description or listing being published is an
 * event, not a policy change, so "publish" on its own is not a term.
 */
export const POLICY_ACTION_TERMS = ["policy", "settings", "approval", "document_rules", "routing", "escalation", "doc_fee", "price_display", "k208_authority", "sale_mode", "entitlement_overridden"] as const;
export const POLICY_ACTION_PATTERN = new RegExp(POLICY_ACTION_TERMS.join("|"), "i");

/** Actions that are provider or job events, shown in Integrations, never here. */
export const JOB_ACTION_PATTERN = /autocurb_|_sync|sync_run|crawl|provider_|refused|escalated$|recall_do_not_drive_unpublished|sweep|safety_net_run|orchestrate/i;

export type HistoryKind = "policy" | "job" | "other";

export const classifyHistoryAction = (action: string): HistoryKind => {
  if (JOB_ACTION_PATTERN.test(action)) return "job";
  if (POLICY_ACTION_PATTERN.test(action)) return "policy";
  return "other";
};

export const PUBLISHING_AUDIT_ACTION = "publishing_policy_changed";

export const publishingAuditDetails = (before: PublishingDraft, after: PublishingDraft, idempotencyKey: string, version: string | number | null) => ({
  keys: diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>).map((d) => d.field),
  prev: before,
  next: after,
  idempotency_key: idempotencyKey,
  policy_version: version,
  editor: adminTabHref("effective-policy"),
});

export const PUBLISHING_LINKS = {
  approvalRules: adminTabHref("approval-rules"),
  servicePolicy: adminTabHref("service-policy"),
  destinations: adminTabHref("destinations"),
  escalation: ADMIN_CHILD_ROUTES.escalation,
} as const;

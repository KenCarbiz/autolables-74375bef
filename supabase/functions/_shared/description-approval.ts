// ─────────────────────────────────────────────────────────────────────
// Approval eligibility + staleness classification (Phase 8 §16-§17).
//
// The browser never decides whether a description may be approved. It may
// render this verdict, disable a button from it, explain it — but the answer
// is produced here, server-side, from facts only. A client that lies about
// its own state cannot manufacture an approval, because nothing in this file
// reads anything the client is trusted to know.
//
// The second rule: a blocking finding is a CORRECTION request, never an
// acknowledgement request. Warnings may be waived by an authorized approver
// when policy permits; a fact-bearing defect may not be waived by anyone.
// ─────────────────────────────────────────────────────────────────────

export type ApprovalState =
  | "not_approved"
  | "approval_pending"
  | "approved"
  | "approved_with_warnings"
  | "rejected"
  | "approval_invalidated"
  | "approval_expired"
  | "approval_withdrawn"
  | "superseded";

export type StaleClass =
  | "none"
  | "informational"
  | "review_required"
  | "revalidation_required"
  | "reapproval_required"
  | "publication_blocked";

export interface StaleSignal {
  field: string;
  from: string | null;
  to: string | null;
  classification: StaleClass;
  reason: string;
}

export interface StalenessResult {
  signals: StaleSignal[];
  worst: StaleClass;
}

export interface StoredConfig {
  truthSnapshotVersion: string | null;
  channelPolicyVersion: string | null;
  voiceProfileVersion: string | null;
  toneVersion: string | null;
  localSeoVersion: string | null;
  mileage: number | null;
  price: number | null;
  priceIncludedInCopy: boolean;
  condition: string | null;
  cpoStatus: string | null;
  warrantyStatus: string | null;
  dealerName: string | null;
  dealerCity: string | null;
  requiredDisclosures: string[];
  ctaText: string | null;
  vehicleStatus: string | null;
}

export type CurrentConfig = StoredConfig;

const STALE_RANK: Record<StaleClass, number> = {
  none: 0,
  informational: 1,
  review_required: 2,
  revalidation_required: 3,
  reapproval_required: 4,
  publication_blocked: 5,
};

const worstOf = (classes: StaleClass[]): StaleClass =>
  classes.reduce<StaleClass>((acc, c) => (STALE_RANK[c] > STALE_RANK[acc] ? c : acc), "none");

const text = (v: string | number | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.toLowerCase();
};

// Re-ordering the same disclosure list is not a disclosure change.
const disclosureKey = (v: string[] | null | undefined): string | null => {
  const list = (Array.isArray(v) ? v : [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return list.length ? list.join(" | ") : null;
};

const NOT_PUBLISHABLE = new Set([
  "sold", "delivered", "removed", "deleted", "archived", "wholesaled", "inactive",
]);

/**
 * What changed under an already-approved description, and how much it matters.
 *
 * Materiality, not diff volume, decides the class. A nightly feed touching a
 * tone id or an SEO profile must never invalidate a manager's approval, while a
 * disclosure or a CPO flag moving underneath approved copy always must.
 */
export function classifyStaleness(stored: StoredConfig, current: CurrentConfig): StalenessResult {
  const signals: StaleSignal[] = [];

  const compare = (
    field: string,
    from: string | null,
    to: string | null,
    classification: StaleClass,
    reason: string,
  ) => {
    if (from === to) return;
    signals.push({ field, from, to, classification, reason });
  };

  compare(
    "truth_snapshot_version",
    text(stored.truthSnapshotVersion), text(current.truthSnapshotVersion),
    "reapproval_required",
    "The trusted fact snapshot the copy was approved against no longer exists. Every claim must be revalidated and re-approved.",
  );

  compare(
    "required_disclosures",
    disclosureKey(stored.requiredDisclosures), disclosureKey(current.requiredDisclosures),
    "reapproval_required",
    "Required disclosure text changed. Approved copy cannot carry a superseded disclosure set.",
  );

  compare(
    "cpo_status",
    text(stored.cpoStatus), text(current.cpoStatus),
    "reapproval_required",
    "Certification status changed. CPO language is only approvable against the certification in force.",
  );

  compare(
    "warranty_status",
    text(stored.warrantyStatus), text(current.warrantyStatus),
    "reapproval_required",
    "Warranty coverage changed. Remaining-coverage language must be re-approved against the current warranty.",
  );

  compare(
    "condition",
    text(stored.condition), text(current.condition),
    "reapproval_required",
    "Vehicle class changed. Copy policy and permitted claims differ by class.",
  );

  compare(
    "dealer_name",
    text(stored.dealerName), text(current.dealerName),
    "reapproval_required",
    "Dealer identity in the copy no longer matches the tenant profile.",
  );

  compare(
    "dealer_city",
    text(stored.dealerCity), text(current.dealerCity),
    "reapproval_required",
    "Dealer location in the copy no longer matches the tenant profile.",
  );

  compare(
    "mileage",
    text(stored.mileage), text(current.mileage),
    "revalidation_required",
    "Odometer reading changed. Any mileage stated in the copy must be revalidated.",
  );

  // Price only reaches the copy when the dealer permits price language. When it
  // does not, a price move is an inventory event the approved text never
  // asserted — invalidating approval for it would retire clean copy nightly.
  const priceInCopy = stored.priceIncludedInCopy || current.priceIncludedInCopy;
  compare(
    "price",
    text(stored.price), text(current.price),
    priceInCopy ? "reapproval_required" : "informational",
    priceInCopy
      ? "Price changed and the approved copy states a price. The stated figure is now wrong."
      : "Price changed but the approved copy does not state a price, so no approved claim is affected.",
  );

  compare(
    "price_included_in_copy",
    stored.priceIncludedInCopy ? "1" : "0", current.priceIncludedInCopy ? "1" : "0",
    "reapproval_required",
    "The dealer's price-in-description policy changed, which changes what the copy is permitted to state.",
  );

  compare(
    "channel_policy_version",
    text(stored.channelPolicyVersion), text(current.channelPolicyVersion),
    "revalidation_required",
    "Channel policy changed. Conformance checks must be re-run against the new rules.",
  );

  compare(
    "cta_text",
    text(stored.ctaText), text(current.ctaText),
    "review_required",
    "The approved call to action is no longer the tenant's current CTA.",
  );

  compare(
    "voice_profile_version",
    text(stored.voiceProfileVersion), text(current.voiceProfileVersion),
    "review_required",
    "Dealership voice profile changed. Approved wording should be reviewed against the new voice.",
  );

  compare(
    "tone_version",
    text(stored.toneVersion), text(current.toneVersion),
    "informational",
    "Tone definition changed. Tone governs wording only and cannot alter an approved fact.",
  );

  compare(
    "local_seo_version",
    text(stored.localSeoVersion), text(current.localSeoVersion),
    "informational",
    "Local SEO targeting changed. Search phrasing is metadata and does not affect approved claims.",
  );

  const from = text(stored.vehicleStatus);
  const to = text(current.vehicleStatus);
  if (from !== to && to && NOT_PUBLISHABLE.has(to)) {
    signals.push({
      field: "vehicle_status",
      from, to,
      classification: "publication_blocked",
      reason: `Vehicle is ${to}. Approved copy for it must not be published.`,
    });
  } else if (from !== to) {
    signals.push({
      field: "vehicle_status",
      from, to,
      classification: "informational",
      reason: "Inventory status changed but the vehicle remains publishable.",
    });
  }

  return { signals, worst: worstOf(signals.map((s) => s.classification)) };
}

export type EligibilityVerdict = "eligible" | "eligible_with_warnings" | "ineligible";

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  blockingRuleIds: string[];
  warningRuleIds: string[];
  reasons: string[];
  requiredNextAction: string;
  evaluatedAt: string;
  policyVersions: Record<string, string>;
  configurationChecksum: string;
}

export interface ApprovalFinding {
  validator_code: string;
  blocking: boolean;
  severity: "info" | "warning" | "blocking";
}

export interface ApprovalEligibilityInput {
  versionExists: boolean;
  versionTenantId: string | null;
  callerTenantId: string;
  isWorkingDraft: boolean;
  isSuperseded: boolean;
  isWithdrawn: boolean;
  validationComplete: boolean;
  automatedFindings: ApprovalFinding[];
  humanFindings: ApprovalFinding[];
  requiredReviewsCompleted: number;
  requiredReviewCount: number;
  checklistComplete: boolean;
  reviewPolicyActive: boolean;
  channelPolicyActive: boolean;
  disclosuresPresent: boolean;
  ctaValid: boolean;
  scoreComplete: boolean;
  staleness: StalenessResult;
  hasApprovalPermission: boolean;
  attestationAccepted: boolean;
  acknowledgedWarnings: string[];
  policyAllowsWarningAcknowledgement: boolean;
  now: string;
  policyVersions?: Record<string, string>;
  /** Precomputed by the caller — `configurationChecksum` is async, this is not. */
  configurationChecksum?: string;
}

/**
 * Findings that assert something about the vehicle, the dealer or the law.
 *
 * None of these may ever be waived by an approver, at warning severity or any
 * other. Acknowledging "this description claims a certification the vehicle
 * does not hold" does not make the description true — it only records who was
 * willing to publish it. The only resolution is to correct the copy or the
 * underlying data.
 */
export const NON_ACKNOWLEDGEABLE_FINDINGS: Set<string> = new Set([
  // Unsupported vehicle facts
  "UNSUPPORTED_FEATURE_CLAIM",
  "EXCLUDED_CLAIM_PRESENT",
  "DEALER_ADDED_AS_FACTORY",
  "SERVICE_CLAIM",
  "CONDITION_CLAIM",
  "RECALL_CLAIM",
  "OWNERSHIP_CLAIM",
  "HISTORY_CLAIM",
  // Wrong identity / mileage / pricing
  "IDENTITY_YEAR_CONFLICT",
  "REQUIRED_DATA_MISSING",
  "MARKET_CLAIM",
  "CHANNEL_PRICE_NOT_ALLOWED",
  "STALE_MILEAGE",
  "STALE_PRICE_IN_COPY",
  // Unsupported CPO / warranty
  "CPO_CLAIM",
  "WARRANTY_CLAIM",
  "STALE_CPO",
  "STALE_WARRANTY",
  // Wrong dealer location / identity
  "STALE_DEALER_IDENTITY",
  // Missing required disclosure
  "REQUIRED_DISCLOSURE_MISSING",
  "CHANNEL_DISCLOSURE_MISSING",
  "STALE_DISCLOSURES",
  // Unresolved material truth conflicts
  "SOURCE_CONFLICT_UNRESOLVED",
  "STALE_TRUTH_SNAPSHOT",
  // Deliberate deception
  "HIDDEN_TEXT_DETECTED",
  "PROHIBITED_PHRASE",
  "CHANNEL_PROHIBITED_PHRASE",
]);

export const canAcknowledge = (validatorCode: string): boolean =>
  !NON_ACKNOWLEDGEABLE_FINDINGS.has(validatorCode);

const unique = (a: string[]): string[] => [...new Set(a.filter(Boolean))];

const STALE_BLOCK_ID: Partial<Record<StaleClass, string>> = {
  publication_blocked: "STALE_PUBLICATION_BLOCKED",
  reapproval_required: "STALE_REAPPROVAL_REQUIRED",
  revalidation_required: "STALE_REVALIDATION_REQUIRED",
};

/**
 * The single authority on whether a description version may be approved.
 *
 * Takes facts, returns a verdict. It performs no I/O, reads no session and
 * trusts no caller-supplied opinion — every argument is an observable state,
 * so the same inputs always produce the same answer and the answer is
 * reproducible from the audit row alone.
 */
export function evaluateApprovalEligibility(input: ApprovalEligibilityInput): EligibilityResult {
  const base = {
    evaluatedAt: input.now,
    policyVersions: input.policyVersions ?? {},
    configurationChecksum: input.configurationChecksum ?? "",
  };

  // A version belonging to another tenant returns exactly what a nonexistent
  // version returns. Any difference between the two answers is an enumeration
  // oracle for another dealer's inventory.
  if (!input.versionExists || !input.versionTenantId || input.versionTenantId !== input.callerTenantId) {
    return {
      verdict: "ineligible",
      blockingRuleIds: ["VERSION_NOT_AVAILABLE"],
      warningRuleIds: [],
      reasons: ["This description version is not available."],
      requiredNextAction: "Open the description from your own inventory and try again.",
      ...base,
    };
  }

  const blocking: string[] = [];
  const reasons: string[] = [];
  const actions: string[] = [];

  const fail = (id: string, reason: string, action: string) => {
    blocking.push(id);
    reasons.push(reason);
    actions.push(action);
  };

  if (input.isWorkingDraft) {
    fail("VERSION_IS_WORKING_DRAFT",
      "This is an unsaved working draft, not a submitted version.",
      "Save the draft as a version, then submit it for approval.");
  }
  if (input.isSuperseded) {
    fail("VERSION_SUPERSEDED",
      "A newer version of this description has replaced this one.",
      "Open the current version and approve that instead.");
  }
  if (input.isWithdrawn) {
    fail("VERSION_WITHDRAWN",
      "This version's approval was withdrawn.",
      "Regenerate or edit the description to create a new version, then submit it for approval.");
  }

  if (!input.reviewPolicyActive) {
    fail("REVIEW_POLICY_INACTIVE",
      "No active review policy governs this description.",
      "Activate a review policy in description settings before approving.");
  }
  if (!input.channelPolicyActive) {
    fail("CHANNEL_POLICY_INACTIVE",
      "The channel this version targets is not active for this tenant.",
      "Re-enable the channel, or regenerate this description for an active channel.");
  }

  if (!input.validationComplete) {
    fail("VALIDATION_INCOMPLETE",
      "Validation has not finished for this version.",
      "Run validation to completion, then re-open the approval.");
  }
  if (!input.scoreComplete) {
    fail("SCORE_INCOMPLETE",
      "The quality score for this version has not been computed.",
      "Wait for scoring to finish, or re-run scoring for this version.");
  }

  const allFindings = [...input.automatedFindings, ...input.humanFindings];

  // Blocking is blocking regardless of who raised it. A reviewer's blocking
  // note carries the same weight as the validator's — neither is waivable.
  const blockingCodes = unique(
    allFindings.filter((f) => f.blocking || f.severity === "blocking").map((f) => f.validator_code),
  );
  for (const code of blockingCodes) {
    fail(code,
      `Blocking finding ${code} is unresolved.`,
      `Correct the description or the underlying vehicle data so ${code} no longer fires. A blocking finding cannot be acknowledged.`);
  }

  if (!input.disclosuresPresent) {
    fail("REQUIRED_DISCLOSURE_MISSING",
      "A required disclosure is missing from the description body.",
      "Insert the required disclosure text verbatim, then revalidate.");
  }
  if (!input.ctaValid) {
    fail("CTA_INVALID",
      "The call to action does not match the approved CTA for this channel.",
      "Replace the closing call to action with the tenant's approved CTA.");
  }

  if (input.requiredReviewCount > 0 && input.requiredReviewsCompleted < input.requiredReviewCount) {
    fail("REQUIRED_REVIEWS_INCOMPLETE",
      `${input.requiredReviewsCompleted} of ${input.requiredReviewCount} required reviews are complete.`,
      `Collect ${input.requiredReviewCount - input.requiredReviewsCompleted} more review(s) before approving.`);
  }
  if (!input.checklistComplete) {
    fail("CHECKLIST_INCOMPLETE",
      "The approval checklist has unanswered items.",
      "Complete every checklist item, then re-open the approval.");
  }

  const staleId = STALE_BLOCK_ID[input.staleness.worst];
  if (staleId) {
    const drivers = input.staleness.signals
      .filter((s) => STALE_RANK[s.classification] >= STALE_RANK[input.staleness.worst])
      .map((s) => s.field);
    fail(staleId,
      `Configuration changed since this version was generated (${unique(drivers).join(", ")}).`,
      input.staleness.worst === "publication_blocked"
        ? "This vehicle is no longer publishable. Approval cannot proceed."
        : input.staleness.worst === "reapproval_required"
          ? "Regenerate the description against the current data, then approve the new version."
          : "Re-run validation against the current configuration, then re-open the approval.");
  }

  if (!input.hasApprovalPermission) {
    fail("APPROVAL_PERMISSION_MISSING",
      "You do not hold description approval permission for this tenant.",
      "Ask a tenant administrator to grant description approval, or route this to an approver.");
  }
  if (!input.attestationAccepted) {
    fail("ATTESTATION_NOT_ACCEPTED",
      "The approver attestation has not been accepted.",
      "Read and accept the approval attestation before recording the decision.");
  }

  const warningCodes = unique([
    ...allFindings
      .filter((f) => !f.blocking && f.severity === "warning")
      .map((f) => f.validator_code),
    ...(input.staleness.worst === "review_required" ? ["STALE_REVIEW_REQUIRED"] : []),
  ]);

  const unwaivable = warningCodes.filter((c) => !canAcknowledge(c));
  for (const code of unwaivable) {
    fail(code,
      `${code} asserts a fact about the vehicle, the dealer or a legal disclosure and cannot be acknowledged.`,
      `Correct the copy or the source data so ${code} no longer fires.`);
  }

  const waivable = warningCodes.filter((c) => canAcknowledge(c));
  const acknowledged = new Set(input.acknowledgedWarnings);
  const outstanding = waivable.filter((c) => !acknowledged.has(c));

  if (outstanding.length && !input.policyAllowsWarningAcknowledgement) {
    fail("WARNING_ACKNOWLEDGEMENT_NOT_PERMITTED",
      `This tenant's policy does not permit approving over warnings (${outstanding.join(", ")}).`,
      "Correct the flagged issues, or change the review policy to allow warning acknowledgement.");
  } else if (outstanding.length) {
    fail("WARNING_NOT_ACKNOWLEDGED",
      `${outstanding.length} warning(s) have not been acknowledged: ${outstanding.join(", ")}.`,
      "Acknowledge each remaining warning, or correct it, before approving.");
  }

  if (blocking.length) {
    return {
      verdict: "ineligible",
      blockingRuleIds: unique(blocking),
      warningRuleIds: waivable,
      reasons,
      requiredNextAction: actions[0],
      ...base,
    };
  }

  const informational = input.staleness.signals.filter((s) => s.classification === "informational");
  const infoReasons = informational.map((s) => `${s.field}: ${s.reason}`);

  if (waivable.length) {
    return {
      verdict: "eligible_with_warnings",
      blockingRuleIds: [],
      warningRuleIds: waivable,
      reasons: [
        `Approvable with ${waivable.length} acknowledged warning(s): ${waivable.join(", ")}.`,
        ...infoReasons,
      ],
      requiredNextAction: "Record the approval. The acknowledged warnings are stored with the decision.",
      ...base,
    };
  }

  return {
    verdict: "eligible",
    blockingRuleIds: [],
    warningRuleIds: [],
    reasons: ["All approval requirements are satisfied.", ...infoReasons],
    requiredNextAction: "Record the approval decision.",
    ...base,
  };
}

/**
 * Identity of the configuration an approval was granted against.
 *
 * Key-sorted so two callers assembling the same parts in a different order
 * produce the same checksum — otherwise an approval would appear invalidated
 * purely by the order a caller happened to build its object in.
 */
export async function configurationChecksum(parts: Record<string, string | null>): Promise<string> {
  const material = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${String(parts[k] ?? "").trim().toLowerCase()}`)
    .join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "acfg_" + Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

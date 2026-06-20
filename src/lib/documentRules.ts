import { useDealerSettings } from "@/contexts/DealerSettingsContext";

// ──────────────────────────────────────────────────────────────────────
// Dealer document workflow rules. Stored inside dealer_profiles.settings
// (one tenant-level JSON blob) — these are simple tenant preferences, so they
// reuse the existing DealerSettings store rather than a new table. Careful
// wording: these configure DISCLOSURE REVIEW / MANAGER APPROVAL / CUSTOMER
// ACKNOWLEDGMENT workflows, not any specific regulation's compliance.
// ──────────────────────────────────────────────────────────────────────

export interface DocumentRules {
  // Approval / manager review
  requireApprovalBeforePrint: boolean;
  requireApprovalBeforePublish: boolean;
  requireApprovalBeforePacketSend: boolean;
  allowSalesPrintApproved: boolean;
  autoSubmitForApproval: boolean;
  // Stale document handling
  staleOnPriceChange: boolean;
  staleOnMsrpChange: boolean;
  staleOnMileageChange: boolean;
  staleOnAddendumChange: boolean;
  staleOnSoldRemoved: boolean;
  autoUnpublishStale: boolean;
  requireManagerReviewStale: boolean;
  // Addendum packet ↔ sticker
  requireStickerMatchBeforeSigning: boolean;
  blockPacketOnMismatchFail: boolean;
  allowWarningOverrideWithReason: boolean;
  requireRereviewOnSignedChange: boolean;
  requireAddendumStickerInPacket: boolean;
  // Vehicle Passport visibility
  autoPublishApprovedWindow: boolean;
  autoPublishApprovedAddendum: boolean;
  hideSupersededPublic: boolean;
  showVersionHistoryPublic: boolean;
  trackQrScans: boolean;
}

// Conservative defaults: safety/customer-protection rules ON, workflow-friction
// rules OFF so existing dealers aren't suddenly blocked. A store opts into the
// stricter approval gates.
export const DEFAULT_DOCUMENT_RULES: DocumentRules = {
  requireApprovalBeforePrint: false,
  requireApprovalBeforePublish: true,
  requireApprovalBeforePacketSend: true,
  allowSalesPrintApproved: true,
  autoSubmitForApproval: false,
  staleOnPriceChange: true,
  staleOnMsrpChange: true,
  staleOnMileageChange: false,
  staleOnAddendumChange: true,
  staleOnSoldRemoved: true,
  autoUnpublishStale: false,
  requireManagerReviewStale: true,
  requireStickerMatchBeforeSigning: true,
  blockPacketOnMismatchFail: true,
  allowWarningOverrideWithReason: true,
  requireRereviewOnSignedChange: true,
  requireAddendumStickerInPacket: false,
  autoPublishApprovedWindow: false,
  autoPublishApprovedAddendum: false,
  hideSupersededPublic: true,
  showVersionHistoryPublic: false,
  trackQrScans: true,
};

// Merge stored rules onto defaults so a dealer row written before a new rule
// existed still resolves every key.
export function getDealerDocumentRules(settings: { document_rules?: Partial<DocumentRules> }): DocumentRules {
  return { ...DEFAULT_DOCUMENT_RULES, ...(settings?.document_rules || {}) };
}

// Hook form — reads the active dealer's rules from DealerSettings.
export function useDealerDocumentRules(): DocumentRules {
  const { settings } = useDealerSettings();
  return getDealerDocumentRules(settings as { document_rules?: Partial<DocumentRules> });
}

// Field that triggers a stale flag given the rules. Used by inventory change
// detection / the freshness queue.
export function staleTriggers(rules: DocumentRules): string[] {
  const t: string[] = [];
  if (rules.staleOnPriceChange) t.push("price");
  if (rules.staleOnMsrpChange) t.push("msrp");
  if (rules.staleOnMileageChange) t.push("mileage");
  if (rules.staleOnAddendumChange) t.push("addendum_items");
  if (rules.staleOnSoldRemoved) t.push("status");
  return t;
}

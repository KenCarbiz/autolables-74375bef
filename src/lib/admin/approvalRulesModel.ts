import type { AuditLogEntry } from "@/types/tenant";
import type { AdminIconName } from "@/components/admin/v3/editor";
import type { DocumentRules } from "@/lib/documentRules";
import { DOCUMENT_RULE_LABELS, roleLabelFor, type DocumentFamily, type ServiceGateContext } from "@/lib/admin/documentPolicy";

// Read models for the Approval rules screen. document_rules is one
// tenant-wide object; these helpers only project it per document and describe
// what each key does in the existing workflow. No rule, default or consequence
// is added here.

export const RULE_FAMILY_ICON: Record<DocumentFamily, AdminIconName> = {
  window_sticker: "file",
  buyers_guide: "book",
  addendum: "file-plus",
  inspection_record: "clipboard-check",
};

export type RuleSection = "approval" | "packet" | "reapproval" | "withdraw";

export const RULE_SECTION: Readonly<Record<keyof DocumentRules, RuleSection>> = {
  requireApprovalBeforePrint: "approval",
  requireApprovalBeforePublish: "approval",
  requireApprovalBeforePacketSend: "approval",
  autoSubmitForApproval: "approval",
  allowSalesPrintApproved: "approval",
  autoPublishApprovedWindow: "approval",
  autoPublishApprovedAddendum: "approval",
  requireStickerMatchBeforeSigning: "packet",
  blockPacketOnMismatchFail: "packet",
  allowWarningOverrideWithReason: "packet",
  requireAddendumStickerInPacket: "packet",
  requireRereviewOnSignedChange: "packet",
  staleOnPriceChange: "reapproval",
  staleOnMsrpChange: "reapproval",
  staleOnMileageChange: "reapproval",
  staleOnAddendumChange: "reapproval",
  requireManagerReviewStale: "reapproval",
  staleOnSoldRemoved: "withdraw",
  autoUnpublishStale: "withdraw",
  hideSupersededPublic: "withdraw",
  showVersionHistoryPublic: "withdraw",
  trackQrScans: "withdraw",
};

export const SECTION_TITLE: Record<RuleSection, { title: string; blurb: string }> = {
  approval: { title: "Who approves", blurb: "A manager approves before the document is used. Salespeople never approve." },
  packet: { title: "Packet and signing checks", blurb: "Checks that run before a customer packet is sent or signed." },
  reapproval: { title: "Price or equipment changed: needs a new approval", blurb: "These changes mark the document stale so it is reviewed again." },
  withdraw: { title: "Sold or removed: withdrawn, not re-approved", blurb: "A vehicle that is no longer for sale is handled as a withdrawal." },
};

export interface WhoWhen {
  who: string;
  when: string;
}

const list = (parts: string[]): string => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** The "Who approves & when" cell: the approver in effect and the moments an approval is required. */
export function whoApprovesWhen(family: DocumentFamily, rules: DocumentRules, gates: ServiceGateContext): WhoWhen {
  if (family === "inspection_record") {
    if (!gates.k208Required) return { who: "No signer required", when: "A K-208 is not required before customer signing" };
    const who = gates.k208Roles.length ? `Selected roles: ${gates.k208Roles.map(roleLabelFor).join(", ")}` : "Any accepted signer";
    return { who: gates.licenseeCertification ? `${who} and licensee` : who, when: "Before customer signing, Used and CPO" };
  }
  const moments = [rules.requireApprovalBeforePrint ? "print" : null, rules.requireApprovalBeforePublish ? "publish" : null, family === "addendum" && rules.requireApprovalBeforePacketSend ? "packet send" : null].filter((x): x is string => !!x);
  if (!moments.length) return { who: "No approval gate", when: rules.autoSubmitForApproval ? "Documents are still submitted for review when generated" : "Nothing waits for approval" };
  const reapproval = [rules.staleOnPriceChange ? "price" : null, rules.staleOnMsrpChange ? "MSRP" : null, family === "addendum" && rules.staleOnAddendumChange ? "products" : null, rules.staleOnMileageChange && family === "window_sticker" ? "mileage" : null].filter((x): x is string => !!x);
  return {
    who: "Manager",
    when: `Before ${list(moments)}${reapproval.length ? `. Reviewed again after a ${list(reapproval)} change` : ""}`,
  };
}

export interface Consequence {
  trigger: string;
  outcome: "reapproval" | "withdraw";
  text: string;
}

/** What happens for each kind of change, kept separate so Sold or removed is never read as a price change. */
export function changeConsequences(rules: DocumentRules): Consequence[] {
  const review = rules.requireManagerReviewStale;
  const reapproveText = (on: boolean, what: string): string => (on ? (review ? `${what} marks the document stale and a manager reviews it again.` : `${what} marks the document stale. No manager review is required.`) : `${what} does not mark the document stale.`);
  return [
    { trigger: "Price changed", outcome: "reapproval", text: reapproveText(rules.staleOnPriceChange, "A price change") },
    { trigger: "MSRP changed", outcome: "reapproval", text: reapproveText(rules.staleOnMsrpChange, "An MSRP change") },
    { trigger: "Mileage changed", outcome: "reapproval", text: reapproveText(rules.staleOnMileageChange, "A mileage change") },
    { trigger: "Addendum items changed", outcome: "reapproval", text: reapproveText(rules.staleOnAddendumChange, "A change to addendum items") },
    {
      trigger: "Vehicle sold or removed",
      outcome: "withdraw",
      text: rules.staleOnSoldRemoved
        ? rules.autoUnpublishStale
          ? "The document is flagged and its public copy is withdrawn automatically. It is not sent back for a new approval."
          : "The document is flagged for review. Its public copy stays up until a person withdraws it. It is not sent back for a new approval."
        : "A sold or removed vehicle is not flagged. Its public copy stays up.",
    },
  ];
}

export const SIGNED_VERSIONS_INVARIANT = "Signed and approved versions are always preserved. A replacement is saved as a new version linked to the one it replaces, and no setting turns this off.";

const EFFECT: Partial<Record<keyof DocumentRules, (after: boolean) => string>> = {
  requireApprovalBeforePrint: (a) => (a ? "Documents wait for a manager before they can be printed." : "Documents can be printed without a manager approval."),
  requireApprovalBeforePublish: (a) => (a ? "Documents wait for a manager before they reach the Vehicle Passport." : "Documents can reach the Vehicle Passport without a manager approval."),
  requireApprovalBeforePacketSend: (a) => (a ? "An addendum packet waits for a manager before it is sent." : "An addendum packet can be sent without a manager approval."),
  autoPublishApprovedWindow: (a) => (a ? "An approved window sticker is published without a second step." : "An approved window sticker waits for someone to publish it."),
  autoPublishApprovedAddendum: (a) => (a ? "An approved addendum is published without a second step." : "An approved addendum waits for someone to publish it."),
  staleOnPriceChange: (a) => (a ? "A price change will mark documents stale." : "A price change will no longer mark documents stale."),
  staleOnSoldRemoved: (a) => (a ? "A sold or removed vehicle will flag its documents. This is a withdrawal, not a re-approval." : "A sold or removed vehicle will no longer flag its documents."),
  autoUnpublishStale: (a) => (a ? "Stale public documents are withdrawn automatically." : "Stale public documents stay up until a person withdraws them."),
  requireManagerReviewStale: (a) => (a ? "Stale documents go to a manager for review." : "Stale documents no longer need a manager review."),
};

export const ruleEffect = (key: keyof DocumentRules, after: boolean): string => EFFECT[key]?.(after) ?? `${DOCUMENT_RULE_LABELS[key]}: now ${after ? "on" : "off"}.`;

export interface PolicyChangeLine {
  id: string;
  at: string;
  by: string | null;
  keys: string[];
}

const touched = (entry: AuditLogEntry, keys: readonly string[]): string[] => {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const after = (d.after && typeof d.after === "object" ? Object.keys(d.after as Record<string, unknown>) : []) as string[];
  const listed = [d.keys, d.changed_keys, d.changed, d.fields].flatMap((v) => (Array.isArray(v) ? (v as unknown[]).map(String) : []));
  const all = [...listed, ...after];
  return keys.filter((k) => all.includes(k));
};

/** Real audit rows that changed document_rules, newest first. Empty when the log holds none: no event is invented. */
export function policyChangeLines(entries: readonly AuditLogEntry[], keys: readonly string[], limit = 8): PolicyChangeLine[] {
  return entries
    .filter((e) => e.action === "settings_updated" || e.action === "service_policy_changed")
    .map((e) => ({ e, hit: touched(e, keys) }))
    .filter((x) => x.hit.length > 0 || JSON.stringify(x.e.details ?? {}).includes(`"document_rules"`))
    .sort((a, b) => (a.e.created_at < b.e.created_at ? 1 : -1))
    .slice(0, limit)
    .map((x) => ({ id: String(x.e.id ?? x.e.created_at), at: x.e.created_at, by: x.e.user_email ?? null, keys: x.hit }));
}

/** Combinations that are allowed to save but do nothing, shown in the editor and the review. */
export function ruleComboWarnings(r: DocumentRules): string[] {
  const w: string[] = [];
  if (!r.requireApprovalBeforePublish && (r.autoPublishApprovedWindow || r.autoPublishApprovedAddendum)) w.push("Auto-publish of approved documents has no effect while no approval is required before publishing.");
  if (r.autoUnpublishStale && !(r.staleOnPriceChange || r.staleOnMsrpChange || r.staleOnMileageChange || r.staleOnAddendumChange || r.staleOnSoldRemoved)) w.push("Auto-unpublish has nothing to act on while no change marks a document stale.");
  return w;
}

import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { AuditLogEntry } from "@/types/tenant";
import { getDealerDocumentRules, type DocumentRules } from "@/lib/documentRules";
import type { CountValue } from "@/lib/admin/health";
import { describeAge } from "@/lib/admin/health";
import { adminTabHref } from "@/lib/admin/sections";
import { diffFields } from "@/lib/admin/reviewApply";

// Documents & Service read models. The document workflow rules are one
// tenant-wide object (`document_rules`, written through merge_dealer_settings);
// this module projects them per document family so a manager can read what
// each document needs without a second editor. The K-208 inspection record is
// governed by the service-policy keys, which the server protects and audits.

export type DocumentFamily = "window_sticker" | "buyers_guide" | "addendum" | "inspection_record";

export interface RuleToggle {
  key: keyof DocumentRules;
  label: string;
}

export const DOCUMENT_RULE_LABELS: Readonly<Record<keyof DocumentRules, string>> = {
  requireApprovalBeforePrint: "Require manager approval before printing",
  requireApprovalBeforePublish: "Require manager approval before publishing to the Vehicle Passport",
  requireApprovalBeforePacketSend: "Require manager approval before sending an addendum packet",
  allowSalesPrintApproved: "Allow salespeople to print approved documents",
  autoSubmitForApproval: "Auto-submit newly generated documents for approval",
  staleOnPriceChange: "Mark documents stale when the vehicle price changes",
  staleOnMsrpChange: "Mark stale when MSRP changes",
  staleOnMileageChange: "Mark stale when mileage changes",
  staleOnAddendumChange: "Mark stale when addendum items change",
  staleOnSoldRemoved: "Mark stale when the vehicle is sold or removed",
  autoUnpublishStale: "Auto-unpublish stale public documents",
  requireManagerReviewStale: "Require manager review for stale documents",
  requireStickerMatchBeforeSigning: "Require addendum sticker match before customer signing",
  blockPacketOnMismatchFail: "Block packet send when sticker and packet match fails",
  allowWarningOverrideWithReason: "Allow warning override with a manager reason",
  requireRereviewOnSignedChange: "Require customer re-review if a signed packet changes",
  requireAddendumStickerInPacket: "Require a generated addendum sticker in the packet before signing",
  autoPublishApprovedWindow: "Auto-publish approved window stickers",
  autoPublishApprovedAddendum: "Auto-publish approved addendum stickers",
  hideSupersededPublic: "Hide superseded documents from the public page",
  showVersionHistoryPublic: "Show document version history publicly",
  trackQrScans: "Track QR scans",
};

const toggles = (keys: Array<keyof DocumentRules>): RuleToggle[] => keys.map((key) => ({ key, label: DOCUMENT_RULE_LABELS[key] }));

export interface DocumentFamilyDef {
  id: DocumentFamily;
  label: string;
  description: string;
  /** Rules shown in the selected-rule rail; empty when the family is governed elsewhere. */
  toggles: RuleToggle[];
  /** Where the family's rules are edited when not here. */
  editHref: string | null;
  /** The builder for this family; opening it generates nothing. */
  previewHref: string;
}

export const DOCUMENT_FAMILIES: readonly DocumentFamilyDef[] = [
  {
    id: "window_sticker",
    label: "Window sticker",
    description: "Dealer window stickers for new and used inventory.",
    toggles: toggles([
      "requireApprovalBeforePrint",
      "requireApprovalBeforePublish",
      "autoSubmitForApproval",
      "allowSalesPrintApproved",
      "staleOnPriceChange",
      "staleOnMsrpChange",
      "staleOnMileageChange",
      "staleOnSoldRemoved",
      "autoUnpublishStale",
      "requireManagerReviewStale",
      "autoPublishApprovedWindow",
      "hideSupersededPublic",
      "showVersionHistoryPublic",
      "trackQrScans",
    ]),
    editHref: null,
    previewHref: "/sticker-studio",
  },
  {
    id: "buyers_guide",
    label: "Buyers Guide",
    description: "The FTC Buyers Guide on used and CPO inventory.",
    toggles: toggles(["requireApprovalBeforePrint", "requireApprovalBeforePublish", "allowSalesPrintApproved", "staleOnSoldRemoved", "requireManagerReviewStale"]),
    editHref: null,
    previewHref: "/buyers-guide",
  },
  {
    id: "addendum",
    label: "Addendum",
    description: "Dealer addendums and the signed customer packet.",
    toggles: toggles([
      "requireApprovalBeforePrint",
      "requireApprovalBeforePublish",
      "requireApprovalBeforePacketSend",
      "autoSubmitForApproval",
      "staleOnPriceChange",
      "staleOnAddendumChange",
      "staleOnSoldRemoved",
      "autoUnpublishStale",
      "requireManagerReviewStale",
      "requireStickerMatchBeforeSigning",
      "blockPacketOnMismatchFail",
      "allowWarningOverrideWithReason",
      "requireRereviewOnSignedChange",
      "requireAddendumStickerInPacket",
      "autoPublishApprovedAddendum",
    ]),
    editHref: null,
    previewHref: "/addendum",
  },
  {
    id: "inspection_record",
    label: "Inspection record",
    description: "The K-208 safety inspection on used and CPO inventory.",
    toggles: [],
    editHref: adminTabHref("service-policy", "signing-gates"),
    previewHref: "/service",
  },
];

export const familyDef = (id: DocumentFamily): DocumentFamilyDef => DOCUMENT_FAMILIES.find((f) => f.id === id) as DocumentFamilyDef;

export interface ServiceGateContext {
  k208Required: boolean;
  k208Roles: string[];
  licenseeCertification: boolean;
  installVerification: boolean;
}

type GateSettings = Pick<DealerSettings, "require_safety_inspection" | "k208_authority_roles" | "require_k208_licensee_certification" | "require_install_verification">;

export const serviceGateContext = (settings: GateSettings): ServiceGateContext => ({
  k208Required: settings.require_safety_inspection === true,
  k208Roles: settings.k208_authority_roles ?? [],
  licenseeCertification: settings.require_k208_licensee_certification === true,
  installVerification: settings.require_install_verification === true,
});

export const K208_SIGNER_ROLES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "owner", label: "Owner" },
  { key: "admin", label: "Admin" },
  { key: "general_manager", label: "General Manager" },
  { key: "service_manager", label: "Service Manager" },
  { key: "service_advisor", label: "Service Writer" },
];

export const roleLabelFor = (role: string): string => K208_SIGNER_ROLES.find((r) => r.key === role)?.label ?? role.replace(/_/g, " ");

export interface DocumentRuleRow {
  family: DocumentFamily;
  document: string;
  appliesTo: string;
  approval: string;
  refreshAfter: string;
}

const joinList = (parts: string[]): string => parts.join(", ");

/** One row per document family, read from the rules in force (or a draft). */
export function documentRuleRows(rules: DocumentRules, gates: ServiceGateContext): DocumentRuleRow[] {
  const approvalFor = (extra: string[] = []): string => {
    const gatesOn = [
      rules.requireApprovalBeforePrint ? "print" : null,
      rules.requireApprovalBeforePublish ? "publish" : null,
      ...extra,
    ].filter((x): x is string => !!x);
    return gatesOn.length ? `Manager before ${joinList(gatesOn)}` : "No approval gate";
  };
  const refreshFor = (keys: Array<{ key: keyof DocumentRules; label: string }>): string => {
    const on = keys.filter((k) => rules[k.key]).map((k) => k.label);
    return on.length ? joinList(on) : "Never";
  };

  const k208Approval = gates.k208Roles.length
    ? `Authorized signer (${gates.k208Roles.map(roleLabelFor).join(", ")})`
    : "Any signed K-208";

  return [
    {
      family: "window_sticker",
      document: "Window sticker",
      appliesTo: "New & Used",
      approval: approvalFor(),
      refreshAfter: refreshFor([
        { key: "staleOnPriceChange", label: "Price" },
        { key: "staleOnMsrpChange", label: "MSRP" },
        { key: "staleOnMileageChange", label: "Mileage" },
        { key: "staleOnSoldRemoved", label: "Sold or removed" },
      ]),
    },
    {
      family: "buyers_guide",
      document: "Buyers Guide",
      appliesTo: "Used & CPO",
      approval: approvalFor(),
      refreshAfter: refreshFor([{ key: "staleOnSoldRemoved", label: "Sold or removed" }]),
    },
    {
      family: "addendum",
      document: "Addendum",
      appliesTo: "All eligible",
      approval: approvalFor(rules.requireApprovalBeforePacketSend ? ["packet send"] : []),
      refreshAfter: refreshFor([
        { key: "staleOnPriceChange", label: "Price" },
        { key: "staleOnAddendumChange", label: "Products" },
        { key: "staleOnSoldRemoved", label: "Sold or removed" },
      ]),
    },
    {
      family: "inspection_record",
      document: "Inspection record",
      appliesTo: gates.k208Required ? "Used & CPO, before signing" : "Where required",
      approval: gates.k208Required ? (gates.licenseeCertification ? `${k208Approval} + licensee certification` : k208Approval) : "Not required before signing",
      refreshAfter: "Inspection outcome",
    },
  ];
}

/** The one-line policy summary shown under the table for the selected family. */
export function familyPolicySentence(family: DocumentFamily, rules: DocumentRules, gates: ServiceGateContext): string {
  if (family === "inspection_record") {
    return gates.k208Required
      ? "Inspection records are required before customer signing on used and CPO vehicles."
      : "A completed inspection is not required before customer signing.";
  }
  const row = documentRuleRows(rules, gates).find((r) => r.family === family) as DocumentRuleRow;
  const refresh = row.refreshAfter === "Never" ? "are not marked for review by vehicle changes" : `are marked for review when ${row.refreshAfter.toLowerCase()} changes`;
  return `${row.document} documents ${refresh}.`;
}

export interface RuleChange {
  key: keyof DocumentRules;
  label: string;
  before: boolean;
  after: boolean;
}

const asRecord = (v: object): Record<string, unknown> => v as unknown as Record<string, unknown>;

export function describeRuleChanges(before: DocumentRules, after: DocumentRules): RuleChange[] {
  return diffFields(asRecord(before), asRecord(after)).map((d) => ({
    key: d.field as keyof DocumentRules,
    label: DOCUMENT_RULE_LABELS[d.field as keyof DocumentRules] ?? d.field,
    before: !!d.before,
    after: !!d.after,
  }));
}

const LOOSENING_RULES: ReadonlyArray<keyof DocumentRules> = [
  "requireApprovalBeforePrint",
  "requireApprovalBeforePublish",
  "requireApprovalBeforePacketSend",
  "requireManagerReviewStale",
  "requireStickerMatchBeforeSigning",
  "blockPacketOnMismatchFail",
  "requireRereviewOnSignedChange",
  "requireAddendumStickerInPacket",
  "hideSupersededPublic",
];

const AUTOMATING_RULES: ReadonlyArray<keyof DocumentRules> = ["autoPublishApprovedWindow", "autoPublishApprovedAddendum", "autoUnpublishStale", "showVersionHistoryPublic"];

/** Review warnings: anything that removes a gate or makes the system act on its own. */
export function documentRuleWarnings(before: DocumentRules, after: DocumentRules): string[] {
  const out: string[] = [];
  for (const c of describeRuleChanges(before, after)) {
    if (LOOSENING_RULES.includes(c.key) && c.before && !c.after) out.push(`Removes a gate: ${c.label.toLowerCase()} will no longer apply.`);
    if (AUTOMATING_RULES.includes(c.key) && !c.before && c.after) out.push(`Automatic behavior: ${c.label.toLowerCase()} without a person confirming each document.`);
  }
  return out;
}

export const rulesFromSettings = (settings: { document_rules?: Partial<DocumentRules> }): DocumentRules => getDealerDocumentRules(settings);

// ── Service policy ───────────────────────────────────────────────────────

export const SERVICE_POLICY_KEYS = [
  "require_safety_inspection",
  "k208_authority_roles",
  "require_k208_licensee_certification",
  "require_install_verification",
  "recon_auto_approve_amount",
  "recon_approval_email",
  "prep_require_ro",
  "prep_detail_photos_required",
  "prep_service_photo_tasks",
] as const;

export type ServicePolicyKey = (typeof SERVICE_POLICY_KEYS)[number];
export type ServicePolicy = Pick<DealerSettings, ServicePolicyKey>;

export const SERVICE_POLICY_LABELS: Readonly<Record<ServicePolicyKey, string>> = {
  require_safety_inspection: "Require K-208 before customer signing",
  k208_authority_roles: "Roles whose signed K-208 satisfies the gate",
  require_k208_licensee_certification: "Require licensee certification of the K-208",
  require_install_verification: "Require install verification before customer signing",
  recon_auto_approve_amount: "Auto-approve recon line items up to",
  recon_approval_email: "Recon approval recipients",
  prep_require_ro: "Require RO number on Service Install sign-offs",
  prep_detail_photos_required: "Require photos on Initial Inventory Detail",
  prep_service_photo_tasks: "Service tasks that require photo proof",
};

/** Keys merge_dealer_settings restricts to service-policy roles and audits server-side. */
export const SERVER_PROTECTED_SERVICE_KEYS: ReadonlyArray<ServicePolicyKey> = [
  "require_safety_inspection",
  "k208_authority_roles",
  "require_k208_licensee_certification",
];

export const servicePolicyFromSettings = (settings: ServicePolicy): ServicePolicy => ({
  require_safety_inspection: settings.require_safety_inspection === true,
  k208_authority_roles: [...(settings.k208_authority_roles ?? [])],
  require_k208_licensee_certification: settings.require_k208_licensee_certification === true,
  require_install_verification: settings.require_install_verification === true,
  recon_auto_approve_amount: Number.isFinite(settings.recon_auto_approve_amount) ? settings.recon_auto_approve_amount : 500,
  recon_approval_email: settings.recon_approval_email ?? "",
  prep_require_ro: settings.prep_require_ro === true,
  prep_detail_photos_required: settings.prep_detail_photos_required === true,
  prep_service_photo_tasks: settings.prep_service_photo_tasks ?? "",
});

export const formatServiceValue = (key: ServicePolicyKey, value: unknown): string => {
  if (key === "k208_authority_roles") {
    const roles = Array.isArray(value) ? (value as string[]) : [];
    return roles.length ? roles.map(roleLabelFor).join(", ") : "Any signed K-208";
  }
  if (key === "recon_auto_approve_amount") return `$${Number(value ?? 0).toLocaleString()}`;
  if (typeof value === "boolean") return value ? "On" : "Off";
  const s = String(value ?? "").trim();
  return s.length ? s : "None";
};

export function servicePolicyWarnings(before: ServicePolicy, after: ServicePolicy): string[] {
  const out: string[] = [];
  if (before.require_safety_inspection && !after.require_safety_inspection) out.push("Customer disclosures can be signed without a completed K-208 safety inspection.");
  if (!before.require_safety_inspection && after.require_safety_inspection) out.push("Used and CPO disclosures cannot be signed until a K-208 is completed; open deals may be held.");
  if (before.require_install_verification && !after.require_install_verification) out.push("Customer disclosures can be signed without verified install proof for pre-installed products.");
  if (before.require_k208_licensee_certification && !after.require_k208_licensee_certification) out.push("A technician's K-208 will satisfy the gate without a manager's certification.");
  if (after.require_safety_inspection && before.k208_authority_roles.length > 0 && after.k208_authority_roles.length === 0) out.push("Any signed K-208 will satisfy the gate, including an anonymous QR sign-off.");
  if (after.recon_auto_approve_amount > before.recon_auto_approve_amount) out.push(`Recon line items up to ${formatServiceValue("recon_auto_approve_amount", after.recon_auto_approve_amount)} will clear without a manager decision.`);
  if (before.prep_require_ro && !after.prep_require_ro) out.push("Service Install sign-offs will no longer require an RO number.");
  if (before.prep_detail_photos_required && !after.prep_detail_photos_required) out.push("Initial Inventory Detail sign-offs will no longer require photos.");
  return out;
}

export const servicePolicyValidation = (draft: ServicePolicy): string[] => {
  const errors: string[] = [];
  if (!Number.isFinite(draft.recon_auto_approve_amount) || draft.recon_auto_approve_amount < 0) errors.push("The recon auto-approve amount must be zero or more.");
  const emails = draft.recon_approval_email.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) errors.push("Recon approval recipients must be valid email addresses.");
  return errors;
};

// ── Change provenance ────────────────────────────────────────────────────

export interface PolicyChangeRecord {
  at: string;
  by: string | null;
  action: string;
}

const mentionsKey = (entry: AuditLogEntry, keys: readonly string[]): boolean => {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const listed = [d.keys, d.changed_keys, d.changed, d.protected_keys, d.fields].flatMap((v) =>
    Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v as Record<string, unknown>) : [],
  );
  if (listed.some((k) => keys.includes(String(k)))) return true;
  if (typeof d.key === "string" && keys.includes(d.key)) return true;
  const serialized = JSON.stringify(d);
  return keys.some((k) => serialized.includes(`"${k}"`));
};

/** The newest audit row that changed one of `keys`, or null when none is recorded. */
export function latestPolicyChange(entries: readonly AuditLogEntry[], keys: readonly string[]): PolicyChangeRecord | null {
  const candidates = entries
    .filter((e) => (e.action === "settings_updated" || e.action === "service_policy_changed") && mentionsKey(e, keys))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const hit = candidates[0];
  if (!hit) return null;
  return { at: hit.created_at, by: hit.user_email ?? null, action: hit.action };
}

// ── Readiness ────────────────────────────────────────────────────────────

export type ReadinessState = "ok" | "needs" | "unknown";

export interface ReadinessItem {
  key: "calibration" | "templates" | "disclosures";
  label: string;
  state: ReadinessState;
  chip: string;
  detailLabel: string;
  detailValue: string;
}

export type CalibrationStatus =
  | { kind: "known"; saved: boolean; savedAt: string | null; testedAt: string | null }
  | { kind: "failed" }
  | { kind: "loading" };

export interface ReadinessInput {
  calibration: CalibrationStatus;
  /** Label slots with an explicit template, out of `templateSlots`. */
  templatesConfigured: CountValue | null;
  templateSlots: number;
  /** Active products whose disclosure text is blank. */
  disclosuresMissing: CountValue | null;
  now: number;
}

export function deriveDocumentReadiness(i: ReadinessInput): ReadinessItem[] {
  const calibration: ReadinessItem = (() => {
    const base = { key: "calibration" as const, label: "Printer calibration" };
    if (i.calibration.kind === "failed") return { ...base, state: "unknown", chip: "Unknown", detailLabel: "Profile", detailValue: "Could not be read" };
    if (i.calibration.kind === "loading") return { ...base, state: "unknown", chip: "Checking", detailLabel: "Profile", detailValue: "…" };
    if (!i.calibration.saved) return { ...base, state: "needs", chip: "Needs setup", detailLabel: "Profile", detailValue: "No profile saved" };
    if (i.calibration.testedAt) return { ...base, state: "ok", chip: "Tested", detailLabel: "Last tested", detailValue: describeAge(i.calibration.testedAt, i.now) };
    return { ...base, state: "needs", chip: "Needs test", detailLabel: "Profile saved", detailValue: i.calibration.savedAt ? `${describeAge(i.calibration.savedAt, i.now)}, no test recorded` : "No test recorded" };
  })();

  const templates: ReadinessItem = (() => {
    const base = { key: "templates" as const, label: "Templates", detailLabel: "Label slots" };
    const c = i.templatesConfigured;
    if (!c || c.kind === "failed") return { ...base, state: "unknown", chip: "Unknown", detailValue: "Could not be read" };
    if (c.kind === "loading") return { ...base, state: "unknown", chip: "Checking", detailValue: "…" };
    if (c.value >= i.templateSlots) return { ...base, state: "ok", chip: `${c.value} configured`, detailValue: `All ${i.templateSlots} slots set` };
    if (c.value === 0) return { ...base, state: "needs", chip: "None configured", detailValue: `0 of ${i.templateSlots} slots set` };
    return { ...base, state: "needs", chip: `${c.value} of ${i.templateSlots} configured`, detailValue: "Unset slots use the platform default" };
  })();

  const disclosures: ReadinessItem = (() => {
    const base = { key: "disclosures" as const, label: "Required disclosures", detailLabel: "Active products" };
    const c = i.disclosuresMissing;
    if (!c || c.kind === "failed") return { ...base, state: "unknown", chip: "Unknown", detailValue: "Could not be read" };
    if (c.kind === "loading") return { ...base, state: "unknown", chip: "Checking", detailValue: "…" };
    if (c.value === 0) return { ...base, state: "ok", chip: "Complete", detailValue: "Every active product has a disclosure" };
    return { ...base, state: "needs", chip: "Review required", detailValue: `${c.value}${c.capped ? "+" : ""} missing disclosure text` };
  })();

  return [calibration, templates, disclosures];
}

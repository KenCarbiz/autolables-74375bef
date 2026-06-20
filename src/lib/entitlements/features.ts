// ──────────────────────────────────────────────────────────────────────
// AutoLabels feature entitlement map. A thin READ-ONLY layer over the shared
// app_entitlements (read via useEntitlements). Billing stays single-writer
// (Autocurb's Stripe webhook) — nothing here mutates entitlement state. This is
// only a UI/feature grouping that interprets the tenant's autolabels plan_tier.
// ──────────────────────────────────────────────────────────────────────

export type FeatureKey =
  // Core
  | "autolabels_access" | "sticker_studio" | "window_stickers" | "addendum_stickers"
  | "vehicle_passport" | "print_settings" | "addendum_signing"
  // Professional
  | "template_customization" | "generated_document_approval" | "qr_tracking"
  | "vehicle_file_documents" | "customer_packet_documents" | "stale_document_review_queue"
  | "batch_generation" | "inventory_change_detection" | "auto_stale_flags"
  | "auto_publish_rules" | "manager_approval_rules" | "sticker_packet_match_review"
  // Compliance
  | "compliance_evidence_timeline" | "evidence_packet_export" | "audit_log_viewer"
  // Platform / admin
  | "global_template_library" | "dealer_setup_wizard" | "team_permissions" | "role_based_approvals";

export type PlanTier = "none" | "starter" | "pro" | "compliance" | "platform";

const RANK: Record<PlanTier, number> = { none: 0, starter: 1, pro: 2, compliance: 3, platform: 4 };
export const rankOf = (t: PlanTier) => RANK[t];

// Minimum tier each feature needs. Existing live flows (signing, document rules,
// match review) sit at starter/pro so no current dealer loses them; only the
// not-yet-built compliance surfaces gate at the compliance tier. Platform
// features are role-gated (see useFeatureGate), not tier-gated.
export const FEATURE_TIER: Record<FeatureKey, PlanTier> = {
  autolabels_access: "starter",
  sticker_studio: "starter",
  window_stickers: "starter",
  addendum_stickers: "starter",
  vehicle_passport: "starter",
  print_settings: "starter",
  addendum_signing: "starter",

  template_customization: "pro",
  generated_document_approval: "pro",
  qr_tracking: "pro",
  vehicle_file_documents: "pro",
  customer_packet_documents: "pro",
  stale_document_review_queue: "pro",
  batch_generation: "pro",
  inventory_change_detection: "pro",
  auto_stale_flags: "pro",
  auto_publish_rules: "pro",
  manager_approval_rules: "pro",
  sticker_packet_match_review: "pro",

  compliance_evidence_timeline: "compliance",
  evidence_packet_export: "compliance",
  audit_log_viewer: "compliance",

  global_template_library: "platform",
  dealer_setup_wizard: "platform",
  team_permissions: "platform",
  role_based_approvals: "platform",
};

// Normalize the raw app_entitlements plan_tier string to a PlanTier. The
// bundled "essential" plan is treated as Pro-level; an active dealer with an
// unrecognized/blank tier defaults to Pro so they keep working (never locked out
// of shipped features). No access -> "none".
export function normalizeTier(planTier: string | null | undefined, hasAccess: boolean): PlanTier {
  if (!hasAccess) return "none";
  const t = (planTier || "").toLowerCase();
  if (["compliance", "compliance_pro", "enterprise", "platform"].includes(t)) return "compliance";
  if (["pro", "professional", "growth", "plus"].includes(t)) return "pro";
  if (["essential", "bundled", "autocurb"].includes(t)) return "pro";
  if (["starter", "free", "basic", "trial"].includes(t)) return "starter";
  return "pro"; // active dealer, unknown tier -> safe default
}

export function planLabel(t: PlanTier): string {
  return { none: "No access", starter: "Starter", pro: "Pro", compliance: "Compliance", platform: "Platform" }[t];
}

// UI-only plan grouping for display (not billing-authoritative).
export const PLAN_FEATURES: { plan: PlanTier; label: string; features: FeatureKey[] }[] = [
  { plan: "starter", label: "Starter", features: ["window_stickers", "addendum_stickers", "print_settings", "vehicle_passport", "addendum_signing"] },
  { plan: "pro", label: "Pro", features: ["template_customization", "qr_tracking", "batch_generation", "generated_document_approval", "vehicle_file_documents", "stale_document_review_queue"] },
  { plan: "compliance", label: "Compliance", features: ["compliance_evidence_timeline", "evidence_packet_export", "sticker_packet_match_review", "manager_approval_rules", "audit_log_viewer"] },
  { plan: "platform", label: "Platform", features: ["global_template_library", "team_permissions", "dealer_setup_wizard"] },
];

export const FEATURE_LABEL: Partial<Record<FeatureKey, string>> = {
  sticker_studio: "Sticker Studio",
  window_stickers: "Window stickers",
  addendum_stickers: "Addendum stickers",
  print_settings: "Print settings & calibration",
  vehicle_passport: "Vehicle Passport",
  addendum_signing: "Addendum signing",
  template_customization: "Template customization",
  qr_tracking: "QR scan analytics",
  batch_generation: "Batch generation",
  generated_document_approval: "Document approval workflow",
  vehicle_file_documents: "Vehicle File documents",
  stale_document_review_queue: "Document review queue",
  manager_approval_rules: "Manager approval rules",
  sticker_packet_match_review: "Sticker/packet match review",
  compliance_evidence_timeline: "Compliance evidence timeline",
  evidence_packet_export: "Evidence packet export",
  audit_log_viewer: "Audit log viewer",
  global_template_library: "Global template library",
  team_permissions: "Team permissions",
  dealer_setup_wizard: "Dealer setup wizard",
};

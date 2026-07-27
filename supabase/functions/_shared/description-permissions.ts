// ─────────────────────────────────────────────────────────────────────
// Named Description V3 permissions, resolved from tenant membership role.
//
// These are the §25 names mapped onto the roles this repo already issues, in
// ONE place. The previous arrangement worked but scattered the same role list
// across the edge function, the RPCs and the React hook — three copies that
// drift, and a drift here 403s a button the UI already enabled.
//
// The names are the contract. The role sets behind them can change without
// touching a call site.
// ─────────────────────────────────────────────────────────────────────

export type DescriptionPermission =
  | "descriptions.view"
  | "descriptions.generate"
  | "descriptions.regenerate"
  | "descriptions.edit_configuration"
  | "descriptions.select_features"
  | "descriptions.view_sources"
  | "descriptions.review"
  | "descriptions.approve"
  | "descriptions.reject"
  | "descriptions.save_to_vehicle"
  | "descriptions.export"
  | "descriptions.publish"
  | "descriptions.unpublish"
  | "descriptions.archive"
  | "descriptions.bulk_generate"
  | "descriptions.bulk_review"
  | "descriptions.manage_voice_profile"
  | "descriptions.manage_channel_policies"
  | "descriptions.view_usage"
  | "descriptions.override_validation";

const norm = (r: string | null | undefined) => String(r || "").trim().toLowerCase();

// Anyone accepted into the tenant.
const MEMBER = [
  "owner", "general_manager", "gsm", "admin", "manager", "sales_manager",
  "salesperson", "sales", "staff", "used_car_manager", "inventory_manager",
  "office", "finance", "compliance", "service_manager", "technician", "porter",
];

// Spends provider credits or writes a version.
const PRODUCER = [
  "owner", "general_manager", "gsm", "admin", "manager", "sales_manager",
  "salesperson", "sales", "staff", "used_car_manager", "inventory_manager",
  "office", "finance", "compliance",
];

// Decides what a shopper sees.
const APPROVER = ["owner", "general_manager", "gsm", "admin", "manager", "compliance"];

// Changes what the STORE is allowed to claim about itself, or what a
// destination's rules are. Narrower than approval on purpose.
const CONFIGURATOR = ["owner", "general_manager", "gsm", "admin", "compliance"];

// Validation override is the most dangerous grant in the system: it lets a
// human publish copy the validator refused. Owner and compliance only, and
// even then it cannot make an unsupported fact true — see canOverride below.
const OVERRIDER = ["owner", "compliance"];

const MATRIX: Record<DescriptionPermission, string[]> = {
  "descriptions.view": MEMBER,
  "descriptions.view_sources": MEMBER,
  "descriptions.generate": PRODUCER,
  "descriptions.regenerate": PRODUCER,
  "descriptions.edit_configuration": PRODUCER,
  "descriptions.select_features": PRODUCER,
  "descriptions.save_to_vehicle": PRODUCER,
  "descriptions.export": PRODUCER,
  "descriptions.bulk_generate": APPROVER,
  "descriptions.review": APPROVER,
  "descriptions.approve": APPROVER,
  "descriptions.reject": APPROVER,
  "descriptions.bulk_review": APPROVER,
  "descriptions.publish": APPROVER,
  "descriptions.unpublish": APPROVER,
  "descriptions.archive": APPROVER,
  "descriptions.view_usage": APPROVER,
  "descriptions.manage_voice_profile": CONFIGURATOR,
  "descriptions.manage_channel_policies": CONFIGURATOR,
  "descriptions.override_validation": OVERRIDER,
};

export interface PermissionContext {
  /** Tenant membership role, read server-side. Never browser-supplied. */
  role: string | null | undefined;
  /** Platform admin bypasses the role matrix but not the override rules. */
  isPlatformAdmin?: boolean;
}

export function can(permission: DescriptionPermission, ctx: PermissionContext): boolean {
  if (ctx.isPlatformAdmin) return true;
  const role = norm(ctx.role);
  if (!role) return false;
  return (MATRIX[permission] ?? []).includes(role);
}

/**
 * Findings that no override may ever clear.
 *
 * §25: "An override must never allow unsupported vehicle facts to become
 * verified facts." A manager may accept a stylistic or policy risk. Nobody
 * may declare a vehicle fact true by clicking a button — that is the
 * difference between accepting risk and manufacturing evidence.
 */
const NON_OVERRIDABLE_FINDINGS = new Set([
  "IDENTITY_YEAR_CONFLICT",
  "REQUIRED_DATA_MISSING",
  "SOURCE_CONFLICT_UNRESOLVED",
  "UNSUPPORTED_FEATURE_CLAIM",
  "EXCLUDED_CLAIM_PRESENT",
  "DEALER_ADDED_AS_FACTORY",
  "CPO_CLAIM",
  "WARRANTY_CLAIM",
  "OWNERSHIP_CLAIM",
  "HISTORY_CLAIM",
  "SERVICE_CLAIM",
  "RECALL_CLAIM",
  "HIDDEN_TEXT_DETECTED",
]);

export interface OverrideRequest {
  validatorCodes: string[];
  reason: string;
  ctx: PermissionContext;
}

export interface OverrideDecision {
  allowed: boolean;
  /** Codes the override may clear. */
  overridable: string[];
  /** Codes it may never clear, with the reason it refused. */
  refused: string[];
  error?: string;
}

export function evaluateOverride(req: OverrideRequest): OverrideDecision {
  const refused = req.validatorCodes.filter((c) => NON_OVERRIDABLE_FINDINGS.has(c));
  const overridable = req.validatorCodes.filter((c) => !NON_OVERRIDABLE_FINDINGS.has(c));

  if (!can("descriptions.override_validation", req.ctx)) {
    return { allowed: false, overridable: [], refused: req.validatorCodes,
             error: "insufficient_permission" };
  }
  // A reason is mandatory: an override without one is unauditable, and the
  // audit trail is the only thing that makes the grant defensible later.
  if (!req.reason || req.reason.trim().length < 10) {
    return { allowed: false, overridable: [], refused: req.validatorCodes,
             error: "reason_required" };
  }
  if (refused.length) {
    return { allowed: false, overridable, refused,
             error: "unsupported_vehicle_facts_cannot_be_overridden" };
  }
  return { allowed: true, overridable, refused: [] };
}

export const NON_OVERRIDABLE = NON_OVERRIDABLE_FINDINGS;

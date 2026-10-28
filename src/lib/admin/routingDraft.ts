import {
  normalizeContactRouting,
  type CustomerPassportContactSettings,
  type PassportAgent,
  type RoutingPriorityItem,
} from "@/lib/passportRouting";
import {
  AUDIT_ACTION_ESCALATED,
  AUDIT_ACTION_ESCALATION_FAILED,
  buildTierPlan,
  emailEnabled,
  type TierPlan,
} from "../../../supabase/functions/_shared/escalation";
import { deriveRoutingReadiness, type RoutingReadiness } from "@/lib/admin/effectivePolicy";
import { diffFields, isUnchanged } from "@/lib/admin/reviewApply";

export { AUDIT_ACTION_ESCALATED, AUDIT_ACTION_ESCALATION_FAILED, buildTierPlan, emailEnabled };
export type { TierPlan };

// Pure helpers behind Contact & Routing and Escalation. The settings object
// is the one the resolver reads (`passport_contact_routing`, `passport_agents`);
// these functions describe it, validate a draft and gate its application.
// Nothing here writes.

export interface RoutingDraftSlice {
  routing: CustomerPassportContactSettings;
  agents: PassportAgent[];
}

export const namedAgents = (agents: readonly PassportAgent[]): PassportAgent[] => agents.filter((a) => a.name.trim().length > 0);

export const routingSliceFrom = (routing: unknown, agents: readonly PassportAgent[] | null | undefined): RoutingDraftSlice => ({
  routing: normalizeContactRouting(routing),
  agents: Array.isArray(agents) ? [...agents] : [],
});

export const isEmail = (v: string | undefined): boolean => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const blank = (v: string | undefined): boolean => !v || v.trim().length === 0;

/** Real validation errors, independent of readiness: these block review. */
export function validateRoutingDraft(slice: RoutingDraftSlice): string[] {
  const errors: string[] = [];
  const r = slice.routing;
  const dc = r.dealershipDefaultContact;
  if (!blank(dc.salesEmail) && !isEmail(dc.salesEmail)) errors.push("The sales lead inbox is not a valid email address.");
  if (!blank(r.bdcSettings?.bdcEmail) && !isEmail(r.bdcSettings?.bdcEmail)) errors.push("The BDC email is not a valid email address.");
  if (!blank(r.managerFallback?.managerEmail) && !isEmail(r.managerFallback?.managerEmail)) errors.push("The manager email is not a valid email address.");
  if (r.escalationRules.enabled && !(Number(r.escalationRules.firstResponseSlaMinutes) > 0)) errors.push("The first response target must be at least one minute.");
  for (const a of slice.agents) {
    if (blank(a.name) && (!blank(a.email) || !blank(a.phone) || !blank(a.smsNumber))) errors.push("Every salesperson with contact details needs a name.");
  }
  return Array.from(new Set(errors));
}

export interface RoutingApplyGate {
  ok: boolean;
  reason: string | null;
  /** Blockers the draft adds that the current configuration does not have. */
  newBlockers: string[];
  /** Blockers that already exist and remain after the change. */
  remainingBlockers: string[];
  readinessAfter: RoutingReadiness;
}

/**
 * A draft may be applied when it does not enable a route that has no working
 * destination. Existing gaps may remain (the chain still ends at the store
 * contact) but a change that introduces a dead route is refused.
 */
export function routingApplyGate(current: RoutingDraftSlice, draft: RoutingDraftSlice): RoutingApplyGate {
  const before = deriveRoutingReadiness(current.routing, current.agents);
  const after = deriveRoutingReadiness(draft.routing, draft.agents);
  const newBlockers = after.blockers.filter((b) => !before.blockers.includes(b));
  const remainingBlockers = after.blockers.filter((b) => before.blockers.includes(b));
  if (isUnchanged(current, draft)) return { ok: false, reason: "Nothing has changed.", newBlockers, remainingBlockers, readinessAfter: after };
  if (newBlockers.length) return { ok: false, reason: "Add a valid fallback before enabling this route.", newBlockers, remainingBlockers, readinessAfter: after };
  return { ok: true, reason: null, newBlockers, remainingBlockers, readinessAfter: after };
}

export const ROUTING_FIELD_LABELS: Readonly<Record<string, string>> = {
  contactMode: "Contact mode",
  showAgentProfile: "Show agent profile",
  agentDisplayRules: "Agent display",
  routingPriority: "Routing order",
  salesRotationSettings: "Sales rotation",
  afterHoursBehavior: "After-hours behavior",
  escalationRules: "Response and escalation",
  dealershipDefaultContact: "Store contact",
  bdcSettings: "BDC",
  managerFallback: "Manager fallback",
  businessHours: "Business hours",
  timezone: "Time zone",
  agents: "Sales team roster",
};

export interface ChangeRow {
  field: string;
  label: string;
  before: string;
  after: string;
}

const describe = (field: string, value: unknown): string => {
  if (value === undefined || value === null) return "Not set";
  switch (field) {
    case "contactMode":
      return value === "smart_routing" ? "Smart routing" : value === "assigned_agent" ? "Assigned agent" : value === "bdc" ? "BDC team" : "Dealership default";
    case "showAgentProfile":
      return value ? "Shown" : "Hidden";
    case "routingPriority":
      return (value as string[]).length + " steps";
    case "salesRotationSettings": {
      const v = value as CustomerPassportContactSettings["salesRotationSettings"];
      return v.enabled ? `On, ${v.method.replace(/_/g, " ")}` : "Off";
    }
    case "afterHoursBehavior":
      return String((value as CustomerPassportContactSettings["afterHoursBehavior"]).mode).replace(/_/g, " ");
    case "escalationRules": {
      const v = value as CustomerPassportContactSettings["escalationRules"];
      if (!v.enabled) return "Off";
      const parts = [`target ${v.firstResponseSlaMinutes} min`];
      if (v.escalateToBdcAfterMinutes) parts.push(`BDC after ${v.escalateToBdcAfterMinutes} min`);
      if (v.escalateToManagerAfterMinutes) parts.push(`manager after ${v.escalateToManagerAfterMinutes} min`);
      parts.push(emailEnabled(v) ? "email" : "no supported method");
      return parts.join(", ");
    }
    case "dealershipDefaultContact": {
      const v = value as CustomerPassportContactSettings["dealershipDefaultContact"];
      const set = [v.salesPhone ? "phone" : null, v.salesEmail ? "email" : null].filter(Boolean);
      return set.length ? `${set.join(" and ")} set` : "Not set";
    }
    case "bdcSettings": {
      const v = value as NonNullable<CustomerPassportContactSettings["bdcSettings"]>;
      return v.enabled ? (v.bdcEmail || v.bdcPhone ? "On, destination set" : "On, no destination") : "Off";
    }
    case "managerFallback": {
      const v = value as NonNullable<CustomerPassportContactSettings["managerFallback"]>;
      return v.enabled ? (v.managerEmail || v.managerPhone ? "On, recipient set" : "On, no recipient") : "Off";
    }
    case "businessHours":
      return `${(value as unknown[]).length} days`;
    case "agents":
      return `${namedAgents(value as PassportAgent[]).length} salespeople`;
    default:
      return typeof value === "object" ? "Changed" : String(value);
  }
};

/** Readable before/after rows for the review step; routing keys first, roster last. */
export function routingChangeRows(current: RoutingDraftSlice, draft: RoutingDraftSlice): ChangeRow[] {
  const rows = diffFields(
    current.routing as unknown as Record<string, unknown>,
    draft.routing as unknown as Record<string, unknown>,
  ).map((d) => ({ field: d.field, label: ROUTING_FIELD_LABELS[d.field] ?? d.field, before: describe(d.field, d.before), after: describe(d.field, d.after) }));
  if (!isUnchanged(namedAgents(current.agents), namedAgents(draft.agents))) {
    rows.push({ field: "agents", label: ROUTING_FIELD_LABELS.agents, before: describe("agents", current.agents), after: describe("agents", draft.agents) });
  }
  return rows;
}

export interface RoutingOrderRow {
  key: RoutingPriorityItem;
  step: number;
  title: string;
  description: string;
  owner: string;
  ownerDetail: string;
  state: "ok" | "incomplete" | "off";
  anchor: string;
}

const METHOD_LABEL: Record<string, string> = { round_robin: "Round robin", least_recent: "Least recent", weighted: "Weighted" };

/** The resolver's order, described in dealer language with the real state of each step. */
export function routingOrderRows(slice: RoutingDraftSlice): RoutingOrderRow[] {
  const r = slice.routing;
  const roster = namedAgents(slice.agents).filter((a) => a.acceptsPassportLeads !== false && a.manualOverride !== "unavailable");
  const dc = r.dealershipDefaultContact;
  const hasDefault = !blank(dc.salesPhone) || !blank(dc.salesEmail);
  return r.routingPriority.map((key, i): RoutingOrderRow => {
    const step = i + 1;
    switch (key) {
      case "crm_owner":
        return { key, step, title: "CRM owner", description: "Send to the existing CRM owner first.", owner: "CRM owner", ownerDetail: "From active deal or contact", state: "ok", anchor: "routing-contact-mode" };
      case "vehicle_assigned_agent":
        return { key, step, title: "Assigned salesperson", description: "Send to the assigned salesperson.", owner: "Salesperson", ownerDetail: "If one is assigned", state: "ok", anchor: "routing-roster" };
      case "available_sales_rotation": {
        const on = r.salesRotationSettings.enabled;
        const n = roster.length;
        return {
          key, step, title: "Sales rotation", description: "Use the store sales rotation.",
          owner: on ? `${n} ${n === 1 ? "salesperson" : "salespeople"}` : "Off",
          ownerDetail: on ? METHOD_LABEL[r.salesRotationSettings.method] ?? r.salesRotationSettings.method : "Rotation is disabled",
          state: !on ? "off" : n === 0 ? "incomplete" : "ok", anchor: "routing-rotation",
        };
      }
      case "bdc": {
        const on = !!r.bdcSettings?.enabled;
        const dest = !blank(r.bdcSettings?.bdcEmail) || !blank(r.bdcSettings?.bdcPhone);
        return { key, step, title: "BDC", description: "Send to the BDC team.", owner: on ? (dest ? "BDC desk" : "Incomplete") : "Off", ownerDetail: on ? (dest ? "Destination set" : "No destination") : "BDC is disabled", state: !on ? "off" : dest ? "ok" : "incomplete", anchor: "routing-bdc" };
      }
      case "sales_manager": {
        const on = !!r.managerFallback?.enabled;
        const dest = !blank(r.managerFallback?.managerEmail) || !blank(r.managerFallback?.managerPhone);
        return { key, step, title: "Manager fallback", description: "Escalate to a manager if no response.", owner: on ? (dest ? "Sales manager" : "Incomplete") : "Off", ownerDetail: on ? (dest ? "Recipient set" : "No recipient") : "Manager fallback is disabled", state: !on ? "off" : dest ? "ok" : "incomplete", anchor: "routing-manager" };
      }
      case "dealership_default":
      default:
        return { key, step, title: "Store contact", description: "Final fallback to the store contact.", owner: hasDefault ? "Store contact" : "Incomplete", ownerDetail: hasDefault ? "Phone or email set" : "No store contact", state: hasDefault ? "ok" : "incomplete", anchor: "routing-default-contact" };
    }
  });
}

export interface NotificationMethodRow {
  key: "email" | "sms" | "in_app" | "push";
  label: string;
  detail: string;
  supported: boolean;
  enabled: boolean;
}

/** Only the sender's implemented methods are selectable; the rest say why not. */
export function notificationMethodRows(rules: CustomerPassportContactSettings["escalationRules"]): NotificationMethodRow[] {
  const email = emailEnabled(rules);
  return [
    { key: "email", label: "Email notifications", detail: "Send notifications to the tier's destination.", supported: true, enabled: email },
    { key: "sms", label: "SMS", detail: "Not supported by the current sender.", supported: false, enabled: false },
    { key: "in_app", label: "In-app notifications", detail: "Not supported by the current sender.", supported: false, enabled: false },
    { key: "push", label: "Push", detail: "Not supported by the current sender.", supported: false, enabled: false },
  ];
}

/** Writes the email choice without touching the unsupported entries a dealer may have stored. */
export function withEmailMethod(rules: CustomerPassportContactSettings["escalationRules"], on: boolean): CustomerPassportContactSettings["escalationRules"] {
  const others = (rules.notifyMethods ?? []).filter((m) => m !== "email");
  return { ...rules, notifyMethods: on ? (["email", ...others] as typeof rules.notifyMethods) : (others.length ? others : []) };
}

/** Whether the escalation rules are complete enough to review: every timed tier has a destination. */
export function escalationComplete(slice: RoutingDraftSlice): { complete: boolean; missing: string[] } {
  const plan = buildTierPlan(slice.routing);
  if (!plan.enabled) return { complete: true, missing: [] };
  return { complete: plan.blockers.length === 0, missing: plan.blockers };
}

export type DeliveryResult = "accepted" | "failed" | "attempted";

export interface DeliveryActivityRow {
  id: string;
  requestLabel: string;
  rooftop: string;
  channel: string;
  attempt: number | null;
  result: DeliveryResult;
  at: string;
}

export const DELIVERY_RESULT_META: Readonly<Record<DeliveryResult, { label: string; tone: "success" | "danger" | "neutral" }>> = {
  accepted: { label: "Accepted", tone: "success" },
  failed: { label: "Provider rejected", tone: "danger" },
  attempted: { label: "Attempted", tone: "neutral" },
};

export interface AuditRowLike {
  id: string;
  action: string;
  entity_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

/** Audit rows into delivery activity. Rows written before outcomes existed read as Attempted, never Accepted. */
export function deliveryActivityFromAudit(rows: readonly AuditRowLike[], storeName: (storeId: string | null) => string): DeliveryActivityRow[] {
  return rows.map((r) => {
    const d = r.details ?? {};
    const outcome = typeof d.outcome === "string" ? d.outcome : null;
    const result: DeliveryResult = r.action === "customer_passport_escalation_failed" || outcome === "failed" ? "failed" : outcome === "accepted" ? "accepted" : "attempted";
    const level = typeof d.level === "number" ? d.level : null;
    return {
      id: r.id,
      requestLabel: r.entity_id ? `Request ${r.entity_id.slice(0, 8)}` : "Request",
      rooftop: storeName(typeof d.store_id === "string" ? d.store_id : null),
      channel: typeof d.method === "string" ? (d.method === "email" ? "Email" : d.method) : "Email",
      attempt: level,
      result,
      at: r.created_at,
    };
  });
}

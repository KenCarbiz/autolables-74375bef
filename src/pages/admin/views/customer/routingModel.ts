import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { DraftErrors } from "@/lib/admin/useEditorDraft";
import {
  DEFAULT_ROUTING_PRIORITY,
  isWithinHours,
  normalizeContactRouting,
  resolveCustomerPassportRouting,
  type CustomerPassportContactSettings,
  type PassportAgent,
  type PassportRoutingResult,
  type RoutingPriorityItem,
  type WorkingHoursBlock,
} from "@/lib/passportRouting";
import { buildTierPlan, describeRoutingField, isEmail, namedAgents, ROUTING_FIELD_LABELS, routingOrderRows, type RoutingDraftSlice, type RoutingOrderRow } from "@/lib/admin/routingDraft";

export const ROUTING_KEYS = [
  "contactMode", "showAgentProfile", "agentDisplayRules", "routingPriority", "salesRotationSettings", "afterHoursBehavior",
  "escalationRules", "dealershipDefaultContact", "bdcSettings", "managerFallback", "businessHours", "timezone",
] as const satisfies readonly (keyof CustomerPassportContactSettings)[];

export type RoutingDraft = { [K in (typeof ROUTING_KEYS)[number]]: CustomerPassportContactSettings[K] } & { agents: PassportAgent[] };

export const readRouting = (s: DealerSettings): RoutingDraft => {
  const n = normalizeContactRouting(s.passport_contact_routing);
  const out = { agents: Array.isArray(s.passport_agents) ? [...s.passport_agents] : [] } as RoutingDraft;
  for (const k of ROUTING_KEYS) (out as Record<string, unknown>)[k] = n[k];
  return out;
};

export const assembleRouting = (d: RoutingDraft): CustomerPassportContactSettings => {
  const { agents: _agents, ...rest } = d;
  return normalizeContactRouting(rest);
};

export const sliceOf = (d: RoutingDraft): RoutingDraftSlice => ({ routing: assembleRouting(d), agents: d.agents });

export const routingToPatch = (changed: Partial<RoutingDraft>, settings: DealerSettings): Partial<DealerSettings> => {
  const { agents, ...routingChanged } = changed;
  const out: Partial<DealerSettings> = {};
  if (Object.keys(routingChanged).length > 0) out.passport_contact_routing = { ...((settings.passport_contact_routing ?? {}) as object), ...routingChanged } as CustomerPassportContactSettings;
  if (agents) out.passport_agents = namedAgents(agents);
  return out;
};

export const ROUTING_LABELS: Record<string, string> = ROUTING_FIELD_LABELS;

export const describeRouting = (key: string, value: unknown): string => describeRoutingField(key, value);

const blank = (v: string | undefined | null) => !v || v.trim().length === 0;

export const validateRouting = (d: RoutingDraft): DraftErrors<RoutingDraft> => {
  const e: DraftErrors<RoutingDraft> = {};
  if (!blank(d.dealershipDefaultContact.salesEmail) && !isEmail(d.dealershipDefaultContact.salesEmail)) e.dealershipDefaultContact = "The sales lead inbox is not a valid email address.";
  if (!blank(d.bdcSettings?.bdcEmail) && !isEmail(d.bdcSettings?.bdcEmail)) e.bdcSettings = "The BDC email is not a valid email address.";
  if (!blank(d.managerFallback?.managerEmail) && !isEmail(d.managerFallback?.managerEmail)) e.managerFallback = "The manager email is not a valid email address.";
  if (d.escalationRules.enabled && !(Number(d.escalationRules.firstResponseSlaMinutes) > 0)) e.escalationRules = "The first response target must be at least one minute.";
  const max = d.salesRotationSettings.maxOpenLeadsPerUser;
  if (max != null && !(Number.isInteger(max) && max >= 0)) e.salesRotationSettings = "Max open leads must be a whole number, or empty for no cap.";
  if (d.agents.some((a) => blank(a.name) && (!blank(a.email) || !blank(a.phone) || !blank(a.smsNumber)))) e.agents = "Every salesperson with contact details needs a name.";
  for (const b of d.businessHours) {
    if (!/^\d{1,2}:\d{2}$/.test(b.startTime) || !/^\d{1,2}:\d{2}$/.test(b.endTime) || b.startTime >= b.endTime) {
      e.businessHours = "Each open day needs a closing time after its opening time.";
      break;
    }
  }
  return e;
};

export type TierState = "unknown" | "ready" | "needs_setup" | "off" | "per_lead" | "not_in_order";

export interface TierRow extends Omit<RoutingOrderRow, "state"> {
  state: TierState;
  detailKey: "crm" | "assigned" | "rotation" | "bdc" | "manager" | "store";
  note?: string;
}

const DETAIL: Record<RoutingPriorityItem, TierRow["detailKey"]> = {
  crm_owner: "crm", vehicle_assigned_agent: "assigned", available_sales_rotation: "rotation", bdc: "bdc", sales_manager: "manager", dealership_default: "store",
};

/** All six tiers, in the saved order. A tier the saved order leaves out stays visible and says the resolver skips it. */
export function tierRows(slice: RoutingDraftSlice): TierRow[] {
  const rows = routingOrderRows(slice);
  const present = new Set(rows.map((r) => r.key));
  const missing = DEFAULT_ROUTING_PRIORITY.filter((k) => !present.has(k));
  const all = [...rows, ...routingOrderRows({ ...slice, routing: { ...slice.routing, routingPriority: missing } })];
  return all.map((r, i): TierRow => {
    const notInOrder = i >= rows.length;
    const perLead = r.key === "crm_owner" || r.key === "vehicle_assigned_agent";
    const state: TierState = notInOrder ? "not_in_order" : perLead ? "per_lead" : r.state === "ok" ? "ready" : r.state === "incomplete" ? "needs_setup" : "off";
    return { ...r, step: notInOrder ? 0 : r.step, state, detailKey: DETAIL[r.key], note: notInOrder ? "Not in the saved order, so the resolver skips it." : undefined };
  });
}

export const TIER_NAME: Record<PassportRoutingResult["routingTargetType"], string> = {
  crm_owner: "CRM owner",
  vehicle_assigned_agent: "Assigned salesperson",
  sales_rotation: "Sales rotation",
  bdc: "BDC",
  sales_manager: "Manager fallback",
  dealership_default: "Store contact",
};

export const REASON_TEXT: Record<string, string> = {
  crm_owner_match: "The CRM owner is on the roster and available.",
  vehicle_assigned_agent: "The salesperson assigned to the vehicle is available.",
  rotation_round_robin: "Round robin picked the person idle the longest.",
  rotation_least_recent: "Least recent picked the person idle the longest.",
  rotation_weighted: "Weighted currently picks the person idle the longest.",
  bdc_priority: "No earlier step could take it, and BDC is on.",
  manager_fallback: "No earlier step could take it, and the manager fallback is on.",
  dealership_default: "Every earlier step was unavailable, so the store contact takes it.",
  smart_routing_exhausted: "Every step was unavailable, so the store contact takes it.",
  dealer_default_mode: "Contact mode is set to the store contact, so the order is not used.",
  dealer_bdc_mode: "Contact mode is set to the BDC team.",
  bdc_mode_unconfigured: "Contact mode is BDC, but BDC is off, so the store contact takes it.",
  assigned_agent_fallback: "Assigned-agent mode found no one available, so the store contact takes it.",
};

export const reasonText = (reason: string): string => REASON_TEXT[reason] ?? (reason.startsWith("after_hours_") ? `Outside routing hours. After-hours mode: ${reason.slice(12).replace(/_/g, " ")}.` : reason.replace(/_/g, " "));

export interface SimInput {
  routing: CustomerPassportContactSettings;
  agents: PassportAgent[];
  assignedAgentId?: string | null;
  crmOwnerAgentId?: string | null;
  now: Date;
  rotationState?: Record<string, string>;
}

/** Runs the shared resolver the public Passport uses. Nothing is sent and nothing is stored. */
export function simulateRoute(input: SimInput): PassportRoutingResult {
  return resolveCustomerPassportRouting(input.routing, {
    agents: namedAgents(input.agents),
    assignedAgentId: input.assignedAgentId ?? null,
    crmOwnerAgentId: input.crmOwnerAgentId ?? null,
    rotationState: input.rotationState,
    now: input.now,
  });
}

export interface TierTrace {
  tier: RoutingPriorityItem;
  name: string;
  takes: boolean;
}

/** Whether each step could take this request on its own, using the same resolver with a one-step order. */
export function traceTiers(input: SimInput): TierTrace[] {
  return DEFAULT_ROUTING_PRIORITY.map((tier) => {
    const solo = { ...input.routing, contactMode: "smart_routing" as const, routingPriority: [tier] };
    const r = simulateRoute({ ...input, routing: solo });
    const takes = tier === "dealership_default" ? true : r.routingReason !== "smart_routing_exhausted";
    const name = TIER_NAME[tier === "vehicle_assigned_agent" ? "vehicle_assigned_agent" : tier === "available_sales_rotation" ? "sales_rotation" : tier];
    return { tier, name, takes };
  });
}

const HALF_HOURS = 7 * 48;

/** The first half hour inside (open) or outside (closed) the routing hours, found with the resolver's own hours test. */
export function findSampleTime(blocks: WorkingHoursBlock[], timezone: string | undefined, open: boolean, from: Date): Date | null {
  if (blocks.length === 0) return open ? from : null;
  const start = new Date(Math.floor(from.getTime() / 1_800_000) * 1_800_000);
  for (let i = 0; i < HALF_HOURS; i++) {
    const t = new Date(start.getTime() + i * 1_800_000);
    if (isWithinHours(blocks, t, timezone, true) === open) return t;
  }
  return null;
}

export const formatInstant = (d: Date, timezone?: string): string => {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone || undefined, timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
};

export const hoursSummary = (blocks: WorkingHoursBlock[]): string => {
  if (blocks.length === 0) return "Not set. Routing treats the store as open at all times.";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [...new Set(blocks.map((b) => b.dayOfWeek))].sort((a, b) => a - b);
  const same = blocks.every((b) => b.startTime === blocks[0].startTime && b.endTime === blocks[0].endTime);
  return `${days.map((d) => names[d]).join(", ")}${same ? ` ${blocks[0].startTime} to ${blocks[0].endTime}` : ", times vary by day"}`;
};

export const escalationPlanOf = (routing: CustomerPassportContactSettings) => buildTierPlan(routing);

export const US_TIME_ZONES: ReadonlyArray<[string, string]> = [
  ["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"],
];

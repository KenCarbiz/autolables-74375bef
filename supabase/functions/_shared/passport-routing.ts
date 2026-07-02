// ──────────────────────────────────────────────────────────────
// Customer Passport Contact Routing — shared pure logic.
//
// Single source of truth for the routing types, availability rules,
// and the resolver. Zero imports so the same file runs in Deno edge
// functions (public-listing-view, lead-alert, passport-lead-escalation)
// and in the Vite client (admin preview, CTA dock) via
// src/lib/passportRouting re-export.
//
// The shopper only ever sees the RESULT (a name, a phone, two button
// labels). Routing logic, priorities, and the agent roster never leave
// the server: public-listing-view attaches only the resolved
// PassportRoutingResult to the anonymous payload.
// ──────────────────────────────────────────────────────────────

export type ContactMode = "dealership_default" | "bdc" | "assigned_agent" | "smart_routing";

export type RoutingPriorityItem =
  | "crm_owner"
  | "vehicle_assigned_agent"
  | "available_sales_rotation"
  | "bdc"
  | "sales_manager"
  | "dealership_default";

export interface WorkingHoursBlock {
  dayOfWeek: number; // 0-6, Sunday = 0
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

export interface PassportAgent {
  id: string;
  name: string;
  title?: string;
  photoUrl?: string;
  phone?: string;
  smsNumber?: string;
  email?: string;
  status: "available" | "busy" | "away" | "offline";
  manualOverride?: "available" | "unavailable" | null;
  acceptsPassportLeads: boolean;
  workingHours: WorkingHoursBlock[];
  timezone?: string;
  maxOpenLeads?: number | null;
  openLeadCount?: number;
}

export interface AgentDisplayRules {
  nameDisplay: "first_name" | "full_name" | "team_only";
  showPhoto: boolean;
  showTitle: boolean;
  showAvailability: boolean;
  showWorkingHours: boolean;
}

export interface SalesRotationSettings {
  enabled: boolean;
  method: "round_robin" | "weighted" | "least_recent";
  onlyAvailableUsers: boolean;
  respectCrmOwnership: boolean;
  maxOpenLeadsPerUser?: number;
}

export interface AfterHoursBehavior {
  mode: "dealership_capture" | "bdc_capture" | "schedule_only" | "ai_assistant" | "hide_agent_show_store";
  message: string;
}

export interface EscalationRules {
  enabled: boolean;
  firstResponseSlaMinutes: number;
  escalateToBdcAfterMinutes?: number;
  escalateToManagerAfterMinutes?: number;
  notifyMethods: ("crm_task" | "email" | "sms" | "dashboard_alert")[];
}

export interface DealershipDefaultContact {
  salesPhone: string;
  salesEmail: string;
  crmLeadEndpoint?: string;
  contactFormRecipient?: string;
}

export interface BdcRoutingSettings {
  enabled: boolean;
  bdcTeamId?: string;
  bdcPhone?: string;
  bdcEmail?: string;
  showBdcAsTeam: boolean;
}

export interface ManagerFallbackSettings {
  enabled: boolean;
  managerUserId?: string;
  managerPhone?: string;
  managerEmail?: string;
}

export interface CustomerPassportContactSettings {
  contactMode: ContactMode;
  showAgentProfile: boolean;
  agentDisplayRules: AgentDisplayRules;
  routingPriority: RoutingPriorityItem[];
  salesRotationSettings: SalesRotationSettings;
  afterHoursBehavior: AfterHoursBehavior;
  escalationRules: EscalationRules;
  dealershipDefaultContact: DealershipDefaultContact;
  bdcSettings?: BdcRoutingSettings;
  managerFallback?: ManagerFallbackSettings;
  // Store business hours drive after-hours behavior. Empty = unknown, and an
  // unknown schedule is treated as OPEN so we never claim "closed" without a
  // real schedule behind it.
  businessHours: WorkingHoursBlock[];
  timezone?: string;
}

export interface PassportRoutingResult {
  routingTargetType:
    | "crm_owner"
    | "vehicle_assigned_agent"
    | "sales_rotation"
    | "bdc"
    | "sales_manager"
    | "dealership_default";
  routingTargetId?: string;
  displayMode: "agent" | "team" | "dealership";
  displayName: string;
  displaySubtitle: string;
  callLabel: string;
  contactLabel: string;
  phone?: string;
  email?: string;
  smsNumber?: string;
  agentPhotoUrl?: string;
  availabilityLabel?: string;
  routingReason: string;
  afterHours: boolean;
  afterHoursMessage?: string;
}

export const DEFAULT_AGENT_DISPLAY_RULES: AgentDisplayRules = {
  nameDisplay: "first_name",
  showPhoto: true,
  showTitle: true,
  showAvailability: true,
  showWorkingHours: false,
};

export const DEFAULT_ROUTING_PRIORITY: RoutingPriorityItem[] = [
  "crm_owner",
  "vehicle_assigned_agent",
  "available_sales_rotation",
  "bdc",
  "sales_manager",
  "dealership_default",
];

export const DEFAULT_CONTACT_ROUTING: CustomerPassportContactSettings = {
  contactMode: "smart_routing",
  showAgentProfile: false,
  agentDisplayRules: { ...DEFAULT_AGENT_DISPLAY_RULES },
  routingPriority: [...DEFAULT_ROUTING_PRIORITY],
  salesRotationSettings: {
    enabled: true,
    method: "round_robin",
    onlyAvailableUsers: true,
    respectCrmOwnership: true,
  },
  afterHoursBehavior: {
    mode: "dealership_capture",
    message: "We're closed right now, but send us a message and our team will follow up as soon as we open.",
  },
  escalationRules: {
    enabled: true,
    firstResponseSlaMinutes: 5,
    escalateToBdcAfterMinutes: 5,
    escalateToManagerAfterMinutes: 10,
    notifyMethods: ["crm_task", "dashboard_alert"],
  },
  dealershipDefaultContact: { salesPhone: "", salesEmail: "" },
  businessHours: [],
};

// Merge a partial stored blob over the defaults so old rows and new fields coexist.
export const normalizeContactRouting = (raw: unknown): CustomerPassportContactSettings => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CustomerPassportContactSettings>;
  return {
    ...DEFAULT_CONTACT_ROUTING,
    ...r,
    agentDisplayRules: { ...DEFAULT_AGENT_DISPLAY_RULES, ...(r.agentDisplayRules || {}) },
    routingPriority: Array.isArray(r.routingPriority) && r.routingPriority.length > 0 ? r.routingPriority : [...DEFAULT_ROUTING_PRIORITY],
    salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, ...(r.salesRotationSettings || {}) },
    afterHoursBehavior: { ...DEFAULT_CONTACT_ROUTING.afterHoursBehavior, ...(r.afterHoursBehavior || {}) },
    escalationRules: { ...DEFAULT_CONTACT_ROUTING.escalationRules, ...(r.escalationRules || {}) },
    dealershipDefaultContact: { ...DEFAULT_CONTACT_ROUTING.dealershipDefaultContact, ...(r.dealershipDefaultContact || {}) },
    businessHours: Array.isArray(r.businessHours) ? r.businessHours : [],
  };
};

// ── Time helpers ──────────────────────────────────────────────
// Wall-clock minutes in a target timezone without a date library.
const minutesInZone = (now: Date, timezone?: string): { day: number; minutes: number } | null => {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const dayName = parts.find((p) => p.type === "weekday")?.value || "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayName);
    if (day < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { day, minutes: (hour % 24) * 60 + minute };
  } catch {
    return null;
  }
};

const parseHm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
};

// True when `now` falls inside any block. An EMPTY schedule returns `fallback`
// (business hours: open; agent hours: available) — we never infer "closed"
// from missing data.
export const isWithinHours = (
  blocks: WorkingHoursBlock[],
  now: Date,
  timezone: string | undefined,
  fallback: boolean,
): boolean => {
  if (!Array.isArray(blocks) || blocks.length === 0) return fallback;
  const local = minutesInZone(now, timezone);
  if (!local) return fallback;
  return blocks.some((b) => {
    if (b.dayOfWeek !== local.day) return false;
    const start = parseHm(b.startTime);
    const end = parseHm(b.endTime);
    if (start == null || end == null) return false;
    return local.minutes >= start && local.minutes < end;
  });
};

export const isAgentAvailable = (
  agent: PassportAgent,
  now: Date,
  maxOpenLeadsGlobal?: number,
): boolean => {
  if (!agent.acceptsPassportLeads) return false;
  if (agent.manualOverride === "unavailable") return false;
  if (agent.manualOverride !== "available") {
    if (agent.status === "offline" || agent.status === "away") return false;
    if (!isWithinHours(agent.workingHours || [], now, agent.timezone, true)) return false;
  }
  const cap = agent.maxOpenLeads ?? maxOpenLeadsGlobal;
  if (cap != null && cap > 0 && (agent.openLeadCount ?? 0) >= cap) return false;
  return true;
};

// ── Resolver ──────────────────────────────────────────────────

export interface RoutingContext {
  agents: PassportAgent[];
  assignedAgentId?: string | null;
  crmOwnerAgentId?: string | null;
  // Rotation memory: agentId → ISO timestamp of the last passport lead routed
  // to them. Round-robin and least_recent both pick the longest-idle agent.
  rotationState?: Record<string, string>;
  now: Date;
  dealerName?: string;
}

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";

const agentDisplayName = (agent: PassportAgent, rules: AgentDisplayRules): string =>
  rules.nameDisplay === "full_name" ? agent.name : firstName(agent.name);

const dealershipResult = (
  settings: CustomerPassportContactSettings,
  afterHours: boolean,
  reason: string,
): PassportRoutingResult => ({
  routingTargetType: "dealership_default",
  displayMode: "dealership",
  displayName: "Our specialists are here to help.",
  displaySubtitle: "No pressure. Real people.",
  callLabel: "Call Sales",
  contactLabel: afterHours ? "Send Message" : "Contact",
  phone: settings.dealershipDefaultContact.salesPhone || undefined,
  email: settings.dealershipDefaultContact.salesEmail || undefined,
  routingReason: reason,
  afterHours,
  afterHoursMessage: afterHours ? settings.afterHoursBehavior.message : undefined,
});

const bdcResult = (
  settings: CustomerPassportContactSettings,
  afterHours: boolean,
  reason: string,
): PassportRoutingResult => ({
  routingTargetType: "bdc",
  routingTargetId: settings.bdcSettings?.bdcTeamId,
  displayMode: "team",
  displayName: "Our team is here to help.",
  displaySubtitle: "Fast response from our sales center.",
  callLabel: "Call Sales",
  contactLabel: afterHours ? "Send Message" : "Message Us",
  phone: settings.bdcSettings?.bdcPhone || settings.dealershipDefaultContact.salesPhone || undefined,
  email: settings.bdcSettings?.bdcEmail || settings.dealershipDefaultContact.salesEmail || undefined,
  routingReason: reason,
  afterHours,
  afterHoursMessage: afterHours ? settings.afterHoursBehavior.message : undefined,
});

const managerResult = (
  settings: CustomerPassportContactSettings,
  afterHours: boolean,
): PassportRoutingResult | null => {
  const m = settings.managerFallback;
  if (!m?.enabled || (!m.managerPhone && !m.managerEmail)) return null;
  return {
    routingTargetType: "sales_manager",
    routingTargetId: m.managerUserId,
    displayMode: "team",
    displayName: "Our sales manager is here to help.",
    displaySubtitle: "Direct line to a decision maker.",
    callLabel: "Call Sales",
    contactLabel: afterHours ? "Send Message" : "Contact",
    phone: m.managerPhone || settings.dealershipDefaultContact.salesPhone || undefined,
    email: m.managerEmail || settings.dealershipDefaultContact.salesEmail || undefined,
    routingReason: "manager_fallback",
    afterHours,
    afterHoursMessage: afterHours ? settings.afterHoursBehavior.message : undefined,
  };
};

const agentResult = (
  agent: PassportAgent,
  settings: CustomerPassportContactSettings,
  targetType: PassportRoutingResult["routingTargetType"],
  reason: string,
  afterHours: boolean,
): PassportRoutingResult => {
  const rules = settings.agentDisplayRules;
  const showProfile = settings.showAgentProfile && rules.nameDisplay !== "team_only";
  if (!showProfile) {
    // Route internally to the person, speak externally as the dealership.
    return {
      ...dealershipResult(settings, afterHours, reason),
      routingTargetType: targetType,
      routingTargetId: agent.id,
      phone: agent.phone || settings.dealershipDefaultContact.salesPhone || undefined,
      email: agent.email || settings.dealershipDefaultContact.salesEmail || undefined,
    };
  }
  const name = agentDisplayName(agent, rules);
  return {
    routingTargetType: targetType,
    routingTargetId: agent.id,
    displayMode: "agent",
    displayName: `${name} is here to help.`,
    displaySubtitle: [
      rules.showTitle && agent.title ? agent.title : null,
      rules.showAvailability && !afterHours ? "Available now" : null,
    ].filter(Boolean).join(" · ") || "Vehicle Specialist",
    callLabel: `Call ${name}`,
    contactLabel: agent.smsNumber ? `Text ${name}` : "Contact",
    phone: agent.phone || settings.dealershipDefaultContact.salesPhone || undefined,
    email: agent.email || settings.dealershipDefaultContact.salesEmail || undefined,
    smsNumber: agent.smsNumber || undefined,
    agentPhotoUrl: rules.showPhoto ? agent.photoUrl || undefined : undefined,
    availabilityLabel: rules.showAvailability && !afterHours ? "Available now" : undefined,
    routingReason: reason,
    afterHours,
    afterHoursMessage: afterHours ? settings.afterHoursBehavior.message : undefined,
  };
};

const pickRotationAgent = (ctx: RoutingContext, settings: CustomerPassportContactSettings): PassportAgent | null => {
  const rot = settings.salesRotationSettings;
  if (!rot.enabled) return null;
  const pool = ctx.agents.filter((a) =>
    rot.onlyAvailableUsers ? isAgentAvailable(a, ctx.now, rot.maxOpenLeadsPerUser) : a.acceptsPassportLeads && a.manualOverride !== "unavailable",
  );
  if (pool.length === 0) return null;
  // round_robin and least_recent both resolve to "longest since last lead";
  // weighted falls back to the same until per-agent weights exist.
  const state = ctx.rotationState || {};
  return [...pool].sort((a, b) => (state[a.id] || "").localeCompare(state[b.id] || ""))[0];
};

export const resolveCustomerPassportRouting = (
  settingsRaw: unknown,
  ctx: RoutingContext,
): PassportRoutingResult => {
  const settings = normalizeContactRouting(settingsRaw);
  const open = isWithinHours(settings.businessHours, ctx.now, settings.timezone, true);
  const afterHours = !open;

  const byId = new Map(ctx.agents.map((a) => [a.id, a]));

  const tryTier = (tier: RoutingPriorityItem): PassportRoutingResult | null => {
    switch (tier) {
      case "crm_owner": {
        const a = ctx.crmOwnerAgentId ? byId.get(ctx.crmOwnerAgentId) : null;
        if (a && isAgentAvailable(a, ctx.now, settings.salesRotationSettings.maxOpenLeadsPerUser)) {
          return agentResult(a, settings, "crm_owner", "crm_owner_match", afterHours);
        }
        return null;
      }
      case "vehicle_assigned_agent": {
        const a = ctx.assignedAgentId ? byId.get(ctx.assignedAgentId) : null;
        if (a && isAgentAvailable(a, ctx.now, settings.salesRotationSettings.maxOpenLeadsPerUser)) {
          return agentResult(a, settings, "vehicle_assigned_agent", "vehicle_assigned_agent", afterHours);
        }
        return null;
      }
      case "available_sales_rotation": {
        const a = pickRotationAgent(ctx, settings);
        return a ? agentResult(a, settings, "sales_rotation", `rotation_${settings.salesRotationSettings.method}`, afterHours) : null;
      }
      case "bdc":
        return settings.bdcSettings?.enabled ? bdcResult(settings, afterHours, "bdc_priority") : null;
      case "sales_manager":
        return managerResult(settings, afterHours);
      case "dealership_default":
        return dealershipResult(settings, afterHours, "dealership_default");
      default:
        return null;
    }
  };

  // After hours: live-person tiers are skipped; behavior decides the face of
  // the capture flow. No "Available now" is ever shown after hours.
  if (afterHours) {
    if (settings.afterHoursBehavior.mode === "bdc_capture" && settings.bdcSettings?.enabled) {
      return bdcResult(settings, true, "after_hours_bdc_capture");
    }
    return dealershipResult(settings, true, `after_hours_${settings.afterHoursBehavior.mode}`);
  }

  switch (settings.contactMode) {
    case "dealership_default":
      return dealershipResult(settings, false, "dealer_default_mode");
    case "bdc":
      return settings.bdcSettings?.enabled
        ? bdcResult(settings, false, "dealer_bdc_mode")
        : dealershipResult(settings, false, "bdc_mode_unconfigured");
    case "assigned_agent": {
      const direct = tryTier("vehicle_assigned_agent");
      if (direct) return direct;
      for (const tier of settings.routingPriority) {
        if (tier === "vehicle_assigned_agent") continue;
        const r = tryTier(tier);
        if (r) return r;
      }
      return dealershipResult(settings, false, "assigned_agent_fallback");
    }
    case "smart_routing":
    default: {
      for (const tier of settings.routingPriority) {
        const r = tryTier(tier);
        if (r) return r;
      }
      return dealershipResult(settings, false, "smart_routing_exhausted");
    }
  }
};

// Closed-pill copy for a resolved routing result. Kept here so the public
// page and the admin live preview render identical strings.
export const closedPillCopy = (r: PassportRoutingResult | null | undefined): { title: string; sub: string } => {
  if (r?.afterHours) return { title: "Ready to take the next step?", sub: "Reserve · Trade · Send a message" };
  if (r?.displayMode === "agent") {
    const name = r.displayName.replace(/ is here to help\.?$/, "");
    return { title: `${name} is ready to help`, sub: `Reserve · Trade · Ask ${name}` };
  }
  if (r?.displayMode === "team") return { title: "Ready to take the next step?", sub: "Reserve · Trade · Message us" };
  return { title: "Ready to take the next step?", sub: "Reserve · Trade · Talk to us" };
};

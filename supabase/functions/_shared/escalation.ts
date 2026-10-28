// ──────────────────────────────────────────────────────────────
// Passport lead escalation — shared pure logic.
//
// Zero imports so the same file runs in the passport-lead-escalation edge
// function and in the Vite client (Administration shows the tiers, the
// delivery states and the dry-run preview from the same rules). Everything
// that decides WHO is told WHEN, and what counts as a successful attempt,
// lives here; the edge function only fetches, sends and records.
//
// Delivery vocabulary, kept distinct on purpose:
//   attempted  the request to send was made
//   accepted   the sender accepted the request (an HTTP 2xx)
//   delivered  the recipient received it (never recorded by the current
//              sender, so it is never claimed)
//   failed     the sender refused or could not be reached
// Only an acceptance advances a lead's escalation level; a failure leaves the
// lead where it was so the next sweep tries again.
// ──────────────────────────────────────────────────────────────

export type NotifyMethod = "crm_task" | "email" | "sms" | "dashboard_alert";

/** Methods the current sender can actually deliver. */
export const IMPLEMENTED_METHODS: readonly NotifyMethod[] = ["email"];

/** The stored default before dealers could choose; it predates email being honoured. */
export const LEGACY_DEFAULT_METHODS: readonly NotifyMethod[] = ["crm_task", "dashboard_alert"];

export type EscalationTierKey = "bdc" | "manager";

export interface EscalationTier {
  level: 1 | 2;
  key: EscalationTierKey;
  label: string;
  afterMinutes: number;
  /** Resolved destination, or null when the tier has none. */
  to: string | null;
}

export interface EscalationSettingsLike {
  escalationRules?: {
    enabled?: boolean;
    firstResponseSlaMinutes?: number;
    escalateToBdcAfterMinutes?: number;
    escalateToManagerAfterMinutes?: number;
    notifyMethods?: string[];
  };
  bdcSettings?: { bdcEmail?: string } | null;
  managerFallback?: { managerEmail?: string } | null;
}

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Which methods a sweep will use. An explicit choice that includes an
 * implemented method is honoured; a missing list or the untouched legacy
 * default (which never listed email because email was always sent) keeps
 * sending email; an explicit empty list, or only unimplemented methods,
 * sends nothing and says so.
 */
export function effectiveMethods(rules: EscalationSettingsLike["escalationRules"] | null | undefined): NotifyMethod[] {
  const stored = rules?.notifyMethods;
  if (!Array.isArray(stored)) return ["email"];
  const chosen = stored as string[];
  const implemented = chosen.filter((m): m is NotifyMethod => (IMPLEMENTED_METHODS as readonly string[]).includes(m));
  if (implemented.length > 0) return implemented;
  const isLegacyDefault =
    chosen.length === LEGACY_DEFAULT_METHODS.length && LEGACY_DEFAULT_METHODS.every((m) => chosen.includes(m));
  return isLegacyDefault ? ["email"] : [];
}

/** True when email will be sent for these rules; the Admin switch reads and writes this. */
export const emailEnabled = (rules: EscalationSettingsLike["escalationRules"] | null | undefined): boolean =>
  effectiveMethods(rules).includes("email");

export interface TierPlan {
  enabled: boolean;
  firstResponseSlaMinutes: number;
  tiers: EscalationTier[];
  /** Tiers with a time but no destination; these never send. */
  blockers: string[];
  methods: NotifyMethod[];
}

/** The escalation plan a settings blob describes. Pure; safe to show in Admin. */
export function buildTierPlan(settings: EscalationSettingsLike | null | undefined): TierPlan {
  const rules = settings?.escalationRules ?? {};
  const enabled = rules.enabled === true;
  const sla = Number(rules.firstResponseSlaMinutes) > 0 ? Number(rules.firstResponseSlaMinutes) : 0;
  const bdcAfter = rules.escalateToBdcAfterMinutes != null ? Number(rules.escalateToBdcAfterMinutes) : sla;
  const mgrAfter = rules.escalateToManagerAfterMinutes != null ? Number(rules.escalateToManagerAfterMinutes) : 0;
  const bdcEmail = trimmed(settings?.bdcSettings?.bdcEmail);
  const mgrEmail = trimmed(settings?.managerFallback?.managerEmail);

  const candidates: EscalationTier[] = [
    { level: 1, key: "bdc", label: "BDC desk", afterMinutes: bdcAfter, to: isEmail(bdcEmail) ? bdcEmail : null },
    { level: 2, key: "manager", label: "Sales manager", afterMinutes: mgrAfter, to: isEmail(mgrEmail) ? mgrEmail : null },
  ];
  const tiers = candidates.filter((t) => Number.isFinite(t.afterMinutes) && t.afterMinutes > 0);
  const blockers = tiers.filter((t) => !t.to).map((t) => `${t.label} has no valid destination.`);
  return { enabled, firstResponseSlaMinutes: sla, tiers, blockers, methods: effectiveMethods(rules) };
}

export const readyTiers = (plan: TierPlan): EscalationTier[] => (plan.enabled ? plan.tiers.filter((t) => t.to !== null) : []);

/** The reference clock is when the request was received; the cutoff is that many minutes before now. */
export const cutoffIso = (afterMinutes: number, nowMs: number): string => new Date(nowMs - afterMinutes * 60_000).toISOString();

export const unansweredMinutes = (createdAtIso: string, nowMs: number): number =>
  Math.max(0, Math.round((nowMs - new Date(createdAtIso).getTime()) / 60_000));

export interface LeadLike {
  id: string;
  created_at: string;
  escalation_level: number | null;
  first_response_at?: string | null;
  status?: string | null;
}

/** Leads a tier is due for: older than the cutoff and not yet at this level. Unanswered only. */
export function dueLeads<T extends LeadLike>(leads: readonly T[], tier: EscalationTier, nowMs: number): T[] {
  const cutoff = cutoffIso(tier.afterMinutes, nowMs);
  return leads.filter(
    (l) =>
      (l.status ?? "new") === "new" &&
      !l.first_response_at &&
      l.created_at < cutoff &&
      (l.escalation_level ?? 0) < tier.level,
  );
}

export type SendOutcome = "accepted" | "failed" | "no_supported_method";

/** A sender's HTTP answer is acceptance, not delivery. Anything else is a failure that keeps the lead eligible. */
export function classifySendResponse(res: { ok: boolean; status: number } | null | undefined, transportError?: unknown): SendOutcome {
  if (transportError) return "failed";
  if (!res) return "failed";
  return res.ok ? "accepted" : "failed";
}

export const shouldAdvance = (outcome: SendOutcome): boolean => outcome === "accepted";

export const AUDIT_ACTION_ESCALATED = "customer_passport_escalated";
export const AUDIT_ACTION_ESCALATION_FAILED = "customer_passport_escalation_failed";

/** Audit detail: tier, timing and outcome. Never a recipient address, phone or name. */
export function auditDetails(args: {
  level: number;
  label: string;
  unansweredMinutes: number;
  outcome: SendOutcome;
  method: NotifyMethod | null;
  httpStatus?: number | null;
  storeId?: string | null;
}): Record<string, unknown> {
  return {
    level: args.level,
    to: args.label,
    unanswered_minutes: args.unansweredMinutes,
    outcome: args.outcome,
    method: args.method,
    ...(args.httpStatus != null ? { http_status: args.httpStatus } : {}),
    ...(args.storeId ? { store_id: args.storeId } : {}),
  };
}

const htmlEscape = (s: unknown) =>
  String(s ?? "").slice(0, 200).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export interface EscalationLeadDetails {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  vehicle_interest?: string | null;
  vehicle_vin?: string | null;
}

export function escalationSubject(lead: EscalationLeadDetails, minutes: number): string {
  return `Escalated lead (${minutes} min unanswered): ${String(lead.name ?? "").slice(0, 120)}`;
}

export function escalationHtml(lead: EscalationLeadDetails, tier: EscalationTier, minutes: number): string {
  const contact = [lead.phone ? `<a href="tel:${htmlEscape(lead.phone)}">${htmlEscape(lead.phone)}</a>` : "", htmlEscape(lead.email)].filter(Boolean).join(" &middot; ");
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
      <p style="font-size:13px;font-weight:700;color:#DC2626;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">Unanswered lead &mdash; ${minutes} min</p>
      <h2 style="font-size:20px;margin:0 0 2px">${htmlEscape(lead.name)}</h2>
      <p style="font-size:14px;margin:2px 0 10px">${contact}</p>
      <p style="font-size:15px;margin:0 0 2px">${htmlEscape(lead.vehicle_interest)}</p>
      <p style="font-size:13px;color:#475569;margin:0 0 16px">VIN ${htmlEscape(lead.vehicle_vin)}</p>
      <p style="font-size:13px;color:#475569;margin:0">This passport lead has not been responded to within the store's SLA and was escalated to you (${htmlEscape(tier.label)}).</p>
    </div>`;
}

/** Sweep bounds. A page is re-read from offset 0 after advancing leads, so processed ids stop the loop. */
export const PROFILE_PAGE_SIZE = 500;
export const LEAD_PAGE_SIZE = 50;
export const MAX_LEADS_PER_TENANT_PER_RUN = 500;

/** Which ids on a freshly read page have not been handled this run; an empty answer ends the loop. */
export function unseenIds(pageIds: readonly string[], seen: ReadonlySet<string>): string[] {
  return pageIds.filter((id) => !seen.has(id));
}

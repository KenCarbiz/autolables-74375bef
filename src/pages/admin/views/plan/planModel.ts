import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { EntitlementRow, EntitlementStatus } from "@/hooks/useEntitlements";
import { FEATURE_LABEL, FEATURE_TIER, PLAN_FEATURES, normalizeTier, planLabel, rankOf, type FeatureKey, type PlanTier } from "@/lib/entitlements/features";
import { limitFor, quotaState, type MetricKey, type QuotaState } from "@/lib/entitlements/usage";
import { PLAN_TIER_IDS, PLAN_TIER_LABELS } from "@/data/planTiers";
import { deriveRoutingReadiness } from "@/lib/admin/effectivePolicy";
import { adminTabHref } from "@/lib/admin/sections";
import type { AdminIconName } from "@/components/admin/v3/editor";

export interface EntitlementFacts {
  planTier: string | null;
  status: EntitlementStatus;
  trialEndsAt: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  hasSubscription: boolean;
  seatLimit: number | null;
}

export const factsFromRow = (row: EntitlementRow | null): EntitlementFacts | null =>
  row
    ? { planTier: row.plan_tier, status: row.status, trialEndsAt: row.trial_ends_at, expiresAt: row.expires_at, activatedAt: row.activated_at, hasSubscription: !!row.stripe_subscription_id, seatLimit: row.seat_limit }
    : null;

export type PlanStatus = "trial" | "active" | "past_due" | "paused" | "canceled" | "expired" | "none";

export interface PlanLine {
  label: string;
  value: string;
}

export interface PlanSummary {
  status: PlanStatus;
  tier: PlanTier;
  planName: string;
  billingName: string | null;
  statusLabel: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  accessActive: boolean;
  headline: string;
  lines: PlanLine[];
  source: string;
}

const day = (iso: string | null, timeZone: string | null): string => {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Not recorded";
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}) };
  try {
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
  }
};

const billingNameFor = (tier: string | null): string | null => {
  if (!tier) return null;
  return (PLAN_TIER_IDS as string[]).includes(tier) ? PLAN_TIER_LABELS[tier as keyof typeof PLAN_TIER_LABELS] : tier.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
};

/**
 * Plan, trial, renewal, grace and suspension are different facts. Only the entitlement row states them; an elapsed
 * trial date on an active row is history, not a current state, and is not shown as one.
 */
export function describePlan(facts: EntitlementFacts | null, now: number, timeZone: string | null): PlanSummary {
  if (!facts) {
    return { status: "none", tier: "none", planName: "No plan on record", billingName: null, statusLabel: "No active plan", tone: "neutral", accessActive: false, headline: "This account has no AutoLabels plan on record.", lines: [], source: "No entitlement row" };
  }
  const t = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
  const expired = Number.isFinite(t(facts.expiresAt)) && t(facts.expiresAt) < now;
  const base = { billingName: billingNameFor(facts.planTier), source: facts.hasSubscription ? "Autocurb subscription" : "Manual entitlement with no subscription on record" };
  const tierForLimits = normalizeTier(facts.planTier, true);
  const lines: PlanLine[] = [];
  if (facts.activatedAt) lines.push({ label: "Started", value: day(facts.activatedAt, timeZone) });

  if (facts.status === "paused") {
    return { ...base, status: "paused", tier: tierForLimits, planName: planLabel(tierForLimits), statusLabel: "Suspended", tone: "danger", accessActive: false, headline: "This plan is suspended, so its features are not available until billing restores it.", lines };
  }
  if (facts.status === "canceled") {
    if (facts.expiresAt) lines.push({ label: "Ended", value: day(facts.expiresAt, timeZone) });
    return { ...base, status: "canceled", tier: tierForLimits, planName: planLabel(tierForLimits), statusLabel: "Canceled", tone: "danger", accessActive: false, headline: "This plan was canceled.", lines };
  }
  if (facts.status === "past_due") {
    if (facts.expiresAt) lines.push({ label: expired ? "Period ended" : "Current period ends", value: day(facts.expiresAt, timeZone) });
    return { ...base, status: "past_due", tier: tierForLimits, planName: planLabel(tierForLimits), statusLabel: "Payment past due", tone: "warning", accessActive: false, headline: "The last payment did not go through. The plan is not active until billing resolves it.", lines };
  }
  if (expired) {
    lines.push({ label: "Access ended", value: day(facts.expiresAt, timeZone) });
    return { ...base, status: "expired", tier: tierForLimits, planName: planLabel(tierForLimits), statusLabel: "Expired", tone: "danger", accessActive: false, headline: "Access under this plan has ended.", lines };
  }
  if (facts.status === "trial") {
    const ended = Number.isFinite(t(facts.trialEndsAt)) && t(facts.trialEndsAt) < now;
    if (facts.trialEndsAt) lines.push({ label: ended ? "Trial end date passed" : "Trial ends", value: day(facts.trialEndsAt, timeZone) });
    return {
      ...base,
      status: "trial",
      tier: tierForLimits,
      planName: planLabel(tierForLimits),
      statusLabel: "Trial",
      tone: "info",
      accessActive: true,
      headline: ended ? "The trial end date has passed but billing has not changed this account's status." : "This account is on a trial.",
      lines,
    };
  }
  if (facts.expiresAt) lines.push({ label: facts.hasSubscription ? "Current period ends" : "Access ends", value: day(facts.expiresAt, timeZone) });
  if (facts.seatLimit) lines.push({ label: "Seat limit", value: String(facts.seatLimit) });
  return { ...base, status: "active", tier: tierForLimits, planName: planLabel(tierForLimits), statusLabel: "Active", tone: "success", accessActive: true, headline: "This plan is active.", lines };
}

export interface MetricSpec {
  key: MetricKey;
  label: string;
  icon: AdminIconName;
  /** Why no count exists, when nothing in the app records this activity. */
  unmetered: string | null;
}

export const METRIC_SPECS: readonly MetricSpec[] = [
  { key: "stickers_generated", label: "Stickers generated", icon: "file", unmetered: null },
  { key: "documents_published", label: "Documents published", icon: "globe", unmetered: null },
  { key: "template_customizations", label: "Template customizations", icon: "palette", unmetered: null },
  { key: "batch_jobs", label: "Batch jobs", icon: "layers", unmetered: "Not recorded by the app yet, so no count exists." },
  { key: "evidence_exports", label: "Evidence exports", icon: "download", unmetered: "Not recorded by the app yet, so no count exists." },
];

export interface MetricReading {
  value: number;
  events: number;
  lastEventAt: string | null;
}

export interface UsageSnapshot {
  monthLabel: string;
  timeZone: string;
  scope: string;
  updatedAt: string;
  metrics: Partial<Record<MetricKey, MetricReading>>;
}

export type UsageState = { kind: "loading" } | { kind: "failed"; reason: string } | { kind: "ready"; snapshot: UsageSnapshot };

export type LimitView = { kind: "unlimited" } | { kind: "limited"; soft: number; hard: number } | { kind: "undefined" };

export const limitView = (tier: PlanTier, key: MetricKey): LimitView => {
  const l = limitFor(tier, key);
  if (!l) return { kind: "undefined" };
  if (l.hard < 0) return { kind: "unlimited" };
  return { kind: "limited", soft: l.soft, hard: l.hard };
};

export interface MetricModel {
  spec: MetricSpec;
  value: number | null;
  reason: string | null;
  reading: MetricReading | null;
  limit: LimitView;
  percent: number | null;
  quota: QuotaState | null;
}

export function buildMetrics(usage: UsageState, tier: PlanTier): MetricModel[] {
  return METRIC_SPECS.map((spec) => {
    const limit = limitView(tier, spec.key);
    let value: number | null = null;
    let reason: string | null = null;
    let reading: MetricReading | null = null;
    if (spec.unmetered) reason = spec.unmetered;
    else if (usage.kind === "loading") reason = "Loading";
    else if (usage.kind === "failed") reason = usage.reason;
    else {
      reading = usage.snapshot.metrics[spec.key] ?? { value: 0, events: 0, lastEventAt: null };
      value = reading.value;
    }
    const percent = value !== null && limit.kind === "limited" ? Math.min(100, Math.round((value / limit.hard) * 100)) : null;
    const quota = value !== null && limit.kind === "limited" ? quotaState(tier, spec.key, value) : null;
    return { spec, value, reason, reading, limit, percent, quota };
  });
}

export type FeatureStatus = "included" | "setup_required" | "requires_upgrade" | "unavailable" | "platform_only";

export interface FeatureRow {
  key: FeatureKey;
  label: string;
  status: FeatureStatus;
  detail: string;
  link: { label: string; to: string } | null;
}

export interface FeatureGroup {
  id: string;
  label: string;
  rows: FeatureRow[];
}

const GROUPS: Array<{ id: string; label: string; keys: FeatureKey[] }> = [
  { id: "documents", label: "Documents & Printing", keys: ["window_stickers", "addendum_stickers", "print_settings", "vehicle_passport", "addendum_signing", "vehicle_file_documents"] },
  { id: "workflow", label: "Customization & Workflow", keys: ["template_customization", "qr_tracking", "batch_generation", "generated_document_approval", "stale_document_review_queue", "manager_approval_rules", "global_template_library", "team_permissions", "dealer_setup_wizard"] },
  { id: "compliance", label: "Compliance & Evidence", keys: ["compliance_evidence_timeline", "evidence_packet_export", "sticker_packet_match_review", "audit_log_viewer"] },
];

const SETUP_LINK: Partial<Record<FeatureKey, { label: string; to: string }>> = {
  window_stickers: { label: "Open templates", to: adminTabHref("templates") },
  addendum_stickers: { label: "Open templates", to: adminTabHref("templates") },
  print_settings: { label: "Open print settings", to: adminTabHref("print-calibration") },
  vehicle_passport: { label: "Open Passport modules", to: adminTabHref("passport-modules") },
  addendum_signing: { label: "Open service policy", to: adminTabHref("service-policy") },
  vehicle_file_documents: { label: "Open vehicle files", to: adminTabHref("vehicle-files") },
  template_customization: { label: "Open templates", to: adminTabHref("templates") },
  generated_document_approval: { label: "Open approval rules", to: adminTabHref("approval-rules") },
  stale_document_review_queue: { label: "Open review queue", to: "/dashboard/document-review" },
  manager_approval_rules: { label: "Open approval rules", to: adminTabHref("approval-rules") },
  sticker_packet_match_review: { label: "Open approval rules", to: adminTabHref("approval-rules") },
  compliance_evidence_timeline: { label: "Open activity", to: adminTabHref("activity") },
  audit_log_viewer: { label: "Open activity", to: adminTabHref("activity") },
};

type FeatureSettings = Pick<DealerSettings, "passport_contact_routing" | "passport_agents" | "feature_custom_branding">;

/** Prerequisites the settings can prove. A feature with none listed here is never marked as needing setup. */
function unmetSetup(key: FeatureKey, s: FeatureSettings | null): { detail: string; to: string; label: string } | null {
  if (!s) return null;
  if (key === "vehicle_passport" && !deriveRoutingReadiness(s.passport_contact_routing, s.passport_agents).ready) {
    return { detail: "Customer routing has no working fallback yet.", to: adminTabHref("routing"), label: "Finish routing" };
  }
  if (key === "template_customization" && s.feature_custom_branding === false) {
    return { detail: "Custom branding is turned off in Store settings.", to: adminTabHref("store-settings"), label: "Open Store settings" };
  }
  return null;
}

export interface FeatureContext {
  tier: PlanTier;
  accessActive: boolean;
  isPlatformAdmin: boolean;
  settings: FeatureSettings | null;
}

export function featureRow(key: FeatureKey, ctx: FeatureContext): FeatureRow {
  const label = FEATURE_LABEL[key] ?? key;
  const required = FEATURE_TIER[key];
  const link = SETUP_LINK[key] ?? null;
  if (required === "platform") {
    return ctx.isPlatformAdmin
      ? { key, label, status: "included", detail: "Available to platform administrators.", link }
      : { key, label, status: "platform_only", detail: "Platform staff only. It is not part of any dealer plan.", link: null };
  }
  if (!ctx.accessActive) return { key, label, status: "unavailable", detail: "Not available while the plan is not active.", link: null };
  if (rankOf(ctx.tier) < rankOf(required)) return { key, label, status: "requires_upgrade", detail: `Requires the ${planLabel(required)} plan.`, link: null };
  const setup = unmetSetup(key, ctx.settings);
  if (setup) return { key, label, status: "setup_required", detail: setup.detail, link: { label: setup.label, to: setup.to } };
  return { key, label, status: "included", detail: `Included in ${planLabel(required)} and above.`, link };
}

export const buildFeatureGroups = (ctx: FeatureContext): FeatureGroup[] =>
  GROUPS.map((g) => ({ id: g.id, label: g.label, rows: g.keys.map((k) => featureRow(k, ctx)) }));

export const FEATURE_STATUS_ORDER: readonly FeatureStatus[] = ["included", "setup_required", "requires_upgrade", "unavailable", "platform_only"];

export const featureCounts = (groups: FeatureGroup[]): Record<FeatureStatus, number> => {
  const out: Record<FeatureStatus, number> = { included: 0, setup_required: 0, requires_upgrade: 0, unavailable: 0, platform_only: 0 };
  for (const g of groups) for (const r of g.rows) out[r.status] += 1;
  return out;
};

export interface TierColumn {
  tier: PlanTier;
  label: string;
  features: string[];
  billingPlans: string[];
  limits: Array<{ metric: string; value: string }>;
}

const limitText = (tier: PlanTier, key: MetricKey): string => {
  const l = limitView(tier, key);
  return l.kind === "unlimited" ? "Unlimited" : l.kind === "limited" ? `${l.hard.toLocaleString()} per month` : "No limit set";
};

export function tierColumns(): TierColumn[] {
  const tiers: PlanTier[] = ["starter", "pro", "compliance"];
  return tiers.map((tier) => {
    const group = PLAN_FEATURES.find((g) => g.plan === tier);
    return {
      tier,
      label: planLabel(tier),
      features: (group?.features ?? []).map((f) => FEATURE_LABEL[f] ?? f),
      billingPlans: PLAN_TIER_IDS.filter((id) => normalizeTier(id, true) === tier).map((id) => PLAN_TIER_LABELS[id]),
      limits: [
        { metric: "Stickers generated", value: limitText(tier, "stickers_generated") },
        { metric: "Batch jobs", value: limitText(tier, "batch_jobs") },
        { metric: "Evidence exports", value: limitText(tier, "evidence_exports") },
      ],
    };
  });
}

/** Instant at 00:00 on the first day of the month containing `now`, in `timeZone`. */
export function zonedMonthStart(now: number, timeZone: string): { start: Date; end: Date; label: string } {
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  let tz = timeZone;
  try {
    fmt(tz);
  } catch {
    tz = "UTC";
  }
  const parts = (d: Date) => {
    const p = fmt(tz).formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
  };
  const offsetAt = (d: Date) => {
    const p = parts(d);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
  };
  const here = parts(new Date(now));
  const monthStartAt = (y: number, m: number) => {
    const naive = Date.UTC(y, m - 1, 1);
    let guess = naive - offsetAt(new Date(naive));
    guess = naive - offsetAt(new Date(guess));
    return new Date(guess);
  };
  const start = monthStartAt(here.y, here.m);
  const end = here.m === 12 ? monthStartAt(here.y + 1, 1) : monthStartAt(here.y, here.m + 1);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", year: "numeric" }).format(new Date(now));
  return { start, end, label };
}

export const viewerTimeZone = (dealerTz: string | null | undefined): string => {
  if (dealerTz && dealerTz.trim()) return dealerTz.trim();
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

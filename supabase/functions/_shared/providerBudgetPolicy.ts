// The provider call budget's decision, in one place the SQL gate and the
// callers both follow. provider_call_admit (migration 20261027205000) is the
// authority at run time; this module states the same rule so it can be tested
// here and so a caller can explain a refusal.
//
// An essential call (the syndication feed, its rooftop validation) is admitted
// while the month's count is under the cap. Any other call is admitted only
// while the count is under cap minus reserve, so the sweep can never spend the
// feed's last slots.

export type AdmissionReason =
  | "ungated" | "admitted" | "monthly_cap" | "reserve_for_essential" | "tenant_budget"
  | "unconfigured" | "disabled" | "lane_cap" | "lane_usd_cap" | "unpriced";

const KNOWN_REASONS: readonly AdmissionReason[] = [
  "ungated", "admitted", "monthly_cap", "reserve_for_essential", "tenant_budget",
  "unconfigured", "disabled", "lane_cap", "lane_usd_cap", "unpriced",
];

// Fail-closed lanes (proposed migration 20261106000000). The inventory feed
// and enrichment never share an allowance; a missing, disabled or exhausted
// lane refuses; a dollar limit refuses a call it cannot price.
export type Lane = "essential_sync" | "enrichment";
export const laneOf = (essential: boolean): Lane => (essential ? "essential_sync" : "enrichment");

export interface LaneBudget {
  enabled: boolean;
  monthlyCallCap: number | null;
  monthlyUsdCap: number | null;
}

export function decideLaneAdmission(
  lane: LaneBudget | null,
  used: { calls: number; usd: number },
  estimatedUsd: number | null,
): { admitted: boolean; reason: AdmissionReason } {
  if (!lane) return { admitted: false, reason: "unconfigured" };
  if (!lane.enabled) return { admitted: false, reason: "disabled" };
  if (lane.monthlyCallCap != null && used.calls >= lane.monthlyCallCap) return { admitted: false, reason: "lane_cap" };
  if (lane.monthlyUsdCap != null && estimatedUsd == null) return { admitted: false, reason: "unpriced" };
  if (lane.monthlyUsdCap != null && used.usd + (estimatedUsd ?? 0) > lane.monthlyUsdCap) return { admitted: false, reason: "lane_usd_cap" };
  return { admitted: true, reason: "admitted" };
}

export interface AdmissionInput {
  monthCalls: number;
  cap: number;
  reserve: number;
  essential: boolean;
  enabled: boolean;
}

export function decideAdmission(i: AdmissionInput): { admitted: boolean; reason: AdmissionReason } {
  if (!i.enabled) return { admitted: true, reason: "ungated" };
  if (i.monthCalls >= i.cap) return { admitted: false, reason: "monthly_cap" };
  if (!i.essential && i.monthCalls >= i.cap - i.reserve) return { admitted: false, reason: "reserve_for_essential" };
  return { admitted: true, reason: "admitted" };
}

// A dealership's own budget (provider_tenant_budgets, proposed migration
// 20261103000000), checked before the platform budget. The provider row and the
// all-providers row ('*') both apply. alert_only never refuses; enforce refuses
// a call that would go over, except an essential one unless block_essential is
// set. Dollar caps count the estimated price of this call.
export type TenantBudgetMode = "off" | "alert_only" | "enforce";

export interface TenantBudget {
  provider: string;
  mode: TenantBudgetMode;
  monthlyCallCap: number | null;
  monthlyUsdCap: number | null;
  alertThresholds: number[];
  blockEssential: boolean;
}

export interface TenantUsage {
  calls: number;
  usd: number;
}

export function tenantBudgetOver(b: TenantBudget, used: TenantUsage, estimatedUsd: number | null): boolean {
  return (b.monthlyCallCap != null && used.calls >= b.monthlyCallCap)
    || (b.monthlyUsdCap != null && used.usd + (estimatedUsd ?? 0) > b.monthlyUsdCap);
}

export function decideTenantAdmission(
  budgets: TenantBudget[],
  usage: (provider: string) => TenantUsage,
  essential: boolean,
  estimatedUsd: number | null,
): { admitted: boolean; refusedBy: string | null } {
  for (const b of [...budgets].sort((x, y) => x.provider.localeCompare(y.provider))) {
    if (b.mode !== "enforce") continue;
    if (essential && !b.blockEssential) continue;
    if (tenantBudgetOver(b, usage(b.provider), estimatedUsd)) return { admitted: false, refusedBy: b.provider };
  }
  return { admitted: true, refusedBy: null };
}

// Percent of the budget used, the larger of the call and dollar measures. A
// zero cap counts as fully used.
export function tenantBudgetPercent(b: TenantBudget, used: TenantUsage): number {
  const pct = (v: number, cap: number | null) => (cap == null ? 0 : cap === 0 ? 100 : (100 * v) / cap);
  return Math.max(pct(used.calls, b.monthlyCallCap), pct(used.usd, b.monthlyUsdCap));
}

// The thresholds reached after an admitted call; the database queues each once
// a month.
export function thresholdsReached(b: TenantBudget, used: TenantUsage): number[] {
  if (b.mode === "off") return [];
  const p = tenantBudgetPercent(b, used);
  return b.alertThresholds.filter((t) => p >= t).sort((x, y) => x - y);
}

export const PROVIDER_CALL_OUTCOMES = [
  "admitted", "ok", "no_result", "refused_quota", "refused_rate", "refused_auth",
  "provider_error", "transport_error", "budget_denied",
] as const;
export type ProviderCallOutcome = typeof PROVIDER_CALL_OUTCOMES[number];

// What the provider's answer was, for the ledger. A 429 whose body names the
// monthly quota is a quota refusal, not a rate limit: the two call for
// different actions (wait for the 1st vs slow down), and MarketCheck's gateway
// says "Monthly API quota exhausted" in the body of the quota one.
export function outcomeForAnswer(status: number | null | undefined, bodyText?: string | null): ProviderCallOutcome {
  if (status == null || status === 0) return "transport_error";
  if (status === 429) return /quota/i.test(bodyText || "") ? "refused_quota" : "refused_rate";
  if (status === 401 || status === 403) return "refused_auth";
  if (status === 404) return "no_result";
  if (status >= 500) return "provider_error";
  if (status >= 200 && status < 300) return "ok";
  return "provider_error";
}

export interface AdmitResult {
  admitted: boolean;
  eventId: number | null;
  monthCalls: number | null;
  cap: number | null;
  reserve: number | null;
  reason: AdmissionReason | "gate_unavailable";
}

// The RPC answers one row; a missing or malformed answer is an unavailable
// gate, which the caller treats as a refusal (fail closed).
export function parseAdmitRow(row: unknown): AdmitResult | null {
  const r = (Array.isArray(row) ? row[0] : row) as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object" || typeof r.admitted !== "boolean") return null;
  const n = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const reason = String(r.reason || "");
  return {
    admitted: r.admitted,
    eventId: n(r.event_id),
    monthCalls: n(r.month_calls),
    cap: n(r.monthly_call_cap),
    reserve: n(r.reserve_for_essential),
    reason: KNOWN_REASONS.includes(reason as AdmissionReason) ? (reason as AdmissionReason) : "gate_unavailable",
  };
}

// The provider call budget's decision, in one place the SQL gate and the
// callers both follow. provider_call_admit (migration 20261027205000) is the
// authority at run time; this module states the same rule so it can be tested
// here and so a caller can explain a refusal.
//
// An essential call (the syndication feed, its rooftop validation) is admitted
// while the month's count is under the cap. Any other call is admitted only
// while the count is under cap minus reserve, so the sweep can never spend the
// feed's last slots.

export type AdmissionReason = "ungated" | "admitted" | "monthly_cap" | "reserve_for_essential";

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

// The RPC answers one row; a missing or malformed answer is treated as an
// unavailable gate, which callers fail open on and log.
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
    reason: (["ungated", "admitted", "monthly_cap", "reserve_for_essential"] as const).includes(reason as AdmissionReason)
      ? (reason as AdmissionReason)
      : "gate_unavailable",
  };
}

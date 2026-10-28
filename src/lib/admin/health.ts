// The typed health vocabulary for Administration. Every monitored system
// (feed, provider, job, pipeline) reports one of these states, derived from
// evidence that already exists: run ledgers, call telemetry, configuration,
// entitlement and last-known-good data. Nothing here calls a provider.
//
// The two rules the contract exists to enforce:
//   1. No false green. A system is healthy only when the facts needed for that
//      claim are known. A cron row, a configuration row or a cached value is
//      never, by itself, evidence of health.
//   2. Severity wins. When several facts disagree, the most severe known state
//      stands; a green fact never overrides a known problem.

export type HealthState =
  | "disabled"
  | "not_applicable"
  | "not_configured"
  | "entitlement_blocked"
  | "down"
  | "degraded"
  | "stale"
  | "warning"
  | "unknown"
  | "healthy";

/** Most severe first. `worstOf` picks the earliest entry present. */
export const HEALTH_PRECEDENCE: readonly HealthState[] = [
  "disabled",
  "not_applicable",
  "not_configured",
  "entitlement_blocked",
  "down",
  "degraded",
  "stale",
  "warning",
  "unknown",
  "healthy",
];

export type HealthTone = "neutral" | "success" | "warning" | "danger" | "info";

export const HEALTH_META: Readonly<Record<HealthState, { label: string; tone: HealthTone }>> = {
  disabled: { label: "Disabled", tone: "neutral" },
  not_applicable: { label: "Not applicable", tone: "neutral" },
  not_configured: { label: "Not configured", tone: "neutral" },
  entitlement_blocked: { label: "Entitlement blocked", tone: "warning" },
  down: { label: "Down", tone: "danger" },
  degraded: { label: "Degraded", tone: "warning" },
  stale: { label: "Stale", tone: "warning" },
  warning: { label: "Review required", tone: "warning" },
  unknown: { label: "Unknown", tone: "neutral" },
  healthy: { label: "Healthy", tone: "success" },
};

export function worstOf(states: readonly HealthState[]): HealthState {
  if (states.length === 0) return "unknown";
  let worst: HealthState = "healthy";
  let worstIndex = HEALTH_PRECEDENCE.length;
  for (const s of states) {
    const i = HEALTH_PRECEDENCE.indexOf(s);
    if (i >= 0 && i < worstIndex) {
      worstIndex = i;
      worst = s;
    }
  }
  return worst;
}

/** True when the state is one a dealer must act on or cannot rely on. */
export const needsAttention = (s: HealthState): boolean =>
  s !== "healthy" && s !== "not_applicable" && s !== "disabled";

export interface HealthVerdict {
  state: HealthState;
  /** One line, dealer language. */
  headline: string;
  /** Why, in one or two sentences. */
  detail: string;
  /** The customer or business output this system feeds. */
  affectedOutput: string;
  /** Whether last-known-good data was retained through the problem. */
  inventoryPreserved: boolean | "unknown";
}

const HOUR = 3_600_000;

export const ageHours = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / HOUR;
};

/**
 * Freshness against an expected cadence. Twice the cadence (never under 30
 * hours) is stale: one missed run is tolerated, two are not. No timestamp is
 * unknown, not fresh.
 */
export function freshnessState(lastGoodAt: string | null | undefined, cadenceHours: number | null, now: number): HealthState {
  const age = ageHours(lastGoodAt, now);
  if (age === null) return "unknown";
  const window = Math.max(30, (cadenceHours ?? 24) * 2);
  return age > window ? "stale" : "healthy";
}

// ── Inventory feed runs ──────────────────────────────────────────────────

export type RunOutcome =
  | "success"
  | "partial"
  | "valid_empty"
  | "provider_rate_limited"
  | "provider_auth_failed"
  | "provider_error"
  | "identity_hold"
  | "transport_error"
  | "skipped"
  | "failed_unknown";

export interface RunLike {
  status: string | null;
  http_status: number | null;
  error_summary: string | null;
  seen?: number | null;
  num_found?: number | null;
}

/**
 * Classify a run row. The HTTP status is read before any text, so a 429 that
 * the older sync labelled a rooftop mismatch is still a rate limit: a refusal
 * is never evidence about identity.
 */
export function classifyRunOutcome(run: RunLike): RunOutcome {
  const status = (run.status ?? "").toLowerCase();
  if (status === "skipped") return "skipped";
  if (status === "success") return "success";
  if (status === "partial") return "partial";
  if (status === "empty_valid") return "valid_empty";
  const http = run.http_status ?? null;
  const text = (run.error_summary ?? "").toLowerCase();
  if (http === 429 || /refused_429|rate.?limit|quota/.test(text)) return "provider_rate_limited";
  if (http === 401 || http === 403 || /refused_40[13]|unauthori|forbidden|api key/.test(text)) return "provider_auth_failed";
  if (http !== null && http >= 500) return "provider_error";
  if (http !== null && http >= 200 && http < 300 && /pinned_scope|rooftop|mismatch|identity|wrong store/.test(text)) return "identity_hold";
  if (http === null && /timeout|timed out|network|fetch failed|econn|transport|dns/.test(text)) return "transport_error";
  if (http !== null && http >= 400) return "provider_error";
  return "failed_unknown";
}

export interface RunOutcomeMeta {
  label: string;
  tone: HealthTone;
  state: HealthState;
  /** Inventory is retained on every refusal; a successful run may retire listings by design. */
  inventoryPreserved: boolean | "unknown";
  retryable: boolean;
  /** Dealer-language guidance derived from the outcome type, never from the raw message. */
  nextSafeAction: string;
}

export const RUN_OUTCOME_META: Readonly<Record<RunOutcome, RunOutcomeMeta>> = {
  success: { label: "Successful", tone: "success", state: "healthy", inventoryPreserved: true, retryable: false, nextSafeAction: "No action needed." },
  partial: { label: "Partial", tone: "warning", state: "warning", inventoryPreserved: true, retryable: true, nextSafeAction: "Review the per-vehicle errors; the rest of the feed was applied." },
  valid_empty: { label: "Valid empty", tone: "info", state: "warning", inventoryPreserved: true, retryable: false, nextSafeAction: "The source answered with no vehicles. Confirm the source scope before trusting the empty result; nothing was retired automatically." },
  provider_rate_limited: { label: "Provider limited", tone: "warning", state: "degraded", inventoryPreserved: true, retryable: true, nextSafeAction: "Review the provider quota and retry policy, then let the next scheduled run try again. Do not clear the source identity." },
  provider_auth_failed: { label: "Authentication failed", tone: "danger", state: "down", inventoryPreserved: true, retryable: false, nextSafeAction: "The provider rejected the credential. Review the integration credential with support; the source identity and inventory are unchanged." },
  provider_error: { label: "Provider error", tone: "warning", state: "degraded", inventoryPreserved: true, retryable: true, nextSafeAction: "The provider failed to answer. Retry on the next schedule; inventory and identity are unchanged." },
  identity_hold: { label: "Identity hold", tone: "warning", state: "warning", inventoryPreserved: true, retryable: false, nextSafeAction: "The source answered with vehicles that did not match this rooftop. Review the source identity before any change; nothing was imported or retired." },
  transport_error: { label: "Connection failed", tone: "warning", state: "degraded", inventoryPreserved: true, retryable: true, nextSafeAction: "The request did not reach the provider. Retry on the next schedule." },
  skipped: { label: "Expected skip", tone: "neutral", state: "unknown", inventoryPreserved: true, retryable: false, nextSafeAction: "Cadence skip; the last real attempt decides health." },
  failed_unknown: { label: "Failed", tone: "danger", state: "degraded", inventoryPreserved: "unknown", retryable: true, nextSafeAction: "The run failed for a reason the ledger did not classify. Open the run and review the recorded evidence." },
};

export interface FeedHealthInput {
  configured: boolean | null;
  enabled: boolean | null;
  /** Newest run of any status, including skips. */
  latestRun: RunLike | null;
  /** Newest run that was not a skip. */
  latestRealRun: RunLike | null;
  /** From the whole ledger, independent of any page window. */
  lastSuccessAt: string | null;
  cadenceHours: number | null;
  now: number;
  /** A read failed, so nothing here can be trusted. */
  loadFailed?: boolean;
}

export function deriveFeedHealth(i: FeedHealthInput): HealthVerdict {
  const affectedOutput = "Inventory freshness and availability";
  if (i.loadFailed) {
    return { state: "unknown", headline: "Feed health could not be read", detail: "The run ledger did not load. Nothing on this card is current.", affectedOutput, inventoryPreserved: "unknown" };
  }
  if (i.configured === false) {
    return { state: "not_configured", headline: "Inventory feed not configured", detail: "No source has been set for this rooftop.", affectedOutput, inventoryPreserved: true };
  }
  if (i.enabled === false) {
    return { state: "disabled", headline: "Inventory feed disabled", detail: "The scheduled pull is turned off for this rooftop.", affectedOutput, inventoryPreserved: true };
  }
  const real = i.latestRealRun ?? i.latestRun;
  if (!real) {
    return { state: "unknown", headline: "No feed attempts recorded", detail: "The ledger has no run for this rooftop yet.", affectedOutput, inventoryPreserved: "unknown" };
  }
  const outcome = classifyRunOutcome(real);
  const meta = RUN_OUTCOME_META[outcome];
  const fresh = freshnessState(i.lastSuccessAt, i.cadenceHours, i.now);
  const state = worstOf([meta.state === "unknown" ? "unknown" : meta.state, fresh]);
  const lastSuccess = i.lastSuccessAt ? `Last successful pull ${describeAge(i.lastSuccessAt, i.now)}.` : "No successful pull is recorded.";
  let headline: string;
  let detail: string;
  switch (outcome) {
    case "provider_rate_limited":
      headline = "Provider rate limited" + (real.http_status ? ` (HTTP ${real.http_status})` : "");
      detail = `Inventory preserved. Existing rooftop identity retained. ${lastSuccess}`;
      break;
    case "provider_auth_failed":
      headline = "Source authentication failed";
      detail = `The provider rejected the credential. Inventory preserved. ${lastSuccess}`;
      break;
    case "identity_hold":
      headline = "Source identity needs review";
      detail = `The last answer did not match this rooftop, so nothing was imported or retired. ${lastSuccess}`;
      break;
    case "valid_empty":
      headline = "Source returned no vehicles";
      detail = `The feed answered but listed nothing. Nothing was retired. ${lastSuccess}`;
      break;
    case "success":
      headline = fresh === "stale" ? "Inventory feed stale" : "Inventory feed healthy";
      detail = fresh === "stale" ? `${lastSuccess} That is older than the expected cadence allows.` : lastSuccess;
      break;
    case "partial":
      headline = "Last pull completed with errors";
      detail = `Some vehicles were rejected. ${lastSuccess}`;
      break;
    case "skipped":
      headline = fresh === "stale" ? "Inventory feed stale" : "Awaiting the next scheduled pull";
      detail = lastSuccess;
      break;
    default:
      headline = meta.label;
      detail = `${meta.nextSafeAction} ${lastSuccess}`;
  }
  return { state, headline, detail, affectedOutput, inventoryPreserved: meta.inventoryPreserved };
}

// ── Scheduled jobs ───────────────────────────────────────────────────────

export interface JobHealthInput {
  /** A cron row exists. Scheduling intent, not execution. */
  scheduled: boolean | null;
  active: boolean | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** The scheduler's own last status, e.g. succeeded, failed, running. */
  lastOutcome: string | null;
  cadenceHours: number | null;
  affectedOutput: string;
  now: number;
  loadFailed?: boolean;
}

export function deriveJobHealth(i: JobHealthInput): HealthVerdict {
  const base = { affectedOutput: i.affectedOutput, inventoryPreserved: true as const };
  if (i.loadFailed) return { ...base, state: "unknown", headline: "Job status could not be read", detail: "The scheduler status did not load." };
  if (i.scheduled === false) return { ...base, state: "not_configured", headline: "Not scheduled", detail: "No schedule exists for this job." };
  if (i.active === false) return { ...base, state: "disabled", headline: "Schedule paused", detail: "The job is scheduled but paused." };
  const outcome = (i.lastOutcome ?? "").toLowerCase();
  if (!i.lastSuccessAt) {
    if (outcome === "failed") return { ...base, state: "down", headline: "Last run failed, no success recorded", detail: "The job has never completed successfully." };
    if (outcome === "running" || outcome === "starting" || outcome === "sending") return { ...base, state: "warning", headline: "Run in progress", detail: "No completed run is recorded yet." };
    return { ...base, state: "unknown", headline: "Scheduled, no successful run recorded", detail: "A schedule exists, which proves intent, not execution." };
  }
  const fresh = freshnessState(i.lastSuccessAt, i.cadenceHours, i.now);
  if (outcome === "failed") {
    return { ...base, state: worstOf(["degraded", fresh]), headline: "Last run failed", detail: `Last success ${describeAge(i.lastSuccessAt, i.now)}.` };
  }
  if (fresh === "stale") return { ...base, state: "stale", headline: "No recent successful run", detail: `Last success ${describeAge(i.lastSuccessAt, i.now)}, older than the cadence allows.` };
  return { ...base, state: "healthy", headline: "Running on schedule", detail: `Last success ${describeAge(i.lastSuccessAt, i.now)}.` };
}

// ── Providers ────────────────────────────────────────────────────────────

export type EntitlementState = "entitled" | "refused" | "blocked" | "unknown" | "not_applicable";

export interface ProviderHealthInput {
  configured: boolean | null;
  entitlement: EntitlementState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Outcome of the newest call: ok, refused_quota, budget_denied, http_error, transport_error, ... */
  lastOutcome: string | null;
  ttlHours: number | null;
  affectedOutput: string;
  now: number;
  loadFailed?: boolean;
}

export function deriveProviderHealth(i: ProviderHealthInput): HealthVerdict {
  const base = { affectedOutput: i.affectedOutput, inventoryPreserved: true as const };
  if (i.loadFailed) return { ...base, state: "unknown", headline: "Provider status could not be read", detail: "Call telemetry did not load." };
  if (i.entitlement === "not_applicable") return { ...base, state: "not_applicable", headline: "Not used on this plan", detail: "This capability is not part of the current configuration." };
  if (i.configured === false) return { ...base, state: "not_configured", headline: "Not configured", detail: "No credential or configuration exists for this provider." };
  if (i.entitlement === "blocked" || i.entitlement === "refused") {
    return { ...base, state: "entitlement_blocked", headline: "Entitlement blocked", detail: "The provider refuses this product on the current contract. Cached answers stay in use." };
  }
  if (!i.lastAttemptAt) return { ...base, state: "unknown", headline: "No calls recorded", detail: "Configuration exists, but no attempt has been made yet." };
  const outcome = (i.lastOutcome ?? "").toLowerCase();
  const fresh = freshnessState(i.lastSuccessAt, i.ttlHours, i.now);
  if (outcome === "refused_quota" || outcome === "budget_denied") {
    return { ...base, state: worstOf(["degraded", fresh === "unknown" ? "unknown" : "healthy"]), headline: outcome === "refused_quota" ? "Monthly quota reached" : "Held by the call budget", detail: `Cached answers stay in use. ${i.lastSuccessAt ? `Last successful call ${describeAge(i.lastSuccessAt, i.now)}.` : "No successful call is recorded."}` };
  }
  if (outcome && outcome !== "ok") {
    return { ...base, state: worstOf(["degraded", fresh]), headline: "Last call failed", detail: `${i.lastSuccessAt ? `Last successful call ${describeAge(i.lastSuccessAt, i.now)}.` : "No successful call is recorded."}` };
  }
  if (fresh === "stale") return { ...base, state: "stale", headline: "Answers older than their freshness window", detail: `Last successful call ${describeAge(i.lastSuccessAt, i.now)}.` };
  if (fresh === "unknown") return { ...base, state: "unknown", headline: "No successful call recorded", detail: "Attempts exist, but none answered." };
  return { ...base, state: "healthy", headline: "Answering", detail: `Last successful call ${describeAge(i.lastSuccessAt, i.now)}.` };
}

// ── Counts that must never read as zero when they are not known ──────────

export interface KnownCount {
  value: number;
  kind: "known";
  /** The query was capped; the value is a lower bound. */
  capped?: boolean;
}
export type CountValue = KnownCount | { kind: "failed" } | { kind: "loading" };

export const knownCount = (value: number, capped = false): CountValue => ({ kind: "known", value, capped });

export function countDisplay(c: CountValue | null | undefined): string {
  if (!c) return "Unknown";
  if (c.kind === "loading") return "…";
  if (c.kind === "failed") return "Unavailable";
  return c.capped ? `${c.value.toLocaleString()}+` : c.value.toLocaleString();
}

// ── Formatting ───────────────────────────────────────────────────────────

export function describeAge(iso: string | null | undefined, now: number): string {
  const age = ageHours(iso, now);
  if (age === null) return "never";
  const mins = Math.round(age * 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(age);
  if (hrs < 48) return `${hrs} h ago`;
  const days = Math.round(age / 24);
  return `${days} days ago`;
}

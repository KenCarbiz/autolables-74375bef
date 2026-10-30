import { ageHours, deriveFeedHealth, describeAge, type CountValue, type HealthTone, type HealthVerdict, type RunOutcome } from "@/lib/admin/health";
import { canonicalRunLike, outcomeForRun, sourceHost, type SyncRunRow } from "@/lib/admin/integrations/runs";

// The inventory feed tab, derived from the sync configuration, the run
// ledger and inventory counts. A refusal never touches the source identity;
// the identity is reviewable only when the provider actually answered.

export interface FeedConfigRow {
  enabled: boolean | null;
  allowed?: boolean | null;
  source: string | null;
  frequency: string | null;
  run_hour: number | null;
  day_of_week: number | null;
  max_vehicles?: number | null;
  last_run_at: string | null;
  mc_scope_param: string | null;
  mc_scope_value: string | null;
  rooftop_name: string | null;
  rooftop_street: string | null;
  rooftop_zip: string | null;
  rooftop_verified_at: string | null;
  strict_rooftop?: boolean | null;
  last_good_count: number | null;
  last_good_at: string | null;
  updated_at?: string | null;
}

export const cadenceHoursFor = (frequency: string | null | undefined): number => {
  switch ((frequency ?? "").toLowerCase()) {
    case "weekly":
      return 24 * 7;
    case "biweekly":
      return 24 * 14;
    case "monthly":
      return 24 * 30;
    default:
      return 24;
  }
};

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function scheduleLabel(cfg: FeedConfigRow | null): string {
  if (!cfg) return "Not configured";
  const hour = typeof cfg.run_hour === "number" ? `${String(cfg.run_hour).padStart(2, "0")}:00 UTC` : null;
  switch ((cfg.frequency ?? "nightly").toLowerCase()) {
    case "weekly":
      return `Weekly, ${DAY[cfg.day_of_week ?? 0] ?? "Sunday"}${hour ? ` ${hour}` : ""}`;
    case "biweekly":
      return `Every two weeks, ${DAY[cfg.day_of_week ?? 0] ?? "Sunday"}${hour ? ` ${hour}` : ""}`;
    case "monthly":
      return `Monthly${hour ? `, ${hour}` : ""}`;
    default:
      return `Every 24 hours${hour ? `, ${hour}` : ""}`;
  }
}

export type SourceIdentityState = "verified" | "previously_validated" | "needs_review" | "pinned_unverified" | "not_pinned" | "not_configured" | "unknown";

export const SOURCE_IDENTITY_LABEL: Record<SourceIdentityState, string> = {
  verified: "Verified",
  previously_validated: "Previously validated",
  needs_review: "Needs review",
  pinned_unverified: "Pinned, not verified",
  not_pinned: "Not pinned",
  not_configured: "Not configured",
  unknown: "Unknown",
};

const PROVIDER_ERROR_OUTCOMES: ReadonlySet<RunOutcome> = new Set(["provider_rate_limited", "provider_auth_failed", "provider_error", "transport_error"]);

export const isProviderErrorOutcome = (o: RunOutcome | null): boolean => !!o && PROVIDER_ERROR_OUTCOMES.has(o);

export interface FeedSnapshotInput {
  config: FeedConfigRow | null;
  configLoadFailed?: boolean;
  latestRun: SyncRunRow | null;
  latestRealRun: SyncRunRow | null;
  /** From the whole ledger, never from a page window. */
  lastSuccessAt: string | null;
  runsLoadFailed?: boolean;
  activeVehicles: CountValue;
  coverage: { new: CountValue; used: CountValue; cpo: CountValue };
  /** The viewer is an owner or admin of this tenant. */
  actorCanClearScope: boolean;
  now: number;
}

export interface FeedTile {
  value: string;
  hint: string;
  tone: HealthTone;
}

export interface FeedSnapshot {
  health: HealthVerdict;
  outcome: RunOutcome | null;
  latestRealRunId: string | null;
  tiles: {
    lastAttempt: FeedTile;
    lastSuccess: FeedTile;
    activeVehicles: FeedTile;
    sourceIdentity: FeedTile & { state: SourceIdentityState };
  };
  source: {
    host: string | null;
    pinLabel: string;
    pinValue: string | null;
    identity: SourceIdentityState;
    verifiedAt: string | null;
    lastGoodAt: string | null;
    lastGoodCount: number | null;
    rooftop: { name: string | null; street: string | null; zip: string | null };
    retainedLabel: string;
    note: string;
    review: { enabled: boolean; reason: string; allowClearScope: boolean };
  };
  refresh: {
    scope: string;
    schedule: string;
    status: "on_schedule" | "overdue" | "paused" | "not_granted" | "not_configured" | "no_run" | "unknown";
    statusLabel: string;
    tone: HealthTone;
  };
}

function sourceIdentityState(cfg: FeedConfigRow | null, configLoadFailed: boolean, outcome: RunOutcome | null, lastSuccessAt: string | null, hasRunSource = false): SourceIdentityState {
  if (configLoadFailed) return "unknown";
  if (!cfg && hasRunSource) return "not_pinned";
  if (!cfg || !cfg.source) return "not_configured";
  if (!cfg.mc_scope_value) return "not_pinned";
  if (outcome === "identity_hold") return "needs_review";
  if (!cfg.rooftop_verified_at) return "pinned_unverified";
  if (isProviderErrorOutcome(outcome)) return "previously_validated";
  if (outcome === "success" || outcome === "partial") return "verified";
  if (lastSuccessAt && new Date(lastSuccessAt).getTime() >= new Date(cfg.rooftop_verified_at).getTime()) return "verified";
  return "previously_validated";
}

export function deriveFeedSnapshot(i: FeedSnapshotInput): FeedSnapshot {
  const cfg = i.config;
  const configLoadFailed = !!i.configLoadFailed;
  const real = i.latestRealRun;
  const outcome = real ? outcomeForRun(real) : null;
  const lastSuccessAt = i.lastSuccessAt;
  const cadence = cadenceHoursFor(cfg?.frequency);

  const runsProveSource = !cfg && !!real && !!outcome;
  const health = deriveFeedHealth({
    configured: configLoadFailed ? null : cfg ? !!cfg.source : runsProveSource,
    enabled: cfg ? cfg.enabled : null,
    latestRun: i.latestRun ? canonicalRunLike(i.latestRun, outcomeForRun(i.latestRun)) : null,
    latestRealRun: real && outcome ? canonicalRunLike(real, outcome) : null,
    lastSuccessAt,
    cadenceHours: cadence,
    now: i.now,
    loadFailed: configLoadFailed || !!i.runsLoadFailed,
  });

  const identity = sourceIdentityState(cfg, configLoadFailed, outcome, lastSuccessAt, runsProveSource);
  const host = sourceHost(real ?? i.latestRun, cfg?.source ?? null);
  const pinValue = cfg?.mc_scope_value ?? null;

  const lastAttempt: FeedTile = real
    ? { value: real.started_at, hint: outcome ? describeAge(real.started_at, i.now) : "", tone: isProviderErrorOutcome(outcome) ? "warning" : "neutral" }
    : { value: "", hint: i.runsLoadFailed ? "Could not be read" : "No attempt recorded", tone: "neutral" };
  const lastSuccess: FeedTile = lastSuccessAt
    ? { value: lastSuccessAt, hint: describeAge(lastSuccessAt, i.now), tone: "success" }
    : { value: "", hint: i.runsLoadFailed ? "Could not be read" : "No successful pull recorded", tone: "neutral" };
  const active: FeedTile = { value: "", hint: "Not archived", tone: "info" };

  const identityTile: FeedTile & { state: SourceIdentityState } = {
    state: identity,
    value: SOURCE_IDENTITY_LABEL[identity],
    hint:
      identity === "previously_validated"
        ? `Validated ${describeAge(cfg?.rooftop_verified_at, i.now)}; no answer since`
        : identity === "verified"
          ? `Validated ${describeAge(cfg?.rooftop_verified_at, i.now)}`
          : identity === "needs_review"
            ? "The last answer did not match this rooftop"
            : identity === "pinned_unverified"
              ? "No validation is recorded for this pin"
              : identity === "not_pinned"
                ? "The sync re-probes every feed until a pin is set"
                : "",
    tone: identity === "verified" ? "success" : identity === "needs_review" ? "warning" : "neutral",
  };

  const providerError = isProviderErrorOutcome(outcome);
  const reviewEnabled = !!cfg && !providerError && !configLoadFailed;
  const reviewReason = !cfg
    ? runsProveSource ? "Pulls are arriving, but no source pin is recorded for this rooftop." : "No source is configured for this rooftop."
    : providerError
      ? "Review source is disabled while a provider error is active."
      : outcome === "identity_hold"
        ? "The last answer did not match this rooftop. Review the identity before any change."
        : "Identity facts are shown read-only; clearing a pin is a separate confirmed action.";

  const refreshStatus = ((): FeedSnapshot["refresh"] => {
    const scope = "This rooftop";
    const schedule = scheduleLabel(cfg);
    if (configLoadFailed) return { scope, schedule: "Unknown", status: "unknown", statusLabel: "Unknown", tone: "neutral" };
    if (!cfg && runsProveSource) return { scope, schedule: "Not recorded", status: "no_run", statusLabel: "Pulling", tone: "neutral" };
    if (!cfg || !cfg.source) return { scope, schedule: "Not configured", status: "not_configured", statusLabel: "Not configured", tone: "neutral" };
    if (cfg.allowed === false) return { scope, schedule, status: "not_granted", statusLabel: "Not granted on this plan", tone: "neutral" };
    if (cfg.enabled === false) return { scope, schedule, status: "paused", statusLabel: "Paused", tone: "neutral" };
    const lastAttemptAt = real?.started_at ?? i.latestRun?.started_at ?? cfg.last_run_at ?? null;
    const age = ageHours(lastAttemptAt, i.now);
    if (age === null) return { scope, schedule, status: "no_run", statusLabel: "No run yet", tone: "neutral" };
    if (age <= cadence + 2) return { scope, schedule, status: "on_schedule", statusLabel: "On schedule", tone: "success" };
    return { scope, schedule, status: "overdue", statusLabel: `Overdue by ${Math.round(age - cadence)} h`, tone: "warning" };
  })();

  return {
    health,
    outcome,
    latestRealRunId: real?.id ?? null,
    tiles: { lastAttempt, lastSuccess, activeVehicles: active, sourceIdentity: identityTile },
    source: {
      host,
      pinLabel: cfg?.mc_scope_param === "dealer_id" ? "Rooftop pin" : "Feed pin",
      pinValue,
      identity,
      verifiedAt: cfg?.rooftop_verified_at ?? null,
      lastGoodAt: cfg?.last_good_at ?? null,
      lastGoodCount: cfg?.last_good_count ?? null,
      rooftop: { name: cfg?.rooftop_name ?? null, street: cfg?.rooftop_street ?? null, zip: cfg?.rooftop_zip ?? null },
      retainedLabel: identity === "needs_review" ? "Source identity on hold" : pinValue ? "Verified source retained" : "No source pin",
      note: providerError ? "Do not clear identity on provider rate limits or errors." : identity === "needs_review" ? "Compare the pinned rooftop against the provider's address before any change." : "The pin is only cleared by an explicit, confirmed action.",
      review: { enabled: reviewEnabled, reason: reviewReason, allowClearScope: outcome === "identity_hold" && i.actorCanClearScope && !!pinValue },
    },
    refresh: refreshStatus,
  };
}

export interface PageSlice<T> {
  rows: T[];
  from: number;
  to: number;
  total: number;
  pages: number;
  page: number;
}

/** Client-side paging over a complete list (fixtures and small ledgers). */
export function pageSlice<T>(rows: T[], page: number, size: number): PageSlice<T> {
  const all = rows.length;
  const pages = Math.max(1, Math.ceil(all / size));
  const safePage = Math.min(Math.max(1, page), pages);
  const from = all === 0 ? 0 : (safePage - 1) * size + 1;
  const to = Math.min(all, safePage * size);
  return { rows: rows.slice((safePage - 1) * size, safePage * size), from, to, total: all, pages, page: safePage };
}

/** Paging facts for rows the server already windowed; a null total means the count read failed. */
export function pageWindow<T>(rows: T[], page: number, size: number, total: number | null): PageSlice<T> {
  const safePage = Math.max(1, page);
  const from = rows.length === 0 ? 0 : (safePage - 1) * size + 1;
  const to = (safePage - 1) * size + rows.length;
  const pages = total === null ? (rows.length === size ? safePage + 1 : safePage) : Math.max(1, Math.ceil(total / size));
  return { rows, from, to, total: total ?? to, pages, page: safePage };
}

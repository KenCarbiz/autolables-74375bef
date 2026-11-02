export type LaunchState =
  | "not_ready"
  | "ready_to_activate"
  | "activating_canary"
  | "pilot_active"
  | "expanding"
  | "paused"
  | "emergency_stop"
  | "activation_failed";

export type CheckStatus = "passed" | "failed" | "unverified";

export interface ReadinessCheck {
  key: string;
  label: string;
  mandatory: boolean;
  status: CheckStatus;
  summary: string | null;
  detail?: Record<string, unknown> | null;
}

export interface Readiness {
  checks: ReadinessCheck[];
  all_mandatory_passed: boolean;
  evaluated_at: string | null;
  plan_version: number | null;
}

export interface RolloutStore {
  store_id: string;
  name: string;
  order: number;
  min_hours_after_previous: number;
  active: boolean;
  policy_ready: boolean;
}

export interface LaunchPlan {
  version: number;
  title: string | null;
  status: string;
  canary_store_id: string | null;
  canary_store_name: string | null;
  canary_max_calls: number;
  canary_window_hours: number;
  hourly_call_ceiling: number | null;
  daily_call_ceiling: number | null;
  error_tripwire_per_hour: number | null;
  uncertain_tripwire_per_hour: number | null;
  feed_max_age_hours: number | null;
  required_gate_version: string | null;
  products: string[];
  allowed_callers: string[];
  cron_jobs: Array<string | { jobname?: string; [key: string]: unknown }>;
  account_usd_cap: number | null;
  rollout_stores: RolloutStore[];
  approved_at: string | null;
}

export interface LaunchControl {
  state?: string;
  paused_reason?: string | null;
  stop_reason?: string | null;
  activated_by?: string | null;
  activated_at?: string | null;
  canary_started_at?: string | null;
  stopped_at?: string | null;
  active_store_ids?: string[];
  [key: string]: unknown;
}

export interface ProviderReported {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  reset_at: string | null;
  reported_at: string | null;
}

export interface PerStore {
  store_id: string;
  name: string;
  mode: string | null;
  daily_limit: number | null;
  monthly_cap: number | null;
  used_month: number | null;
}

export interface CronJob {
  jobid: number | string;
  jobname: string;
  schedule: string;
  active: boolean;
  target?: string | null;
}

export interface Consumption {
  period_start: string | null;
  period_end: string | null;
  period_source: string | null;
  quota: number | null;
  protected_reserve: number | null;
  priority_floors?: Record<string, unknown> | null;
  usd_cap: number | null;
  local_consumed: number | null;
  local_reserved: number | null;
  local_uncertain: number | null;
  usd_spent_estimated: number | null;
  usd_committed_estimated: number | null;
  provider_reported: ProviderReported | null;
  remaining_local: number | null;
  budget_gate: { cap: number | null; reserve: number | null; enabled: boolean | null } | null;
  calls_this_month: number | null;
  denied_this_month: number | null;
  per_product: Record<string, number>;
  denials_by_reason: Record<string, number>;
  per_store: PerStore[];
  last_success: string | null;
  last_error: { at: string; outcome: string; http_status: number | null; caller: string | null } | null;
  marketcheck_cron: CronJob[];
}

export interface Heartbeat { caller: string; gate_version: string | null; last_seen: string | null }

export interface LaunchEvent {
  id: number | string;
  at: string;
  actor: string | null;
  actor_kind: string | null;
  action: string;
  from_state: string | null;
  to_state: string | null;
  plan_version: number | null;
  result: string | null;
  detail: Record<string, unknown> | null;
}

export interface LaunchStatus {
  state: LaunchState;
  stored_state: string;
  activation_on: boolean;
  activation_allowed: boolean;
  emergency_stop: boolean;
  control: LaunchControl | null;
  has_rollback_snapshot: boolean;
  plan: LaunchPlan | null;
  readiness: Readiness | null;
  consumption: Consumption | null;
  heartbeats: Heartbeat[];
  events: LaunchEvent[];
}

export interface FailedCheck { key: string; label?: string; status?: string; summary?: string | null }

export type ActionResult =
  | { ok: true; state?: string; crons_parked?: number }
  | { ok: false; reason: string; failed?: FailedCheck[] };

export type AttestKey = "credentials" | "mcp_boundary" | "quota_concurrency" | "sticker_templates" | "print_passport_qa";

export type DrillResult = { ok: boolean; summary?: string; reason?: string; detail?: Record<string, unknown> };

export interface QuotaFigures {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string | null;
  evidence: string;
}

export interface AttestInput {
  key: AttestKey;
  status: "passed" | "failed";
  summary: string;
  evidenceRef: string;
  detail?: Record<string, unknown>;
}

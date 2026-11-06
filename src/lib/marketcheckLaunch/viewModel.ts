import type { CheckStatus, LaunchState, LaunchStatus, LaunchWorkload, ReadinessCheck, RolloutStore, RooftopReadiness } from "./types";

export const STATE_LABEL: Record<LaunchState, string> = {
  not_ready: "NOT READY",
  ready_to_activate: "READY TO ACTIVATE",
  activating_canary: "ACTIVATING CANARY",
  pilot_active: "PILOT ACTIVE",
  expanding: "EXPANDING APPROVED STORES",
  paused: "PAUSED",
  emergency_stop: "EMERGENCY STOP",
  activation_failed: "ACTIVATION FAILED",
};

export type StateTone = "neutral" | "success" | "warning" | "danger" | "info";

export const STATE_TONE: Record<LaunchState, StateTone> = {
  not_ready: "neutral",
  ready_to_activate: "info",
  activating_canary: "warning",
  pilot_active: "success",
  expanding: "success",
  paused: "warning",
  emergency_stop: "danger",
  activation_failed: "danger",
};

export const stateLabel = (s: string | null | undefined): string => (s && s in STATE_LABEL ? STATE_LABEL[s as LaunchState] : "UNKNOWN");

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = { passed: "Passed", failed: "Failed", unverified: "Unverified" };
export const CHECK_STATUS_TONE: Record<CheckStatus, StateTone> = { passed: "success", failed: "danger", unverified: "warning" };

export const ATTESTED_KEYS = ["credentials", "mcp_boundary", "quota_concurrency", "sticker_templates", "print_passport_qa"] as const;
export const isAttested = (key: string): boolean => (ATTESTED_KEYS as readonly string[]).includes(key);

export const failingMandatory = (checks: ReadinessCheck[] | undefined | null): ReadinessCheck[] => (checks ?? []).filter((c) => c.mandatory && c.status !== "passed");

export const mandatoryProgress = (checks: ReadinessCheck[] | undefined | null) => {
  const mandatory = (checks ?? []).filter((c) => c.mandatory);
  return { passed: mandatory.filter((c) => c.status === "passed").length, total: mandatory.length };
};

export const nextRolloutStore = (stores: RolloutStore[] | undefined | null): RolloutStore | null =>
  [...(stores ?? [])].sort((a, b) => a.order - b.order).find((s) => !s.active) ?? null;

export const isLive = (s: LaunchStatus): boolean => s.activation_on && !s.emergency_stop && s.state !== "paused";

export const canPause = (s: LaunchStatus): boolean => !s.emergency_stop && s.activation_on && s.state !== "paused";
export const canResume = (s: LaunchStatus): boolean => !s.emergency_stop && s.state === "paused";
export const canExpand = (s: LaunchStatus): boolean => !s.emergency_stop && (s.state === "pilot_active" || s.state === "expanding") && nextRolloutStore(s.plan?.rollout_stores) !== null;
export const canRollback = (s: LaunchStatus): boolean => !s.activation_on && s.has_rollback_snapshot;

export const REFUSAL_TEXT: Record<string, string> = {
  emergency_stop: "Emergency stop is on. Release it first.",
  readiness_failed: "Readiness checks did not pass.",
  not_ready: "The launch is not ready to activate.",
  plan_not_approved: "The plan is not approved.",
  not_stopped: "Emergency stop is not on.",
  not_paused: "The launch is not paused.",
  drill_only_when_off: "The stop drill only runs while the launch is off and no stop is active.",
  usd_cap_required: "The plan has no account dollar cap yet.",
  confirm_required: "The confirmation word did not match.",
};

export const refusalText = (reason: string): string => REFUSAL_TEXT[reason] ?? `Refused: ${reason.replace(/_/g, " ")}.`;

export const num = (n: number | null | undefined): string => (n === null || n === undefined ? "Unknown" : n.toLocaleString());
export const when = (s: string | null | undefined): string => (s ? new Date(s).toLocaleString() : "Never");
export const usd = (n: number | null | undefined): string => (n === null || n === undefined ? "Unknown" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const MAX_USD_CAP = 100000;
export const validUsdCap = (raw: string): number | null => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 && n <= MAX_USD_CAP ? n : null;
};

export const cronJobName = (j: string | { jobname?: string }): string => (typeof j === "string" ? j : j.jobname ?? "unnamed job");

export const SQL_FALLBACK = "UPDATE public.marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop' WHERE id = 1;";

export const periodSourceLabel = (src: string | null | undefined): string => {
  if (!src) return "Unknown";
  return /provider|reset/i.test(src) ? "Provider reset date" : "Assumed UTC month";
};

export const rooftopsFromReadiness = (checks: ReadinessCheck[] | undefined | null): RooftopReadiness[] => {
  const c = (checks ?? []).find((x) => x.key === "rooftop_mappings");
  const stores = (c?.detail as { stores?: unknown } | null | undefined)?.stores;
  return Array.isArray(stores) ? (stores as RooftopReadiness[]) : [];
};

export const workloadLine = (w: LaunchWorkload | null | undefined): string =>
  w ? `Up to ${w.max_vehicles_per_store} vehicles per store through ${w.function}, at most ${w.calls_per_vehicle} calls each, ${w.batch_size} at a time` : "None: starting only opens the gate";

// ──────────────────────────────────────────────────────────────────────
// When is a tenant's inventory sync due?
//
// The cron fires HOURLY and posts an empty body; this decides which tenants
// that tick belongs to. It used to be an exact-hour equality:
//
//     if (now.getUTCHours() !== cfg.run_hour) return false;
//
// which gives every tenant exactly ONE chance per cadence period. Miss that
// single tick — a cold start, a deploy, cron drift, the 120s http_post timeout,
// an upstream blip — and a nightly dealer loses a full day of inventory. Worse,
// it loses it silently: a tenant that was never considered leaves no row, so
// "never ran" and "ran and found nothing" look identical from the outside.
//
// A due WINDOW fixes the first problem: the run can be picked up by any of the
// next few hourly ticks. The cadence guard (hoursSince) still holds it to
// at-most-once per period, so a window cannot become a second run.
//
// `overdueBy` fixes the second: it turns silence into a number the caller can
// log and alert on.
//
// Pure and clock-injected, so it is testable without waiting for 3am.
// ──────────────────────────────────────────────────────────────────────

export type SyncFrequency = "nightly" | "weekly" | "biweekly" | "monthly";

export interface SyncSchedule {
  frequency: string;
  /** UTC hour the tenant is scheduled for, 0-23. */
  run_hour: number;
  /** 0 = Sunday. Only consulted for weekly/biweekly/monthly. */
  day_of_week: number;
  last_run_at: string | null;
}

/**
 * How many hourly ticks after its scheduled slot a tenant may still be picked
 * up. Six is deliberate: long enough to survive a handful of consecutive
 * failures or a slow deploy, short enough that a "nightly" sync still lands
 * overnight rather than during the dealership's business day.
 */
export const CATCH_UP_HOURS = 6;

const HOUR_MS = 3.6e6;
const DAY_MS = 24 * HOUR_MS;

/** Minimum gap between runs, per cadence. Slightly under the nominal period so
 *  a run that drifted an hour late does not push the next one a whole day. */
const MIN_GAP_HOURS: Record<SyncFrequency, number> = {
  nightly: 20,
  weekly: 6 * 24,
  biweekly: 13 * 24,
  monthly: 27 * 24,
};

const isFrequency = (v: string): v is SyncFrequency =>
  v === "nightly" || v === "weekly" || v === "biweekly" || v === "monthly";

/** Hours elapsed since the tenant's most recent scheduled slot: 0 at the slot,
 *  23 an hour before the next one. Wraps across midnight. */
export function hoursSinceSlot(runHour: number, now: Date): number {
  return (now.getUTCHours() - runHour + 24) % 24;
}

/** The UTC weekday of the slot we are currently catching up on — NOT of `now`.
 *  A 23:00 Sunday slot picked up at 01:00 Monday is still Sunday's run, and
 *  testing `now`'s weekday would reject it. */
export function slotDayOfWeek(runHour: number, now: Date): number {
  return new Date(now.getTime() - hoursSinceSlot(runHour, now) * HOUR_MS).getUTCDay();
}

export function isDue(cfg: SyncSchedule, now: Date): boolean {
  if (!isFrequency(cfg.frequency)) return false;

  const since = hoursSinceSlot(cfg.run_hour, now);
  if (since >= CATCH_UP_HOURS) return false;

  const last = cfg.last_run_at ? new Date(cfg.last_run_at).getTime() : 0;
  const hoursSince = (now.getTime() - last) / HOUR_MS;
  if (hoursSince < MIN_GAP_HOURS[cfg.frequency]) return false;

  if (cfg.frequency === "nightly") return true;
  return slotDayOfWeek(cfg.run_hour, now) === cfg.day_of_week;
}

/**
 * Hours past the point this tenant should certainly have run by, or 0 when it
 * is on schedule. A tenant that has never run reports its full period.
 *
 * The caller logs this so a rooftop that quietly stopped syncing shows up as a
 * number instead of an absence.
 */
export function overdueBy(cfg: SyncSchedule, now: Date): number {
  if (!isFrequency(cfg.frequency)) return 0;
  const period = MIN_GAP_HOURS[cfg.frequency];
  // Grace = one full catch-up window past the period. Inside that, the tenant
  // is merely waiting for its slot, not failing.
  const tolerance = period + CATCH_UP_HOURS;
  if (!cfg.last_run_at) return period;
  const hoursSince = (now.getTime() - new Date(cfg.last_run_at).getTime()) / HOUR_MS;
  return hoursSince > tolerance ? Math.round(hoursSince - tolerance) : 0;
}

/** Human-readable reason a tenant was not picked up, for the batch diagnostic. */
export function skipReason(cfg: SyncSchedule, now: Date): string {
  if (!isFrequency(cfg.frequency)) return `unknown_frequency:${cfg.frequency}`;
  const since = hoursSinceSlot(cfg.run_hour, now);
  if (since >= CATCH_UP_HOURS) return `outside_window:${since}h_past_${cfg.run_hour}00z`;
  const last = cfg.last_run_at ? new Date(cfg.last_run_at).getTime() : 0;
  const hoursSince = Math.round((now.getTime() - last) / HOUR_MS);
  if (hoursSince < MIN_GAP_HOURS[cfg.frequency]) return `ran_${hoursSince}h_ago`;
  if (cfg.frequency !== "nightly" && slotDayOfWeek(cfg.run_hour, now) !== cfg.day_of_week) {
    return `wrong_day:slot_dow_${slotDayOfWeek(cfg.run_hour, now)}_want_${cfg.day_of_week}`;
  }
  return "due";
}

export const _internals = { MIN_GAP_HOURS, DAY_MS };

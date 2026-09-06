// When a description is rewritten after its first one.
//
// Owner rule: generate on original ingest, refresh once at 60 days in
// inventory, and once more at 200. Nothing in between — a description that is
// still accurate does not need rewriting because a week passed, and every
// rewrite spends provider credits across the whole lot.
//
// Inventory age comes from the feed's days-on-market where the provider
// supplies it, because that is the vehicle's real age on the lot. Falling back
// to our own ingest date would restart the clock for every car that was
// already in stock when the dealership onboarded: on this lot the oldest row
// is 79 days old while the oldest vehicle has been listed 883 days, so the
// fallback would have said "day 0" for a car approaching its third year.

export const REFRESH_MILESTONES = [60, 200] as const;
export type RefreshMilestone = (typeof REFRESH_MILESTONES)[number];

export interface RefreshInputs {
  /** Days on market from the provider, when present. */
  dom?: number | null;
  /** When AutoLabels first saw the vehicle. Fallback only. */
  ingestedAt?: string | Date | null;
  /** The milestone the current description was written for, if any. */
  lastMilestone?: number | null;
  /** Whether a description exists at all. */
  hasDescription: boolean;
  /** A manually locked description is never rewritten on a schedule. */
  locked?: boolean;
  now?: Date;
}

export interface RefreshDecision {
  due: boolean;
  reason: "initial" | "milestone" | "locked" | "not_due" | "unknown_age";
  milestone: RefreshMilestone | null;
  daysInInventory: number | null;
  ageSource: "provider_dom" | "ingest_date" | "unknown";
}

const days = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);

export function inventoryAge(input: RefreshInputs): {
  days: number | null; source: RefreshDecision["ageSource"];
} {
  // Number(null) is 0, which is finite and non-negative — so a missing
  // provider figure would read as "brand new" and the vehicle would never
  // reach a milestone. The absence has to be checked before the coercion.
  if (input.dom !== null && input.dom !== undefined && String(input.dom).trim() !== "") {
    const dom = Number(input.dom);
    if (Number.isFinite(dom) && dom >= 0) return { days: Math.floor(dom), source: "provider_dom" };
  }
  if (input.ingestedAt) {
    const from = new Date(input.ingestedAt);
    if (!Number.isNaN(from.getTime())) {
      return { days: Math.max(0, days(from, input.now ?? new Date())), source: "ingest_date" };
    }
  }
  return { days: null, source: "unknown" };
}

export function refreshDecision(input: RefreshInputs): RefreshDecision {
  const { days: age, source } = inventoryAge(input);

  // A vehicle with no description gets one regardless of age. This is the
  // original-ingest case, and also the repair path for anything that failed.
  if (!input.hasDescription) {
    return { due: true, reason: "initial", milestone: null, daysInInventory: age, ageSource: source };
  }

  // A human chose this copy. Age never overrides that; the material-change
  // path marks it stale for review instead.
  if (input.locked) {
    return { due: false, reason: "locked", milestone: null, daysInInventory: age, ageSource: source };
  }

  if (age === null) {
    return { due: false, reason: "unknown_age", milestone: null, daysInInventory: null, ageSource: source };
  }

  // The highest milestone this vehicle has reached but not yet been written
  // for. A car onboarded at 300 days skips straight to 200 rather than
  // generating twice to catch up.
  const reached = REFRESH_MILESTONES.filter((m) => age >= m);
  const done = Number(input.lastMilestone) || 0;
  const outstanding = reached.filter((m) => m > done);
  if (!outstanding.length) {
    return { due: false, reason: "not_due", milestone: null, daysInInventory: age, ageSource: source };
  }
  return {
    due: true, reason: "milestone",
    milestone: outstanding[outstanding.length - 1],
    daysInInventory: age, ageSource: source,
  };
}

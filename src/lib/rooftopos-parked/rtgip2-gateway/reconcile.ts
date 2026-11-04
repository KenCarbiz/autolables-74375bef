/**
 * Reconciliation report model (pure). Mirrors gw_reconcile v2 (migration 0021).
 * Invariant checks are mismatches; late deliveries, poison dead letters and route counts are information only.
 */

export const INVARIANT_CHECKS = [
  "missing_fanout",
  "delivered_without_inbox",
  "terminal_without_inbox",
  "inbox_without_ack",
  "dead_without_dead_letter",
  "projection_behind_delivered",
  "stuck_messages",
] as const;
export type InvariantCheck = (typeof INVARIANT_CHECKS)[number];

/** Checks that, when non-zero, mean an accepted event may be lost or never acknowledged. */
export const NEVER_LOSE_CHECKS: readonly InvariantCheck[] = [
  "missing_fanout",
  "stuck_messages",
  "terminal_without_inbox",
  "inbox_without_ack",
  "dead_without_dead_letter",
];

export type RouteCounts = {
  copies: number;
  delivered: number;
  duplicate: number;
  stale: number;
  dead: number;
  in_flight: number;
  late_delivered: number;
};

export type BehindKey = {
  route_id: string;
  target_app: string;
  source_app: string;
  aggregate_type: string;
  aggregate_id: string;
  max_delivered_revision: number;
  head_event_id: string;
  projection_revision: number;
  projection_exists: boolean;
};

export type ReconcileDetails = Partial<Record<InvariantCheck, number>> & {
  never_lose_ok?: boolean;
  source_events?: number;
  route_copies?: number;
  copies_by_status?: Record<string, number>;
  routes?: Record<string, RouteCounts>;
  late_deliveries?: number;
  late_threshold_s?: number;
  dlq?: { poison: number; invariant: number; other: number; unresolved: number };
  projection_behind_keys?: BehindKey[];
  missing_fanout_keys?: { event_id: string; route_id: string }[];
  version?: number;
};

/**
 * Invariant mismatch total, counted the way the DB does: terminal_without_inbox already includes
 * delivered_without_inbox, so only the difference is added.
 */
export function mismatchTotal(d: ReconcileDetails): number {
  const v = (k: InvariantCheck) => Number(d[k] ?? 0);
  const terminalExtra = Math.max(0, v("terminal_without_inbox") - v("delivered_without_inbox"));
  return (
    v("missing_fanout") +
    v("delivered_without_inbox") +
    v("projection_behind_delivered") +
    v("stuck_messages") +
    terminalExtra +
    v("inbox_without_ack") +
    v("dead_without_dead_letter")
  );
}

export function neverLoseOk(d: ReconcileDetails): boolean {
  return hasCompleteInvariantCounts(d) && NEVER_LOSE_CHECKS.every((k) => d[k] === 0);
}

/** Missing, coerced or invalid counters are unknown, never evidence of zero mismatches. */
export function hasCompleteInvariantCounts(d: unknown): d is ReconcileDetails {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const values = d as Record<string, unknown>;
  return INVARIANT_CHECKS.every((k) => {
    const value = values[k];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  });
}

/** Release gate: zero invariant mismatches. Late deliveries and poison DLQ never block this gate on their own. */
export function releaseGate(d: unknown): { pass: boolean; failing: InvariantCheck[] } {
  if (!hasCompleteInvariantCounts(d)) return { pass: false, failing: [...INVARIANT_CHECKS] };
  const failing = INVARIANT_CHECKS.filter((k) => d[k] !== 0);
  return { pass: failing.length === 0, failing };
}

/** Route copies summed over routes; this is a per-copy count, never a source-event count. */
export function routeCopyTotal(d: ReconcileDetails): number {
  return Object.values(d.routes ?? {}).reduce((s, r) => s + r.copies, 0);
}

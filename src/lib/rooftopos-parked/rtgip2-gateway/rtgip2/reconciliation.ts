import { hasCompleteInvariantCounts, INVARIANT_CHECKS, type ReconcileDetails } from "../reconcile";
import { requestReconciliation } from "../reconcile-request";
export function compatibleCounters(v2: unknown, v3: unknown): boolean {
  if (
    !hasCompleteInvariantCounts(v2) ||
    !hasCompleteInvariantCounts(v3) ||
    v2.version !== 2 ||
    v3.version !== 3
  )
    return false;
  return INVARIANT_CHECKS.every((k) => v2[k] === v3[k]);
}
export function validateV3Report(value: unknown): value is ReconcileDetails {
  return hasCompleteInvariantCounts(value) && value.version === 3;
}

/** Reuses the same 10-second fail-closed deadline. v2 callers remain strict v2. */
export async function requestV3Reconciliation(
  request: (
    signal: AbortSignal,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
) {
  return requestReconciliation(request, 3);
}

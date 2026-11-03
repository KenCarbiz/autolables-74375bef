import { hasCompleteInvariantCounts, type ReconcileDetails } from "./reconcile";

// A deadline is failure/unknown, not a substituted all-zero report or an automatic retry.
export const RECONCILE_DEADLINE_MS = 10_000;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type ReconcileRequest = (signal: AbortSignal) => PromiseLike<RpcResult>;
export type ReconcileOutcome =
  | { ok: true; details: ReconcileDetails }
  | {
      ok: false;
      reason: "statement_timeout" | "client_deadline" | "rpc_unavailable" | "invalid_report";
    };

export async function requestReconciliation(
  request: ReconcileRequest,
  expectedVersion: 2 | 3 = 2,
): Promise<ReconcileOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ReconcileOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "client_deadline" });
    }, RECONCILE_DEADLINE_MS);
  });
  const operation = Promise.resolve()
    .then(() => request(controller.signal))
    .then((result): ReconcileOutcome => {
      if (result.error)
        return {
          ok: false,
          reason: controller.signal.aborted
            ? "client_deadline"
            : result.error.code === "57014"
              ? "statement_timeout"
              : "rpc_unavailable",
        };
      if (!hasCompleteInvariantCounts(result.data) || result.data.version !== expectedVersion)
        return { ok: false, reason: "invalid_report" };
      return { ok: true, details: result.data };
    })
    .catch((): ReconcileOutcome => ({
      ok: false,
      reason: controller.signal.aborted ? "client_deadline" : "rpc_unavailable",
    }));
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

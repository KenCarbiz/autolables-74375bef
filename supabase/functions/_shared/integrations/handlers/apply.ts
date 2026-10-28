import { json, preflight } from "../../http.ts";
import { nextRetry } from "../backoff.ts";
import { planApply, type ApplyPlan, type InboxRowForApply } from "../applyDecision.ts";

export interface ClaimedRow extends InboxRowForApply {
  status: string;
  attempts: number;
  event_id: string;
}

export interface ApplyOutcome {
  status: string;
  outcome?: string;
}

export interface ApplyStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedRow[]>;
  apply(inboxId: string, plan: ApplyPlan): Promise<ApplyOutcome>;
  fail(inboxId: string, errorCode: string, delaySeconds: number, dead: boolean): Promise<void>;
  audit(row: ClaimedRow, status: string, outcome: string): Promise<void>;
}

export interface ApplyDeps {
  enabled(): boolean;
  authorize(req: Request): boolean;
  store(): ApplyStore | null;
  random?(): number;
}

export const LEASE_SECONDS = 300;

export async function runApplyBatch(
  store: ApplyStore,
  limit: number,
  random: () => number = Math.random,
): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const rows = await store.claim(limit, LEASE_SECONDS);
  const outcomes: Record<string, number> = {};
  const bump = (k: string) => { outcomes[k] = (outcomes[k] ?? 0) + 1; };

  for (const row of rows) {
    try {
      const result = await store.apply(row.id, planApply(row));
      await store.audit(row, result.status, result.outcome ?? "").catch(() => {});
      bump(result.status);
    } catch (_err) {
      const attempts = row.attempts + 1;
      const retry = nextRetry(attempts, null, random);
      const dead = retry.dead;
      await store.fail(row.id, "apply_error", retry.delaySeconds ?? 0, dead).catch(() => {});
      if (dead) await store.audit(row, "dead", "apply_error").catch(() => {});
      bump(dead ? "dead" : "retry");
    }
  }
  return { claimed: rows.length, outcomes };
}

export async function handleApply(req: Request, deps: ApplyDeps): Promise<Response> {
  const pf = preflight(req);
  if (pf) return pf;
  if (!deps.enabled()) return json(503, { ok: false, error: "integrations_disabled" });
  if (!deps.authorize(req)) return json(401, { ok: false, error: "not authorized" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const store = deps.store();
  if (!store) return json(503, { ok: false, error: "unavailable" });

  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  try {
    return json(200, { ok: true, ...(await runApplyBatch(store, limit, deps.random)) });
  } catch (_err) {
    return json(503, { ok: false, error: "unavailable" });
  }
}

import { supabase } from "@/integrations/supabase/client";
import { FriendlyError, explainError } from "@/lib/inventoryNetwork/api";
import type { ActionResult, AttestInput, LaunchStatus, QuotaFigures } from "./types";

interface RawResult { data: unknown; error: { message: string } | null }
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RawResult> };

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await db.rpc(fn, args);
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const describeError = (e: unknown): string => {
  if (e instanceof FriendlyError) return e.message;
  const msg = e instanceof Error ? e.message : "";
  if (/42883|does not exist|could not find the function/i.test(msg)) return "The MarketCheck launch control update has not been applied to this project yet.";
  if (/platform_admin_required|42501|permission denied/i.test(msg)) return "Only platform administrators can use launch control.";
  return explainError(e);
};

export async function getLaunchStatus(): Promise<LaunchStatus> {
  const data = await call<LaunchStatus | null>("marketcheck_launch_status");
  if (!data || typeof data !== "object" || typeof data.state !== "string") throw new Error("Launch status came back empty.");
  return data;
}

export const activateLaunch = (planVersion: number, confirm: string) => call<ActionResult>("marketcheck_launch_activate", { p_plan_version: planVersion, p_confirm: confirm });
export const emergencyStop = (reason: string) => call<ActionResult>("marketcheck_emergency_stop", { p_reason: reason });
export const releaseStop = (confirm: string) => call<ActionResult>("marketcheck_launch_release_stop", { p_confirm: confirm });
export const pauseLaunch = (reason: string) => call<ActionResult>("marketcheck_launch_pause", { p_reason: reason });
export const resumeLaunch = (confirm: string) => call<ActionResult>("marketcheck_launch_resume", { p_confirm: confirm });
export const expandLaunch = (storeId: string, confirm: string) => call<ActionResult>("marketcheck_launch_expand", { p_store_id: storeId, p_confirm: confirm });
export const rollbackLaunch = (confirm: string) => call<ActionResult>("marketcheck_launch_rollback", { p_confirm: confirm });
export const stopDrill = () => call<ActionResult>("marketcheck_launch_stop_drill");
export const approvePlan = (version: number) => call<ActionResult>("marketcheck_launch_approve_plan", { p_version: version });
export const recordQuota = (q: QuotaFigures) =>
  call<ActionResult>("marketcheck_launch_record_quota", { p_limit: q.limit, p_used: q.used, p_remaining: q.remaining, p_reset_at: q.resetAt, p_evidence: q.evidence });
export const attestCheck = (a: AttestInput) =>
  call<ActionResult>("marketcheck_launch_attest", { p_check_key: a.key, p_status: a.status, p_summary: a.summary, p_evidence_ref: a.evidenceRef, p_detail: a.detail ?? {} });

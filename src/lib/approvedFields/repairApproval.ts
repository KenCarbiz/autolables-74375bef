import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { readOptional, runWrite, type Optional, type WriteResult } from "./optionalSchema";

type DbClient = SupabaseClient<Database>;

export const REPAIR_APPROVALS = ["pending", "approved", "not_approved"] as const;
export type RepairApproval = (typeof REPAIR_APPROVALS)[number];

export const REPAIR_APPROVAL_LABEL: Record<RepairApproval, string> = {
  pending: "Pending",
  approved: "Approved",
  not_approved: "Not approved",
};

export const REPAIR_APPROVAL_HELP = "Internal service-manager authorization, not customer consent";

export const isRepairApproval = (v: unknown): v is RepairApproval =>
  typeof v === "string" && (REPAIR_APPROVALS as readonly string[]).includes(v);

export const toRepairApproval = (v: unknown): RepairApproval => (isRepairApproval(v) ? v : "pending");

export const repairApprovalLabel = (v: unknown): string => REPAIR_APPROVAL_LABEL[toRepairApproval(v)];

export const canSetRepairApproval = (role: string, isPlatformAdmin = false): boolean =>
  hasDealerCapability(role, "can_approve_service_work", isPlatformAdmin);

export interface RepairApprovalRecord {
  approval: RepairApproval;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface RepairApprovalChange {
  id: string;
  failureId: string;
  previousApproval: RepairApproval | null;
  approval: RepairApproval;
  changedBy: string | null;
  changedAt: string;
}

export function fetchRepairApprovals(
  client: DbClient,
  failureIds: string[],
): Promise<Optional<Map<string, RepairApprovalRecord>>> {
  if (failureIds.length === 0) return Promise.resolve({ status: "available", data: new Map() });
  return readOptional(
    () =>
      client
        .from("safety_inspection_item_failures")
        .select("id, repair_approval, repair_approval_by, repair_approval_at")
        .in("id", failureIds),
    (rows) =>
      new Map(
        (rows ?? []).map((r) => [
          r.id,
          { approval: toRepairApproval(r.repair_approval), decidedBy: r.repair_approval_by, decidedAt: r.repair_approval_at },
        ] as const),
      ),
  );
}

export function fetchRepairApprovalHistory(client: DbClient, failureId: string): Promise<Optional<RepairApprovalChange[]>> {
  return readOptional(
    () =>
      client
        .from("safety_inspection_repair_approval_history")
        .select("id, failure_id, previous_approval, approval, changed_by, changed_at")
        .eq("failure_id", failureId)
        .order("changed_at", { ascending: false })
        .limit(100),
    (rows) =>
      (rows ?? []).map((r) => ({
        id: r.id,
        failureId: r.failure_id,
        previousApproval: isRepairApproval(r.previous_approval) ? r.previous_approval : null,
        approval: toRepairApproval(r.approval),
        changedBy: r.changed_by,
        changedAt: r.changed_at,
      })),
  );
}

export function setRepairApproval(
  client: DbClient,
  failureId: string,
  decision: RepairApproval,
): Promise<WriteResult<RepairApprovalRecord>> {
  if (!isRepairApproval(decision)) {
    return Promise.resolve({ ok: false, reason: "invalid", message: "Choose Pending, Approved or Not approved." });
  }
  return runWrite(
    () => client.rpc("set_repair_approval", { p_failure_id: failureId, p_decision: decision }),
    (data) => {
      const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
      return {
        approval: toRepairApproval(d.repair_approval ?? decision),
        decidedBy: typeof d.repair_approval_by === "string" ? d.repair_approval_by : null,
        decidedAt: typeof d.repair_approval_at === "string" ? d.repair_approval_at : null,
      };
    },
  );
}

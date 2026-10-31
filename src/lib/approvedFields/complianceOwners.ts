import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dealerRoleCapabilityMap, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { isComplianceIssueKey } from "./complianceIssueKey";
import { readOptional, runWrite, type Optional, type WriteResult } from "./optionalSchema";

export type DbClient = SupabaseClient<Database>;

export const UNASSIGNED_LABEL = "Unassigned";

export interface ComplianceOwnerAssignment {
  issueKey: string;
  ownerUserId: string | null;
  assignedBy: string | null;
  assignedAt: string;
}

export interface ComplianceOwnerChange {
  id: string;
  issueKey: string;
  previousOwnerUserId: string | null;
  ownerUserId: string | null;
  changedBy: string;
  changedAt: string;
}

export const rolesWithCapability = (capability: Parameters<typeof hasDealerCapability>[1]): string[] =>
  Object.entries(dealerRoleCapabilityMap)
    .filter(([, caps]) => caps.includes(capability))
    .map(([role]) => role)
    .sort();

export const canAssignComplianceOwners = (role: string, isPlatformAdmin = false): boolean =>
  hasDealerCapability(role, "can_manage_compliance", isPlatformAdmin);

export const isEligibleComplianceOwnerRole = (role: string | null | undefined): boolean => {
  const normalized = `${role || ""}`.trim().toLowerCase();
  return !!dealerRoleCapabilityMap[normalized]?.includes("can_view_compliance");
};

export function complianceOwnerLabel(
  assignment: Pick<ComplianceOwnerAssignment, "ownerUserId"> | null | undefined,
  nameOf: (userId: string) => string | null | undefined,
): string {
  const id = assignment?.ownerUserId;
  if (!id) return UNASSIGNED_LABEL;
  return nameOf(id)?.trim() || "Former team member";
}

export function fetchComplianceOwners(
  client: DbClient,
  tenantId: string,
): Promise<Optional<Map<string, ComplianceOwnerAssignment>>> {
  return readOptional(
    () =>
      client
        .from("compliance_issue_owners")
        .select("issue_key, owner_user_id, assigned_by, assigned_at")
        .eq("tenant_id", tenantId)
        .limit(5000),
    (rows) => {
      const out = new Map<string, ComplianceOwnerAssignment>();
      for (const r of rows ?? []) {
        out.set(r.issue_key, {
          issueKey: r.issue_key,
          ownerUserId: r.owner_user_id,
          assignedBy: r.assigned_by,
          assignedAt: r.assigned_at,
        });
      }
      return out;
    },
  );
}

export function fetchComplianceOwnerHistory(
  client: DbClient,
  tenantId: string,
  issueKey: string,
): Promise<Optional<ComplianceOwnerChange[]>> {
  return readOptional(
    () =>
      client
        .from("compliance_issue_owner_history")
        .select("id, issue_key, previous_owner_user_id, owner_user_id, changed_by, changed_at")
        .eq("tenant_id", tenantId)
        .eq("issue_key", issueKey)
        .order("changed_at", { ascending: false })
        .limit(200),
    (rows) =>
      (rows ?? []).map((r) => ({
        id: r.id,
        issueKey: r.issue_key,
        previousOwnerUserId: r.previous_owner_user_id,
        ownerUserId: r.owner_user_id,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
      })),
  );
}

export async function assignComplianceOwner(
  client: DbClient,
  args: { tenantId: string; issueKey: string; ownerUserId: string | null },
): Promise<WriteResult<{ changed: boolean }>> {
  if (!args.tenantId) return { ok: false, reason: "invalid", message: "Choose a dealership." };
  if (!isComplianceIssueKey(args.issueKey)) return { ok: false, reason: "invalid", message: "Unknown compliance issue." };
  return runWrite(
    () =>
      client.rpc("assign_compliance_issue_owner", {
        p_tenant_id: args.tenantId,
        p_issue_key: args.issueKey,
        p_owner_user_id: args.ownerUserId ?? undefined,
      }),
    (data) => {
      const changed = data && typeof data === "object" && !Array.isArray(data) ? (data as { changed?: unknown }).changed : undefined;
      return { changed: changed !== false };
    },
  );
}

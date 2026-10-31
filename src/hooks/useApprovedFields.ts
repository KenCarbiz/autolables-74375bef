import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  assignComplianceOwner,
  fetchComplianceOwnerHistory,
  fetchComplianceOwners,
} from "@/lib/approvedFields/complianceOwners";
import { fetchDealNumbers, setDealNumber } from "@/lib/approvedFields/dealNumber";
import { fetchPlatformVehicleCounts } from "@/lib/approvedFields/platformVehicleCounts";
import {
  effectivePrepDue,
  fetchPrepDefaultDays,
  fetchPrepDueDates,
  formatPrepDue,
  prepDueState,
  setPrepDueAt,
  setPrepDefaultDays,
} from "@/lib/approvedFields/prepDue";
import {
  fetchRepairApprovalHistory,
  fetchRepairApprovals,
  setRepairApproval,
  type RepairApproval,
} from "@/lib/approvedFields/repairApproval";
import type { WriteResult } from "@/lib/approvedFields/optionalSchema";

// Each read below is its own query keyed apart from the page's existing
// reads, and resolves to an Optional rather than throwing, so a database
// without the 2026-10-31 migration leaves every other query untouched.

const QUERY_OPTS = { retry: false, staleTime: 30_000 } as const;

const throwUnlessOk = <T>(r: WriteResult<T>): T => {
  if (!r.ok) throw Object.assign(new Error(r.message), { reason: r.reason });
  return r.data;
};

const sortedKey = (ids: string[]) => [...new Set(ids)].sort();

export const useComplianceIssueOwners = () => {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const queryKey = ["approved_fields", "compliance_owners", tenantId] as const;
  const query = useQuery({
    queryKey,
    enabled: !!tenantId,
    ...QUERY_OPTS,
    queryFn: () => fetchComplianceOwners(supabase, tenantId as string),
  });
  const assign = useMutation({
    mutationFn: async (args: { issueKey: string; ownerUserId: string | null }) =>
      throwUnlessOk(await assignComplianceOwner(supabase, { tenantId: tenantId as string, ...args })),
    onSettled: () => qc.invalidateQueries({ queryKey: ["approved_fields", "compliance_owners", tenantId] }),
  });
  return { owners: query.data, isLoading: query.isLoading, assign };
};

export const useComplianceIssueOwnerHistory = (issueKey: string | null) => {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  return useQuery({
    queryKey: ["approved_fields", "compliance_owner_history", tenantId, issueKey],
    enabled: !!tenantId && !!issueKey,
    ...QUERY_OPTS,
    queryFn: () => fetchComplianceOwnerHistory(supabase, tenantId as string, issueKey as string),
  });
};

export interface PrepDueView {
  dueAt: string | null;
  source: "set" | "default" | "none";
  label: string;
  state: ReturnType<typeof prepDueState>;
}

export const usePrepDueDates = (
  rows: { id: string; created_at?: string | null }[],
  timeZone: string | null | undefined,
) => {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const ids = sortedKey(rows.map((r) => r.id));
  const dueQuery = useQuery({
    queryKey: ["approved_fields", "prep_due", ids],
    enabled: ids.length > 0,
    ...QUERY_OPTS,
    queryFn: () => fetchPrepDueDates(supabase, ids),
  });
  const defaultQuery = useQuery({
    queryKey: ["approved_fields", "prep_default_days", tenantId],
    enabled: !!tenantId,
    ...QUERY_OPTS,
    queryFn: () => fetchPrepDefaultDays(supabase, tenantId as string),
  });
  const due = dueQuery.data?.status === "available" ? dueQuery.data.data : null;
  const defaultDays = defaultQuery.data?.status === "available" ? defaultQuery.data.data : null;
  const view = (row: { id: string; created_at?: string | null }): PrepDueView | null => {
    if (!due) return null;
    const eff = effectivePrepDue({ due_at: due.get(row.id) ?? null, created_at: row.created_at }, defaultDays);
    return { ...eff, label: formatPrepDue(eff.dueAt, timeZone), state: prepDueState(eff.dueAt) };
  };
  const setDue = useMutation({
    mutationFn: async (args: { prepId: string; dueAt: string | null }) => throwUnlessOk(await setPrepDueAt(supabase, args.prepId, args.dueAt)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["approved_fields", "prep_due"] }),
  });
  const setDefaultDays = useMutation({
    mutationFn: async (days: number | null) => throwUnlessOk(await setPrepDefaultDays(supabase, tenantId as string, days)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["approved_fields", "prep_default_days", tenantId] }),
  });
  return { available: due != null, defaultDays, view, setDue, setDefaultDays, isLoading: dueQuery.isLoading };
};

export const useDealNumbers = (addendumIds: string[]) => {
  const qc = useQueryClient();
  const ids = sortedKey(addendumIds);
  const query = useQuery({
    queryKey: ["approved_fields", "deal_numbers", ids],
    enabled: ids.length > 0,
    ...QUERY_OPTS,
    queryFn: () => fetchDealNumbers(supabase, ids),
  });
  const save = useMutation({
    mutationFn: async (args: { addendumId: string; dealNumber: string | null }) =>
      throwUnlessOk(await setDealNumber(supabase, args.addendumId, args.dealNumber)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["approved_fields", "deal_numbers"] }),
  });
  return { dealNumbers: query.data, isLoading: query.isLoading, save };
};

export const useRepairApprovals = (failureIds: string[]) => {
  const qc = useQueryClient();
  const ids = sortedKey(failureIds);
  const query = useQuery({
    queryKey: ["approved_fields", "repair_approvals", ids],
    enabled: ids.length > 0,
    ...QUERY_OPTS,
    queryFn: () => fetchRepairApprovals(supabase, ids),
  });
  const decide = useMutation({
    mutationFn: async (args: { failureId: string; decision: RepairApproval }) =>
      throwUnlessOk(await setRepairApproval(supabase, args.failureId, args.decision)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["approved_fields", "repair_approvals"] }),
  });
  return { approvals: query.data, isLoading: query.isLoading, decide };
};

export const useRepairApprovalHistory = (failureId: string | null) =>
  useQuery({
    queryKey: ["approved_fields", "repair_approval_history", failureId],
    enabled: !!failureId,
    ...QUERY_OPTS,
    queryFn: () => fetchRepairApprovalHistory(supabase, failureId as string),
  });

export const usePlatformVehicleCounts = (enabled: boolean) =>
  useQuery({
    queryKey: ["approved_fields", "platform_vehicle_counts"],
    enabled,
    ...QUERY_OPTS,
    queryFn: () => fetchPlatformVehicleCounts(supabase),
  });

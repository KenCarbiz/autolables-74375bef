import { useMemo } from "react";
import { toast } from "sonner";
import { FilterSelect } from "@/components/product";
import { useComplianceIssueOwnerHistory, useComplianceIssueOwners } from "@/hooks/useApprovedFields";
import { useTenantMemberDirectory } from "@/hooks/useTenantMemberDirectory";
import { UNASSIGNED_LABEL, complianceOwnerLabel, isEligibleComplianceOwnerRole } from "@/lib/approvedFields/complianceOwners";
import { formatDateTime } from "./primitives";

const UNASSIGNED_VALUE = "__unassigned";

export const ComplianceOwnerDetail = ({ issueKey, canAssign }: { issueKey: string; canAssign: boolean }) => {
  const { owners, assign } = useComplianceIssueOwners();
  const { members, nameOf } = useTenantMemberDirectory();
  const history = useComplianceIssueOwnerHistory(issueKey);
  const current = owners?.status === "available" ? owners.data.get(issueKey) ?? null : null;
  const writable = owners?.status === "available" && canAssign;
  const eligible = useMemo(() => members.filter((m) => isEligibleComplianceOwnerRole(m.role)), [members]);
  const value = current?.ownerUserId ?? UNASSIGNED_VALUE;
  const options = [
    { value: UNASSIGNED_VALUE, label: UNASSIGNED_LABEL },
    ...eligible.map((m) => ({ value: m.userId, label: m.name || "Team member" })),
    ...(current?.ownerUserId && !eligible.some((m) => m.userId === current.ownerUserId)
      ? [{ value: current.ownerUserId, label: complianceOwnerLabel(current, nameOf) }]
      : []),
  ];
  const rows = history.data?.status === "available" ? history.data.data : [];
  const who = (id: string | null) => complianceOwnerLabel({ ownerUserId: id }, nameOf);

  const onChange = (next: string) => {
    assign.mutate(
      { issueKey, ownerUserId: next === UNASSIGNED_VALUE ? null : next },
      {
        onSuccess: () => toast.success("Owner updated"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Owner could not be updated"),
      },
    );
  };

  return (
    <div className="grid gap-4 px-4 py-3 sm:grid-cols-[280px_minmax(0,1fr)]">
      <div>
        <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Owner</p>
        {writable ? (
          <FilterSelect label="Assign owner" value={value} onChange={onChange} options={options} disabled={assign.isPending} className="mt-1 w-full" />
        ) : (
          <p className="mt-1 text-[14px] leading-[20px] text-adm-ink">{complianceOwnerLabel(current, nameOf)}</p>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Assignment history</p>
        {rows.length === 0 ? (
          <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">No assignments yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {rows.slice(0, 5).map((h) => (
              <li key={h.id} className="truncate text-[13px] leading-[18px] text-adm-ink" title={`${who(h.previousOwnerUserId)} to ${who(h.ownerUserId)} by ${who(h.changedBy)}`}>
                {who(h.previousOwnerUserId)} to {who(h.ownerUserId)}
                <span className="text-adm-muted"> · {who(h.changedBy)} · {formatDateTime(h.changedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ComplianceOwnerDetail;

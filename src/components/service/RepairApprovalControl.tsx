import { toast } from "sonner";
import { StatusText, type Tone } from "@/components/product";
import {
  REPAIR_APPROVALS,
  REPAIR_APPROVAL_HELP,
  REPAIR_APPROVAL_LABEL,
  isRepairApproval,
  repairApprovalLabel,
  type RepairApproval,
  type RepairApprovalRecord,
} from "@/lib/approvedFields/repairApproval";

const TONE: Record<RepairApproval, Tone> = { pending: "neutral", approved: "success", not_approved: "danger" };

export const RepairApprovalControl = ({
  record,
  canSet,
  busy,
  nameOf,
  formatAt,
  onDecide,
}: {
  record: RepairApprovalRecord;
  canSet: boolean;
  busy: boolean;
  nameOf: (userId: string | null) => string;
  formatAt: (iso: string | null) => string;
  onDecide: (decision: RepairApproval) => void;
}) => {
  const decided = record.approval !== "pending" && record.decidedBy ? `${nameOf(record.decidedBy)}, ${formatAt(record.decidedAt)}` : null;
  return (
    <div className="rounded-lg border border-adm-border bg-adm-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] leading-[18px] font-bold uppercase tracking-wide text-adm-muted">Repair approval</span>
        <span className="inline-flex min-w-0 items-center gap-2">
          {decided && <span className="min-w-0 truncate text-[12px] leading-[18px] text-adm-muted" title={decided}>{decided}</span>}
          <StatusText tone={TONE[record.approval]}>{repairApprovalLabel(record.approval)}</StatusText>
        </span>
      </div>
      {canSet && (
        <select
          aria-label="Repair approval"
          value={record.approval}
          disabled={busy}
          onChange={(e) => {
            if (!isRepairApproval(e.target.value)) return;
            onDecide(e.target.value);
          }}
          className="mt-2 h-9 w-full rounded-lg border border-adm-border bg-adm-surface px-2 text-sm disabled:opacity-50 sm:w-60"
        >
          {REPAIR_APPROVALS.map((a) => <option key={a} value={a}>{REPAIR_APPROVAL_LABEL[a]}</option>)}
        </select>
      )}
      <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{REPAIR_APPROVAL_HELP}</p>
    </div>
  );
};

export const notifyRepairApprovalError = (e: unknown) =>
  toast.error(e instanceof Error ? e.message : "Repair approval could not be saved");

export default RepairApprovalControl;

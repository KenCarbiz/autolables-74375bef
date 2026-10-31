import { useId } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  const idBase = useId();
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
        <RadioGroup
          aria-label="Repair approval"
          value={record.approval}
          disabled={busy}
          onValueChange={(v) => {
            if (!isRepairApproval(v)) return;
            onDecide(v);
          }}
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
        >
          {REPAIR_APPROVALS.map((a) => {
            const optionId = `${idBase}-${a}`;
            return (
              <div key={a} className="flex min-h-[32px] items-center gap-1.5">
                <RadioGroupItem id={optionId} value={a} className="h-5 w-5" />
                <Label htmlFor={optionId} className="cursor-pointer text-[14px] leading-[20px] font-normal text-adm-ink">{REPAIR_APPROVAL_LABEL[a]}</Label>
              </div>
            );
          })}
        </RadioGroup>
      )}
      <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{REPAIR_APPROVAL_HELP}</p>
    </div>
  );
};

export const notifyRepairApprovalError = (e: unknown) =>
  toast.error(e instanceof Error ? e.message : "Repair approval could not be saved");

export default RepairApprovalControl;

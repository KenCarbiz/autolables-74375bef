import { AlertTriangle, CheckCircle2, FileText, ScrollText, Signature } from "lucide-react";
import type { InventoryCtMvpStatus } from "@/hooks/useInventoryCtMvpStatus";

type InventoryComplianceChipsProps = {
  status: InventoryCtMvpStatus | null;
  compact?: boolean;
};

const chipBase = "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold";

const InventoryComplianceChips = ({ status, compact = false }: InventoryComplianceChipsProps) => {
  if (!status) {
    return (
      <div className="flex flex-wrap gap-1">
        <span className={`${chipBase} border-slate-200 bg-slate-50 text-slate-600`}><AlertTriangle className="h-3 w-3" /> Not checked</span>
      </div>
    );
  }

  if (status.ready) {
    return (
      <div className="flex flex-wrap gap-1">
        <span className={`${chipBase} border-emerald-200 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" /> Complete</span>
      </div>
    );
  }

  const labels = status.missingLabels.length ? status.missingLabels : ["Compliance evidence"];
  const visible = compact ? labels.slice(0, 2) : labels.slice(0, 4);

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((label) => {
        const lower = label.toLowerCase();
        const Icon = lower.includes("ftc") || lower.includes("buyers") ? FileText : lower.includes("k208") ? ScrollText : lower.includes("sign") ? Signature : AlertTriangle;
        return (
          <span key={label} className={`${chipBase} border-amber-200 bg-amber-50 text-amber-700`}>
            <Icon className="h-3 w-3" /> {label}
          </span>
        );
      })}
      {labels.length > visible.length ? (
        <span className={`${chipBase} border-slate-200 bg-slate-50 text-slate-600`}>+{labels.length - visible.length}</span>
      ) : null}
    </div>
  );
};

export default InventoryComplianceChips;

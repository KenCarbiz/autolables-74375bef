import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react";
import type { InventoryCtMvpStatus } from "@/hooks/useInventoryCtMvpStatus";

export type InventoryCtMvpBadgeProps = {
  status: InventoryCtMvpStatus | null;
  loading?: boolean;
  compact?: boolean;
};

const InventoryCtMvpBadge = ({ status, loading = false, compact = false }: InventoryCtMvpBadgeProps) => {
  if (loading) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[11px] font-bold text-muted-foreground"><CircleDashed className="h-3 w-3 animate-spin" /> CT MVP</span>;
  }

  if (!status) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600"><ShieldCheck className="h-3 w-3" /> {compact ? "Not run" : "CT not run"}</span>;
  }

  if (status.ready) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {compact ? "Certified" : "CT Certified"}</span>;
  }

  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> {status.openIssueCount || 1} issue{(status.openIssueCount || 1) === 1 ? "" : "s"}</span>;
};

export default InventoryCtMvpBadge;

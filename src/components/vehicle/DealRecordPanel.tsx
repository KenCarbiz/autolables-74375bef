import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import { CheckCircle2, MinusCircle, Loader2, FileText, ShieldCheck, Wrench, BookOpen, Send, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

// Deal Record — the used-car manager's one place to see the whole deal: the
// accepted addendum, the K-208 safety inspection, the Get-Ready record, and the
// FTC Buyers Guide, assembled by VIN. "Process this deal" emails the office the
// record and files it. Read-only assembly; Process is the only mutation.

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export default function DealRecordPanel({ vehicle }: { vehicle: { id: string; vin: string; ymm?: string | null } }) {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canProcess = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const { record, loading, reload } = useDealRecord(vehicle.vin, vehicle.id, tenant?.id);
  const [processing, setProcessing] = useState(false);

  if (loading) return <p className="text-body-sm text-muted-foreground">Loading deal record…</p>;
  if (!record) return <p className="text-body-sm text-muted-foreground">No deal record yet for this vehicle.</p>;

  const s = dealDocStatus(record);
  const processed = !!record.processedAt;

  const process = async () => {
    if (!tenant?.id) return;
    setProcessing(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("process-deal", { body: { tenant_id: tenant.id, vin: vehicle.vin } });
      if (error || !data?.ok) {
        toast.error(data?.error === "not_ready" ? "Finish the required documents before filing." : "Couldn't process the deal");
        return;
      }
      if (data.already_processed) toast.message("This deal was already filed.");
      else if (data.emailed) toast.success("Deal filed and emailed to the office");
      else if (data.error === "no_recipient") toast.message("Deal filed. Add a deal-desk or office email in Settings to auto-send it.");
      else toast.success("Deal filed");
      await reload();
    } finally {
      setProcessing(false);
    }
  };

  const rows: { key: string; label: string; icon: typeof FileText; done: boolean; note?: string; onClick?: () => void; show: boolean }[] = [
    { key: "addendum", label: "Signed addendum", icon: FileText, done: s.addendum, note: record.addendum?.acceptedAt ? `Accepted ${fmt(record.addendum.acceptedAt)}` : "Not accepted yet", onClick: record.addendum ? () => navigate(`/addendum?id=${record.addendum!.id}`) : undefined, show: true },
    { key: "k208", label: "Safety inspection (K-208)", icon: ShieldCheck, done: s.k208, note: record.k208 ? `${record.k208.result || "signed"} · ${fmt(record.k208.signedAt)}` : "Not signed", onClick: record.k208 ? () => navigate(`/k208/${vehicle.vin}`) : undefined, show: record.isUsed },
    { key: "getReady", label: "Get-Ready record", icon: Wrench, done: s.getReady, note: record.getReady?.completeDate ? `Completed ${fmt(record.getReady.completeDate)}` : (record.getReady?.detailSigned ? "Detail signed off" : "In progress"), show: true },
    { key: "buyersGuide", label: "FTC Buyers Guide", icon: BookOpen, done: s.buyersGuide, note: record.buyersGuide ? (s.buyersGuide ? "Published" : `Draft · confirm & publish${record.buyersGuide.box ? ` (${record.buyersGuide.box})` : ""}`) : "Not generated", onClick: () => navigate(`/buyers-guide?vehicleId=${vehicle.id}`), show: record.isUsed },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">Deal record</h2>
          <p className="text-body-sm text-muted-foreground">Every document for this sale, assembled by VIN<span className="font-mono ml-1">{vehicle.vin}</span>.</p>
        </div>
        {processed ? (
          <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-emerald-50 text-emerald-700 text-sm font-semibold border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" /> Filed {fmt(record.processedAt)}
          </span>
        ) : canProcess ? (
          <button
            onClick={process}
            disabled={processing || !s.complete}
            title={s.complete ? "Email the office the deal record and file it" : "All required documents must be complete first"}
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Process this deal
          </button>
        ) : null}
      </div>

      {!processed && !s.complete && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
          Finish the missing documents below before filing the deal.
        </div>
      )}

      <div className="space-y-2">
        {rows.filter((r) => r.show).map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${r.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-semibold text-foreground">{r.label}</p>
                <p className="text-caption text-muted-foreground truncate">{r.note}</p>
              </div>
              {r.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <MinusCircle className="w-4 h-4 text-slate-300 flex-shrink-0" />}
              {r.onClick && (
                <button onClick={r.onClick} className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1 hover:bg-muted flex-shrink-0">
                  Open <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStaleQueue, resolveFlag, type StaleFlag } from "@/lib/stickerStudio/useStaleFlags";
import { useAuth } from "@/contexts/AuthContext";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowLeft, FileWarning, ExternalLink, Check, EyeOff, RefreshCw, Printer } from "lucide-react";
import { toast } from "sonner";

const sevMeta: Record<StaleFlag["severity"], { tone: string; label: string }> = {
  compliance_block: { tone: "border-rose-200 bg-rose-50 text-rose-700", label: "Compliance block" },
  warning: { tone: "border-amber-200 bg-amber-50 text-amber-700", label: "Warning" },
  info: { tone: "border-slate-200 bg-slate-50 text-slate-600", label: "Info" },
};
const fmtVal = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : String(v ?? "—"));

// Manager review queue for stickers/addendums that may be stale due to
// inventory/pricing changes. /dashboard/document-review.
const DocumentReview = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { flags, loading, available, reload } = useStaleQueue();

  const [queueing, setQueueing] = useState<string | null>(null);

  const act = async (flag: StaleFlag, status: StaleFlag["status"], successMessage?: string) => {
    const ok = await resolveFlag(flag.id, status, user?.id);
    if (ok) {
      await logStickerAudit("stale_flag_" + status, { tenantId: tenant?.id, entityType: "generated_document", entityId: flag.generated_document_id || flag.vehicle_id, details: { field: flag.changed_field, severity: flag.severity } });
      toast.success(successMessage || `Marked ${status}`);
      reload();
    } else toast.error("Action failed");
  };

  // Resolving a price-change flag usually means the sticker must be
  // reprinted — queue the VIN into the Print department (vin_queue) so the
  // review queue hands off to the print queue instead of dead-ending.
  const queueReprint = async (flag: StaleFlag) => {
    setQueueing(flag.id);
    try {
      const { data: veh } = await (supabase as any)
        .from("vehicle_listings")
        .select("vin, mileage")
        .eq("id", flag.vehicle_id)
        .maybeSingle();
      if (!veh?.vin) { toast.error("Couldn't find the vehicle for this flag."); return; }
      const { error } = await (supabase as any).from("vin_queue").insert({
        vin: String(veh.vin).toUpperCase(),
        stock_number: "",
        mileage: veh.mileage != null ? String(veh.mileage) : "",
        notes: `Reprint — ${flag.changed_field || "vehicle data"} changed`,
        status: "queued",
      });
      if (error) { toast.error("Couldn't queue the reprint."); return; }
      await act(flag, "resolved", "Reprint queued and flag resolved");
    } finally {
      setQueueing(null);
    }
  };

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading review queue…</p>;

  return (
    <div className="p-4 lg:p-6 max-w-[1000px] mx-auto space-y-4">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2"><FileWarning className="w-5 h-5 text-primary" /> Document review queue</h1>
        <p className="text-xs text-muted-foreground mt-1">Stickers and addendums that may be stale because the vehicle's price, MSRP, or details changed after they were generated.</p>
      </div>

      {!available ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <FileWarning className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Review queue not available yet</p>
          <p className="text-xs text-muted-foreground mt-1">Apply migration <span className="font-mono">20260620140000_stale_document_flags.sql</span> to enable stale-document review.</p>
        </div>
      ) : flags.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <Check className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-800">All clear</p>
          <p className="text-xs text-emerald-700 mt-1">No documents need review right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-end"><button onClick={reload} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh</button></div>
          {flags.map((f) => {
            const m = sevMeta[f.severity];
            return (
              <div key={f.id} className={`rounded-xl border p-3 ${m.tone}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-wide">{m.label}</span>
                      {f.changed_field && <span className="text-[10px] font-mono opacity-70">{f.changed_field}</span>}
                    </div>
                    <p className="text-sm font-semibold mt-1">{f.reason}</p>
                    <p className="text-[11px] opacity-80">Sticker: {fmtVal(f.old_value)} · Now: {fmtVal(f.new_value)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => navigate(`/vehicle-file/${f.vehicle_id}?tab=labels`)} className="h-7 px-2.5 rounded-md bg-white/70 border border-current/20 text-[11px] font-semibold inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open vehicle</button>
                    <button onClick={() => queueReprint(f)} disabled={queueing === f.id} className="h-7 px-2.5 rounded-md bg-white/70 border border-current/20 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"><Printer className="w-3 h-3" /> Queue reprint</button>
                    <button onClick={() => act(f, "resolved")} className="h-7 px-2.5 rounded-md bg-white/70 border border-current/20 text-[11px] font-semibold inline-flex items-center gap-1"><Check className="w-3 h-3" /> Resolve</button>
                    <button onClick={() => act(f, "ignored")} className="h-7 px-2.5 rounded-md bg-white/70 border border-current/20 text-[11px] font-semibold inline-flex items-center gap-1"><EyeOff className="w-3 h-3" /> Ignore</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DocumentReview;

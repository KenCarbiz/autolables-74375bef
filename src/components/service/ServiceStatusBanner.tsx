import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deriveServiceStatus, type ServiceStatus, type Tone } from "@/lib/service/serviceStatus";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, Wrench, ChevronRight } from "lucide-react";

// The one strong status banner at the top of a vehicle's service workspace —
// reads the SAME derivation as the queue, so the desktop and the QR landing can
// never disagree. Shows the overall service state + the single required action.

const TONE: Record<Tone, { bg: string; text: string; Icon: typeof Clock }> = {
  slate: { bg: "bg-slate-100 border-slate-200", text: "text-slate-700", Icon: Clock },
  amber: { bg: "bg-amber-50 border-amber-200", text: "text-amber-800", Icon: Wrench },
  red: { bg: "bg-red-50 border-red-200", text: "text-red-800", Icon: AlertTriangle },
  blue: { bg: "bg-blue-50 border-blue-200", text: "text-blue-800", Icon: ShieldCheck },
  emerald: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", Icon: CheckCircle2 },
};

export default function ServiceStatusBanner({ tenantId, veh }: { tenantId: string; veh: { id: string; vin: string; ymm: string | null } }) {
  const [st, setSt] = useState<ServiceStatus | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const [grRes, siRes, srRes, listRes] = await Promise.all([
        (supabase as any).from("get_ready_records").select("status, items, get_ready_complete_date").eq("tenant_id", tenantId).eq("vin", veh.vin).limit(1).maybeSingle(),
        (supabase as any).from("safety_inspections").select("result, licensee_certified_at").eq("tenant_id", tenantId).eq("vin", veh.vin).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
        (supabase as any).from("service_requests").select("id").eq("tenant_id", tenantId).eq("vin", veh.vin).eq("status", "pending").limit(1),
        (supabase as any).from("vehicle_listings").select("status, recall_status").eq("id", veh.id).maybeSingle(),
      ]);
      if (off) return;
      const awaiting = Array.isArray(srRes.data) && srRes.data.length > 0;
      setSt(deriveServiceStatus(listRes.data || {}, grRes.data, siRes.data, awaiting));
    })();
    return () => { off = true; };
  }, [tenantId, veh.id, veh.vin]);

  if (!st) return <div className="h-[68px] rounded-2xl border border-border bg-card animate-pulse" />;
  const t = TONE[st.tone];
  const scrollToK208 = () => document.getElementById("k208-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className={`rounded-2xl border p-4 flex items-center justify-between gap-3 flex-wrap ${t.bg}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-11 h-11 rounded-xl bg-white/70 grid place-items-center ${t.text}`}><t.Icon className="w-5 h-5" /></span>
        <div className="min-w-0">
          <p className={`text-[15px] font-bold leading-tight ${t.text}`}>{st.bannerLabel}</p>
          <p className="text-caption text-muted-foreground">Next: {st.nextLabel}</p>
        </div>
      </div>
      {st.bannerKey !== "cleared" && (
        <button onClick={scrollToK208} className={`h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 ${st.nextTone === "danger" ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"}`}>
          {st.nextLabel} <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

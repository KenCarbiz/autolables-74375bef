import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type CertificationCheck = {
  key: string;
  label: string;
  status: "pass" | "fail" | "warning" | "skip";
  detail: string;
};

type CertificationRun = {
  id: string;
  ready: boolean;
  vehicle_title: string | null;
  vin: string | null;
  stock: string | null;
  required_document_keys: string[] | null;
  checks: CertificationCheck[] | null;
  certified_at: string;
  source: string | null;
};

export type VehicleCtMvpStatusCardProps = {
  tenantId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  compact?: boolean;
};

const statusTone = (ready: boolean) => ready
  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
  : "border-amber-200 bg-amber-50 text-amber-800";

const loadLatestCertification = async ({ tenantId, vehicleId, vin }: VehicleCtMvpStatusCardProps) => {
  if (!tenantId || (!vehicleId && !vin)) return null;
  let query = (supabase as any)
    .from("ct_mvp_certification_runs")
    .select("id,ready,vehicle_title,vin,stock,required_document_keys,checks,certified_at,source")
    .eq("tenant_id", tenantId)
    .order("certified_at", { ascending: false })
    .limit(1);

  if (vehicleId && vin) query = query.or(`vehicle_id.eq.${vehicleId},vin.eq.${vin}`);
  else if (vehicleId) query = query.eq("vehicle_id", vehicleId);
  else query = query.eq("vin", vin);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data || null) as CertificationRun | null;
};

const VehicleCtMvpStatusCard = ({ tenantId, vehicleId, vin, compact = false }: VehicleCtMvpStatusCardProps) => {
  const [run, setRun] = useState<CertificationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRun(await loadLatestCertification({ tenantId, vehicleId, vin }));
    } catch (err) {
      console.error(err);
      setError("Could not load CT MVP status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenantId, vehicleId, vin]);

  const failingChecks = useMemo(() => {
    const checks = Array.isArray(run?.checks) ? run?.checks || [] : [];
    return checks.filter((check) => check.status !== "pass");
  }, [run?.checks]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading CT MVP status…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
        {error}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold text-foreground">CT MVP not certified yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the smoke test or production certification workflow to create a vehicle-level certification record.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${statusTone(run.ready)}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          {run.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em]">CT MVP Status</p>
            <h3 className="mt-1 text-base font-black text-slate-950">
              {run.ready ? "Certified" : "Needs attention"}
            </h3>
            <p className="mt-1 text-xs text-slate-700">
              Last checked {new Date(run.certified_at).toLocaleString()}{run.source ? ` · ${run.source}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white/80 px-3 text-xs font-bold text-slate-800 hover:bg-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-white/80 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Required documents</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{(run.required_document_keys || []).join(", ") || "—"}</p>
          </div>
          <div className="rounded-xl bg-white/80 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Open checks</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{failingChecks.length ? `${failingChecks.length} issue(s)` : "All checks passed"}</p>
          </div>
        </div>
      ) : null}

      {!compact && failingChecks.length > 0 ? (
        <div className="mt-3 space-y-2">
          {failingChecks.slice(0, 4).map((check) => (
            <div key={check.key} className="flex items-start gap-2 rounded-xl bg-white/80 p-3">
              <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold text-slate-950">{check.label}</p>
                <p className="text-xs text-slate-700">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default VehicleCtMvpStatusCard;

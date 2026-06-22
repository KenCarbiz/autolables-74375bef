import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

type CertificationRun = {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_title: string | null;
  ready: boolean;
  required_document_keys: string[] | null;
  checks: Array<{ key: string; label: string; status: "pass" | "fail" | "warning"; detail: string }> | null;
  certified_at: string;
  source: string | null;
};

const statusClass = (ready: boolean) => ready
  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
  : "border-amber-200 bg-amber-50 text-amber-800";

const AdminCertificationHistory = () => {
  const { tenant } = useTenant();
  const [runs, setRuns] = useState<CertificationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    if (!tenant?.id || tenant.id === "house") {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await (supabase as any)
        .from("ct_mvp_certification_runs")
        .select("id,tenant_id,vehicle_id,vin,stock,vehicle_title,ready,required_document_keys,checks,certified_at,source")
        .eq("tenant_id", tenant.id)
        .order("certified_at", { ascending: false })
        .limit(100);
      if (dbError) throw dbError;
      setRuns((data || []) as CertificationRun[]);
    } catch (err) {
      console.error(err);
      setError("Could not load certification history. Confirm the CT MVP migrations are deployed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenant?.id]);

  const totals = useMemo(() => ({
    total: runs.length,
    ready: runs.filter((run) => run.ready).length,
    blocked: runs.filter((run) => !run.ready).length,
  }), [runs]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <ShieldCheck className="h-3.5 w-3.5" /> CT MVP Certification
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Certification History</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review saved Ready / Not Ready runs, required documents, and pass/fail checks for Connecticut MVP evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Runs</p><p className="mt-1 text-2xl font-black">{totals.total}</p></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Ready</p><p className="mt-1 text-2xl font-black text-emerald-900">{totals.ready}</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-amber-800">Blocked</p><p className="mt-1 text-2xl font-black text-amber-900">{totals.blocked}</p></div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Recent certification runs</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading certification history…</div>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-center">
            <div>
              <p className="text-sm font-semibold text-foreground">No saved certification runs yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Run `/admin/smoke-test` and click Save Evidence to create history.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((run) => {
              const checks = Array.isArray(run.checks) ? run.checks : [];
              const failures = checks.filter((check) => check.status !== "pass");
              const isOpen = expanded === run.id;
              return (
                <div key={run.id} className="p-4">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : run.id)} className="flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(run.ready)}`}>
                          {run.ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {run.ready ? "Ready" : "Not Ready"}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground">{new Date(run.certified_at).toLocaleString()}</span>
                        {run.source ? <span className="text-xs text-muted-foreground">· {run.source}</span> : null}
                      </div>
                      <h3 className="mt-2 truncate text-base font-bold text-foreground">{run.vehicle_title || "Vehicle certification"}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">VIN {run.vin || "—"} · Stock {run.stock || "—"}</p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Required docs</p>
                      <p className="mt-1 max-w-xl text-sm font-semibold text-foreground">{(run.required_document_keys || []).join(", ") || "—"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{failures.length ? `${failures.length} warning/failure check(s)` : "All checks passed"}</p>
                    </div>
                  </button>
                  {isOpen ? (
                    <div className="mt-4 grid gap-2">
                      {checks.map((check) => (
                        <div key={check.key} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                          {check.status === "pass" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                          <div>
                            <p className="text-sm font-semibold text-foreground">{check.label}</p>
                            <p className="text-xs text-muted-foreground">{check.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCertificationHistory;

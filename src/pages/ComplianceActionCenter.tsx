import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileText, RefreshCw, ScrollText, Search, ShieldCheck, Signature } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import UsedVehicleDocsButton from "@/components/inventory/UsedVehicleDocsButton";

type IssueFilter = "all" | "missing_ftc" | "missing_k208" | "missing_signature" | "ready" | "needs_review";

type CertificationCheck = {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
  detail?: string;
};

type CertificationRow = {
  id: string;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_title: string | null;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string;
};

const issueText = (check: CertificationCheck) => `${check.key || ""} ${check.label || ""} ${check.detail || ""}`.toLowerCase();
const isOpenIssue = (check: CertificationCheck) => !!check.status && check.status !== "pass" && check.status !== "skip";
const hasTerm = (row: CertificationRow, terms: string[]) => (row.checks || []).some((check) => isOpenIssue(check) && terms.some((term) => issueText(check).includes(term)));

const filterLabels: Record<IssueFilter, string> = {
  all: "All Runs",
  missing_ftc: "Missing FTC",
  missing_k208: "Missing K208",
  missing_signature: "Missing Signatures",
  ready: "Certified",
  needs_review: "Needs Review",
};

const filterIcon: Record<IssueFilter, typeof ShieldCheck> = {
  all: ShieldCheck,
  missing_ftc: FileText,
  missing_k208: ScrollText,
  missing_signature: Signature,
  ready: CheckCircle2,
  needs_review: AlertTriangle,
};

const issueFilters: IssueFilter[] = ["needs_review", "missing_ftc", "missing_k208", "missing_signature", "ready", "all"];

const formatDate = (value?: string | null) => {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); }
  catch { return value; }
};

const ComplianceActionCenter = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { tenant } = useTenant();
  const [rows, setRows] = useState<CertificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const activeFilter = (params.get("filter") || "needs_review") as IssueFilter;

  const load = async () => {
    if (!tenant?.id || tenant.id === "house") {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("ct_mvp_certification_runs")
        .select("id,vehicle_id,vin,stock,vehicle_title,ready,checks,certified_at")
        .eq("tenant_id", tenant.id)
        .order("certified_at", { ascending: false })
        .limit(750);
      if (error) throw error;
      setRows((data || []) as CertificationRow[]);
    } catch (err) {
      console.error(err);
      toast.error("Could not load compliance action center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);

  const latestByVehicle = useMemo(() => {
    const seen = new Set<string>();
    const latest: CertificationRow[] = [];
    for (const row of rows) {
      const key = row.vehicle_id || row.vin || row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(row);
    }
    return latest;
  }, [rows]);

  const counts = useMemo(() => ({
    all: latestByVehicle.length,
    ready: latestByVehicle.filter((row) => !!row.ready).length,
    needs_review: latestByVehicle.filter((row) => !row.ready).length,
    missing_ftc: latestByVehicle.filter((row) => hasTerm(row, ["ftc", "buyers guide", "buyer guide"])).length,
    missing_k208: latestByVehicle.filter((row) => hasTerm(row, ["k208", "warranty"])).length,
    missing_signature: latestByVehicle.filter((row) => hasTerm(row, ["signature", "signed", "signing"])).length,
  }), [latestByVehicle]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return latestByVehicle.filter((row) => {
      if (activeFilter === "ready" && !row.ready) return false;
      if (activeFilter === "needs_review" && row.ready) return false;
      if (activeFilter === "missing_ftc" && !hasTerm(row, ["ftc", "buyers guide", "buyer guide"])) return false;
      if (activeFilter === "missing_k208" && !hasTerm(row, ["k208", "warranty"])) return false;
      if (activeFilter === "missing_signature" && !hasTerm(row, ["signature", "signed", "signing"])) return false;
      if (!needle) return true;
      return [row.vehicle_title, row.vin, row.stock].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [latestByVehicle, activeFilter, q]);

  const setFilter = (filter: IssueFilter) => {
    const next = new URLSearchParams(params);
    next.set("filter", filter);
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"><ShieldCheck className="h-3.5 w-3.5" /> Manager Action Center</div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground">Compliance Action Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Find vehicles missing FTC Buyers Guides, K208 warranty worksheets, signatures, or other CT MVP evidence.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {issueFilters.map((filter) => {
          const Icon = filterIcon[filter];
          const active = activeFilter === filter;
          return (
            <button key={filter} onClick={() => setFilter(filter)} className={`rounded-2xl border p-4 text-left transition ${active ? "border-blue-500 bg-blue-50 shadow-sm" : "border-border bg-card hover:bg-muted/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <Icon className={`h-4 w-4 ${active ? "text-blue-700" : "text-muted-foreground"}`} />
                <span className="text-2xl font-black tabular-nums text-foreground">{counts[filter]}</span>
              </div>
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{filterLabels[filter]}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock, VIN, vehicle…" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Showing {filtered.length} of {latestByVehicle.length} vehicles</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Vehicle</th>
              <th className="px-3 py-3 text-left font-semibold">Stock / VIN</th>
              <th className="px-3 py-3 text-left font-semibold">Status</th>
              <th className="px-3 py-3 text-left font-semibold">Open Issues</th>
              <th className="px-3 py-3 text-left font-semibold">Last Run</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">Loading compliance issues…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No vehicles match this filter.</td></tr>
            ) : filtered.map((row) => {
              const issues = (row.checks || []).filter(isOpenIssue);
              return (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3"><p className="font-bold text-foreground">{row.vehicle_title || "Vehicle"}</p></td>
                  <td className="px-3 py-3"><p className="font-mono text-xs text-foreground">{row.stock || "—"}</p><p className="font-mono text-[11px] text-muted-foreground">{row.vin || "—"}</p></td>
                  <td className="px-3 py-3">{row.ready ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Certified</span> : <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> Needs review</span>}</td>
                  <td className="px-3 py-3"><div className="flex max-w-[360px] flex-wrap gap-1">{issues.length ? issues.slice(0, 4).map((issue) => <span key={`${issue.key}-${issue.label}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">{issue.label || issue.key || "Issue"}</span>) : <span className="text-xs text-muted-foreground">None</span>}{issues.length > 4 ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">+{issues.length - 4}</span> : null}</div></td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{formatDate(row.certified_at)}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2"><UsedVehicleDocsButton vehicleId={row.vehicle_id || row.id} vin={row.vin} condition="used" /><button onClick={() => row.vehicle_id ? navigate(`/vehicle-file/${row.vehicle_id}`) : null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-bold hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" /> Open</button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComplianceActionCenter;

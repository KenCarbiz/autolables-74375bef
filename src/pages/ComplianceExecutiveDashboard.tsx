import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, ExternalLink, Inbox, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";

type CertificationCheck = {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
};

type CertificationRunRow = {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_title: string | null;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string | null;
};

type DigestRow = {
  id: string;
  status: "queued" | "sent" | "failed" | "dismissed";
  created_at: string;
};

const openIssueChecks = (row: CertificationRunRow) =>
  (Array.isArray(row.checks) ? row.checks : []).filter((check) => !!check.status && check.status !== "pass" && check.status !== "skip");

const issueText = (checks: CertificationCheck[]) => checks.map((check) => `${check.key || ""} ${check.label || ""}`.toLowerCase()).join(" ");

const latestRows = (rows: CertificationRunRow[]) => {
  const seen = new Set<string>();
  const latest: CertificationRunRow[] = [];
  for (const row of rows) {
    const key = row.vehicle_id || row.vin || row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest;
};

const pct = (value: number, total: number) => total ? Math.round((value / total) * 100) : 0;
const fmt = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "—";

const ComplianceExecutiveDashboard = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [runs, setRuns] = useState<CertificationRunRow[]>([]);
  const [digests, setDigests] = useState<DigestRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!tenant?.id || tenant.id === "house") {
      setRuns([]);
      setDigests([]);
      return;
    }

    setLoading(true);
    try {
      const [runsResult, digestResult] = await Promise.all([
        (supabase as any)
          .from("ct_mvp_certification_runs")
          .select("id,tenant_id,vehicle_id,vin,stock,vehicle_title,ready,checks,certified_at")
          .eq("tenant_id", tenant.id)
          .order("certified_at", { ascending: false })
          .limit(1000),
        (supabase as any)
          .from("ct_mvp_compliance_digest_outbox")
          .select("id,status,created_at")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (runsResult.error) throw runsResult.error;
      if (digestResult.error) throw digestResult.error;

      setRuns((runsResult.data || []) as CertificationRunRow[]);
      setDigests((digestResult.data || []) as DigestRow[]);
    } catch (err) {
      console.error(err);
      toast.error("Could not load executive compliance dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);

  const latest = useMemo(() => latestRows(runs), [runs]);

  const stats = useMemo(() => {
    const total = latest.length;
    const certified = latest.filter((row) => !!row.ready).length;
    const needsReview = total - certified;
    const missingFtc = latest.filter((row) => issueText(openIssueChecks(row)).includes("ftc") || issueText(openIssueChecks(row)).includes("buyers guide")).length;
    const missingK208 = latest.filter((row) => issueText(openIssueChecks(row)).includes("k208") || issueText(openIssueChecks(row)).includes("warranty")).length;
    const missingSignature = latest.filter((row) => issueText(openIssueChecks(row)).includes("signature") || issueText(openIssueChecks(row)).includes("signing")).length;
    const sentDigests = digests.filter((row) => row.status === "sent").length;
    const failedDigests = digests.filter((row) => row.status === "failed").length;

    return {
      total,
      certified,
      needsReview,
      missingFtc,
      missingK208,
      missingSignature,
      certificationRate: pct(certified, total),
      sentDigests,
      failedDigests,
      queuedDigests: digests.filter((row) => row.status === "queued").length,
      digestSuccessRate: pct(sentDigests, sentDigests + failedDigests),
    };
  }, [latest, digests]);

  const problemVehicles = useMemo(() => latest
    .filter((row) => !row.ready || openIssueChecks(row).length > 0)
    .slice(0, 15), [latest]);

  const scoreTone = stats.certificationRate >= 95 ? "emerald" : stats.certificationRate >= 85 ? "amber" : "rose";
  const scoreClass = scoreTone === "emerald"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : scoreTone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"><BarChart3 className="h-3.5 w-3.5" /> Executive Compliance</div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground">CT MVP Executive Dashboard</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Leadership view for certification rate, open compliance exposure, digest delivery health, and priority vehicles.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate("/compliance-center?filter=needs_review")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><ExternalLink className="h-4 w-4" /> Action Center</button>
          <button onClick={() => navigate("/compliance-inbox")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted"><Inbox className="h-4 w-4" /> Inbox</button>
          <button onClick={load} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className={`rounded-2xl border p-5 ${scoreClass}`}>
          <div className="flex items-center justify-between gap-3"><ShieldCheck className="h-7 w-7" /><span className="text-4xl font-black tabular-nums">{stats.certificationRate}%</span></div>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide">Certification Rate</p>
          <p className="mt-1 text-xs opacity-80">{stats.certified} of {stats.total} latest vehicle checks certified.</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-700"><CheckCircle2 className="mb-3 h-5 w-5" /><p className="text-3xl font-black">{stats.certified}</p><p className="text-xs font-bold uppercase">Certified</p></div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-700"><AlertTriangle className="mb-3 h-5 w-5" /><p className="text-3xl font-black">{stats.needsReview}</p><p className="text-xs font-bold uppercase">Needs Review</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-700"><TrendingUp className="mb-3 h-5 w-5" /><p className="text-3xl font-black">{stats.digestSuccessRate}%</p><p className="text-xs font-bold uppercase">Digest Success</p></div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700"><AlertTriangle className="mb-3 h-5 w-5" /><p className="text-3xl font-black">{stats.failedDigests}</p><p className="text-xs font-bold uppercase">Failed Digests</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Missing FTC</p><p className="mt-2 text-4xl font-black text-amber-600">{stats.missingFtc}</p><button onClick={() => navigate("/compliance-center?filter=missing_ftc")} className="mt-3 text-xs font-bold text-blue-600 hover:underline">Open FTC work queue</button></div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Missing K208</p><p className="mt-2 text-4xl font-black text-amber-600">{stats.missingK208}</p><button onClick={() => navigate("/compliance-center?filter=missing_k208")} className="mt-3 text-xs font-bold text-blue-600 hover:underline">Open K208 work queue</button></div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Missing Signatures</p><p className="mt-2 text-4xl font-black text-rose-600">{stats.missingSignature}</p><button onClick={() => navigate("/compliance-center?filter=missing_signature")} className="mt-3 text-xs font-bold text-blue-600 hover:underline">Open signature work queue</button></div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div><h2 className="font-black text-foreground">Priority Vehicles</h2><p className="text-xs text-muted-foreground">Top vehicles currently blocking CT MVP certification.</p></div>
          <button onClick={() => navigate("/compliance-center?filter=needs_review")} className="text-xs font-bold text-blue-600 hover:underline">View all</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3 text-left">Stock</th><th className="px-4 py-3 text-left">Vehicle</th><th className="px-4 py-3 text-left">VIN</th><th className="px-4 py-3 text-left">Issues</th><th className="px-4 py-3 text-left">Last Run</th></tr></thead>
            <tbody className="divide-y divide-border">
              {problemVehicles.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No priority vehicles found.</td></tr>
              ) : problemVehicles.map((row) => {
                const labels = openIssueChecks(row).map((check) => check.label || check.key || "Compliance issue");
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{row.stock || "—"}</td>
                    <td className="px-4 py-3 font-bold">{row.vehicle_title || "Vehicle"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.vin || "—"}</td>
                    <td className="px-4 py-3 text-xs">{labels.join(", ") || "Needs review"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(row.certified_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ComplianceExecutiveDashboard;

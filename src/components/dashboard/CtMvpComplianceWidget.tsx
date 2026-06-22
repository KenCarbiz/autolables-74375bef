import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, ScrollText, ShieldCheck, Signature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type CertificationCheck = {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
};

type RunRow = {
  id: string;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string;
};

type CtMvpComplianceWidgetProps = {
  tenantId?: string | null;
  title?: string;
};

const hasIssue = (row: RunRow, terms: string[]) => {
  const checks = Array.isArray(row.checks) ? row.checks : [];
  return checks.some((check) => {
    if (!check.status || check.status === "pass" || check.status === "skip") return false;
    const text = `${check.key || ""} ${check.label || ""}`.toLowerCase();
    return terms.some((term) => text.includes(term));
  });
};

const Stat = ({ icon: Icon, label, value, tone = "slate" }: { icon: typeof ShieldCheck; label: string; value: number; tone?: "emerald" | "amber" | "rose" | "blue" | "slate" }) => {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  } as const;

  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <Icon className="h-4 w-4" />
        <span className="text-xl font-black tabular-nums">{value}</span>
      </div>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide">{label}</p>
    </div>
  );
};

const CtMvpComplianceWidget = ({ tenantId, title = "CT MVP Compliance" }: CtMvpComplianceWidgetProps) => {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!tenantId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("ct_mvp_certification_runs")
        .select("id,ready,checks,certified_at")
        .eq("tenant_id", tenantId)
        .order("certified_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as RunRow[]);
    } catch (err) {
      console.warn("Could not load CT MVP dashboard widget", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const stats = useMemo(() => {
    const certified = rows.filter((row) => !!row.ready).length;
    const needsReview = rows.filter((row) => !row.ready).length;
    return {
      certified,
      needsReview,
      missingFtc: rows.filter((row) => hasIssue(row, ["ftc", "buyers guide", "buyer guide"])).length,
      missingK208: rows.filter((row) => hasIssue(row, ["k208", "warranty"])).length,
      missingSignatures: rows.filter((row) => hasIssue(row, ["signature", "signed", "signing"])).length,
    };
  }, [rows]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Compliance
          </div>
          <h2 className="mt-2 text-lg font-black text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">Latest certification run summary across inventory.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold hover:bg-muted disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={CheckCircle2} label="Certified" value={stats.certified} tone="emerald" />
        <Stat icon={FileText} label="Missing FTC" value={stats.missingFtc} tone="amber" />
        <Stat icon={ScrollText} label="Missing K208" value={stats.missingK208} tone="amber" />
        <Stat icon={Signature} label="Missing signatures" value={stats.missingSignatures} tone="rose" />
        <Stat icon={AlertTriangle} label="Needs review" value={stats.needsReview} tone="blue" />
      </div>
    </section>
  );
};

export default CtMvpComplianceWidget;

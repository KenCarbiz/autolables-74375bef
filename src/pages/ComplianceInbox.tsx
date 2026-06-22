import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Inbox, MailCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";

type DigestOutboxRow = {
  id: string;
  tenant_id: string;
  subject: string;
  summary_text: string;
  digest: {
    totalVehicles?: number;
    certifiedVehicles?: number;
    needsReview?: number;
    missingFtc?: number;
    missingK208?: number;
    missingSignatures?: number;
    vehicles?: Array<{
      vehicleId?: string | null;
      vin?: string | null;
      stock?: string | null;
      vehicleTitle?: string | null;
      labels?: string[];
      issues?: string[];
    }>;
  } | null;
  status: "queued" | "sent" | "failed" | "dismissed";
  channel: "manager_digest" | "email" | "in_app";
  recipient_email: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
};

const fmt = (value?: string | null) => {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); }
  catch { return value; }
};

const statusStyle: Record<DigestOutboxRow["status"], string> = {
  queued: "border-blue-200 bg-blue-50 text-blue-700",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  dismissed: "border-slate-200 bg-slate-50 text-slate-600",
};

const ComplianceInbox = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [rows, setRows] = useState<DigestOutboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = async () => {
    if (!tenant?.id || tenant.id === "house") {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("ct_mvp_compliance_digest_outbox")
        .select("id,tenant_id,subject,summary_text,digest,status,channel,recipient_email,sent_at,error,created_at")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setRows((data || []) as DigestOutboxRow[]);
    } catch (err) {
      console.error(err);
      toast.error("Could not load compliance inbox");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);

  const active = useMemo(() => rows.find((row) => row.id === activeId) || rows[0] || null, [rows, activeId]);
  const counts = useMemo(() => ({
    queued: rows.filter((row) => row.status === "queued").length,
    sent: rows.filter((row) => row.status === "sent").length,
    failed: rows.filter((row) => row.status === "failed").length,
  }), [rows]);

  const dismiss = async (row: DigestOutboxRow) => {
    try {
      const { error } = await (supabase as any)
        .from("ct_mvp_compliance_digest_outbox")
        .update({ status: "dismissed" })
        .eq("id", row.id);
      if (error) throw error;
      toast.success("Digest dismissed");
      await load();
    } catch (err) {
      console.error(err);
      toast.error("Could not dismiss digest");
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"><Inbox className="h-3.5 w-3.5" /> Compliance Inbox</div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground">Manager Compliance Inbox</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Review queued, sent, failed, and dismissed CT MVP compliance digests for this dealership.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate("/compliance-center?filter=needs_review")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><ExternalLink className="h-4 w-4" /> Action Center</button>
          <button onClick={load} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-700"><p className="text-2xl font-black tabular-nums">{counts.queued}</p><p className="text-xs font-bold uppercase tracking-wide">Queued</p></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"><p className="text-2xl font-black tabular-nums">{counts.sent}</p><p className="text-xs font-bold uppercase tracking-wide">Sent</p></div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700"><p className="text-2xl font-black tabular-nums">{counts.failed}</p><p className="text-xs font-bold uppercase tracking-wide">Failed</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Digest History</div>
          <div className="max-h-[680px] overflow-y-auto divide-y divide-border">
            {loading ? <p className="p-6 text-sm text-muted-foreground">Loading inbox…</p> : rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No digest records yet.</p> : rows.map((row) => (
              <button key={row.id} onClick={() => setActiveId(row.id)} className={`w-full p-4 text-left hover:bg-muted/40 ${active?.id === row.id ? "bg-blue-50/70" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{row.subject}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{fmt(row.created_at)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusStyle[row.status]}`}>{row.status}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{row.summary_text}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {!active ? (
            <div className="py-20 text-center text-muted-foreground"><MailCheck className="mx-auto mb-3 h-8 w-8" /><p>No digest selected.</p></div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700"><ShieldCheck className="h-3.5 w-3.5" /> CT MVP Digest</div>
                  <h2 className="mt-3 text-xl font-black text-foreground">{active.subject}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Created {fmt(active.created_at)}{active.sent_at ? ` · Sent ${fmt(active.sent_at)}` : ""}</p>
                  {active.error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm font-semibold text-rose-700"><AlertTriangle className="mr-1 inline h-4 w-4" /> {active.error}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => navigate("/compliance-center?filter=needs_review")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"><ExternalLink className="h-3.5 w-3.5" /> Open Action Center</button>
                  {active.status !== "dismissed" ? <button onClick={() => dismiss(active)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold hover:bg-muted"><CheckCircle2 className="h-3.5 w-3.5" /> Dismiss</button> : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700"><p className="text-xl font-black">{active.digest?.certifiedVehicles || 0}</p><p className="text-[11px] font-bold uppercase">Certified</p></div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-700"><p className="text-xl font-black">{active.digest?.needsReview || 0}</p><p className="text-[11px] font-bold uppercase">Needs Review</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-700"><p className="text-xl font-black">{active.digest?.missingFtc || 0}</p><p className="text-[11px] font-bold uppercase">Missing FTC</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-700"><p className="text-xl font-black">{active.digest?.missingK208 || 0}</p><p className="text-[11px] font-bold uppercase">Missing K208</p></div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700"><p className="text-xl font-black">{active.digest?.missingSignatures || 0}</p><p className="text-[11px] font-bold uppercase">Missing Signatures</p></div>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="whitespace-pre-wrap text-sm text-foreground">{active.summary_text}</p>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2 text-left">Stock</th><th className="px-3 py-2 text-left">Vehicle</th><th className="px-3 py-2 text-left">VIN</th><th className="px-3 py-2 text-left">Issues</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {(active.digest?.vehicles || []).slice(0, 50).map((vehicle, idx) => (
                      <tr key={`${vehicle.vehicleId || vehicle.vin || idx}`}>
                        <td className="px-3 py-2 font-mono text-xs">{vehicle.stock || "—"}</td>
                        <td className="px-3 py-2 font-bold">{vehicle.vehicleTitle || "Vehicle"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{vehicle.vin || "—"}</td>
                        <td className="px-3 py-2 text-xs">{(vehicle.labels || vehicle.issues || []).join(", ") || "Needs review"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ComplianceInbox;

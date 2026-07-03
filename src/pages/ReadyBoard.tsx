import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { CheckCircle2, MinusCircle, Loader2, RefreshCw, QrCode, AlertTriangle, ShieldCheck, X, Printer, Send, Wrench } from "lucide-react";
import NextStepBanner from "@/components/workflow/NextStepBanner";

// /ready-board — the used-car manager's daily cockpit. Every car and where it
// stands across the get-ready stations (Service K-208, Detail, Prep/install,
// Recall) plus recon approval and publish status, so the day's work and any
// bottleneck is obvious. Per car: print the window sticker, send the get-ready,
// generate the Get-Ready QR, and jump to recon approval.

interface Row {
  id: string; vin: string; ymm: string | null; condition: string | null; status: string | null;
  recall_check: { do_not_drive?: boolean; checked_at?: string } | null; orchestrated_at: string | null;
}
const isUsed = (c: string | null) => ["used", "cpo", "certified"].includes(String(c || "used").toLowerCase());

export default function ReadyBoard() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const tenantId = tenant?.id || null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [service, setService] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Set<string>>(new Set());
  const [prep, setPrep] = useState<Set<string>>(new Set());
  const [recallReview, setRecallReview] = useState<Set<string>>(new Set());
  const [reconNeeds, setReconNeeds] = useState<Set<string>>(new Set());
  const [requireK208, setRequireK208] = useState(false);
  const [loading, setLoading] = useState(true);
  const [todayOnly, setTodayOnly] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [qrVin, setQrVin] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [list, si, ds, ps, rr, re, prof] = await Promise.all([
      (supabase as any).from("vehicle_listings").select("id, vin, ymm, condition, status, recall_check, orchestrated_at").eq("tenant_id", tenantId).limit(500),
      (supabase as any).from("safety_inspections").select("vin").eq("tenant_id", tenantId).eq("status", "signed"),
      (supabase as any).from("detail_signoffs").select("vin").eq("tenant_id", tenantId).eq("status", "signed"),
      (supabase as any).from("prep_sign_offs").select("vin").eq("tenant_id", tenantId).eq("listing_unlocked", true),
      (supabase as any).from("recall_service_tasks").select("vin").eq("tenant_id", tenantId).eq("status", "open_review"),
      (supabase as any).from("recon_estimates").select("vin").eq("tenant_id", tenantId).eq("status", "submitted"),
      (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    setRows((list.data as Row[]) || []);
    setService(new Set(((si.data as { vin: string }[]) || []).map((r) => r.vin)));
    setDetail(new Set(((ds.data as { vin: string }[]) || []).map((r) => r.vin)));
    setPrep(new Set(((ps.data as { vin: string }[]) || []).map((r) => r.vin)));
    setRecallReview(new Set(((rr.data as { vin: string }[]) || []).map((r) => r.vin)));
    setReconNeeds(new Set(((re.data as { vin: string }[]) || []).map((r) => r.vin)));
    setRequireK208(!!(prof.data?.settings as { require_safety_inspection?: boolean } | null)?.require_safety_inspection);
    setLoading(false);
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const isToday = useCallback((r: Row) => !!r.orchestrated_at && new Date(r.orchestrated_at).getTime() >= startOfToday, [startOfToday]);

  const sendGetReady = async (r: Row) => {
    if (!tenantId) return;
    setSending(r.vin);
    const { data, error } = await (supabase as any).functions.invoke("notify-getready", { body: { tenant_id: tenantId, vin: r.vin } });
    setSending(null);
    if (!error && data?.ok) toast.success("Get-ready sent to the detail shop");
    else toast.error(data?.error === "no_recipient" ? "Set a detail shop email in Settings first." : "Couldn't send the get-ready.");
  };
  const printSticker = (r: Row) => navigate(`${isUsed(r.condition) ? "/used-car-sticker" : "/new-car-sticker"}?vehicleId=${r.id}`);

  const recallState = (r: Row): "ok" | "dnd" | "stale" => {
    const rc = r.recall_check || {};
    if (rc.do_not_drive) return "dnd";
    if (!rc.checked_at || new Date(rc.checked_at) < new Date(Date.now() - 30 * 864e5)) return "stale";
    return "ok";
  };
  const isReady = useCallback((r: Row) => {
    if (!prep.has(r.vin)) return false;
    if (requireK208 && isUsed(r.condition) && !service.has(r.vin)) return false;
    if (recallReview.has(r.vin)) return false;   // open recall awaiting service outcome
    return recallState(r) === "ok";
  }, [prep, service, requireK208, recallReview]);

  const stats = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      todayIntake: rows.filter(isToday).length,
      reconNeeds: rows.filter((r) => reconNeeds.has(r.vin)).length,
      needService: rows.filter((r) => isUsed(r.condition) && !service.has(r.vin)).length,
      recallBlocked: rows.filter((r) => recallState(r) !== "ok" || recallReview.has(r.vin)).length,
    };
  }, [rows, service, isToday, reconNeeds, recallReview]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return todayOnly ? rows.filter(isToday) : rows;
  }, [rows, todayOnly, isToday]);

  const showQr = async (vin: string) => {
    if (!tenantId) return;
    setQrVin(vin); setQrToken(null);
    const { data, error } = await (supabase as any).rpc("issue_vehicle_ready_token", { p_tenant_id: tenantId, p_vin: vin });
    if (error || !data) { toast.error("Could not generate QR"); setQrVin(null); return; }
    setQrToken(String(data));
  };
  const qrUrl = qrToken ? `${window.location.origin}/ready/${qrToken}` : "";

  if (!tenantId) return null;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Ready Board</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTodayOnly((v) => !v)} className={`h-9 px-3 rounded-md border text-xs font-semibold ${todayOnly ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted"}`}>
            {todayOnly ? "Showing today's intake" : "Today's intake only"}
          </button>
          <button onClick={load} disabled={loading} className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
        </div>
      </div>

      <NextStepBanner stage="ready-board" />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Vehicles" value={stats.total} />
          <Stat label="Today's intake" value={stats.todayIntake} tone={stats.todayIntake ? "amber" : "neutral"} />
          <Stat label="Recon to OK" value={stats.reconNeeds} tone={stats.reconNeeds ? "amber" : "green"} />
          <Stat label="Need service" value={stats.needService} tone={stats.needService ? "amber" : "green"} />
          <Stat label="Recall review" value={stats.recallBlocked} tone={stats.recallBlocked ? "red" : "green"} />
        </div>
      )}

      {stats && stats.recallBlocked > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2.5 text-[13px] text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>{stats.recallBlocked}</b> vehicle{stats.recallBlocked === 1 ? "" : "s"} need a recall review before they can be sold. Check the Recall column below.</span>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
      ) : !rows?.length ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No vehicles in inventory yet.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-semibold">Vehicle</th>
                <th className="py-2 px-2 font-semibold text-center">Service K-208</th>
                <th className="py-2 px-2 font-semibold text-center">Detail</th>
                <th className="py-2 px-2 font-semibold text-center">Prep / install</th>
                <th className="py-2 px-2 font-semibold text-center">Recon</th>
                <th className="py-2 px-2 font-semibold text-center">Recall</th>
                <th className="py-2 px-2 font-semibold text-center">Ready</th>
                <th className="py-2 pl-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const rc = recallState(r);
                return (
                  <tr key={r.vin} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-foreground truncate max-w-[220px] flex items-center gap-1.5">{r.ymm || "Vehicle"}{isToday(r) && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">New</span>}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.vin} · {r.status || "draft"}</div>
                    </td>
                    <td className="py-2 px-2 text-center"><Cell on={service.has(r.vin)} dim={!isUsed(r.condition)} /></td>
                    <td className="py-2 px-2 text-center"><Cell on={detail.has(r.vin)} /></td>
                    <td className="py-2 px-2 text-center"><Cell on={prep.has(r.vin)} /></td>
                    <td className="py-2 px-2 text-center">
                      {reconNeeds.has(r.vin)
                        ? <button onClick={() => navigate("/recon")} className="inline-flex items-center gap-1 text-amber-700 font-semibold text-[11px] hover:underline"><Wrench className="w-3.5 h-3.5" /> OK work</button>
                        : <CheckCircle2 className="w-4 h-4 text-[#16A34A] inline" />}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {recallReview.has(r.vin) ? <span title="Open recall — service review required" className="inline-flex items-center gap-1 text-red-600 font-semibold text-[11px]"><AlertTriangle className="w-3.5 h-3.5" /> Review</span>
                        : rc === "ok" ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] inline" />
                        : rc === "dnd" ? <span title="Do-not-drive recall"><AlertTriangle className="w-4 h-4 text-red-600 inline" /></span>
                        : <span title="Recall check stale/missing"><AlertTriangle className="w-4 h-4 text-amber-500 inline" /></span>}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {isReady(r) ? <span className="inline-flex items-center gap-1 text-[#16A34A] font-semibold"><CheckCircle2 className="w-4 h-4" /> Ready</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 pl-2">
                      <div className="flex items-center justify-end gap-1">
                        {service.has(r.vin) && <button onClick={() => navigate(`/k208/${r.vin}`)} title="Print K-208" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><ShieldCheck className="w-3.5 h-3.5" /></button>}
                        <button onClick={() => printSticker(r)} title="Print window sticker" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><Printer className="w-3.5 h-3.5" /></button>
                        <button onClick={() => sendGetReady(r)} disabled={sending === r.vin} title="Send get-ready to detail" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50">{sending === r.vin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}</button>
                        <button onClick={() => showQr(r.vin)} title="Get-Ready QR" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><QrCode className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">{todayOnly ? "No vehicles ingested today." : "No vehicles."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {qrVin && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setQrVin(null)}>
          <div className="bg-card rounded-2xl border border-border p-6 max-w-sm w-full text-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setQrVin(null)} className="absolute"><X className="w-4 h-4" /></button>
            <h3 className="font-bold text-foreground">Get-Ready QR</h3>
            <p className="text-xs text-muted-foreground font-mono">{qrVin}</p>
            {qrToken ? (
              <>
                <div className="bg-white p-3 rounded-xl border border-border inline-block"><QRCodeSVG value={qrUrl} size={180} /></div>
                <a href={qrUrl} target="_blank" rel="noreferrer" className="block text-xs text-primary break-all underline">{qrUrl}</a>
                <button onClick={() => { navigator.clipboard.writeText(qrUrl); toast.success("Link copied"); }} className="h-9 px-3 rounded-md border border-border text-xs font-semibold">Copy link</button>
              </>
            ) : <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ on, dim }: { on: boolean; dim?: boolean }) {
  if (on) return <CheckCircle2 className="w-4 h-4 text-[#16A34A] inline" />;
  if (dim) return <span className="text-[10px] text-muted-foreground">n/a</span>;
  return <MinusCircle className="w-4 h-4 text-slate-300 inline" />;
}
function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "green" | "amber" | "red" }) {
  const color = tone === "green" ? "text-[#16A34A]" : tone === "amber" ? "text-[#EA580C]" : tone === "red" ? "text-red-600" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

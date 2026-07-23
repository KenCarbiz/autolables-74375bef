import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { deriveGetReadyDispatch } from "@/hooks/useGetReady";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import { CheckCircle2, MinusCircle, Loader2, RefreshCw, QrCode, AlertTriangle, ShieldCheck, X, Printer, Send, Wrench, FolderCheck } from "lucide-react";
import NextStepBanner from "@/components/workflow/NextStepBanner";

// /ready-board — the used-car manager's daily cockpit. Every car and where it
// stands across the get-ready stations (Service K-208, Detail, Prep/install,
// Recall) plus recon approval and publish status, so the day's work and any
// bottleneck is obvious. Per car: print the window sticker, send the get-ready,
// generate the Get-Ready QR, and jump to recon approval.

interface Row {
  id: string; vin: string; ymm: string | null; condition: string | null; status: string | null;
  recall_check: { do_not_drive?: boolean; checked_at?: string } | null; orchestrated_at: string | null;
  deal_processed_at: string | null;
}
const isUsed = (c: string | null) => ["used", "cpo", "certified"].includes(String(c || "used").toLowerCase());

// The active draft addendum for a VIN and where it stands in the manager's
// acceptance flow: awaiting acceptance -> accepted (Get-Ready dispatched).
interface Addn { id: string; accepted_at: string | null; getready_dispatched_at: string | null; updated_at: string | null }
type Bucket = "acceptance" | "getready" | "ready" | "all";

export default function ReadyBoard() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canAccept = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const navigate = useNavigate();
  const tenantId = tenant?.id || null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [service, setService] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Set<string>>(new Set());
  const [prep, setPrep] = useState<Set<string>>(new Set());
  const [recallReview, setRecallReview] = useState<Set<string>>(new Set());
  const [reconNeeds, setReconNeeds] = useState<Set<string>>(new Set());
  const [addMap, setAddMap] = useState<Map<string, Addn>>(new Map());
  const [staleVins, setStaleVins] = useState<Set<string>>(new Set());
  const [requireK208, setRequireK208] = useState(false);
  const [loading, setLoading] = useState(true);
  const [todayOnly, setTodayOnly] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("acceptance");
  const [qrVin, setQrVin] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [list, si, ds, ps, rr, re, prof] = await Promise.all([
      (supabase as any).from("vehicle_listings").select("id, vin, ymm, condition, status, recall_check, orchestrated_at, deal_processed_at").eq("tenant_id", tenantId).limit(500),
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

    // Active draft addendum per VIN (newest non-signed). Resilient to the
    // acceptance columns not yet being applied in a given environment.
    type AddnRow = { id: string; vehicle_vin: string; status: string | null; signed_at: string | null; accepted_at: string | null; getready_dispatched_at: string | null; updated_at: string | null };
    const cols = "id, vehicle_vin, status, signed_at, accepted_at, getready_dispatched_at, updated_at";
    let add = await (supabase as any).from("addendums").select(cols).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000);
    if (add.error) add = await (supabase as any).from("addendums").select("id, vehicle_vin, status, signed_at, updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000);
    const map = new Map<string, Addn>();
    for (const a of ((add.data as AddnRow[]) || [])) {
      if (a.status === "signed" || a.signed_at) continue;   // customer-signed -> out of the manager flow
      if (map.has(a.vehicle_vin)) continue;                  // keep the newest draft only
      map.set(a.vehicle_vin, { id: a.id, accepted_at: a.accepted_at ?? null, getready_dispatched_at: a.getready_dispatched_at ?? null, updated_at: a.updated_at ?? null });
    }
    setAddMap(map);

    // Stale set: a VIN whose newest verified install proof lands after the
    // addendum was accepted — the Get-Ready changed since the manager approved
    // it, so the addendum needs a refresh.
    let pf = await (supabase as any).from("install_proofs").select("vehicle_vin, verified_at, is_verified").eq("tenant_id", tenantId).limit(2000);
    if (pf.error) pf = await (supabase as any).from("install_proofs").select("vehicle_vin, verified_at").eq("tenant_id", tenantId).limit(2000);
    const proofMax = new Map<string, string>();
    for (const p of ((pf.data as { vehicle_vin: string; verified_at: string | null; is_verified?: boolean }[]) || [])) {
      if (p.is_verified === false || !p.verified_at) continue;
      const prev = proofMax.get(p.vehicle_vin);
      if (!prev || p.verified_at > prev) proofMax.set(p.vehicle_vin, p.verified_at);
    }
    const stale = new Set<string>();
    for (const [vin, a] of map) {
      const ts = proofMax.get(vin);
      // Anchor on updated_at (auto-bumped on any save) so an Update clears the
      // flag; gate on accepted_at so only accepted addendums are flagged.
      if (a.accepted_at && ts && new Date(ts) > new Date(a.updated_at || a.accepted_at)) stale.add(vin);
    }
    setStaleVins(stale);
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

  // Accept the vehicle's draft addendum, then dispatch the Get-Ready. Mirrors
  // the Vehicle File action so the manager can clear the acceptance queue from
  // either surface. Acceptance is recorded even if the shop email is unset.
  const acceptAndDispatch = async (r: Row) => {
    const a = addMap.get(r.vin);
    if (!a) return;
    setAccepting(r.vin);
    try {
      const { data, error } = await (supabase as any).rpc("accept_addendum", { _addendum_id: a.id });
      if (error || !data?.ok) { toast.error("Couldn't accept the addendum"); return; }
      toast.success("Addendum accepted");
      try {
        const { depts, vendors } = await deriveGetReadyDispatch(data.tenant_id, data.vin);
        const res = await (supabase as any).functions.invoke("notify-getready", { body: { tenant_id: data.tenant_id, vin: data.vin, depts, vendors, app_base: window.location.origin } });
        if (res?.data?.ok) {
          await (supabase as any).rpc("mark_addendum_getready_dispatched", { _addendum_id: a.id });
          toast.success("Get-Ready sent to the shop");
        } else if (res?.data?.error === "no_recipient") {
          toast.message("Accepted. Set a detail shop email in Settings to auto-send the Get-Ready.");
        } else if (res?.data?.error === "no_token") {
          toast.message("Accepted. Get-Ready link not ready yet — try Send below.");
        } else if (res?.error) {
          toast.message("Accepted. Couldn't reach the Get-Ready dispatcher — try Send below.");
        }
      } catch { /* dispatch is best-effort; acceptance is already recorded */ }
      await load();
    } finally {
      setAccepting(null);
    }
  };

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

  // Which queue a vehicle sits in, from the manager's point of view. Acceptance
  // is the first gate: an un-accepted draft belongs in the acceptance queue even
  // if the stations happen to be done, because the disclosure isn't approved yet.
  //  acceptance  — a draft addendum is waiting for the manager to accept
  //  ready       — accepted and every station done, clear to sell
  //  getready    — accepted, shop still working the Get-Ready
  //  (rows with no draft addendum only appear under "All")
  const bucketOf = useCallback((r: Row): Bucket | null => {
    const a = addMap.get(r.vin);
    if (a && !a.accepted_at) return "acceptance";
    if (isReady(r)) return "ready";
    if (a?.accepted_at) return "getready";
    return null;
  }, [isReady, addMap]);

  const bucketCounts = useMemo(() => {
    const c = { acceptance: 0, getready: 0, ready: 0 };
    for (const r of rows || []) {
      const b = bucketOf(r);
      if (b && b !== "all") c[b] += 1;
    }
    return c;
  }, [rows, bucketOf]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    let out = todayOnly ? rows.filter(isToday) : rows;
    if (bucket !== "all") out = out.filter((r) => bucketOf(r) === bucket);
    return out;
  }, [rows, todayOnly, isToday, bucket, bucketOf]);

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

      {/* The manager's two work queues, plus Ready and All. Waiting for
          acceptance is the default landing view — the day's decisions first. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <BucketTab active={bucket === "acceptance"} onClick={() => setBucket("acceptance")} label="Waiting for acceptance" count={bucketCounts.acceptance} tone="amber" />
        <BucketTab active={bucket === "getready"} onClick={() => setBucket("getready")} label="Waiting for Get-Ready" count={bucketCounts.getready} tone="blue" />
        <BucketTab active={bucket === "ready"} onClick={() => setBucket("ready")} label="Ready" count={bucketCounts.ready} tone="green" />
        <BucketTab active={bucket === "all"} onClick={() => setBucket("all")} label="All" count={rows?.length ?? 0} tone="neutral" />
      </div>

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
                      <div className="font-semibold text-foreground truncate max-w-[220px] flex items-center gap-1.5">{r.ymm || "Vehicle"}{isToday(r) && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">New</span>}{staleVins.has(r.vin) && <span title="Get-Ready changed since acceptance" className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />Changed</span>}</div>
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
                        {staleVins.has(r.vin) && addMap.get(r.vin) && (
                          <button onClick={() => navigate(`/addendum?id=${addMap.get(r.vin)!.id}&edit=1`)} title="Get-Ready changed — rebuild the addendum from the latest installs" className="h-7 px-2 rounded-md bg-amber-500 text-white text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-amber-600">
                            <RefreshCw className="w-3.5 h-3.5" /> Update
                          </button>
                        )}
                        {canAccept && bucketOf(r) === "acceptance" && (
                          <button onClick={() => acceptAndDispatch(r)} disabled={accepting === r.vin} title="Accept addendum & send Get-Ready" className="h-7 px-2 rounded-md bg-emerald-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50">
                            {accepting === r.vin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Accept
                          </button>
                        )}
                        {bucketOf(r) === "ready" && (
                          r.deal_processed_at
                            ? <span title={`Deal filed ${new Date(r.deal_processed_at).toLocaleDateString()}`} className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-semibold px-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Filed</span>
                            : <button onClick={() => navigate(`/vehicle-file/${r.id}?tab=deal`)} title="Open the deal record to process this deal" className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold inline-flex items-center gap-1 hover:opacity-90"><FolderCheck className="w-3.5 h-3.5" /> Deal</button>
                        )}
                        {service.has(r.vin) && <button onClick={() => navigate(`/k208/${r.vin}`)} title="Print K-208" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><ShieldCheck className="w-3.5 h-3.5" /></button>}
                        <button onClick={() => printSticker(r)} title="Print window sticker" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><Printer className="w-3.5 h-3.5" /></button>
                        <button onClick={() => sendGetReady(r)} disabled={sending === r.vin} title="Send get-ready to detail" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50">{sending === r.vin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}</button>
                        <button onClick={() => showQr(r.vin)} title="Get-Ready QR" className="h-7 px-2 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted"><QrCode className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">{
                bucket === "acceptance" ? "Nothing waiting for acceptance — all caught up."
                : bucket === "getready" ? "No vehicles are in Get-Ready right now."
                : bucket === "ready" ? "No vehicles are fully ready yet."
                : todayOnly ? "No vehicles ingested today." : "No vehicles."
              }</td></tr>}
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
function BucketTab({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: "amber" | "blue" | "green" | "neutral" }) {
  const activeTone = tone === "amber" ? "border-amber-500 bg-amber-50 text-amber-800"
    : tone === "blue" ? "border-blue-500 bg-blue-50 text-blue-800"
    : tone === "green" ? "border-emerald-500 bg-emerald-50 text-emerald-800"
    : "border-primary bg-primary/10 text-primary";
  return (
    <button onClick={onClick} className={`h-9 px-3 rounded-md border text-xs font-semibold inline-flex items-center gap-1.5 ${active ? activeTone : "border-border text-foreground hover:bg-muted"}`}>
      {label}
      <span className={`min-w-[18px] px-1 rounded text-[10px] tabular-nums ${active ? "bg-white/70" : "bg-muted text-muted-foreground"}`}>{count}</span>
    </button>
  );
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

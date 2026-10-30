import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { deriveGetReadyDispatch } from "@/hooks/useGetReady";
import { executedVinSet } from "@/lib/commandCenter/inspectionState";
import { isFailureResolved } from "@/lib/service/transitions";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { canDispatchGetReady } from "@/lib/commandCenter/dispatchAuthority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import { toast } from "sonner";
import { CheckCircle2, MinusCircle, Loader2, MoreHorizontal, RefreshCw, X, Printer, Wrench } from "lucide-react";
import { Button, LocalTabs, MetricStrip, PageBody, PageHeader, Panel, QueryState, StatusText, Td, Th, WorkTable, type LocalTab } from "@/components/product";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
  // Client mirror of the mark_vehicle_retail_ready authority matrix — the
  // server still decides.
  const canDecideRetailReady = canDispatchGetReady(member?.role, isAdmin);
  const navigate = useNavigate();
  const tenantId = tenant?.id || null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [service, setService] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Set<string>>(new Set());
  const [prep, setPrep] = useState<Set<string>>(new Set());
  const [recallReview, setRecallReview] = useState<Set<string>>(new Set());
  const [reconNeeds, setReconNeeds] = useState<Set<string>>(new Set());
  const [addMap, setAddMap] = useState<Map<string, Addn>>(new Map());
  const [lifecycle, setLifecycle] = useState<Map<string, string>>(new Map());
  const [marking, setMarking] = useState<string | null>(null);
  const [staleVins, setStaleVins] = useState<Set<string>>(new Set());
  const [requireK208, setRequireK208] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  // The selected view lives in the URL so reload and back keep it.
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const bucket: Bucket = viewParam === "getready" || viewParam === "ready" || viewParam === "all" ? viewParam : "acceptance";
  const [qrVin, setQrVin] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(false);
    const [list, si, fails, ds, ps, rr, re, prof, lc] = await Promise.all([
      (supabase as any).from("vehicle_listings").select("id, vin, ymm, condition, status, recall_check, orchestrated_at, deal_processed_at").eq("tenant_id", tenantId).neq("status", "archived").limit(500),
      // All signed rows, reduced through the ONE executed predicate — a signed
      // FAIL (or a stale pass behind a newer signed failure) must not read as
      // station-complete on the board.
      (supabase as any).from("safety_inspections").select("vin, status, result, signed_at, created_at").eq("tenant_id", tenantId).eq("status", "signed"),
      // Open item failures block the service station too: a newer signed pass
      // over unresolved failures is NOT done (same fact the workspace and the
      // certify gate read).
      (supabase as any).from("safety_inspection_item_failures").select("vin, repair_state").eq("tenant_id", tenantId),
      (supabase as any).from("detail_signoffs").select("vin").eq("tenant_id", tenantId).eq("status", "signed"),
      (supabase as any).from("prep_sign_offs").select("vin").eq("tenant_id", tenantId).eq("listing_unlocked", true),
      (supabase as any).from("recall_service_tasks").select("vin").eq("tenant_id", tenantId).eq("status", "open_review"),
      (supabase as any).from("recon_estimates").select("vin").eq("tenant_id", tenantId).eq("status", "submitted"),
      (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle(),
      (supabase as any).from("vehicle_lifecycle").select("vin, state").eq("tenant_id", tenantId).limit(1000),
    ]);
    // Vehicles are published together with the maps that classify them, at
    // the end, so a partial read never renders as zero counts.
    if (list.error) { setLoadError(true); setLoading(false); return; }
    const listed = (list.data as Row[]) || [];
    const svc = executedVinSet((si.data as { vin: string; status: string; result: string | null; signed_at: string | null; created_at: string | null }[]) || []);
    for (const f of ((fails.data as { vin: string; repair_state: string }[]) || [])) {
      if (!isFailureResolved(f.repair_state)) svc.delete(f.vin);
    }
    setService(svc);
    setDetail(new Set(((ds.data as { vin: string }[]) || []).map((r) => r.vin)));
    setPrep(new Set(((ps.data as { vin: string }[]) || []).map((r) => r.vin)));
    setRecallReview(new Set(((rr.data as { vin: string }[]) || []).map((r) => r.vin)));
    setReconNeeds(new Set(((re.data as { vin: string }[]) || []).map((r) => r.vin)));
    setRequireK208(!!(prof.data?.settings as { require_safety_inspection?: boolean } | null)?.require_safety_inspection);
    setLifecycle(new Map(((lc.data as { vin: string; state: string }[]) || []).map((r) => [r.vin, r.state])));

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
    setRows(listed);
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

  // Lifecycle rows key on upper(vin).
  const lifecycleOf = useCallback((r: Row) => lifecycle.get(String(r.vin || "").toUpperCase()) ?? null, [lifecycle]);

  // Final acceptance: one server-side RPC decides. The rejections carry the
  // stored blocker codes so the manager sees exactly what still blocks.
  const markRetailReady = async (r: Row) => {
    setMarking(r.vin);
    try {
      const { data, error } = await (supabase as any).rpc("mark_vehicle_retail_ready", { p_vehicle_id: r.id });
      if (error) { toast.error("Couldn't mark the vehicle retail ready."); return; }
      if (data?.ok) {
        toast.success(data.already ? "Already retail ready." : "Vehicle marked retail ready.");
        await load();
      } else if (data?.reason === "not_cleared") {
        const blockers = ((data.blockers as string[]) || []).map(clearanceReasonLabel).join(". ");
        toast.error(blockers ? `Not cleared for delivery: ${blockers}` : "Not cleared for delivery yet.");
      } else if (data?.reason === "not_certified") {
        toast.error("Licensee certification is still pending on the K-208.");
      } else {
        toast.error("This vehicle can't be marked retail ready right now.");
      }
    } finally {
      setMarking(null);
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

  const total = rows?.length ?? null;
  const ready = rows != null && !loading;
  const VIEWS: Array<{ id: Bucket; label: string; count: number | null; empty: string }> = [
    { id: "acceptance", label: "Waiting for acceptance", count: ready ? bucketCounts.acceptance : null, empty: "No vehicles are waiting for acceptance" },
    { id: "getready", label: "Waiting for Get-Ready", count: ready ? bucketCounts.getready : null, empty: "No vehicles are in Get-Ready" },
    { id: "ready", label: "Ready", count: ready ? bucketCounts.ready : null, empty: "No vehicles have cleared every station" },
    { id: "all", label: "All", count: total, empty: "No vehicles" },
  ];
  const tabs: LocalTab[] = VIEWS.map((v) => ({
    key: v.id,
    label: v.label,
    to: `/ready-board?view=${v.id}`,
    count: v.count,
    active: v.id === bucket,
  }));
  const current = VIEWS.find((v) => v.id === bucket)!;

  // Counts describe the selected view. The wording says which view and which
  // filter, so an empty view never reads as the whole pipeline being clear.
  const scopeNote = todayOnly ? " from today's intake" : "";
  const status = loadError ? "error" : loading || rows == null ? "loading" : visibleRows.length === 0 ? "empty" : "ready";
  const otherViews = ready && total != null && total > 0 ? ` ${total.toLocaleString()} ${total === 1 ? "vehicle is" : "vehicles are"} on the board in total; open All to see them.` : "";

  return (
    <PageBody width="wide">
      <PageHeader
        title="Ready Board"
        description="Where every vehicle stands across Service K-208, Detail, Prep and install, Recon and Recall."
        actions={
          <>
            <Button onClick={() => setTodayOnly((v) => !v)} aria-pressed={todayOnly}>
              {todayOnly ? "Showing today's intake" : "Today's intake only"}
            </Button>
            <Button onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Refresh
            </Button>
          </>
        }
      />

      <LocalTabs label="Ready Board views" tabs={tabs} />

      <MetricStrip
        label="Ready Board summary"
        metrics={[
          { label: "Waiting for acceptance", value: ready ? bucketCounts.acceptance : null, loading, hint: total != null ? `of ${total.toLocaleString()} on the board` : undefined, tone: "warning", href: "/ready-board?view=acceptance" },
          { label: "Waiting for Get-Ready", value: ready ? bucketCounts.getready : null, loading, hint: total != null ? `of ${total.toLocaleString()} on the board` : undefined, tone: "info", href: "/ready-board?view=getready" },
          { label: "Ready", value: ready ? bucketCounts.ready : null, loading, hint: "every station cleared", tone: "success", href: "/ready-board?view=ready" },
          { label: "Recall review", value: stats ? stats.recallBlocked : null, loading, hint: "before they can be sold", tone: stats && stats.recallBlocked > 0 ? "danger" : "neutral" },
        ]}
      />
      <Panel flush>
        <QueryState
          status={status}
          onRetry={load}
          errorTitle="The board could not be loaded."
          errorDetail="Vehicle counts are unknown until the read succeeds."
          emptyTitle={`${current.empty}${scopeNote ? scopeNote : " in this view"}.`}
          emptyDetail={bucket === "all" && !todayOnly ? "No vehicles in inventory yet." : `This is the ${current.label} view only; it does not say the rest of the pipeline is clear.${otherViews}`}
        >
          <WorkTable caption="Vehicles and their get-ready stations" minWidth={900}>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th>Service K-208</Th>
                <Th>Detail</Th>
                <Th>Prep / install</Th>
                <Th>Recon</Th>
                <Th>Recall</Th>
                <Th>Ready</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const rc = recallState(r);
                return (
                  <tr key={r.vin}>
                    <Td>
                      <div className="flex max-w-[260px] items-center gap-2 font-semibold text-adm-ink">
                        <span className="truncate">{r.ymm || "Vehicle"}</span>
                        {isToday(r) && <StatusText tone="info">New</StatusText>}
                        {staleVins.has(r.vin) && <span title="Get-Ready changed since acceptance"><StatusText tone="warning" icon>Changed</StatusText></span>}
                      </div>
                      <div className="font-mono text-[12px] text-adm-muted">{r.vin} · {r.status || "draft"}</div>
                    </Td>
                    <Td><Cell on={service.has(r.vin)} dim={!isUsed(r.condition)} /></Td>
                    <Td><Cell on={detail.has(r.vin)} /></Td>
                    <Td><Cell on={prep.has(r.vin)} /></Td>
                    <Td>
                      {reconNeeds.has(r.vin)
                        ? <button onClick={() => navigate("/recon")} className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-adm-warning hover:underline"><Wrench className="h-4 w-4" aria-hidden="true" /> OK work</button>
                        : <CheckCircle2 className="inline h-5 w-5 text-adm-success" aria-label="No recon approval pending" />}
                    </Td>
                    <Td>
                      {recallReview.has(r.vin) ? <span title="Open recall — service review required"><StatusText tone="danger" icon>Review</StatusText></span>
                        : rc === "ok" ? <CheckCircle2 className="inline h-5 w-5 text-adm-success" aria-label="Recall check current" />
                        : rc === "dnd" ? <span title="Do-not-drive recall"><StatusText tone="danger" icon>Do not drive</StatusText></span>
                        : <span title="Recall check stale or missing"><StatusText tone="warning" icon>Unverified</StatusText></span>}
                    </Td>
                    <Td>
                      {isReady(r) ? <StatusText tone="success" icon>Ready</StatusText>
                        : <span className="text-adm-muted">—</span>}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        {lifecycleOf(r) === "RETAIL_READY" && <StatusText tone="success">Retail ready</StatusText>}
                        {(() => {
                          const primary: { label: string; run: () => void; busy: boolean } | null =
                            canDecideRetailReady && lifecycleOf(r) === "FINAL_READY_VERIFICATION"
                              ? { label: "Mark retail ready", run: () => markRetailReady(r), busy: marking === r.vin }
                              : canAccept && bucketOf(r) === "acceptance"
                                ? { label: "Authorize and dispatch", run: () => acceptAndDispatch(r), busy: accepting === r.vin }
                                : bucketOf(r) === "ready" && !r.deal_processed_at
                                  ? { label: "Open deal", run: () => navigate(`/vehicle-file/${r.id}?tab=deal`), busy: false }
                                  : null;
                          return primary ? (
                            <button type="button" onClick={primary.run} disabled={primary.busy} className="text-[14px] font-semibold text-adm-primary hover:underline disabled:opacity-50">
                              {primary.busy ? "Working…" : primary.label}
                            </button>
                          ) : bucketOf(r) === "ready" && r.deal_processed_at ? (
                            <span title={`Deal filed ${new Date(r.deal_processed_at).toLocaleDateString()}`}><StatusText tone="success">Filed</StatusText></span>
                          ) : null;
                        })()}
                        <DropdownMenu>
                          <DropdownMenuTrigger aria-label={`More actions for ${r.ymm || r.vin}`} className="rounded-[6px] p-1 text-adm-muted hover:bg-adm-workspace">
                            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {staleVins.has(r.vin) && addMap.get(r.vin) && (
                              <DropdownMenuItem onSelect={() => navigate(`/addendum?id=${addMap.get(r.vin)!.id}&edit=1`)}>Update addendum</DropdownMenuItem>
                            )}
                            {service.has(r.vin) && <DropdownMenuItem onSelect={() => navigate(`/k208/${r.vin}`)}>Print K-208</DropdownMenuItem>}
                            <DropdownMenuItem onSelect={() => printSticker(r)}>Print window sticker</DropdownMenuItem>
                            <DropdownMenuItem disabled={sending === r.vin} onSelect={() => sendGetReady(r)}>Send get-ready to detail</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => showQr(r.vin)}>Get-Ready QR</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>

      {qrVin && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setQrVin(null)}>
          <div className="relative w-full max-w-sm space-y-3 rounded-[8px] border border-adm-border bg-adm-surface p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setQrVin(null)} className="absolute right-3 top-3 text-adm-muted hover:text-adm-ink" aria-label="Close"><X className="h-4 w-4" /></button>
            <h3 className="font-semibold text-adm-ink">Get-Ready QR</h3>
            <p className="font-mono text-[12px] text-adm-muted">{qrVin}</p>
            {qrToken ? (
              <>
                <div className="inline-block rounded-[6px] border border-adm-border bg-white p-3"><QRCodeSVG value={qrUrl} size={180} /></div>
                <a href={qrUrl} target="_blank" rel="noreferrer" className="block break-all text-[12px] text-adm-primary underline">{qrUrl}</a>
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" onClick={() => { navigator.clipboard.writeText(qrUrl); toast.success("Link copied"); }}>Copy link</Button>
                  <a href={`/print/vehicle-qr/${qrVin}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-adm-primary bg-adm-primary px-3 text-[13px] font-semibold text-white"><Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print QR sheet</a>
                </div>
              </>
            ) : <Loader2 className="mx-auto h-6 w-6 animate-spin text-adm-muted" aria-label="Loading" />}
          </div>
        </div>
      )}
    </PageBody>
  );
}

function Cell({ on, dim }: { on: boolean; dim?: boolean }) {
  if (on) return <CheckCircle2 className="inline h-5 w-5 text-adm-success" aria-label="Done" />;
  if (dim) return <span className="text-[12px] text-adm-muted">n/a</span>;
  return <MinusCircle className="inline h-5 w-5 text-adm-muted" aria-label="Not done" />;
}

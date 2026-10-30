import { STATE_OWNER } from "@/lib/lifecycle/states";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { canDispatchGetReady } from "@/lib/commandCenter/dispatchAuthority";
import { cn } from "@/lib/utils";
import { ChevronDown, Search, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, LocalTabs, MetricStrip, PageBody, PageHeader, QueryState, StatusText, Td, Th, WorkTable, type LocalTab, type Tone } from "@/components/product";

// /get-ready-command — the used-car manager's fleet-level intake queue.
// Reads the STORED vehicle_lifecycle (never a client derivation) and issues
// the gate decisions through the atomic server RPCs:
//   Authorize for Get Ready  -> authorize_vehicle_for_get_ready
//   Hold / Request Info      -> set_vehicle_lifecycle_gate('ON_HOLD', reason)
//   Wholesale                -> set_vehicle_lifecycle_gate('WHOLESALE', reason)
//   Remove                   -> set_vehicle_lifecycle_gate('REMOVED', reason)
// Per-vehicle authorization detail stays at /get-ready-command/:vehicleId.

const BTN_PRIMARY = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-adm-primary bg-adm-primary px-3.5 text-[14px] font-semibold text-white hover:bg-adm-primary-hover disabled:cursor-not-allowed";
const BTN_SECONDARY = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-adm-border bg-adm-surface px-3.5 text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace disabled:cursor-not-allowed";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface Row {
  vehicleId: string; vin: string; state: string; gateReason: string | null;
  authorizedAt: string | null; ymm: string; price: number | null; mileage: number | null;
  photo: string; recall: string; ageDays: number; condition: string;
}

const GATE_TABS = [
  { key: "awaiting", label: "Awaiting Authorization" },
  { key: "holds", label: "Holds" },
  { key: "exceptions", label: "Exceptions" },
  { key: "wholesale", label: "Wholesale" },
  { key: "all", label: "All" },
] as const;

const STATE_PILL: Record<string, { label: string; tone: Tone }> = {
  AWAITING_MANAGER_AUTHORIZATION: { label: "Awaiting authorization", tone: "warning" },
  PRELOAD_EXCEPTION: { label: "Preload exception", tone: "danger" },
  ON_HOLD: { label: "On hold", tone: "neutral" },
  WHOLESALE: { label: "Wholesale", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "neutral" },
};

export default function ManagerIntake() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const navigate = useNavigate();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const canDecide = isAdmin || canDispatchGetReady(member?.role, isAdmin);
  const [rows, setRows] = useState<Row[]>([]);
  const [authorizedToday, setAuthorizedToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Filter, search and the open review live in the URL so reload and back
  // return to the same queue state.
  const [searchParams, setSearchParams] = useSearchParams();
  const gate = searchParams.get("gate");
  const tab: (typeof GATE_TABS)[number]["key"] = GATE_TABS.some((t) => t.key === gate) ? (gate as (typeof GATE_TABS)[number]["key"]) : "awaiting";
  const q = searchParams.get("q") ?? "";
  const setQ = (v: string) => {
    const n = new URLSearchParams(searchParams);
    if (v) n.set("q", v); else n.delete("q");
    setSearchParams(n, { replace: true });
  };
  const reviewId = searchParams.get("review");
  const drawer: Row | null = useMemo(() => rows.find((r) => r.vehicleId === reviewId) ?? null, [rows, reviewId]);
  const setDrawer = (r: Row | null) => {
    const n = new URLSearchParams(searchParams);
    if (r) n.set("review", r.vehicleId); else n.delete("review");
    setSearchParams(n);
  };
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [drawerTab, setDrawerTab] = useState<"Proposed service" | "Condition" | "Notes" | "History">("Proposed service");

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      const { data: lc, error: lcErr } = await sb().from("vehicle_lifecycle")
        .select("vehicle_id, vin, state, gate_reason, authorized_at")
        .eq("tenant_id", tenantId)
        .order("state_changed_at", { ascending: false })
        .limit(500);
      if (lcErr) throw new Error(lcErr.message);
      const lcRows = (lc as { vehicle_id: string; vin: string; state: string; gate_reason: string | null; authorized_at: string | null }[]) || [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      setAuthorizedToday(lcRows.filter((r) => r.authorized_at && new Date(r.authorized_at) >= today).length);
      const gated = lcRows.filter((r) =>
        ["AWAITING_MANAGER_AUTHORIZATION", "PRELOAD_EXCEPTION", "ON_HOLD", "WHOLESALE"].includes(r.state));
      const ids = gated.map((r) => r.vehicle_id);
      // deno-lint-ignore no-explicit-any
      const byId = new Map<string, any>();
      if (ids.length) {
        const { data: vs } = await sb().from("vehicle_listings")
          .select("id, vin, ymm, price, mileage, hero_image_url, mc_attributes, recall_status, created_at, condition")
          .eq("tenant_id", tenantId).in("id", ids);
        // deno-lint-ignore no-explicit-any
        for (const v of ((vs as any[]) || [])) byId.set(v.id, v);
      }
      const now = Date.now();
      setRows(gated.map((r) => {
        const v = byId.get(r.vehicle_id) || {};
        return {
          vehicleId: r.vehicle_id, vin: r.vin, state: r.state, gateReason: r.gate_reason,
          authorizedAt: r.authorized_at,
          ymm: String(v.ymm || "Vehicle"),
          price: v.price != null ? Number(v.price) : null,
          mileage: v.mileage != null ? Number(v.mileage) : null,
          photo: (v.hero_image_url as string) || (Array.isArray(v.mc_attributes?.photo_links) ? v.mc_attributes.photo_links[0] : "") || "",
          recall: String(v.recall_status || ""),
          ageDays: v.created_at ? Math.floor((now - new Date(v.created_at).getTime()) / 864e5) : 0,
          condition: String(v.condition || "used").toUpperCase(),
        };
      }));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    awaiting: rows.filter((r) => r.state === "AWAITING_MANAGER_AUTHORIZATION").length,
    holds: rows.filter((r) => r.state === "ON_HOLD").length,
    exceptions: rows.filter((r) => r.state === "PRELOAD_EXCEPTION").length,
    wholesale: rows.filter((r) => r.state === "WHOLESALE").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "awaiting" && r.state !== "AWAITING_MANAGER_AUTHORIZATION") return false;
      if (tab === "holds" && r.state !== "ON_HOLD") return false;
      if (tab === "exceptions" && r.state !== "PRELOAD_EXCEPTION") return false;
      if (tab === "wholesale" && r.state !== "WHOLESALE") return false;
      if (term && !(`${r.ymm} ${r.vin}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, tab, q]);

  const decide = async (r: Row, action: "authorize" | "hold" | "info" | "wholesale" | "remove") => {
    if (!canDecide) { toast.error("Only managers can make intake decisions"); return; }
    if (action !== "authorize" && !reason.trim() && action !== "hold") {
      toast.error("A reason is required for this decision"); return;
    }
    if ((action === "wholesale" || action === "remove")
      && !window.confirm(`${action === "wholesale" ? "Send to wholesale" : "Remove from retail"}? The vehicle leaves the retail pipeline.`)) return;
    setBusy(true);
    try {
      if (action === "authorize") {
        const { data, error } = await sb().rpc("authorize_vehicle_for_get_ready", {
          p_vehicle_id: r.vehicleId, p_note: reason.trim() || null,
        });
        if (error) throw new Error(error.message);
        if (data && data.ok === false) {
          toast.error(data.reason === "already_authorized" ? "Already authorized" : `Cannot release: ${data.reason}`);
        } else {
          toast.success("Authorized for Get Ready — service notified");
        }
      } else {
        const state = action === "wholesale" ? "WHOLESALE" : action === "remove" ? "REMOVED" : "ON_HOLD";
        const note = action === "info" ? `Information requested: ${reason.trim()}` : (reason.trim() || null);
        const { error } = await sb().rpc("set_vehicle_lifecycle_gate", {
          p_vehicle_id: r.vehicleId, p_state: state, p_reason: note,
        });
        if (error) throw new Error(error.message);
        toast.success(action === "info" ? "Information requested — vehicle held" : `Vehicle ${state === "ON_HOLD" ? "held" : state.toLowerCase()}`);
      }
      setDrawer(null); setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Decision failed");
    }
    setBusy(false);
  };

  if (!tenantId) return null;

  const ready = !loading && !loadError;
  const status = loadError ? "error" : loading ? "loading" : visible.length === 0 ? "empty" : "ready";
  const tabs: LocalTab[] = GATE_TABS.map((t) => {
    const n = new URLSearchParams();
    n.set("gate", t.key);
    return { key: t.key, label: t.label, to: `/get-ready-command?${n.toString()}`, count: ready && t.key !== "all" ? counts[t.key] : ready ? rows.length : null, active: t.key === tab };
  });
  const tabLabel = GATE_TABS.find((t) => t.key === tab)!.label;

  return (
    <PageBody width="wide">
      <PageHeader
        title="Manager Intake"
        description="Vehicles waiting for authorization before get-ready work starts."
        actions={
          <Button variant="primary" disabled={visible.length === 0} onClick={() => { setDrawer(visible[0]); setReason(""); }}>
            Review vehicle
          </Button>
        }
      />

      <LocalTabs label="Intake queue filters" tabs={tabs} />

      <MetricStrip
        label="Intake queue summary"
        metrics={[
          { label: "Awaiting authorization", value: ready ? counts.awaiting : null, loading, href: "/get-ready-command?gate=awaiting" },
          { label: "Holds", value: ready ? counts.holds : null, loading, href: "/get-ready-command?gate=holds" },
          { label: "Exceptions", value: ready ? counts.exceptions : null, loading, href: "/get-ready-command?gate=exceptions" },
          { label: "Authorized today", value: ready ? authorizedToday : null, loading },
        ]}
      />

      <div className="relative w-full min-w-[220px] max-w-sm">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by year, make, model, or VIN"
          aria-label="Search intake queue"
          className="h-10 w-full rounded-md border border-adm-border bg-adm-surface pl-10 pr-3 text-[14px]" />
      </div>

      <div>
        <QueryState
          status={status}
          onRetry={() => void load()}
          errorTitle="We could not load the intake queue."
          errorDetail={loadError ?? undefined}
          emptyTitle={q ? "No vehicles match that search." : `Nothing is waiting in ${tabLabel}.`}
          emptyDetail="New vehicles from tonight's ingest arrive in this queue automatically. This is the selected filter only. Existing inventory was grandfathered as authorized at rollout."
        >
          <WorkTable caption="Intake authorization queue" minWidth={900}>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th align="right">Age (days)</Th>
                <Th>Condition</Th>
                <Th>Recall (evidence)</Th>
                <Th align="right">Asking price</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th align="right"><span className="sr-only">Action</span></Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const dnd = /do_not_drive|do-not-drive/i.test(r.recall);
                return (
                  <tr key={r.vehicleId} className="h-14 cursor-pointer hover:bg-adm-workspace" onClick={() => { setDrawer(r); setReason(""); }}>
                    <Td>
                      <div className="flex items-center gap-3">
                        {r.photo
                          ? <img src={r.photo} alt="" className="h-10 w-14 shrink-0 rounded-[4px] border border-adm-border object-cover" />
                          : <span className="h-10 w-14 shrink-0 rounded-[4px] bg-adm-workspace" aria-hidden="true" />}
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-adm-ink">{r.ymm}</p>
                          <p className="truncate font-mono text-[12px] text-adm-muted">{r.vin}</p>
                        </div>
                      </div>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">{r.ageDays}</Td>
                    <Td>{/^cpo$/i.test(r.condition) ? "CPO" : r.condition ? r.condition.charAt(0).toUpperCase() + r.condition.slice(1).toLowerCase() : "Unknown"}</Td>
                    <Td>
                      {dnd ? <StatusText tone="danger">Do-not-drive</StatusText>
                        : r.recall ? <span className="capitalize text-adm-ink">{r.recall.replace(/_/g, " ")}</span>
                        : <span className="text-adm-ink">Unknown</span>}
                      <p className="text-[12px] leading-[16px] text-adm-muted">{r.recall ? "Stored recall check" : "No report on file"}</p>
                    </Td>
                    <Td align="right">{r.price != null ? `$${r.price.toLocaleString("en-US")}` : <span className="text-adm-muted">Unknown</span>}</Td>
                    <Td className="whitespace-nowrap text-adm-muted">{STATE_OWNER[r.state as keyof typeof STATE_OWNER] ?? "Unknown"}</Td>
                    <Td className="whitespace-nowrap">
                      <StatusText tone={(STATE_PILL[r.state] ?? { tone: "neutral" as Tone }).tone}>{(STATE_PILL[r.state] ?? { label: r.state }).label}</StatusText>
                    </Td>
                    <Td align="right">
                      <button type="button" className="text-[14px] font-semibold text-adm-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDrawer(r); setReason(""); }} aria-label={`Review ${r.ymm}`}>Review</button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
        </QueryState>
      </div>

      {drawer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setDrawer(null)} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label={`${drawer.ymm} intake review`}
            className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-[740px] flex-col border-l border-adm-border bg-adm-surface">
            <div className="flex items-center justify-between px-5 py-3 border-b border-adm-border">
              <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink">Review vehicle</h3>
              <button onClick={() => setDrawer(null)} aria-label="Close review" className="w-10 h-10 grid place-items-center text-adm-muted hover:text-adm-ink"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex gap-4">
                {drawer.photo
                  ? <img src={drawer.photo} alt="" className="h-[96px] w-[144px] shrink-0 rounded-[4px] border border-adm-border object-cover" />
                  : <span className="h-[96px] w-[144px] shrink-0 rounded-[4px] bg-adm-workspace" aria-hidden="true" />}
                <div className="min-w-0 text-[14px] leading-[20px]">
                  <p className="text-[17px] leading-[24px] font-semibold text-adm-ink">{drawer.ymm}</p>
                  <p className="text-adm-muted truncate">VIN <span className="font-mono text-adm-ink">{drawer.vin}</span></p>
                  <p className="text-adm-muted">{drawer.ageDays} days in stock</p>
                  <p className="text-adm-muted"><span className="capitalize">{drawer.condition.toLowerCase()}</span>{drawer.mileage != null ? `, ${drawer.mileage.toLocaleString("en-US")} mi` : ""}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[6px] border border-adm-border p-3">
                  <p className="text-[12px] leading-[18px] text-adm-muted">Asking price</p>
                  <p className="text-[20px] leading-[28px] font-bold text-adm-ink tabular-nums">{drawer.price != null ? `$${drawer.price.toLocaleString("en-US")}` : "Unknown"}</p>
                  <p className="text-[12px] leading-[18px] text-adm-muted">Verified price basis not recorded</p>
                </div>
                <div className="rounded-[6px] border border-adm-border p-3">
                  <p className="text-[12px] leading-[18px] text-adm-muted">Recall status</p>
                  <p className={cn("text-[20px] leading-[28px] font-bold capitalize", /do_not_drive|do-not-drive/i.test(drawer.recall) ? "text-adm-danger" : "text-adm-ink")}>{drawer.recall ? drawer.recall.replace(/_/g, " ") : "Unknown"}</p>
                  <p className="text-[12px] leading-[18px] text-adm-muted">{drawer.recall ? "From the stored recall check" : "No recall report on file"}</p>
                </div>
              </div>
              <nav aria-label="Review sections" className="flex gap-5 border-b border-adm-border">
                {(["Proposed service", "Condition", "Notes", "History"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setDrawerTab(t)} aria-current={drawerTab === t ? "page" : undefined}
                    className={cn("-mb-px h-10 border-b-2 text-[14px] font-semibold", drawerTab === t ? "border-adm-primary text-adm-primary" : "border-transparent text-adm-muted hover:text-adm-ink")}>
                    {t}
                  </button>
                ))}
              </nav>
              <div className="text-[14px] leading-[20px] min-h-[96px]">
                {drawerTab === "Proposed service" && (
                  <p className="text-adm-muted">No proposed service items are recorded for this vehicle yet. Service proposes work after authorization, on the authorization detail page.</p>
                )}
                {drawerTab === "Condition" && (
                  <dl className="space-y-1.5">
                    <div className="flex justify-between"><dt className="text-adm-muted">Condition</dt><dd className="text-adm-ink capitalize">{drawer.condition.toLowerCase()}</dd></div>
                    <div className="flex justify-between"><dt className="text-adm-muted">Mileage</dt><dd className="text-adm-ink">{drawer.mileage != null ? `${drawer.mileage.toLocaleString("en-US")} mi` : "Unknown"}</dd></div>
                    <div className="flex justify-between"><dt className="text-adm-muted">Current state</dt><dd className="text-adm-ink">{(STATE_PILL[drawer.state] ?? { label: drawer.state }).label}</dd></div>
                  </dl>
                )}
                {drawerTab === "Notes" && (
                  <p className="text-adm-ink">{drawer.gateReason || <span className="text-adm-muted">No note is recorded on this vehicle.</span>}</p>
                )}
                {drawerTab === "History" && (
                  <p className="text-adm-muted">{drawer.authorizedAt ? `Authorized ${new Date(drawer.authorizedAt).toLocaleString()}` : "Not yet authorized."} Full stage history is on the authorization detail page.</p>
                )}
              </div>
              <div>
                <label htmlFor="intake-reason" className="block text-[14px] leading-[20px] font-semibold text-adm-ink mb-1">Reason for authorization</label>
                <textarea id="intake-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="Required for wholesale, remove, and information requests"
                  className="w-full rounded-md border border-adm-border bg-adm-surface p-2.5 text-[14px]" />
              </div>
              {!canDecide && (
                <p className="text-[12px] text-adm-muted">Intake decisions require a manager role; the server enforces this independently.</p>
              )}
            </div>
            <div className="border-t border-adm-border px-5 py-3 space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <button onClick={() => void decide(drawer, "authorize")} disabled={busy || !canDecide || drawer.state !== "AWAITING_MANAGER_AUTHORIZATION"}
                  title={drawer.state !== "AWAITING_MANAGER_AUTHORIZATION" ? "Only vehicles awaiting authorization can be authorized" : undefined}
                  className={cn(BTN_PRIMARY, (busy || !canDecide || drawer.state !== "AWAITING_MANAGER_AUTHORIZATION") && "opacity-50")}>
                  Authorize for Get Ready
                </button>
                <button onClick={() => void decide(drawer, "hold")} disabled={busy || !canDecide} className={cn(BTN_SECONDARY, (busy || !canDecide) && "opacity-50")}>Hold</button>
                <DropdownMenu>
                  <DropdownMenuTrigger className={cn(BTN_SECONDARY, "gap-1")}>More <ChevronDown className="h-5 w-5" aria-hidden="true" /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => navigate(`/get-ready-command/${drawer.vehicleId}`)}>Open detail</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy || !canDecide} onSelect={() => void decide(drawer, "info")}>Request information</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy || !canDecide} onSelect={() => void decide(drawer, "wholesale")}>Wholesale</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy || !canDecide} onSelect={() => void decide(drawer, "remove")}>Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </aside>
        </>
      )}
    </PageBody>
  );
}

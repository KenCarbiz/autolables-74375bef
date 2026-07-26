import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { canDispatchGetReady } from "@/lib/commandCenter/dispatchAuthority";
import {
  CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill, BTN_PRIMARY, BTN_SECONDARY,
} from "@/components/command/CommandPrimitives";
import {
  ClipboardCheck, PauseCircle, AlertTriangle, CheckCircle2, Search, ChevronRight, Car, X, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

// /get-ready-command — the used-car manager's fleet-level intake queue.
// Reads the STORED vehicle_lifecycle (never a client derivation) and issues
// the gate decisions through the atomic server RPCs:
//   Authorize for Get Ready  -> authorize_vehicle_for_get_ready
//   Hold / Request Info      -> set_vehicle_lifecycle_gate('ON_HOLD', reason)
//   Wholesale                -> set_vehicle_lifecycle_gate('WHOLESALE', reason)
//   Remove                   -> set_vehicle_lifecycle_gate('REMOVED', reason)
// Per-vehicle authorization detail stays at /get-ready-command/:vehicleId.

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

const STATE_PILL: Record<string, { label: string; tone: "amber" | "red" | "blue" | "slate" | "emerald" }> = {
  AWAITING_MANAGER_AUTHORIZATION: { label: "Awaiting authorization", tone: "amber" },
  PRELOAD_EXCEPTION: { label: "Preload exception", tone: "red" },
  ON_HOLD: { label: "On hold", tone: "slate" },
  WHOLESALE: { label: "Wholesale", tone: "slate" },
  REMOVED: { label: "Removed", tone: "slate" },
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
  const [tab, setTab] = useState<(typeof GATE_TABS)[number]["key"]>("awaiting");
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

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
  if (loading) return <div className="max-w-[1400px] mx-auto p-6 space-y-4"><LoadingCard rows={2} /><LoadingCard rows={6} /></div>;
  if (loadError) {
    return <div className="max-w-[1400px] mx-auto p-6">
      <ErrorCard message="We could not load the intake queue." detail={loadError} onRetry={() => void load()} />
    </div>;
  }

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Manager Intake & Authorization</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Fleet-level release queue after automatic nightly ingest. Authorization is the gate that releases service and detail work.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CommandStatCard label="Awaiting authorization" value={counts.awaiting} sub="Vehicles ready for review" Icon={ClipboardCheck} tone="amber" onClick={() => setTab("awaiting")} />
        <CommandStatCard label="Holds" value={counts.holds} sub="Awaiting manager follow-up" Icon={PauseCircle} tone="slate" onClick={() => setTab("holds")} />
        <CommandStatCard label="Exceptions" value={counts.exceptions} sub="Preload needs attention" Icon={AlertTriangle} tone="red" onClick={() => setTab("exceptions")} />
        <CommandStatCard label="Authorized today" value={authorizedToday} sub="Released to Get Ready" Icon={CheckCircle2} tone="emerald" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by year, make, model, or VIN"
            aria-label="Search intake queue"
            className="w-full h-11 pl-9 pr-3 rounded-lg border border-border bg-background text-sm" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {GATE_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className={cn("h-11 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-muted/60")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {visible.map((r) => {
          const pill = STATE_PILL[r.state] ?? { label: r.state, tone: "slate" as const };
          return (
            <article key={r.vehicleId} className="rounded-2xl border border-border bg-card p-3.5 flex items-center gap-3 flex-wrap">
              {r.photo
                ? <img src={r.photo} alt="" className="w-16 h-12 rounded-md object-cover border border-border shrink-0" />
                : <span className="w-16 h-12 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0"><Car className="w-5 h-5" aria-hidden="true" /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground truncate">{r.ymm}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  …{r.vin.slice(-6)} · {r.condition} · {r.ageDays}d in stock
                  {r.mileage != null ? ` · ${r.mileage.toLocaleString("en-US")} mi` : ""}
                  {r.price != null ? ` · $${r.price.toLocaleString("en-US")}` : ""}
                </p>
                {r.gateReason && <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{r.gateReason}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/do_not_drive|do-not-drive/i.test(r.recall) && <StatusPill tone="red">Do-not-drive recall</StatusPill>}
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                <button onClick={() => { setDrawer(r); setReason(""); }}
                  className="min-h-[44px] px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1">
                  Review <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
        {visible.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-6">
            <EmptyState Icon={CheckCircle2} title="Nothing waiting here"
              detail="New vehicles from tonight's ingest will arrive in this queue automatically. Existing inventory was grandfathered as authorized at rollout." />
          </div>
        )}
      </div>

      {drawer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setDrawer(null)} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label={`${drawer.ymm} intake review`}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[420px] bg-card border-l border-border shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h3 className="text-sm font-bold text-foreground">Intake review</h3>
              <button onClick={() => setDrawer(null)} aria-label="Close review" className="w-11 h-11 grid place-items-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="font-bold text-foreground">{drawer.ymm}</p>
                <p className="font-mono text-[11px] text-muted-foreground">VIN {drawer.vin} · {drawer.ageDays}d in stock</p>
              </div>
              <dl className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-muted-foreground">Asking price</dt><dd className="text-foreground font-semibold">{drawer.price != null ? `$${drawer.price.toLocaleString("en-US")}` : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Mileage</dt><dd className="text-foreground">{drawer.mileage != null ? `${drawer.mileage.toLocaleString("en-US")} mi` : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Recall</dt><dd className={/do_not_drive|do-not-drive/i.test(drawer.recall) ? "text-red-600 font-semibold" : "text-foreground"}>{drawer.recall ? drawer.recall.replace(/_/g, " ") : "None recorded"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Current state</dt><dd className="text-foreground">{(STATE_PILL[drawer.state] ?? { label: drawer.state }).label}</dd></div>
              </dl>
              <div>
                <label htmlFor="intake-reason" className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Note / reason
                </label>
                <textarea id="intake-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="Required for wholesale, remove, and information requests"
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" />
              </div>
              <div className="space-y-2">
                <button onClick={() => void decide(drawer, "authorize")} disabled={busy || !canDecide}
                  className={cn(BTN_PRIMARY, "w-full", (busy || !canDecide) && "opacity-50")}>
                  Authorize for Get Ready
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => void decide(drawer, "hold")} disabled={busy || !canDecide} className={cn(BTN_SECONDARY, (busy || !canDecide) && "opacity-50")}>Hold</button>
                  <button onClick={() => void decide(drawer, "info")} disabled={busy || !canDecide} className={cn(BTN_SECONDARY, (busy || !canDecide) && "opacity-50")}>Request Information</button>
                  <button onClick={() => void decide(drawer, "wholesale")} disabled={busy || !canDecide} className={cn(BTN_SECONDARY, (busy || !canDecide) && "opacity-50")}>Wholesale</button>
                  <button onClick={() => void decide(drawer, "remove")} disabled={busy || !canDecide} className={cn(BTN_SECONDARY, (busy || !canDecide) && "opacity-50")}>Remove</button>
                </div>
                <button onClick={() => navigate(`/get-ready-command/${drawer.vehicleId}`)} className={cn(BTN_SECONDARY, "w-full")}>
                  <FileText className="w-4 h-4" aria-hidden="true" /> Open authorization detail
                </button>
              </div>
              {!canDecide && (
                <p className="text-[11.5px] text-muted-foreground">Intake decisions require a manager role; the server enforces this independently.</p>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useVinScan } from "@/contexts/VinScanContext";
import { deriveServiceStatus } from "@/lib/service/serviceStatus";
import {
  ClipboardList, ShieldCheck, AlertTriangle, CheckCircle2, Clock, XCircle,
  Search, QrCode, ChevronRight, Loader2, CircleDot, Circle, Wrench,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Service Desk queue — the ONE landing for service writers/managers.
//
// Phase 1 of the unified Service Desk: one row per used/CPO vehicle with a
// derived service status and a single clear next action, computed from the data
// we already keep (get_ready_records + safety_inspections + recall) — no new
// table. Clicking a row (or its Next Action) opens that exact vehicle's service
// workspace. Additional-work approval + manager messaging land in later phases.
// ──────────────────────────────────────────────────────────────

export interface QueueVeh { id: string; vin: string; ymm: string | null; }

interface Row {
  id: string; vin: string; ymm: string; trim: string; stock: string; photo: string;
  condition: string;
  grState: "not_started" | "in_progress" | "complete" | "failed";
  k208State: "waiting" | "ready" | "executed" | "blocked";
  delivery: string;
  next: { label: string; tone: "primary" | "danger" | "ghost" };
  priority: "High" | "Medium" | "Low";
  bucket: "get_ready" | "in_progress" | "failed" | "ready_to_sign" | "done";
  completedToday: boolean;
  awaiting: boolean;
}

const isToday = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

// deno-lint-ignore no-explicit-any
function derive(v: any, gr: any, si: any, awaiting: boolean): Row {
  const s = deriveServiceStatus(v, gr, si, awaiting);
  const certified = !!(si && si.licensee_certified_at);
  const grState = s.grState;
  const k208State = s.k208State;
  const next: Row["next"] = { label: s.nextLabel, tone: s.nextTone };
  const priority = s.priority;
  const bucket: Row["bucket"] = s.cleared ? "done"
    : s.k208State === "blocked" ? "failed"
    : s.k208State === "ready" ? "ready_to_sign"
    : s.grState === "in_progress" ? "in_progress"
    : "get_ready";
  const delivery = s.blocked ? "Delivery blocked" : s.cleared ? "Cleared" : v.status === "published" ? "In stock" : "Draft";

  const ymm = String(v.ymm || "Vehicle");
  const parts = ymm.split(/\s+/);
  return {
    id: v.id, vin: (v.vin || "").toUpperCase(), ymm, trim: parts.slice(3).join(" "),
    stock: (v.mc_attributes?.stock_no as string) || "",
    photo: (v.hero_image_url as string) || (Array.isArray(v.mc_attributes?.photo_links) ? v.mc_attributes.photo_links[0] : "") || "",
    condition: String(v.condition || "used").toUpperCase(),
    grState, k208State, delivery, next, priority, bucket, awaiting,
    completedToday: certified && isToday(si?.licensee_certified_at),
  };
}

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "get_ready", label: "Get Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "failed", label: "Failed" },
  { key: "ready_to_sign", label: "Ready to Sign" },
  { key: "done", label: "Completed" },
];

const GR_CHIP: Record<Row["grState"], { label: string; cls: string; Icon: typeof Circle }> = {
  not_started: { label: "Not started", cls: "text-slate-500", Icon: Circle },
  in_progress: { label: "In progress", cls: "text-amber-600", Icon: CircleDot },
  complete: { label: "Work complete", cls: "text-emerald-600", Icon: CheckCircle2 },
  failed: { label: "Failed items", cls: "text-red-600", Icon: XCircle },
};
const K208_CHIP: Record<Row["k208State"], { label: string; cls: string; Icon: typeof Circle }> = {
  waiting: { label: "Waiting", cls: "text-slate-500", Icon: Clock },
  ready: { label: "Ready to execute", cls: "text-blue-600", Icon: Clock },
  blocked: { label: "Blocked", cls: "text-red-600", Icon: AlertTriangle },
  executed: { label: "Executed", cls: "text-emerald-600", Icon: CheckCircle2 },
};

export default function ServiceQueue({ onOpen }: { onOpen: (v: QueueVeh) => void }) {
  const { tenant } = useTenant();
  const { openScan } = useVinScan();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!tenant?.id) { setLoading(false); return; }
      const { data: vehicles } = await (supabase as any).from("vehicle_listings")
        .select("id, vin, ymm, condition, status, mc_attributes")
        .eq("tenant_id", tenant.id)
        .in("condition", ["used", "cpo", "certified"])
        .order("created_at", { ascending: false })
        .limit(300);
      const vs = (vehicles as any[]) || [];
      const vins = vs.map((v) => v.vin).filter(Boolean);
      const [grRes, siRes, srRes] = await Promise.all([
        vins.length ? (supabase as any).from("get_ready_records").select("vin, status, items, get_ready_complete_date").eq("tenant_id", tenant.id).in("vin", vins) : Promise.resolve({ data: [] }),
        vins.length ? (supabase as any).from("safety_inspections").select("vin, status, result, licensee_certified_at, signed_at").eq("tenant_id", tenant.id).eq("status", "signed").in("vin", vins).order("signed_at", { ascending: false }) : Promise.resolve({ data: [] }),
        vins.length ? (supabase as any).from("service_requests").select("vin").eq("tenant_id", tenant.id).eq("status", "pending").in("vin", vins) : Promise.resolve({ data: [] }),
      ]);
      const grByVin = new Map<string, any>();
      for (const g of ((grRes.data as any[]) || [])) if (!grByVin.has(g.vin)) grByVin.set(g.vin, g);
      const siByVin = new Map<string, any>();
      for (const s of ((siRes.data as any[]) || [])) if (!siByVin.has(s.vin)) siByVin.set(s.vin, s); // first = latest signed
      const awaitingVins = new Set<string>(((srRes.data as any[]) || []).map((r) => r.vin));
      if (off) return;
      setRows(vs.map((v) => derive(v, grByVin.get(v.vin), siByVin.get(v.vin), awaitingVins.has(v.vin))));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [tenant?.id]);

  const stats = useMemo(() => ({
    pending: rows.filter((r) => r.grState === "not_started" || r.grState === "in_progress").length,
    ready: rows.filter((r) => r.k208State === "ready").length,
    blocked: rows.filter((r) => r.k208State === "blocked").length,
    doneToday: rows.filter((r) => r.completedToday).length,
  }), [rows]);

  const attention = useMemo(() =>
    rows.filter((r) => r.k208State === "blocked" || (r.grState === "not_started")).slice(0, 2), [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.bucket !== filter) return false;
      if (term && !(`${r.ymm} ${r.vin} ${r.stock}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, filter, q]);

  if (loading) return <div className="p-10 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const Tile = ({ icon: Icon, label, n, tone }: { icon: typeof ClipboardList; label: string; n: number; tone: string }) => (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <span className={`w-11 h-11 rounded-xl grid place-items-center ${tone}`}><Icon className="w-5 h-5" /></span>
      <div><p className="text-[26px] font-black leading-none tabular-nums text-foreground">{n}</p><p className="text-xs text-muted-foreground mt-1">{label}</p></div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN or stock #"
            className="w-full h-11 pl-9 pr-3 rounded-lg border border-border bg-background text-sm" />
        </div>
        <button onClick={openScan} className="h-11 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted"><QrCode className="w-4 h-4" /> Scan Service QR</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={ClipboardList} label="Pending work" n={stats.pending} tone="bg-blue-50 text-blue-600" />
        <Tile icon={ShieldCheck} label="K-208 ready" n={stats.ready} tone="bg-emerald-50 text-emerald-600" />
        <Tile icon={AlertTriangle} label="Blocked / exceptions" n={stats.blocked} tone="bg-red-50 text-red-600" />
        <Tile icon={CheckCircle2} label="Completed today" n={stats.doneToday} tone="bg-slate-100 text-slate-600" />
      </div>

      {attention.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Needs attention</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {attention.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <VehThumb r={r} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">{r.ymm}</p>
                  <p className={`text-xs font-semibold ${r.k208State === "blocked" ? "text-red-600" : "text-amber-600"}`}>
                    {r.k208State === "blocked" ? "Delivery blocked — needs repair" : "Inspection not started"}
                  </p>
                </div>
                <button onClick={() => onOpen(r)} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shrink-0">{r.next.label}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 pt-4 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-body font-bold text-foreground">Vehicles requiring service action</h2>
        </div>
        <div className="px-4 pt-3 flex items-center gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap ${filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{f.label}</button>
          ))}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                <th className="text-left font-semibold px-4 py-2.5">Vehicle</th>
                <th className="text-left font-semibold px-4 py-2.5">Stock / VIN</th>
                <th className="text-left font-semibold px-4 py-2.5">Get Ready</th>
                <th className="text-left font-semibold px-4 py-2.5">K-208</th>
                <th className="text-left font-semibold px-4 py-2.5">Delivery</th>
                <th className="text-right font-semibold px-4 py-2.5">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visible.map((r) => {
                const G = GR_CHIP[r.grState]; const K = K208_CHIP[r.k208State];
                return (
                  <tr key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)}>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold ${r.priority === "High" ? "text-red-600" : r.priority === "Medium" ? "text-amber-600" : "text-slate-400"}`}>{r.priority}</span>
                    </td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2.5 min-w-0"><VehThumb r={r} /><div className="min-w-0"><p className="font-semibold text-foreground truncate">{r.ymm}</p><p className="text-[11px] text-muted-foreground">{r.condition}{r.trim ? ` · ${r.trim}` : ""}</p></div></div></td>
                    <td className="px-4 py-2.5"><p className="font-mono text-[12px] text-foreground">{r.stock || "—"}</p><p className="font-mono text-[11px] text-muted-foreground">…{r.vin.slice(-6)}</p></td>
                    <td className="px-4 py-2.5">{r.awaiting
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5" /> Awaiting approval</span>
                      : <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${G.cls}`}><G.Icon className="w-3.5 h-3.5" /> {G.label}</span>}</td>
                    <td className="px-4 py-2.5"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${K.cls}`}><K.Icon className="w-3.5 h-3.5" /> {K.label}</span></td>
                    <td className="px-4 py-2.5"><span className={`text-xs font-medium ${r.delivery === "Delivery blocked" ? "text-red-600" : r.delivery === "Cleared" ? "text-emerald-600" : "text-muted-foreground"}`}>{r.delivery}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={(e) => { e.stopPropagation(); onOpen(r); }}
                        className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${r.next.tone === "danger" ? "bg-red-600 text-white" : r.next.tone === "ghost" ? "border border-border text-foreground hover:bg-muted" : "bg-primary text-primary-foreground"}`}>
                        {r.next.tone === "ghost" ? null : <Wrench className="w-3.5 h-3.5" />} {r.next.label} <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No vehicles in this view.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VehThumb({ r }: { r: Row }) {
  return r.photo
    ? <img src={r.photo} alt="" className="w-12 h-9 rounded-md object-cover border border-border shrink-0" />
    : <span className="w-12 h-9 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0"><Wrench className="w-4 h-4" /></span>;
}

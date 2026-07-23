import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Printer, Layers, Car, FileText, ShieldCheck, BookOpen, Tag, QrCode, Loader2, ArrowUpRight } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Print Queue — the operator's batch-printing cockpit.
//
// Two ways to run a stack of stickers:
//  · By type   — every vehicle that needs a given label, grouped so the
//                operator loads ONE label stock and runs the whole batch.
//  · By vehicle — a per-vehicle packet listing the labels in load order.
//
// Each row links to that vehicle's existing per-artifact print target; the
// queue is the worklist + ordering layer over them.
// ──────────────────────────────────────────────────────────────

type Cond = "new" | "used" | "cpo" | "certified" | null;
interface Row { id: string; vin: string; ymm: string | null; condition: Cond; stock: string | null; status: string }

// Printable artifacts in the order an operator should load + run them per
// vehicle. `href` opens the vehicle's existing print/generate target.
const ARTIFACTS: { key: string; label: string; icon: typeof Tag; usedOnly: boolean; href: (r: Row) => string; load: string }[] = [
  { key: "window", label: "Window sticker", icon: Tag, usedOnly: false, load: "Window-sticker stock", href: (r) => `${r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker"}?vehicleId=${r.id}` },
  { key: "addendum", label: "Addendum sticker", icon: FileText, usedOnly: false, load: "Addendum stock", href: (r) => `/vehicle-file/${r.id}?tab=labels` },
  { key: "buyers_guide", label: "FTC Buyers Guide", icon: BookOpen, usedOnly: true, load: "Letter paper", href: (r) => `/vehicle-file/${r.id}?tab=deal` },
  { key: "k208", label: "CT K-208", icon: ShieldCheck, usedOnly: true, load: "Letter paper", href: (r) => `/k208/${r.vin}` },
  { key: "qr", label: "Service QR sheet", icon: QrCode, usedOnly: true, load: "Label / cling stock", href: (r) => `/print/vehicle-qr/${r.vin}` },
];

export default function PrintQueue() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"type" | "vehicle">("type");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!tenant?.id) { setLoading(false); return; }
      const { data } = await (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, mc_attributes, status")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(300);
      if (off) return;
      setRows(((data as any[]) || []).map((v) => ({ id: v.id, vin: v.vin, ymm: v.ymm, condition: v.condition, stock: (v.mc_attributes?.stock_no as string) || null, status: v.status })));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [tenant?.id]);

  const isUsed = (r: Row) => r.condition !== "new";
  const artifactsFor = (r: Row) => ARTIFACTS.filter((a) => !a.usedOnly || isUsed(r));

  // Group vehicles under each artifact type for the batch view.
  const byType = useMemo(() =>
    ARTIFACTS.map((a) => ({ art: a, vehicles: rows.filter((r) => (!a.usedOnly || isUsed(r))) })), [rows]);

  if (loading) return <div className="p-8 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4 lg:p-7 max-w-[1100px] mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-black tracking-tight text-foreground inline-flex items-center gap-2"><Printer className="w-6 h-6 text-primary" /> Print Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Run a whole batch of one label type, or print a per-vehicle packet in load order.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView("type")} className={`h-10 px-4 text-sm font-semibold inline-flex items-center gap-1.5 ${view === "type" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}><Layers className="w-4 h-4" /> By type</button>
          <button onClick={() => setView("vehicle")} className={`h-10 px-4 text-sm font-semibold inline-flex items-center gap-1.5 ${view === "vehicle" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}><Car className="w-4 h-4" /> By vehicle</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vehicles in inventory yet.</p>
      ) : view === "type" ? (
        <div className="space-y-4">
          {byType.map(({ art, vehicles }) => {
            const Icon = art.icon;
            return (
              <div key={art.key} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 bg-muted/40">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><Icon className="w-4 h-4" /></span>
                    <div>
                      <p className="text-sm font-bold text-foreground">{art.label}</p>
                      <p className="text-[11px] text-muted-foreground">Load: {art.load} · {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-border/60 max-h-72 overflow-auto">
                  {vehicles.map((r) => (
                    <button key={r.id} onClick={() => navigate(art.href(r))} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
                      <span className="text-sm font-medium text-foreground flex-1 truncate">{r.ymm || "Vehicle"}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{r.stock || `…${r.vin.slice(-6)}`}</span>
                      <span className="text-[12px] font-semibold text-blue-600 inline-flex items-center gap-0.5">Print <ArrowUpRight className="w-3.5 h-3.5" /></span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r) => {
            const arts = artifactsFor(r);
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{r.ymm || "Vehicle"}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{r.stock ? `Stock ${r.stock} · ` : ""}…{r.vin.slice(-8)}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">{r.condition || "used"}</span>
                </div>
                <ol className="space-y-1">
                  {arts.map((a, i) => {
                    const Icon = a.icon;
                    return (
                      <li key={a.key}>
                        <button onClick={() => navigate(a.href(r))} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/50 text-left">
                          <span className="w-5 text-[11px] font-bold text-muted-foreground tabular-nums">{i + 1}.</span>
                          <Icon className="w-4 h-4 text-slate-500" />
                          <span className="text-[13px] text-foreground flex-1">{a.label}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-blue-600" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

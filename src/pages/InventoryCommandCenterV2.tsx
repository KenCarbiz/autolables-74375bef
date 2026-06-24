import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import {
  Car, Search, CheckCircle2, AlertTriangle, ShieldCheck, ShieldAlert, Eye,
  Pencil, Printer, MoreVertical, Plus, Tag, FileSignature, CircleDollarSign,
  ScanLine, TrendingUp, ArrowRight, RefreshCw, ChevronRight, Settings, Upload,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// InventoryCommandCenterV2 — /inventory-v2  (DRAFT)
//
// Standalone next-gen Inventory Command Center built alongside the
// live /inventory page (InventoryModern), which is left untouched.
// Reuses the exact same Supabase queries; only the presentation layer
// is new. Promote to /inventory only after approval.
// ──────────────────────────────────────────────────────────────

interface VRow {
  id: string; vin: string; ymm: string | null; trim: string | null;
  mileage: number | null; condition: "new" | "used" | "cpo" | null;
  price: number | null; status: "draft" | "published" | "archived";
  slug: string; published_at: string | null; updated_at: string;
  stock_number?: string | null; hero_image_url?: string | null;
  recall_status?: string | null; open_recall_count?: number | null;
  market_position?: string | null; market_value?: number | null;
}

type Sev = "critical" | "warn" | "ok" | "info";
const SEV: Record<Sev, { dot: string; text: string; bg: string; ring: string }> = {
  critical: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", ring: "border-red-200" },
  warn: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "border-amber-200" },
  ok: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", ring: "border-emerald-200" },
  info: { dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", ring: "border-blue-200" },
};

const fmt$ = (n: number | null | undefined) => (n != null ? `$${Math.round(n).toLocaleString()}` : "—");

// Per-row signal + readiness, all from real data.
const signalOf = (r: VRow, hasAddendum: boolean) => {
  const decoded = !!r.ymm;
  const openRecall = (r.open_recall_count || 0) > 0 || r.recall_status === "open_recalls";
  const recallClear = r.recall_status === "clear";
  const hasPrice = r.price != null;
  const published = r.status === "published";
  const checks = [decoded, hasAddendum, !openRecall, hasPrice];
  const score = checks.filter(Boolean).length / checks.length;
  return { decoded, openRecall, recallClear, hasPrice, hasAddendum, published, score, readyToPublish: !published && score === 1 };
};

const Ring = ({ pct, size = 76 }: { pct: number; size?: number }) => {
  const r = 32; const c = 2 * Math.PI * r;
  const tone = pct >= 80 ? "#10B981" : pct >= 50 ? "#2563EB" : "#F59E0B";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox="0 0 80 80" style={{ width: size, height: size }}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="#eef1f4" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold tabular-nums">{pct}%</span>
    </div>
  );
};

const Kpi = ({ label, value, sub, accent, cta, children }: { label: string; value?: React.ReactNode; sub?: React.ReactNode; accent?: string; cta?: { label: string; onClick: () => void }; children?: React.ReactNode }) => (
  <div className="rounded-2xl border border-[#eef1f4] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 min-w-0 flex flex-col">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    {children ?? (
      <>
        <p className={`text-[34px] font-extrabold leading-none mt-2 ${accent || "text-slate-900"}`}>{value}</p>
        {sub && <div className="text-[11px] text-slate-500 mt-1.5">{sub}</div>}
      </>
    )}
    {cta && <button onClick={cta.onClick} className="mt-3 text-[12px] font-semibold text-blue-600 inline-flex items-center gap-1 hover:gap-1.5 transition-all self-start">{cta.label} <ArrowRight className="w-3.5 h-3.5" /></button>}
  </div>
);

const Pill = ({ sev, children }: { sev: Sev; children: React.ReactNode }) => {
  const s = SEV[sev];
  return <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text} ${s.ring}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{children}</span>;
};

const InventoryCommandCenterV2 = () => {
  const { tenant } = useTenant();
  const { settings, updateSettings } = useDealerSettings();
  const navigate = useNavigate();
  const quickActionsOn = settings.inventory_show_quick_actions;
  const [showSettings, setShowSettings] = useState(false);
  const [rows, setRows] = useState<VRow[]>([]);
  const [addVins, setAddVins] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<{ at: string | null; status: string | null }>({ at: null, status: null });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [condFilter, setCondFilter] = useState<string>("all");
  const [sort, setSort] = useState<"updated" | "price" | "ymm">("updated");
  const [tab, setTab] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  useEffect(() => { setPage(1); }, [q, statusFilter, condFilter, tab, sort, perPage]);

  useEffect(() => {
    if (!tenant?.id) return;
    let on = true;
    (async () => {
      setLoading(true);
      const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,updated_at";
      const runSelect = (cols: string) => (supabase as any).from("vehicle_listings").select(cols)
        .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`).order("updated_at", { ascending: false }).limit(500);
      const isSchemaErr = (e: { message?: string; code?: string } | null) =>
        !!e && (/column|does not exist|schema cache/i.test(e.message || "") || ["42703", "PGRST204", "42P01"].includes(e.code || ""));
      let data: unknown = null; let error: { message?: string; code?: string } | null = null;
      for (const cols of [
        `${baseCols},hero_image_url,recall_status,open_recall_count,market_position,market_value`,
        `${baseCols},hero_image_url,recall_status,open_recall_count`,
        baseCols,
      ]) {
        const res = await runSelect(cols);
        if (!res.error) { data = res.data; error = null; break; }
        error = res.error; if (!isSchemaErr(res.error)) break;
      }
      if (!on) return;
      if (error) { toast.error("Couldn't load inventory"); setLoading(false); return; }
      let list = (data || []) as VRow[];
      const vins = list.map((r) => r.vin).filter(Boolean);
      const ad = new Set<string>();
      if (vins.length) {
        try {
          const [{ data: allAdd }, { data: vfiles }] = await Promise.all([
            (supabase as any).from("addendums").select("vehicle_vin").in("vehicle_vin", vins),
            (supabase as any).from("vehicle_files").select("vin, stock_number, deal_status").in("vin", vins),
          ]);
          for (const a of (allAdd || []) as Array<{ vehicle_vin: string }>) ad.add((a.vehicle_vin || "").toUpperCase());
          const stockByVin = new Map<string, string>(); const delivered = new Set<string>();
          for (const f of (vfiles || []) as Array<{ vin: string; stock_number: string | null; deal_status: string }>) {
            const v = (f.vin || "").toUpperCase();
            if (f.stock_number) stockByVin.set(v, f.stock_number);
            if (f.deal_status === "delivered") delivered.add(v);
          }
          list = list.filter((r) => !delivered.has((r.vin || "").toUpperCase()))
            .map((r) => ({ ...r, stock_number: stockByVin.get((r.vin || "").toUpperCase()) ?? r.stock_number ?? null }));
        } catch { /* not migrated yet */ }
      }
      setRows(list); setAddVins(ad);
      try {
        const { data: cfg } = await (supabase as any).from("marketcheck_sync_config").select("last_run_at, last_status").eq("tenant_id", tenant.id).maybeSingle();
        setLastSync({ at: cfg?.last_run_at ?? null, status: cfg?.last_status ?? null });
      } catch { /* noop */ }
      setLoading(false);
    })();
    return () => { on = false; };
  }, [tenant?.id]);

  // ── Aggregates ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const sig = (r: VRow) => signalOf(r, addVins.has((r.vin || "").toUpperCase()));
    const published = rows.filter((r) => r.status === "published");
    const drafts = rows.filter((r) => r.status !== "published");
    const openRecalls = rows.filter((r) => sig(r).openRecall);
    const missingAddendum = rows.filter((r) => !sig(r).hasAddendum);
    const missingSticker = drafts;
    const vinIssues = rows.filter((r) => !r.ymm);
    const priceReview = rows.filter((r) => r.market_position === "above_market" || r.price == null);
    const blocked = drafts.filter((r) => { const s = sig(r); return !s.decoded || !s.hasAddendum || s.openRecall; });
    const readyToPublish = rows.filter((r) => sig(r).readyToPublish);
    const needsAttention = rows.filter((r) => { const s = sig(r); return (r.status !== "published") || s.openRecall || !s.hasAddendum; });
    const avgScore = rows.length ? Math.round((rows.reduce((a, r) => a + sig(r).score, 0) / rows.length) * 100) : 0;
    const deltas = rows.map((r) => (r.market_value != null && r.price != null ? r.market_value - r.price : null)).filter((x): x is number => x != null);
    const avgDelta = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;
    return {
      total: rows.length,
      published, publishedN: published.length,
      newN: rows.filter((r) => r.condition === "new").length,
      usedN: rows.filter((r) => r.condition === "used").length,
      cpoN: rows.filter((r) => r.condition === "cpo").length,
      openRecalls, missingAddendum, missingSticker, vinIssues, priceReview, blocked, readyToPublish, needsAttention,
      avgScore, avgDelta, decoded: rows.filter((r) => r.ymm).length,
    };
  }, [rows, addVins]);

  // ── Filtered/sorted rows ────────────────────────────────────
  const visible = useMemo(() => {
    const sig = (r: VRow) => signalOf(r, addVins.has((r.vin || "").toUpperCase()));
    let out = rows.filter((r) => {
      if (condFilter !== "all" && r.condition !== condFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (tab === "new" && r.condition !== "new") return false;
      if (tab === "used" && r.condition !== "used") return false;
      if (tab === "cpo" && r.condition !== "cpo") return false;
      if (tab === "published" && r.status !== "published") return false;
      if (tab === "draft" && r.status === "published") return false;
      if (tab === "needs_sticker" && r.status === "published") return false;
      if (tab === "missing_addendum" && sig(r).hasAddendum) return false;
      if (tab === "price_review" && !(r.market_position === "above_market" || r.price == null)) return false;
      if (q.trim()) {
        const hay = `${r.vin} ${r.stock_number || ""} ${r.ymm || ""} ${r.trim || ""}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) =>
      sort === "price" ? (b.price || 0) - (a.price || 0)
      : sort === "ymm" ? (a.ymm || "").localeCompare(b.ymm || "")
      : (b.updated_at || "").localeCompare(a.updated_at || ""));
    return out;
  }, [rows, addVins, q, statusFilter, condFilter, tab, sort]);

  const syncedLabel = lastSync.at ? `Synced ${new Date(lastSync.at).toLocaleDateString() === new Date().toLocaleDateString() ? "Today" : new Date(lastSync.at).toLocaleDateString()} · ${new Date(lastSync.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sync pending";

  const openFile = (r: VRow) => navigate(`/vehicle-file/${r.id}`);
  const openPassport = (r: VRow) => r.status === "published" ? window.open(`/v/${(r.vin || r.slug).toUpperCase()}`, "_blank", "noopener") : navigate(`/vehicle-file/${r.id}`);

  const tabs = [
    { id: "all", label: "All Vehicles", n: stats.total },
    { id: "new", label: "New", n: stats.newN },
    { id: "used", label: "Used", n: stats.usedN },
    { id: "cpo", label: "CPO", n: stats.cpoN },
    { id: "needs_sticker", label: "Needs Sticker", n: stats.missingSticker.length },
    { id: "missing_addendum", label: "Missing Addendum", n: stats.missingAddendum.length },
    { id: "price_review", label: "Price Review", n: stats.priceReview.length },
    { id: "published", label: "Published", n: stats.publishedN },
    { id: "draft", label: "Draft", n: stats.total - stats.publishedN },
  ];

  const PRIO: Record<Sev, string> = { critical: "High Priority", warn: "Medium Priority", ok: "Low Priority", info: "Priority" };
  const priorities: { icon: React.ElementType; label: string; n: number; sev: Sev; onClick: () => void }[] = [
    { icon: Tag, label: "Missing Stickers", n: stats.missingSticker.length, sev: "critical", onClick: () => setTab("needs_sticker") },
    { icon: FileSignature, label: "Missing Addendums", n: stats.missingAddendum.length, sev: "warn", onClick: () => setTab("missing_addendum") },
    { icon: CircleDollarSign, label: "Price Verification", n: stats.priceReview.length, sev: "warn", onClick: () => setTab("price_review") },
    { icon: ShieldAlert, label: "Open Recalls", n: stats.openRecalls.length, sev: stats.openRecalls.length ? "critical" : "ok", onClick: () => setStatusFilter("all") },
    { icon: ScanLine, label: "VIN Issues", n: stats.vinIssues.length, sev: stats.vinIssues.length ? "critical" : "ok", onClick: () => {} },
  ];

  const quickActions: { icon: React.ElementType; label: string; onClick: () => void }[] = [
    { icon: Plus, label: "Add Vehicle", onClick: () => navigate("/add-inventory") },
    { icon: ScanLine, label: "Scan VIN", onClick: () => navigate("/add-inventory") },
    { icon: Printer, label: "Generate Sticker", onClick: () => navigate("/new-car-sticker") },
    { icon: CircleDollarSign, label: "Verify Prices", onClick: () => navigate("/inventory") },
    { icon: ShieldAlert, label: "Check Recalls", onClick: () => navigate("/inventory") },
    { icon: Upload, label: "CSV Import", onClick: () => navigate("/add-inventory") },
    { icon: TrendingUp, label: "Publish Vehicles", onClick: () => setTab("draft") },
  ];

  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const pageRows = visible.slice((page - 1) * perPage, page * perPage);

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  );

  return (
    <div className="p-4 lg:px-6 lg:py-5 max-w-[1600px] mx-auto">
      {/* The page title now lives in the global AppShell header (pageTitles).
          This thin row only carries the draft marker + admin settings. */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700">V2 Draft</span>
        <div className="relative shrink-0">
          <button onClick={() => setShowSettings((v) => !v)} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white border border-[#e8ebef] text-sm font-semibold hover:bg-slate-50">
            <Settings className="w-4 h-4 text-slate-500" /> <span className="hidden sm:inline">Dashboard settings</span>
          </button>
          {showSettings && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
              <div className="absolute right-0 mt-2 w-[330px] rounded-2xl border border-[#e8ebef] bg-white shadow-lg z-20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dashboard Layout</p>
                <div className="flex items-start gap-3 mt-3">
                  <button
                    onClick={() => updateSettings({ inventory_show_quick_actions: !quickActionsOn })}
                    role="switch" aria-checked={quickActionsOn} aria-label="Show Quick Actions Panel"
                    className={`mt-0.5 w-10 h-6 rounded-full flex items-center px-0.5 shrink-0 transition-colors ${quickActionsOn ? "bg-blue-600 justify-end" : "bg-slate-300 justify-start"}`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow" />
                  </button>
                  <div>
                    <p className="text-[13px] font-semibold">Show Quick Actions Panel</p>
                    <p className="text-[11px] text-slate-500 leading-snug mt-0.5">Display a Quick Actions panel on the Inventory Command Center. Recommended for inventory managers who frequently create stickers, addendums, imports, and price checks. Disabled by default for a cleaner executive dashboard.</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4 mb-6">
        <Kpi label="Inventory Readiness" cta={{ label: "View readiness", onClick: () => setTab("draft") }}>
          <div className="flex items-center gap-3 mt-2">
            <Ring pct={stats.avgScore} />
            <div>
              <p className="text-[22px] font-extrabold leading-none">{stats.readyToPublish.length}<span className="text-sm font-bold text-slate-400"> / {stats.total}</span></p>
              <p className="text-[11px] text-slate-500 mt-0.5">Ready to publish</p>
            </div>
          </div>
        </Kpi>
        <Kpi label="Total Vehicles" value={stats.total} sub={<>{stats.newN} New · {stats.usedN} Used{stats.cpoN ? ` · ${stats.cpoN} CPO` : ""}</>} cta={{ label: "View all", onClick: () => setTab("all") }} />
        <Kpi label="Published" value={stats.publishedN} accent="text-emerald-600" sub="Live on portal" cta={{ label: "View published", onClick: () => setTab("published") }} />
        <Kpi label="Needs Attention" value={stats.needsAttention.length} accent={stats.needsAttention.length ? "text-amber-600" : "text-slate-900"} sub="Require action" cta={{ label: "View list", onClick: () => setTab("draft") }} />
        <Kpi label="Open Recalls" value={stats.openRecalls.length} accent={stats.openRecalls.length ? "text-red-600" : "text-emerald-600"} sub="Vehicles" cta={{ label: "View recalls", onClick: () => setTab("all") }} />
        <Kpi label="Price Reviews" value={stats.priceReview.length} accent="text-violet-600" sub="Require review" cta={{ label: "View reviews", onClick: () => setTab("price_review") }} />
        <Kpi label="Market Position" value={stats.avgDelta != null ? fmt$(Math.abs(stats.avgDelta)) : "—"} accent={stats.avgDelta != null && stats.avgDelta >= 0 ? "text-emerald-600" : "text-amber-600"} sub={stats.avgDelta == null ? "No data" : stats.avgDelta >= 0 ? "Below market avg" : "Above market avg"} cta={{ label: "Market report", onClick: () => navigate("/dashboard/reports") }} />
      </div>

      {/* Body: main + sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        <div className="min-w-0 space-y-4">
          {/* Priority Queue */}
          <div>
            <h2 className="text-[15px] font-bold mb-2">Priority Queue</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {priorities.map((p) => {
                const s = SEV[p.sev];
                return (
                  <button key={p.label} onClick={p.onClick} className="text-left rounded-2xl border border-[#eef1f4] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-3.5 hover:shadow-md transition-shadow group">
                    <div className="flex items-center justify-between">
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.bg}`}><p.icon className={`w-4 h-4 ${s.text}`} /></span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500" />
                    </div>
                    <p className={`text-[26px] font-extrabold leading-none mt-2 ${p.n ? s.text : "text-slate-900"}`}>{p.n}</p>
                    <p className="text-[12px] text-slate-600 font-medium mt-1">{p.label}</p>
                    <p className={`text-[10px] font-bold uppercase tracking-wide mt-0.5 ${s.text}`}>{PRIO[p.sev]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toolbar */}
          <div className="rounded-2xl border border-[#e8ebef] bg-white p-3 flex flex-col gap-3">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock #, year, make, model, trim…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#e8ebef] text-sm outline-none focus:border-blue-500" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-[#e8ebef] text-sm bg-white">
                <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
              </select>
              <select value={condFilter} onChange={(e) => setCondFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-[#e8ebef] text-sm bg-white">
                <option value="all">New &amp; Used</option><option value="new">New</option><option value="used">Used</option><option value="cpo">CPO</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-10 px-3 rounded-xl border border-[#e8ebef] text-sm bg-white">
                <option value="updated">Sort: Last Updated</option><option value="price">Sort: Price</option><option value="ymm">Sort: Year/Make</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`h-8 px-3 rounded-lg text-[12px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5 ${tab === t.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {t.label}<span className={`text-[10px] font-bold ${tab === t.id ? "text-white/80" : "text-slate-400"}`}>{t.n}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-[#eef1f4] bg-white overflow-hidden">
            <div className="hidden lg:grid grid-cols-[1.8fr_0.9fr_1fr_1.3fr_1.1fr_0.7fr_1fr] gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-[#eef1f4] sticky top-0 z-10 bg-white/95 backdrop-blur">
              <span>Vehicle</span><span>Stock / VIN</span><span>Readiness</span><span>Compliance</span><span>Advertised Price</span><span>Publishing</span><span className="text-right">Actions</span>
            </div>
            {pageRows.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">No vehicles match these filters.</div>
            ) : pageRows.map((r) => {
              const s = signalOf(r, addVins.has((r.vin || "").toUpperCase()));
              const pct = Math.round(s.score * 100);
              const tone: Sev = s.published ? "ok" : pct === 100 ? "ok" : pct >= 50 ? "warn" : "critical";
              const label = s.published ? "Published" : pct === 100 ? "Ready" : pct >= 50 ? "Warning" : "Critical";
              return (
                <div key={r.id} className="grid grid-cols-1 lg:grid-cols-[1.8fr_0.9fr_1fr_1.3fr_1.1fr_0.7fr_1fr] gap-3 px-4 py-2.5 items-center border-b border-[#f4f6f8] last:border-0 hover:bg-slate-50/70 transition-colors">
                  {/* Vehicle */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-[56px] h-[38px] rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
                      {r.hero_image_url ? <img src={r.hero_image_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Car className="w-4 h-4 text-slate-300" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-[13px] truncate">{r.ymm || "(needs decode)"}</p>
                        {r.condition && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{r.condition}</span>}
                      </div>
                      {r.trim && <p className="text-[11px] text-slate-400 truncate">{r.trim}</p>}
                    </div>
                  </div>
                  {/* Stock / VIN */}
                  <div className="text-[12px] font-mono leading-tight">
                    <p className="text-slate-600">{r.stock_number || "—"}</p><p className="text-slate-400">…{(r.vin || "").slice(-6)}</p>
                  </div>
                  {/* Readiness — ring */}
                  <div className="flex items-center gap-2" title={`${pct}% ready`}>
                    <Ring pct={s.published ? 100 : pct} size={34} />
                    <span className={`text-[11px] font-semibold ${SEV[tone].text}`}>{label}</span>
                  </div>
                  {/* Compliance */}
                  <div className="flex flex-col gap-1 items-start">
                    {s.decoded ? <Pill sev="ok">VIN Verified</Pill> : <Pill sev="critical">VIN Issue</Pill>}
                    {s.openRecall ? <Pill sev="critical">Recall Pending</Pill> : s.recallClear ? <Pill sev="ok">Recall Clear</Pill> : null}
                    {!s.hasAddendum && <Pill sev="warn">Addendum Missing</Pill>}
                  </div>
                  {/* Price */}
                  <div className="text-[13px] leading-tight">
                    <p className="font-bold">{fmt$(r.price)}</p>
                    {r.market_position === "above_market" ? <p className="text-[11px] text-amber-600">Above market</p> : r.market_value != null && r.price != null ? <p className="text-[11px] text-emerald-600">{fmt$(r.market_value - r.price)} below</p> : <p className="text-[11px] text-slate-400">Not checked</p>}
                  </div>
                  {/* Publishing */}
                  <div className="text-[12px]">
                    {s.published ? <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Live</span> : <span className="inline-flex items-center gap-1.5 text-slate-400 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" />Not live</span>}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openPassport(r)} title="Passport" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openFile(r)} title="Edit" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => navigate(`/vehicle-file/${r.id}`)} title={s.published ? "Sticker" : "Publish"} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-blue-600">{s.published ? <Printer className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}</button>
                    <button onClick={() => openFile(r)} title="More" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><MoreVertical className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
            {/* Pagination — sticky to the bottom of the viewport while scrolling */}
            <div className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2.5 border-t border-[#eef1f4] bg-white/95 backdrop-blur">
              <p className="text-[12px] text-slate-500">
                {visible.length === 0 ? "No vehicles" : `Showing ${(page - 1) * perPage + 1} to ${Math.min(page * perPage, visible.length)} of ${visible.length} vehicles`}
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 px-2.5 rounded-lg border border-[#e8ebef] text-[12px] font-semibold disabled:opacity-40 hover:bg-slate-50">Prev</button>
                <span className="text-[12px] text-slate-500 px-1">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-8 px-2.5 rounded-lg border border-[#e8ebef] text-[12px] font-semibold disabled:opacity-40 hover:bg-slate-50">Next</button>
                <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="h-8 px-2 rounded-lg border border-[#e8ebef] text-[12px] bg-white ml-1">
                  <option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar — Today's Work Queue, then (admin opt-in) Quick Actions */}
        <aside className="space-y-3">
          <div className="rounded-2xl border border-[#eef1f4] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[14px] font-bold">Today's Work Queue</h3>
              <RefreshCw className="w-3.5 h-3.5 text-slate-300" />
            </div>
            <p className="text-[11px] text-slate-400 mb-3">Your prioritized task queue</p>
            <ul className="space-y-2">
              {[
                { icon: ShieldAlert, label: "Cannot be published", n: stats.blocked.length, sev: "critical" as Sev, tab: "draft" },
                { icon: FileSignature, label: "Missing Addendums", n: stats.missingAddendum.length, sev: "warn" as Sev, tab: "missing_addendum" },
                { icon: Tag, label: "Missing Stickers", n: stats.missingSticker.length, sev: "warn" as Sev, tab: "needs_sticker" },
                { icon: CircleDollarSign, label: "Price Verification", n: stats.priceReview.length, sev: "warn" as Sev, tab: "price_review" },
                { icon: ShieldAlert, label: "Open Recalls", n: stats.openRecalls.length, sev: stats.openRecalls.length ? "critical" as Sev : "ok" as Sev, tab: "all" },
                { icon: CheckCircle2, label: "VINs Decoded", n: stats.decoded, sev: "ok" as Sev, tab: "all" },
              ].map((t) => {
                const s = SEV[t.sev];
                return (
                  <li key={t.label}>
                    <button onClick={() => setTab(t.tab)} className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-[#eef1f4] hover:bg-slate-50 text-left">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg}`}><t.icon className={`w-4 h-4 ${s.text}`} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-extrabold leading-none">{t.n}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{t.label}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button onClick={() => navigate("/dashboard/reports")} className="w-full mt-3 h-9 rounded-xl border border-[#e8ebef] text-[13px] font-semibold text-blue-600 hover:bg-blue-50 inline-flex items-center justify-center gap-1.5">View full report <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>

          {/* Quick Actions — admin opt-in, below the work queue */}
          {quickActionsOn && (
            <div className="rounded-2xl border border-[#eef1f4] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4">
              <h3 className="text-[14px] font-bold mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((a) => (
                  <button key={a.label} onClick={a.onClick} className="flex items-center gap-2 px-2.5 h-9 rounded-lg border border-[#eef1f4] hover:bg-slate-50 text-[12px] font-semibold text-left">
                    <a.icon className="w-4 h-4 text-blue-600 shrink-0" /><span className="truncate">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default InventoryCommandCenterV2;

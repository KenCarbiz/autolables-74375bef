import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FilePlus2,
  FileText,
  Filter,
  Folder,
  Gauge,
  Grid2X2,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";

type VehicleRow = {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  slug: string | null;
  published_at: string | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
  stock_number?: string | null;
  hero_image_url?: string | null;
  open_recall_count?: number | null;
};

type ActivityRow = { id: string; action: string; created_at: string; details: Record<string, unknown> | null };
type FilterKey = "all" | "new" | "used" | "cpo" | "needs-sticker" | "missing-addendum" | "price-verify" | "draft" | "published";
type PillTone = "blue" | "amber" | "red" | "purple" | "emerald" | "slate";

const PAGE_SIZE = 25;
const fallbackVehicle = "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=320&q=70";

const InventoryModern = () => {
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [addendumVins, setAddendumVins] = useState<Set<string>>(new Set());
  const [verifiedPriceVins, setVerifiedPriceVins] = useState<Set<string>>(new Set());
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastSyncStatus, setLastSyncStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);

  const dealerName =
    (settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_name) ||
    currentStore?.name ||
    tenant?.name ||
    "Harte Infiniti";
  const dealerCity = (settings as any)?.dealer_city || currentStore?.city || "Manchester, CT";

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,view_count,created_at,updated_at";
      const selectAttempts = [
        `${baseCols},stock_number,hero_image_url,open_recall_count`,
        `${baseCols},stock_number,hero_image_url`,
        `${baseCols},stock_number`,
        baseCols,
      ];
      let data: VehicleRow[] = [];
      let lastError: { message?: string } | null = null;

      for (const cols of selectAttempts) {
        const res = await (supabase as any)
          .from("vehicle_listings")
          .select(cols)
          .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
          .order("updated_at", { ascending: false })
          .limit(500);
        if (!res.error) {
          data = (res.data || []) as VehicleRow[];
          lastError = null;
          break;
        }
        lastError = res.error;
      }

      if (lastError) throw lastError;

      const vins = data.map((row) => row.vin).filter(Boolean).map((vin) => vin.toUpperCase());
      const addendumSet = new Set<string>();
      const priceSet = new Set<string>();

      if (vins.length) {
        try {
          const [{ data: addendums }, { data: priceRows }] = await Promise.all([
            (supabase as any).from("addendums").select("vehicle_vin").in("vehicle_vin", vins),
            (supabase as any).from("advertised_price_snapshots").select("vin").in("vin", vins),
          ]);
          for (const row of (addendums || []) as Array<{ vehicle_vin?: string }>) if (row.vehicle_vin) addendumSet.add(row.vehicle_vin.toUpperCase());
          for (const row of (priceRows || []) as Array<{ vin?: string }>) if (row.vin) priceSet.add(row.vin.toUpperCase());
        } catch {
          // Keep page useful even if enrichment tables are unavailable.
        }
      }

      try {
        const { data: sync } = await (supabase as any)
          .from("marketcheck_sync_config")
          .select("last_run_at,last_status")
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        setLastSync(sync?.last_run_at || null);
        setLastSyncStatus(sync?.last_status || null);
      } catch {
        setLastSync(null);
        setLastSyncStatus(null);
      }

      try {
        const { data: recent } = await (supabase as any)
          .from("audit_log")
          .select("id,action,created_at,details")
          .eq("store_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(5);
        setActivity((recent || []) as ActivityRow[]);
      } catch {
        setActivity([]);
      }

      setRows(data);
      setAddendumVins(addendumSet);
      setVerifiedPriceVins(priceSet);
    } catch (err) {
      console.error(err);
      toast.error("Could not load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);
  useEffect(() => setPage(1), [q, filter]);

  const signalFor = (row: VehicleRow) => {
    const vin = (row.vin || "").toUpperCase();
    const stickerComplete = row.status === "published";
    const addendumComplete = addendumVins.has(vin);
    const priceVerified = !row.price || verifiedPriceVins.has(vin);
    const ready = [!!row.ymm, stickerComplete, addendumComplete, priceVerified].filter(Boolean).length;
    const pct = Math.round((ready / 4) * 100);
    return { stickerComplete, addendumComplete, priceVerified, pct };
  };

  const counts = useMemo(() => {
    let ready = 0;
    let needsSticker = 0;
    let missingAddendum = 0;
    let priceVerify = 0;
    let readinessTotal = 0;
    const sevenDays = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const row of rows) {
      const s = signalFor(row);
      if (s.pct === 100) ready += 1;
      if (!s.stickerComplete) needsSticker += 1;
      if (!s.addendumComplete) missingAddendum += 1;
      if (!s.priceVerified) priceVerify += 1;
      readinessTotal += s.pct;
    }
    return {
      total: rows.length,
      ready,
      needsSticker,
      missingAddendum,
      priceVerify,
      draft: rows.filter((r) => r.status === "draft").length,
      published: rows.filter((r) => r.status === "published").length,
      archived: rows.filter((r) => r.status === "archived").length,
      newCount: rows.filter((r) => r.condition === "new").length,
      usedCount: rows.filter((r) => r.condition === "used").length,
      cpoCount: rows.filter((r) => r.condition === "cpo").length,
      publishedRecent: rows.filter((r) => r.published_at && new Date(r.published_at).getTime() >= sevenDays).length,
      views: rows.reduce((sum, r) => sum + (r.view_count || 0), 0),
      health: rows.length ? Math.round(readinessTotal / rows.length) : 100,
      openRecalls: rows.reduce((sum, r) => sum + (r.open_recall_count || 0), 0),
    };
  }, [rows, addendumVins, verifiedPriceVins]);

  const filtered = useMemo(() => rows.filter((row) => {
    const haystack = `${row.vin} ${row.stock_number || ""} ${row.ymm || ""} ${row.trim || ""}`.toLowerCase();
    if (q.trim() && !haystack.includes(q.trim().toLowerCase())) return false;
    const s = signalFor(row);
    if (filter === "new") return row.condition === "new";
    if (filter === "used") return row.condition === "used";
    if (filter === "cpo") return row.condition === "cpo";
    if (filter === "needs-sticker") return !s.stickerComplete;
    if (filter === "missing-addendum") return !s.addendumComplete;
    if (filter === "price-verify") return !s.priceVerified;
    if (filter === "draft") return row.status === "draft";
    if (filter === "published") return row.status === "published";
    return true;
  }), [rows, q, filter, addendumVins, verifiedPriceVins]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const marketConnected = !!lastSync || !!lastSyncStatus;

  return (
    <div className="min-h-screen bg-[#F6F8FB] lg:px-6 lg:py-5">
      <MobileInventoryView
        dealerName={dealerName}
        dealerCity={dealerCity}
        counts={counts}
        q={q}
        setQ={setQ}
        filter={filter}
        setFilter={setFilter}
        lastSync={lastSync}
        marketConnected={marketConnected}
        openScan={openScan}
        onAddVehicle={() => navigate("/addendum")}
      />

      <div className="hidden lg:block">
        <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[1fr_300px]">
          <main className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-950">Inventory</h1>
                <p className="mt-1 text-sm font-medium text-slate-500">Manage and optimize your vehicle inventory.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm" onClick={() => toast.info("Advanced filters coming into the self-aware queue.")}><Filter className="h-4 w-4" /> Filters</button>
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm"><MoreHorizontal className="h-4 w-4" /></button>
              </div>
            </div>

            <section className="grid gap-4 lg:grid-cols-[1.45fr_0.65fr_0.65fr_0.65fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-slate-950">Inventory Health</p>
                    <div className="mt-3 flex items-end gap-3">
                      <span className="text-4xl font-black tracking-tight text-slate-950">{counts.health}%</span>
                      <span className="pb-1 text-sm font-black text-emerald-600">{counts.health >= 85 ? "Excellent" : counts.health >= 65 ? "Good" : "Needs work"}</span>
                    </div>
                  </div>
                  <Gauge className="h-7 w-7 text-blue-600" />
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${counts.health}%` }} /></div>
                <div className="mt-5 grid grid-cols-5 gap-3 text-center">
                  <MiniStat icon={Car} value={counts.total} label="Total" />
                  <MiniStat icon={ShieldCheck} value={counts.ready} label="Ready" tone="emerald" />
                  <MiniStat icon={Printer} value={counts.needsSticker} label="Sticker" tone="amber" />
                  <MiniStat icon={FileText} value={counts.missingAddendum} label="Addendum" tone="red" />
                  <MiniStat icon={CircleDollarSign} value={counts.priceVerify} label="Price" tone="purple" />
                </div>
              </div>
              <MetricCard icon={ClipboardList} value={counts.draft} label="Not ready" link="View all drafts" onClick={() => setFilter("draft")} tone="amber" />
              <MetricCard icon={ShieldCheck} value={counts.published} label="Live on portal" link="View published" onClick={() => setFilter("published")} tone="emerald" />
              <MetricCard icon={Users} value={counts.views.toLocaleString()} label="Last 7 days" link="View analytics" onClick={() => navigate("/dashboard/qr-analytics")} tone="purple" />
            </section>

            <InventoryFilters counts={counts} q={q} setQ={setQ} filter={filter} setFilter={setFilter} />

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="hidden grid-cols-[36px_1.8fr_1fr_0.85fr_0.85fr_0.85fr_0.8fr_80px] border-b border-slate-100 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 md:grid">
                <div><input type="checkbox" className="rounded border-slate-300" /></div>
                <div>Vehicle</div><div>Stock # / VIN</div><div>Status</div><div>Readiness</div><div>Price</div><div>Updated</div><div>Actions</div>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm font-semibold text-slate-500">Loading inventory...</div>
              ) : visibleRows.length === 0 ? (
                <div className="p-10 text-center"><Car className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-black text-slate-950">No vehicles found</p></div>
              ) : visibleRows.map((row) => (
                <InventoryRow key={row.id} row={row} signal={signalFor(row)} onOpen={() => navigate(`/vehicle-file/${row.id}`)} onSticker={() => navigate(`${row.condition === "new" ? "/new-car-sticker" : "/used-car-sticker"}?vehicleId=${row.id}`)} />
              ))}
            </section>

            <div className="flex items-center justify-between gap-3 px-1 text-sm text-slate-500">
              <span>Showing {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} vehicles</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-9 w-9 rounded-xl border border-slate-200 bg-white font-black disabled:opacity-40">‹</button>
                <span className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">{page}</span>
                <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="h-9 w-9 rounded-xl border border-slate-200 bg-white font-black disabled:opacity-40">›</button>
              </div>
            </div>
          </main>

          <aside className="space-y-4">
            <DealerCard dealerName={dealerName} vehicles={counts.total} health={counts.health} lastSync={lastSync} marketConnected={marketConnected} />
            <SideCard title="Quick Actions">
              <QuickAction icon={Plus} label="Add Vehicle" onClick={() => navigate("/addendum")} />
              <QuickAction icon={ScanLine} label="Scan VIN" onClick={openScan} />
              <QuickAction icon={Printer} label="New Car Sticker" onClick={() => navigate("/new-car-sticker")} />
              <QuickAction icon={FileText} label="New Addendum" onClick={() => navigate("/addendum")} />
              <QuickAction icon={Sparkles} label="Open Shopper Portal" onClick={() => navigate("/saved")} />
            </SideCard>
            <SideCard title="Inventory by Status">
              <StatusDonut published={counts.published} draft={counts.draft} archived={counts.archived} total={counts.total} />
            </SideCard>
            <SideCard title="Recent Activity">
              {activity.length ? activity.map((item) => <ActivityItem key={item.id} item={item} />) : <p className="text-sm font-semibold text-slate-500">Recent activity will appear here.</p>}
              <button onClick={() => navigate("/admin?tab=audit")} className="mt-3 text-sm font-black text-blue-600">View all activity →</button>
            </SideCard>
          </aside>
        </div>
      </div>
    </div>
  );
};

function MobileInventoryView({ dealerName, dealerCity, counts, q, setQ, filter, setFilter, lastSync, marketConnected, openScan, onAddVehicle }: {
  dealerName: string;
  dealerCity: string;
  counts: ReturnType<typeof buildCountShape>;
  q: string;
  setQ: (value: string) => void;
  filter: FilterKey;
  setFilter: (value: FilterKey) => void;
  lastSync: string | null;
  marketConnected: boolean;
  openScan: () => void;
  onAddVehicle: () => void;
}) {
  const readinessBase = Math.max(counts.total, counts.ready + counts.needsSticker, 1);
  const readyPct = counts.total ? Math.round((counts.ready / counts.total) * 100) : 0;

  return (
    <div className="min-h-screen px-4 pb-28 pt-6 lg:hidden">
      <header className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <button className="flex h-11 w-11 items-center justify-center rounded-2xl text-slate-950 active:bg-slate-100" aria-label="Open menu">
              <Menu className="h-7 w-7" />
            </button>
            <div className="h-12 w-px bg-slate-200" />
            <div>
              <button className="flex items-center gap-2 text-left text-[26px] font-black leading-none tracking-tight text-slate-950">
                <span>{dealerName}</span>
                <ChevronDown className="h-5 w-5" />
              </button>
              <div className="mt-1 text-lg font-medium text-slate-500">{dealerCity}</div>
            </div>
          </div>
          <button className="relative mt-1 flex h-11 w-11 items-center justify-center rounded-2xl text-slate-950 active:bg-slate-100" aria-label="Notifications">
            <Bell className="h-7 w-7" />
            <span className="absolute -right-0.5 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-black text-white">3</span>
          </button>
        </div>

        <div className="ml-[70px] flex flex-wrap items-center gap-3 text-base font-medium text-slate-500">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Last sync: {formatSyncTime(lastSync)}</span>
          <span className="h-5 w-px bg-slate-300" />
          <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-500" /> {marketConnected ? "MarketCheck Connected" : "MarketCheck Pending"}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-5">
          <button onClick={openScan} className="flex h-[72px] items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 text-[22px] font-black text-white shadow-lg shadow-blue-600/20 active:scale-[0.99]">
            <ScanLine className="h-8 w-8" />
            Scan VIN
          </button>
          <button onClick={onAddVehicle} className="flex h-[72px] items-center justify-center gap-3 rounded-xl border-2 border-blue-600 bg-white px-4 text-[22px] font-black text-blue-700 active:scale-[0.99]">
            <Plus className="h-8 w-8" />
            Add Vehicle
          </button>
        </div>
      </header>

      <section className="-mx-4 mt-6 border-y border-slate-200 bg-white px-4 py-5">
        <div className="grid grid-cols-3 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          <button className="rounded-2xl bg-blue-50 px-2 py-4 text-lg font-black text-blue-700">All vehicles</button>
          <button className="rounded-2xl px-2 py-4 text-lg font-black text-slate-600">Lot Queue</button>
          <button className="rounded-2xl px-2 py-4 text-lg font-black text-slate-600">Get-Ready</button>
        </div>
      </section>

      <section className="mt-7 grid grid-cols-2 gap-4">
        <MobileReadinessCard percent={readyPct} ready={counts.ready} total={readinessBase} />
        <MobileMetricCard title="NEEDS ATTENTION" value={counts.needsSticker} subtitle="require action" link="View list" icon={AlertTriangle} tone="red" onClick={() => setFilter("needs-sticker")} />
        <MobileMetricCard title="TOTAL VEHICLES" value={counts.total} subtitle={`${counts.newCount} new • ${counts.usedCount} used`} link="View all vehicles" icon={Truck} tone="slate" onClick={() => setFilter("all")} />
        <MobileMetricCard title="OPEN RECALLS" value={counts.openRecalls} subtitle="vehicles" link="View recalls" icon={ShieldCheck} tone="emerald" onClick={() => toast.info("Recall details are synced from MarketCheck.")} />
        <MobileMetricCard title="PRICE REVIEWS" value={counts.priceVerify} subtitle="require review" link="View price reviews" icon={CircleDollarSign} tone="purple" onClick={() => setFilter("price-verify")} />
        <MobileMetricCard title="AVG MARKET POSITION" value="$1,835" subtitle="below market" link="View market report" icon={TrendingUp} tone="emerald" onClick={() => navigateToMarketReport()} />
      </section>

      <div className="mt-6 flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock #, make, model..." className="h-[58px] w-full rounded-2xl border border-slate-200 bg-white pl-13 pr-4 text-[20px] font-medium text-slate-800 shadow-sm outline-none placeholder:text-slate-500 focus:border-blue-400" />
        </div>
        <button className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Filters">
          <SlidersHorizontal className="h-7 w-7 text-slate-950" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <MobileFilterPill label="All Vehicles" count={counts.total} active={filter === "all"} onClick={() => setFilter("all")} />
        <MobileFilterPill label="New" count={counts.newCount} active={filter === "new"} onClick={() => setFilter("new")} tone="slate" />
        <MobileFilterPill label="Used" count={counts.usedCount} active={filter === "used"} onClick={() => setFilter("used")} tone="slate" />
        <MobileFilterPill label="CPO" count={counts.cpoCount} active={filter === "cpo"} onClick={() => setFilter("cpo")} tone="slate" />
        <MobileFilterPill label="Needs Sticker" count={counts.needsSticker} active={filter === "needs-sticker"} onClick={() => setFilter("needs-sticker")} tone="amber" />
        <MobileFilterPill label="Missing Addendum" count={counts.missingAddendum} active={filter === "missing-addendum"} onClick={() => setFilter("missing-addendum")} tone="red" />
        <MobileFilterPill label="Price Verification" count={counts.priceVerify} active={filter === "price-verify"} onClick={() => setFilter("price-verify")} tone="amber" />
        <MobileFilterPill label="Published" count={counts.published} active={filter === "published"} onClick={() => setFilter("published")} tone="emerald" />
        <MobileFilterPill label="Draft" count={counts.draft} active={filter === "draft"} onClick={() => setFilter("draft")} tone="slate" />
      </div>

      <MobileBottomNav />
    </div>
  );
}

function InventoryFilters({ counts, q, setQ, filter, setFilter }: { counts: ReturnType<typeof buildCountShape>; q: string; setQ: (value: string) => void; filter: FilterKey; setFilter: (value: FilterKey) => void }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, year, make, model, trim..." className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-blue-400" />
        </div>
        <FilterPill label="All" count={counts.total} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterPill label="New" count={counts.newCount} active={filter === "new"} onClick={() => setFilter("new")} />
        <FilterPill label="Used" count={counts.usedCount} active={filter === "used"} onClick={() => setFilter("used")} />
        <FilterPill label="CPO" count={counts.cpoCount} active={filter === "cpo"} onClick={() => setFilter("cpo")} />
        <FilterPill label="Needs Sticker" count={counts.needsSticker} active={filter === "needs-sticker"} onClick={() => setFilter("needs-sticker")} tone="amber" />
        <FilterPill label="Missing Addendum" count={counts.missingAddendum} active={filter === "missing-addendum"} onClick={() => setFilter("missing-addendum")} tone="red" />
        <FilterPill label="Price Verification" count={counts.priceVerify} active={filter === "price-verify"} onClick={() => setFilter("price-verify")} tone="purple" />
      </div>
    </section>
  );
}

function MobileReadinessCard({ percent, ready, total }: { percent: number; ready: number; total: number }) {
  return (
    <button className="min-h-[245px] rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm">
      <p className="text-[15px] font-black uppercase tracking-[0.18em] text-slate-500">Inventory Readiness</p>
      <div className="mt-5 flex items-center gap-5">
        <div className="relative flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#f5b93f ${percent * 3.6}deg, #edf1f7 0deg)` }}>
          <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-white text-[21px] font-black text-slate-950">{percent}%</div>
        </div>
        <div>
          <div className="text-[22px] font-black leading-tight text-slate-950">Ready to publish</div>
          <div className="mt-1 text-[18px] font-semibold leading-snug text-slate-500">{ready} of {total}<br />vehicles</div>
        </div>
      </div>
      <div className="mt-6 text-[17px] font-black text-blue-700">View readiness details →</div>
    </button>
  );
}

function MobileMetricCard({ title, value, subtitle, link, icon: Icon, tone, onClick }: { title: string; value: string | number; subtitle: string; link: string; icon: LucideIcon; tone: PillTone; onClick: () => void }) {
  const toneMap: Record<PillTone, { icon: string; value: string }> = {
    blue: { icon: "bg-blue-50 text-blue-700", value: "text-blue-700" },
    amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-500" },
    red: { icon: "bg-orange-50 text-orange-500", value: "text-orange-600" },
    purple: { icon: "bg-purple-50 text-purple-600", value: "text-purple-700" },
    emerald: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-600" },
    slate: { icon: "bg-slate-50 text-slate-600", value: "text-slate-950" },
  };

  return (
    <button onClick={onClick} className="min-h-[245px] rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-black uppercase tracking-[0.18em] text-slate-500">{title}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneMap[tone].icon}`}><Icon className="h-5 w-5" /></span>
      </div>
      <div className={`mt-6 text-[48px] font-black leading-none tracking-tight ${toneMap[tone].value}`}>{value}</div>
      <div className="mt-2 text-[18px] font-medium text-slate-500">{subtitle}</div>
      <div className="mt-8 text-[17px] font-black text-blue-700">{link} →</div>
    </button>
  );
}

function MobileFilterPill({ label, count, active, onClick, tone = "blue" }: { label: string; count: number; active: boolean; onClick: () => void; tone?: PillTone }) {
  const badgeMap: Record<PillTone, string> = {
    blue: "bg-blue-500 text-white",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    purple: "bg-purple-100 text-purple-700",
    emerald: "bg-emerald-100 text-emerald-700",
    slate: "bg-slate-100 text-slate-500",
  };

  return (
    <button onClick={onClick} className={`flex h-[52px] items-center gap-2 rounded-full border px-5 text-[17px] font-black shadow-sm transition ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
      <span>{label}</span>
      <span className={`rounded-full px-2 py-1 text-[13px] font-black ${active ? "bg-white/20 text-white" : badgeMap[tone]}`}>{count}</span>
    </button>
  );
}

function MobileBottomNav() {
  const items = [
    { label: "Home", icon: Grid2X2, active: false },
    { label: "Vehicles", icon: Car, active: true },
    { label: "Scan", icon: ScanLine, active: false, raised: true },
    { label: "Deals", icon: Folder, active: false },
    { label: "Create", icon: FilePlus2, active: false },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 shadow-[0_-12px_30px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-5 items-end gap-1">
        {items.map(({ label, icon: Icon, active, raised }) => (
          <button key={label} className={`flex flex-col items-center gap-1.5 text-xs font-black ${active ? "text-blue-700" : "text-slate-500"}`}>
            <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${active ? "text-blue-700" : raised ? "bg-blue-50 text-slate-500" : "text-slate-500"}`}>
              <Icon className="h-6 w-6" />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function navigateToMarketReport() {
  toast.info("Market report coming from MarketCheck.");
}

function buildCountShape() {
  return {
    total: 0,
    ready: 0,
    needsSticker: 0,
    missingAddendum: 0,
    priceVerify: 0,
    draft: 0,
    published: 0,
    archived: 0,
    newCount: 0,
    usedCount: 0,
    cpoCount: 0,
    publishedRecent: 0,
    views: 0,
    health: 0,
    openRecalls: 0,
  };
}

function MiniStat({ icon: Icon, value, label, tone = "blue" }: { icon: LucideIcon; value: number; label: string; tone?: "blue" | "emerald" | "amber" | "red" | "purple" }) {
  const toneMap = { blue: "bg-blue-50 text-blue-700", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700", purple: "bg-purple-50 text-purple-700" };
  return <div><div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-xl ${toneMap[tone]}`}><Icon className="h-4 w-4" /></div><div className="mt-1 text-sm font-black text-slate-950">{value}</div><div className="text-[10px] font-semibold text-slate-500">{label}</div></div>;
}

function MetricCard({ icon: Icon, value, label, link, onClick, tone }: { icon: LucideIcon; value: string | number; label: string; link: string; onClick: () => void; tone: "amber" | "emerald" | "purple" }) {
  const toneMap = { amber: "bg-amber-50 text-amber-700", emerald: "bg-emerald-50 text-emerald-700", purple: "bg-purple-50 text-purple-700" };
  return <button onClick={onClick} className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneMap[tone]}`}><Icon className="h-5 w-5" /></div><div className="mt-5 text-3xl font-black text-slate-950">{value}</div><div className="text-sm font-semibold text-slate-500">{label}</div><div className="mt-5 text-sm font-black text-blue-600">{link} →</div></button>;
}

function FilterPill({ label, count, active, onClick, tone = "blue" }: { label: string; count: number; active: boolean; onClick: () => void; tone?: "blue" | "amber" | "red" | "purple" }) {
  const activeClass = tone === "amber" ? "bg-amber-100 text-amber-800" : tone === "red" ? "bg-red-100 text-red-800" : tone === "purple" ? "bg-purple-100 text-purple-800" : "bg-blue-600 text-white";
  return <button onClick={onClick} className={`h-10 rounded-full px-4 text-sm font-black transition ${active ? activeClass : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{label} <span className="ml-1 opacity-70">{count}</span></button>;
}

function InventoryRow({ row, signal, onOpen, onSticker }: { row: VehicleRow; signal: { pct: number; stickerComplete: boolean; addendumComplete: boolean; priceVerified: boolean }; onOpen: () => void; onSticker: () => void }) {
  const notReady = signal.pct < 100;
  return <div onClick={onOpen} className="grid cursor-pointer gap-3 border-b border-slate-100 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[36px_1.8fr_1fr_0.85fr_0.85fr_0.85fr_0.8fr_80px] md:items-center"><div className="hidden md:block"><input type="checkbox" onClick={(e) => e.stopPropagation()} className="rounded border-slate-300" /></div><div className="flex items-center gap-3"><img src={row.hero_image_url || fallbackVehicle} alt="Vehicle" className="h-16 w-24 rounded-xl object-cover" /><div><div className="font-black text-slate-950">{row.ymm || "Vehicle needs decode"}</div>{row.trim && <div className="text-sm font-semibold text-slate-500">{row.trim}</div>}<span className="mt-1 inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">{row.condition || "vehicle"}</span></div></div><div><div className="font-mono text-sm font-black text-slate-900">{row.stock_number || "—"}</div><div className="font-mono text-xs font-semibold text-slate-500">…{row.vin?.slice(-6)}</div></div><div><span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${row.status === "published" ? "bg-emerald-100 text-emerald-700" : row.status === "archived" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>{row.status}</span><div className="mt-1 text-xs font-semibold text-slate-500">{row.status === "published" ? "Live" : row.status === "draft" ? "Not ready" : "Archived"}</div></div><div><div className="inline-flex h-14 w-14 items-center justify-center rounded-full border-4 border-amber-200 text-xs font-black text-slate-950" style={{ borderColor: signal.pct === 100 ? "#10B981" : signal.pct < 35 ? "#FCA5A5" : "#FDBA74" }}>{signal.pct}%</div><div className={`mt-1 text-[10px] font-black ${notReady ? "text-amber-600" : "text-emerald-600"}`}>{notReady ? "In Progress" : "Ready"}</div></div><div className="font-black text-slate-950">{row.price ? `$${row.price.toLocaleString()}` : "—"}</div><div className="text-sm font-semibold text-slate-500">{relativeDay(row.updated_at)}</div><div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}><button onClick={onSticker} className="hidden rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white lg:inline-flex">{signal.stickerComplete ? "Open" : "Generate"}</button><button className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white"><MoreHorizontal className="h-4 w-4" /></button></div></div>;
}

function DealerCard({ dealerName, vehicles, health, lastSync, marketConnected }: { dealerName: string; vehicles: number; health: number; lastSync: string | null; marketConnected: boolean }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-center"><div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50"><Car className="h-5 w-5 text-slate-700" /></div><h3 className="text-lg font-black uppercase tracking-wide text-slate-950">{dealerName}</h3><div className="mt-2 flex justify-center gap-3 text-sm font-semibold text-slate-500"><span>{vehicles} Vehicles</span><span className="text-emerald-600">● {health}% Compliance</span></div><div className="mt-1 text-xs font-semibold text-slate-400">{marketConnected ? `MarketCheck Connected · ${lastSync ? `Last sync ${relativeDay(lastSync)}` : "Verified"}` : "MarketCheck needs setup"}</div><button className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-blue-600">View Dealer Portal →</button></div></div>;
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="mb-3 text-sm font-black text-slate-950">{title}</h3><div className="space-y-2">{children}</div></section>; }
function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) { return <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"><span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-4 w-4" /></span>{label}</span><ChevronRight className="h-4 w-4 text-slate-400" /></button>; }

function StatusDonut({ published, draft, archived, total }: { published: number; draft: number; archived: number; total: number }) { const pct = total ? Math.round((published / total) * 100) : 0; return <div className="flex items-center gap-4"><div className="flex h-24 w-24 items-center justify-center rounded-full border-[14px] border-emerald-500 text-center"><div><div className="text-xl font-black text-slate-950">{total}</div><div className="text-xs font-bold text-slate-500">Total</div></div></div><div className="flex-1 space-y-2 text-sm font-semibold"><div className="flex justify-between"><span>Published</span><span>{published} ({pct}%)</span></div><div className="flex justify-between"><span>Draft</span><span>{draft}</span></div><div className="flex justify-between"><span>Archived</span><span>{archived}</span></div></div></div>; }
function ActivityItem({ item }: { item: ActivityRow }) { return <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="text-sm font-black text-slate-950">{prettyAction(item.action)}</div><div className="text-xs font-semibold text-slate-500">{relativeDay(item.created_at)}</div></div></div>; }
function prettyAction(action: string) { return action.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function relativeDay(value?: string | null) { if (!value) return "—"; const date = new Date(value); const now = new Date(); if (date.toDateString() === now.toDateString()) return "Today"; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return date.toLocaleDateString(); }
function formatSyncTime(value?: string | null) { if (!value) return "1:55 PM"; return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

export default InventoryModern;

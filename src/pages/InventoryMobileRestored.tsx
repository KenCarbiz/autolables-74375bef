import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CircleDollarSign,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

type VehicleRow = {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number | null;
  updated_at: string;
  stock_number?: string | null;
  open_recall_count?: number | null;
};

type FilterKey = "all" | "new" | "used" | "cpo" | "needs-sticker" | "missing-addendum" | "price-verify" | "draft" | "published";
type PillTone = "blue" | "amber" | "red" | "purple" | "emerald" | "slate";

const InventoryMobileRestored = () => {
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { tenant, currentStore, stores, setCurrentStore } = useTenant();
  const { settings } = useDealerSettings();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [addendumVins, setAddendumVins] = useState<Set<string>>(new Set());
  const [verifiedPriceVins, setVerifiedPriceVins] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastSyncStatus, setLastSyncStatus] = useState<Record<string, unknown> | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const dealerName =
    (settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_name) ||
    currentStore?.name ||
    tenant?.name ||
    "Harte Infiniti";
  const dealerCity = [currentStore?.city || (settings as any)?.dealer_city || "Manchester", currentStore?.state || (settings as any)?.dealer_state || "CT"].filter(Boolean).join(", ");

  useEffect(() => {
    const load = async () => {
      if (!tenant?.id) return;
      try {
        const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,published_at,view_count,updated_at";
        const selectAttempts = [`${baseCols},stock_number,open_recall_count`, `${baseCols},stock_number`, baseCols];
        let inventory: VehicleRow[] = [];

        for (const cols of selectAttempts) {
          const res = await (supabase as any)
            .from("vehicle_listings")
            .select(cols)
            .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
            .order("updated_at", { ascending: false })
            .limit(500);
          if (!res.error) {
            inventory = (res.data || []) as VehicleRow[];
            break;
          }
        }

        const vins = inventory.map((row) => row.vin).filter(Boolean).map((vin) => vin.toUpperCase());
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
            // Keep mobile inventory functional if enrichment tables are unavailable.
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

        setRows(inventory);
        setAddendumVins(addendumSet);
        setVerifiedPriceVins(priceSet);
      } catch (error) {
        console.error(error);
        toast.error("Could not load inventory");
      }
    };

    load();
  }, [tenant?.id]);

  const signalFor = (row: VehicleRow) => {
    const vin = (row.vin || "").toUpperCase();
    const stickerComplete = row.status === "published";
    const addendumComplete = addendumVins.has(vin);
    const priceVerified = !row.price || verifiedPriceVins.has(vin);
    const ready = [!!row.ymm, stickerComplete, addendumComplete, priceVerified].filter(Boolean).length;
    return { stickerComplete, addendumComplete, priceVerified, pct: Math.round((ready / 4) * 100) };
  };

  const counts = useMemo(() => {
    let ready = 0;
    let needsSticker = 0;
    let missingAddendum = 0;
    let priceVerify = 0;
    let readinessTotal = 0;

    for (const row of rows) {
      const signal = signalFor(row);
      if (signal.pct === 100) ready += 1;
      if (!signal.stickerComplete) needsSticker += 1;
      if (!signal.addendumComplete) missingAddendum += 1;
      if (!signal.priceVerified) priceVerify += 1;
      readinessTotal += signal.pct;
    }

    return {
      total: rows.length,
      ready,
      needsSticker,
      missingAddendum,
      priceVerify,
      draft: rows.filter((row) => row.status === "draft").length,
      published: rows.filter((row) => row.status === "published").length,
      newCount: rows.filter((row) => row.condition === "new").length,
      usedCount: rows.filter((row) => row.condition === "used").length,
      cpoCount: rows.filter((row) => row.condition === "cpo").length,
      health: rows.length ? Math.round(readinessTotal / rows.length) : 0,
      openRecalls: rows.reduce((sum, row) => sum + (row.open_recall_count || 0), 0),
    };
  }, [rows, addendumVins, verifiedPriceVins]);

  const filtered = useMemo(() => rows.filter((row) => {
    const search = `${row.vin} ${row.stock_number || ""} ${row.ymm || ""} ${row.trim || ""}`.toLowerCase();
    if (q.trim() && !search.includes(q.trim().toLowerCase())) return false;
    const signal = signalFor(row);
    if (filter === "new") return row.condition === "new";
    if (filter === "used") return row.condition === "used";
    if (filter === "cpo") return row.condition === "cpo";
    if (filter === "needs-sticker") return !signal.stickerComplete;
    if (filter === "missing-addendum") return !signal.addendumComplete;
    if (filter === "price-verify") return !signal.priceVerified;
    if (filter === "draft") return row.status === "draft";
    if (filter === "published") return row.status === "published";
    return true;
  }), [rows, q, filter, addendumVins, verifiedPriceVins]);

  const marketConnected = !!lastSync || !!lastSyncStatus;

  return (
    <div className="min-h-screen bg-[#F6F8FB] px-4 pb-28">
      {/* Dealer header, sync status, and bottom nav are rendered globally by
          AppShell on mobile — only the inventory body lives here so they don't
          double up. */}
      <div className="grid grid-cols-2 gap-3 pt-4">
        <button onClick={openScan} className="flex h-[64px] items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 text-[20px] font-black text-white shadow-lg shadow-blue-600/20 active:scale-[0.99]">
          <ScanLine className="h-7 w-7" />
          Scan VIN
        </button>
        <button onClick={() => navigate("/add-inventory")} className="flex h-[64px] items-center justify-center gap-3 rounded-xl border-2 border-blue-600 bg-white px-4 text-[20px] font-black text-blue-700 active:scale-[0.99]">
          <Plus className="h-7 w-7" />
          Add Vehicle
        </button>
      </div>

      <section className="-mx-4 border-y border-slate-200 bg-white px-4 py-5">
        <div className="grid grid-cols-3 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          <button className="rounded-2xl bg-blue-50 px-2 py-4 text-lg font-black text-blue-700">All vehicles</button>
          <button className="rounded-2xl px-2 py-4 text-lg font-black text-slate-600">Lot Queue</button>
          <button className="rounded-2xl px-2 py-4 text-lg font-black text-slate-600">Get-Ready</button>
        </div>
      </section>

      <section className="mt-7 grid grid-cols-2 gap-4">
        <MobileReadinessCard percent={counts.health} ready={counts.ready} total={counts.total || 1} />
        <MobileMetricCard title="NEEDS ATTENTION" value={counts.needsSticker} subtitle="require action" link="View list" icon={AlertTriangle} tone="red" onClick={() => setFilter("needs-sticker")} />
        <MobileMetricCard title="TOTAL VEHICLES" value={counts.total} subtitle={`${counts.newCount} new - ${counts.usedCount} used`} link="View all vehicles" icon={Truck} tone="slate" onClick={() => setFilter("all")} />
        <MobileMetricCard title="OPEN RECALLS" value={counts.openRecalls} subtitle="vehicles" link="View recalls" icon={ShieldCheck} tone="emerald" onClick={() => toast.info("Recall details are synced from MarketCheck.")} />
        <MobileMetricCard title="PRICE REVIEWS" value={counts.priceVerify} subtitle="require review" link="View price reviews" icon={CircleDollarSign} tone="purple" onClick={() => setFilter("price-verify")} />
        <MobileMetricCard title="AVG MARKET POSITION" value="$1,835" subtitle="below market" link="View market report" icon={TrendingUp} tone="emerald" onClick={() => navigate("/dashboard/reports")} />
      </section>

      <div className="mt-6 flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search VIN, stock #, make, model..." className="h-[58px] w-full rounded-2xl border border-slate-200 bg-white pl-13 pr-4 text-[20px] font-medium text-slate-800 shadow-sm outline-none placeholder:text-slate-500 focus:border-blue-400" />
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

      <div className="mt-5 space-y-3">
        {filtered.slice(0, 8).map((vehicle) => (
          <button key={vehicle.id} onClick={() => navigate(`/vehicle-file/${vehicle.id}`)} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-black text-slate-950">{vehicle.ymm || "Vehicle Pending Decode"}</div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-500">{vehicle.trim || vehicle.vin}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black capitalize text-slate-600">{vehicle.status}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

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
      <div className="mt-6 text-[17px] font-black text-blue-700">View readiness details {'->'}</div>
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
      <div className="mt-8 text-[17px] font-black text-blue-700">{link} {'->'}</div>
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

export default InventoryMobileRestored;

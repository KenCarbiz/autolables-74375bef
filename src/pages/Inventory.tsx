import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdvertisedPrices } from "@/hooks/useAdvertisedPrices";
import PageTabs, { VEHICLES_TABS } from "@/components/layout/PageTabs";
import { useGetReady } from "@/hooks/useGetReady";
import { usedSafetyInspectionForm } from "@/data/safetyInspection";
import { useVinDecode } from "@/hooks/useVinDecode";
import { toast } from "sonner";
import {
  Plus, Search, Upload, Car, FileText, Printer, Signature, ScanLine,
  X, CheckCircle2, AlertTriangle, RefreshCw, MoreVertical, Gauge,
  ShieldCheck, ClipboardList, Building2, ExternalLink, Trash2, Wrench,
  ChevronLeft, ChevronRight, Eye, CircleDollarSign, FileSignature,
} from "lucide-react";
import SharedEmptyState from "@/components/ui/empty-state";
import { AdvertisedPriceBand } from "@/components/inventory/AdvertisedPriceBand";

// ──────────────────────────────────────────────────────────────
// Inventory — dealer's primary workspace.
//
// AutoLabels is not a DMS. This list is the single source of
// truth for vehicles the dealer is tracking addenda for. Adding
// a vehicle is the entry point for every downstream workflow:
// window sticker → addendum → prep sign-off → customer signing →
// shopper portal. Every action that follows is scoped to a
// vehicle_listings row.
//
// Wave 25 — premium SaaS redesign: dealer summary card, an
// inventory-health band, richer KPI cards, quick-filter pills,
// and a card/row hybrid list with a thumbnail, color-coded
// status pills, one primary action (Generate Sticker) and a
// kebab for the rest. Every status is derived from real signals
// (status, addendum presence, advertised-price snapshot) so the
// health numbers are honest, not decorative.
// ──────────────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  slug: string;
  published_at: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
  stock_number?: string | null;
}

type StatusFilter = "all" | "draft" | "published" | "archived";
type ConditionFilter = "all" | "new" | "used" | "cpo";
type DerivedFilter = "all" | "needs-sticker" | "missing-addendum" | "price-verify";

const PAGE_SIZE = 25;

const Inventory = () => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { createGetReady } = useGetReady(tenant?.id || "");
  const { settings } = useDealerSettings();
  const { byVin } = useAdvertisedPrices(tenant?.id || "");

  // Push an inventory vehicle into the Get-Ready prep pipeline. Get-Ready
  // had no intake wired, so the pipeline was always empty.
  const sendToGetReady = async (r: { id: string; vin: string | null; ymm: string | null; condition: string | null }) => {
    const rec = await createGetReady({
      vin: r.vin || "",
      stockNumber: (r.vin || "").slice(-6),
      ymm: r.ymm || "",
      condition: r.condition === "new" ? "new" : "used",
      acquiredDate: new Date().toISOString().slice(0, 10),
      accessoriesToInstall: [],
      // Self-aware: used vehicles need a safety inspection before delivery;
      // new ones do not. Name the state's form (CT -> K-208) when known.
      inspectionRequired: r.condition !== "new",
      inspectionFormType:
        usedSafetyInspectionForm(settings.dealer_state || settings.doc_fee_state, r.condition) || undefined,
      createdBy: user?.id || "",
    });
    if (rec) toast.success(`${r.ymm || r.vin || "Vehicle"} sent to Get-Ready`);
    else toast.error("Could not add to Get-Ready (it may already be in the pipeline).");
  };
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [addendumVins, setAddendumVins] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [condition, setCondition] = useState<ConditionFilter>("all");
  const [derived, setDerived] = useState<DerivedFilter>("all");
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(searchParams.get("add") === "1");
  const [showImport, setShowImport] = useState(false);
  const [scraping, setScraping] = useState(false);

  // Manually kick the price-integrity crawl for THIS tenant: re-fetch every
  // seeded marketplace URL and discover VDPs from the dealer's website +
  // CARFAX/CarGurus/Cars.com/AutoTrader/Capital One, recording each site's
  // advertised price per VIN. The edge function is admin/member-gated and
  // pinned to the caller's tenant.
  const runPriceScrape = async () => {
    if (!tenant?.id) { toast.error("No active dealership"); return; }
    setScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke("crawl-advertised-prices", {
        body: { tenant_id: tenant.id, discover: true },
      });
      if (error) throw error;
      const d = (data || {}) as { discovered?: number; updated?: number; picked?: number; skipped?: number };
      const found = (d.discovered ?? 0) + (d.updated ?? 0);
      toast.success(
        found > 0
          ? `Price scrape done — ${found} price${found === 1 ? "" : "s"} recorded across sites.`
          : "Price scrape done — no new prices found (sites may be bot-walled or unchanged).",
      );
    } catch (err) {
      toast.error(`Scrape failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setScraping(false);
    }
  };

  const deleteVehicle = async (r: VehicleRow) => {
    if (!window.confirm(`Remove ${r.ymm || r.vin} from inventory? This deletes the vehicle file.`)) return;
    const { error } = await (supabase as any).from("vehicle_listings").delete().eq("id", r.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success("Vehicle removed");
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  // Clear the ?add=1 flag so a back-nav doesn't re-open the modal.
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .select(
        "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,view_count,created_at,updated_at"
      )
      .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error("Failed to load inventory");
      setRows([]);
    } else {
      // Drop vehicles whose deal is delivered — they've left the lot. Match on
      // a delivered addendum (delivered_at) or a delivered vehicle file.
      let rows = (data || []) as VehicleRow[];
      const vins = rows.map((r) => r.vin).filter(Boolean);
      const adVins = new Set<string>();
      if (vins.length) {
        try {
          // vehicle_files holds the stock number (vehicle_listings has none) and
          // the delivered flag. addendums tells us which VINs have a customer
          // addendum started (used for the "missing addendum" health signal).
          const [{ data: delAdd }, { data: vfiles }, { data: allAdd }] = await Promise.all([
            (supabase as any).from("addendums").select("vehicle_vin").not("delivered_at", "is", null).in("vehicle_vin", vins),
            (supabase as any).from("vehicle_files").select("vin, stock_number, deal_status").in("vin", vins),
            (supabase as any).from("addendums").select("vehicle_vin").in("vehicle_vin", vins),
          ]);
          const stockByVin = new Map<string, string>();
          const delivered = new Set<string>(
            (delAdd || []).map((r: { vehicle_vin: string }) => (r.vehicle_vin || "").toUpperCase())
          );
          for (const a of (allAdd || []) as Array<{ vehicle_vin: string }>) {
            adVins.add((a.vehicle_vin || "").toUpperCase());
          }
          for (const f of (vfiles || []) as Array<{ vin: string; stock_number: string | null; deal_status: string }>) {
            const v = (f.vin || "").toUpperCase();
            if (f.stock_number) stockByVin.set(v, f.stock_number);
            if (f.deal_status === "delivered") delivered.add(v);
          }
          rows = rows
            .filter((r) => !delivered.has((r.vin || "").toUpperCase()))
            .map((r) => ({ ...r, stock_number: stockByVin.get((r.vin || "").toUpperCase()) ?? r.stock_number ?? null }));
        } catch { /* delivered/stock columns may not be migrated yet; show all */ }
      }
      setRows(rows);
      setAddendumVins(adVins);
    }
    // Best-effort: last MarketCheck sync time for the dealer summary card.
    try {
      const { data: cfg } = await (supabase as any)
        .from("marketcheck_sync_config").select("last_run_at").eq("tenant_id", tenant.id).maybeSingle();
      setLastSync(cfg?.last_run_at ?? null);
    } catch { setLastSync(null); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);
  useEffect(() => { setPage(1); }, [q, status, condition, derived]);

  // Per-row compliance signals, derived from real data.
  const signalFor = (r: VehicleRow) => {
    const v = (r.vin || "").toUpperCase();
    const stickerDone = r.status === "published";
    const hasAddendum = addendumVins.has(v);
    const priceVerified = byVin.has(v);
    const needsPriceVerify = r.price != null && !priceVerified;
    return { stickerDone, hasAddendum, priceVerified, needsPriceVerify };
  };

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (condition !== "all" && r.condition !== condition) return false;
      if (derived !== "all") {
        const s = signalFor(r);
        if (derived === "needs-sticker" && s.stickerDone) return false;
        if (derived === "missing-addendum" && s.hasAddendum) return false;
        if (derived === "price-verify" && !s.needsPriceVerify) return false;
      }
      if (!lc) return true;
      return (
        r.vin.toLowerCase().includes(lc) ||
        (r.ymm || "").toLowerCase().includes(lc) ||
        (r.trim || "").toLowerCase().includes(lc) ||
        (r.stock_number || "").toLowerCase().includes(lc)
      );
    });
  }, [rows, q, status, condition, derived, addendumVins, byVin]);

  // KPI + health computations — derived from the already-loaded rows so the
  // dashboard lights up instantly with no extra round-trip.
  const counts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const publishedRows = rows.filter((r) => r.status === "published");
    const publishedRecent = publishedRows.filter(
      (r) => r.published_at && new Date(r.published_at).getTime() >= sevenDaysAgo,
    );
    const totalViews = rows.reduce((sum, r) => sum + (r.view_count || 0), 0);
    const newCount = rows.filter((r) => r.condition === "new").length;
    const usedCount = rows.filter((r) => r.condition === "used" || r.condition === "cpo").length;
    let needsSticker = 0, missingAddendum = 0, priceVerify = 0, clean = 0;
    for (const r of rows) {
      const s = signalFor(r);
      if (!s.stickerDone) needsSticker++;
      if (!s.hasAddendum) missingAddendum++;
      if (s.needsPriceVerify) priceVerify++;
      if (s.stickerDone && s.hasAddendum && !s.needsPriceVerify) clean++;
    }
    const total = rows.length;
    const health = total ? Math.round((clean / total) * 100) : 100;
    return {
      total,
      draft: rows.filter((r) => r.status === "draft").length,
      published: publishedRows.length,
      publishedRecent: publishedRecent.length,
      totalViews,
      newCount,
      usedCount,
      needsSticker,
      missingAddendum,
      priceVerify,
      readyToPublish: clean,
      health,
    };
  }, [rows, addendumVins, byVin]);

  const dealerName =
    (settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_name) ||
    (tenant?.name && tenant.name !== "AutoLabels.io" && tenant.name) ||
    "Your Dealership";

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-5">
      <PageTabs tabs={VEHICLES_TABS} />

      {/* Header + dealer summary card */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 pt-1">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Car className="w-3 h-3" />
            Inventory
          </div>
          <h1 className="mt-0.5 text-2xl lg:text-[28px] font-display font-semibold tracking-tight text-foreground">
            Manage your inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every sticker, addendum, prep sign-off, and customer signature attaches to a vehicle file here.
          </p>
          <div className="flex items-stretch gap-2 flex-wrap mt-3">
            <button
              onClick={() => setShowAdd(true)}
              className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-sm font-semibold shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-2" />
              Add Vehicle
            </button>
            <button
              onClick={openScan}
              className="h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap"
              title="Scan a VIN — camera on phone/tablet, QR hand-off on desktop"
            >
              <ScanLine className="w-4 h-4 stroke-2" />
              Scan VIN
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4 stroke-2" />
              CSV Import
            </button>
            {settings.feature_price_verification && (
              <button
                onClick={runPriceScrape}
                disabled={scraping}
                title="Crawl your website and marketplaces (CARFAX, CarGurus, Cars.com, AutoTrader, Capital One) and record each site's advertised price per VIN"
                className="h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 stroke-2 ${scraping ? "animate-spin" : ""}`} />
                {scraping ? "Scraping…" : "Verify prices"}
              </button>
            )}
          </div>
        </div>

        <DealerSummaryCard
          name={dealerName}
          total={counts.total}
          compliance={counts.health}
          lastSync={lastSync}
          onPortal={() => navigate("/admin")}
        />
      </div>

      {/* Inventory health band */}
      <InventoryHealth counts={counts} onFilter={(d) => { setStatus("all"); setCondition("all"); setDerived(d); }} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard icon={Car} label="Total Vehicles" value={counts.total} sub={`${counts.newCount} new · ${counts.usedCount} used`} />
        <KpiCard icon={FileText} label="Drafts" value={counts.draft} accent="amber" sub={counts.draft > 0 ? "not ready to publish" : "all clear"} />
        <KpiCard icon={CheckCircle2} label="Published" value={counts.published} accent="emerald" sub="live on shopper portal" />
        <KpiCard icon={Printer} label="Published · 7 days" value={counts.publishedRecent} accent="sky" sub={counts.publishedRecent > 0 ? "this week" : "none this week"} />
        <KpiCard icon={Signature} label="Shopper Views" value={counts.totalViews} sub="lifetime" />
      </div>

      {/* Search + selects */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search VIN, stock #, year, make, model, trim…"
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-background text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 px-2.5 rounded-xl border border-border bg-background text-sm"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as ConditionFilter)}
          className="h-9 px-2.5 rounded-xl border border-border bg-background text-sm"
        >
          <option value="all">New &amp; used</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="cpo">CPO</option>
        </select>
      </div>

      {/* Quick-filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Pill label="All Vehicles" count={counts.total} active={status === "all" && condition === "all" && derived === "all"}
          onClick={() => { setStatus("all"); setCondition("all"); setDerived("all"); }} />
        <Pill label="New" count={counts.newCount} active={condition === "new"}
          onClick={() => { setDerived("all"); setStatus("all"); setCondition("new"); }} />
        <Pill label="Used" count={counts.usedCount} active={condition === "used"}
          onClick={() => { setDerived("all"); setStatus("all"); setCondition("used"); }} />
        <Pill label="Needs Sticker" count={counts.needsSticker} tone="amber" active={derived === "needs-sticker"}
          onClick={() => { setStatus("all"); setCondition("all"); setDerived("needs-sticker"); }} />
        <Pill label="Missing Addendum" count={counts.missingAddendum} tone="red" active={derived === "missing-addendum"}
          onClick={() => { setStatus("all"); setCondition("all"); setDerived("missing-addendum"); }} />
        <Pill label="Price Verification" count={counts.priceVerify} tone="amber" active={derived === "price-verify"}
          onClick={() => { setStatus("all"); setCondition("all"); setDerived("price-verify"); }} />
        <Pill label="Published" count={counts.published} tone="emerald" active={status === "published"}
          onClick={() => { setDerived("all"); setCondition("all"); setStatus("published"); }} />
        <Pill label="Draft" count={counts.draft} active={status === "draft"}
          onClick={() => { setDerived("all"); setCondition("all"); setStatus("draft"); }} />
      </div>

      {/* Add Vehicle modal */}
      {showAdd && (
        <AddVehicleModal
          tenantId={tenant?.id || null}
          userId={user?.id || null}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            navigate(`/vehicle-file/${id}`);
          }}
        />
      )}

      {showImport && (
        <CsvImportModal
          tenantId={tenant?.id || null}
          userId={user?.id || null}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}

      {/* Vehicle list */}
      {loading ? (
        <InventorySkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} total={rows.length} />
      ) : (
        <>
          <div className="space-y-2.5">
            {pageRows.map((r) => (
              <VehicleCard
                key={r.id}
                r={r}
                signal={signalFor(r)}
                onOpen={() => navigate(`/vehicle-file/${r.id}`)}
                onSticker={() => navigate(r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker")}
                onMakeSticker={() => navigate(`/vehicle-file/${r.id}?tab=labels`)}
                onGetReady={() => sendToGetReady(r)}
                onPrep={() => navigate(`/vehicle-file/${r.id}?tab=prep`)}
                onAddendum={() => navigate(`/vehicle-file/${r.id}?tab=addendum`)}
                onDefend={() => navigate(`/compliance?vin=${encodeURIComponent(r.vin || "")}`)}
                onView={() => window.open(`/v/${r.slug}`, "_blank", "noopener")}
                onDelete={() => deleteVehicle(r)}
              />
            ))}
          </div>

          <Pagination
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
};

// ── Dealer summary card ────────────────────────────────────────
const DealerSummaryCard = ({
  name, total, compliance, lastSync, onPortal,
}: {
  name: string; total: number; compliance: number; lastSync: string | null; onPortal: () => void;
}) => {
  const syncLabel = (() => {
    if (!lastSync) return "Never";
    const d = new Date(lastSync);
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return sameDay ? `${time} today` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  })();
  return (
    <div className="w-full lg:w-[340px] shrink-0 rounded-2xl border border-border bg-card shadow-sm p-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Dealership</p>
          <p className="font-display font-semibold text-foreground truncate">{name}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3.5">
        <div>
          <p className="font-display text-lg font-semibold tabular-nums text-foreground leading-none">{total}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Vehicles</p>
        </div>
        <div>
          <p className="font-display text-lg font-semibold tabular-nums text-emerald-600 leading-none">{compliance}%</p>
          <p className="text-[10px] text-muted-foreground mt-1">Compliance</p>
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-foreground leading-none mt-0.5 truncate">{syncLabel}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Last sync</p>
        </div>
      </div>
      <button
        onClick={onPortal}
        className="mt-3.5 w-full h-9 rounded-xl border border-border bg-background hover:bg-muted text-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
      >
        View Dealer Portal
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ── Inventory health band ──────────────────────────────────────
const InventoryHealth = ({
  counts, onFilter,
}: {
  counts: { health: number; total: number; readyToPublish: number; needsSticker: number; missingAddendum: number; priceVerify: number };
  onFilter: (d: DerivedFilter) => void;
}) => {
  const { health } = counts;
  const grade = health >= 90 ? "Excellent" : health >= 75 ? "Good" : health >= 50 ? "Fair" : "Needs attention";
  const bar = health >= 90 ? "bg-emerald-500" : health >= 75 ? "bg-blue-500" : health >= 50 ? "bg-amber-500" : "bg-red-500";
  const gradeColor = health >= 90 ? "text-emerald-600" : health >= 75 ? "text-blue-600" : health >= 50 ? "text-amber-600" : "text-red-600";
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 lg:p-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
        <div className="lg:w-64 shrink-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Inventory Health</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-display text-3xl font-semibold tabular-nums text-foreground leading-none">{health}%</span>
            <span className={`text-sm font-semibold ${gradeColor}`}>{grade}</span>
          </div>
          <div className="mt-2.5 h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${health}%` }} />
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <HealthMetric icon={Car} tone="neutral" value={counts.total} label="Total Vehicles" />
          <HealthMetric icon={ShieldCheck} tone="emerald" value={counts.readyToPublish} label="Ready to Publish" />
          <HealthMetric icon={Printer} tone="amber" value={counts.needsSticker} label="Needs Sticker" onClick={() => onFilter("needs-sticker")} />
          <HealthMetric icon={FileSignature} tone="red" value={counts.missingAddendum} label="Missing Addendum" onClick={() => onFilter("missing-addendum")} />
          <HealthMetric icon={CircleDollarSign} tone="amber" value={counts.priceVerify} label="Price Verification" onClick={() => onFilter("price-verify")} />
        </div>
      </div>
    </div>
  );
};

const HealthMetric = ({
  icon: Icon, tone, value, label, onClick,
}: {
  icon: typeof Car; tone: "neutral" | "emerald" | "amber" | "red"; value: number; label: string; onClick?: () => void;
}) => {
  const color =
    tone === "emerald" ? "text-emerald-600 bg-emerald-100" :
    tone === "amber" ? "text-amber-600 bg-amber-100" :
    tone === "red" ? "text-red-600 bg-red-100" :
    "text-muted-foreground bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-2.5 rounded-xl border border-border bg-background p-2.5 text-left ${onClick ? "hover:border-foreground/20 hover:shadow-sm transition-all cursor-pointer" : "cursor-default"}`}
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-semibold tabular-nums leading-none text-foreground">{value}</span>
        <span className="block text-[10px] text-muted-foreground mt-1 truncate">{label}</span>
      </span>
    </button>
  );
};

// ── KPI card ───────────────────────────────────────────────────
const KpiCard = ({
  icon: Icon, label, value, accent, sub,
}: {
  icon: typeof Car; label: string; value: number; accent?: "amber" | "emerald" | "sky"; sub?: string;
}) => {
  const valueColor =
    accent === "amber" ? "text-amber-700" :
    accent === "emerald" ? "text-emerald-700" :
    accent === "sky" ? "text-sky-700" :
    "text-foreground";
  const iconBg =
    accent === "amber" ? "bg-amber-100 text-amber-700" :
    accent === "emerald" ? "bg-emerald-100 text-emerald-700" :
    accent === "sky" ? "bg-sky-100 text-sky-700" :
    "bg-muted text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className="w-3.5 h-3.5" strokeWidth={2} />
        </span>
      </div>
      <p className={`mt-2 font-display text-3xl font-semibold tabular-nums leading-none ${valueColor}`}>
        {value.toLocaleString()}
      </p>
      {sub && <p className="text-[11px] mt-1.5 text-muted-foreground truncate">{sub}</p>}
    </div>
  );
};

// ── Quick-filter pill ──────────────────────────────────────────
const Pill = ({
  label, count, active, tone, onClick,
}: {
  label: string; count: number; active: boolean; tone?: "amber" | "red" | "emerald"; onClick: () => void;
}) => {
  const activeCls = "bg-blue-600 text-white border-blue-600";
  const idleCls = "bg-card text-foreground border-border hover:bg-muted";
  const countTone =
    active ? "bg-white/20 text-white" :
    tone === "amber" ? "bg-amber-100 text-amber-700" :
    tone === "red" ? "bg-red-100 text-red-700" :
    tone === "emerald" ? "bg-emerald-100 text-emerald-700" :
    "bg-muted text-muted-foreground";
  return (
    <button
      onClick={onClick}
      className={`h-8 pl-3 pr-2 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${active ? activeCls : idleCls}`}
    >
      {label}
      <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center tabular-nums ${countTone}`}>
        {count}
      </span>
    </button>
  );
};

// ── Vehicle card (row hybrid) ──────────────────────────────────
interface RowSignal { stickerDone: boolean; hasAddendum: boolean; priceVerified: boolean; needsPriceVerify: boolean; }

const VehicleCard = ({
  r, signal, onOpen, onSticker, onMakeSticker, onGetReady, onPrep, onAddendum, onDefend, onView, onDelete,
}: {
  r: VehicleRow;
  signal: RowSignal;
  onOpen: () => void;
  onSticker: () => void;
  onMakeSticker: () => void;
  onGetReady: () => void;
  onPrep: () => void;
  onAddendum: () => void;
  onDefend: () => void;
  onView: () => void;
  onDelete: () => void;
}) => {
  const condBadge =
    r.condition === "new" ? "bg-blue-100 text-blue-700" :
    r.condition === "cpo" ? "bg-violet-100 text-violet-700" :
    "bg-slate-100 text-slate-700";
  const thumbTint =
    r.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" :
    r.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" :
    "from-slate-400/15 to-slate-500/5 text-slate-500";

  return (
    <div
      onClick={onOpen}
      className="group rounded-2xl border border-border bg-card shadow-sm hover:shadow-md hover:border-foreground/15 transition-all cursor-pointer p-3 lg:p-3.5"
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        {/* Thumbnail + identity */}
        <div className="flex items-center gap-3 lg:w-[300px] shrink-0 min-w-0">
          <div className={`w-[120px] h-20 rounded-xl bg-gradient-to-br ${thumbTint} flex items-center justify-center shrink-0 overflow-hidden`}>
            <Car className="w-8 h-8" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-semibold text-[17px] leading-tight text-foreground truncate">
                {r.ymm || "(needs decode)"}
              </h3>
              {r.condition && (
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${condBadge}`}>
                  {r.condition}
                </span>
              )}
            </div>
            {r.trim && <p className="text-sm text-muted-foreground truncate">{r.trim}</p>}
          </div>
        </div>

        {/* Spec grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
          <Spec label="Stock #" value={r.stock_number || "—"} mono />
          <Spec label="VIN" value={r.vin ? `…${r.vin.slice(-6)}` : "—"} mono />
          <Spec label="Mileage" value={r.mileage ? `${r.mileage.toLocaleString()} mi` : "—"} />
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Price</p>
            <p className="text-sm font-semibold text-foreground tabular-nums leading-tight mt-0.5">
              {r.price ? `$${r.price.toLocaleString()}` : "—"}
            </p>
            {r.vin && r.price ? (
              <div className="mt-0.5"><AdvertisedPriceBand vin={r.vin} stickerPrice={r.price} compact /></div>
            ) : null}
          </div>
        </div>

        {/* Status pills */}
        <div className="flex lg:flex-col items-start gap-1.5 lg:w-[170px] shrink-0 flex-wrap">
          <StatusPill
            tone={signal.stickerDone ? "green" : "amber"}
            label={signal.stickerDone ? "Sticker Complete" : "Needs Sticker"}
          />
          <StatusPill
            tone={signal.hasAddendum ? "green" : "red"}
            label={signal.hasAddendum ? "Addendum Ready" : "Addendum Missing"}
          />
          {r.price ? (
            <StatusPill
              tone={signal.priceVerified ? "green" : "amber"}
              label={signal.priceVerified ? "Price Verified" : "Verify Price"}
            />
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {r.status === "published" ? (
            <button
              onClick={onView}
              className="h-9 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
              title="Open the public shopper page"
            >
              <Eye className="w-3.5 h-3.5" />
              View Page
            </button>
          ) : (
            <button
              onClick={onSticker}
              className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm shadow-blue-600/30 transition-colors whitespace-nowrap"
              title={r.condition === "new" ? "Generate new-car sticker" : "Generate used-car sticker"}
            >
              <Printer className="w-3.5 h-3.5" />
              Generate Sticker
            </button>
          )}
          <KebabMenu
            items={[
              { label: "Open Vehicle", icon: ExternalLink, onClick: onOpen },
              { label: "Make Sticker", icon: Printer, onClick: onMakeSticker },
              { label: "Send to Get-Ready", icon: Wrench, onClick: onGetReady },
              { label: "Prep & Install", icon: ClipboardList, onClick: onPrep },
              { label: "Build Addendum", icon: FileText, onClick: onAddendum },
              { label: "Audit Defense", icon: ShieldCheck, onClick: onDefend },
              ...(r.status === "published" ? [{ label: "View Shopper Page", icon: Eye, onClick: onView }] : []),
              { label: "Delete", icon: Trash2, onClick: onDelete, danger: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
};

const Spec = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`text-sm text-foreground leading-tight mt-0.5 truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
  </div>
);

const StatusPill = ({ tone, label }: { tone: "green" | "amber" | "red"; label: string }) => {
  const cls =
    tone === "green" ? "bg-emerald-100 text-emerald-700" :
    tone === "amber" ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
  const dot =
    tone === "green" ? "bg-emerald-500" :
    tone === "amber" ? "bg-amber-500" :
    "bg-red-500";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
};

interface KebabItem { label: string; icon: typeof Car; onClick: () => void; danger?: boolean; }

const KebabMenu = ({ items }: { items: KebabItem[] }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        className="w-9 h-9 rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-border bg-popover shadow-lg z-20 p-1">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                it.danger ? "text-red-600 hover:bg-red-50" : "text-foreground hover:bg-muted"
              }`}
            >
              <it.icon className="w-4 h-4 shrink-0" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Pagination ─────────────────────────────────────────────────
const Pagination = ({
  page, pageCount, total, pageSize, onPage,
}: {
  page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void;
}) => {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );
  const withGaps: (number | "gap")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) withGaps.push("gap");
    withGaps.push(p);
    prev = p;
  }
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground tabular-nums">{from}</span>–
        <span className="font-semibold text-foreground tabular-nums">{to}</span> of{" "}
        <span className="font-semibold text-foreground tabular-nums">{total}</span> vehicles
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="w-8 h-8 rounded-lg border border-border bg-card text-foreground inline-flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {withGaps.map((p, i) =>
            p === "gap" ? (
              <span key={`g${i}`} className="px-1 text-muted-foreground text-xs">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p)}
                className={`min-w-8 h-8 px-2 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                  p === page ? "bg-blue-600 text-white border-blue-600" : "bg-card text-foreground border-border hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            onClick={() => onPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            className="w-8 h-8 rounded-lg border border-border bg-card text-foreground inline-flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

const InventorySkeleton = () => (
  <div className="space-y-2.5">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="rounded-2xl border border-border bg-card p-3.5">
        <div className="flex items-center gap-4">
          <div className="w-[120px] h-20 rounded-xl bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 rounded bg-muted animate-pulse" />
            <div className="h-3 w-32 rounded bg-muted/70 animate-pulse" />
          </div>
          <div className="hidden lg:block space-y-2">
            <div className="h-6 w-28 rounded-lg bg-muted animate-pulse" />
            <div className="h-6 w-28 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-32 rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ onAdd, total }: { onAdd: () => void; total: number }) => (
  <SharedEmptyState
    icon={Car}
    title={total === 0 ? "Let's add your first vehicle" : "No vehicles match your filters"}
    description="Enter a VIN, mileage, and stock number. We'll decode the year, make, model, and equipment, then open the vehicle's file so you can generate stickers, addenda, and signing links."
    actions={[{ label: "Add Vehicle", icon: Plus, onClick: onAdd }]}
  />
);

interface AddProps {
  tenantId: string | null;
  userId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const makeSlug = (seed: string) => {
  const clean = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${clean || "veh"}-${rand}`;
};

const AddVehicleModal = ({ tenantId, userId, onClose, onCreated }: AddProps) => {
  const { decode, decoding } = useVinDecode();
  const [vin, setVin] = useState("");
  const [stock, setStock] = useState("");
  const [mileage, setMileage] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<"new" | "used" | "cpo">("used");
  const [state, setState] = useState("");
  const [decoded, setDecoded] = useState<{
    year?: string; make?: string; model?: string; trim?: string;
    bodyStyle?: string; engine?: string; fuelType?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDecode = async () => {
    if (vin.length < 11) {
      toast.error("Enter a full 17-character VIN to decode");
      return;
    }
    const result = await decode(vin);
    if (result) {
      setDecoded({
        year: result.year,
        make: result.make,
        model: result.model,
        trim: result.trim,
        bodyStyle: result.bodyStyle,
        engine: result.engineDescription,
        fuelType: result.fuelType,
      });
      if (result.year && parseInt(result.year) >= new Date().getFullYear()) {
        setCondition("new");
      }
      toast.success(`Decoded: ${result.year} ${result.make} ${result.model}`);
    } else {
      toast.error("VIN decode failed — you can still continue manually");
    }
  };

  const canSubmit = vin.trim().length >= 11 && stock.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ymm = decoded
      ? [decoded.year, decoded.make, decoded.model].filter(Boolean).join(" ")
      : null;
    const slug = makeSlug(`${decoded?.make || ""}-${decoded?.model || vin.slice(-6)}`);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .insert({
        // store_id is NOT NULL and holds the tenant id (text); set both so
        // the tenant-scoped (Inventory) and store-scoped (useVehicleListing)
        // read paths both find the row.
        store_id: tenantId,
        tenant_id: tenantId,
        vin: vin.trim().toUpperCase(),
        slug,
        ymm,
        trim: decoded?.trim || null,
        mileage: mileage ? parseInt(mileage.replace(/[^0-9]/g, ""), 10) : null,
        condition,
        price: price ? parseFloat(price.replace(/[^0-9.]/g, "")) : null,
        sticker_snapshot: decoded ? { decoded } : {},
        dealer_snapshot: {},
        status: "draft",
        created_by: userId,
      })
      .select()
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    onCreated(data.id);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Car className="w-5 h-5 text-primary" />
            Add Vehicle
          </h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Paste the VIN and click Decode to auto-fill year / make / model / trim / equipment
          from NHTSA. You can also continue without decoding.
        </p>

        <div className="space-y-3">
          <Field label="VIN *" required>
            <div className="flex items-center gap-2">
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="17 characters"
                maxLength={17}
                className="flex-1 h-10 px-3 rounded-md border border-border bg-background text-sm font-mono tracking-wider"
              />
              <button
                onClick={handleDecode}
                disabled={decoding || vin.length < 11}
                className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
              >
                {decoding ? "Decoding…" : "Decode"}
              </button>
            </div>
          </Field>

          {decoded && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Decoded
              </div>
              <p className="text-emerald-900">
                {[decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(" ")}
                {decoded.bodyStyle ? ` · ${decoded.bodyStyle}` : ""}
                {decoded.engine ? ` · ${decoded.engine}` : ""}
                {decoded.fuelType ? ` · ${decoded.fuelType}` : ""}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock # *" required>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="e.g. T5892"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
            <Field label="Mileage">
              <input
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="e.g. 42850"
                inputMode="numeric"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price (optional)">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
            <Field label="Condition">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as typeof condition)}
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              >
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="cpo">CPO</option>
              </select>
            </Field>
            <Field label="Sale state">
              <input
                value={state}
                onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="e.g. CA"
                maxLength={2}
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm uppercase"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting ? "Creating…" : "Create & open file"}
            {!submitting && <FileText className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ImportProps {
  tenantId: string | null;
  userId: string | null;
  onClose: () => void;
  onImported: () => void;
}

const CsvImportModal = ({ tenantId, userId, onClose, onImported }: ImportProps) => {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleImport = async () => {
    if (!tenantId) return;
    setSubmitting(true);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("Paste at least a header row and one vehicle");
      setSubmitting(false);
      return;
    }
    const header = lines[0].toLowerCase().split(/[,\t]/).map((h) => h.trim());
    const col = (name: string) => header.findIndex((h) => h === name || h === name.replace(/_/g, " "));
    const idx = {
      vin: col("vin"),
      stock: col("stock"),
      mileage: col("mileage"),
      condition: col("condition"),
      price: col("price"),
      year: col("year"),
      make: col("make"),
      model: col("model"),
      trim: col("trim"),
    };
    if (idx.vin < 0 || idx.stock < 0) {
      toast.error("CSV must have at least 'vin' and 'stock' columns");
      setSubmitting(false);
      return;
    }
    const toInsert = lines.slice(1).map((line) => {
      const cells = line.split(/[,\t]/).map((c) => c.trim());
      const vin = (cells[idx.vin] || "").toUpperCase();
      if (vin.length < 11) return null;
      const year = idx.year >= 0 ? cells[idx.year] : "";
      const make = idx.make >= 0 ? cells[idx.make] : "";
      const model = idx.model >= 0 ? cells[idx.model] : "";
      const ymm = [year, make, model].filter(Boolean).join(" ");
      return {
        store_id: tenantId,
        tenant_id: tenantId,
        vin,
        slug: makeSlug(`${make}-${model || vin.slice(-6)}`),
        ymm: ymm || null,
        trim: idx.trim >= 0 ? cells[idx.trim] : null,
        mileage: idx.mileage >= 0 && cells[idx.mileage] ? parseInt(cells[idx.mileage].replace(/[^0-9]/g, ""), 10) : null,
        price: idx.price >= 0 && cells[idx.price] ? parseFloat(cells[idx.price].replace(/[^0-9.]/g, "")) : null,
        condition: idx.condition >= 0 ? (cells[idx.condition] || "used").toLowerCase() as "new" | "used" | "cpo" : "used",
        sticker_snapshot: {},
        dealer_snapshot: {},
        status: "draft",
        created_by: userId,
      };
    }).filter(Boolean) as Record<string, unknown>[];

    const { error, data } = await (supabase as any)
      .from("vehicle_listings")
      .insert(toInsert)
      .select("id");
    setSubmitting(false);
    if (error) {
      toast.error(`Import failed: ${error.message}`);
      return;
    }
    toast.success(`Imported ${data?.length ?? 0} vehicle(s)`);
    onImported();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            CSV Import
          </h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold mb-1">Format</p>
            <p>
              First row is the header with column names. Minimum columns:{" "}
              <span className="font-mono">vin,stock</span>. Supported:{" "}
              <span className="font-mono">vin, stock, mileage, condition, price, year, make, model, trim</span>.
            </p>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"vin,stock,mileage,condition,price,year,make,model,trim\n1HGCM82633A123456,T5892,42850,used,24995,2023,Honda,Accord,EX-L"}
          rows={10}
          className="w-full rounded-md border border-border bg-background text-xs font-mono p-3"
        />
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!text.trim() || submitting}
            className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">
      {label}
      {required ? <span className="text-destructive ml-0.5">*</span> : null}
    </label>
    <div className="mt-1">{children}</div>
  </div>
);

export default Inventory;

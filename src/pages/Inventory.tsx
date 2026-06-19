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
  X, CheckCircle2, AlertTriangle, RefreshCw, MoreVertical, Gauge, Building2,
  ShieldCheck, ClipboardList, ExternalLink, Trash2, Wrench,
  ChevronLeft, ChevronRight, Eye, CircleDollarSign, FileSignature,
} from "lucide-react";
import SharedEmptyState from "@/components/ui/empty-state";
import { AdvertisedPriceBand } from "@/components/inventory/AdvertisedPriceBand";

// ──────────────────────────────────────────────────────────────
// Inventory — dealer's primary workspace, as an Inventory Command
// Center. Tablet/desktop render a dense table + a utility sidebar
// (quick actions, a status donut, recent activity); phones get the
// card list. Every status/readiness signal is derived from real
// data (status, addendum presence, advertised-price snapshot) so
// the numbers are honest, not decorative.
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
  hero_image_url?: string | null;
  recall_status?: string | null;
  open_recall_count?: number | null;
  market_position?: string | null;
  market_value?: number | null;
}

interface ActivityRow { id: string; action: string; created_at: string; details: Record<string, unknown> | null; }

type StatusFilter = "all" | "draft" | "published" | "archived";
type ConditionFilter = "all" | "new" | "used" | "cpo";
type DerivedFilter = "all" | "needs-sticker" | "missing-addendum" | "price-verify" | "open-recalls";

const PAGE_SIZE = 25;

const Inventory = () => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { createGetReady } = useGetReady(tenant?.id || "");
  const { settings } = useDealerSettings();
  const { byVin } = useAdvertisedPrices(tenant?.id || "");

  const sendToGetReady = async (r: { id: string; vin: string | null; ymm: string | null; condition: string | null }) => {
    const rec = await createGetReady({
      vin: r.vin || "",
      stockNumber: (r.vin || "").slice(-6),
      ymm: r.ymm || "",
      condition: r.condition === "new" ? "new" : "used",
      acquiredDate: new Date().toISOString().slice(0, 10),
      accessoriesToInstall: [],
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
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [lastSync, setLastSync] = useState<{ at: string | null; status: Record<string, unknown> | null }>({ at: null, status: null });
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

  const runPriceScrape = async () => {
    if (!tenant?.id) { toast.error("No active dealership"); return; }
    setScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke("crawl-advertised-prices", {
        body: { tenant_id: tenant.id, discover: true },
      });
      if (error) throw error;
      const d = (data || {}) as { discovered?: number; updated?: number };
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

  const runRecallBatch = async () => {
    if (!tenant?.id) { toast.error("No active dealership"); return; }
    toast.info("Checking recalls across inventory…");
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { tenant_id: tenant.id, batch: true } });
      if (error) throw error;
      const d = (data || {}) as { checked?: number; openFound?: number; error?: string };
      if (d.error === "not_configured") { toast.error("Recall lookup isn't configured (MarketCheck AutoRecalls key)."); return; }
      toast.success(`Recalls checked: ${d.checked ?? 0} vehicles · ${d.openFound ?? 0} with open recalls`);
      load();
    } catch { toast.error("Recall batch failed"); }
  };

  const runMarketBatch = async () => {
    if (!tenant?.id) { toast.error("No active dealership"); return; }
    toast.info("Checking market pricing across inventory…");
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-market-pricing", { body: { tenant_id: tenant.id, batch: true } });
      if (error) throw error;
      const d = (data || {}) as { checked?: number; greatDeals?: number; error?: string };
      if (d.error === "not_configured") { toast.error("Market pricing isn't configured (MarketCheck key)."); return; }
      toast.success(`Market pricing: ${d.checked ?? 0} checked · ${d.greatDeals ?? 0} great deals`);
      load();
    } catch { toast.error("Market pricing batch failed"); }
  };

  const quickRecall = async (vin: string) => {
    if (!vin) return;
    toast.info("Checking recalls…");
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { vin, tenant_id: tenant?.id } });
      if (error) throw error;
      const d = (data || {}) as { openRecallCount?: number; error?: string };
      if (d.error === "not_configured") { toast.error("Recall lookup isn't configured."); return; }
      toast.success((d.openRecallCount || 0) > 0 ? `${d.openRecallCount} open recall${d.openRecallCount === 1 ? "" : "s"} found` : "No active recalls");
      load();
    } catch { toast.error("Recall check failed"); }
  };

  const deleteVehicle = async (r: VehicleRow) => {
    if (!window.confirm(`Remove ${r.ymm || r.vin} from inventory? This deletes the vehicle file.`)) return;
    const { error } = await (supabase as any).from("vehicle_listings").delete().eq("id", r.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success("Vehicle removed");
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  // Open the Add-Vehicle modal whenever ?add=1 arrives — including when the
  // sidebar button is clicked while already on /inventory (the useState
  // initializer only runs on first mount, so the effect must flip it too).
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setShowAdd(true);
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,view_count,created_at,updated_at";
    const runSelect = (cols: string) => (supabase as any)
      .from("vehicle_listings")
      .select(cols)
      .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
      .order("updated_at", { ascending: false })
      .limit(500);
    // Resilient cascade: drop only the columns that aren't migrated yet, so a
    // missing newest column never knocks out the older enrichment (e.g. photos).
    // Resilient cascade: any schema/column error (e.g. a not-yet-migrated column
    // or a stale PostgREST schema cache right after a deploy) drops the newest
    // columns and retries, so it never blanks the page over a missing column.
    const isSchemaErr = (e: { message?: string; code?: string } | null) =>
      !!e && (/column|does not exist|schema cache/i.test(e.message || "") || ["42703", "PGRST204", "42P01"].includes(e.code || ""));
    let data: unknown = null;
    let error: { message?: string; code?: string } | null = null;
    try {
      for (const cols of [
        `${baseCols},hero_image_url,recall_status,open_recall_count,market_position,market_value`,
        `${baseCols},hero_image_url,recall_status,open_recall_count`,
        baseCols,
      ]) {
        const res = await runSelect(cols);
        if (!res.error) { data = res.data; error = null; break; }
        error = res.error;
        if (!isSchemaErr(res.error)) break; // genuine error → stop retrying
      }
    } catch (e) {
      error = { message: e instanceof Error ? e.message : "network error" };
    }
    if (error) {
      // Preserve the last good rows on a transient re-load failure; only blank
      // + toast on the very first load when there is nothing to show.
      setRows((prev) => { if (prev.length === 0) toast.error("Couldn't refresh inventory — retrying shortly."); return prev; });
      setLoading(false);
      return;
    }
    {
      let rows = (data || []) as VehicleRow[];
      const vins = rows.map((r) => r.vin).filter(Boolean);
      const adVins = new Set<string>();
      if (vins.length) {
        try {
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
    // Best-effort last MarketCheck sync status for the sync card.
    try {
      const { data: cfg } = await (supabase as any)
        .from("marketcheck_sync_config").select("last_run_at, last_status").eq("tenant_id", tenant.id).maybeSingle();
      setLastSync({ at: cfg?.last_run_at ?? null, status: cfg?.last_status ?? null });
    } catch { setLastSync({ at: null, status: null }); }
    // Best-effort recent activity for the sidebar.
    try {
      const { data: act } = await (supabase as any)
        .from("audit_log")
        .select("id,action,created_at,details")
        .eq("store_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(6);
      setActivity((act || []) as ActivityRow[]);
    } catch { setActivity([]); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);
  useEffect(() => { setPage(1); }, [q, status, condition, derived]);

  const signalFor = (r: VehicleRow) => {
    const v = (r.vin || "").toUpperCase();
    const stickerDone = r.status === "published";
    const hasAddendum = addendumVins.has(v);
    const priceVerified = byVin.has(v);
    const needsPriceVerify = r.price != null && !priceVerified;
    return { stickerDone, hasAddendum, priceVerified, needsPriceVerify };
  };

  // Lightweight per-vehicle readiness (5 checks → 20% steps) for the ring.
  const rowReadiness = (r: VehicleRow) => {
    const s = signalFor(r);
    const flags = [true, !!r.ymm, s.stickerDone, s.hasAddendum, r.price ? s.priceVerified : true];
    return Math.round((flags.filter(Boolean).length / flags.length) * 100);
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
        if (derived === "open-recalls" && !((r.open_recall_count || 0) > 0)) return false;
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

  const counts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const publishedRows = rows.filter((r) => r.status === "published");
    const publishedRecent = publishedRows.filter(
      (r) => r.published_at && new Date(r.published_at).getTime() >= sevenDaysAgo,
    );
    const totalViews = rows.reduce((sum, r) => sum + (r.view_count || 0), 0);
    const newCount = rows.filter((r) => r.condition === "new").length;
    const usedCount = rows.filter((r) => r.condition === "used").length;
    const cpoCount = rows.filter((r) => r.condition === "cpo").length;
    let needsSticker = 0, missingAddendum = 0, priceVerify = 0, clean = 0;
    let vinDecoded = 0, openRecallsTotal = 0, openRecallVehicles = 0, readinessSum = 0;
    let needsAttention = 0, marketSum = 0, marketCount = 0;
    for (const r of rows) {
      const s = signalFor(r);
      if (!s.stickerDone) needsSticker++;
      if (!s.hasAddendum) missingAddendum++;
      if (s.needsPriceVerify) priceVerify++;
      if (s.stickerDone && s.hasAddendum && !s.needsPriceVerify) clean++;
      if (r.ymm) vinDecoded++;
      const openR = (r.open_recall_count || 0) > 0;
      openRecallsTotal += (r.open_recall_count || 0);
      if (openR) openRecallVehicles++;
      if (!s.hasAddendum || s.needsPriceVerify || openR) needsAttention++;
      if (r.market_value && r.price) { marketSum += (Number(r.market_value) - r.price); marketCount++; }
      readinessSum += rowReadiness(r);
    }
    const total = rows.length;
    const archived = rows.filter((r) => r.status === "archived").length;
    const health = total ? Math.round((clean / total) * 100) : 100;
    return {
      total,
      draft: rows.filter((r) => r.status === "draft").length,
      published: publishedRows.length,
      archived,
      publishedRecent: publishedRecent.length,
      totalViews,
      newCount, usedCount, cpoCount,
      needsSticker, missingAddendum, priceVerify,
      readyToPublish: clean,
      vinDecoded, openRecallsTotal, openRecallVehicles, needsAttention,
      avgReadiness: total ? Math.round(readinessSum / total) : 0,
      avgBelowMarket: marketCount ? Math.round(marketSum / marketCount) : 0,
      health,
    };
  }, [rows, addendumVins, byVin]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const readinessSpark = pageRows.map(rowReadiness);
  const topIssue = (() => {
    const issues = [
      { label: "Missing Addendums", n: counts.missingAddendum },
      { label: "Missing Stickers", n: counts.needsSticker },
      { label: "Price Reviews", n: counts.priceVerify },
      { label: "Open Recalls", n: counts.openRecallVehicles },
    ].sort((a, b) => b.n - a.n);
    return issues[0].n > 0 ? issues[0].label : "All clear";
  })();

  const rowActions = (r: VehicleRow): KebabItem[] => [
    { label: "Open Vehicle", icon: ExternalLink, onClick: () => navigate(`/vehicle-file/${r.id}`) },
    { label: r.condition === "new" ? "New-Car Sticker" : "Used-Car Sticker", icon: Printer, onClick: () => navigate(r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker") },
    { label: "Make Sticker", icon: Printer, onClick: () => navigate(`/vehicle-file/${r.id}?tab=labels`) },
    { label: "Send to Get-Ready", icon: Wrench, onClick: () => sendToGetReady(r) },
    { label: "Prep & Install", icon: ClipboardList, onClick: () => navigate(`/vehicle-file/${r.id}?tab=prep`) },
    { label: "Build Addendum", icon: FileText, onClick: () => navigate(`/vehicle-file/${r.id}?tab=addendum`) },
    { label: "Audit Defense", icon: ShieldCheck, onClick: () => navigate(`/compliance?vin=${encodeURIComponent(r.vin || "")}`) },
    ...(r.status === "published" ? [{ label: "View Shopper Page", icon: Eye, onClick: () => window.open(`/v/${r.slug}`, "_blank", "noopener") }] : []),
    { label: "Delete", icon: Trash2, onClick: () => deleteVehicle(r), danger: true },
  ];

  const onHealthMetric = (key: string) => {
    setDerived("all"); setStatus("all"); setCondition("all");
    if (key === "ready" || key === "published") setStatus("published");
    else if (key === "needs-sticker") setDerived("needs-sticker");
    else if (key === "missing-addendum" || key === "needs-attention") setDerived("missing-addendum");
    else if (key === "price-verify" || key === "price-reviews") setDerived("price-verify");
    else if (key === "open-recalls") setDerived("open-recalls");
    // "total" clears everything (done above)
  };

  const dealerName = (settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_name) || (tenant?.name && tenant.name !== "AutoLabels.io" && tenant.name) || "Your Dealership";
  const dealerLoc = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      <PageTabs tabs={VEHICLES_TABS} />

      <div className="flex flex-col xl:flex-row gap-5">
        {/* Main column */}
        <div className="flex-1 min-w-0 space-y-5">
          <ExecKpiStrip counts={counts} onMetric={onHealthMetric} onMarket={runMarketBatch} />

          {/* Search + selects */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock #, year, make, model, trim…" className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-background text-sm" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 px-2.5 rounded-xl border border-border bg-background text-sm">
              <option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
            </select>
            <select value={condition} onChange={(e) => setCondition(e.target.value as ConditionFilter)} className="h-9 px-2.5 rounded-xl border border-border bg-background text-sm">
              <option value="all">New &amp; used</option><option value="new">New</option><option value="used">Used</option><option value="cpo">CPO</option>
            </select>
          </div>

          {/* Quick-filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <Pill label="All Vehicles" count={counts.total} active={status === "all" && condition === "all" && derived === "all"} onClick={() => { setStatus("all"); setCondition("all"); setDerived("all"); }} />
            <Pill label="New" count={counts.newCount} active={condition === "new"} onClick={() => { setDerived("all"); setStatus("all"); setCondition("new"); }} />
            <Pill label="Used" count={counts.usedCount} active={condition === "used"} onClick={() => { setDerived("all"); setStatus("all"); setCondition("used"); }} />
            <Pill label="CPO" count={counts.cpoCount} active={condition === "cpo"} onClick={() => { setDerived("all"); setStatus("all"); setCondition("cpo"); }} />
            <Pill label="Needs Sticker" count={counts.needsSticker} tone="amber" active={derived === "needs-sticker"} onClick={() => { setStatus("all"); setCondition("all"); setDerived("needs-sticker"); }} />
            <Pill label="Missing Addendum" count={counts.missingAddendum} tone="red" active={derived === "missing-addendum"} onClick={() => { setStatus("all"); setCondition("all"); setDerived("missing-addendum"); }} />
            <Pill label="Price Verification" count={counts.priceVerify} tone="amber" active={derived === "price-verify"} onClick={() => { setStatus("all"); setCondition("all"); setDerived("price-verify"); }} />
            <Pill label="Published" count={counts.published} tone="emerald" active={status === "published"} onClick={() => { setDerived("all"); setCondition("all"); setStatus("published"); }} />
            <Pill label="Draft" count={counts.draft} active={status === "draft"} onClick={() => { setDerived("all"); setCondition("all"); setStatus("draft"); }} />
          </div>

          {/* List */}
          {loading ? (
            <InventorySkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} total={rows.length} />
          ) : (
            <>
              {/* Table (tablet/desktop) */}
              <div className="hidden md:block rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left font-semibold px-4 py-3">Vehicle</th>
                      <th className="text-left font-semibold px-3 py-3">Stock # / VIN</th>
                      <th className="text-left font-semibold px-3 py-3">Status</th>
                      <th className="text-left font-semibold px-3 py-3">Readiness</th>
                      <th className="text-left font-semibold px-3 py-3">Compliance</th>
                      <th className="text-right font-semibold px-3 py-3">Advertised Price</th>
                      <th className="text-left font-semibold px-3 py-3">Publishing</th>
                      <th className="text-left font-semibold px-3 py-3">Updated</th>
                      <th className="text-right font-semibold px-3 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pageRows.map((r) => (
                      <tr key={r.id} className="group hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => navigate(`/vehicle-file/${r.id}`)}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <Thumb r={r} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground truncate">{r.ymm || "(needs decode)"}</span>
                                {r.condition && <CondBadge condition={r.condition} />}
                              </div>
                              {r.trim && <p className="text-xs text-muted-foreground truncate">{r.trim}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-mono text-xs text-foreground">{r.stock_number || "—"}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">…{(r.vin || "").slice(-6)}</p>
                        </td>
                        <td className="px-3 py-3"><StatusPill status={r.status} /></td>
                        <td className="px-3 py-3">
                          <ReadinessCell r={r} signal={signalFor(r)} pct={rowReadiness(r)} />
                        </td>
                        <td className="px-3 py-3">
                          <ComplianceCell r={r} />
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <p className="text-base font-bold text-foreground tabular-nums leading-tight">{r.price ? `$${r.price.toLocaleString()}` : "—"}</p>
                          {r.price ? (
                            <div className="mt-0.5 leading-tight">
                              <p className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Advertised</p>
                              {settings.doc_fee_amount > 0 && <p className="text-[10px] text-muted-foreground">incl. ${settings.doc_fee_amount.toLocaleString()} doc</p>}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <PortalChip status={r.status} />
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{relativeDay(r.updated_at)}</td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end items-center gap-1">
                            <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <HoverBtn title="Open vehicle" onClick={() => navigate(`/vehicle-file/${r.id}`)}><ExternalLink className="w-3.5 h-3.5" /></HoverBtn>
                              <HoverBtn title="Generate sticker" onClick={() => navigate(r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker")}><Printer className="w-3.5 h-3.5" /></HoverBtn>
                              {r.status === "published" && <HoverBtn title="Preview shopper portal" onClick={() => window.open(`/v/${r.slug}`, "_blank", "noopener")}><Eye className="w-3.5 h-3.5" /></HoverBtn>}
                              <HoverBtn title="Quick recall check" onClick={() => quickRecall(r.vin)}><ShieldCheck className="w-3.5 h-3.5" /></HoverBtn>
                            </div>
                            <KebabMenu items={rowActions(r)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards (mobile) */}
              <div className="md:hidden space-y-2.5">
                {pageRows.map((r) => (
                  <VehicleCard
                    key={r.id}
                    r={r}
                    signal={signalFor(r)}
                    readiness={rowReadiness(r)}
                    onOpen={() => navigate(`/vehicle-file/${r.id}`)}
                    onSticker={() => navigate(r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker")}
                    onView={() => window.open(`/v/${r.slug}`, "_blank", "noopener")}
                    items={rowActions(r)}
                  />
                ))}
              </div>

              <Pagination page={safePage} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          )}
        </div>

        {/* Sidebar */}
        <aside className="xl:w-[300px] shrink-0 space-y-4">
          <div className="rounded-[20px] border border-[#EAECEF] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.04)] p-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <QuickAction icon={Plus} label="Add Vehicle" onClick={() => setShowAdd(true)} />
              <QuickAction icon={ScanLine} label="Scan VIN" onClick={openScan} />
              <QuickAction icon={Printer} label="New Car Sticker" onClick={() => navigate("/new-car-sticker")} />
              <QuickAction icon={FileSignature} label="New Addendum" onClick={() => navigate("/addendum")} />
              <QuickAction icon={ShieldCheck} label="Check Recalls" onClick={runRecallBatch} />
              <QuickAction icon={CircleDollarSign} label="Check Market Prices" onClick={runMarketBatch} />
              {settings.feature_price_verification && <QuickAction icon={RefreshCw} label={scraping ? "Verifying…" : "Verify Prices"} onClick={runPriceScrape} />}
              <QuickAction icon={Upload} label="CSV Import" onClick={() => setShowImport(true)} />
            </div>
          </div>

          <SideCard title="Inventory Insights">
            <div className="flex items-end justify-between gap-2">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-semibold text-emerald-600 tabular-nums leading-none">{counts.avgReadiness}%</span>
                <span className="text-sm font-semibold text-foreground">Ready</span>
              </div>
              <Sparkline values={readinessSpark} />
            </div>
            <ul className="space-y-2.5 mt-3 pt-3 border-t border-border">
              <InsightRow icon={Printer} label="Need stickers" value={counts.needsSticker} tone={counts.needsSticker ? "amber" : "neutral"} iconTone="amber" />
              <InsightRow icon={FileSignature} label="Need addendums" value={counts.missingAddendum} tone={counts.missingAddendum ? "amber" : "neutral"} iconTone="red" />
              <InsightRow icon={ShieldCheck} label="Open recalls" value={counts.openRecallVehicles} tone={counts.openRecallVehicles ? "red" : "emerald"} iconTone={counts.openRecallVehicles ? "red" : "emerald"} />
              <InsightRow icon={CircleDollarSign} label="Price reviews" value={counts.priceVerify} iconTone="blue" />
            </ul>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Top issue</span>
              <span className="text-xs font-bold text-amber-600">{topIssue}</span>
            </div>
            <p className="text-[11px] font-semibold text-blue-600 mt-3 cursor-default">View full insights →</p>
          </SideCard>

          <SideCard title="Inventory by Status">
            <StatusDonut published={counts.published} draft={counts.draft} archived={counts.archived} total={counts.total} />
          </SideCard>

          <SideCard title="Recent Activity">
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent activity yet. Sticker generations, prep sign-offs, and customer signings appear here.</p>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {activity.map((a) => {
                    const { icon: Icon, tone } = activityIcon(a.action);
                    const d = (a.details || {}) as Record<string, unknown>;
                    const detail = String(d.stock || d.vin || d.customer_name || d.ymm || "").trim();
                    return (
                      <li key={a.id} className="flex items-start gap-2.5">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${tone}`}><Icon className="w-3.5 h-3.5" /></span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-tight">{prettyAction(a.action)}</p>
                          {detail && <p className="text-[11px] text-muted-foreground truncate">{detail}</p>}
                          <p className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] font-semibold text-blue-600 mt-3 cursor-default">View all activity →</p>
              </>
            )}
          </SideCard>

          <SideCard title="Dealer Health">
            <div className="grid grid-cols-2 gap-2.5">
              <HealthStat label="Compliance score" value={`${counts.health}%`} tone="emerald" />
              <HealthStat label="Inventory readiness" value={`${counts.avgReadiness}%`} tone="blue" />
              <HealthStat label="Open issues" value={counts.needsAttention} tone={counts.needsAttention ? "amber" : "emerald"} />
              <HealthStat label={`Market position`} value={`$${Math.abs(counts.avgBelowMarket).toLocaleString()} ${counts.avgBelowMarket >= 0 ? "below" : "above"}`} tone={counts.avgBelowMarket >= 0 ? "emerald" : "amber"} small />
            </div>
            <p className="text-[11px] font-semibold text-blue-600 mt-3 cursor-default">View dealer health →</p>
          </SideCard>
        </aside>
      </div>

      {/* Modals */}
      {showAdd && (
        <AddVehicleModal tenantId={tenant?.id || null} userId={user?.id || null} onClose={() => setShowAdd(false)} onCreated={(id) => { setShowAdd(false); navigate(`/vehicle-file/${id}`); }} />
      )}
      {showImport && (
        <CsvImportModal tenantId={tenant?.id || null} userId={user?.id || null} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />
      )}
    </div>
  );
};

// ── Small helpers ──────────────────────────────────────────────
const PRETTY_ACTION: Record<string, string> = {
  listing_viewed: "Customer viewed portal",
  listing_published: "Published to shopper portal",
  addendum_signed: "Customer signed the addendum",
  addendum_viewed: "Addendum opened by customer",
  prep_sign_off_signed: "Prep & install signed off",
  recall_checked: "NHTSA recall lookup ran",
  vdp_scraped: "VDP scraped from dealer site",
};
const prettyAction = (a: string) => PRETTY_ACTION[a] || a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const activityIcon = (action: string): { icon: typeof Car; tone: string } => {
  if (/recall/i.test(action)) return { icon: AlertTriangle, tone: "bg-red-100 text-red-600" };
  if (/vin|decode/i.test(action)) return { icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" };
  if (/price/i.test(action)) return { icon: CircleDollarSign, tone: "bg-amber-100 text-amber-600" };
  if (/sticker|print/i.test(action)) return { icon: Printer, tone: "bg-blue-100 text-blue-600" };
  if (/publish|listing|portal/i.test(action)) return { icon: Eye, tone: "bg-emerald-100 text-emerald-600" };
  if (/sync|marketcheck/i.test(action)) return { icon: RefreshCw, tone: "bg-blue-100 text-blue-600" };
  return { icon: CheckCircle2, tone: "bg-blue-600/10 text-blue-600" };
};

const relativeDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  if (isYest) return `Yesterday · ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const Thumb = ({ r }: { r: VehicleRow }) => {
  const [err, setErr] = useState(false);
  const tint =
    r.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" :
    r.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" :
    "from-slate-400/15 to-slate-500/5 text-slate-500";
  return (
    <div className={`w-20 h-[60px] rounded-lg bg-gradient-to-br ${tint} flex items-center justify-center shrink-0 overflow-hidden`}>
      {r.hero_image_url && !err
        ? <img src={r.hero_image_url} alt={r.ymm || "vehicle"} loading="lazy" onError={() => setErr(true)} className="w-full h-full object-cover" />
        : <Car className="w-6 h-6" strokeWidth={1.5} />}
    </div>
  );
};

const CondBadge = ({ condition }: { condition: "new" | "used" | "cpo" }) => {
  const cls = condition === "new" ? "bg-blue-100 text-blue-700" : condition === "cpo" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-700";
  return <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{condition}</span>;
};

const MiniRing = ({ pct }: { pct: number }) => {
  const tone = pct >= 100 ? "#10B981" : pct >= 60 ? "#2563EB" : pct >= 40 ? "#F59E0B" : "#EF4444";
  const r = 14; const c = 2 * Math.PI * r;
  return (
    <div className="relative w-10 h-10">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" className="text-muted" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={tone} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums text-foreground">{pct}%</span>
    </div>
  );
};

// Readiness ring + hover breakdown (native title so the table's horizontal
// scroll never clips it).
const ReadinessCell = ({ r, signal, pct }: { r: VehicleRow; signal: RowSignal; pct: number }) => {
  const checks = [
    { label: "Vehicle created", short: "vehicle", ok: true },
    { label: "VIN decoded", short: "VIN decode", ok: !!r.ymm },
    { label: "Sticker generated", short: "sticker", ok: signal.stickerDone },
    { label: "Addendum complete", short: "addendum", ok: signal.hasAddendum },
    { label: "Price verified", short: "price", ok: !r.price || signal.priceVerified },
  ];
  const done = checks.filter((c) => c.ok).length;
  const firstMissing = checks.find((c) => !c.ok);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const title = `${pct}% readiness\n` + checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("\n");
  return (
    <div className="flex items-center gap-2 cursor-help" title={title}>
      <MiniRing pct={pct} />
      <div className="min-w-0 leading-tight">
        <p className={`text-xs font-semibold ${firstMissing ? "text-amber-600" : "text-emerald-600"}`}>
          {firstMissing ? `Missing ${cap(firstMissing.short)}` : "Ready"}
        </p>
        <p className="text-[10px] text-muted-foreground">{done} / {checks.length} complete</p>
      </div>
    </div>
  );
};

// ── Sidebar primitives ─────────────────────────────────────────
const SideCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground mb-3">{title}</h3>
    {children}
  </div>
);

// Premium navigation pill — matches the reference Quick Actions card exactly:
// 58px full-pill rows, a 40px soft-blue icon circle, 16px label, right chevron.
const QuickAction = ({ icon: Icon, label, onClick }: { icon: typeof Car; label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2.5 pl-2 pr-3.5 h-[46px] rounded-full border border-[#E8EDF4] bg-[#F8FAFC] hover:bg-white hover:border-blue-500 hover:shadow-sm transition-all duration-200 text-left"
  >
    <span className="w-8 h-8 rounded-full bg-[#EAF2FF] text-blue-600 flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4" strokeWidth={2} />
    </span>
    <span className="flex-1 text-sm font-semibold text-[#111827] truncate">{label}</span>
    <ChevronRight className="w-4 h-4 text-[#6B7280] shrink-0" />
  </button>
);

const HealthStat = ({ label, value, tone, small }: { label: string; value: string | number; tone?: "emerald" | "blue" | "amber"; small?: boolean }) => {
  const c = tone === "emerald" ? "text-emerald-600" : tone === "blue" ? "text-blue-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-2.5">
      <p className={`font-display ${small ? "text-sm" : "text-lg"} font-semibold tabular-nums leading-none ${c}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
};

const InsightRow = ({ icon: Icon, label, value, tone = "neutral", pct, iconTone }: { icon: typeof Car; label: string; value: number | string; tone?: "emerald" | "amber" | "red" | "neutral"; pct?: number; iconTone?: "emerald" | "amber" | "red" | "blue" }) => {
  const vcls = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-foreground";
  const ibg = iconTone === "emerald" ? "bg-emerald-100 text-emerald-600" : iconTone === "amber" ? "bg-amber-100 text-amber-600" : iconTone === "red" ? "bg-red-100 text-red-600" : "bg-blue-600/10 text-blue-600";
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ibg}`}><Icon className="w-3.5 h-3.5" /></span>
        {label}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {pct != null && <span className="text-[10px] font-semibold text-emerald-600">{pct}%</span>}
        <span className={`text-sm font-semibold tabular-nums ${vcls}`}>{value}</span>
      </span>
    </li>
  );
};

const Sparkline = ({ values }: { values: number[] }) => {
  if (values.length < 2) return <div className="h-7 flex-1" />;
  const w = 96, h = 28;
  const max = Math.max(...values, 100), min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-blue-500 shrink-0" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const StatusDonut = ({ published, draft, archived, total }: { published: number; draft: number; archived: number; total: number }) => {
  const segs = [
    { label: "Published", value: published, color: "#10B981" },
    { label: "Draft", value: draft, color: "#F59E0B" },
    { label: "Archived", value: archived, color: "#CBD5E1" },
  ];
  const r = 15.9155; const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24 shrink-0">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" />
          {total > 0 && segs.map((s, i) => {
            const frac = s.value / total;
            const dash = frac * circ;
            const el = (
              <circle key={i} cx="20" cy="20" r={r} fill="none" stroke={s.color} strokeWidth="5"
                strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-lg font-semibold tabular-nums leading-none text-foreground">{total}</span>
          <span className="text-[9px] text-muted-foreground">Total</span>
        </div>
      </div>
      <ul className="space-y-1.5 flex-1 min-w-0">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {s.value} <span className="text-muted-foreground font-normal">({total ? Math.round((s.value / total) * 100) : 0}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Header dealer info card (matches the v3 executive toolbar) ──
const DealerInfoCard = ({ name, location, at, total }: { name: string; location: string; at: string | null; total: number }) => {
  const synced = !!at;
  const d = at ? new Date(at) : null;
  const sameDay = d ? d.toDateString() === new Date().toDateString() : false;
  const when = d ? (sameDay ? `${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} today` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "Never";
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm px-4 py-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center shrink-0"><Building2 className="w-5 h-5" /></span>
        <div className="min-w-0">
          <p className="font-display font-semibold text-foreground leading-tight truncate">{name}</p>
          {location && <p className="text-[11px] text-muted-foreground">{location}</p>}
        </div>
      </div>
      <div className="h-9 w-px bg-border hidden sm:block" />
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last synced</p>
        <p className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${synced ? "bg-emerald-500" : "bg-slate-300"}`} />
          {when} · {total.toLocaleString()} vehicles
        </p>
      </div>
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${synced ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
        <CheckCircle2 className="w-3 h-3" /> MarketCheck {synced ? "connected" : "—"}
      </span>
    </div>
  );
};

// ── Executive KPI strip ────────────────────────────────────────
const BigRing = ({ pct }: { pct: number }) => {
  const tone = pct >= 80 ? "#10B981" : pct >= 50 ? "#2563EB" : pct >= 30 ? "#F59E0B" : "#EF4444";
  const r = 16; const c = 2 * Math.PI * r;
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums text-foreground">{pct}%</span>
    </div>
  );
};

const ExecKpi = ({ label, value, sub, icon: Icon, tone, onClick, link, prominent }: { label: string; value: string | number; sub: string; icon: typeof Car; tone?: "emerald" | "amber" | "red" | "violet"; onClick: () => void; link?: string; prominent?: boolean }) => {
  const vcls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : tone === "violet" ? "text-violet-700" : "text-foreground";
  const ibg = tone === "emerald" ? "bg-emerald-100 text-emerald-700" : tone === "amber" ? "bg-amber-100 text-amber-700" : tone === "red" ? "bg-red-100 text-red-700" : tone === "violet" ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground";
  const cardBg = prominent && (tone === "red") ? "bg-red-50/70 border-red-200" : prominent ? "bg-amber-50/70 border-amber-200" : "bg-card border-border";
  return (
    <button onClick={onClick} className={`group/k shrink-0 min-w-[170px] lg:min-w-0 text-left rounded-2xl border shadow-sm p-4 hover:shadow-md hover:border-foreground/15 transition-all ${cardBg}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${ibg}`}><Icon className="w-3.5 h-3.5" strokeWidth={2} /></span>
      </div>
      <p className={`mt-2 font-display ${prominent ? "text-[2rem]" : "text-2xl"} font-semibold tabular-nums leading-none ${vcls}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className={`text-[11px] mt-1.5 truncate ${prominent ? "text-foreground/70 font-semibold" : "text-muted-foreground"}`}>{sub}</p>
      {link && <p className="text-[11px] font-semibold text-blue-600 mt-2 group-hover/k:underline">{link} →</p>}
    </button>
  );
};

interface KpiCounts {
  health: number; avgReadiness: number; total: number; readyToPublish: number; newCount: number; usedCount: number;
  published: number; needsAttention: number; openRecallVehicles: number; priceVerify: number; avgBelowMarket: number;
}
const ExecKpiStrip = ({ counts, onMetric, onMarket }: { counts: KpiCounts; onMetric: (k: string) => void; onMarket: () => void }) => {
  const below = counts.avgBelowMarket;
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 xl:grid xl:grid-cols-7 xl:overflow-visible xl:pb-0">
      <button onClick={() => onMetric("ready")} className="shrink-0 min-w-[210px] xl:min-w-0 text-left rounded-2xl border border-border bg-card shadow-sm p-4 hover:shadow-md hover:border-foreground/15 transition-all">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Inventory Readiness</p>
        <div className="flex items-center gap-3 mt-2">
          <BigRing pct={counts.avgReadiness} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">Ready to publish</p>
            <p className="text-[11px] text-muted-foreground">{counts.readyToPublish} of {counts.total} vehicles</p>
          </div>
        </div>
        <p className="text-[11px] font-semibold text-blue-600 mt-2.5">View readiness details →</p>
      </button>
      <ExecKpi label="Total Vehicles" value={counts.total} sub={`${counts.newCount} new · ${counts.usedCount} used`} icon={Car} onClick={() => onMetric("total")} link="View all vehicles" />
      <ExecKpi label="Published" value={counts.published} sub="live on portal" icon={CheckCircle2} tone="emerald" onClick={() => onMetric("published")} link="View published" />
      <ExecKpi label="Needs Attention" value={counts.needsAttention} sub="require action" icon={AlertTriangle} tone="amber" onClick={() => onMetric("needs-attention")} link="View list" prominent />
      <ExecKpi label="Open Recalls" value={counts.openRecallVehicles} sub="vehicles" icon={ShieldCheck} tone={counts.openRecallVehicles ? "red" : "emerald"} onClick={() => onMetric("open-recalls")} link="View recalls" />
      <ExecKpi label="Price Reviews" value={counts.priceVerify} sub="require review" icon={CircleDollarSign} tone="violet" onClick={() => onMetric("price-reviews")} link="View price reviews" />
      <ExecKpi label="Avg Market Position" value={`$${Math.abs(below).toLocaleString()}`} sub={below >= 0 ? "below market" : "above market"} icon={Gauge} tone={below >= 0 ? "emerald" : "amber"} onClick={onMarket} link="View market report" />
    </div>
  );
};

const Pill = ({ label, count, active, tone, onClick }: { label: string; count: number; active: boolean; tone?: "amber" | "red" | "emerald"; onClick: () => void }) => {
  const activeCls = "bg-blue-600 text-white border-blue-600";
  const idleCls = "bg-card text-foreground border-border hover:bg-muted";
  const countTone = active ? "bg-white/20 text-white" : tone === "amber" ? "bg-amber-100 text-amber-700" : tone === "red" ? "bg-red-100 text-red-700" : tone === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground";
  return (
    <button onClick={onClick} className={`h-8 pl-3 pr-2 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${active ? activeCls : idleCls}`}>
      {label}
      <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center tabular-nums ${countTone}`}>{count}</span>
    </button>
  );
};

// ── Mobile vehicle card ────────────────────────────────────────
interface RowSignal { stickerDone: boolean; hasAddendum: boolean; priceVerified: boolean; needsPriceVerify: boolean; }

const VehicleCard = ({ r, signal, readiness, onOpen, onSticker, onView, items }: { r: VehicleRow; signal: RowSignal; readiness: number; onOpen: () => void; onSticker: () => void; onView: () => void; items: KebabItem[] }) => {
  const thumbTint = r.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" : r.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" : "from-slate-400/15 to-slate-500/5 text-slate-500";
  return (
    <div onClick={onOpen} className="group rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all cursor-pointer p-3">
      <div className="flex items-start gap-3">
        <div className={`w-[110px] h-[74px] rounded-xl bg-gradient-to-br ${thumbTint} flex items-center justify-center shrink-0 overflow-hidden`}>
          {r.hero_image_url ? <img src={r.hero_image_url} alt={r.ymm || "vehicle"} loading="lazy" className="w-full h-full object-cover" /> : <Car className="w-7 h-7" strokeWidth={1.5} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-display font-semibold text-foreground truncate">{r.ymm || "(needs decode)"}</h3>
            {r.condition && <CondBadge condition={r.condition} />}
          </div>
          {r.trim && <p className="text-xs text-muted-foreground truncate">{r.trim}</p>}
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground mt-1">
            <span className="font-mono">{r.stock_number || "—"}</span>
            <span className="font-mono">…{(r.vin || "").slice(-6)}</span>
            {r.mileage ? <span>{r.mileage.toLocaleString()} mi</span> : null}
            <span className="font-semibold text-foreground">{r.price ? `$${r.price.toLocaleString()}` : "—"}</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <MiniRing pct={readiness} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
        <StatusPill status={r.status} />
        <RecallChip status={r.recall_status} open={r.open_recall_count} />
        {!signal.hasAddendum && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-red-100 text-red-700">Addendum Missing</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {r.status === "published" ? (
            <button onClick={onView} className="h-9 px-3 rounded-xl bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> View</button>
          ) : (
            <button onClick={onSticker} className="h-9 px-3 rounded-xl bg-blue-600 text-white text-xs font-bold inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Sticker</button>
          )}
          <KebabMenu items={items} />
        </div>
      </div>
    </div>
  );
};

const MARKET_CHIP: Record<string, { label: string; cls: string }> = {
  great_deal:   { label: "Great Deal",   cls: "bg-emerald-100 text-emerald-700" },
  good_deal:    { label: "Good Deal",    cls: "bg-emerald-100 text-emerald-700" },
  fair_deal:    { label: "Fair Price",   cls: "bg-blue-100 text-blue-700" },
  above_market: { label: "Above Market", cls: "bg-amber-100 text-amber-700" },
};
const MarketChip = ({ position }: { position?: string | null }) => {
  if (!position || position === "unknown") return null;
  const c = MARKET_CHIP[position];
  if (!c) return null;
  return <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
};

const RecallChip = ({ status, open }: { status?: string | null; open?: number | null }) => {
  const n = open || 0;
  // Only show warning colors when a real issue exists; gray for pending/unknown.
  if (status === "open_recalls" && n > 0) {
    const cls = n >= 2 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700";
    return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}><AlertTriangle className="w-2.5 h-2.5" />{n} Open Recall{n === 1 ? "" : "s"}</span>;
  }
  if (status === "clear")
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"><ShieldCheck className="w-2.5 h-2.5" />No Recalls</span>;
  if (status === "error" || status === "unknown")
    return <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Recall Unavailable</span>;
  return <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Recall Pending</span>;
};

const VinChip = ({ ymm }: { ymm?: string | null }) =>
  ymm
    ? <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">VIN Decoded</span>
    : <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">VIN Pending</span>;

const PortalChip = ({ status }: { status: VehicleRow["status"] }) =>
  status === "published"
    ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Live</span>
    : status === "archived"
      ? <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Archived</span>
      : <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />Draft</span>;

// Clean compliance stack — colored status dots for instant scanning.
const ComplianceCell = ({ r }: { r: VehicleRow }) => {
  const decoded = !!r.ymm;
  const n = r.open_recall_count || 0;
  const open = r.recall_status === "open_recalls" && n > 0;
  const clear = r.recall_status === "clear";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${decoded ? "bg-emerald-500" : "bg-slate-300"}`} />
        {decoded ? "VIN Decoded" : "VIN Pending"}
      </span>
      <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${open ? (n >= 2 ? "bg-red-500" : "bg-orange-500") : clear ? "bg-emerald-500" : "bg-slate-300"}`} />
        {open ? `${n} Open Recall${n === 1 ? "" : "s"}` : clear ? "No Open Recalls" : "Recall Pending"}
      </span>
    </div>
  );
};

const StatusPill = ({ status }: { status: VehicleRow["status"] }) => {
  const cfg = status === "published" ? { cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Published" }
    : status === "archived" ? { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "Archived" }
    : { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "Draft" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
    </span>
  );
};

interface KebabItem { label: string; icon: typeof Car; onClick: () => void; danger?: boolean; }

const HoverBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button title={title} onClick={onClick} className="w-7 h-7 rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors">{children}</button>
);

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
      <button onClick={() => setOpen((v) => !v)} aria-label="More actions" className="w-9 h-9 rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-border bg-popover shadow-lg z-20 p-1">
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick(); }} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-left transition-colors ${it.danger ? "text-red-600 hover:bg-red-50" : "text-foreground hover:bg-muted"}`}>
              <it.icon className="w-4 h-4 shrink-0" />{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Pagination = ({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void }) => {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  const withGaps: (number | "gap")[] = [];
  let prev = 0;
  for (const p of pages) { if (prev && p - prev > 1) withGaps.push("gap"); withGaps.push(p); prev = p; }
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <p className="text-xs text-muted-foreground">Showing <span className="font-semibold text-foreground tabular-nums">{from}</span>–<span className="font-semibold text-foreground tabular-nums">{to}</span> of <span className="font-semibold text-foreground tabular-nums">{total}</span> vehicles</p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="w-8 h-8 rounded-lg border border-border bg-card text-foreground inline-flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          {withGaps.map((p, i) => p === "gap" ? <span key={`g${i}`} className="px-1 text-muted-foreground text-xs">…</span> : (
            <button key={p} onClick={() => onPage(p)} className={`min-w-8 h-8 px-2 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${p === page ? "bg-blue-600 text-white border-blue-600" : "bg-card text-foreground border-border hover:bg-muted"}`}>{p}</button>
          ))}
          <button onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount} className="w-8 h-8 rounded-lg border border-border bg-card text-foreground inline-flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4" /></button>
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
          <div className="w-14 h-11 rounded-lg bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-2"><div className="h-4 w-48 rounded bg-muted animate-pulse" /><div className="h-3 w-32 rounded bg-muted/70 animate-pulse" /></div>
          <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
          <div className="h-9 w-24 rounded-xl bg-muted animate-pulse" />
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

interface AddProps { tenantId: string | null; userId: string | null; onClose: () => void; onCreated: (id: string) => void }

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
  const [decoded, setDecoded] = useState<{ year?: string; make?: string; model?: string; trim?: string; bodyStyle?: string; engine?: string; fuelType?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDecode = async () => {
    if (vin.length < 11) { toast.error("Enter a full 17-character VIN to decode"); return; }
    const result = await decode(vin);
    if (result) {
      setDecoded({ year: result.year, make: result.make, model: result.model, trim: result.trim, bodyStyle: result.bodyStyle, engine: result.engineDescription, fuelType: result.fuelType });
      if (result.year && parseInt(result.year) >= new Date().getFullYear()) setCondition("new");
      toast.success(`Decoded: ${result.year} ${result.make} ${result.model}`);
    } else {
      toast.error("VIN decode failed — you can still continue manually");
    }
  };

  const canSubmit = vin.trim().length >= 11 && stock.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ymm = decoded ? [decoded.year, decoded.make, decoded.model].filter(Boolean).join(" ") : null;
    const slug = makeSlug(`${decoded?.make || ""}-${decoded?.model || vin.slice(-6)}`);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .insert({
        store_id: tenantId, tenant_id: tenantId, vin: vin.trim().toUpperCase(), slug, ymm,
        trim: decoded?.trim || null,
        mileage: mileage ? parseInt(mileage.replace(/[^0-9]/g, ""), 10) : null,
        condition, price: price ? parseFloat(price.replace(/[^0-9.]/g, "")) : null,
        sticker_snapshot: decoded ? { decoded } : {}, dealer_snapshot: {}, status: "draft", created_by: userId,
      })
      .select().single();
    setSubmitting(false);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    // Fire-and-forget recall check for the new VIN (best-effort).
    supabase.functions.invoke("marketcheck-recalls", { body: { vin: vin.trim().toUpperCase(), tenant_id: tenantId } }).catch(() => {});
    onCreated(data.id);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Car className="w-5 h-5 text-primary" /> Add Vehicle</h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Paste the VIN and click Decode to auto-fill year / make / model / trim / equipment from NHTSA. You can also continue without decoding.</p>
        <div className="space-y-3">
          <Field label="VIN *" required>
            <div className="flex items-center gap-2">
              <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="17 characters" maxLength={17} className="flex-1 h-10 px-3 rounded-md border border-border bg-background text-sm font-mono tracking-wider" />
              <button onClick={handleDecode} disabled={decoding || vin.length < 11} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">{decoding ? "Decoding…" : "Decode"}</button>
            </div>
          </Field>
          {decoded && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Decoded</div>
              <p className="text-emerald-900">{[decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(" ")}{decoded.bodyStyle ? ` · ${decoded.bodyStyle}` : ""}{decoded.engine ? ` · ${decoded.engine}` : ""}{decoded.fuelType ? ` · ${decoded.fuelType}` : ""}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock # *" required><input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="e.g. T5892" className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm" /></Field>
            <Field label="Mileage"><input value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="e.g. 42850" inputMode="numeric" className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price (optional)"><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$" className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm" /></Field>
            <Field label="Condition">
              <select value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)} className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm">
                <option value="new">New</option><option value="used">Used</option><option value="cpo">CPO</option>
              </select>
            </Field>
            <Field label="Sale state"><input value={state} onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())} placeholder="e.g. CA" maxLength={2} className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm uppercase" /></Field>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting} className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">{submitting ? "Creating…" : "Create & open file"}{!submitting && <FileText className="w-3.5 h-3.5" />}</button>
        </div>
      </div>
    </div>
  );
};

interface ImportProps { tenantId: string | null; userId: string | null; onClose: () => void; onImported: () => void }

const CsvImportModal = ({ tenantId, userId, onClose, onImported }: ImportProps) => {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleImport = async () => {
    if (!tenantId) return;
    setSubmitting(true);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) { toast.error("Paste at least a header row and one vehicle"); setSubmitting(false); return; }
    const header = lines[0].toLowerCase().split(/[,\t]/).map((h) => h.trim());
    const col = (name: string) => header.findIndex((h) => h === name || h === name.replace(/_/g, " "));
    const idx = { vin: col("vin"), stock: col("stock"), mileage: col("mileage"), condition: col("condition"), price: col("price"), year: col("year"), make: col("make"), model: col("model"), trim: col("trim") };
    if (idx.vin < 0 || idx.stock < 0) { toast.error("CSV must have at least 'vin' and 'stock' columns"); setSubmitting(false); return; }
    const toInsert = lines.slice(1).map((line) => {
      const cells = line.split(/[,\t]/).map((c) => c.trim());
      const vin = (cells[idx.vin] || "").toUpperCase();
      if (vin.length < 11) return null;
      const year = idx.year >= 0 ? cells[idx.year] : "";
      const make = idx.make >= 0 ? cells[idx.make] : "";
      const model = idx.model >= 0 ? cells[idx.model] : "";
      const ymm = [year, make, model].filter(Boolean).join(" ");
      return {
        store_id: tenantId, tenant_id: tenantId, vin, slug: makeSlug(`${make}-${model || vin.slice(-6)}`), ymm: ymm || null,
        trim: idx.trim >= 0 ? cells[idx.trim] : null,
        mileage: idx.mileage >= 0 && cells[idx.mileage] ? parseInt(cells[idx.mileage].replace(/[^0-9]/g, ""), 10) : null,
        price: idx.price >= 0 && cells[idx.price] ? parseFloat(cells[idx.price].replace(/[^0-9.]/g, "")) : null,
        condition: idx.condition >= 0 ? (cells[idx.condition] || "used").toLowerCase() as "new" | "used" | "cpo" : "used",
        sticker_snapshot: {}, dealer_snapshot: {}, status: "draft", created_by: userId,
      };
    }).filter(Boolean) as Record<string, unknown>[];

    const { error, data } = await (supabase as any).from("vehicle_listings").insert(toInsert).select("id");
    setSubmitting(false);
    if (error) { toast.error(`Import failed: ${error.message}`); return; }
    toast.success(`Imported ${data?.length ?? 0} vehicle(s)`);
    onImported();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Upload className="w-5 h-5 text-primary" /> CSV Import</h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div><p className="font-semibold mb-1">Format</p><p>First row is the header with column names. Minimum columns: <span className="font-mono">vin,stock</span>. Supported: <span className="font-mono">vin, stock, mileage, condition, price, year, make, model, trim</span>.</p></div>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"vin,stock,mileage,condition,price,year,make,model,trim\n1HGCM82633A123456,T5892,42850,used,24995,2023,Honda,Accord,EX-L"} rows={10} className="w-full rounded-md border border-border bg-background text-xs font-mono p-3" />
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">Cancel</button>
          <button onClick={handleImport} disabled={!text.trim() || submitting} className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">{submitting ? "Importing…" : "Import"}</button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">{label}{required ? <span className="text-destructive ml-0.5">*</span> : null}</label>
    <div className="mt-1">{children}</div>
  </div>
);

export default Inventory;

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveRecallView, recallScopeOfSource, type RecallRowInput } from "@/lib/vehicleTruth/recallView";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { supabase } from "@/integrations/supabase/client";
import { crawlPausedMessage } from "@/lib/inventory/crawlPaused";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdvertisedPrices, assessDrift, SOURCE_LABELS, type AdvertisedPrice } from "@/hooks/useAdvertisedPrices";
import { useGetReady } from "@/hooks/useGetReady";
import { usedSafetyInspectionForm } from "@/data/safetyInspection";
import { useVinDecode } from "@/hooks/useVinDecode";
import { clearIntakeQueued, markIntakeQueued, persistStockNumber, runManualIntakeOrchestration } from "@/lib/manualIntakeOrchestration";
import { toast } from "sonner";
import {
  Plus, Search, Upload, Car, FileText, Printer, Signature, ScanLine,
  X, CheckCircle2, AlertTriangle, RefreshCw, MoreVertical, Building2,
  ShieldCheck, ClipboardList, ExternalLink, Trash2, Wrench,
  ChevronLeft, ChevronRight, Eye, CircleDollarSign, FileSignature, Tag,
  AlertCircle, ShieldAlert, TrendingUp, Gauge, Rocket,
} from "lucide-react";
import SharedEmptyState from "@/components/ui/empty-state";
import { legacyMarketView, type LegacyListingFields } from "@/lib/market/surfaceCompat";
import { presentLegacyPosition } from "@/lib/market/presentation";
import { MARKET_BATCH_NOTICE } from "@/lib/market/batchTransition";
import { AdvertisedPriceBand } from "@/components/inventory/AdvertisedPriceBand";
import { PageBody, PageHeader, MetricStrip, LocalTabs, WorkTable, Th, Td, Button, FilterSelect, StatusText, type LocalTab, type Tone } from "@/components/product";
import { summarizeReadiness } from "@/lib/inventory/readinessSummary";

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
  source_url?: string | null;
  recall_status?: string | null;
  open_recall_count?: number | null;
  recall_payload?: unknown;
  recall_check?: unknown;
  recall_checked_at?: string | null;
  market_position?: string | null;
  market_value?: number | null;
}

interface ActivityRow { id: string; action: string; created_at: string; details: Record<string, unknown> | null; }

type StatusFilter = "all" | "draft" | "published" | "archived";
type ConditionFilter = "all" | "new" | "used" | "cpo";
type DerivedFilter = "all" | "needs-sticker" | "missing-addendum" | "price-verify" | "open-recalls" | "needs-attention";
type SortKey = "updated" | "created" | "price_desc" | "price_asc" | "year_desc" | "mileage_asc" | "readiness_desc";
type ViewMode = "list" | "grid";

const SORT_LABEL: Record<SortKey, string> = {
  updated: "Last Updated",
  created: "Date Added",
  price_desc: "Price: High → Low",
  price_asc: "Price: Low → High",
  year_desc: "Year: Newest",
  mileage_asc: "Mileage: Lowest",
  readiness_desc: "Readiness: Highest",
};

const PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const InventoryModern = () => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { createGetReady } = useGetReady(tenant?.id || "");
  const { settings } = useDealerSettings();
  const { byVin } = useAdvertisedPrices(tenant?.id || "");
  const queryClient = useQueryClient();

  // Broadcasts to the AppShell top bar so "Synced X ago" updates immediately
  // after any inventory sync, without waiting for the DB row to round-trip.
  const broadcastSynced = (kind: "prices" | "recalls" | "market", extra?: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent("inventory-synced", { detail: { at: new Date().toISOString(), kind, ...extra } }));
  };

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
  const [derived, setDerived] = useState<DerivedFilter>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showFilters, setShowFilters] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  // Condition lives in the URL so New / Used / CPO survive reload and back.
  const urlCondition = searchParams.get("condition");
  const condition: ConditionFilter = urlCondition === "new" || urlCondition === "used" || urlCondition === "cpo" ? urlCondition : "all";
  const setCondition = (c: ConditionFilter) => {
    const next = new URLSearchParams(searchParams);
    if (c === "all") next.delete("condition"); else next.set("condition", c);
    setSearchParams(next, { replace: true });
  };
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
      // Refresh the advertised-price cache (the green "Advertised" pill
      // on each row reads from it) and the page rows + last-sync stamp,
      // then ping the AppShell so the global "Synced X ago" updates.
      await queryClient.invalidateQueries({ queryKey: ["advertised_prices", tenant.id] });
      await load();
      broadcastSynced("prices", { found });
    } catch (err) {
      const paused = await crawlPausedMessage(err);
      toast.error(paused ?? `Scrape failed: ${err instanceof Error ? err.message : "unknown error"}`);
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
      await load();
      broadcastSynced("recalls", { checked: d.checked, openFound: d.openFound });
    } catch { toast.error("Recall batch failed"); }
  };

  // ── Inventory-wide market check: withdrawn, not broken ────────────────
  //
  // This sent `{ batch: true }` to marketcheck-market-pricing and rendered
  // `${d.checked} checked · ${d.greatDeals} great deals` from the reply. The
  // endpoint no longer accepts a batch — it answers 400 `batch_retired`,
  // because a batch from a browser is a browser deciding how much of a
  // dealer's money to spend. `checked` and `greatDeals` are fields nothing
  // returns any more, so every count it showed would have been `0 checked ·
  // 0 great deals` presented as a success.
  //
  // Withdrawn rather than fixed: the replacement is server-side automation
  // that reserves and budgets each call, which is not a frontend change. The
  // per-VIN action on the Vehicle File is untouched and still works.
  //
  // No request is made here. Not to the proxy, not to the writer, not to a
  // provider — there is deliberately no `supabase.functions.invoke` in this
  // handler, and a test asserts it stays that way.
  const runMarketBatch = () => {
    toast.info(MARKET_BATCH_NOTICE);
  };

  const quickRecall = async (vin: string) => {
    if (!vin) return;
    toast.info("Checking recalls…");
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { vin, tenant_id: tenant?.id } });
      if (error) throw error;
      const d = (data || {}) as { openRecallCount?: number; error?: string; provider?: string };
      if (d.error === "not_configured") { toast.error("Recall lookup isn't configured."); return; }
      // marketcheck-recalls falls back to NHTSA server-side, so the provider it
      // answered with decides whether this is a VIN answer or a model answer.
      toast.success(
        (d.openRecallCount || 0) > 0
          ? `${d.openRecallCount} open recall${d.openRecallCount === 1 ? "" : "s"} found`
          : recallScopeOfSource(d.provider ?? null) === "vin"
            ? "No active recalls on this VIN"
            : "No campaigns found for this model — VIN-level verification unavailable",
      );
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
    const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,slug,source_url,published_at,view_count,created_at,updated_at";
    const runSelect = (cols: string) => (supabase as any)
      .from("vehicle_listings")
      .select(cols)
      .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
      // A car that left the feed is retired, not deleted, so active inventory
      // has to exclude it explicitly now.
      .neq("status", "archived")
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
        `${baseCols},hero_image_url,recall_status,open_recall_count,recall_payload,recall_check,recall_checked_at,market_position,market_value`,
        `${baseCols},hero_image_url,recall_status,open_recall_count,recall_payload,recall_check,recall_checked_at`,
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
  useEffect(() => { setPage(1); }, [q, status, condition, derived, perPage]);

  const signalFor = (r: VehicleRow) => {
    const v = (r.vin || "").toUpperCase();
    const stickerDone = r.status === "published";
    const hasAddendum = addendumVins.has(v);
    // In sync = the displayed price agrees with the advertised price. Two ways:
    // a captured snapshot MATCHES (status "match"), OR the price came straight
    // from the dealer's feed with no contradicting snapshot ("untracked") — in
    // that case the listing price IS the advertised price we pulled, so it's
    // synced, not "unchecked". Only a snapshot that DISAGREES ("drift") needs
    // attention.
    const drift = r.price != null ? assessDrift(r.price, byVin.get(v), settings.doc_fee_amount || 0) : null;
    const priceVerified = drift?.status === "match" || drift?.status === "untracked";
    const needsPriceVerify = drift?.status === "drift";
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
    const list = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (condition !== "all" && r.condition !== condition) return false;
      if (derived !== "all") {
        const s = signalFor(r);
        if (derived === "needs-sticker" && s.stickerDone) return false;
        if (derived === "missing-addendum" && s.hasAddendum) return false;
        if (derived === "price-verify" && !s.needsPriceVerify) return false;
        if (derived === "open-recalls" && !deriveRecallView(r).riskSignalled) return false;
        if (derived === "needs-attention" && s.hasAddendum && !s.needsPriceVerify && !deriveRecallView(r).riskSignalled) return false;
      }
      if (!lc) return true;
      return (
        r.vin.toLowerCase().includes(lc) ||
        (r.ymm || "").toLowerCase().includes(lc) ||
        (r.trim || "").toLowerCase().includes(lc) ||
        (r.stock_number || "").toLowerCase().includes(lc)
      );
    });
    const yearOf = (r: VehicleRow) => parseInt((r.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] || "0", 10);
    const readinessOf = (r: VehicleRow) => {
      const s = signalFor(r);
      const flags = [true, !!r.ymm, s.stickerDone, s.hasAddendum, r.price ? s.priceVerified : true];
      return flags.filter(Boolean).length;
    };
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "created": return (new Date(b.created_at).getTime()) - (new Date(a.created_at).getTime());
        case "price_desc": return (b.price || 0) - (a.price || 0);
        case "price_asc": return (a.price || Number.MAX_SAFE_INTEGER) - (b.price || Number.MAX_SAFE_INTEGER);
        case "year_desc": return yearOf(b) - yearOf(a);
        case "mileage_asc": return (a.mileage || Number.MAX_SAFE_INTEGER) - (b.mileage || Number.MAX_SAFE_INTEGER);
        case "readiness_desc": return readinessOf(b) - readinessOf(a);
        case "updated":
        default: return (new Date(b.updated_at).getTime()) - (new Date(a.updated_at).getTime());
      }
    });
    return sorted;
  }, [rows, q, status, condition, derived, addendumVins, byVin, sortKey]);

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
      const rv = deriveRecallView(r);
      const openR = rv.riskSignalled;
      openRecallsTotal += rv.vin.openCount ?? rv.model?.campaignCount ?? (openR ? 1 : 0);
      if (openR) openRecallVehicles++;
      if (!s.hasAddendum || s.needsPriceVerify || openR) needsAttention++;
      // One market subtraction for the whole app: src/lib/market/surfaceCompat.
      const mv = legacyMarketView(r as LegacyListingFields, "dealer_inventory");
      if (mv.marketP50 != null && mv.difference != null) { marketSum += -mv.difference; marketCount++; }
      readinessSum += rowReadiness(r);
    }
    const total = rows.length;
    const readiness = summarizeReadiness(rows.map(rowReadiness));
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
      checklistComplete: readiness.complete,
      checklistRatePct: readiness.completeRatePct,
      meanCompletenessPct: readiness.meanCompletenessPct,
      vinDecoded, openRecallsTotal, openRecallVehicles, needsAttention,
      avgReadiness: total ? Math.round(readinessSum / total) : 0,
      avgBelowMarket: marketCount ? Math.round(marketSum / marketCount) : 0,
      health,
    };
  }, [rows, addendumVins, byVin]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const readinessSpark = pageRows.map(rowReadiness);

  const rowActions = (r: VehicleRow): KebabItem[] => [
    { label: "Open Vehicle", icon: ExternalLink, onClick: () => navigate(`/vehicle-file/${r.id}`) },
    // §6 gives VIN Command Center no nav row because it is reached per vehicle,
    // and the vehicle row is where that happens. Its two siblings DO have nav
    // rows but land on the whole-store screen, so the per-vehicle door to each
    // is here as well — otherwise every command surface is reached by first
    // opening a different one. Icons match the sidebar's for the two that have
    // one (Rocket / Printer); VIN Command Center takes Gauge so it cannot be
    // mistaken for the Get Ready Command row.
    { label: "VIN Command Center", icon: Gauge, onClick: () => navigate(`/vin-command/${r.id}`) },
    { label: "Get Ready Command", icon: Rocket, onClick: () => navigate(`/get-ready-command/${r.id}`) },
    { label: "Print Center", icon: Printer, onClick: () => navigate(`/print-center/${r.id}`) },
    { label: r.condition === "new" ? "New-Car Sticker" : "Used-Car Sticker", icon: Printer, onClick: () => navigate(`${r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker"}?vehicleId=${r.id}`) },
    { label: "Make Sticker", icon: Printer, onClick: () => navigate(`/vehicle-file/${r.id}?tab=labels`) },
    { label: "Send to Get-Ready", icon: Wrench, onClick: () => sendToGetReady(r) },
    { label: "Prep & Install", icon: ClipboardList, onClick: () => navigate(`/vehicle-file/${r.id}?tab=prep`) },
    { label: "Build Addendum", icon: FileText, onClick: () => navigate(`/vehicle-file/${r.id}?tab=addendum`) },
    { label: "Audit Defense", icon: ShieldCheck, onClick: () => navigate(`/compliance?vin=${encodeURIComponent(r.vin || "")}`) },
    ...(r.status === "published" ? [{ label: "View Customer Packet", icon: Eye, onClick: () => window.open(`/v3/${r.slug}`, "_blank", "noopener") }] : []),
    ...(r.source_url && /^https?:\/\//i.test(r.source_url) ? [{ label: "View ad on website", icon: ExternalLink, onClick: () => window.open(r.source_url!, "_blank", "noopener") }] : []),
    { label: "Delete", icon: Trash2, onClick: () => deleteVehicle(r), danger: true },
  ];

  const onHealthMetric = (key: string) => {
    setDerived("all"); setStatus("all"); setCondition("all");
    if (key === "ready" || key === "published") setStatus("published");
    else if (key === "needs-sticker") setDerived("needs-sticker");
    else if (key === "needs-attention") setDerived("needs-attention");
    else if (key === "missing-addendum") setDerived("missing-addendum");
    else if (key === "price-verify" || key === "price-reviews") setDerived("price-verify");
    else if (key === "open-recalls") setDerived("open-recalls");
    // "total" clears everything (done above)
  };

  const dealerName = (settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_name) || (tenant?.name && tenant.name !== "AutoLabels.io" && tenant.name) || "Your Dealership";
  const dealerLoc = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");

  const conditionTabs: LocalTab[] = [
    { key: "all", label: "All", to: "/inventory", count: loading ? null : counts.total, active: condition === "all" },
    { key: "new", label: "New", to: "/inventory?condition=new", count: loading ? null : counts.newCount, active: condition === "new" },
    { key: "used", label: "Used", to: "/inventory?condition=used", count: loading ? null : counts.usedCount, active: condition === "used" },
    { key: "cpo", label: "CPO", to: "/inventory?condition=cpo", count: loading ? null : counts.cpoCount, active: condition === "cpo" },
  ];

  const moreActions: KebabItem[] = [
    { label: showFilters ? "Hide filters and sort" : "Filter and sort", icon: Search, onClick: () => setShowFilters((v) => !v) },
    { label: "Scan VIN", icon: ScanLine, onClick: openScan },
    { label: "OEM Window Sticker", icon: Printer, onClick: () => navigate("/window-sticker-studio") },
    { label: "New Addendum", icon: FileSignature, onClick: () => navigate("/addendum") },
    { label: "Check Recalls", icon: ShieldCheck, onClick: runRecallBatch },
    { label: "Check Market Prices", icon: CircleDollarSign, onClick: runMarketBatch, disabled: true, title: MARKET_BATCH_NOTICE },
    ...(settings.feature_price_verification ? [{ label: scraping ? "Verifying…" : "Verify Prices", icon: RefreshCw, onClick: runPriceScrape }] : []),
    { label: "CSV Import", icon: Upload, onClick: () => setShowImport(true) },
  ];

  const below = counts.avgBelowMarket;

  const exportPicked = () => {
    const chosen = rows.filter((r) => picked.has(r.id));
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Stock", "VIN", "Vehicle", "Condition", "Status", "Price"].join(","),
      ...chosen.map((r) => [r.stock_number, r.vin, r.ymm, r.condition, r.status, r.price].map(esc).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageBody width="wide">
      <PageHeader
        title="Inventory"
        description="All vehicles in your inventory with status, pricing and next steps."
        actions={
          <>
            <ActionsMenu items={moreActions} />
            <Button variant="primary" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add vehicle</Button>
          </>
        }
      />
      <span id="market-batch-notice" className="sr-only">{MARKET_BATCH_NOTICE}</span>

      <section className="flex flex-col gap-3" aria-label="Vehicles">
        <LocalTabs tabs={conditionTabs} label="Condition" />

        <MetricStrip
          label="Inventory summary"
          metrics={[
            { label: "Active", value: loading ? null : counts.total, loading },
            { label: "Checklist complete", value: loading ? null : counts.checklistComplete, loading, tone: counts.checklistComplete > 0 ? "success" : "neutral" },
            { label: "Needs attention", value: loading ? null : counts.needsAttention, loading, tone: counts.needsAttention > 0 ? "warning" : "neutral" },
            { label: "Published", value: loading ? null : counts.published, loading },
          ]}
        />

        {(showFilters || status !== "all" || derived !== "all" || q) && (
          <>
            <p className="text-[12px] leading-[18px] text-adm-muted">
              <button type="button" className="underline hover:text-adm-ink" onClick={runMarketBatch} disabled title={MARKET_BATCH_NOTICE} aria-describedby="market-batch-notice">
                Average market position ${Math.abs(below).toLocaleString()} {below >= 0 ? "below" : "above"}
              </button>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 text-adm-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" placeholder="Search VIN, stock #, year, make, model, trim" className="w-full min-h-[36px] pl-9 pr-3 rounded-md border border-adm-border bg-adm-surface text-[14px]" />
              </div>
              <FilterSelect label="Filter by status" value={status} onChange={(v) => setStatus(v as StatusFilter)}
                options={[{ value: "all", label: "All statuses" }, { value: "draft", label: `Draft (${counts.draft})` }, { value: "published", label: `Published (${counts.published})` }, { value: "archived", label: "Archived" }]} />
              <FilterSelect label="Filter by attention" value={derived} onChange={(v) => setDerived(v as DerivedFilter)}
                options={[
                  { value: "all", label: "All vehicles" },
                  { value: "needs-sticker", label: `Needs sticker (${counts.needsSticker})` },
                  { value: "missing-addendum", label: `Missing addendum (${counts.missingAddendum})` },
                  { value: "price-verify", label: `Price verification (${counts.priceVerify})` },
                  { value: "open-recalls", label: `Recall reported (${counts.openRecallVehicles})` },
                  { value: "needs-attention", label: `Needs attention (${counts.needsAttention})` },
                ]} />
              <FilterSelect label="Sort vehicles" value={sortKey} onChange={(v) => setSortKey(v as SortKey)} className="min-w-[200px]"
                options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: `Sort: ${SORT_LABEL[k]}` }))} />
              {(status !== "all" || condition !== "all" || derived !== "all" || q) && (
                <Button size="sm" variant="ghost" onClick={() => { setStatus("all"); setCondition("all"); setDerived("all"); setQ(""); }}>Clear filters</Button>
              )}
              <div className="ml-auto inline-flex items-center rounded-md border border-adm-border bg-adm-surface overflow-hidden">
                <button
                  onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}
                  className={`w-9 h-9 inline-flex items-center justify-center ${viewMode === "list" ? "bg-adm-selected text-adm-primary" : "text-adm-muted hover:bg-adm-workspace"}`}
                  title="List view" aria-label="List view"
                ><ClipboardList className="w-5 h-5" /></button>
                <button
                  onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"}
                  className={`w-9 h-9 inline-flex items-center justify-center ${viewMode === "grid" ? "bg-adm-selected text-adm-primary" : "text-adm-muted hover:bg-adm-workspace"}`}
                  title="Grid view" aria-label="Grid view"
                ><Building2 className="w-5 h-5" /></button>
              </div>
            </div>
          </>
        )}

        {picked.size > 0 && (
          <div className="flex items-center gap-3 rounded-[6px] border border-adm-border bg-adm-surface px-4 py-2 text-[14px]">
            <span className="font-semibold text-adm-ink">{picked.size} selected</span>
            <button type="button" className="font-semibold text-adm-primary hover:underline" onClick={exportPicked}>Export CSV</button>
            <button type="button" className="text-adm-muted hover:underline" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <InventorySkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} total={rows.length} />
        ) : (
          <>
            <div className={`${viewMode === "list" ? "hidden md:block" : "hidden"} rounded-[4px] border border-adm-border bg-adm-surface`}>
              <WorkTable caption="Inventory vehicles" minWidth={900}>
                <thead>
                  <tr>
                    <Th className="w-10">
                      <input type="checkbox" aria-label="Select all vehicles on this page" className="h-4 w-4 accent-[#2457D6]"
                        checked={pageRows.length > 0 && pageRows.every((x) => picked.has(x.id))}
                        onChange={(e) => setPicked((prev) => { const n = new Set(prev); pageRows.forEach((x) => (e.target.checked ? n.add(x.id) : n.delete(x.id))); return n; })} />
                    </Th>
                    <Th>Vehicle</Th>
                    <Th>Stock / VIN</Th>
                    <Th>Condition</Th>
                    <Th>State</Th>
                    <Th align="right">Price</Th>
                    <Th>Next action</Th>
                    <Th align="right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const sg = signalFor(r);
                    const next = deriveRecallView(r).riskSignalled ? "Resolve recall"
                      : r.status === "draft" ? "Publish listing"
                      : !sg.hasAddendum ? "Create addendum"
                      : sg.needsPriceVerify ? "Review price"
                      : !sg.stickerDone ? "Generate sticker"
                      : "Open vehicle";
                    return (
                      <tr key={r.id} className="h-14 group hover:bg-adm-workspace cursor-pointer" onClick={() => navigate(`/vehicle-file/${r.id}`)}>
                        <Td className="w-10">
                          <input type="checkbox" onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.ymm || r.vin}`} className="h-4 w-4 accent-[#2457D6]" checked={picked.has(r.id)}
                            onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                        </Td>
                        <Td className="py-1.5 max-w-[280px]">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-14 shrink-0 overflow-hidden rounded-[4px] bg-adm-workspace">
                              {r.hero_image_url ? <img src={r.hero_image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                            </div>
                            <span className="min-w-0 truncate font-semibold text-adm-ink">{r.ymm || "Needs VIN decode"}</span>
                          </div>
                        </Td>
                        <Td className="font-mono text-[13px] text-adm-muted whitespace-nowrap">
                          {r.stock_number || "Unknown"} / ...{(r.vin || "").slice(-6)}
                        </Td>
                        <Td className="capitalize">{r.condition ? (r.condition === "cpo" ? "CPO" : r.condition) : "Unknown"}</Td>
                        <Td><SimpleStatusPill status={r.status} /></Td>
                        <Td align="right" className="tabular-nums">{r.price != null ? `$${Number(r.price).toLocaleString("en-US")}` : <span className="text-adm-muted">Unknown</span>}</Td>
                        <Td className="whitespace-nowrap"><span className="font-semibold text-adm-primary">{next}</span></Td>
                        <Td align="right" className="py-2">
                          <div className="flex justify-end items-center" onClick={(e) => e.stopPropagation()}>
                            <KebabMenu items={rowActions(r)} />
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </WorkTable>
            </div>

            {/* Cards: always on mobile, and on desktop when Grid view is selected */}
            <div className={`${viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5" : "md:hidden space-y-2.5"}`}>
              {pageRows.map((r) => (
                <VehicleCard
                  key={r.id}
                  r={r}
                  signal={signalFor(r)}
                  readiness={rowReadiness(r)}
                  onOpen={() => navigate(`/vehicle-file/${r.id}`)}
                  onSticker={() => navigate(`${r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker"}?vehicleId=${r.id}`)}
                  onView={() => window.open(`/v3/${r.slug}`, "_blank", "noopener")}
                  items={rowActions(r)}
                />
              ))}
            </div>

            <Pagination page={safePage} pageCount={pageCount} total={filtered.length} pageSize={perPage} onPage={setPage} onPageSize={setPerPage} />
          </>
        )}
      </section>

      {/* Modals */}
      {showAdd && (
        <AddVehicleModal tenantId={tenant?.id || null} userId={user?.id || null} onClose={() => setShowAdd(false)} onCreated={(id) => { setShowAdd(false); navigate(`/vehicle-file/${id}`); }} />
      )}
      {showImport && (
        <CsvImportModal tenantId={tenant?.id || null} userId={user?.id || null} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />
      )}
    </PageBody>
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

// Two-line "Updated" cell: top is Today/Yesterday/Mon D, bottom is the time.
const UpdatedCell = ({ iso }: { iso: string }) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const label = sameDay ? "Today" : isYest ? "Yesterday" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="leading-tight whitespace-nowrap">
      <p className="text-xs font-semibold text-foreground tabular-nums">{time}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
};

const Thumb = ({ r }: { r: VehicleRow }) => {
  const [err, setErr] = useState(false);
  const tint =
    r.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" :
    r.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" :
    "from-slate-400/15 to-slate-500/5 text-muted-foreground";
  return (
    <div className={`w-20 h-[60px] rounded-lg bg-gradient-to-br ${tint} flex items-center justify-center shrink-0 overflow-hidden`}>
      {r.hero_image_url && !err
        ? <img src={r.hero_image_url} alt={r.ymm || "vehicle"} loading="lazy" onError={() => setErr(true)} className="w-full h-full object-cover" />
        : <Car className="w-6 h-6" strokeWidth={1.5} />}
    </div>
  );
};

const CondBadge = ({ condition }: { condition: "new" | "used" | "cpo" }) => {
  const cls = condition === "new" ? "bg-blue-100 text-blue-700" : condition === "cpo" ? "bg-violet-100 text-violet-700" : "bg-muted text-foreground";
  return <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{condition}</span>;
};

const MiniRing = ({ pct, size = 40 }: { pct: number; size?: number }) => {
  const tone = pct >= 100 ? "#10B981" : pct >= 60 ? "#2563EB" : pct >= 40 ? "#F59E0B" : "#EF4444";
  const r = 16; const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums text-foreground">{pct}%</span>
    </div>
  );
};

// Readiness ring + hover breakdown (native title so the table's horizontal
// scroll never clips it).
const ReadinessCell = ({ r, signal, pct }: { r: VehicleRow; signal: RowSignal; pct: number }) => {
  const checks = [
    { label: "Vehicle created", ok: true },
    { label: "VIN decoded", ok: !!r.ymm },
    { label: "Sticker generated", ok: signal.stickerDone },
    { label: "Addendum complete", ok: signal.hasAddendum },
    { label: "Price verified", ok: !r.price || signal.priceVerified },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const tone: Tone = passed === checks.length ? "success" : passed >= 4 ? "info" : "warning";
  const title = `${passed} of ${checks.length} checks pass\n` + checks.map((c) => `${c.ok ? "Pass" : "Open"}: ${c.label}`).join("\n");
  return (
    <div className="leading-tight cursor-help" title={title}>
      <StatusText tone={tone}>{passed} of {checks.length} checks</StatusText>
      <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted tabular-nums">{pct}% complete</p>
    </div>
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

// ── Mobile vehicle card ────────────────────────────────────────
interface RowSignal { stickerDone: boolean; hasAddendum: boolean; priceVerified: boolean; needsPriceVerify: boolean; }

const VehicleCard = ({ r, signal, readiness, onOpen, onSticker, onView, items }: { r: VehicleRow; signal: RowSignal; readiness: number; onOpen: () => void; onSticker: () => void; onView: () => void; items: KebabItem[] }) => {
  const thumbTint = r.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" : r.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" : "from-slate-400/15 to-slate-500/5 text-muted-foreground";
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
          <MiniRing pct={readiness} size={60} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
        <StatusPill status={r.status} signal={signal} />
        <RecallChip row={r} />
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

// The label, tone and colour for a market position come from
// src/lib/market/presentation.ts. This file used to keep its own table, which
// had no entry for `below_market` or `at_market` — the two most common stored
// values — so nearly two thirds of the lot fell through it.

// VIN decode status — green "Decoded" once the VIN resolves to a YMM,
// red "Decode Failed" otherwise.
const VinDecodeCell = ({ ymm }: { ymm?: string | null }) =>
  ymm
    ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />Decoded</span>
    : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600"><AlertTriangle className="w-3.5 h-3.5" />Decode Failed</span>;

// Green means a VIN-level check answered clear. `recall_status === "clear"` is
// a MODEL-level NHTSA answer, and `open_recall_count === 0` is that answer's
// zero — neither may colour a chip green.
const RecallChip = ({ row }: { row: RecallRowInput }) => {
  const v = deriveRecallView(row);
  const n = v.vin.openCount ?? v.model?.campaignCount ?? 0;
  if (v.riskSignalled) {
    const cls = v.doNotDrive || n >= 2 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700";
    const label = v.doNotDrive ? "Do-Not-Drive Recall"
      : n > 0 ? `${n} Open Recall${n === 1 ? "" : "s"}` : "Recall Reported";
    return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}><AlertTriangle className="w-2.5 h-2.5" />{label}</span>;
  }
  if (v.vin.clearClaimAllowed)
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"><ShieldCheck className="w-2.5 h-2.5" />No Recalls</span>;
  return <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Recall Unverified</span>;
  return <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Recall Pending</span>;
};

// Customer page column. The inventory row knows the listing's publish status
// and its recall reading; it does not know what a given public surface serves.
// So this says "Published" (the status) rather than "Live", and names a
// reported recall beside it instead of leaving a bare green mark. Serving
// policy itself is unchanged and enforced elsewhere.
const PortalChip = ({ status, row }: { status: VehicleRow["status"]; row: RecallRowInput }) => {
  const v = deriveRecallView(row);
  if (status === "archived") return <StatusText tone="neutral">Archived</StatusText>;
  if (status !== "published") return <StatusText tone="neutral">Not published</StatusText>;
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusText tone={v.riskSignalled ? "warning" : "success"} icon>Published</StatusText>
      {v.riskSignalled && (
        <span className="text-[12px] leading-[18px] text-adm-danger">{v.doNotDrive ? "Do-not-drive recall reported" : "Recall reported"}</span>
      )}
    </div>
  );
};

// Simple status pill — clean dot + label, no oval background.
const SimpleStatusPill = ({ status }: { status: VehicleRow["status"] }) =>
  status === "published" ? <StatusText tone="success" icon>Published</StatusText>
    : status === "archived" ? <StatusText tone="neutral">Archived</StatusText>
    : <StatusText tone="warning">Draft</StatusText>;

// Compliance cell — two status badges (VIN decode + recall), icon + label.
const ComplianceBadge = ({ tone, icon: Icon, label }: { tone: "green" | "amber" | "red" | "muted"; icon: typeof CheckCircle2; label: string }) => {
  const cls = tone === "green" ? "bg-emerald-50 text-emerald-700"
    : tone === "amber" ? "bg-amber-50 text-amber-700"
    : tone === "red" ? "bg-red-50 text-red-700"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${cls}`}>
      <Icon className="w-3 h-3" />{label}
    </span>
  );
};
const ComplianceCell = ({ ymm, row }: { ymm?: string | null; row: RecallRowInput }) => {
  const v = deriveRecallView(row);
  const n = v.vin.openCount ?? v.model?.campaignCount ?? 0;
  const recall = v.riskSignalled
    ? { tone: "amber" as const, icon: AlertTriangle, label: v.doNotDrive ? "Do-Not-Drive Recall" : n > 0 ? `${n} Open Recall${n === 1 ? "" : "s"}` : "Recall Reported" }
    : v.vin.clearClaimAllowed
      ? { tone: "green" as const, icon: ShieldCheck, label: "No Open Recalls" }
      : { tone: "muted" as const, icon: ShieldCheck, label: "Recall Unverified" };
  return (
    <div className="flex flex-col items-start gap-1">
      {ymm
        ? <ComplianceBadge tone="green" icon={CheckCircle2} label="VIN Decoded" />
        : <ComplianceBadge tone="red" icon={AlertTriangle} label="VIN Decode Failed" />}
      <ComplianceBadge tone={recall.tone} icon={recall.icon} label={recall.label} />
    </div>
  );
};

// Price cell — $XX,XXX over a single colored market line. The advertised-price
// match/mismatch, doc fee, website price, and market delta all move into the
// hover tooltip so the column reads as two lines while keeping every detail.
const PriceCell = ({ price, docFee, ap, position, value }: { price?: number | null; docFee?: number | null; ap?: AdvertisedPrice; position?: string | null; value?: number | null }) => {
  if (price == null) return <span className="text-xs text-muted-foreground">—</span>;
  const drift = assessDrift(price, ap, docFee || 0);
  const delta = value != null ? Number(value) - price : null; // > 0 → price below market value (good)
  const above = delta != null && delta < 0;
  const presentation = position
    ? presentLegacyPosition(position)
    : delta == null ? null : presentLegacyPosition(above ? "above_market" : "below_market");
  const dealLabel = presentation?.label ?? null;
  const marketTone = presentation?.classes.text ?? "text-slate-600";
  const dotTone = presentation?.classes.dot ?? "bg-slate-400";
  const marketText = above && delta != null ? `$${Math.abs(delta).toLocaleString()} ${dealLabel ?? ""}`.trim() : dealLabel;

  const tip = [
    drift.status === "drift"
      ? `Advertised mismatch ${drift.delta > 0 ? "+" : "−"}$${Math.abs(Math.round(drift.delta)).toLocaleString()}${drift.reason ? ` · ${drift.reason}` : ""}`
      : "Advertised price matches the listing price",
    drift.advertised != null ? `Advertised $${drift.advertised.toLocaleString()}${drift.source ? ` · ${SOURCE_LABELS[drift.source] || drift.source}` : ""}` : null,
    docFee ? `+ $${Number(docFee).toLocaleString()} doc fee · Website $${(price + Number(docFee)).toLocaleString()}` : null,
    delta != null ? `$${Math.abs(delta).toLocaleString()} ${above ? "above" : "below"} market value` : null,
  ].filter(Boolean).join("\n");

  return (
    <div className="leading-tight" title={tip}>
      <p className="inline-flex items-center gap-1 text-sm font-bold text-foreground tabular-nums">
        ${price.toLocaleString()}
        {drift.status === "drift" && <AlertTriangle className="w-3 h-3 text-red-600" />}
      </p>
      {marketText && (
        <p className={`inline-flex items-center gap-1 text-xs font-semibold mt-0.5 ${marketTone}`}>
          <span className={`w-2 h-2 rounded-full ${dotTone}`} />{marketText}
        </p>
      )}
    </div>
  );
};


// pressing action the vehicle needs before it can publish.
const StatusPill = ({ status, signal }: { status: VehicleRow["status"]; signal?: RowSignal }) => {
  const cfg = status === "published" ? { cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Published" }
    : status === "archived" ? { cls: "bg-muted text-muted-foreground", dot: "bg-slate-400", label: "Archived" }
    : signal && !signal.stickerDone ? { cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500", label: "Needs Sticker" }
    : signal && !signal.hasAddendum ? { cls: "bg-orange-100 text-orange-700", dot: "bg-orange-500", label: "Needs Addendum" }
    : signal && signal.needsPriceVerify ? { cls: "bg-violet-100 text-violet-700", dot: "bg-violet-500", label: "Price Review" }
    : { cls: "bg-muted text-muted-foreground", dot: "bg-slate-400", label: "Draft" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
    </span>
  );
};

interface KebabItem { label: string; icon: typeof Car; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string; }

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
            <button key={i} disabled={it.disabled} title={it.title} aria-describedby={it.disabled ? "market-batch-notice" : undefined} onClick={() => { setOpen(false); it.onClick(); }} className={`disabled:opacity-50 disabled:cursor-not-allowed w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-left transition-colors ${it.danger ? "text-red-600 hover:bg-red-50" : "text-foreground hover:bg-muted"}`}>
              <it.icon className="w-4 h-4 shrink-0" />{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Header secondary actions, in one menu instead of a fixed side column.
const ActionsMenu = ({ items }: { items: KebabItem[] }) => {
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
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        More actions <ChevronRight className="w-4 h-4 rotate-90" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-56 rounded-[6px] border border-adm-border bg-adm-surface z-20 p-1">
          {items.map((it, i) => (
            <button key={i} role="menuitem" disabled={it.disabled} title={it.title} aria-describedby={it.disabled ? "market-batch-notice" : undefined} onClick={() => { setOpen(false); it.onClick(); }} className="w-full min-h-[36px] flex items-center gap-2.5 px-2.5 rounded-[4px] text-[14px] text-left text-adm-ink hover:bg-adm-workspace disabled:opacity-50 disabled:cursor-not-allowed">
              <it.icon className="w-4 h-4 shrink-0" />{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Pagination = ({ page, pageCount, total, pageSize, onPage, onPageSize }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) => {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  const withGaps: (number | "gap")[] = [];
  let prev = 0;
  for (const p of pages) { if (prev && p - prev > 1) withGaps.push("gap"); withGaps.push(p); prev = p; }
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">Showing <span className="font-semibold text-foreground tabular-nums">{from}</span>–<span className="font-semibold text-foreground tabular-nums">{to}</span> of <span className="font-semibold text-foreground tabular-nums">{total}</span> vehicles</p>
        <div className="flex items-center gap-1.5">
          <label htmlFor="inv-per-page" className="text-xs text-muted-foreground">Per page</label>
          <select
            id="inv-per-page"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-card text-foreground text-xs font-medium px-2 outline-none hover:bg-muted transition-colors cursor-pointer"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
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
    const slug = vin.trim().toUpperCase();
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
    // The required stock number lands on vehicle_files.stock_number (the stock
    // truth the draft RPCs read back) BEFORE orchestration, then the same
    // intake orchestration the ingest paths run (drafts + hub token +
    // clearance) — both best-effort, never block the insert.
    void persistStockNumber(tenantId, vin.trim().toUpperCase(), stock)
      .then(() => runManualIntakeOrchestration(tenantId, vin.trim().toUpperCase(), condition));
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
    // vehicle_listings has no stock_number column — stock lives on
    // vehicle_files (UNIQUE tenant_id+vin), written after the insert below.
    const stockByVin = new Map<string, string>();
    const toInsert = lines.slice(1).map((line) => {
      const cells = line.split(/[,\t]/).map((c) => c.trim());
      const vin = (cells[idx.vin] || "").toUpperCase();
      if (vin.length < 11) return null;
      const stockNo = (cells[idx.stock] || "").trim();
      if (stockNo) stockByVin.set(vin, stockNo);
      const year = idx.year >= 0 ? cells[idx.year] : "";
      const make = idx.make >= 0 ? cells[idx.make] : "";
      const model = idx.model >= 0 ? cells[idx.model] : "";
      const ymm = [year, make, model].filter(Boolean).join(" ");
      return {
        store_id: tenantId, tenant_id: tenantId, vin, slug: vin, ymm: ymm || null,
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
    // Same intake orchestration the ingest paths run, sequentially so a large
    // import doesn't stampede the RPCs — best-effort, never blocks the import.
    // Every vehicle gets an open "intake queued" exception BEFORE its
    // orchestration runs and is resolved after it completes, so a tab closed
    // mid-import leaves visible open markers (the nightly sweep completes the
    // drafts) instead of nothing at all.
    void (async () => {
      for (const row of toInsert) {
        await markIntakeQueued(tenantId, String(row.vin || ""));
      }
      for (const row of toInsert) {
        const vin = String(row.vin || "");
        await persistStockNumber(tenantId, vin, stockByVin.get(vin));
        await runManualIntakeOrchestration(tenantId, vin, String(row.condition || "used"));
        await clearIntakeQueued(tenantId, vin, userId);
      }
    })();
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

export default InventoryModern;

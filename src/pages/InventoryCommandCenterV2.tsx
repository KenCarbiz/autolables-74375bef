import { useEffect, useMemo, useState } from "react";
import { loadScopedInventory, scopeFailureOf } from "@/lib/inventoryScope/primaryInventory";
import { STORE_INVENTORY_PATH } from "@/lib/inventoryScope/paths";
import { useGroupInventory } from "@/hooks/useGroupInventory";
import { feedTitle, groupFailureOf, mergeGroupRows, verifyAccessStores, type DisplayRow, type DisplayStatus } from "@/lib/inventoryScope/groupInventory";
import { countByStore } from "@/lib/inventoryScope/groupInventory";
import { DealershipChip, DealershipSelector, DealershipStatusBadge, DealershipSummaryLine, groupAccessNote } from "@/components/inventory/DealershipSelector";
import { FeedVehicleSheet } from "@/components/inventory/FeedVehicleSheet";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import { PageHeader } from "@/components/product";
import { legacyMarketView, type LegacyListingFields } from "@/lib/market/surfaceCompat";
import { presentLegacyPosition } from "@/lib/market/presentation";
import { signalOf, queueMatches, stickerStateOf, type QueueId, type StickerDoc, type VehicleSignal } from "@/lib/inventoryV2/signals";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Car, Search, ShieldCheck, ShieldAlert, Eye, Pencil, Printer, MoreHorizontal, Plus, Tag,
  FileSignature, CircleDollarSign, ScanLine, ArrowRight, ChevronRight, Settings, RefreshCw, Ban,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// InventoryCommandCenterV2 — /inventory-v2  (DRAFT)
// Built alongside the live /inventory page, which is left untouched.
// Every count, tab and queue reads the predicates in lib/inventoryV2/signals.
// ──────────────────────────────────────────────────────────────

const needsPriceReview = (r: { market_position?: string | null; price: number | null }): boolean => {
  if (r.price == null) return true;
  const tone = presentLegacyPosition(typeof r.market_position === "string" ? r.market_position : null).tone;
  return tone === "caution" || tone === "negative";
};

const rowMarketDelta = (row: unknown): number | null => {
  const view = legacyMarketView(row as LegacyListingFields, "dealer_inventory");
  return view.difference != null ? -view.difference : null;
};

interface GroupMeta { storeId: string; storeName: string; status: DisplayStatus; feedOnly: boolean; display: DisplayRow }

const toPageRow = (d: DisplayRow<VRow>): VRow => {
  const gv: GroupMeta = { storeId: d.storeId, storeName: d.storeName, status: d.status, feedOnly: d.source === "feed", display: d as DisplayRow };
  if (d.listing) return { ...d.listing, gv };
  const seen = d.feed?.last_seen_at ?? "1970-01-01T00:00:00.000Z";
  return {
    id: d.key, vin: d.vin, ymm: d.feed ? feedTitle(d.feed) : null, trim: d.trim, mileage: d.mileage, condition: d.condition, price: d.price,
    status: "draft", slug: "", published_at: null, updated_at: seen, stock_number: d.stock, hero_image_url: d.thumbnail, gv,
  };
};

interface VRow {
  gv?: GroupMeta;
  id: string; vin: string; ymm: string | null; trim: string | null;
  mileage: number | null; condition: "new" | "used" | "cpo" | null;
  price: number | null; status: "draft" | "published" | "archived";
  slug: string; published_at: string | null; updated_at: string;
  stock_number?: string | null; hero_image_url?: string | null;
  recall_status?: string | null; open_recall_count?: number | null;
  recall_payload?: unknown; recall_check?: unknown; recall_checked_at?: string | null;
  market_position?: string | null; market_value?: number | null;
}

// Untyped client: several of these columns/tables predate the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = () => supabase as any;

const CHUNK = 200;

type Tone = "critical" | "warn" | "ok" | "muted";
const TONE: Record<Tone, string> = {
  critical: "text-red-700", warn: "text-amber-700", ok: "text-emerald-700", muted: "text-muted-foreground",
};
const DOT: Record<Tone, string> = {
  critical: "bg-red-500", warn: "bg-amber-500", ok: "bg-emerald-500", muted: "bg-slate-300",
};

const fmt$ = (n: number | null | undefined) => (n != null ? `$${Math.round(n).toLocaleString()}` : "—");
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const Status = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE[tone]}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone]}`} aria-hidden="true" />{children}
  </span>
);

const Kpi = ({ label, value, sub, tone = "muted", onClick, cta }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; onClick?: () => void; cta?: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 min-w-0 flex flex-col">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`text-[28px] font-bold leading-none mt-2 tabular-nums ${tone === "muted" ? "text-foreground" : TONE[tone]}`}>{value}</p>
    {sub && <div className="text-[12px] text-muted-foreground mt-1.5">{sub}</div>}
    {onClick && cta && (
      <button onClick={onClick} className="mt-3 text-[12px] font-semibold text-primary inline-flex items-center gap-1 self-start rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        {cta} <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    )}
  </div>
);

const InventoryCommandCenterV2 = () => {
  const { tenant } = useTenant();
  const { isAdmin, user } = useAuth();
  const { member } = useEntitlements();
  const { settings, updateSettings } = useDealerSettings();
  const navigate = useNavigate();
  const canEditLayout = hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const quickActionsOn = settings.inventory_show_quick_actions === true;

  const [listingRows, setRows] = useState<VRow[]>([]);
  const group = useGroupInventory(tenant?.id, user?.id);
  const [registry, setRegistry] = useState<{ ids: string[]; primaryId: string | null } | null>(null);
  const [detailRow, setDetailRow] = useState<DisplayRow | null>(null);
  const [scopeInfo, setScopeInfo] = useState<{ primaryName: string; children: number; review: number } | null>(null);
  const [addVins, setAddVins] = useState<Set<string>>(new Set());
  const [stickerDocs, setStickerDocs] = useState<Map<string, StickerDoc[]>>(new Map());
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [lastSync, setLastSync] = useState<{ at: string | null }>({ at: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ title: string; detail: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [condFilter, setCondFilter] = useState("all");
  const [sort, setSort] = useState<"updated" | "price" | "ymm">("updated");
  const [tab, setTab] = useState<QueueId>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  useEffect(() => { setPage(1); }, [q, statusFilter, condFilter, tab, sort, perPage]);

  useEffect(() => {
    if (!tenant?.id) return;
    let on = true;
    (async () => {
      setLoading(true); setLoadError(null);
      const baseCols = "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,updated_at";
      let list: VRow[];
      try {
        const scoped = await loadScopedInventory<VRow>({
          tenantId: tenant.id,
          includeArchived: true,
          columnSets: [
            `${baseCols},hero_image_url,recall_status,open_recall_count,recall_payload,recall_check,recall_checked_at,market_position,market_value`,
            `${baseCols},hero_image_url,recall_status,open_recall_count,recall_payload,recall_check,recall_checked_at`,
            `${baseCols},hero_image_url,recall_status,open_recall_count`,
            baseCols,
          ],
        });
        list = [...scoped.primaryRows].sort((x, y) => (y.updated_at || "").localeCompare(x.updated_at || "") || x.id.localeCompare(y.id));
        if (!on) return;
        const reg = scoped.registry;
        setRegistry({ ids: scoped.stores.map((st) => st.id), primaryId: reg.primary?.id ?? null });
        setScopeInfo(scoped.mode === "multi_rooftop" && reg.primary
          ? { primaryName: reg.primary.display_name, children: reg.children.length, review: scoped.summary.review.total }
          : null);
      } catch (e) {
        if (!on) return;
        // Fail closed: never keep or show an unscoped list.
        setRows([]); setRegistry(null); setScopeInfo(null); setLoadError(scopeFailureOf(e)); setLoading(false);
        return;
      }

      const vins = Array.from(new Set(list.map((r) => r.vin).filter(Boolean)));
      const ad = new Set<string>();
      try {
        const delivered = new Set<string>(); const stockByVin = new Map<string, string>();
        for (const part of chunks(vins, CHUNK)) {
          const [{ data: allAdd }, { data: vfiles }] = await Promise.all([
            sb().from("addendums").select("vehicle_vin").in("vehicle_vin", part),
            sb().from("vehicle_files").select("vin, stock_number, deal_status").in("vin", part),
          ]);
          for (const a of (allAdd || []) as Array<{ vehicle_vin: string }>) ad.add((a.vehicle_vin || "").toUpperCase());
          for (const f of (vfiles || []) as Array<{ vin: string; stock_number: string | null; deal_status: string }>) {
            const v = (f.vin || "").toUpperCase();
            if (f.stock_number) stockByVin.set(v, f.stock_number);
            if (f.deal_status === "delivered") delivered.add(v);
          }
        }
        list = list.filter((r) => !delivered.has((r.vin || "").toUpperCase()))
          .map((r) => ({ ...r, stock_number: stockByVin.get((r.vin || "").toUpperCase()) ?? r.stock_number ?? null }));
      } catch { /* optional tables */ }

      // Window-sticker evidence: tenant-scoped generated_documents only.
      const docMap = new Map<string, StickerDoc[]>();
      let docsOk = true;
      try {
        for (const part of chunks(list.map((r) => r.id), CHUNK)) {
          const { data, error } = await sb().from("generated_documents")
            .select("vehicle_id, document_type, document_status")
            .eq("tenant_id", tenant.id).in("vehicle_id", part);
          if (error) { docsOk = false; break; }
          for (const d of (data || []) as StickerDoc[]) docMap.set(d.vehicle_id, [...(docMap.get(d.vehicle_id) || []), d]);
        }
      } catch { docsOk = false; }
      if (!on) return;
      setRows(list); setAddVins(ad); setStickerDocs(docMap); setDocsLoaded(docsOk);
      try {
        const { data: cfg } = await sb().from("marketcheck_sync_config").select("last_run_at").eq("tenant_id", tenant.id).maybeSingle();
        if (on) setLastSync({ at: cfg?.last_run_at ?? null });
      } catch { /* noop */ }
      if (on) setLoading(false);
    })();
    return () => { on = false; };
  }, [tenant?.id, reload]);

  const merged = useMemo((): { rows: VRow[] | null; error: unknown } => {
    if (!group.combined || group.access.status !== "allowed" || !registry) return { rows: null, error: null };
    if (group.feedError) return { rows: null, error: group.feedError };
    if (group.feed.status !== "ready") return { rows: null, error: null };
    try {
      verifyAccessStores(group.access, registry.ids, registry.primaryId);
      const display = mergeGroupRows<VRow>({
        stores: group.stores, selectedStoreIds: group.selectedIds, primaryStoreId: registry.primaryId, listings: listingRows, feed: group.feedRows,
      });
      return { rows: display.map(toPageRow), error: null };
    } catch (e) {
      return { rows: null, error: e };
    }
  }, [group.combined, group.access, group.feed, group.feedError, group.feedRows, group.stores, group.selectedIds, registry, listingRows]);
  const combinedView = group.combined && !!registry;
  const groupError = combinedView ? merged.error : null;
  const groupLoading = combinedView && !groupError && merged.rows === null;
  const rows = useMemo(() => (combinedView ? merged.rows ?? [] : listingRows), [combinedView, merged.rows, listingRows]);

  const signals = useMemo(() => {
    const m = new Map<string, VehicleSignal>();
    for (const r of rows) {
      if (r.gv?.feedOnly) continue;
      m.set(r.id, signalOf(r, addVins.has((r.vin || "").toUpperCase()), stickerStateOf(r.condition, docsLoaded, stickerDocs.get(r.id))));
    }
    return m;
  }, [rows, addVins, stickerDocs, docsLoaded]);

  const FEED_QUEUES: QueueId[] = ["all", "new", "used", "cpo"];
  const matches = (id: QueueId, r: VRow): boolean => {
    if (r.gv?.feedOnly) return FEED_QUEUES.includes(id) && (id === "all" || r.condition === id);
    return queueMatches(id, r, signals.get(r.id)!, needsPriceReview(r));
  };
  const count = (id: QueueId) => rows.reduce((n, r) => n + (matches(id, r) ? 1 : 0), 0);

  const stats = useMemo(() => {
    const c = (id: QueueId) => count(id);
    const all = rows.filter((r) => !r.gv?.feedOnly).map((r) => signals.get(r.id)!);
    const deltas = rows.filter((r) => !r.gv?.feedOnly).map(rowMarketDelta).filter((x): x is number => x != null);
    return {
      total: rows.length,
      newN: c("new"), usedN: c("used"), cpoN: c("cpo"),
      published: c("published"), draft: c("draft"), ready: c("ready"), blocked: c("blocked"),
      sticker: c("needs_sticker"), addendum: c("missing_addendum"), price: c("price_review"),
      recalls: c("open_recalls"), recallUnknown: c("recall_unknown"), vin: c("vin_issues"), attention: c("attention"),
      avgScore: all.length ? Math.round((all.reduce((a, s) => a + s.score, 0) / all.length) * 100) : 0,
      avgDelta: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, signals]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (condFilter !== "all" && r.condition !== condFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "feed_only" || statusFilter === "missing_from_feed" || statusFilter === "review") { if (r.gv?.status !== statusFilter) return false; }
        else if (r.gv?.feedOnly || r.status !== statusFilter) return false;
      }
      if (!matches(tab, r)) return false;
      if (needle && !`${r.vin} ${r.stock_number || ""} ${r.ymm || ""} ${r.trim || ""} ${r.gv?.storeName || ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return out.sort((a, b) =>
      sort === "price" ? (b.price ?? -1) - (a.price ?? -1)
      : sort === "ymm" ? (a.ymm || "").localeCompare(b.ymm || "")
      : (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [rows, signals, q, statusFilter, condFilter, tab, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id: QueueId) => { setTab(id); setStatusFilter("all"); setCondFilter("all"); document.getElementById("inv-v2-list")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const stickerCount: number | null = docsLoaded ? stats.sticker : null;
  const syncedLabel = lastSync.at ? `Market data synced ${new Date(lastSync.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Market sync not run";

  const tabs: { id: QueueId; label: string; n: number | null }[] = [
    { id: "all", label: "All", n: stats.total },
    { id: "new", label: "New", n: stats.newN },
    { id: "used", label: "Used", n: stats.usedN },
    { id: "cpo", label: "CPO", n: stats.cpoN },
    { id: "ready", label: "Ready to publish", n: stats.ready },
    { id: "blocked", label: "Cannot publish", n: stats.blocked },
    { id: "needs_sticker", label: "Missing sticker", n: stickerCount },
    { id: "missing_addendum", label: "Missing addendum", n: stats.addendum },
    { id: "price_review", label: "Price review", n: stats.price },
    { id: "open_recalls", label: "Open recalls", n: stats.recalls },
    { id: "vin_issues", label: "VIN issues", n: stats.vin },
    { id: "published", label: "Published", n: stats.published },
    { id: "draft", label: "Draft", n: stats.draft },
  ];

  const priorities: { icon: React.ElementType; label: string; n: number | null; tone: Tone; id: QueueId; note?: string }[] = [
    { icon: Tag, label: "Missing stickers", n: stickerCount, tone: "critical", id: "needs_sticker", note: docsLoaded ? undefined : "Sticker status unavailable" },
    { icon: FileSignature, label: "Missing addendums", n: stats.addendum, tone: "warn", id: "missing_addendum" },
    { icon: CircleDollarSign, label: "Price review", n: stats.price, tone: "warn", id: "price_review" },
    { icon: ShieldAlert, label: "Open recalls", n: stats.recalls, tone: "critical", id: "open_recalls" },
    { icon: ScanLine, label: "VIN issues", n: stats.vin, tone: "critical", id: "vin_issues" },
  ];

  const work: { icon: React.ElementType; label: string; n: number | null; tone: Tone; id: QueueId }[] = [
    { icon: Ban, label: "Cannot be published", n: stats.blocked, tone: "critical", id: "blocked" },
    { icon: FileSignature, label: "Missing addendums", n: stats.addendum, tone: "warn", id: "missing_addendum" },
    { icon: Tag, label: "Missing stickers", n: stickerCount, tone: "warn", id: "needs_sticker" },
    { icon: CircleDollarSign, label: "Price review", n: stats.price, tone: "warn", id: "price_review" },
    { icon: ShieldAlert, label: "Open recalls", n: stats.recalls, tone: "critical", id: "open_recalls" },
    { icon: ShieldCheck, label: "Recall status not verified", n: stats.recallUnknown, tone: "muted", id: "recall_unknown" },
  ];

  const quickActions: { icon: React.ElementType; label: string; hint: string; onClick: () => void }[] = [
    { icon: Plus, label: "Add vehicle", hint: "Open the add-vehicle form (VIN entry)", onClick: () => navigate("/add-inventory") },
    { icon: RefreshCw, label: "Inventory sync", hint: "Open the inventory sync center", onClick: () => navigate("/admin/inventory-sync") },
    { icon: Printer, label: "New car sticker", hint: "Open the new-car sticker tool", onClick: () => navigate("/new-car-sticker") },
    { icon: CircleDollarSign, label: "Show price reviews", hint: "Filter this list to vehicles needing a price review", onClick: () => go("price_review") },
    { icon: ShieldAlert, label: "Show open recalls", hint: "Filter this list; does not run a new recall lookup", onClick: () => go("open_recalls") },
    { icon: ArrowRight, label: "Show ready to publish", hint: "Filter this list to vehicles that pass every check", onClick: () => go("ready") },
  ];

  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice((safePage - 1) * perPage, safePage * perPage);

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Loading inventory"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  );
  if (loadError) return (
    <div className="p-6 max-w-xl mx-auto text-center" role="alert" data-testid="inventory-scope-error">
      <p className="text-[15px] font-semibold">{loadError.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{loadError.detail} No vehicle has been moved, changed or removed.</p>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button onClick={() => setReload((n) => n + 1)} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted">Retry</button>
        <Link to={STORE_INVENTORY_PATH} className="text-sm font-semibold text-primary hover:underline">Inventory by store</Link>
      </div>
    </div>
  );

  const gridCols = combinedView
    ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_96px_minmax(0,1.5fr)_104px_152px]"
    : "lg:grid-cols-[minmax(0,2fr)_112px_minmax(0,1.6fr)_120px_168px]";
  const selectCls = "h-10 px-3 rounded-lg border border-border text-sm bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  const accessNote = groupAccessNote(group.access, group.stores.length);
  const header = (
      <PageHeader
        className="mb-6"
        title="Inventory Command Center"
        description={<>{syncedLabel}{scopeInfo && !combinedView ? <> · Showing {scopeInfo.primaryName} only{scopeInfo.review ? `, ${scopeInfo.review} awaiting rooftop review` : ""}. <Link to={STORE_INVENTORY_PATH} className="font-semibold text-primary hover:underline">Inventory by store</Link></> : null}</>}
        actions={
          <>
          <DealershipSelector
            access={group.access} stores={group.stores} selectedIds={group.selectedIds} primaryOnly={group.primaryOnly}
            liveCounts={combinedView && !groupLoading && !groupError ? countByStore(rows.map((r) => r.gv!.display)) : undefined}
            loading={groupLoading} variant="plain" onSelect={group.select} onSelectAll={group.selectAll} onPrimaryOnly={group.selectPrimaryOnly}
          />
          <div className="relative">
            <button onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} className="inline-flex items-center gap-2 px-3 h-10 rounded-lg bg-card border border-border text-sm font-semibold hover:bg-muted">
              <Settings className="w-5 h-5 text-muted-foreground" aria-hidden="true" /> <span className="hidden sm:inline">Layout</span>
            </button>
            {showSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
                <div className="absolute right-0 mt-2 w-[320px] rounded-xl border border-border bg-card shadow-lg z-20 p-4">
                  <div className="flex items-start gap-3">
                    {canEditLayout ? (
                      <button
                        onClick={() => updateSettings({ inventory_show_quick_actions: !quickActionsOn })}
                        role="switch" aria-checked={quickActionsOn} aria-label="Show Quick Actions panel"
                        className={`mt-0.5 w-10 h-6 rounded-full flex items-center px-0.5 shrink-0 transition-colors ${quickActionsOn ? "bg-primary justify-end" : "bg-muted-foreground/30 justify-start"}`}
                      ><span className="w-5 h-5 rounded-full bg-card shadow" /></button>
                    ) : null}
                    <div>
                      <p className="text-[13px] font-semibold">Quick Actions panel: {quickActionsOn ? "On" : "Off"}</p>
                      <p className="text-[12px] text-muted-foreground leading-snug mt-1">
                        {canEditLayout ? "Applies to everyone at this dealership. Off by default." : "Only a dealership admin can change this."}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          </>
        }
      />
  );
  const notes = (
    <>
      {combinedView && !groupError && !groupLoading && <DealershipSummaryLine className="-mt-4 mb-4" stores={group.stores} selectedIds={group.selectedIds} total={rows.length} />}
      {!combinedView && accessNote && <p className="-mt-4 mb-4 text-[13px] leading-[18px] text-muted-foreground" data-testid="dealership-note">{accessNote}</p>}
    </>
  );

  if (groupError) return (
    <div className="p-4 lg:px-6 lg:py-5 max-w-[1600px] mx-auto">
      {header}
      <div className="p-6 max-w-xl mx-auto text-center" role="alert" data-testid="dealership-view-error">
        <p className="text-[15px] font-semibold">{groupFailureOf(groupError).title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{groupFailureOf(groupError).detail} No vehicle has been moved, changed or removed.</p>
        <div className="mt-3 flex items-center justify-center gap-3">
          <button onClick={() => { group.retry(); setReload((n) => n + 1); }} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted">Retry</button>
          <button onClick={group.selectPrimaryOnly} className="text-sm font-semibold text-primary hover:underline">Show primary dealership only</button>
        </div>
      </div>
    </div>
  );
  if (groupLoading) return (
    <div className="p-4 lg:px-6 lg:py-5 max-w-[1600px] mx-auto">
      {header}
      <div className="min-h-[40vh] flex items-center justify-center" role="status" aria-label="Loading selected dealerships"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
    </div>
  );


  return (
    <div className="p-4 lg:px-6 lg:py-5 max-w-[1600px] mx-auto">
      {header}
      {notes}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Kpi label="Ready to publish" value={<>{stats.ready}<span className="text-sm font-semibold text-muted-foreground"> / {stats.draft}</span></>} sub={`Drafts passing every check · avg ${stats.avgScore}%`} onClick={() => go("ready")} cta="View ready" />
        <Kpi label="Total vehicles" value={stats.total} sub={<>{stats.newN} new · {stats.usedN} used{stats.cpoN ? ` · ${stats.cpoN} CPO` : ""}</>} onClick={() => go("all")} cta="View all" />
        <Kpi label="Published" value={stats.published} tone="ok" sub="Live on Passport" onClick={() => go("published")} cta="View published" />
        <Kpi label="Needs attention" value={stats.attention} tone={stats.attention ? "warn" : "muted"} sub="Blocked, recall or addendum" onClick={() => go("attention")} cta="View list" />
        <Kpi label="Open recalls" value={stats.recalls} tone={stats.recalls ? "critical" : "muted"} sub={`${stats.recallUnknown} not verified`} onClick={() => go("open_recalls")} cta="View recalls" />
        <Kpi label="Market position" value={stats.avgDelta != null ? fmt$(Math.abs(stats.avgDelta)) : "—"} sub={stats.avgDelta == null ? "No market data" : stats.avgDelta >= 0 ? "Avg below market" : "Avg above market"} onClick={() => navigate("/dashboard/reports")} cta="Market report" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
        <div className="min-w-0 space-y-4">
          <section aria-labelledby="prio-h">
            <h2 id="prio-h" className="text-[15px] font-semibold mb-2">Priority queue</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {priorities.map((p) => {
                const disabled = p.n == null;
                const tone: Tone = p.n ? p.tone : "muted";
                return (
                  <button key={p.id} onClick={() => go(p.id)} disabled={disabled} aria-pressed={tab === p.id}
                    title={disabled ? p.note : `Show ${p.label.toLowerCase()}`}
                    className={`text-left rounded-xl border bg-card p-3 transition-colors disabled:cursor-not-allowed disabled:opacity-70 enabled:hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${tab === p.id ? "border-primary" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <p.icon className={`w-5 h-5 ${TONE[tone]}`} aria-hidden="true" />
                      {!disabled && <ChevronRight className="w-5 h-5 text-muted-foreground/50" aria-hidden="true" />}
                    </div>
                    <p className={`text-[24px] font-bold leading-none mt-2 tabular-nums ${tone === "muted" ? "text-foreground" : TONE[tone]}`}>{p.n ?? "--"}</p>
                    <p className="text-[12px] text-muted-foreground mt-1">{disabled ? p.note : p.label}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <div id="inv-v2-list" className="rounded-xl border border-border bg-card p-3 flex flex-col gap-3 scroll-mt-4">
            <div className="flex flex-col md:flex-row md:flex-wrap xl:flex-nowrap gap-2">
              <label className="relative flex-1 min-w-[220px]">
                <span className="sr-only">Search inventory</span>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock #, year, make, model, trim" className="w-full h-10 pl-10 pr-3 rounded-lg border border-border text-sm outline-none focus:border-primary bg-card" />
              </label>
              <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
                {combinedView && <><option value="feed_only">Feed only</option><option value="missing_from_feed">Missing from feed</option><option value="review">Needs review</option></>}
              </select>
              <select aria-label="Condition" value={condFilter} onChange={(e) => setCondFilter(e.target.value)} className={selectCls}>
                <option value="all">New &amp; used</option><option value="new">New</option><option value="used">Used</option><option value="cpo">CPO</option>
              </select>
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selectCls}>
                <option value="updated">Last updated</option><option value="price">Price, high to low</option><option value="ymm">Year / make</option>
              </select>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Inventory views">
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} disabled={t.n == null}
                  title={t.n == null ? "Sticker status unavailable" : undefined}
                  className={`h-8 px-3 rounded-md text-[12px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5 disabled:opacity-50 ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {t.label}<span className="tabular-nums opacity-80">{t.n ?? "--"}</span>
                </button>
              ))}
              {tab === "attention" || tab === "recall_unknown" ? (
                <button onClick={() => setTab("all")} className="h-8 px-3 rounded-md text-[12px] font-semibold bg-primary text-primary-foreground whitespace-nowrap">
                  {tab === "attention" ? "Needs attention" : "Recall not verified"} · clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className={`hidden lg:grid ${gridCols} gap-3 px-4 h-10 items-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 z-10 bg-card rounded-t-xl`}>
              <span>Vehicle</span>{combinedView && <span>Dealership</span>}<span>Readiness</span><span>Compliance</span><span>Price</span><span className="text-right">Actions</span>
            </div>
            {pageRows.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? "No vehicles in inventory yet." : "No vehicles match these filters."}
              </div>
            ) : pageRows.map((r) => {
              if (r.gv?.feedOnly) {
                const fname = r.ymm || "Vehicle (not decoded in feed)";
                return (
                  <div key={r.id} className={`grid grid-cols-[1fr_auto] ${gridCols} gap-x-3 gap-y-1.5 px-4 py-2 lg:min-h-[56px] items-center border-b border-border last:border-0 hover:bg-muted/50`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-[56px] h-[40px] rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        {r.hero_image_url ? <img src={r.hero_image_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Car className="w-5 h-5 text-muted-foreground/50" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[13px] truncate">{fname}</p>
                        <p className="text-[12px] text-muted-foreground truncate">{[r.condition?.toUpperCase(), r.stock_number ? `#${r.stock_number}` : null, r.vin ? `…${r.vin.slice(-6)}` : null].filter(Boolean).join(" · ") || "—"}</p>
                        <DealershipChip name={r.gv.storeName} className="lg:hidden max-w-full" />
                      </div>
                    </div>
                    <div className="hidden lg:block min-w-0 overflow-hidden"><DealershipChip name={r.gv.storeName} className="max-w-full" /></div>
                    <div className="hidden lg:block"><DealershipStatusBadge status={r.gv.status} /></div>
                    <div className="col-span-2 lg:col-span-1 text-[12px] text-muted-foreground">Source data from the dealership feed. Read-only.</div>
                    <div className="hidden lg:block text-[13px] leading-tight">
                      {r.price != null ? <p className="font-semibold tabular-nums">{fmt$(r.price)}</p> : <p className="text-[12px] text-muted-foreground">Price not in feed</p>}
                    </div>
                    <div className="row-start-1 col-start-2 lg:row-auto lg:col-auto flex items-center justify-end gap-1">
                      <button onClick={() => setDetailRow(r.gv!.display)} aria-label={`Feed details for ${fname}`}
                        className="h-10 px-3 rounded-lg border border-border text-[13px] font-semibold hover:bg-muted">Details</button>
                    </div>
                  </div>
                );
              }
              const s = signals.get(r.id)!;
              const pct = Math.round(s.score * 100);
              const ready: { tone: Tone; label: string } = s.published ? { tone: "ok", label: "Live" }
                : r.status === "archived" ? { tone: "muted", label: "Archived" }
                : s.readyToPublish ? { tone: "ok", label: "Ready" }
                : s.blocked ? { tone: "critical", label: "Blocked" }
                : { tone: "warn", label: `${pct}% checks` };
              const name = r.ymm || "Vehicle (VIN not decoded)";
              const canPrint = s.sticker === "present" && r.condition === "new";
              const delta = rowMarketDelta(r);
              return (
                <div key={r.id} className={`grid grid-cols-[1fr_auto] ${gridCols} gap-x-3 gap-y-1.5 px-4 py-2 lg:min-h-[56px] items-center border-b border-border last:border-0 hover:bg-muted/50`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-[56px] h-[40px] rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                      {r.hero_image_url ? <img src={r.hero_image_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Car className="w-5 h-5 text-muted-foreground/50" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[13px] truncate">{name}</p>
                      <p className="text-[12px] text-muted-foreground truncate">{[r.condition?.toUpperCase(), r.stock_number ? `#${r.stock_number}` : null, r.vin ? `…${r.vin.slice(-6)}` : null].filter(Boolean).join(" · ") || "—"}</p>
                      {r.gv && <DealershipChip name={r.gv.storeName} className="lg:hidden max-w-full" />}
                    </div>
                  </div>
                  {r.gv && <div className="hidden lg:block min-w-0 overflow-hidden"><DealershipChip name={r.gv.storeName} className="max-w-full" /></div>}
                  <div className="hidden lg:block">{r.gv?.status === "review" ? <DealershipStatusBadge status="review" /> : <Status tone={ready.tone}>{ready.label}</Status>}</div>
                  <div className="col-span-2 lg:col-span-1 flex flex-wrap gap-x-3 gap-y-1">
                    {!s.decoded && <Status tone="critical">VIN issue</Status>}
                    {s.recall === "open" ? <Status tone="critical">Open recall</Status> : s.recall === "clear" ? <Status tone="ok">Recall clear (VIN)</Status> : <Status tone="muted">Recall not verified</Status>}
                    {!s.hasAddendum && <Status tone="warn">No addendum</Status>}
                    {s.sticker === "missing" && <Status tone="warn">No sticker</Status>}
                  </div>
                  <div className="hidden lg:block text-[13px] leading-tight">
                    <p className="font-semibold tabular-nums">{fmt$(r.price)}</p>
                    {r.market_position
                      ? <p className={`text-[12px] ${presentLegacyPosition(r.market_position).classes.text}`}>{presentLegacyPosition(r.market_position).label}</p>
                      : delta != null ? <p className="text-[12px] text-muted-foreground">{fmt$(Math.abs(delta))} {delta >= 0 ? "below" : "above"} mkt</p>
                      : <p className="text-[12px] text-muted-foreground">Not checked</p>}
                  </div>
                  <div className="row-start-1 col-start-2 lg:row-auto lg:col-auto flex items-center justify-end gap-1">
                    <button onClick={() => window.open(`/v/${(r.vin || r.slug).toUpperCase()}`, "_blank", "noopener")} disabled={!s.published}
                      aria-label={`View Passport for ${name}`} title={s.published ? "View public Passport" : "Not published yet"}
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground enabled:hover:bg-muted disabled:opacity-30"><Eye className="w-5 h-5" /></button>
                    <button onClick={() => navigate(`/vehicle-file/${r.id}`)} aria-label={`Edit ${name}`} title="Edit vehicle file"
                      className="w-10 h-10 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><Pencil className="w-5 h-5" /></button>
                    {canPrint && (
                      <button onClick={() => navigate(`/factory-sticker/${r.id}`)} aria-label={`Print window sticker for ${name}`} title="Open window sticker to print"
                        className="w-10 h-10 rounded-lg hover:bg-muted flex items-center justify-center text-primary"><Printer className="w-5 h-5" /></button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`More actions for ${name}`} title="More actions"
                        className="w-10 h-10 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><MoreHorizontal className="w-5 h-5" /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(r.vin).then(() => toast.success("VIN copied")); }}>Copy VIN</DropdownMenuItem>
                        {r.condition === "new" && <DropdownMenuItem onSelect={() => navigate(`/factory-sticker/${r.id}`)}>Window sticker workspace</DropdownMenuItem>}
                        {s.published && <DropdownMenuItem onSelect={() => window.open(`/v/${(r.vin || r.slug).toUpperCase()}`, "_blank", "noopener")}>Open public Passport</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
            <div className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2 border-t border-border bg-card rounded-b-xl">
              <p className="text-[12px] text-muted-foreground" aria-live="polite">
                {visible.length === 0 ? "No vehicles" : `Showing ${(safePage - 1) * perPage + 1}–${Math.min(safePage * perPage, visible.length)} of ${visible.length.toLocaleString()}`}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold disabled:opacity-40 hover:bg-muted">Previous</button>
                <span className="text-[12px] text-muted-foreground tabular-nums">Page {safePage} of {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold disabled:opacity-40 hover:bg-muted">Next</button>
                <select aria-label="Rows per page" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="h-8 px-2 rounded-md border border-border text-[12px] bg-card">
                  <option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="work-h">
            <h3 id="work-h" className="text-[14px] font-semibold">Today's work queue</h3>
            <ul className="mt-3 divide-y divide-border">
              {work.map((t) => {
                const disabled = t.n == null;
                const tone: Tone = t.n ? t.tone : "muted";
                return (
                  <li key={t.id}>
                    <button onClick={() => go(t.id)} disabled={disabled} title={disabled ? "Sticker status unavailable" : undefined}
                      className="w-full flex items-center gap-3 py-2.5 text-left rounded enabled:hover:bg-muted/50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <t.icon className={`w-5 h-5 shrink-0 ${TONE[tone]}`} aria-hidden="true" />
                      <span className="flex-1 text-[13px]">{t.label}</span>
                      <span className="text-[14px] font-semibold tabular-nums">{t.n ?? "--"}</span>
                      {!disabled && <ChevronRight className="w-5 h-5 text-muted-foreground/50" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {quickActionsOn && (
            <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="qa-h">
              <h3 id="qa-h" className="text-[14px] font-semibold mb-3">Quick actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((a) => (
                  <button key={a.label} onClick={a.onClick} title={a.hint} className="flex items-center gap-2 px-2.5 h-10 rounded-lg border border-border hover:bg-muted text-[12px] font-semibold text-left">
                    <a.icon className="w-5 h-5 text-primary shrink-0" aria-hidden="true" /><span className="truncate">{a.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
      <FeedVehicleSheet row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
};

export default InventoryCommandCenterV2;

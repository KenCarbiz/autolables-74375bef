import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Car, ChevronRight, Copy, ExternalLink, Globe,
} from "lucide-react";
import { PageBody, LocalTabs, Button, LinkButton, StatusText, EmptyState, SkeletonBlock, type LocalTab } from "@/components/product";
import { Crumbs } from "@/components/detail/parts";
import { useRecallTask } from "@/hooks/useRecallTask";
import VehicleHistoryFacts from "@/components/vehicle/VehicleHistoryFacts";
import { listingGallery } from "@/lib/photos";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { useVehicleLifecycle } from "@/components/vehicleFile/lifecycle";
import { deriveStatusFacts, recallFact, type StatusFact } from "@/components/vehicleFile/statusFacts";
import HistoryTab from "@/components/vehicleFile/HistoryTab";
import OverviewTab from "@/components/vehicleFile/OverviewTab";
import DocumentsTab from "@/components/vehicleFile/DocumentsTab";
import GetReadyTab from "@/components/vehicleFile/GetReadyTab";
import CustomerTab from "@/components/vehicleFile/CustomerTab";
import ComplianceTab from "@/components/vehicleFile/ComplianceTab";
import {
  readinessSummary, resolveTab, type TabId, type VehicleRow,
} from "@/components/vehicleFile/types";

// ──────────────────────────────────────────────────────────────
// VehicleFile — /vehicle-file/:id
//
// The employee view of one vehicle, in six tabs:
//   Overview · Documents · Get Ready · Customer · Compliance · History
//
// The vehicle_listings row is the record; every child artifact refers to it
// by id. Lifecycle truth comes from the stored vehicle_lifecycle row, and
// readiness from the one readiness model in components/vehicleFile/types.
// ──────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "documents", label: "Documents" },
  { id: "getready", label: "Get Ready" },
  { id: "customer", label: "Customer" },
  { id: "compliance", label: "Compliance" },
  { id: "history", label: "History" },
];

const VehicleFile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<TabId>(() => resolveTab(searchParams.get("tab")));
  const [imgIdx, setImgIdx] = useState(0);
  const [publishing, setPublishing] = useState(false);
  // Open-recall service task (auto-raised by a DB trigger on every recall pull).
  const recall = useRecallTask(vehicle?.vin, vehicle?.tenant_id);
  const lifecycle = useVehicleLifecycle(vehicle?.tenant_id, vehicle?.id, vehicle?.condition);

  // Keep ?tab= in sync so deep links and refreshes land on the same tab. A
  // pre-consolidation tab name (deal, labels, addendum, scan, prep, sign,
  // evidence) still arrives from Inventory, Print Queue and the Command
  // Palette; resolveTab maps it onto the tab that now owns that work.
  useEffect(() => {
    const current = searchParams.get("tab");
    if (tab === "overview" && current) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    } else if (tab !== "overview" && current !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  // …and the other direction, so a link pressed while the page is already open
  // still moves the tab. Guarded on the raw value actually changing, because
  // the effect above rewrites the same parameter.
  const lastRawTab = useRef<string | null>(searchParams.get("tab"));
  useEffect(() => {
    const raw = searchParams.get("tab");
    if (raw === lastRawTab.current) return;
    lastRawTab.current = raw;
    if (raw) setTab(resolveTab(raw));
  }, [searchParams]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setVehicle(data as VehicleRow);
    setLoading(false);
    // vehicle_listings has no stock_number column — the DMS number lives on
    // vehicle_files, and the nightly crawler fills it there from the dealer's
    // own VDP for cars the feed didn't carry one for. Fetched separately so a
    // missing file row can never keep the page from rendering.
    try {
      const { data: file } = await (supabase as any)
        .from("vehicle_files")
        .select("stock_number")
        .eq("tenant_id", data.tenant_id)
        .eq("vin", data.vin)
        .maybeSingle();
      const filed = String(file?.stock_number || "").trim();
      if (filed) setVehicle((v) => (v && v.id === data.id ? { ...v, stock_number: filed } : v));
    } catch { /* the header falls back to whatever the listing carries */ }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // The canonical passport URL is /v/{VIN} — the same address the window
  // sticker QR encodes — so a copied link always matches the printed code.
  const publicUrl = useMemo(
    () => (vehicle ? `${window.location.origin}/v/${(vehicle.vin || vehicle.slug || "").toUpperCase()}` : ""),
    [vehicle],
  );
  // The "open" address reads /v3/ (the same page) so the dealer sees the
  // version explicitly.
  const viewUrl = useMemo(
    () => (vehicle ? `${window.location.origin}/v3/${(vehicle.vin || vehicle.slug || "").toUpperCase()}` : ""),
    [vehicle],
  );

  if (loading) {
    return (
      <PageBody width="wide">
        <div role="status" aria-label="Loading vehicle" className="flex flex-col gap-3">
          <SkeletonBlock className="h-[132px] w-full" />
          <SkeletonBlock className="h-10 w-2/3" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </PageBody>
    );
  }

  if (notFound || !vehicle) {
    return (
      <PageBody width="form">
        <EmptyState
          title="Vehicle not found"
          detail="This file may have been archived, or your tenant does not have access to it."
          action={<Button variant="primary" onClick={() => navigate("/inventory")}><ArrowLeft className="w-3.5 h-3.5" /> Back to inventory</Button>}
        />
      </PageBody>
    );
  }

  const ready = readinessSummary(vehicle, recall);
  const gallery = listingGallery(vehicle);
  const safeImg = gallery.length ? Math.min(imgIdx, gallery.length - 1) : 0;
  const stockNo = vehicleStockNumber(vehicle);
  const published = vehicle.status === "published";
  const facts = deriveStatusFacts({ vehicle, ready, lifecycle });
  const recallLine = recallFact(vehicle);

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Shopper link copied");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const copyVin = async () => {
    try {
      await navigator.clipboard.writeText(vehicle.vin);
      toast.success("VIN copied");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const publish = async () => {
    // An open recall must be reviewed by service before publish.
    if (recall.blocking) {
      toast.error("Open Recall Review Required — service must record an outcome before publishing.");
      return;
    }
    setPublishing(true);
    try {
      const { error } = await (supabase as any)
        .from("vehicle_listings")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", vehicle.id);
      if (!error) {
        await load();
        toast.success("Vehicle published to the shopper portal");
        return;
      }
      const msg = String(error.message || "");
      if (msg.includes("prep_gate_blocked")) {
        toast.error("Prep sign-off required — complete it on the Get Ready tab first.");
      } else if (msg.includes("recall_gate_blocked")) {
        toast.error("NHTSA recall check missing or stale — run the recall check on the Compliance tab.");
      } else {
        toast.error(msg || "Publish failed");
      }
    } finally {
      setPublishing(false);
    }
  };

  const summary: StatusFact[] = [facts.lifecycle, facts.publication, facts.retail, facts.signing, facts.delivery, recallLine];

  const tabs: LocalTab[] = TABS.map((t) => ({
    key: t.id,
    label: t.label,
    to: t.id === "overview" ? `/vehicle-file/${vehicle.id}` : `/vehicle-file/${vehicle.id}?tab=${t.id}`,
    active: tab === t.id,
  }));

  return (
    <PageBody width="wide" className="pb-24 lg:pb-8">
      <Crumbs items={[{ label: "Vehicles", to: "/inventory" }, { label: vehicle.ymm || vehicle.vin }]} />

      <section aria-label="Vehicle identity" className="rounded-[6px] border border-adm-border bg-adm-surface p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="sm:w-[148px] shrink-0">
            <div className="h-[100px] rounded-[4px] overflow-hidden bg-adm-workspace flex items-center justify-center">
              {gallery.length ? (
                <div className="relative w-full h-full">
                  <img src={gallery[safeImg]} alt={vehicle.ymm ? `${vehicle.ymm} photo ${safeImg + 1} of ${gallery.length}` : "Vehicle photo"} className="w-full h-full object-cover" />
                  {gallery.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setImgIdx((i) => (i - 1 + gallery.length) % gallery.length)}
                        aria-label="Previous photo"
                        className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-[4px] bg-foreground/50 text-background flex items-center justify-center"
                      ><ArrowLeft className="w-5 h-5" /></button>
                      <button
                        type="button"
                        onClick={() => setImgIdx((i) => (i + 1) % gallery.length)}
                        aria-label="Next photo"
                        className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-[4px] bg-foreground/50 text-background flex items-center justify-center"
                      ><ChevronRight className="w-5 h-5" /></button>
                      <span className="absolute bottom-1 left-1 text-[12px] font-semibold px-1.5 rounded-[2px] bg-foreground/60 text-background tabular-nums">
                        {safeImg + 1} / {gallery.length}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <Car className="w-10 h-10 text-adm-muted" strokeWidth={1.25} aria-label="No photo on file" />
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-[24px] leading-[32px] sm:text-[28px] sm:leading-[36px] font-bold text-adm-ink">
                {vehicle.ymm || "Vehicle needs a VIN decode"}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] leading-[20px]">
                {stockNo ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-adm-muted">Stock</span>
                    <span className="font-mono font-semibold">{stockNo}</span>
                  </span>
                ) : (
                  <span className="text-[12px] font-semibold text-adm-warning">Stock # not on the feed</span>
                )}
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span className="text-adm-muted">VIN</span>
                  <span className="font-mono truncate">{vehicle.vin}</span>
                  <button onClick={copyVin} title="Copy VIN" aria-label="Copy VIN" className="text-adm-muted hover:text-adm-ink shrink-0 min-w-[24px] min-h-[24px] inline-flex items-center justify-center">
                    <Copy className="w-5 h-5" />
                  </button>
                </span>
                {vehicle.trim ? <span className="text-adm-muted">{vehicle.trim}</span> : null}
                <span className="text-adm-muted capitalize">{vehicle.condition || "unknown"}</span>
                <span className="text-adm-muted">{vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : "Mileage not recorded"}</span>
                <span className="font-semibold tabular-nums">{vehicle.price != null ? `$${vehicle.price.toLocaleString()}` : "Not priced"}</span>
              </div>

              <ul aria-label="Vehicle status" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1">
                {summary.map((f) => (
                  <li key={f.label} title={f.detail} className="inline-flex items-center gap-1.5 text-[12px] leading-[18px] text-adm-muted">
                    {f.label}
                    <StatusText tone={f.tone}>{f.value}</StatusText>
                  </li>
                ))}
              </ul>

              <VehicleHistoryFacts vehicle={vehicle} />
            </div>

            <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
              <Button onClick={copyLink} aria-label="Copy shopper link">
                <Copy className="w-5 h-5" /> Copy link
              </Button>
              {published ? (
                <LinkButton to={viewUrl} variant="primary" target="_blank" rel="noreferrer">
                  <ExternalLink className="w-5 h-5" /> View shopper page
                </LinkButton>
              ) : (
                <Button variant="primary" onClick={publish} disabled={publishing}>
                  <Globe className="w-5 h-5" /> {publishing ? "Publishing…" : "Publish to shopper portal"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <LocalTabs tabs={tabs} label="Vehicle file sections" />

      <div>
        {tab === "overview" && <OverviewTab vehicle={vehicle} ready={ready} lifecycle={lifecycle} stockNumber={stockNo} onTab={setTab} onReload={load} />}
        {tab === "documents" && <DocumentsTab vehicle={vehicle} onReload={load} />}
        {tab === "getready" && <GetReadyTab vehicle={vehicle} lifecycle={lifecycle} ready={ready} />}
        {tab === "customer" && <CustomerTab vehicle={vehicle} stockNumber={stockNo} />}
        {tab === "compliance" && <ComplianceTab vehicle={vehicle} ready={ready} recall={recall} lifecycle={lifecycle} onReload={load} />}
        {tab === "history" && <HistoryTab vehicle={vehicle} lifecycle={lifecycle} />}
      </div>

      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-adm-border bg-adm-surface px-4 py-3 space-y-2">
        {published ? (
          <div className="flex gap-2">
            <LinkButton to={viewUrl} variant="primary" target="_blank" rel="noreferrer" className="flex-1">
              <ExternalLink className="w-4 h-4" /> View shopper page
            </LinkButton>
            <Button onClick={copyLink} aria-label="Copy shopper link">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={publish} disabled={publishing} className="w-full">
            <Globe className="w-4 h-4" /> {publishing ? "Publishing…" : "Publish to shopper portal"}
          </Button>
        )}
      </div>
    </PageBody>
  );
};

export default VehicleFile;

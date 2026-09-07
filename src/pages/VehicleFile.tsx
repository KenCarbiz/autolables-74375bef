import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Car, ChevronRight, Copy, ExternalLink, FileText, FolderCheck,
  Gauge, Globe, ShieldCheck, UserRound, Wrench,
} from "lucide-react";
import { useRecallTask } from "@/hooks/useRecallTask";
import { listingGallery } from "@/lib/photos";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { STATE_LABEL, useVehicleLifecycle } from "@/components/vehicleFile/lifecycle";
import OverviewTab from "@/components/vehicleFile/OverviewTab";
import DocumentsTab from "@/components/vehicleFile/DocumentsTab";
import GetReadyTab from "@/components/vehicleFile/GetReadyTab";
import CustomerTab from "@/components/vehicleFile/CustomerTab";
import ComplianceTab from "@/components/vehicleFile/ComplianceTab";
import {
  readinessLabel, readinessSummary, resolveTab, type TabId, type VehicleRow,
} from "@/components/vehicleFile/types";

// ──────────────────────────────────────────────────────────────
// VehicleFile — /vehicle-file/:id
//
// The employee view of one vehicle, in five tabs:
//   Overview · Documents · Get Ready · Customer · Compliance
//
// The vehicle_listings row is the record; every child artifact refers to it
// by id. Lifecycle truth comes from the stored vehicle_lifecycle row, and
// readiness from the one readiness model in components/vehicleFile/types.
// ──────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: typeof Car }[] = [
  { id: "overview", label: "Overview", icon: Car },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "getready", label: "Get Ready", icon: Wrench },
  { id: "customer", label: "Customer", icon: UserRound },
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
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
      <div className="p-8 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (notFound || !vehicle) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3">
        <Car className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-al-section text-foreground">Vehicle not found</h2>
        <p className="text-al-body text-muted-foreground">
          This file may have been archived, or your tenant does not have access to it.
        </p>
        <button
          onClick={() => navigate("/inventory")}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-al-body font-semibold inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to inventory
        </button>
      </div>
    );
  }

  const ready = readinessSummary(vehicle, recall);
  const readiness = readinessLabel(ready);
  const gallery = listingGallery(vehicle);
  const safeImg = gallery.length ? Math.min(imgIdx, gallery.length - 1) : 0;
  const stockNo = vehicleStockNumber(vehicle);
  const published = vehicle.status === "published";
  const stageLabel = !lifecycle.tracked
    ? "No get-ready lifecycle (new stock)"
    : lifecycle.loading
      ? "Reading lifecycle…"
      : lifecycle.row
        ? STATE_LABEL[lifecycle.row.state]
        : "No lifecycle record yet";

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

  const chip = (label: string, value: string, tone: "neutral" | "good" | "warn") => (
    <div className={`rounded-xl border px-3 py-2 min-w-0 ${
      tone === "good" ? "border-emerald-200 bg-emerald-50"
        : tone === "warn" ? "border-amber-200 bg-amber-50"
        : "border-border bg-muted/40"
    }`}>
      <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-al-body font-semibold truncate ${
        tone === "good" ? "text-emerald-800" : tone === "warn" ? "text-amber-800" : "text-foreground"
      }`}>{value}</p>
    </div>
  );

  return (
    <div className="p-4 lg:px-7 lg:py-6 max-w-[1500px] mx-auto space-y-5 pb-24 lg:pb-8">
      <button
        onClick={() => navigate("/inventory")}
        className="text-al-meta font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to inventory
      </button>

      <section className="rounded-2xl border border-border bg-card shadow-premium overflow-hidden">
        <div className="flex flex-col lg:flex-row gap-0 p-5 lg:p-6">
          <div className="lg:w-[320px] shrink-0">
            <div className="h-56 lg:h-[230px] rounded-2xl overflow-hidden bg-muted flex items-center justify-center">
              {gallery.length ? (
                <div className="relative w-full h-full">
                  <img src={gallery[safeImg]} alt={vehicle.ymm || "vehicle"} className="w-full h-full object-cover" />
                  {gallery.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setImgIdx((i) => (i - 1 + gallery.length) % gallery.length)}
                        aria-label="Previous photo"
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-foreground/50 text-background flex items-center justify-center"
                      ><ArrowLeft className="w-4 h-4" /></button>
                      <button
                        type="button"
                        onClick={() => setImgIdx((i) => (i + 1) % gallery.length)}
                        aria-label="Next photo"
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-foreground/50 text-background flex items-center justify-center"
                      ><ChevronRight className="w-4 h-4" /></button>
                      <span className="absolute bottom-2 left-2 text-al-meta font-semibold px-1.5 py-0.5 rounded bg-foreground/60 text-background tabular-nums">
                        {safeImg + 1} / {gallery.length}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <Car className="w-16 h-16 text-muted-foreground" strokeWidth={1.25} />
              )}
            </div>
          </div>

          <div className="flex-1 lg:pl-7 pt-5 lg:pt-0 min-w-0 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
              <div className="min-w-0 flex-1 space-y-2">
                <span className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">
                  {vehicle.condition || "unknown"} · {vehicle.status}
                </span>
                <h1 className="text-al-page font-display text-foreground">
                  {vehicle.ymm || "Vehicle needs a VIN decode"}
                </h1>
                {vehicle.trim ? <p className="text-al-section text-muted-foreground font-normal">{vehicle.trim}</p> : null}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-al-body">
                  {/* The stock number is how the lot, the DMS and the desk all
                      refer to this car, so it is always stated — an absent one
                      says so rather than leaving a gap that reads as "this
                      screen has no stock number field". */}
                  {stockNo ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">Stock</span>
                      <span className="font-mono font-semibold text-foreground">{stockNo}</span>
                    </span>
                  ) : (
                    <span className="text-al-meta font-semibold text-amber-700">Stock # not on the feed</span>
                  )}
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">VIN</span>
                    <span className="font-mono text-foreground truncate">{vehicle.vin}</span>
                    <button onClick={copyVin} title="Copy VIN" aria-label="Copy VIN" className="text-muted-foreground hover:text-foreground shrink-0">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Gauge className="w-4 h-4" />
                    {vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : "Mileage not recorded"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    {vehicle.price != null ? `$${vehicle.price.toLocaleString()}` : "Not priced"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 w-full lg:w-[240px] shrink-0">
                {published ? (
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-11 px-4 rounded-xl bg-primary hover:opacity-90 text-primary-foreground text-al-body font-semibold inline-flex items-center justify-center gap-2 transition-opacity"
                  >
                    <ExternalLink className="w-4 h-4" /> View shopper page
                  </a>
                ) : (
                  <button
                    onClick={publish}
                    disabled={publishing}
                    className="h-11 px-4 rounded-xl bg-primary hover:opacity-90 text-primary-foreground text-al-body font-semibold inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                  >
                    <Globe className="w-4 h-4" /> {publishing ? "Publishing…" : "Publish to shopper portal"}
                  </button>
                )}
                <button
                  onClick={() => setTab("documents")}
                  className="h-11 px-4 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-al-body font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <FolderCheck className="w-4 h-4" /> Generate document
                </button>
                <button
                  onClick={copyLink}
                  className="h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-al-meta font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy shopper link
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {chip("Lifecycle stage", stageLabel, "neutral")}
              {chip("Retail readiness", readiness.label, readiness.ready ? "good" : "warn")}
              {chip("Digital status", published ? "Live on the shopper portal" : vehicle.status === "archived" ? "Archived" : "Draft — not published", published ? "good" : "warn")}
            </div>
          </div>
        </div>
      </section>

      <div className="border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`px-4 py-3.5 text-al-body font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-2">
        {tab === "overview" && <OverviewTab vehicle={vehicle} ready={ready} lifecycle={lifecycle} stockNumber={vehicleStockNumber(vehicle)} onTab={setTab} onReload={load} />}
        {tab === "documents" && <DocumentsTab vehicle={vehicle} onReload={load} />}
        {tab === "getready" && <GetReadyTab vehicle={vehicle} lifecycle={lifecycle} />}
        {tab === "customer" && <CustomerTab vehicle={vehicle} stockNumber={vehicleStockNumber(vehicle)} />}
        {tab === "compliance" && <ComplianceTab vehicle={vehicle} ready={ready} recall={recall} onReload={load} />}
      </div>

      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card px-4 py-3 space-y-2">
        {published ? (
          <div className="flex gap-2">
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-al-body font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="w-4 h-4" /> View shopper page
            </a>
            <button
              onClick={copyLink}
              aria-label="Copy shopper link"
              className="h-11 px-4 rounded-xl border border-border bg-card text-foreground inline-flex items-center justify-center"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={publish}
            disabled={publishing}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-al-body font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Globe className="w-4 h-4" /> {publishing ? "Publishing…" : "Publish to shopper portal"}
          </button>
        )}
      </div>
    </div>
  );
};

export default VehicleFile;

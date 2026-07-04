import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import {
  ArrowLeft, Car, FileText, Wrench, Tag, Signature, Globe,
  CheckCircle2, Clock, Gauge, DollarSign, MapPin, Copy, ExternalLink,
  FileUp, Upload, Printer, Sparkles, Plus, ArrowUpRight,
  AlertTriangle, ShieldCheck, Lock, Unlock, Send, MessageSquare,
  Link as LinkIcon, X, QrCode, Trash2, Save, ShieldAlert, UserRound, Users,
  ChevronRight, CircleAlert, Activity, RefreshCw,
} from "lucide-react";
import { formatPhone, composeName } from "@/components/addendum/CustomerInfoSection";
import EmptyState from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InstallProofList } from "@/components/admin/InstallProofList";
import { useRecallTask, OUTCOME_LABELS, type RecallOutcome } from "@/hooks/useRecallTask";
import { listingGallery, listingHero } from "@/lib/photos";
import { PACKET_MODULES, packetVisible } from "@/lib/packetModules";
import { resolveOperatingState } from "@/lib/dealerState";
import { QRCodeSVG } from "qrcode.react";
import GeneratedDocumentsSection from "@/components/vehicle/GeneratedDocumentsSection";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import {
  LABEL_BUILDERS, slotFor, conditionOf, resolveLabelDefault, labelRefPath,
  type LabelKind,
} from "@/lib/labelDefaults";
import UsedCarDocPack from "@/components/vehicle/UsedCarDocPack";
import DeliverySignoffs from "@/components/vehicle/DeliverySignoffs";
import TitleMcoPanel from "@/components/vehicle/TitleMcoPanel";
import VehicleEvidenceTimeline from "@/components/vehicle/VehicleEvidenceTimeline";

// ──────────────────────────────────────────────────────────────
// VehicleFile — /vehicle-file/:id
//
// The single canonical per-vehicle workspace. Every downstream tool
// is scoped here: documents (factory sticker, Carfax, brochures),
// addendum build, prep / foreman sign-off, label generation,
// customer signing. The vehicle_listings row is the record; every
// child artifact refers to it by id.
// ──────────────────────────────────────────────────────────────

type TabId = "overview" | "documents" | "scan" | "customer" | "addendum" | "prep" | "labels" | "sign" | "evidence";

interface PersonInfo {
  first_name?: string; middle_initial?: string; last_name?: string; suffix?: string;
  address?: string; city?: string; state?: string; zip?: string;
  phone?: string; email?: string;
}
interface CustomerInfoBag { buyer?: PersonInfo; cobuyer?: PersonInfo }

interface ServiceRecord { date: string; mileage: string; type: string; notes: string }
interface WarrantyInfo {
  factory_months?: number; factory_miles?: number;
  powertrain_months?: number; powertrain_miles?: number;
  in_service_date?: string; notes?: string;
}
interface AvailableAccessory { name: string; price: string; note: string }

interface VehicleRow {
  id: string;
  tenant_id: string | null;
  vin: string;
  slug: string;
  source_url: string | null;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number;
  sticker_snapshot: Record<string, unknown>;
  dealer_snapshot: Record<string, unknown>;
  documents: Array<{ name: string; url: string; type: string }>;
  videos: Array<{ id: string; url: string; caption?: string }>;
  prep_status: { all_accessories_installed?: boolean; foreman_signed_at?: string } | null;
  recall_check: Record<string, unknown> | null;
  vehicle_file_id: string | null;
  service_records: ServiceRecord[] | null;
  warranty_info: WarrantyInfo | null;
  available_accessories: AvailableAccessory[] | null;
  hero_image_url: string | null;
  photos: string[] | null;
  mc_attributes: Record<string, unknown> | null;
  packet_modules: Record<string, boolean> | null;
  recall_status: string | null;
  recall_checked_at: string | null;
  open_recall_count: number | null;
  recall_payload: { recalls?: RecallItem[]; campaigns?: Record<string, unknown>[] } | null;
  market_value: number | null;
  market_position: string | null;
  market_payload: { listingPrice?: number | null; low?: number | null; high?: number | null; belowMarket?: number } | null;
  enriched_at: string | null;
  market_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RecallItem { title?: string; summary?: string; description?: string; consequence?: string; component?: string; reportDate?: string; remedy?: string; status?: string; nhtsaCampaignNumber?: string; }

// The recall detail list is written under two shapes: `recalls` (marketcheck-
// recalls / NHTSA fallback) and `campaigns` (vehicle-enrich). Read either, and
// map the campaign field names so the card never shows a blank list.
const normalizeRecalls = (p: { recalls?: RecallItem[]; campaigns?: Record<string, unknown>[] } | null): RecallItem[] => {
  if (Array.isArray(p?.recalls) && p!.recalls!.length) return p!.recalls!;
  const c = p?.campaigns;
  if (Array.isArray(c)) return c.map((r) => ({
    title: String(r.title ?? r.summary ?? r.component ?? "Recall"),
    summary: r.summary != null ? String(r.summary) : undefined,
    consequence: r.consequence != null ? String(r.consequence) : undefined,
    component: r.component != null ? String(r.component) : undefined,
    reportDate: (r.reportDate ?? r.report_date) != null ? String(r.reportDate ?? r.report_date) : undefined,
    remedy: r.remedy != null ? String(r.remedy) : undefined,
    nhtsaCampaignNumber: (r.nhtsaCampaignNumber ?? r.campaign ?? r.campaignId) != null ? String(r.nhtsaCampaignNumber ?? r.campaign ?? r.campaignId) : undefined,
  }));
  return [];
};

const VALID_TABS: TabId[] = ["overview", "documents", "scan", "customer", "addendum", "prep", "labels", "sign", "evidence"];

interface ReadyCheck { ok: boolean; label: string; when: string | null; blocks?: boolean }

// Single readiness model used by both the header banner and the Overview
// readiness card, so the two never disagree. `blocks` marks a check that
// gates publishing to the shopper portal.
interface RecallReviewState { task: { completed_at: string | null } | null; blocking: boolean }

const buildChecks = (v: VehicleRow, recall?: RecallReviewState): ReadyCheck[] => {
  const checks: ReadyCheck[] = [
    { ok: true, label: "Vehicle created", when: v.created_at },
    { ok: !!v.ymm, label: "VIN decoded", when: v.ymm ? v.updated_at : null },
    { ok: v.status === "published", label: "Published to shopper portal", when: v.published_at, blocks: true },
    { ok: !!(v.recall_status || v.recall_check), label: "Recall checked", when: v.recall_checked_at },
    { ok: !!v.prep_status?.foreman_signed_at, label: "Prep & install signed off", when: v.prep_status?.foreman_signed_at || null },
    { ok: (v.documents?.length || 0) > 0, label: "Documents attached", when: null },
    { ok: (v.service_records?.length || 0) > 0, label: "Service history", when: null },
    { ok: !!v.warranty_info && Object.keys(v.warranty_info).length > 0, label: "Remaining warranty", when: null },
    { ok: (v.available_accessories?.length || 0) > 0, label: "Available accessories", when: null },
  ];
  // An open recall raises a required Service task that blocks publish until the
  // service department records an outcome. Inserted right after "Recall checked".
  if (recall?.task) {
    checks.splice(4, 0, {
      ok: !recall.blocking,
      label: "Open Recall Review Required",
      when: recall.task.completed_at,
      blocks: recall.blocking,
    });
  }
  return checks;
};

const readinessSummary = (v: VehicleRow, recall?: RecallReviewState) => {
  const checks = buildChecks(v, recall);
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  return { checks, done, pct, remaining: checks.filter((c) => !c.ok) };
};

const VehicleFile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const initialTab = (() => {
    const q = searchParams.get("tab");
    return q && (VALID_TABS as string[]).includes(q) ? (q as TabId) : "overview";
  })();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [imgIdx, setImgIdx] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [repulling, setRepulling] = useState(false);
  // Open-recall service task (auto-raised by a DB trigger on every recall pull).
  const recall = useRecallTask(vehicle?.vin, vehicle?.tenant_id);

  // Keep ?tab= in sync so deep-links + refreshes land on the same tab.
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
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Canonical Passport URL is /v/{VIN} — the same address the window-sticker
  // QR encodes — so the link the dealer copies always matches the printed QR.
  const publicUrl = useMemo(
    () => vehicle ? `${window.location.origin}/v/${(vehicle.vin || vehicle.slug || "").toUpperCase()}` : "",
    [vehicle]
  );
  // The dealer's actual ad/VDP page on their own website (captured from the
  // inventory feed); falls back to the AutoLabels shopper page.
  const adUrl = useMemo(
    () => (vehicle?.source_url && /^https?:\/\//i.test(vehicle.source_url)) ? vehicle.source_url : "",
    [vehicle]
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
        <Car className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <h2 className="text-lg font-bold text-foreground">Vehicle not found</h2>
        <p className="text-sm text-muted-foreground">
          This file may have been archived, or your tenant doesn't have access.
        </p>
        <button
          onClick={() => navigate("/inventory")}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to inventory
        </button>
      </div>
    );
  }

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
    if (!vehicle) return;
    try {
      await navigator.clipboard.writeText(vehicle.vin);
      toast.success("VIN copied");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const publish = async () => {
    if (!vehicle) return;
    // Open recall must be reviewed by service before publish.
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
        toast.success("Vehicle published to shopper portal");
        return;
      }
      const msg = String(error.message || "");
      if (msg.includes("prep_gate_blocked")) {
        toast.error("Prep sign-off required — complete the Prep tab first.");
      } else if (msg.includes("recall_gate_blocked")) {
        toast.error("NHTSA recall check missing or stale — run recall check first.");
      } else {
        toast.error(msg || "Publish failed");
      }
    } finally {
      setPublishing(false);
    }
  };

  // Re-pull this VIN's MarketCheck enrichment (value, comps, days-supply,
  // recalls, VIN history, Black Book) on demand. On success the row's
  // enriched_at updates, so the "Last synced" stamp reflects the new run.
  const repullMarket = async () => {
    if (!vehicle?.vin || !vehicle.tenant_id) {
      toast.error("Vehicle needs a VIN and tenant before it can sync");
      return;
    }
    setRepulling(true);
    try {
      const { data, error } = await supabase.functions.invoke("vehicle-enrich", {
        body: { tenant_id: vehicle.tenant_id, vin: vehicle.vin },
      });
      if (error) { toast.error("Re-pull failed — check the MarketCheck key"); return; }
      const pulled = (data as { pulled?: Record<string, unknown> })?.pulled;
      const got = pulled ? Object.entries(pulled).filter(([, v]) => v && v !== 0).map(([k]) => k.replace(/_/g, " ")) : [];
      await load();
      toast.success(got.length ? `Synced: ${got.join(", ")}` : "Sync complete — no new data available");
    } finally {
      setRepulling(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof Car; count?: number }[] = [
    { id: "overview",  label: "Overview",  icon: Car },
    { id: "documents", label: "Documents", icon: FileUp, count: vehicle.documents?.length || undefined },
    { id: "scan",      label: "Scan Info", icon: QrCode },
    { id: "customer",  label: "Customer",  icon: UserRound },
    { id: "addendum",  label: "Addendum",  icon: FileText },
    { id: "prep",      label: "Prep & Install", icon: Wrench },
    { id: "labels",    label: "Labels",    icon: Tag },
    { id: "sign",      label: "Customer Sign-off", icon: Signature },
    { id: "evidence",  label: "Evidence",  icon: Activity },
  ];

  const heroMc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
  const stockNo = (heroMc.stock_no as string) || ((vehicle.sticker_snapshot?.decoded as Record<string, unknown> | undefined)?.stock as string) || null;
  const gallery: string[] = listingGallery(vehicle);
  const safeImg = gallery.length ? Math.min(imgIdx, gallery.length - 1) : 0;

  return (
    <div className="p-4 lg:px-7 lg:py-6 max-w-[1500px] mx-auto space-y-5 pb-24 lg:pb-8">
      {/* Hero / header */}
      <div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/inventory")}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Inventory
          </button>
          {(adUrl || vehicle.status === "published") && (
            <div className="hidden lg:flex items-center gap-2">
              <a
                href={adUrl || publicUrl}
                target="_blank"
                rel="noreferrer"
                title={adUrl ? "Open this vehicle's ad on the dealership website" : "Open the shopper page"}
                className="h-9 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> {adUrl ? "View ad on website" : "Open in new tab"}
              </a>
            </div>
          )}
        </div>

        <div className="mt-3 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex flex-col lg:flex-row gap-0 p-5 lg:p-6">
            {/* Vehicle photo + thumbnail strip */}
            <div className="lg:w-[340px] shrink-0">
              <div className={`h-56 lg:h-[248px] rounded-2xl overflow-hidden flex items-center justify-center bg-gradient-to-br ${
                vehicle.condition === "new" ? "from-blue-500/15 to-blue-600/5 text-blue-600" :
                vehicle.condition === "cpo" ? "from-violet-500/15 to-violet-600/5 text-violet-600" :
                "from-slate-400/15 to-slate-500/5 text-slate-500"
              }`}>
                {gallery.length ? (
                  <div className="relative w-full h-full rounded-2xl overflow-hidden">
                    <img src={gallery[safeImg]} alt={vehicle.ymm || "vehicle"} className="w-full h-full object-cover" />
                    {gallery.length > 1 && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setImgIdx((safeImg - 1 + gallery.length) % gallery.length); }} aria-label="Previous photo" className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65 transition-colors"><ArrowLeft className="w-4 h-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); setImgIdx((safeImg + 1) % gallery.length); }} aria-label="Next photo" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/55 text-white tabular-nums">{safeImg + 1} / {gallery.length}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <Car className="w-16 h-16" strokeWidth={1.25} />
                )}
              </div>
              {gallery.length > 1 && (
                <div className="hidden lg:flex items-center gap-1.5 mt-2">
                  {gallery.slice(0, 6).map((src, i) => (
                    <button key={src + i} onClick={() => setImgIdx(i)} aria-label={`Photo ${i + 1}`} className={`w-[50px] h-9 rounded-lg overflow-hidden border-2 transition-colors ${i === safeImg ? "border-blue-600" : "border-transparent hover:border-border"}`}>
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 lg:pl-8 pt-5 lg:pt-0 min-w-0 flex flex-col">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      vehicle.condition === "new" ? "bg-blue-100 text-blue-700" :
                      vehicle.condition === "cpo" ? "bg-emerald-100 text-emerald-700" :
                      "bg-slate-100 text-slate-700"
                    }`}>{vehicle.condition || "unknown"}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      vehicle.status === "published" ? "bg-emerald-100 text-emerald-700" :
                      vehicle.status === "archived" ? "bg-slate-100 text-slate-500" :
                      "bg-amber-100 text-amber-700"
                    }`}>{vehicle.status}</span>
                  </div>
                  <h1 className="text-[32px] sm:text-[42px] lg:text-[48px] font-black tracking-[-0.02em] font-display text-foreground leading-[1]">
                    {vehicle.ymm || "(needs VIN decode)"}
                  </h1>
                  {vehicle.trim ? <p className="text-2xl text-slate-600 font-normal leading-tight">{vehicle.trim}</p> : null}
                  {/* Stock + VIN, one row, with copy */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm pt-0.5">
                    {stockNo && (
                      <span className="text-muted-foreground"><span className="font-semibold text-foreground">Stock #</span> {stockNo}</span>
                    )}
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-foreground">VIN</span>
                      <span className="font-mono text-muted-foreground truncate">{vehicle.vin}</span>
                      <button onClick={copyVin} title="Copy VIN" aria-label="Copy VIN" className="text-muted-foreground hover:text-foreground shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                  {/* Mileage / price / created */}
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-1.5 text-sm text-muted-foreground">
                    {typeof vehicle.mileage === "number" && (
                      <span className="inline-flex items-center gap-1.5"><Gauge className="w-4 h-4" /> {vehicle.mileage.toLocaleString()} mi</span>
                    )}
                    {typeof vehicle.price === "number" && (
                      <span className="inline-flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> ${vehicle.price.toLocaleString()}</span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      Created {new Date(vehicle.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {/* MarketCheck sync state + on-demand re-pull for this VIN.
                      enriched_at updates after a successful pull, so the stamp
                      always reflects the most recent sync's date and time. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm pt-1">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Activity className="w-4 h-4" />
                      {vehicle.enriched_at
                        ? <>Last synced <span className="font-semibold text-foreground">{new Date(vehicle.enriched_at).toLocaleString()}</span></>
                        : <span className="text-amber-600 font-medium">Not yet synced from MarketCheck</span>}
                    </span>
                    <button
                      onClick={repullMarket}
                      disabled={repulling || !vehicle.vin}
                      title="Re-pull market value, comparables, days-supply, recalls, VIN history and Black Book for this VIN"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-background hover:bg-muted text-[12px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${repulling ? "animate-spin" : ""}`} />
                      {repulling ? "Syncing…" : "Re-pull market data"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 w-full lg:w-[260px] shrink-0">
                  {vehicle.status === "published" ? (
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="h-12 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm shadow-blue-600/30 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View Shopper Page
                    </a>
                  ) : (
                    <button
                      onClick={() => setTab("labels")}
                      className="h-12 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm shadow-blue-600/30 transition-colors"
                    >
                      <Printer className="w-4 h-4" />
                      Generate Sticker
                    </button>
                  )}
                  {/* Secondary actions collapsed behind one "More actions"
                      control so the hero stack stays two buttons tall. */}
                  <details className="relative [&_summary::-webkit-details-marker]:hidden">
                    <summary className="list-none h-12 px-4 rounded-xl border border-border bg-background hover:bg-muted text-foreground text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors w-full">
                      <Plus className="w-4 h-4 rotate-45" /> More actions
                    </summary>
                    <div className="absolute right-0 mt-2 w-full rounded-xl border border-border bg-card shadow-lg z-20 p-1.5 space-y-0.5">
                      {vehicle.status === "published" ? (
                        <>
                          <button onClick={copyLink} className="w-full text-left text-sm px-3 h-9 rounded-lg hover:bg-muted inline-flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Copy link</button>
                          <a href={publicUrl} target="_blank" rel="noreferrer" className="w-full text-left text-sm px-3 h-9 rounded-lg hover:bg-muted inline-flex items-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> Open in new tab</a>
                          <button onClick={() => setTab("labels")} className="w-full text-left text-sm px-3 h-9 rounded-lg hover:bg-muted inline-flex items-center gap-2"><Printer className="w-3.5 h-3.5" /> Generate sticker</button>
                        </>
                      ) : (
                        <>
                          <button onClick={publish} disabled={publishing} className="w-full text-left text-sm px-3 h-9 rounded-lg hover:bg-muted inline-flex items-center gap-2 disabled:opacity-60">
                            {publishing
                              ? <div className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                              : <Globe className="w-3.5 h-3.5" />}
                            Publish to Shopper Portal
                          </button>
                          <button onClick={copyLink} className="w-full text-left text-sm px-3 h-9 rounded-lg hover:bg-muted inline-flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Copy link</button>
                        </>
                      )}
                    </div>
                  </details>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Tabs — underline style */}
      <div className="border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto -mb-px">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3.5 text-sm font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className={`w-4 h-4 ${active ? "" : "opacity-70"}`} />
                {t.label}
                {typeof t.count === "number" && (
                  <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold inline-flex items-center justify-center tabular-nums ${
                    active ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                  }`}>{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels */}
      <div className="pt-2">
        {tab === "overview"  && <OverviewPanel vehicle={vehicle} onTab={setTab} recall={recall} />}
        {tab === "documents" && <DocumentsPanel vehicle={vehicle} onReload={load} />}
        {tab === "scan"      && <ScanInfoPanel vehicle={vehicle} onReload={load} />}
        {tab === "customer"  && <CustomerPanel vehicle={vehicle} />}
        {tab === "addendum"  && <AddendumPanel vehicle={vehicle} />}
        {tab === "prep"      && <PrepPanel vehicle={vehicle} />}
        {tab === "labels"    && <LabelsPanel vehicle={vehicle} />}
        {tab === "sign"      && <SignPanel vehicle={vehicle} />}
        {tab === "evidence"  && (
          <VehicleEvidenceTimeline
            vehicleId={vehicle.id}
            vin={vehicle.vin}
            tenantId={vehicle.tenant_id}
            vehicleTitle={vehicle.ymm || vehicle.vin}
          />
        )}
      </div>

      {/* Mobile sticky action bar — thumb-friendly primary actions. */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur px-4 py-3 space-y-2 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {vehicle.status === "published" ? (
          <div className="flex gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm shadow-blue-600/30"
            >
              <ExternalLink className="w-4 h-4" />
              View Shopper Page
            </a>
            <button
              onClick={copyLink}
              className="h-11 px-4 rounded-xl border border-border bg-background text-foreground text-sm font-semibold inline-flex items-center justify-center"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setTab("labels")}
              className="w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm shadow-blue-600/30"
            >
              <Printer className="w-4 h-4" />
              Generate Sticker
            </button>
            <button
              onClick={() => setTab("labels")}
              className="w-full h-11 rounded-xl border border-border bg-background text-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Globe className="w-4 h-4" />
              Publish to Shopper Portal
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface AuditEvent {
  id: string;
  action: string;
  created_at: string;
  user_email: string | null;
  details: Record<string, unknown> | null;
  entity_type: string;
}

const PRETTY_ACTION: Record<string, string> = {
  listing_viewed: "Shopper viewed the page",
  listing_published: "Published to shopper portal",
  addendum_signed: "Customer signed the addendum",
  addendum_viewed: "Addendum opened by customer",
  addendum_consent_given: "Customer accepted E-SIGN consent",
  deal_signed: "Deal jacket signed",
  document_archived: "Signed document archived",
  vdp_scraped: "VDP scraped from dealer site",
  prep_sign_off_signed: "Foreman signed off on prep",
  recall_checked: "NHTSA recall lookup ran",
};

const prettyAction = (a: string) =>
  PRETTY_ACTION[a] || a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "Today, 1:32 PM" for same-day timestamps, short date+time otherwise.
const fmtWhen = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// Label/value row shared by the snapshot status cards.
const StatRow = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "emerald" | "amber" | "muted" }) => (
  <div className="flex items-center justify-between gap-3 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className={`font-semibold text-right tabular-nums ${tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
  </div>
);

const snapBtn = "h-9 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50";
const snapBtnPrimary = "h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50";

const OverviewPanel = ({ vehicle, onTab, recall }: { vehicle: VehicleRow; onTab: (t: TabId) => void; recall: ReturnType<typeof useRecallTask> }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEvents(true);
      try {
        // Audit rows for this vehicle can match by entity_id (vehicle_listing)
        // OR by details->>vin (addendum / deal / archive paths) OR by the
        // slug (listing_viewed events). Pull them all in one OR query.
        const { data } = await (supabase as any)
          .from("audit_log")
          .select("id,action,created_at,user_email,details,entity_type")
          .or(
            `entity_id.eq.${vehicle.id},details->>vin.eq.${vehicle.vin},details->>slug.eq.${vehicle.slug}`
          )
          .order("created_at", { ascending: false })
          .limit(80);
        if (!cancelled) setEvents((data || []) as AuditEvent[]);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.id, vehicle.vin, vehicle.slug]);

  const { checks, pct, remaining } = readinessSummary(vehicle, recall);
  const notReady = pct < 100;
  const ringColor = notReady ? "#F59E0B" : "#10B981";
  const publicUrl = `${window.location.origin}/v/${(vehicle.vin || vehicle.slug || "").toUpperCase()}`;
  const published = vehicle.status === "published";
  const mc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
  const stockNo = (mc.stock_no as string) || ((vehicle.sticker_snapshot?.decoded as Record<string, unknown> | undefined)?.stock as string) || null;
  const sourceLabel = (() => { const v = mc.source ?? mc.seller_type ?? mc.inventory_type; return v ? String(v).toUpperCase() : null; })();
  const lastShopperView = events.find((e) => e.action === "listing_viewed")?.created_at || null;

  // "Vehicle created" is always true — noise in a task list.
  const taskChecks = checks.filter((c) => c.label !== "Vehicle created");
  const shownChecks = taskChecks.slice(0, 6);
  const moreCount = taskChecks.length - shownChecks.length;

  const copyPortalLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl); toast.success("Link copied"); }
    catch { toast.error("Couldn't copy the link"); }
  };
  const copyVinLocal = async () => {
    try { await navigator.clipboard.writeText(vehicle.vin); toast.success("VIN copied"); }
    catch { toast.error("Couldn't copy the VIN"); }
  };

  const quick: { label: string; icon: typeof Car; tone: string; onClick: () => void }[] = [
    { label: "Generate Sticker", icon: Printer, tone: "bg-indigo-50 text-indigo-600", onClick: () => onTab("labels") },
    { label: "Create Addendum", icon: FileText, tone: "bg-violet-50 text-violet-600", onClick: () => onTab("addendum") },
    { label: "Upload Documents", icon: Upload, tone: "bg-slate-100 text-slate-600", onClick: () => onTab("documents") },
    { label: "Customer Sign-off", icon: Signature, tone: "bg-fuchsia-50 text-fuchsia-600", onClick: () => onTab("sign") },
    // Only open the public passport when it actually exists — an unpublished
    // vehicle's /v/{vin} renders "Vehicle unavailable", so route drafts to the
    // publish flow instead of a blank page.
    published
      ? { label: "Open Shopper Portal", icon: ExternalLink, tone: "bg-blue-50 text-blue-600", onClick: () => window.open(publicUrl, "_blank", "noopener") }
      : { label: "Publish to Go Live", icon: Globe, tone: "bg-blue-50 text-blue-600", onClick: () => onTab("labels") },
  ];

  // Compact reference pairs for the Vehicle Information card.
  const infoPairs: { label: string; value: React.ReactNode }[] = [
    { label: "VIN", value: <span className="font-mono text-[12px]">{vehicle.vin}</span> },
    { label: "Year / Make / Model / Trim", value: `${vehicle.ymm || "—"}${vehicle.trim ? ` ${vehicle.trim}` : ""}` },
    ...(stockNo ? [{ label: "Stock #", value: stockNo }] : []),
    { label: "Created", value: new Date(vehicle.created_at).toLocaleDateString() },
    ...(vehicle.mileage != null ? [{ label: "Mileage", value: `${vehicle.mileage.toLocaleString()} mi` }] : []),
    { label: "Last sync", value: vehicle.enriched_at ? new Date(vehicle.enriched_at).toLocaleString(undefined, { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Not synced" },
    ...(vehicle.price != null ? [{ label: "Price", value: `$${vehicle.price.toLocaleString()}` }] : []),
    ...(sourceLabel ? [{ label: "Source", value: sourceLabel }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[20px] font-bold tracking-tight text-foreground">Vehicle Health Snapshot</h2>
        <p className="text-sm text-slate-500 mt-0.5">Operational status, shopper readiness, pricing intelligence, and missing items for this vehicle.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        {/* 1 — Packet Completeness (the anchor card) */}
        <Card title="Packet Completeness" className="flex flex-col" action={
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${notReady ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{pct}% · {notReady ? "Not ready" : "Ready"}</span>
        }>
          <div className="flex items-start gap-5 flex-1">
            <div className="flex flex-col items-center shrink-0">
              <div className="relative w-[104px] h-[104px]">
                <svg className="w-[104px] h-[104px] -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke={ringColor} strokeWidth="10" strokeLinecap="round" strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-700" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-display text-[26px] font-black tabular-nums text-foreground leading-none">{pct}%</span>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground mt-2">{remaining.length} task{remaining.length === 1 ? "" : "s"} remaining</span>
            </div>
            <ul className="flex-1 space-y-2 min-w-0 pt-0.5">
              {shownChecks.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-xs min-w-0">
                  {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <CircleAlert className="w-4 h-4 text-amber-500 shrink-0" />}
                  <span className={`truncate ${c.ok ? "text-foreground font-medium" : "text-amber-700 font-medium"}`}>{c.label}</span>
                </li>
              ))}
              {moreCount > 0 && <li className="text-[11px] font-semibold text-muted-foreground pl-6">+{moreCount} more</li>}
            </ul>
          </div>
          <button onClick={() => onTab("labels")} className="mt-auto pt-1 text-[12px] font-semibold text-blue-600 hover:underline inline-flex items-center justify-center gap-1 w-full">View missing items <ChevronRight className="w-3.5 h-3.5" /></button>
        </Card>

        {/* 2 — Shopper Portal status */}
        <Card title="Shopper Portal" className="flex flex-col" action={
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{published ? "Live" : "Draft"}</span>
        }>
          <div className="space-y-2.5 flex-1">
            <StatRow label="Published on" value={vehicle.published_at ? new Date(vehicle.published_at).toLocaleDateString() : "Not published"} tone={vehicle.published_at ? undefined : "muted"} />
            <StatRow label="Last shopper view" value={fmtWhen(lastShopperView) ?? "No views yet"} tone={lastShopperView ? undefined : "muted"} />
            <StatRow label="Passport URL" value={published ? "Live" : "Not live"} tone={published ? "emerald" : "amber"} />
            <StatRow label="QR / Preview" value="Available" />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto pt-1">
            {published
              ? <a href={publicUrl} target="_blank" rel="noreferrer" className={snapBtn}><ExternalLink className="w-3.5 h-3.5" /> View shopper page</a>
              : <button onClick={() => onTab("labels")} className={snapBtnPrimary}><Globe className="w-3.5 h-3.5" /> Publish vehicle</button>}
            <button onClick={copyPortalLink} className={snapBtn}><Copy className="w-3.5 h-3.5" /> Copy link</button>
          </div>
        </Card>

        {/* 3 — Recall Status */}
        <RecallCard vehicle={vehicle} recall={recall} />

        {/* 4 — Vehicle Information (reference only) */}
        <Card title="Vehicle Information" className="flex flex-col">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 flex-1">
            {infoPairs.map((p) => (
              <div key={p.label} className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{p.label}</p>
                <p className="text-[13px] font-semibold text-foreground truncate mt-0.5">{p.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto pt-1">
            <button onClick={() => onTab("scan")} className={snapBtn}><FileText className="w-3.5 h-3.5" /> Edit vehicle</button>
            <button onClick={copyVinLocal} className={snapBtn}><Copy className="w-3.5 h-3.5" /> Copy VIN</button>
          </div>
        </Card>

        {/* 5 — Market Pricing */}
        <MarketPricingCard vehicle={vehicle} />

        {/* 6 — Shopper Focus */}
        <ShopperFocusCard vehicle={vehicle} onTab={onTab} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activity Feed */}
        <Card title="Activity Feed" action={<button onClick={() => onTab("evidence")} className="text-[11px] font-semibold text-blue-600 hover:underline">View all</button>}>
          {loadingEvents ? (
            <p className="text-xs text-muted-foreground">Loading events…</p>
          ) : (
            <ul className="max-h-72 overflow-auto -my-1">
              {events.slice(0, 6).map((ev) => {
                const v = eventVisual(ev.action);
                const Icon = v.icon;
                return (
                <li key={ev.id} className="grid grid-cols-[32px_1fr_auto] items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${v.cls}`}><Icon className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight truncate">{prettyAction(ev.action)}</p>
                    {ev.user_email && <p className="text-[11px] text-muted-foreground truncate">by {ev.user_email}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap pt-1">{new Date(ev.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </li>
                );
              })}
              {remaining.map((c) => (
                <li key={`req-${c.label}`} className="grid grid-cols-[32px_1fr_auto] items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
                  <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><AlertTriangle className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight truncate">{c.label}</p>
                    <p className="text-[11px] text-amber-600">Action required</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground pt-1">—</span>
                </li>
              ))}
              {events.length === 0 && remaining.length === 0 && (
                <li className="text-xs text-muted-foreground py-2">No activity yet.</li>
              )}
            </ul>
          )}
        </Card>

        {/* Quick Actions */}
        <Card title="Quick Actions">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quick.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="group w-full flex items-center gap-3 px-3 h-12 rounded-xl border border-border/70 bg-card hover:bg-muted/60 hover:border-foreground/15 text-sm font-semibold text-foreground transition-colors text-left"
              >
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${a.tone}`}>
                  <a.icon className="w-4 h-4" />
                </span>
                <span className="flex-1">{a.label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// Per-state used-car safety inspection form, by the dealer's operating
// state. Falls back to a generic label for states without a named form.
const SAFETY_FORM: Record<string, { label: string; desc: string }> = {
  CT: { label: "CT K-208 safety inspection", desc: "Connecticut used-car safety inspection (Form K-208)." },
  NY: { label: "NY safety & emissions inspection", desc: "New York State inspection certificate (safety + anti-theft)." },
  PA: { label: "PA safety inspection", desc: "Pennsylvania safety inspection certificate." },
  NJ: { label: "NJ inspection", desc: "New Jersey inspection certificate." },
  TX: { label: "Texas vehicle inspection", desc: "Texas vehicle inspection report." },
  MA: { label: "MA safety inspection", desc: "Massachusetts safety/emissions inspection." },
  VA: { label: "VA safety inspection", desc: "Virginia safety inspection certificate." },
  ME: { label: "ME safety inspection", desc: "Maine safety inspection certificate." },
  RI: { label: "RI safety & emissions inspection", desc: "Rhode Island inspection certificate." },
  MO: { label: "MO safety inspection", desc: "Missouri safety inspection certificate." },
};

// Shared tab header — every vehicle-file tab opens with the same
// title / description / primary-action row so the panels read as one
// design system.
const TabHeader = ({ title, description, action }: { title: string; description: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h2 className="text-[22px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="text-sm text-slate-500 mt-1 max-w-xl">{description}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

const DocumentsPanel = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [uploading, setUploading] = useState<string | null>(null);
  const { settings } = useDealerSettings();
  const { currentStore } = useTenant();
  const opState = resolveOperatingState(settings, currentStore?.state);
  const safety = SAFETY_FORM[opState] || {
    label: "State safety inspection",
    desc: "State used-car safety inspection certificate where required.",
  };
  const [linkSlot, setLinkSlot] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // Attach an external link (digital brochure, Carfax URL, inspection
  // report) rather than a file. Appends to the same documents array the
  // customer QR page renders, so it shows up on /v/:slug immediately.
  const addLink = async (type: string) => {
    const raw = linkUrl.trim();
    if (!raw) { toast.error("Paste a link first"); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const next = [...(vehicle.documents || []), { name: linkName.trim() || url, type, url }];
    const { error } = await (supabase as any)
      .from("vehicle_listings")
      .update({ documents: next })
      .eq("id", vehicle.id);
    if (error) { toast.error("Failed to add link"); return; }
    setLinkSlot(null); setLinkName(""); setLinkUrl("");
    toast.success("Link added");
    onReload();
  };

  const removeDoc = async (doc: { name: string; url: string; type: string }) => {
    const next = (vehicle.documents || []).filter(
      (d) => !(d.name === doc.name && d.url === doc.url && d.type === doc.type),
    );
    const { error } = await (supabase as any)
      .from("vehicle_listings")
      .update({ documents: next })
      .eq("id", vehicle.id);
    if (error) { toast.error("Failed to remove"); return; }
    toast.success("Removed");
    onReload();
  };

  const upload = async (file: File, type: string) => {
    if (!vehicle.tenant_id) {
      toast.error("Vehicle has no tenant — re-save the vehicle file first");
      return;
    }
    setUploading(type);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${vehicle.tenant_id}/${vehicle.id}/${type}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("vehicle-docs")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) {
      // Try to auto-create the bucket once; ignore failures.
      await supabase.storage.createBucket("vehicle-docs", {
        public: false, fileSizeLimit: 25 * 1024 * 1024,
      }).catch(() => undefined);
      const retry = await supabase.storage
        .from("vehicle-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (retry.error) {
        toast.error(`Upload failed: ${retry.error.message}`);
        setUploading(null);
        return;
      }
    }
    const { data: signed } = await supabase.storage
      .from("vehicle-docs")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    const next = [...(vehicle.documents || []), {
      name: file.name, type, url: signed?.signedUrl || path,
    }];
    const { error: updErr } = await (supabase as any)
      .from("vehicle_listings")
      .update({ documents: next })
      .eq("id", vehicle.id);
    setUploading(null);
    if (updErr) {
      toast.error("Saved file, but failed to attach to vehicle row");
    } else {
      toast.success(`${type.replace(/_/g, " ")} attached`);
      onReload();
    }
  };

  // Used cars carry a full compliance document set; new cars a lighter one.
  // CPO and unknown-condition default to the used set (the safer superset).
  const isUsed = vehicle.condition !== "new";
  const slots: Array<{ type: string; label: string; desc: string }> = isUsed
    ? [
        { type: "factory_sticker", label: "OEM window sticker (Monroney)", desc: "Original factory window sticker PDF, image, or link — shows to shoppers in the packet." },
        { type: "buyers_guide", label: "FTC Buyers Guide (used)", desc: "Required used-car window form — As-Is vs warranty (16 CFR Part 455). Spanish where the sale is conducted in Spanish." },
        { type: "safety_inspection", label: safety.label, desc: safety.desc },
        { type: "emissions", label: "Emissions / smog certificate", desc: "State emissions certificate where required." },
        { type: "carfax", label: "Carfax / AutoCheck", desc: "Vehicle history report — attach for buyer review." },
        { type: "recon", label: "Inspection / MPI report", desc: "Multi-point reconditioning inspection report." },
        { type: "odometer", label: "Odometer disclosure", desc: "Federal odometer disclosure statement." },
        { type: "title", label: "Title / application", desc: "Title, reassignment, or title application." },
        { type: "warranty", label: "Warranty / service contract", desc: "Limited warranty, service contract (VSC), or GAP documents." },
        { type: "we_owe", label: "\"We owe\" / Due bill", desc: "Items the dealership agreed to deliver post-sale (e.g. pending install)." },
        { type: "brochure", label: "Product brochure", desc: "OEM or dealer marketing PDF / link — appears on the shopper page." },
        { type: "other", label: "Other", desc: "Anything else relevant to the deal jacket." },
      ]
    : [
        { type: "factory_sticker", label: "Factory window sticker", desc: "OEM Monroney PDF / image — we'll show it to the buyer at signing." },
        { type: "brochure", label: "Product brochure", desc: "OEM or dealer marketing PDF / link — appears on the shopper page." },
        { type: "carfax", label: "Carfax / AutoCheck", desc: "Vehicle history report." },
        { type: "warranty", label: "Warranty / service contract", desc: "Limited warranty, service contract (VSC), or GAP documents." },
        { type: "we_owe", label: "\"We owe\" / Due bill", desc: "Items the dealership agreed to deliver post-sale." },
        { type: "other", label: "Other", desc: "Anything else — inspection, MPI, warranty paperwork." },
      ];

  const filesByType = useMemo(() => {
    const m: Record<string, typeof vehicle.documents> = {};
    (vehicle.documents || []).forEach((d) => {
      m[d.type] = m[d.type] || [];
      m[d.type].push(d);
    });
    return m;
  }, [vehicle.documents]);

  return (
    <div className="space-y-6">
      <TabHeader
        title="Documents"
        description="Files available to shoppers and dealership staff — upload PDFs, links, brochures, reports, and warranty paperwork."
      />
      <div>
        <h3 className="text-[15px] font-bold text-foreground">Uploads &amp; Links</h3>
        <p className="text-[13px] text-slate-500 mt-0.5 mb-3">Click Upload to attach a PDF or image, or Add link to paste a URL. Everything here appears in the shopper packet's Documents page.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {slots.map((s) => (
        <div key={s.type} className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">{s.label}</h3>
            <span className="text-[10px] text-muted-foreground">{(filesByType[s.type] || []).length} file(s)</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.desc}</p>
          {(filesByType[s.type] || []).map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-0 text-xs text-primary hover:underline truncate"
              >
                {d.name}
              </a>
              <button
                type="button"
                onClick={() => removeDoc(d)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
                title="Remove"
                aria-label="Remove document"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-border text-xs font-semibold cursor-pointer hover:bg-muted/40">
              <Upload className="w-3 h-3" />
              {uploading === s.type ? "Uploading…" : "Upload"}
              <input
                type="file"
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f, s.type);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => { setLinkSlot(linkSlot === s.type ? null : s.type); setLinkName(""); setLinkUrl(""); }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
            >
              <LinkIcon className="w-3 h-3" />
              Add link
            </button>
          </div>
          {linkSlot === s.type && (
            <div className="space-y-1.5 pt-1.5">
              <input
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Label (optional) — e.g. 2026 CR-V brochure"
                className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-xs"
              />
              <div className="flex gap-1.5">
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 h-8 rounded-md border border-border bg-background px-2.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => addLink(s.type)}
                  className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
        </div>
      </div>
      <UsedCarDocPack vehicleId={vehicle.id} vin={vehicle.vin} condition={vehicle.condition} />
      <TitleMcoPanel vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} />
      <div className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-5">
        <GeneratedDocumentsSection vehicleId={vehicle.id} />
      </div>
    </div>
  );
};

// Per-vehicle template chooser row: shows the template in effect for this
// vehicle's condition (window or addendum slot), lets the dealer pick any
// builder / Sticker Studio template for this one vehicle, and optionally
// promote the pick to the store default.
const TemplateSlotRow = ({ kind, vehicle }: { kind: LabelKind; vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useDealerSettings();
  const { templates } = useStickerCatalog();
  const { defaults: legacy } = useStickerPrefs();

  const condition = conditionOf(vehicle.condition);
  const slot = slotFor(kind, condition);
  const storeRef = resolveLabelDefault(settings.label_defaults, slot, legacy);
  const [ref, setRef] = useState<string>(storeRef || "");

  const options = [
    ...Object.values(LABEL_BUILDERS)
      .filter((b) => b.kind === kind && b.conditions.includes(condition))
      .map((b) => ({ value: `builder:${b.key}`, label: b.label })),
    ...templates
      .filter((t) => t.config.type === kind)
      .map((t) => ({ value: `studio:${t.config.id}`, label: `${t.config.name} (${t.config.size})` })),
  ];
  const selected = ref || storeRef || "";
  const path = selected ? labelRefPath(selected, vehicle.id) : null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="sm:w-40 flex-shrink-0">
        <p className="text-xs font-bold text-foreground capitalize">{kind === "window" ? "Window sticker" : "Addendum"}</p>
        <p className="text-[10px] text-muted-foreground capitalize">{condition} vehicle</p>
      </div>
      <select
        value={options.some((o) => o.value === selected) ? selected : ""}
        onChange={(e) => setRef(e.target.value)}
        className="flex-1 h-9 rounded-md border border-border bg-background px-2.5 text-xs min-w-0"
      >
        {!options.some((o) => o.value === selected) && <option value="">Choose a template…</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {selected && selected !== storeRef && (
          <button
            type="button"
            onClick={() => {
              updateSettings({ label_defaults: { ...(settings.label_defaults || {}), [slot]: selected } });
              toast.success(`Saved as your store default for ${condition} vehicles`);
            }}
            className="h-9 px-3 rounded-md border border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            Set store default
          </button>
        )}
        <button
          type="button"
          disabled={!path}
          onClick={() => path && navigate(path)}
          className="h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Printer className="w-3.5 h-3.5" />
          Generate
        </button>
      </div>
    </div>
  );
};

const LabelsPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  // Carry the vehicle identity into every generator so the destination form
  // prefills from this file (see useVehiclePrefill). The dealer never re-keys
  // VIN / YMM / mileage / price that we already have.
  const go = (path: string) => navigate(`${path}?vehicleId=${vehicle.id}`);

  const hasCore = !!vehicle.vin && !!vehicle.ymm;
  const hasPrice = vehicle.price != null && vehicle.price > 0;
  const hasMileage = vehicle.mileage != null && vehicle.mileage > 0;
  const isCpo = vehicle.condition === "cpo";

  type LabelLink = { path: string; label: string; desc: string; ready: boolean; note: string; disabled?: boolean };
  const links: LabelLink[] = vehicle.condition === "new"
    ? [
        { path: "/new-car-sticker", label: "New-car Monroney + Addendum", desc: "Factory-style sticker with dealer-installed accessories and doc fee.", ready: hasCore, note: hasCore ? "Ready to generate" : "Decode VIN first" },
        { path: "/buyers-guide",    label: "FTC Buyers Guide", desc: "Spanish version auto-toggles.", ready: hasCore, note: "Needs warranty selection" },
      ]
    : [
        { path: "/used-car-sticker", label: "Used-car Monroney + Addendum", desc: "Three layouts: full, equipment-only, accessories-only.", ready: hasCore && hasPrice, note: hasCore && hasPrice ? "Ready to generate" : !hasPrice ? "Price missing" : "Decode VIN first" },
        { path: "/cpo-sheet",        label: "CPO Sheet",  desc: "Certified Pre-Owned disclosure template.", ready: isCpo, note: isCpo ? "Ready to generate" : "Available for CPO vehicles only", disabled: !isCpo },
        { path: "/buyers-guide",     label: "FTC Buyers Guide", desc: "Required; bilingual (en/es).", ready: hasCore, note: "Needs warranty selection" },
        { path: "/trade-up",         label: "Trade-Up Sticker", desc: "For demo / courtesy / trade-in display units.", ready: hasCore, note: hasCore ? "Ready to generate" : "Decode VIN first" },
      ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold text-foreground">Generate labels for this vehicle</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Every label opens with VIN, YMM, trim, equipment, and price already pulled
          from this file. When you publish to the shopper portal, the QR on the printed
          sticker resolves to <span className="font-mono">/v/{(vehicle.vin || vehicle.slug || "").toUpperCase()}</span>.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Label template for this vehicle</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Defaults to your store setting (Admin → Templates); pick a different template
            here to use it for this vehicle only.
          </p>
        </div>
        <TemplateSlotRow kind="window" vehicle={vehicle} />
        <TemplateSlotRow kind="addendum" vehicle={vehicle} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {links.map((l) => (
          <button
            key={l.path}
            onClick={() => !l.disabled && go(l.path)}
            disabled={l.disabled}
            className={`text-left rounded-xl border bg-card p-4 transition ${
              l.disabled
                ? "border-border opacity-55 cursor-not-allowed"
                : "border-border hover:border-primary hover:shadow-premium"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground inline-flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" />
                {l.label}
              </span>
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{l.desc}</p>
            <span
              className={`mt-2 inline-flex items-center gap-1 text-[10px] font-semibold ${
                l.disabled ? "text-muted-foreground" : l.ready ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${l.disabled ? "bg-slate-300" : l.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              {l.note}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

interface AddendumRow {
  id: string;
  created_at: string;
  status: string | null;
  customer_name: string | null;
  cobuyer_name: string | null;
  content_hash: string | null;
  signed_at: string | null;
  token: string | null;
  total_price: number | null;
}

// Scan Info — staff edit the three customer-facing fields shown on the public
// /v/:slug scan: service history, remaining warranty, and accessories still
// available for this vehicle. Saved straight onto vehicle_listings, which the
// public RPC returns, so changes appear on the shopper page immediately.
const BrochureFinderRow = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ url: string; year?: number | null } | null>(null);
  const parts = (vehicle.ymm || "").trim().split(/\s+/);
  const year = Number.parseInt(parts[0] || "", 10) || null;
  const make = parts[1] || "";
  const model = parts.slice(2).join(" ");
  const find = async () => {
    if (!make || !model) { toast.error("Vehicle year/make/model is incomplete"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-brochure", { body: { make, model, year } });
      if (error || !data?.ok) {
        const code = (data as { error?: string } | null)?.error;
        toast.error(code === "make_not_supported" ? `No official brochure source configured for ${make}.` : `No official ${make} brochure found for this model.`);
        return;
      }
      setFound({ url: data.url, year: data.year });
      toast.success(`Official brochure linked${data.cached ? "" : " (newly harvested)"} — it now shows in the shopper packet.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold text-foreground">OEM Brochure</h3>
        <p className="text-[13px] text-slate-500 mt-0.5">
          {found
            ? <>Linked to the manufacturer's official brochure{found.year ? ` (${found.year})` : ""}. <a href={found.url} target="_blank" rel="noreferrer" className="text-blue-600 font-semibold">Open</a></>
            : <>Search the manufacturer's own site for the official {make || "model"} brochure and link it on the shopper packet.</>}
        </p>
      </div>
      <button onClick={find} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-[13px] font-semibold hover:bg-muted disabled:opacity-60">
        {busy ? "Searching…" : found ? "Search again" : "Find OEM brochure"}
      </button>
    </section>
  );
};

const ScanInfoPanel = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [records, setRecords] = useState<ServiceRecord[]>(vehicle.service_records || []);
  const [warranty, setWarranty] = useState<WarrantyInfo>(vehicle.warranty_info || {});
  const [accessories, setAccessories] = useState<AvailableAccessory[]>(vehicle.available_accessories || []);
  const [packetModules, setPacketModules] = useState<Record<string, boolean>>(vehicle.packet_modules || {});
  const [saving, setSaving] = useState(false);
  const { settings: dealerSettings } = useDealerSettings();
  const storeDefaults = dealerSettings.packet_module_defaults || {};

  // Three states per module: explicit show, explicit hide, or inherit the
  // store-wide template. Click cycles inherit -> on -> off -> inherit.
  const cycleModule = (id: string) =>
    setPacketModules((prev) => {
      const next = { ...prev };
      if (prev[id] === undefined) next[id] = true;
      else if (prev[id] === true) next[id] = false;
      else delete next[id];
      return next;
    });

  const save = async () => {
    setSaving(true);
    // packet_modules may not be migrated everywhere yet; retry without it on a
    // schema error so saving scan content never breaks.
    const base = {
      service_records: records.filter((r) => r.date || r.type || r.notes || r.mileage),
      warranty_info: warranty,
      available_accessories: accessories.filter((a) => a.name.trim()),
    };
    let { error } = await (supabase as any)
      .from("vehicle_listings")
      .update({ ...base, packet_modules: packetModules })
      .eq("id", vehicle.id);
    if (error && /column|schema cache|packet_modules/i.test(error.message || "")) {
      ({ error } = await (supabase as any).from("vehicle_listings").update(base).eq("id", vehicle.id));
    }
    setSaving(false);
    if (error) { toast.error("Could not save scan info"); return; }
    toast.success("Scan info saved");
    onReload();
  };

  const inputCls = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  const remainingCoverage = (() => {
    if (!warranty.in_service_date || !warranty.factory_months) return null;
    const end = new Date(warranty.in_service_date);
    end.setMonth(end.getMonth() + warranty.factory_months);
    const ms = end.getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    if (ms <= 0) return "Factory coverage has expired.";
    const mo = Math.round(ms / (1000 * 60 * 60 * 24 * 30.44));
    return mo >= 12
      ? `~${Math.floor(mo / 12)} yr ${mo % 12} mo of factory coverage remaining`
      : `~${mo} mo of factory coverage remaining`;
  })();

  return (
    <div className="space-y-6">
      <TabHeader
        title="Shopper Passport Builder"
        description={<>Choose what appears on the public vehicle passport — scanned at <span className="font-mono text-foreground/70">/v/{(vehicle.vin || vehicle.slug || "").toUpperCase()}</span>.</>}
        action={
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Changes"}
          </button>
        }
      />

      {/* OEM brochure link — harvested from the manufacturer's own site */}
      <BrochureFinderRow vehicle={vehicle} />

      {/* Passport modules — module cards, same language as Documents */}
      <div>
        <h3 className="text-[15px] font-bold text-foreground">Passport Modules</h3>
        <p className="text-[13px] text-slate-500 mt-0.5">Toggle the sections shoppers see. Recall, price, and verified installs always show.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
          {PACKET_MODULES.map((m) => {
            const override = packetModules[m.id];
            const inherited = override === undefined;
            const on = packetVisible({ packet_modules: packetModules, packet_defaults: storeDefaults }, m.id);
            return (
              <button
                key={m.id}
                onClick={() => cycleModule(m.id)}
                aria-pressed={on}
                title="Click to cycle: inherit store default, always show, always hide"
                className={`text-left rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-3 min-h-[150px] transition hover:shadow-md ${on ? "border-border" : "border-border opacity-75"}`}
              >
                <h4 className="text-sm font-bold text-foreground">{m.label}</h4>
                <p className="text-[13px] text-slate-500 leading-relaxed flex-1">{m.desc}</p>
                <span className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold ${on ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-400"}`} /> {on ? "Enabled" : "Disabled"}
                  </span>
                  <span className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold ${inherited ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-slate-50 text-slate-600 border border-slate-200"}`}>
                    {inherited ? "Store default" : "This vehicle"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Service history */}
      <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2"><Wrench className="w-4 h-4 text-muted-foreground" /> Service History</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">Add service visits, maintenance records, and repair history.</p>
          </div>
          <button onClick={() => setRecords((r) => [...r, { date: "", mileage: "", type: "", notes: "" }])} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted"><Plus className="w-3.5 h-3.5" /> Add Service Record</button>
        </div>
        {records.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-8 text-center">
            <Wrench className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">No service records yet</p>
            <p className="text-[12px] text-slate-500 mt-0.5">Log oil changes, inspections, and repairs to build buyer confidence.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_2fr_auto] gap-2 items-end">
                <div><label className={labelCls}>Date</label><input type="date" value={r.date} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className={inputCls} /></div>
                <div><label className={labelCls}>Mileage</label><input value={r.mileage} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, mileage: e.target.value } : x))} placeholder="42,000" className={inputCls} /></div>
                <div><label className={labelCls}>Type</label><input value={r.type} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} placeholder="Oil & filter" className={inputCls} /></div>
                <div><label className={labelCls}>Notes</label><input value={r.notes} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} placeholder="Multi-point inspection passed" className={inputCls} /></div>
                <button onClick={() => setRecords((p) => p.filter((_, j) => j !== i))} className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Remaining warranty */}
      <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-muted-foreground" /> Remaining Factory Warranty</h3>
          <p className="text-[13px] text-slate-500 mt-0.5">In-service date and coverage terms — shoppers see an estimated balance.</p>
        </div>
        {remainingCoverage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-[13px] font-semibold text-emerald-800">{remainingCoverage}</p>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><label className={labelCls}>In-service date</label><input type="date" value={warranty.in_service_date || ""} onChange={(e) => setWarranty((w) => ({ ...w, in_service_date: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>Factory (months)</label><input type="number" value={warranty.factory_months ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, factory_months: e.target.value ? Number(e.target.value) : undefined }))} placeholder="36" className={inputCls} /></div>
          <div><label className={labelCls}>Factory (miles)</label><input type="number" value={warranty.factory_miles ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, factory_miles: e.target.value ? Number(e.target.value) : undefined }))} placeholder="36000" className={inputCls} /></div>
          <div><label className={labelCls}>Powertrain (months)</label><input type="number" value={warranty.powertrain_months ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, powertrain_months: e.target.value ? Number(e.target.value) : undefined }))} placeholder="60" className={inputCls} /></div>
          <div><label className={labelCls}>Powertrain (miles)</label><input type="number" value={warranty.powertrain_miles ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, powertrain_miles: e.target.value ? Number(e.target.value) : undefined }))} placeholder="60000" className={inputCls} /></div>
        </div>
        <div><label className={labelCls}>Notes</label><input value={warranty.notes || ""} onChange={(e) => setWarranty((w) => ({ ...w, notes: e.target.value }))} placeholder="Balance of factory coverage transfers to the new owner." className={inputCls} /></div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Remaining time/miles are estimated from the in-service date and shown to shoppers as an estimate — confirm terms with the manufacturer.</p>
      </section>

      {/* Available accessories */}
      <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-muted-foreground" /> Available Accessories</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">Dealer-installed accessories and upgrades the shopper can add.</p>
          </div>
          <button onClick={() => setAccessories((a) => [...a, { name: "", price: "", note: "" }])} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted"><Plus className="w-3.5 h-3.5" /> Add Accessory</button>
        </div>
        {accessories.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-7 px-5 text-center">
            <Sparkles className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">No accessories added yet</p>
            <p className="text-[12px] text-slate-500 mt-0.5">Examples: wheel packages · cargo systems · protection packages.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accessories.map((a, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
                <div><label className={labelCls}>Accessory</label><input value={a.name} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="All-weather floor liners" className={inputCls} /></div>
                <div><label className={labelCls}>Price</label><input value={a.price} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="$249" className={inputCls} /></div>
                <div><label className={labelCls}>Note</label><input value={a.note} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} placeholder="Custom-fit, installed same day" className={inputCls} /></div>
                <button onClick={() => setAccessories((p) => p.filter((_, j) => j !== i))} className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const SUFFIXES = ["", "Jr.", "Sr.", "II", "III", "IV", "V"];

// Buyer / co-buyer fields. MUST be module-scope — defining it inside
// CustomerPanel made it a new component type each keystroke, remounting the
// inputs and dropping focus after every character.
const CP_INPUT = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
const CP_LABEL = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
const CustomerPersonFields = ({ info, set }: { info: PersonInfo; set: (u: PersonInfo) => void }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      <div className="md:col-span-2"><label className={CP_LABEL}>First name</label><input value={info.first_name || ""} onChange={(e) => set({ ...info, first_name: e.target.value })} className={CP_INPUT} /></div>
      <div><label className={CP_LABEL}>M.I.</label><input value={info.middle_initial || ""} maxLength={1} onChange={(e) => set({ ...info, middle_initial: e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase() })} className={`${CP_INPUT} text-center`} /></div>
      <div className="md:col-span-2"><label className={CP_LABEL}>Last name</label><input value={info.last_name || ""} onChange={(e) => set({ ...info, last_name: e.target.value })} className={CP_INPUT} /></div>
      <div><label className={CP_LABEL}>Suffix</label>
        <select value={info.suffix || ""} onChange={(e) => set({ ...info, suffix: e.target.value })} className={`${CP_INPUT} cursor-pointer`}>
          {SUFFIXES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
        </select>
      </div>
    </div>
    <div><label className={CP_LABEL}>Street address</label><input value={info.address || ""} onChange={(e) => set({ ...info, address: e.target.value })} placeholder="123 Main St" className={CP_INPUT} /></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div className="md:col-span-2"><label className={CP_LABEL}>City</label><input value={info.city || ""} onChange={(e) => set({ ...info, city: e.target.value })} className={CP_INPUT} /></div>
      <div><label className={CP_LABEL}>State</label><input value={info.state || ""} maxLength={2} onChange={(e) => set({ ...info, state: e.target.value.toUpperCase() })} placeholder="CT" className={`${CP_INPUT} uppercase`} /></div>
      <div><label className={CP_LABEL}>ZIP</label><input value={info.zip || ""} onChange={(e) => set({ ...info, zip: e.target.value.replace(/[^0-9-]/g, "").slice(0, 10) })} placeholder="06010" className={CP_INPUT} /></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div><label className={CP_LABEL}>Phone</label><input value={info.phone || ""} type="tel" onChange={(e) => set({ ...info, phone: formatPhone(e.target.value) })} placeholder="(555) 555-5555" className={CP_INPUT} /></div>
      <div><label className={CP_LABEL}>Email</label><input value={info.email || ""} type="email" onChange={(e) => set({ ...info, email: e.target.value })} placeholder="customer@email.com" className={CP_INPUT} /></div>
    </div>
  </div>
);

// Customer capture on the unified vehicle file. Full buyer + co-buyer record
// (incl. address) saved to vehicle_files — the internal, RLS-protected hub,
// never the public listing. Captured at sale so the dealer has the complete
// sold-to record on hand for follow-up, registration, recall, or compliance.
const CustomerPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const { tenant } = useTenant();
  const [buyer, setBuyer] = useState<PersonInfo>({});
  const [cobuyer, setCobuyer] = useState<PersonInfo>({});
  const [showCobuyer, setShowCobuyer] = useState(false);
  const [soldAt, setSoldAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let on = true;
    (async () => {
      let q = (supabase as any).from("vehicle_files").select("id, customer_info, sold_at");
      q = vehicle.vehicle_file_id
        ? q.eq("id", vehicle.vehicle_file_id)
        : q.eq("tenant_id", tenant?.id || "").eq("vin", vehicle.vin);
      const { data } = await q.maybeSingle();
      if (!on) return;
      if (data) {
        const ci = (data.customer_info || {}) as CustomerInfoBag;
        setBuyer(ci.buyer || {});
        setCobuyer(ci.cobuyer || {});
        setShowCobuyer(!!ci.cobuyer && Object.keys(ci.cobuyer).length > 0);
        setSoldAt(data.sold_at ? String(data.sold_at).slice(0, 10) : "");
      }
      setLoading(false);
    })();
    return () => { on = false; };
  }, [vehicle.vehicle_file_id, vehicle.vin, tenant?.id]);

  const save = async () => {
    if (!tenant?.id) { toast.error("No tenant in context"); return; }
    setSaving(true);
    const customer_info: CustomerInfoBag = { buyer, ...(showCobuyer ? { cobuyer } : {}) };
    const row = {
      tenant_id: tenant.id,
      vin: vehicle.vin,
      customer_info,
      sold_at: soldAt ? new Date(soldAt).toISOString() : null,
      customer_name: composeName(buyer.first_name || "", buyer.middle_initial || "", buyer.last_name || "", buyer.suffix || ""),
      customer_phone: buyer.phone || "",
      customer_email: buyer.email || "",
      cobuyer_name: showCobuyer ? composeName(cobuyer.first_name || "", cobuyer.middle_initial || "", cobuyer.last_name || "", cobuyer.suffix || "") : "",
      cobuyer_phone: showCobuyer ? (cobuyer.phone || "") : "",
      cobuyer_email: showCobuyer ? (cobuyer.email || "") : "",
    };
    const { error } = await (supabase as any).from("vehicle_files").upsert(row, { onConflict: "tenant_id,vin" });
    setSaving(false);
    if (error) { toast.error("Could not save customer info"); return; }
    toast.success("Customer info saved");
  };

  const inputCls = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  if (loading) return <p className="text-sm text-muted-foreground">Loading customer record…</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <TabHeader
        title="Customer Information"
        description="Captured when the vehicle is sold. Stored on the internal file only — never shown on the public scan."
        action={
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
          </button>
        }
      />

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-foreground flex items-center gap-1.5"><UserRound className="w-4 h-4 text-muted-foreground" /> Buyer</p>
          <div><label className={labelCls}>Sold date</label><input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} className={`${inputCls} w-auto`} /></div>
        </div>
        <CustomerPersonFields info={buyer} set={setBuyer} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showCobuyer} onChange={(e) => setShowCobuyer(e.target.checked)} />
          <span className="text-sm font-bold text-foreground flex items-center gap-1.5"><Users className="w-4 h-4 text-muted-foreground" /> Add co-buyer</span>
        </label>
        {showCobuyer && (
          <>
            {(buyer.address || buyer.city || buyer.zip) && (
              <button
                type="button"
                onClick={() => setCobuyer({ ...cobuyer, address: buyer.address, city: buyer.city, state: buyer.state, zip: buyer.zip })}
                className="text-[10px] font-bold uppercase tracking-wide text-primary hover:underline"
              >
                Same address as buyer
              </button>
            )}
            <CustomerPersonFields info={cobuyer} set={setCobuyer} />
          </>
        )}
      </section>
    </div>
  );
};

const AddendumPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AddendumRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("addendums")
        .select(
          "id,created_at,status,customer_name,cobuyer_name,content_hash,signed_at,token,total_price"
        )
        .eq("vehicle_vin", vehicle.vin)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setRows((data || []) as AddendumRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const signed = rows.filter((r) => r.status === "signed" || !!r.signed_at);
  const drafts = rows.filter((r) => !(r.status === "signed" || !!r.signed_at));

  const copyLink = async (token: string | null) => {
    if (!token) return;
    const url = `${window.location.origin}/sign/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  // Carry the vehicle identity into the addendum builder so the dealer never
  // re-keys VIN / year-make-model / mileage that we already have on file.
  const startAddendum = () => {
    const params = new URLSearchParams();
    params.set("vehicleId", vehicle.id);
    if (vehicle.vin) params.set("vin", vehicle.vin);
    if (vehicle.ymm) params.set("ymm", vehicle.ymm);
    if (vehicle.trim) params.set("trim", vehicle.trim);
    if (vehicle.mileage != null) params.set("mileage", String(vehicle.mileage));
    // Carry the recall signal so the addendum's compliance receipt reflects the
    // real NHTSA status instead of a generic "check ready" line.
    if (vehicle.recall_status) params.set("recall", vehicle.recall_status);
    if (vehicle.open_recall_count != null) params.set("open", String(vehicle.open_recall_count));
    const qs = params.toString();
    navigate(qs ? `/addendum?${qs}` : "/addendum");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Addendums
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Every signed addendum for this vehicle, scoped to VIN
            <span className="font-mono ml-1">{vehicle.vin}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/addendum-label/${vehicle.id}`)}
            className="h-10 px-4 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-1.5 hover:border-primary"
          >
            <Printer className="w-4 h-4" />
            Addendum Label
          </button>
          <button
            onClick={startAddendum}
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Addendum
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading addendums…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No addendums for this vehicle yet"
          description="Build one and the customer can sign on any phone. Every signed copy is hash-sealed and archived to the compliance record."
          actions={[{ label: "Start Addendum", icon: Plus, onClick: startAddendum }]}
        />
      ) : (
        <div className="space-y-3">
          {signed.length > 0 && (
            <Section title={`Signed (${signed.length})`}>
              {signed.map((r) => (
                <AddendumCard key={r.id} row={r} onOpen={() => navigate(`/addendum?id=${r.id}`)} onCopyLink={copyLink} />
              ))}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title={`Drafts (${drafts.length})`}>
              {drafts.map((r) => (
                <AddendumCard key={r.id} row={r} onOpen={() => navigate(`/addendum?id=${r.id}`)} onCopyLink={copyLink} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p className="text-caption font-bold uppercase tracking-label text-muted-foreground mb-2">
      {title}
    </p>
    <div className="space-y-2">{children}</div>
  </div>
);

const AddendumCard = ({
  row,
  onOpen,
  onCopyLink,
}: {
  row: AddendumRow;
  onOpen: () => void;
  onCopyLink: (token: string | null) => void;
}) => {
  const signed = row.status === "signed" || !!row.signed_at;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${
        signed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}>
        {signed ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {row.customer_name || "Unnamed customer"}
          {row.cobuyer_name ? <span className="text-muted-foreground"> + {row.cobuyer_name}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {typeof row.total_price === "number" && (
            <span className="tabular-nums">${row.total_price.toLocaleString()}</span>
          )}
          {row.content_hash && (
            <span className="font-mono text-[10px]">hash: {row.content_hash.slice(0, 10)}…</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {!signed && row.token && (
          <button
            onClick={() => onCopyLink(row.token)}
            className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
            title="Copy signing link"
          >
            <Copy className="w-3 h-3" />
            Link
          </button>
        )}
        <button
          onClick={onOpen}
          className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

interface PrepRow {
  id: string;
  created_at: string;
  signed_at: string | null;
  updated_at: string;
  status: "pending" | "signed" | "rejected" | "overridden";
  foreman_name: string | null;
  inspection_passed: boolean;
  inspection_form_type: string | null;
  rejection_reason: string | null;
  listing_unlocked: boolean;
  accessories_installed: Array<{ name: string; installed_date?: string | null }> | null;
  install_photos: Array<{ url: string; caption?: string }> | null;
  notes: string | null;
}

const PrepPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("prep_sign_offs")
        .select(
          "id,created_at,signed_at,updated_at,status,foreman_name,inspection_passed,inspection_form_type,rejection_reason,listing_unlocked,accessories_installed,install_photos,notes"
        )
        .eq("vin", vehicle.vin)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setRows((data || []) as PrepRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const latest = rows[0] || null;
  const history = rows.slice(1);
  const unlocked = !!latest?.listing_unlocked;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Prep & Install
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Foreman sign-off unlocks publishing and freezes the install
            record onto every signed addendum for this VIN.
          </p>
        </div>
        <button
          onClick={() => navigate(`/prep?vin=${encodeURIComponent(vehicle.vin)}`)}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Sign-Off
        </button>
      </div>

      <DeliverySignoffs vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} />

      {/* Listing-unlock banner */}
      <div
        className={`rounded-xl border p-4 flex items-center gap-3 ${
          unlocked
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        {unlocked ? (
          <Unlock className="w-5 h-5 flex-shrink-0" />
        ) : (
          <Lock className="w-5 h-5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold">
            {unlocked
              ? "Publishing unlocked"
              : "Publishing locked — prep sign-off required"}
          </p>
          <p className="text-caption opacity-80">
            {unlocked
              ? `Foreman ${latest?.foreman_name || ""} signed off ${
                  latest?.signed_at
                    ? new Date(latest.signed_at).toLocaleString()
                    : ""
                }.`
              : "A signed prep record gates the public listing. Latest sign-off must have inspection passed and listing_unlocked = true."}
          </p>
        </div>
      </div>

      {/* Vendor / detail-shop install proofs (scan-to-verify QR flow) */}
      <InstallProofList vin={vehicle.vin} />

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading sign-offs…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No prep sign-offs for this vehicle"
          description="Run a foreman sign-off when the install is complete. Until then the public listing stays locked and addendums can't reference an install audit."
          actions={[
            {
              label: "Start Sign-Off",
              icon: Plus,
              onClick: () => navigate(`/prep?vin=${encodeURIComponent(vehicle.vin)}`),
            },
          ]}
        />
      ) : (
        <div className="space-y-3">
          {latest && (
            <Section title="Latest sign-off">
              <PrepCard row={latest} onOpen={() => navigate("/prep")} />
            </Section>
          )}
          {history.length > 0 && (
            <Section title={`History (${history.length})`}>
              {history.map((r) => (
                <PrepCard key={r.id} row={r} onOpen={() => navigate("/prep")} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const PrepCard = ({ row, onOpen }: { row: PrepRow; onOpen: () => void }) => {
  const installed = (row.accessories_installed || []).filter((a) => a.installed_date).length;
  const total = (row.accessories_installed || []).length;
  const photos = (row.install_photos || []).length;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700" :
    row.status === "rejected" ? "bg-red-100 text-red-700" :
    row.status === "overridden" ? "bg-violet-100 text-violet-700" :
    "bg-amber-100 text-amber-700";
  const statusIcon =
    row.status === "signed" ? <CheckCircle2 className="w-4 h-4" /> :
    row.status === "rejected" ? <AlertTriangle className="w-4 h-4" /> :
    <Clock className="w-4 h-4" />;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${statusCls}`}>
        {statusIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-body-sm font-semibold text-foreground truncate">
            {row.foreman_name || "Unassigned foreman"}
          </p>
          <span className={`text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded ${statusCls}`}>
            {row.status}
          </span>
          {row.listing_unlocked && (
            <span className="text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
              <Unlock className="w-2.5 h-2.5" />
              unlocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.updated_at).toLocaleDateString()}</span>
          {total > 0 && <span>{installed}/{total} installed</span>}
          {photos > 0 && <span>{photos} photo{photos === 1 ? "" : "s"}</span>}
          {row.inspection_form_type && row.inspection_form_type !== "None" && (
            <span>{row.inspection_form_type} inspection</span>
          )}
          {row.status === "rejected" && row.rejection_reason && (
            <span className="text-red-600 truncate">Reason: {row.rejection_reason}</span>
          )}
        </div>
      </div>
      <button
        onClick={onOpen}
        className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
      >
        Open
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
};

interface DealTokenRow {
  id: string;
  token: string;
  status: "pending" | "signed" | "expired" | "revoked";
  vehicle_payload: { vin?: string; ymm?: string; buyer?: { name?: string }; coBuyer?: { name?: string } } | null;
  content_hash: string | null;
  customer_ip: string | null;
  expires_at: string;
  signed_at: string | null;
  created_at: string;
}

interface SigningRow {
  id: string;
  signer_type: string;
  signer_name: string | null;
  signature_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
  addendum_id: string | null;
  deal_token_id: string | null;
}

const SignPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<DealTokenRow[]>([]);
  const [signings, setSignings] = useState<SigningRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: s }] = await Promise.all([
        (supabase as any)
          .from("deal_signing_tokens")
          .select(
            "id,token,status,vehicle_payload,content_hash,customer_ip,expires_at,signed_at,created_at"
          )
          .eq("vehicle_payload->>vin", vehicle.vin)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("addendum_signings")
          .select(
            "id,signer_type,signer_name,signature_type,ip_address,user_agent,signed_at,addendum_id,deal_token_id"
          )
          .eq("vin", vehicle.vin)
          .order("signed_at", { ascending: false })
          .limit(50),
      ]);
      if (!cancelled) {
        setTokens((t || []) as DealTokenRow[]);
        setSignings((s || []) as SigningRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const pending = tokens.filter((t) => t.status === "pending");
  const completed = tokens.filter((t) => t.status === "signed");
  const expired = tokens.filter((t) => t.status === "expired" || t.status === "revoked");

  const dealUrl = (token: string) => `${window.location.origin}/deal/${token}`;

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(dealUrl(token));
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const smsLink = (token: string) => {
    const body = encodeURIComponent(
      `Sign your paperwork for ${vehicle.ymm || "your vehicle"}: ${dealUrl(token)}`
    );
    window.open(`sms:?body=${body}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Customer Sign-off
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Active signing links and the full signature audit trail for
            VIN <span className="font-mono">{vehicle.vin}</span>.
          </p>
        </div>
        <button
          onClick={() => navigate("/addendum")}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Signing Link
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading signatures…
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <Section title={`Active links (${pending.length})`}>
              {pending.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {signings.length > 0 && (
            <Section title={`Signatures captured (${signings.length})`}>
              {signings.map((s) => (
                <SigningCard key={s.id} row={s} onOpen={() => s.addendum_id ? navigate(`/addendum?id=${s.addendum_id}`) : navigate("/saved")} />
              ))}
            </Section>
          )}

          {completed.length > 0 && (
            <Section title={`Completed deal jackets (${completed.length})`}>
              {completed.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {expired.length > 0 && (
            <Section title={`Expired / revoked (${expired.length})`}>
              {expired.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {pending.length === 0 && signings.length === 0 && completed.length === 0 && expired.length === 0 && (
            <EmptyState
              icon={Signature}
              title="No signatures captured for this vehicle"
              description="Generate a signing link from an addendum and the customer can sign on any phone. Every signature stores its hash, IP, user agent, and consent record."
              actions={[{ label: "Build Addendum", icon: Plus, onClick: () => navigate("/addendum") }]}
            />
          )}
        </>
      )}
    </div>
  );
};

const DealTokenCard = ({
  row, url, onCopy, onSms,
}: {
  row: DealTokenRow;
  url: string;
  onCopy: () => void;
  onSms: () => void;
}) => {
  const buyerName = row.vehicle_payload?.buyer?.name || "Customer";
  const cobuyerName = row.vehicle_payload?.coBuyer?.name;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700" :
    row.status === "expired" ? "bg-slate-100 text-slate-600" :
    row.status === "revoked" ? "bg-red-100 text-red-700" :
    "bg-amber-100 text-amber-700";
  const statusIcon =
    row.status === "signed" ? <CheckCircle2 className="w-4 h-4" /> :
    row.status === "expired" ? <Clock className="w-4 h-4" /> :
    row.status === "revoked" ? <AlertTriangle className="w-4 h-4" /> :
    <Send className="w-4 h-4" />;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${statusCls}`}>
        {statusIcon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {buyerName}
          {cobuyerName ? <span className="text-muted-foreground"> + {cobuyerName}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded ${statusCls}`}>
            {row.status}
          </span>
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {row.signed_at && <span>signed {new Date(row.signed_at).toLocaleString()}</span>}
          {row.status === "pending" && (
            <span>expires {new Date(row.expires_at).toLocaleDateString()}</span>
          )}
          {row.content_hash && (
            <span className="font-mono text-[10px]">hash: {row.content_hash.slice(0, 10)}…</span>
          )}
        </div>
      </div>
      {row.status === "pending" && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCopy}
            className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
            title="Copy signing link"
          >
            <Copy className="w-3 h-3" />
            Link
          </button>
          <button
            onClick={onSms}
            className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
            title="Text the link to the customer"
          >
            <MessageSquare className="w-3 h-3" />
            Text
          </button>
        </div>
      )}
      {row.status === "signed" && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
        >
          View
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};

const SigningCard = ({ row, onOpen }: { row: SigningRow; onOpen: () => void }) => {
  const ua = (row.user_agent || "").slice(0, 36);
  const isPrimary = row.signer_type === "customer" || row.signer_type === "cobuyer";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${
        isPrimary ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
      }`}>
        <Signature className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {row.signer_name || "Unnamed signer"}
          <span className="ml-2 text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {row.signer_type.replace(/_/g, " ")}
          </span>
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.signed_at).toLocaleString()}</span>
          {row.signature_type && <span>{row.signature_type}</span>}
          {row.ip_address && <span className="font-mono text-[10px]">ip: {row.ip_address}</span>}
          {ua && <span className="truncate font-mono text-[10px]" title={row.user_agent || ""}>{ua}…</span>}
        </div>
      </div>
      {(row.addendum_id || row.deal_token_id) && (
        <button
          onClick={onOpen}
          className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const JumpTo = ({ path, reason }: { path: string; reason: string }) => {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card p-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">{reason}</p>
      <button
        onClick={() => navigate(path)}
        className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
      >
        Open →
      </button>
      <p className="text-[11px] text-muted-foreground">
        Next wave folds this workflow directly into the vehicle file so you never
        leave the page.
      </p>
    </div>
  );
};

const Card = ({ title, children, action, className = "" }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_28px_-16px_rgba(16,24,40,0.12)] hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_36px_-18px_rgba(16,24,40,0.16)] transition-shadow p-6 lg:p-7 space-y-4 ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

// Maps an audit action to a distinct icon + tone so the activity feed reads
// as a real timeline (decode vs sticker vs sign vs upload) rather than a wall
// of identical green checks.
const eventVisual = (action: string): { icon: typeof CheckCircle2; cls: string } => {
  const a = (action || "").toLowerCase();
  if (a.includes("decod") || a.includes("vin")) return { icon: Gauge, cls: "bg-blue-50 text-blue-600" };
  if (a.includes("sticker") || a.includes("label")) return { icon: Printer, cls: "bg-indigo-50 text-indigo-600" };
  if (a.includes("publish")) return { icon: Globe, cls: "bg-emerald-50 text-emerald-600" };
  if (a.includes("addendum")) return { icon: FileText, cls: "bg-violet-50 text-violet-600" };
  if (a.includes("sign")) return { icon: Signature, cls: "bg-fuchsia-50 text-fuchsia-600" };
  if (a.includes("upload") || a.includes("document")) return { icon: Upload, cls: "bg-slate-100 text-slate-600" };
  if (a.includes("recall")) return { icon: AlertTriangle, cls: "bg-amber-50 text-amber-600" };
  if (a.includes("prep") || a.includes("install")) return { icon: CheckCircle2, cls: "bg-teal-50 text-teal-600" };
  return { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" };
};

// Service Get Ready: record the recall outcome (one of three) with the required
// service detail. Resolving the task clears the publish blocker (a "No fix
// available" outcome keeps the recall visible but is still a recorded review).
const OUTCOME_ORDER: RecallOutcome[] = ["recall_completed", "no_fix_available", "does_not_apply"];
const RecallReviewActions = ({ recall, vehicle }: { recall: ReturnType<typeof useRecallTask>; vehicle: VehicleRow }) => {
  const { task, blocking, submitting, submitOutcome } = recall;
  const [picked, setPicked] = useState<RecallOutcome | null>(null);
  const [employee, setEmployee] = useState("");
  const [ro, setRo] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<{ url: string; caption?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!task) return null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !vehicle.tenant_id || !vehicle.vin) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const path = `${vehicle.tenant_id}/${vehicle.vin}/recall/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("service-docs").upload(path, file, { upsert: false });
      if (!error) {
        const { data } = supabase.storage.from("service-docs").getPublicUrl(path);
        if (data?.publicUrl) setDocs((p) => [...p, { url: data.publicUrl, caption: file.name }]);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Already reviewed — show the immutable record (audit trail preserved).
  if (task.status === "resolved" && task.outcome) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
        <p className="text-[11px] font-bold text-emerald-800">Recall reviewed · {OUTCOME_LABELS[task.outcome]}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {[task.employee_name, task.ro_number ? `RO ${task.ro_number}` : null, task.completed_at ? new Date(task.completed_at).toLocaleDateString() : null].filter(Boolean).join(" · ")}
        </p>
        {task.notes ? <p className="text-[11px] text-muted-foreground mt-0.5">{task.notes}</p> : null}
        {task.outcome === "no_fix_available" && <p className="text-[11px] text-amber-700 mt-1">OEM remedy not yet available — recall stays visible; dealer publish policy applies.</p>}
      </div>
    );
  }

  const submit = async () => {
    if (!picked) return;
    if (!employee.trim()) { toast.error("Service employee name is required"); return; }
    const r = await submitOutcome(picked, { employeeName: employee.trim(), roNumber: ro.trim() || undefined, notes: notes.trim() || undefined, documents: docs });
    if (r.ok) toast.success("Recall outcome recorded"); else toast.error(r.error || "Could not record outcome");
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
      <p className="text-[11px] font-bold text-amber-800">Open Recall Review Required {blocking ? "· blocks publish" : ""}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">Service must record an outcome before this vehicle can publish.</p>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_ORDER.map((o) => (
          <button key={o} onClick={() => setPicked(o)}
            className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ${picked === o ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-card text-foreground hover:bg-muted"}`}>
            {OUTCOME_LABELS[o]}
          </button>
        ))}
      </div>
      {picked && (
        <div className="mt-2 space-y-1.5">
          <input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="Service employee name *" className="w-full px-2 py-1.5 border border-border rounded text-[12px]" />
          <input value={ro} onChange={(e) => setRo(e.target.value)} placeholder="RO number (if applicable)" className="w-full px-2 py-1.5 border border-border rounded text-[12px]" />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full px-2 py-1.5 border border-border rounded text-[12px] resize-none" />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-8 rounded-md border border-dashed border-border text-[12px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
            {uploading ? "Uploading…" : docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"} attached` : "Attach photo / document (optional)"}
          </button>
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {docs.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">{d.caption || "file"}
                  <button onClick={() => setDocs((p) => p.filter((_, j) => j !== i))}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
          <button onClick={submit} disabled={submitting} className="w-full h-8 rounded-md bg-blue-600 text-white text-[12px] font-semibold disabled:opacity-50">
            {submitting ? "Recording…" : `Record: ${OUTCOME_LABELS[picked]}`}
          </button>
        </div>
      )}
    </div>
  );
};

// MarketCheck AutoRecalls — live 4-state card (clear / open / unknown / error).
const RecallCard = ({ vehicle, recall }: { vehicle: VehicleRow; recall: ReturnType<typeof useRecallTask> }) => {
  const [status, setStatus] = useState<string | null>(vehicle.recall_status);
  const [checkedAt, setCheckedAt] = useState<string | null>(vehicle.recall_checked_at);
  const [open, setOpen] = useState<number>(vehicle.open_recall_count ?? 0);
  const [recalls, setRecalls] = useState<RecallItem[]>(normalizeRecalls(vehicle.recall_payload));
  const [checking, setChecking] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const run = async () => {
    if (!vehicle.vin) { toast.error("No VIN to check"); return; }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { vin: vehicle.vin, tenant_id: vehicle.tenant_id } });
      if (error) throw error;
      const d = (data || {}) as { error?: string; recallStatus?: string; checkedAt?: string; openRecallCount?: number; recalls?: RecallItem[]; endpoint?: string };
      if (d.error === "not_configured") { toast.error("Recall lookup isn't configured yet (MarketCheck AutoRecalls key)."); setStatus("error"); }
      else if (d.error === "no_endpoint_matched") { toast.error("MarketCheck recall endpoint not reachable — likely no AutoRecalls access on the key."); setStatus("error"); }
      else if (d.recallStatus === "error") { toast.error("We could not check recalls right now. Try again."); setStatus("error"); }
      else {
        setStatus(d.recallStatus || "unknown"); setCheckedAt(d.checkedAt || null); setOpen(d.openRecallCount || 0); setRecalls(d.recalls || []);
        toast.success((d.openRecallCount || 0) > 0 ? `${d.openRecallCount} open recall${d.openRecallCount === 1 ? "" : "s"} found` : "No active recalls");
      }
    } catch { toast.error("We could not check recalls right now. Try again."); setStatus("error"); }
    finally { setChecking(false); }
  };

  const btn = (label: string) => (
    <button onClick={run} disabled={checking} className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-50">{checking ? "Checking…" : label}</button>
  );

  if (status === "open_recalls" && open > 0) {
    return (
      <>
        {/* Compact amber action card — attention, not alarm; never dumps the
            full recall text inline. */}
        <Card title="Recall Status" className="flex flex-col" action={
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Action Needed</span>
            {btn("Check again")}
          </div>
        }>
          <div className="flex items-start gap-2.5 flex-1">
            <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Recall Review Required</p>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">Open recall detected ({open} active). Service must confirm whether it is completed, no fix is available, or does not apply to this vehicle.</p>
            </div>
          </div>
          <div className="space-y-2 mt-auto pt-1">
            <button onClick={() => setDetailsOpen(true)} className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"><ShieldAlert className="w-3.5 h-3.5" /> Open recall review</button>
            <button onClick={() => setDetailsOpen(true)} className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"><FileText className="w-3.5 h-3.5" /> Add service note</button>
          </div>
        </Card>

        {/* Right slide-out — full OEM/NHTSA detail + the service outcome actions. */}
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-red-700"><ShieldAlert className="w-5 h-5" /> Recall Details</SheetTitle>
            </SheetHeader>
            <p className="text-[12px] text-muted-foreground mt-1">{open} active manufacturer recall{open === 1 ? "" : "s"} on this vehicle.</p>
            <div className="mt-4 space-y-3">
              {recalls.map((r, i) => (
                <div key={i} className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-red-700">{r.component || "Safety Recall"}</p>
                    {r.nhtsaCampaignNumber ? <span className="text-[10px] font-mono text-muted-foreground">{r.nhtsaCampaignNumber}</span> : null}
                  </div>
                  <p className="text-[12px] text-foreground mt-1 leading-relaxed">{r.summary || r.description || r.title}</p>
                  {r.consequence ? <p className="text-[11px] text-muted-foreground mt-1.5"><span className="font-semibold">Risk:</span> {r.consequence}</p> : null}
                  {r.remedy ? <p className="text-[11px] text-muted-foreground mt-1.5"><span className="font-semibold">Remedy:</span> {r.remedy}</p> : null}
                  {r.reportDate ? <p className="text-[10px] text-muted-foreground mt-1.5">Reported {r.reportDate}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <RecallReviewActions recall={recall} vehicle={vehicle} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  if (status === "error") {
    return (
      <Card title="Recall Status" className="flex flex-col" action={
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Error</span>
          {btn("Try again")}
        </div>
      }>
        <div className="flex items-center gap-2.5 flex-1">
          <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5" /></span>
          <div><p className="text-sm font-semibold text-foreground">Recall check failed</p><p className="text-[11px] text-muted-foreground">We could not check recalls right now. Try again.</p></div>
        </div>
      </Card>
    );
  }
  if (status === "clear") {
    return (
      <Card title="Recall Status" className="flex flex-col" action={
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Clear</span>
          {btn("Check again")}
        </div>
      }>
        <div className="flex items-center gap-2.5 flex-1">
          <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
          <div><p className="text-sm font-semibold text-foreground">No active recalls</p><p className="text-[11px] text-muted-foreground">Last checked {checkedAt ? new Date(checkedAt).toLocaleDateString() : "today"}</p></div>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Recall Status" className="flex flex-col" action={
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not checked</span>
        {btn("Run recall check")}
      </div>
    }>
      <div className="flex items-center gap-2.5 flex-1">
        <span className="w-9 h-9 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
        <div><p className="text-sm font-semibold text-foreground">Not checked yet</p><p className="text-[11px] text-muted-foreground">Recall status has not been checked yet.</p></div>
      </div>
    </Card>
  );
};

// MarketCheck market pricing + price position.
const MARKET_LABEL: Record<string, { label: string; cls: string; dot: string }> = {
  great_deal:   { label: "Great Deal",   cls: "text-emerald-700 bg-emerald-100", dot: "bg-emerald-500" },
  good_deal:    { label: "Good Deal",    cls: "text-emerald-700 bg-emerald-100", dot: "bg-emerald-500" },
  fair_deal:    { label: "Fair Price",   cls: "text-blue-700 bg-blue-100",       dot: "bg-blue-500" },
  above_market: { label: "Above Market", cls: "text-amber-700 bg-amber-100",     dot: "bg-amber-500" },
  unknown:      { label: "Not checked",  cls: "text-muted-foreground bg-muted",  dot: "bg-slate-400" },
};

const MarketPricingCard = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [pos, setPos] = useState<string>(vehicle.market_position || "unknown");
  const [market, setMarket] = useState<number | null>(vehicle.market_value);
  // How the stored value was produced: vehicle-enrich writes source
  // "comps_median" (raw comp prices, mileage-blind); the Refresh button's
  // predict call is mileage-adjusted. Label accordingly so the desk knows
  // what it's comparing against.
  const [valueSource, setValueSource] = useState<string>(((vehicle.market_payload as Record<string, unknown> | null)?.source as string) ?? ((vehicle.market_payload as Record<string, unknown> | null)?.rawProvider as string) ?? "");
  const [checking, setChecking] = useState(false);

  const run = async () => {
    if (!vehicle.vin) { toast.error("No VIN to check"); return; }
    if (!vehicle.price) { toast.error("Set a price on this vehicle first"); return; }
    if (!vehicle.tenant_id) { toast.error("This vehicle has no tenant assigned — market pricing needs one."); return; }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-market-pricing", { body: { vin: vehicle.vin, tenant_id: vehicle.tenant_id } });
      // Surface the server's actual message instead of a generic failure —
      // "authentication required" vs "listing_not_found" vs a crashed function
      // need very different fixes.
      if (error) {
        let detail = "";
        try { detail = String(await (error as { context?: Response }).context?.text?.() ?? "").slice(0, 120); } catch { /* ignore */ }
        toast.error(`Market pricing check failed${detail ? ` — ${detail}` : ""}`);
        return;
      }
      const d = (data || {}) as { error?: string; position?: string; marketValue?: number | null };
      if (d.error === "not_configured") toast.error("Market pricing isn't configured yet (MarketCheck key).");
      else if (d.error) toast.error(`Couldn't get a market value (${d.error}). Try again.`);
      else if (!d.marketValue) toast.error("Couldn't get a market value right now. Try again.");
      else { setPos(d.position || "unknown"); setMarket(d.marketValue ?? null); setValueSource("marketcheck_predict"); toast.success("Market price updated"); }
    } catch { toast.error("Market pricing check failed"); }
    finally { setChecking(false); }
  };

  const cfg = MARKET_LABEL[pos] || MARKET_LABEL.unknown;
  // The delta is derived from the two figures ON the card, never from a
  // stored belowMarket computed against an older price basis (which is how
  // "$24,876 vs $19,495" once labeled itself "$4,486 above market").
  const below = market != null && vehicle.price != null ? Math.round(market - vehicle.price) : 0;
  const valueLabel = valueSource === "comps_median" ? "Comp median (mileage-blind)" : valueSource === "marketcheck_predict" ? "Market average (mileage-adj.)" : "Market average";
  const publicUrl = `${window.location.origin}/v/${(vehicle.vin || vehicle.slug || "").toUpperCase()}`;
  const comps = (vehicle as unknown as { comparables?: { miles?: number | null }[] }).comparables;
  const compCount = Array.isArray(comps) ? comps.length : 0;
  const compMiles = Array.isArray(comps) ? comps.map((c) => Number(c?.miles)).filter((n) => Number.isFinite(n) && n > 0) : [];
  const avgCompMiles = compMiles.length >= 2 ? Math.round(compMiles.reduce((a, b) => a + b, 0) / compMiles.length) : null;

  return (
    <Card title="Market Pricing" className="flex flex-col" action={
      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {market ? (below > 0 ? "Below Market" : below < 0 ? "Above Market" : cfg.label) : cfg.label}
      </span>
    }>
      {market ? (
        <>
          <div className="flex-1 space-y-2.5">
            <div>
              <span className="font-display text-[30px] font-black tabular-nums text-foreground leading-none">{vehicle.price != null ? `$${vehicle.price.toLocaleString()}` : "—"}</span>
              <p className="text-[11px] text-muted-foreground mt-1">Current advertised price</p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 pt-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{valueLabel}</p>
                <p className="text-[15px] font-bold tabular-nums text-foreground mt-0.5">${market.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Market difference</p>
                <p className={`text-[15px] font-bold tabular-nums mt-0.5 ${below > 0 ? "text-emerald-600" : below < 0 ? "text-amber-600" : "text-foreground"}`}>
                  {below === 0 ? "At market" : `$${Math.abs(below).toLocaleString()} ${below > 0 ? "below" : "above"}`}
                </p>
              </div>
            </div>
            <p className="text-[12px] inline-flex items-center gap-1.5 text-emerald-700 font-semibold pt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Supported by market data{compCount > 0 ? ` · ${compCount} comparables` : ""}
            </p>
            {valueSource === "comps_median" && avgCompMiles != null && vehicle.mileage != null && vehicle.mileage < avgCompMiles * 0.7 && (
              <p className="text-[11px] text-muted-foreground">Comps average {Math.round((avgCompMiles - vehicle.mileage) / 1000)}k more miles than this vehicle — a raw comp median under-values it. Re-pull for a mileage-adjusted value.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto pt-1">
            {vehicle.status === "published"
              ? <a href={`${publicUrl}?panel=market-price`} target="_blank" rel="noreferrer" className="h-9 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"><ExternalLink className="w-3.5 h-3.5" /> View pricing report</a>
              : <button disabled title="Publish the vehicle to open the shopper pricing report" className="h-9 rounded-lg border border-border bg-card text-muted-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 opacity-50 cursor-not-allowed"><ExternalLink className="w-3.5 h-3.5" /> View pricing report</button>}
            <button onClick={run} disabled={checking} className="h-9 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> {checking ? "Syncing…" : "Re-pull market data"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground flex-1">No market price yet. Run a check to compare this vehicle's price to the MarketCheck market value and position.</p>
          <button onClick={run} disabled={checking} className="w-full h-9 mt-auto rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> {checking ? "Checking…" : "Check market price"}
          </button>
        </>
      )}
    </Card>
  );
};

// ── Shopper Focus — engagement snapshot for the health grid ──────────
// Big number is the listing's lifetime view_count; rows come from the
// passport_engagement module timers and customer_engagement_events. All
// fields are real-data gated — an empty packet shows an honest empty state.
const mmssLocal = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const FOCUS_MODULE_LABEL: Record<string, string> = {
  "vehicle-details": "Vehicle details", market: "Market intelligence", "market-price": "Price confidence",
  "price-history": "Price history", warranty: "Warranty", "factory-warranty": "Warranty",
  "vehicle-history": "Vehicle history", "great-buy": "Buying report", gallery: "Photos",
  highlights: "Highlights", overview: "Overview", "key-specs": "Specifications", equipment: "Equipment",
};
const focusLabel = (k: string) => FOCUS_MODULE_LABEL[k] || k.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const ShopperFocusCard = ({ vehicle, onTab }: { vehicle: VehicleRow; onTab: (t: TabId) => void }) => {
  const [stats, setStats] = useState<{ totalSeconds: number; sessions: number; topModule: string | null; lastEvent: string | null; ctaClicks: number; leads: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!vehicle.vin || !vehicle.tenant_id) { setStats({ totalSeconds: 0, sessions: 0, topModule: null, lastEvent: null, ctaClicks: 0, leads: 0 }); return; }
      try {
        const vin = vehicle.vin.toUpperCase();
        const [engRes, evRes] = await Promise.all([
          (supabase as any).from("passport_engagement").select("module, seconds, session_id").eq("tenant_id", vehicle.tenant_id).eq("vin", vin).limit(5000),
          (supabase as any).from("customer_engagement_events").select("event_type, created_at").eq("tenant_id", vehicle.tenant_id).eq("vin", vin).order("created_at", { ascending: false }).limit(2000),
        ]);
        const eng = (engRes.data || []) as { module: string; seconds: number; session_id: string }[];
        const evs = (evRes.data || []) as { event_type: string; created_at: string }[];
        const by = new Map<string, number>();
        const sess = new Set<string>();
        for (const r of eng) { by.set(r.module, (by.get(r.module) || 0) + (r.seconds || 0)); sess.add(r.session_id); }
        const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        if (!cancelled) setStats({
          totalSeconds: eng.reduce((t, r) => t + (r.seconds || 0), 0),
          sessions: sess.size,
          topModule: top,
          lastEvent: evs[0]?.created_at ?? null,
          ctaClicks: evs.filter((e) => e.event_type === "cta_clicked").length,
          leads: evs.filter((e) => e.event_type === "lead_form_opened").length,
        });
      } catch {
        if (!cancelled) setStats({ totalSeconds: 0, sessions: 0, topModule: null, lastEvent: null, ctaClicks: 0, leads: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin, vehicle.tenant_id]);

  const views = vehicle.view_count || 0;
  const empty = !stats || (views === 0 && stats.sessions === 0 && !stats.lastEvent);

  return (
    <Card title="Shopper Focus" className="flex flex-col" action={
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">All time</span>
    }>
      {!stats ? (
        <p className="text-xs text-muted-foreground flex-1">Loading engagement…</p>
      ) : empty ? (
        <p className="text-sm text-muted-foreground flex-1">No shopper sessions recorded yet. Engagement appears here once a customer opens this vehicle's passport.</p>
      ) : (
        <div className="flex-1 space-y-2.5">
          <div className="flex items-end gap-2">
            <span className="font-display text-[30px] font-black tabular-nums text-foreground leading-none">{views.toLocaleString()}</span>
            <span className="text-[11px] text-muted-foreground pb-0.5">shopper view{views === 1 ? "" : "s"}</span>
          </div>
          <div className="space-y-2 pt-1">
            <StatRow label="Last viewed" value={fmtWhen(stats.lastEvent) ?? "—"} />
            <StatRow label="CTA clicks" value={stats.ctaClicks.toLocaleString()} />
            <StatRow label="Lead forms opened" value={stats.leads.toLocaleString()} />
            <StatRow label="Time on packet" value={stats.totalSeconds > 0 ? mmssLocal(stats.totalSeconds) : "—"} />
            <StatRow label="Sessions" value={stats.sessions.toLocaleString()} />
          </div>
          {stats.topModule && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-1"><Tag className="w-3 h-3" /> Most interest: {focusLabel(stats.topModule)}</span>
          )}
        </div>
      )}
      <button onClick={() => onTab("customer")} className="mt-auto pt-1 text-[12px] font-semibold text-blue-600 hover:underline inline-flex items-center justify-center gap-1 w-full">View shopper activity <ChevronRight className="w-3.5 h-3.5" /></button>
    </Card>
  );
};

export default VehicleFile;
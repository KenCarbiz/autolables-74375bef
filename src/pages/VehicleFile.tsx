import { useEffect, useMemo, useState } from "react";
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
  ChevronRight, CircleAlert, Activity,
} from "lucide-react";
import { formatPhone, composeName } from "@/components/addendum/CustomerInfoSection";
import EmptyState from "@/components/ui/empty-state";
import { InstallProofList } from "@/components/admin/InstallProofList";
import { useVehicleSpecs } from "@/hooks/useVehicleSpecs";
import { PACKET_MODULES, packetVisible } from "@/lib/packetModules";
import { QRCodeSVG } from "qrcode.react";
import GeneratedDocumentsSection from "@/components/vehicle/GeneratedDocumentsSection";
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
  recall_payload: { recalls?: RecallItem[] } | null;
  market_value: number | null;
  market_position: string | null;
  market_payload: { listingPrice?: number | null; low?: number | null; high?: number | null; belowMarket?: number } | null;
  created_at: string;
  updated_at: string;
}

interface RecallItem { title?: string; component?: string; reportDate?: string; remedy?: string; status?: string; nhtsaCampaignNumber?: string; }

const VALID_TABS: TabId[] = ["overview", "documents", "scan", "customer", "addendum", "prep", "labels", "sign", "evidence"];

interface ReadyCheck { ok: boolean; label: string; when: string | null; blocks?: boolean }

// Single readiness model used by both the header banner and the Overview
// readiness card, so the two never disagree. `blocks` marks a check that
// gates publishing to the shopper portal.
const buildChecks = (v: VehicleRow): ReadyCheck[] => [
  { ok: true, label: "Vehicle created", when: v.created_at },
  { ok: !!v.ymm, label: "VIN decoded", when: v.ymm ? v.updated_at : null },
  { ok: v.status === "published", label: "Published to shopper portal", when: v.published_at, blocks: true },
  { ok: !!v.recall_check, label: "Recall checked", when: null },
  { ok: !!v.prep_status?.foreman_signed_at, label: "Prep & install signed off", when: v.prep_status?.foreman_signed_at || null },
  { ok: (v.documents?.length || 0) > 0, label: "Documents attached", when: null },
  { ok: (v.service_records?.length || 0) > 0, label: "Service history", when: null },
  { ok: !!v.warranty_info && Object.keys(v.warranty_info).length > 0, label: "Remaining warranty", when: null },
  { ok: (v.available_accessories?.length || 0) > 0, label: "Available accessories", when: null },
];

const readinessSummary = (v: VehicleRow) => {
  const checks = buildChecks(v);
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  return { checks, done, pct, remaining: checks.filter((c) => !c.ok) };
};

// Short pill labels for the readiness status bar's "Missing:" chips.
const shortCheck = (label: string): string => (({
  "Vehicle created": "Created",
  "VIN decoded": "VIN",
  "Published to shopper portal": "Publish",
  "Recall checked": "Recall",
  "Prep & install signed off": "Prep & Install",
  "Documents attached": "Documents",
  "Service history": "Service",
  "Remaining warranty": "Warranty",
  "Available accessories": "Accessories",
} as Record<string, string>)[label] || label);

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

  const ready = readinessSummary(vehicle);
  const heroMc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
  const stockNo = (heroMc.stock_no as string) || ((vehicle.sticker_snapshot?.decoded as Record<string, unknown> | undefined)?.stock as string) || null;
  const gallery: string[] = (vehicle.photos && vehicle.photos.length ? vehicle.photos : (vehicle.hero_image_url ? [vehicle.hero_image_url] : []));
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
            {/* Vehicle photo */}
            <div className={`lg:w-[340px] shrink-0 h-56 lg:h-[248px] rounded-2xl overflow-hidden flex items-center justify-center bg-gradient-to-br ${
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
                  <h1 className="text-[30px] sm:text-[40px] lg:text-[46px] font-black tracking-[-0.02em] font-display text-foreground leading-[1]">
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

              {/* Readiness status bar — compact (~72px), bottom-aligned with
                  the photo. Always communicates remaining work, including for
                  published vehicles. */}
              <div className={`mt-5 lg:mt-auto rounded-xl border px-4 py-3 flex items-center gap-4 ${
                vehicle.status === "published" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
              }`}>
                <ReadinessRing pct={ready.pct} tone={vehicle.status === "published" ? "emerald" : "amber"} />
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${vehicle.status === "published" ? "text-emerald-800" : "text-amber-800"}`}>
                    {vehicle.status === "published" ? "Published vehicle" : "Draft vehicle"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {vehicle.status === "published"
                      ? "Live on the shopper portal."
                      : ready.remaining.length === 0
                        ? "All set — click Publish to Shopper Portal."
                        : "This vehicle is not ready to publish"}
                  </p>
                </div>
                {ready.remaining.length > 0 && (
                  <div className="hidden sm:flex items-center gap-2 lg:ml-auto min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">Missing:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ready.remaining.slice(0, 4).map((c) => (
                        <span key={c.label} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white border text-[11px] font-semibold ${c.blocks ? "text-red-700 border-red-200" : "text-amber-700 border-amber-200"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.blocks ? "bg-red-500" : "bg-amber-500"}`} />
                          {shortCheck(c.label)}
                        </span>
                      ))}
                      {ready.remaining.length > 4 && (
                        <span className="text-[11px] font-semibold text-muted-foreground">+{ready.remaining.length - 4}</span>
                      )}
                    </div>
                  </div>
                )}
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
        {tab === "overview"  && <OverviewPanel vehicle={vehicle} onTab={setTab} />}
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

const OverviewPanel = ({ vehicle, onTab }: { vehicle: VehicleRow; onTab: (t: TabId) => void }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const { fetchSpecs, loading: pullingSpecs } = useVehicleSpecs();
  const [pulledOptions, setPulledOptions] = useState<string[]>([]);

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

  const { checks, pct, remaining } = readinessSummary(vehicle);
  const notReady = pct < 100;
  const ringTone = pct === 100 ? "#10B981" : pct >= 60 ? "#2563EB" : "#F59E0B";
  const decoded = (vehicle.sticker_snapshot?.decoded as Record<string, unknown> | undefined) || undefined;
  const publicUrl = `${window.location.origin}/v/${(vehicle.vin || vehicle.slug || "").toUpperCase()}`;

  const quick: { label: string; icon: typeof Car; tone: string; onClick: () => void }[] = [
    { label: "Generate Sticker", icon: Printer, tone: "bg-indigo-50 text-indigo-600", onClick: () => onTab("labels") },
    { label: "Create Addendum", icon: FileText, tone: "bg-violet-50 text-violet-600", onClick: () => onTab("addendum") },
    { label: "Upload Documents", icon: Upload, tone: "bg-slate-100 text-slate-600", onClick: () => onTab("documents") },
    { label: "Customer Sign-off", icon: Signature, tone: "bg-fuchsia-50 text-fuchsia-600", onClick: () => onTab("sign") },
    { label: "Publish Vehicle", icon: Globe, tone: "bg-emerald-50 text-emerald-600", onClick: () => onTab("labels") },
    { label: "Open Shopper Portal", icon: ExternalLink, tone: "bg-blue-50 text-blue-600", onClick: () => window.open(publicUrl, "_blank", "noopener") },
  ];

  const mc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
  // Left-column key specs for Vehicle Information.
  const specs = ([
    ["Trim", vehicle.trim ?? decoded?.trim ?? null],
    ["Engine", mc.engine ?? decoded?.engine ?? null],
    ["Drivetrain", mc.drivetrain ?? null],
    ["Exterior Color", mc.exterior_color ?? null],
    ["Interior Color", mc.interior_color ?? null],
    ["Fuel Type", mc.fuel_type ?? decoded?.fuelType ?? null],
  ] as [string, unknown][])
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([label, v]) => ({ label, value: String(v) }));

  // Market & history insights from the MarketCheck feed (one-owner, clean
  // title, days-on-market, price movement, seller type).
  const mcStrArr = (v: unknown): string[] => Array.isArray(v)
    ? v.map((x) => typeof x === "string" ? x : (x && typeof x === "object" ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).label ?? (x as Record<string, unknown>).description ?? "") : String(x ?? ""))).filter(Boolean)
    : [];
  const optionsList = Array.from(new Set([...mcStrArr(mc.options), ...mcStrArr(mc.features), ...pulledOptions]));
  const handlePullSpecs = async () => {
    const r = await fetchSpecs({ vin: vehicle.vin, tenantId: vehicle.tenant_id, vehicleId: vehicle.id });
    if (r) setPulledOptions([...r.options, ...r.features]);
  };
  // Customer-packet completeness — nine shareable signals.
  const packetItems: { label: string; ok: boolean }[] = [
    { label: "VIN decoded", ok: !!vehicle.ymm },
    { label: "Photos", ok: (vehicle.photos?.length || 0) > 0 },
    { label: "Description", ok: !!(vehicle as unknown as Record<string, unknown>).description },
    { label: "Recall checked", ok: !!vehicle.recall_status },
    { label: "Documents", ok: (vehicle.documents?.length || 0) > 0 },
    { label: "Sticker published", ok: vehicle.status === "published" },
    { label: "Warranty info", ok: !!vehicle.warranty_info && Object.keys(vehicle.warranty_info).length > 0 },
    { label: "Service history", ok: (vehicle.service_records?.length || 0) > 0 },
    { label: "Accessories", ok: (vehicle.available_accessories?.length || 0) > 0 },
  ];
  const packetDone = packetItems.filter((p) => p.ok).length;
  const packetPct = Math.round((packetDone / packetItems.length) * 100);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-4">
        {/* Vehicle Readiness */}
        <Card title="Vehicle Readiness" action={<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${notReady ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{pct}% · {notReady ? "Not ready" : "Ready"}</span>}>
          <div className="flex items-center gap-6">
            <div className="relative w-[144px] h-[144px] shrink-0">
              <svg className="w-[144px] h-[144px] -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="9" className="text-muted" />
                <circle cx="60" cy="60" r="52" fill="none" stroke={ringTone} strokeWidth="9" strokeLinecap="round" strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-700" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-[36px] font-black tabular-nums text-foreground leading-none">{pct}%</span>
                <span className={`text-[11px] font-bold uppercase tracking-wide mt-0.5 ${notReady ? "text-amber-600" : "text-emerald-600"}`}>{notReady ? "Not Ready" : "Ready"}</span>
              </div>
            </div>
            <ul className="flex-1 space-y-2 min-w-0">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <CircleAlert className="w-4 h-4 text-amber-500 shrink-0" />}
                    <span className={`truncate ${c.ok ? "text-foreground font-medium" : "text-muted-foreground"}`}>{c.label}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{c.when ? new Date(c.when).toLocaleDateString() : "pending"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between pt-3 mt-1 border-t border-border">
            <span className="text-[11px] font-semibold text-amber-600">{remaining.length} task{remaining.length === 1 ? "" : "s"} remaining</span>
            <button onClick={() => onTab("labels")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1">View all tasks <ChevronRight className="w-3 h-3" /></button>
          </div>
        </Card>

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
          <div className="space-y-2">
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

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-4">
        {/* Vehicle Information — specs + packages */}
        <Card title="Vehicle Information" action={<button onClick={() => onTab("scan")} className="text-[11px] font-semibold text-blue-600 hover:underline">Edit</button>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <div className="space-y-2">
              {specs.length > 0 ? specs.map((e) => (
                <div key={e.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{e.label}</span>
                  <span className="font-medium text-foreground text-right truncate">{e.value}</span>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">Decode the VIN to populate specs.</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Packages &amp; Options</p>
              {optionsList.length > 0 ? (
                <ul className="space-y-1.5">
                  {optionsList.slice(0, 6).map((o) => (
                    <li key={o} className="flex items-center gap-1.5 text-sm text-foreground"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /><span className="truncate">{o}</span></li>
                  ))}
                  {optionsList.length > 6 && (
                    <li><button onClick={() => onTab("scan")} className="text-[11px] font-semibold text-blue-600 hover:underline">View all ({optionsList.length})</button></li>
                  )}
                </ul>
              ) : (
                <button onClick={handlePullSpecs} disabled={pullingSpecs || !vehicle.vin} className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-50 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" />{pullingSpecs ? "Pulling…" : "Pull factory options"}</button>
              )}
            </div>
          </div>
        </Card>

        {/* Recall + Packet Completeness, stacked */}
        <div className="space-y-4">
          <RecallCard vehicle={vehicle} />
          <Card title="Packet Completeness">
            <div className="flex items-end justify-between gap-2">
              <span className="font-display text-3xl font-black tabular-nums text-foreground leading-none">{packetPct}%</span>
              <span className="text-xs text-muted-foreground">{packetDone} of {packetItems.length} complete</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden mt-2">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${packetPct}%` }} />
            </div>
            <button onClick={() => onTab("scan")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1 mt-1">View details <ChevronRight className="w-3 h-3" /></button>
          </Card>
        </div>

        {/* Shopper Portal Preview */}
        <Card title="Shopper Portal Preview">
          <div className="flex items-stretch gap-3">
            <div className="flex-1 rounded-xl border border-border/70 bg-muted/40 h-32 overflow-hidden flex items-center justify-center text-muted-foreground">
              {vehicle.hero_image_url || (vehicle.photos && vehicle.photos[0]) ? (
                <img src={vehicle.hero_image_url || vehicle.photos![0]} alt={vehicle.ymm || "vehicle"} className="w-full h-full object-cover" />
              ) : (
                <Car className="w-9 h-9" strokeWidth={1.25} />
              )}
            </div>
            <div className="w-32 h-32 rounded-xl border border-border/70 bg-white p-2 shrink-0 flex flex-col items-center justify-center gap-1">
              <QRCodeSVG value={publicUrl} size={92} />
              <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Scan to view</span>
            </div>
          </div>
          {vehicle.status === "published"
            ? <a href={publicUrl} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 font-mono break-all hover:underline bg-blue-50/60 rounded-lg px-2.5 py-1.5">{publicUrl}</a>
            : <span className="block text-xs text-muted-foreground font-mono break-all bg-muted/40 rounded-lg px-2.5 py-1.5">{publicUrl}</span>
          }
          <div className="grid grid-cols-2 gap-2">
            {vehicle.status === "published"
              ? <a href={publicUrl} target="_blank" rel="noreferrer" className="h-9 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Preview Page</a>
              : <button disabled className="h-9 rounded-lg border border-border bg-card text-muted-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 opacity-50 cursor-not-allowed"><ExternalLink className="w-3.5 h-3.5" /> Preview Page</button>
            }
            <button onClick={() => vehicle.status === "published" ? window.open(publicUrl, "_blank", "noopener") : onTab("labels")} className="h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5">
              {vehicle.status === "published" ? <><Globe className="w-3.5 h-3.5" /> Open in Shopper Portal</> : <><Printer className="w-3.5 h-3.5" /> Generate Sticker</>}
            </button>
          </div>
          {vehicle.status !== "published" && <p className="text-[10px] text-muted-foreground">Publish to make this page live for shoppers.</p>}
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
  const opState = (settings.dealer_state || settings.doc_fee_state || "").toUpperCase();
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
      <div className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-5">
        <GeneratedDocumentsSection vehicleId={vehicle.id} />
      </div>
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
const ScanInfoPanel = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [records, setRecords] = useState<ServiceRecord[]>(vehicle.service_records || []);
  const [warranty, setWarranty] = useState<WarrantyInfo>(vehicle.warranty_info || {});
  const [accessories, setAccessories] = useState<AvailableAccessory[]>(vehicle.available_accessories || []);
  const [packetModules, setPacketModules] = useState<Record<string, boolean>>(vehicle.packet_modules || {});
  const [saving, setSaving] = useState(false);

  const toggleModule = (id: string) =>
    setPacketModules((prev) => ({ ...prev, [id]: prev[id] === false }));

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

      {/* Passport modules — module cards, same language as Documents */}
      <div>
        <h3 className="text-[15px] font-bold text-foreground">Passport Modules</h3>
        <p className="text-[13px] text-slate-500 mt-0.5">Toggle the sections shoppers see. Recall, price, and verified installs always show.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
          {PACKET_MODULES.map((m) => {
            const on = packetVisible({ packet_modules: packetModules }, m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleModule(m.id)}
                aria-pressed={on}
                className={`text-left rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-3 min-h-[150px] transition hover:shadow-md ${on ? "border-border" : "border-border opacity-75"}`}
              >
                <h4 className="text-sm font-bold text-foreground">{m.label}</h4>
                <p className="text-[13px] text-slate-500 leading-relaxed flex-1">{m.desc}</p>
                <span className={`inline-flex items-center gap-1.5 self-start h-7 px-3 rounded-full text-xs font-semibold ${on ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-400"}`} /> {on ? "Enabled" : "Disabled"}
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
    if (vehicle.vin) params.set("vin", vehicle.vin);
    if (vehicle.ymm) params.set("ymm", vehicle.ymm);
    if (vehicle.trim) params.set("trim", vehicle.trim);
    if (vehicle.mileage != null) params.set("mileage", String(vehicle.mileage));
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
        <button
          onClick={startAddendum}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Addendum
        </button>
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

// Compact SVG progress ring for the readiness banner.
const ReadinessRing = ({ pct, tone }: { pct: number; tone: "emerald" | "amber" }) => {
  const r = 16;
  const c = 2 * Math.PI * r;
  const stroke = tone === "emerald" ? "#10B981" : "#F59E0B";
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
        <circle
          cx="20" cy="20" r={r} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums text-foreground">{pct}%</span>
    </div>
  );
};

const Item = ({ ok, label, when }: { ok: boolean; label: string; when: string | null }) => (
  <li className="flex items-center justify-between gap-2">
    <span className="inline-flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300"}`} />
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
    <span className="text-[10px] text-muted-foreground">
      {when ? new Date(when).toLocaleDateString() : "pending"}
    </span>
  </li>
);

// MarketCheck AutoRecalls — live 4-state card (clear / open / unknown / error).
const RecallCard = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [status, setStatus] = useState<string | null>(vehicle.recall_status);
  const [checkedAt, setCheckedAt] = useState<string | null>(vehicle.recall_checked_at);
  const [open, setOpen] = useState<number>(vehicle.open_recall_count ?? 0);
  const [recalls, setRecalls] = useState<RecallItem[]>(vehicle.recall_payload?.recalls || []);
  const [checking, setChecking] = useState(false);

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
      <Card title="Recall Status" action={btn("Check again")}>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
          <div><p className="text-sm font-semibold text-red-700">Open recalls found</p><p className="text-[11px] text-muted-foreground">{open} open recall{open === 1 ? "" : "s"} may require attention before publishing.</p></div>
        </div>
        <ul className="mt-2 space-y-2">
          {recalls.slice(0, 4).map((r, i) => (
            <li key={i} className="rounded-lg border border-red-200 bg-red-50/50 p-2">
              <p className="text-xs font-semibold text-foreground">{r.title || "Recall"}</p>
              <p className="text-[11px] text-muted-foreground">{[r.component, r.reportDate].filter(Boolean).join(" · ")}</p>
              {r.remedy ? <p className="text-[11px] text-muted-foreground mt-0.5">Remedy: {r.remedy}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  if (status === "error") {
    return (
      <Card title="Recall Status" action={btn("Try again")}>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5" /></span>
          <div><p className="text-sm font-semibold text-foreground">Recall check failed</p><p className="text-[11px] text-muted-foreground">We could not check recalls right now. Try again.</p></div>
        </div>
      </Card>
    );
  }
  if (status === "clear") {
    return (
      <Card title="Recall Status" action={btn("Check again")}>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
          <div><p className="text-sm font-semibold text-foreground">No active recalls</p><p className="text-[11px] text-muted-foreground">Last checked {checkedAt ? new Date(checkedAt).toLocaleDateString() : "today"}</p></div>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Recall Status" action={btn("Run recall check")}>
      <div className="flex items-center gap-2.5">
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
  const [below, setBelow] = useState<number>(vehicle.market_payload?.belowMarket ?? 0);
  const [checking, setChecking] = useState(false);

  const run = async () => {
    if (!vehicle.vin) { toast.error("No VIN to check"); return; }
    if (!vehicle.price) { toast.error("Set a price on this vehicle first"); return; }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-market-pricing", { body: { vin: vehicle.vin, tenant_id: vehicle.tenant_id } });
      if (error) throw error;
      const d = (data || {}) as { error?: string; position?: string; marketValue?: number | null; belowMarket?: number };
      if (d.error === "not_configured") toast.error("Market pricing isn't configured yet (MarketCheck key).");
      else if (!d.marketValue) toast.error("Couldn't get a market value right now. Try again.");
      else { setPos(d.position || "unknown"); setMarket(d.marketValue ?? null); setBelow(d.belowMarket ?? 0); toast.success("Market price updated"); }
    } catch { toast.error("Market pricing check failed"); }
    finally { setChecking(false); }
  };

  const cfg = MARKET_LABEL[pos] || MARKET_LABEL.unknown;
  const action = (
    <button onClick={run} disabled={checking} className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-50">
      {checking ? "Checking…" : market ? "Refresh" : "Check market price"}
    </button>
  );

  return (
    <Card title="Market Pricing" action={action}>
      {market ? (
        <div className="space-y-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-lg ${cfg.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
            {below > 0 ? ` · $${below.toLocaleString()} below market` : below < 0 ? ` · $${(-below).toLocaleString()} above market` : ""}
          </span>
          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-muted-foreground">Your price</span>
            <span className="font-semibold tabular-nums text-foreground">{vehicle.price ? `$${vehicle.price.toLocaleString()}` : "—"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Market value</span>
            <span className="font-semibold tabular-nums text-foreground">${market.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No market price yet. Run a check to compare this vehicle's price to the MarketCheck market value and position.</p>
      )}
    </Card>
  );
};

export default VehicleFile;

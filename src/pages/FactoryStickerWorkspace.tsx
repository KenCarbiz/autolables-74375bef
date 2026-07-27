import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { listingHero } from "@/lib/photos";
import { buildRenderLayout } from "@/lib/factorySticker/render/contract.ts";
import type { FactoryStickerRenderData, FactoryStickerTheme } from "@/lib/factorySticker/render/contract.ts";
import { layoutToSvg } from "@/lib/factorySticker/render/previewSvg.ts";
import type { LayoutModel } from "@/lib/factorySticker/render/layout.ts";
import {
  bmwFixture,
  chevroletFixture,
  evFixture,
  genericDecodeFixture,
  infinitiBenchmark,
  jeep4xeFixture,
  jeepFixture,
  lexusFixture,
  longEquipmentFixture,
  newConditionBenchmark,
  nissanBenchmark,
  noEpaFixture,
  genesisEvFixture,
  genesisG90LongFixture,
  genesisGv80Fixture,
  kiaEvFixture,
  kiaHybridFixture,
  kiaPhevFixture,
  kiaTellurideFixture,
  kiaTellurideLongFixture,
  acuraLongFixture,
  acuraRdxFixture,
  acuraZdxFixture,
  infinitiQx80NewFixture,
  hondaCrvHybridFixture,
  hondaLongFixture,
  hondaPilotFixture,
  hondaPrologueFixture,
  hyundaiIoniq5Fixture,
  hyundaiLongFixture,
  hyundaiPalisadeFixture,
  hyundaiTucsonHybridFixture,
  mazdaCx90Fixture,
  mazdaLongFixture,
  mazdaMiataFixture,
  mazdaPhevFixture,
  subaruAscentLongFixture,
  subaruOutbackFixture,
  subaruSolterraFixture,
  themeFor,
  toyotaFixture,
} from "@/lib/factorySticker/render/__fixtures__/renderData.ts";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Download,
  ExternalLink, FileText, Globe, History, Loader2, Printer, RefreshCw, XCircle,
} from "lucide-react";

// Dedicated Factory Window Sticker workspace: left = vehicle + data status,
// center = large live document preview rendered by the same deterministic
// layout engine the PDF uses, right = validation + publication. Every badge
// is backed by a stored result on factory_sticker_records / the current
// generated_documents row — a check that has not run shows "Not run", never
// a decorative pass. Fixture mode (/dev/factory-sticker-preview) renders the
// QX80 benchmark with zero database reads and no publication actions.

interface RecordRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  vin: string;
  generation_status: string;
  source_provider: string | null;
  source_classification: string | null;
  confidence_level: string | null;
  verification_status: string | null;
  reconciliation_status: string | null;
  reconciliation_difference: number | null;
  review_required: boolean;
  review_reason: string | null;
  normalized_data_json: FactoryStickerRenderData | null;
  canonical_oem_id: string | null;
  detected_make_value: string | null;
  oem_resolution_confidence: string | null;
  oem_theme_id: string | null;
  oem_theme_version: string | null;
  template_family_id: string | null;
  template_version: string | null;
  renderer_version: string | null;
  logo_asset_id: string | null;
  logo_asset_version: string | null;
  passport_slug: string | null;
  canonical_passport_url: string | null;
  qr_payload: string | null;
  qr_identity_qa_status: string | null;
  barcode_payload: string | null;
  barcode_identity_qa_status: string | null;
  visual_qa_status: string | null;
  qa_metadata: Record<string, unknown> | null;
  current_document_id: string | null;
  attempt_count: number;
  last_error: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  updated_at: string | null;
}

interface DocRow {
  id: string;
  version: number;
  document_status: string;
  pdf_url: string | null;
  online_url: string | null;
  published_at: string | null;
  created_at: string | null;
}

interface VehicleRow {
  id: string;
  tenant_id: string | null;
  vin: string | null;
  slug: string | null;
  status: string | null;
  condition: string | null;
  hero_image_url: string | null;
  photos: string[] | null;
  mc_attributes: Record<string, unknown> | null;
  sticker_snapshot: Record<string, unknown> | null;
  oem_sticker_url: string | null;
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

type Tone = "pass" | "fail" | "warn" | "info" | "off";
const TONE_CLASS: Record<Tone, string> = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fail: "bg-rose-50 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  off: "bg-slate-50 text-slate-500 border-slate-200",
};

const Badge = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${TONE_CLASS[tone]}`}>
    {tone === "pass" && <CheckCircle2 className="w-3 h-3" />}
    {tone === "fail" && <XCircle className="w-3 h-3" />}
    {tone === "warn" && <AlertTriangle className="w-3 h-3" />}
    {children}
  </span>
);

const qaTone = (s: string | null | undefined): Tone => (s === "PASS" ? "pass" : s === "FAIL" ? "fail" : "off");
const qaLabel = (s: string | null | undefined): string => (s === "PASS" ? "Passed" : s === "FAIL" ? "Failed" : "Not run");

const StatusRow = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) => (
  <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    {tone ? <Badge tone={tone}>{value}</Badge> : <span className="text-[11px] font-semibold text-foreground text-right">{value}</span>}
  </div>
);

const FIXTURE_SCENARIOS = {
  used: { label: "Used QX80", data: infinitiBenchmark },
  infinitinew: { label: "INFINITI QX80 (new)", data: infinitiQx80NewFixture },
  new: { label: "New vehicle", data: newConditionBenchmark },
  generic: { label: "Generic decode", data: genericDecodeFixture },
  twopage: { label: "Two-page overflow", data: longEquipmentFixture },
  nissan: { label: "Nissan profile", data: nissanBenchmark },
  jeep: { label: "Jeep Wrangler", data: jeepFixture },
  jeep4xe: { label: "Jeep 4xe PHEV", data: jeep4xeFixture },
  toyota: { label: "Toyota", data: toyotaFixture },
  lexus: { label: "Lexus", data: lexusFixture },
  chevrolet: { label: "Chevrolet", data: chevroletFixture },
  bmw: { label: "BMW", data: bmwFixture },
  genesis: { label: "Genesis GV80", data: genesisGv80Fixture },
  genesisev: { label: "Genesis Electrified GV70", data: genesisEvFixture },
  genesislong: { label: "Genesis G90 (2-page)", data: genesisG90LongFixture },
  genesisqa: {
    label: "Genesis QA blocked",
    data: () => {
      const d = genesisGv80Fixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "KMUHCESC5SU999999";
      return d;
    },
  },
  kia: { label: "Kia Telluride", data: kiaTellurideFixture },
  kiahybrid: { label: "Kia Sportage HEV", data: kiaHybridFixture },
  kiaphev: { label: "Kia Sportage PHEV", data: kiaPhevFixture },
  kiaev: { label: "Kia EV9", data: kiaEvFixture },
  kialong: { label: "Kia X-Pro (2-page)", data: kiaTellurideLongFixture },
  kiaqa: {
    label: "Kia QA blocked",
    data: () => {
      const d = kiaTellurideFixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "5XYP5DGC0TG999999";
      return d;
    },
  },
  mazda: { label: "Mazda CX-90", data: mazdaCx90Fixture },
  mazdaphev: { label: "Mazda CX-90 PHEV", data: mazdaPhevFixture },
  mazdamiata: { label: "Mazda MX-5 RF", data: mazdaMiataFixture },
  mazdalong: { label: "Mazda CX-90 (2-page)", data: mazdaLongFixture },
  mazdaqa: {
    label: "Mazda QA blocked",
    data: () => {
      const d = mazdaCx90Fixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "JM3KKEHC7T1999999";
      return d;
    },
  },
  subaru: { label: "Subaru Outback", data: subaruOutbackFixture },
  subaruev: { label: "Subaru Solterra", data: subaruSolterraFixture },
  subarulong: { label: "Subaru Ascent (2-page)", data: subaruAscentLongFixture },
  subaruqa: {
    label: "Subaru QA blocked",
    data: () => {
      const d = subaruOutbackFixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "4S4BTGPD0T3999999";
      return d;
    },
  },
  honda: { label: "Honda CR-V Hybrid", data: hondaCrvHybridFixture },
  hondapilot: { label: "Honda Pilot", data: hondaPilotFixture },
  hondaev: { label: "Honda Prologue", data: hondaPrologueFixture },
  hondalong: { label: "Honda Pilot (2-page)", data: hondaLongFixture },
  hondaqa: {
    label: "Honda QA blocked",
    data: () => {
      const d = hondaCrvHybridFixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "7FARS6H93TE999999";
      return d;
    },
  },
  hyundai: { label: "Hyundai Palisade", data: hyundaiPalisadeFixture },
  hyundaiev: { label: "Hyundai IONIQ 5", data: hyundaiIoniq5Fixture },
  hyundaihev: { label: "Hyundai Tucson HEV", data: hyundaiTucsonHybridFixture },
  hyundailong: { label: "Hyundai Palisade (2-page)", data: hyundaiLongFixture },
  hyundaiqa: {
    label: "Hyundai QA blocked",
    data: () => {
      const d = hyundaiPalisadeFixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "KM8R7DGE8TU999999";
      return d;
    },
  },
  acura: { label: "Acura RDX", data: acuraRdxFixture },
  acuraev: { label: "Acura ZDX", data: acuraZdxFixture },
  acuralong: { label: "Acura MDX (2-page)", data: acuraLongFixture },
  acuraqa: {
    label: "Acura QA blocked",
    data: () => {
      const d = acuraRdxFixture();
      d.pricing = { ...d.pricing, destinationCharge: null };
      d.barcodePayload = "5J8TC2H86SL999999";
      return d;
    },
  },
  ev: { label: "EV (Ariya)", data: evFixture },
  noepa: { label: "Missing EPA", data: noEpaFixture },
  msrpvar: {
    label: "MSRP discrepancy",
    data: () => {
      const d = infinitiBenchmark();
      d.pricing = { ...d.pricing, totalMsrp: 96500 };
      return d;
    },
  },
  nodest: {
    label: "Missing destination",
    data: () => {
      const d = infinitiBenchmark();
      d.pricing = { ...d.pricing, destinationCharge: null };
      return d;
    },
  },
  qamismatch: {
    label: "Passport mismatch (blocked)",
    data: () => {
      const d = infinitiBenchmark();
      d.barcodePayload = "JN8AZ3NE5S9999999";
      return d;
    },
  },
} as const;

const GEN_STATUS_TONE: Record<string, Tone> = {
  PUBLISHED: "pass", APPROVED: "info", REVIEW_REQUIRED: "warn", PENDING_DATA: "warn",
  READY_TO_GENERATE: "info", GENERATING: "info", NORMALIZING: "info", VALIDATING: "info",
  RUNNING_QA: "info", FAILED_RETRYABLE: "fail", FAILED_PERMANENT: "fail",
  SUPERSEDED: "off", ARCHIVED: "off",
};

export default function FactoryStickerWorkspace({ fixture = false }: { fixture?: boolean }) {
  const { vehicleId } = useParams();
  const { isAdmin } = useAuth();
  const entitlements = useEntitlements();
  const manager = fixture ? false : hasDealerCapability(entitlements.member?.role, "can_approve_print", isAdmin);

  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(!fixture);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [scenario, setScenario] = useState<keyof typeof FIXTURE_SCENARIOS>("used");
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async () => {
    if (fixture || !vehicleId) return;
    try {
      const { data: v, error: ve } = await supabase
        .from("vehicle_listings")
        .select("id, tenant_id, vin, slug, status, condition, hero_image_url, photos, mc_attributes, sticker_snapshot, oem_sticker_url")
        .eq("id", vehicleId)
        .maybeSingle();
      if (ve) throw ve;
      if (!v) { setLoadError("Vehicle not found or not visible to your account."); setLoading(false); return; }
      setVehicle(v as unknown as VehicleRow);
      // deno-lint-ignore no-explicit-any
      const { data: rec, error: re } = await (supabase as any)
        .from("factory_sticker_records")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (re) throw re;
      setRecord((rec as RecordRow) || null);
      // deno-lint-ignore no-explicit-any
      const { data: history } = await (supabase as any)
        .from("generated_documents")
        .select("id, version, document_status, pdf_url, online_url, published_at, created_at")
        .eq("vehicle_id", vehicleId)
        .eq("document_type", "factory_sticker")
        .order("version", { ascending: false });
      setDocs((history as DocRow[]) || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load the factory sticker record.");
    } finally {
      setLoading(false);
    }
  }, [fixture, vehicleId]);

  useEffect(() => { load(); }, [load]);

  const renderInput = useMemo((): { data: FactoryStickerRenderData; theme: FactoryStickerTheme } | null => {
    if (fixture) return { data: FIXTURE_SCENARIOS[scenario].data(), theme: themeFor("INFINITI") };
    if (!record?.normalized_data_json) return null;
    return {
      data: record.normalized_data_json,
      theme: {
        oemThemeId: record.oem_theme_id || "oem-neutral",
        oemThemeVersion: record.oem_theme_version || "1",
        canonicalOemId: record.canonical_oem_id,
        templateFamilyId: record.template_family_id || "factory-sticker-standard",
        templateVersion: record.template_version || "1.0.0",
        logoAssetId: record.logo_asset_id,
        logoAssetVersion: record.logo_asset_version,
      },
    };
  }, [fixture, record]);

  const model: LayoutModel | null = useMemo(() => {
    if (!renderInput) return null;
    try {
      return buildRenderLayout(renderInput.data, renderInput.theme);
    } catch {
      return null;
    }
  }, [renderInput]);

  useEffect(() => { setPageIdx(0); }, [scenario]);

  const pageSvg = useMemo(() => {
    if (!model) return null;
    const page = model.pages[Math.min(pageIdx, model.pages.length - 1)];
    return layoutToSvg({ ...model, pages: [page] });
  }, [model, pageIdx]);

  // Fixture mode has no stored QA row, so the identity checks run right here
  // against the just-built layout and are labeled as computed-now results.
  const fixtureChecks = useMemo(() => {
    if (!fixture || !model || !renderInput) return null;
    return {
      barcode_is_vin: renderInput.data.barcodePayload === renderInput.data.vin,
      qr_is_passport: renderInput.data.passportUrl.length > 0,
      vin_drawn: model.drawnStrings.includes(renderInput.data.vin),
      page_count_ok: model.pages.length >= 1 && model.pages.length <= 2,
    };
  }, [fixture, model, renderInput]);

  const act = async (action: "approve_publish" | "unpublish" | "regenerate" | "orchestrate") => {
    if (fixture || !vehicle?.tenant_id || !vehicleId) return;
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: { action, tenant_id: vehicle.tenant_id, vehicle_id: vehicleId, app_base: window.location.origin },
      });
      const payload = (data || {}) as { success?: boolean; error?: string; status?: string };
      if (error || payload.success !== true) {
        const detail = error?.message || payload.error || "action failed";
        toast.error(/insufficient_permission/i.test(detail)
          ? "This action needs manager authority."
          : `Action failed: ${detail}`);
      } else {
        toast.success(
          action === "approve_publish" ? "Approved and published to the passport."
          : action === "unpublish" ? "Unpublished — the record is back in review."
          : payload.status === "PUBLISHED" ? "Regenerated and published."
          : "Regenerated — the new version is waiting for review.");
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const data = renderInput?.data ?? null;
  const mc = (vehicle?.mc_attributes || {}) as Record<string, unknown>;
  const buildSheet = mc.build_sheet as Record<string, unknown> | undefined;
  const stockNo = (mc.stock_no as string)
    || ((vehicle?.sticker_snapshot?.decoded as Record<string, unknown> | undefined)?.stock as string)
    || null;
  const hero = fixture ? null : vehicle ? listingHero(vehicle as unknown as Parameters<typeof listingHero>[0]) : null;
  const currentDoc = docs.find((d) => d.id === record?.current_document_id) || docs[0] || null;
  const pdfUrl = currentDoc?.pdf_url || null;
  const oemOriginalUrl = fixture ? null
    : (record?.qa_metadata?.oem_original_url as string | undefined) || vehicle?.oem_sticker_url || null;

  const pricing = data?.pricing ?? null;
  const packagesTotal = data ? data.packages.reduce((s, p) => s + (p.msrp ?? 0), 0) : null;
  const optionsOnlyTotal = data ? data.options.reduce((s, o) => s + (o.msrp ?? 0), 0) : null;
  const calculated = pricing && pricing.baseMsrp != null
    ? pricing.baseMsrp + (pricing.optionsTotal ?? 0) + (pricing.destinationCharge ?? 0)
    : null;
  const difference = calculated != null && pricing?.totalMsrp != null ? calculated - pricing.totalMsrp : null;

  const vinMatch = fixture
    ? null
    : record && vehicle?.vin
      ? record.vin === vehicle.vin && (data ? data.vin === vehicle.vin : true)
      : null;

  const genStatus = record?.generation_status ?? null;
  const eligible = genStatus === "APPROVED" || genStatus === "PUBLISHED"
    || (genStatus === "REVIEW_REQUIRED" && !!currentDoc);
  const publishBlockers: string[] = [];
  if (!fixture && record) {
    if (!currentDoc) publishBlockers.push("no rendered document yet");
    if (record.review_required && genStatus !== "PUBLISHED") publishBlockers.push(record.review_reason || "review required");
    if (record.barcode_identity_qa_status === "FAIL") publishBlockers.push("barcode QA failed");
    if (record.qr_identity_qa_status === "FAIL") publishBlockers.push("passport QR QA failed");
  }

  const title = data?.title || (vehicle?.condition === "new" ? "Factory Window Sticker" : "Original Factory Build & MSRP Record");

  if (!fixture && loading) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-96" />
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_340px] gap-4">
          <div className="h-[70vh] bg-muted rounded-2xl" />
          <div className="h-[70vh] bg-muted rounded-2xl" />
          <div className="h-[70vh] bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!fixture && loadError) {
    return (
      <div className="p-10 text-center">
        <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground">{loadError}</p>
        <Link to="/inventory" className="text-xs text-blue-600 hover:underline mt-2 inline-block">Back to inventory</Link>
      </div>
    );
  }

  return (
    <div className={fixture ? "min-h-screen bg-slate-100 p-4 md:p-6" : "p-4 md:p-6"}>
      <div className="max-w-[1600px] mx-auto space-y-4">
        {fixture && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 space-y-2">
            <p className="text-[12px] font-semibold text-amber-800">
              Fixture preview — INFINITI QX80 benchmark data rendered live by renderer v1.0.0. This is not a live
              vehicle record; publication actions are disabled. Identity checks below are computed against this render.
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(Object.keys(FIXTURE_SCENARIOS) as Array<keyof typeof FIXTURE_SCENARIOS>).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScenario(key)}
                  className={`h-7 px-2.5 rounded-md text-[11px] font-bold border ${
                    scenario === key
                      ? "bg-amber-800 text-white border-amber-800"
                      : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {FIXTURE_SCENARIOS[key].label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {!fixture && vehicle && (
              <Link
                to={`/vehicle-file/${vehicle.id}`}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted/40 shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Vehicle File
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground truncate inline-flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600 shrink-0" /> {title}
              </h1>
              <p className="text-[11px] text-muted-foreground">
                {data ? `${data.identity.year} ${data.identity.make} ${data.identity.model}${data.identity.trim ? ` ${data.identity.trim}` : ""}` : "Factory sticker workspace"}
                {currentDoc ? ` · v${currentDoc.version}` : ""}
              </p>
            </div>
          </div>
          {genStatus && (
            <Badge tone={GEN_STATUS_TONE[genStatus] || "off"}>{humanize(genStatus)}</Badge>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_340px] gap-4 items-start">
          {/* LEFT — vehicle and data status */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              {hero ? (
                <img src={hero} alt="Vehicle" className="w-full aspect-[4/3] object-cover rounded-xl border border-border" />
              ) : (
                <div className="w-full aspect-[4/3] rounded-xl border border-dashed border-border bg-muted/30 flex items-center justify-center text-[11px] text-muted-foreground">
                  {fixture ? "Fixture vehicle — no photo" : "No photo on file"}
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-foreground">
                  {data ? `${data.identity.year} ${data.identity.make} ${data.identity.model}` : "—"}
                </p>
                {data?.identity.trim && <p className="text-[11px] text-muted-foreground">{data.identity.trim}</p>}
              </div>
              <div className="space-y-0">
                <StatusRow label="VIN" value={<span className="font-mono">{data?.vin || vehicle?.vin || "—"}</span>} />
                {stockNo && <StatusRow label="Stock #" value={stockNo} />}
                <StatusRow label="Condition" value={humanize(data?.condition || vehicle?.condition || "unknown")} />
                {!fixture && vehicle?.status && <StatusRow label="Listing status" value={humanize(vehicle.status)} />}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Data sources</h2>
              <StatusRow
                label="Saved NeoVIN build sheet"
                tone={fixture ? "info" : buildSheet ? "pass" : "fail"}
                value={fixture ? "Fixture data" : buildSheet ? "Saved" : "Missing"}
              />
              <StatusRow
                label="Source provider"
                value={fixture ? "fixture" : record?.source_provider || "—"}
              />
              <StatusRow
                label="Source confidence"
                tone={record?.confidence_level === "HIGH" ? "pass" : record?.confidence_level ? "warn" : fixture ? "info" : "off"}
                value={fixture ? "Benchmark" : record?.confidence_level ? humanize(record.confidence_level) : "Not run"}
              />
              <StatusRow
                label="OEM resolution"
                tone={fixture ? "info" : record?.canonical_oem_id ? "pass" : record ? "warn" : "off"}
                value={fixture ? "INFINITI" : record?.canonical_oem_id
                  ? `${record.canonical_oem_id}${record.oem_resolution_confidence ? ` (${record.oem_resolution_confidence.toLowerCase()})` : ""}`
                  : record?.detected_make_value ? `Unresolved: ${record.detected_make_value}` : "Not run"}
              />
              <StatusRow
                label="OEM theme"
                value={fixture ? "oem-INFINITI" : record?.oem_theme_id ? `${record.oem_theme_id} v${record.oem_theme_version || "1"}` : "—"}
              />
              <StatusRow
                label="Logo asset"
                value={fixture ? "Wordmark (built-in)" : record?.logo_asset_id || "Wordmark (built-in)"}
              />
              <StatusRow
                label="Passport route"
                tone={fixture ? "info" : record?.canonical_passport_url ? "pass" : "off"}
                value={fixture
                  ? "/v/demo-qx80"
                  : record?.passport_slug ? `/v/${record.passport_slug}` : record?.canonical_passport_url ? "Resolved" : "Not resolved"}
              />
            </div>

            {(record?.review_reason || record?.last_error || data?.generic) && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-1.5">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-amber-800">Data warnings</h2>
                {data?.generic && (
                  <p className="text-[11px] text-amber-800">
                    Generic decode — this is a typical factory configuration for the trim, not a VIN-exact build. The
                    document labels itself accordingly.
                  </p>
                )}
                {record?.review_reason && <p className="text-[11px] text-amber-800">Review: {record.review_reason}</p>}
                {record?.last_error && <p className="text-[11px] text-rose-700">Last error: {record.last_error}</p>}
              </div>
            )}
          </div>

          {/* CENTER — large live document preview */}
          <div className={fullscreen
            ? "fixed inset-0 z-50 bg-slate-900/95 p-6 overflow-auto"
            : "rounded-2xl border border-border bg-card p-4 space-y-3"}>
            <div className={`flex items-center justify-between gap-2 flex-wrap ${fullscreen ? "mb-3" : ""}`}>
              <p className={`text-[11px] ${fullscreen ? "text-slate-300" : "text-muted-foreground"}`}>
                Landscape Letter (11 × 8.5 in) · renderer v{record?.renderer_version || "1.0.0"} — the identical
                layout model the PDF is produced from. Page edge = trim boundary.
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  ["Fit", "fit"],
                  ["Actual print size", 1],
                ] as Array<[string, "fit" | number]>).map(([label, z]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setZoom(z)}
                    className={`h-7 px-2.5 rounded-md border text-[11px] font-semibold ${
                      zoom === z
                        ? "bg-blue-600 text-white border-blue-600"
                        : fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, (z === "fit" ? 1 : z) - 0.25))}
                  className={`w-7 h-7 rounded-md border text-sm font-bold ${fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"}`}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, (z === "fit" ? 1 : z) + 0.25))}
                  className={`w-7 h-7 rounded-md border text-sm font-bold ${fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"}`}
                  aria-label="Zoom in"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen((f) => !f)}
                  className={`h-7 px-2.5 rounded-md border text-[11px] font-semibold ${fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"}`}
                >
                  {fullscreen ? "Exit full screen" : "Full screen"}
                </button>
                {model && model.pages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                      disabled={pageIdx === 0}
                      className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-40 ${fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"}`}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className={`text-[11px] font-semibold tabular-nums ${fullscreen ? "text-slate-200" : "text-foreground"}`}>
                      Page {pageIdx + 1} / {model.pages.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPageIdx((i) => Math.min(model.pages.length - 1, i + 1))}
                      disabled={pageIdx >= model.pages.length - 1}
                      className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-40 ${fullscreen ? "bg-slate-800 text-slate-200 border-slate-600" : "border-border hover:bg-muted/40"}`}
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {pageSvg ? (
              <div className={zoom === "fit" ? "" : "overflow-auto"}>
                <div
                  className="border border-border bg-white shadow-sm [&>svg]:block [&>svg]:h-auto"
                  // Actual print size: 11in at CSS 96dpi = 1056px page width.
                  style={zoom === "fit" ? undefined : { width: 1056 * (zoom as number) }}
                  dangerouslySetInnerHTML={{
                    __html: zoom === "fit"
                      ? pageSvg.replace("<svg ", '<svg style="width:100%" ')
                      : pageSvg.replace("<svg ", `<svg style="width:${1056 * (zoom as number)}px" `),
                  }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 aspect-[792/612] flex flex-col items-center justify-center gap-2 text-center p-6">
                <FileText className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-xs font-semibold text-foreground">
                  {record ? "No normalized build data on this record yet." : "No factory sticker record for this vehicle yet."}
                </p>
                <p className="text-[11px] text-muted-foreground max-w-sm">
                  {record
                    ? "The preview appears once the pipeline has normalized the saved NeoVIN build sheet. Regenerate to run it now."
                    : "Generate one from the saved factory build data for this VIN."}
                </p>
                {manager && (
                  <button
                    type="button"
                    onClick={() => act(record ? "regenerate" : "orchestrate")}
                    disabled={!!busy}
                    className="mt-1 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Generate now
                  </button>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — validation and publication */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Source & classification</h2>
              <StatusRow
                label="Classification"
                value={fixture ? "Benchmark fixture" : record?.source_classification ? humanize(record.source_classification) : "Not run"}
              />
              <StatusRow
                label="Verification"
                tone={record?.verification_status === "AUTO_VERIFIED" || record?.verification_status === "DEALER_VERIFIED"
                  ? "pass" : record?.verification_status === "UNVERIFIED_GENERIC" ? "warn"
                  : record?.verification_status ? "info" : fixture ? "info" : "off"}
                value={fixture ? "Fixture" : record?.verification_status ? humanize(record.verification_status) : "Not run"}
              />
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">MSRP reconciliation</h2>
              {pricing ? (
                <>
                  <StatusRow label="Base MSRP" value={fmtMoney(pricing.baseMsrp)} />
                  <StatusRow label="Packages (priced)" value={fmtMoney(packagesTotal)} />
                  <StatusRow label="Options (priced)" value={fmtMoney(optionsOnlyTotal)} />
                  <StatusRow label="Factory options total" value={fmtMoney(pricing.optionsTotal)} />
                  <StatusRow label="Destination charge" value={fmtMoney(pricing.destinationCharge)} />
                  <StatusRow label="Calculated total" value={fmtMoney(calculated)} />
                  <StatusRow label="Provider-reported total" value={fmtMoney(pricing.totalMsrp)} />
                  <StatusRow
                    label="Difference"
                    tone={difference == null ? "off" : Math.abs(difference) <= 5 ? "pass" : Math.abs(difference) <= 100 ? "warn" : "fail"}
                    value={difference == null ? "Insufficient data" : fmtMoney(Math.abs(difference))}
                  />
                  {!fixture && (
                    <StatusRow
                      label="Stored verdict"
                      tone={record?.reconciliation_status === "MATCHED" ? "pass"
                        : record?.reconciliation_status === "MINOR_VARIATION" ? "warn"
                        : record?.reconciliation_status === "REVIEW_REQUIRED" ? "fail"
                        : "off"}
                      value={record?.reconciliation_status ? humanize(record.reconciliation_status) : "Not run"}
                    />
                  )}
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground py-1">No normalized pricing yet — reconciliation has not run.</p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Identity & QA</h2>
              <StatusRow
                label="VIN vs vehicle record"
                tone={vinMatch == null ? (fixture ? "info" : "off") : vinMatch ? "pass" : "fail"}
                value={fixture ? "Fixture VIN" : vinMatch == null ? "Not run" : vinMatch ? "Matched" : "Mismatch"}
              />
              <StatusRow
                label="Barcode payload = VIN (pre-render identity)"
                tone={fixture ? (fixtureChecks?.barcode_is_vin ? "pass" : "fail") : qaTone(record?.barcode_identity_qa_status)}
                value={fixture ? (fixtureChecks?.barcode_is_vin ? "Payload match" : "Mismatch - publication blocked") : qaLabel(record?.barcode_identity_qa_status)}
              />
              <StatusRow
                label="Passport QR payload (pre-render identity)"
                tone={fixture ? (fixtureChecks?.qr_is_passport ? "pass" : "fail") : qaTone(record?.qr_identity_qa_status)}
                value={fixture ? (fixtureChecks?.qr_is_passport ? "Payload match" : "Mismatch") : qaLabel(record?.qr_identity_qa_status)}
              />
              <StatusRow
                label="Layout model (bounds, min font, VIN drawn)"
                tone={fixture ? (fixtureChecks?.vin_drawn && fixtureChecks?.page_count_ok ? "pass" : "fail") : qaTone(record?.visual_qa_status)}
                value={fixture ? (fixtureChecks?.vin_drawn && fixtureChecks?.page_count_ok ? "Checks passed" : "Failed") : qaLabel(record?.visual_qa_status)}
              />
              <StatusRow
                label="EPA data"
                tone={data ? (data.epa ? "pass" : "warn") : "off"}
                value={data ? (data.epa ? "Present" : "Unavailable") : "—"}
              />
              {record?.qr_payload && (
                <p className="text-[10px] text-muted-foreground mt-2 break-all">QR payload: {record.qr_payload}</p>
              )}
              {fixture && data && (
                <p className="text-[10px] text-muted-foreground mt-2 break-all">QR payload: {data.passportUrl}</p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Publication</h2>
              <StatusRow
                label="Eligibility"
                tone={fixture ? "info" : eligible && publishBlockers.length === 0 ? "pass" : "warn"}
                value={fixture ? "Fixture — n/a" : publishBlockers.length > 0 ? "Blocked" : eligible ? "Eligible" : "Not ready"}
              />
              {publishBlockers.length > 0 && (
                <ul className="text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
                  {publishBlockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
              <StatusRow label="Version" value={currentDoc ? `v${currentDoc.version}` : "—"} />
              <StatusRow
                label="Document status"
                tone={currentDoc?.document_status === "published" ? "pass" : currentDoc ? "info" : "off"}
                value={currentDoc ? humanize(currentDoc.document_status) : "No document"}
              />
              {record?.reviewed_at && <StatusRow label="Reviewed" value={fmtDate(record.reviewed_at)} />}
              {record?.approved_at && <StatusRow label="Approved" value={fmtDate(record.approved_at)} />}
              {record?.published_at && <StatusRow label="Published" value={fmtDate(record.published_at)} />}

              {!fixture && (
                <div className="grid grid-cols-2 gap-2 pt-1.5">
                  {manager && genStatus !== "PUBLISHED" && (
                    <button
                      type="button"
                      onClick={() => act("approve_publish")}
                      disabled={!!busy || !currentDoc}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      {busy === "approve_publish" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Approve & Publish
                    </button>
                  )}
                  {manager && genStatus === "PUBLISHED" && (
                    <button
                      type="button"
                      onClick={() => act("unpublish")}
                      disabled={!!busy}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-border text-xs font-bold hover:bg-muted/40 disabled:opacity-50"
                    >
                      {busy === "unpublish" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                      Unpublish
                    </button>
                  )}
                  {manager && (
                    <button
                      type="button"
                      onClick={() => act(record ? "regenerate" : "orchestrate")}
                      disabled={!!busy}
                      className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border text-xs font-semibold hover:bg-muted/40 disabled:opacity-50"
                    >
                      {busy === "regenerate" || busy === "orchestrate" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Regenerate
                    </button>
                  )}
                  {pdfUrl ? (
                    <a
                      href={pdfUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                    >
                      <Download className="w-3 h-3" /> Download PDF
                    </a>
                  ) : (
                    <span className="inline-flex items-center justify-center h-8 rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
                      No PDF yet
                    </span>
                  )}
                  {pdfUrl && (
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                    >
                      <Printer className="w-3 h-3" /> Print
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowHistory((s) => !s)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                  >
                    <History className="w-3 h-3" /> Versions ({docs.length})
                  </button>
                  {record?.passport_slug && (
                    <a
                      href={`/v/${record.passport_slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                    >
                      <ExternalLink className="w-3 h-3" /> View on Passport
                    </a>
                  )}
                </div>
              )}

              {showHistory && docs.length > 0 && (
                <div className="pt-1 space-y-1">
                  {docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-border/60 last:border-0">
                      <span className="font-semibold text-foreground">v{d.version}</span>
                      <span className="text-muted-foreground">{humanize(d.document_status)}</span>
                      <span className="text-muted-foreground">{fmtDate(d.created_at)}</span>
                      {d.pdf_url ? (
                        <a href={d.pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">PDF</a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {oemOriginalUrl && (
              <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-foreground">Original OEM Window Sticker</p>
                  <p className="text-[10px] text-muted-foreground">The manufacturer's own file — shown to shoppers in place of the generated record when preferred.</p>
                </div>
                <a
                  href={oemOriginalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40 shrink-0"
                >
                  <ExternalLink className="w-3 h-3" /> View
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

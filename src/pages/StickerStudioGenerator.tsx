import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerDocumentRules } from "@/lib/documentRules";
import { useProducts } from "@/hooks/useProducts";
import { applicablePrograms, programMode, termLabel } from "@/lib/dealerPrograms";
import { cleanEquipmentList } from "@/lib/passportV2Data";
import { curatePrintEquipment } from "@/lib/equipmentPanel";
import { useUsageLimits } from "@/lib/entitlements/useUsageLimits";
import { useAssetReadiness } from "@/lib/stickerStudio/useAssetReadiness";
import { transitionDocument } from "@/lib/stickerStudio/documentWorkflow";
import { ensureQrCode } from "@/lib/stickerStudio/qrTracking";
import { useLatestAddendum } from "@/lib/stickerStudio/useLatestAddendum";
import { mapProductsToStickerItems } from "@/lib/stickerStudio/addendumMapping";
import { validateStickerPacketMatch, type PacketContext } from "@/lib/stickerStudio/validateStickerPacketMatch";
import StickerPacketReviewPanel from "@/components/sticker/StickerPacketReviewPanel";
import { FileCheck2, QrCode as QrIcon, AlertTriangle } from "lucide-react";
import { useVehiclePrefill } from "@/lib/vehiclePrefill";
import { getStudioTemplate, TemplateRenderer, type StickerData, type StickerLineItem, type StickerRenderOptions, type LabelMode } from "@/lib/stickerStudio/templates";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useDealerPrintSettings } from "@/lib/stickerStudio/useDealerPrintSettings";
import { useTemplateCustomization } from "@/lib/stickerStudio/useTemplateCustomization";
import { applyCustomization } from "@/lib/stickerStudio/customization";
import { brandingFromSettings } from "@/pages/StickerStudio";
import { saveStickerToVehicle, publishToPassport, saveAddendumState, type AddendumItemInput } from "@/lib/stickerStudio/api";
import { ArrowLeft, Printer, Download, Image as ImageIcon, Plus, Trash2, Save, Globe, Sun, Moon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const ACCENTS = ["#2563EB", "#0B2041", "#7c5c1e", "#0f766e", "#9333ea", "#b91c1c"];
const blankItem = (): StickerLineItem => ({ name: "", price: "", note: "" });

const StickerStudioGenerator = () => {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  const { byId } = useStickerCatalog();
  const baseTemplate = byId(templateId) || getStudioTemplate(templateId);
  const { settings, loading: settingsLoading } = useDealerSettings();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const rules = useDealerDocumentRules();
  const quota = useUsageLimits();
  const { customization } = useTemplateCustomization(templateId);
  // Apply order: built-in base -> DB config (already in baseTemplate) -> dealer
  // customization. Vehicle data + UI toggles layer on below.
  const applied = useMemo(
    () => (baseTemplate ? applyCustomization(baseTemplate, brandingFromSettings(settings, tenant?.name), customization) : null),
    [baseTemplate, customization, settings, tenant?.name],
  );
  const template = applied?.template ?? baseTemplate;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [zoomPreset, setZoomPreset] = useState<"fit" | "50" | "75" | "100">("fit");

  // Output options (label stock + total roll-ups), frozen into the saved snapshot.
  const { calibration } = useDealerPrintSettings();
  const [labelMode, setLabelMode] = useState<LabelMode>("white");
  const [totalMsrpMode, setTotalMsrpMode] = useState(false);
  const [showAddendumTotal, setShowAddendumTotal] = useState(true);
  // Seed label mode from the dealer's template customization, else the saved
  // print default, once.
  const seededMode = useRef(false);
  useEffect(() => {
    if (seededMode.current) return;
    const m = applied?.options.labelMode || calibration.labelMode;
    if (m) { setLabelMode(m); seededMode.current = true; }
  }, [applied?.options.labelMode, calibration]);
  const options: StickerRenderOptions = useMemo(
    () => ({ labelMode, totalMsrpMode, showAddendumTotal, sectionLabels: applied?.options.sectionLabels }),
    [labelMode, totalMsrpMode, showAddendumTotal, applied?.options.sectionLabels],
  );
  const [savedDoc, setSavedDoc] = useState<{ version?: number; status?: string } | null>(null);

  // Branding (seeded from dealer settings + template customization, editable here).
  const seed = useMemo(() => applied?.branding ?? brandingFromSettings(settings, tenant?.name), [applied?.branding, settings, tenant?.name]);
  const [branding, setBranding] = useState(seed);
  useEffect(() => { setBranding(seed); }, [seed]);

  // Vehicle data (prefilled from ?vehicleId, then editable).
  const [data, setData] = useState<StickerData>({
    vehicleTitle: "", vin: "", stock: "", mileage: "", msrp: "", price: "",
    installed: [blankItem()], upgrades: [blankItem()], benefits: [blankItem()], notes: "", qrUrl: "",
  });
  const prefill = useVehiclePrefill((v) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setData((prev) => ({
      ...prev,
      vehicleTitle: `${v.ymm}${v.trim ? ` ${v.trim}` : ""}`.trim() || prev.vehicleTitle,
      vin: v.vin || prev.vin,
      stock: v.stock || prev.stock,
      mileage: v.mileage || prev.mileage,
      msrp: v.msrp || prev.msrp,
      price: v.price || prev.price,
      specs: [v.engine, v.drivetrain, v.transmission,
        (v.mpgCity && v.mpgHwy) ? `${v.mpgCity}/${v.mpgHwy} MPG` : v.mpgCity ? `${v.mpgCity} MPG` : v.fuelType,
      ].filter(Boolean).join(" · ") || prev.specs,
      qrUrl: v.slug ? `${origin}/v/${v.slug}` : v.vin ? `${origin}/v/${v.vin}` : prev.qrUrl,
    }));
  });

  // Seed line items from real data once both sources have settled: the
  // tenant's active product catalog fills installed / optional / benefit
  // lines with their signing-flow pricing semantics, and (window templates
  // only) the vehicle file's factory equipment fills any remaining installed
  // capacity, value-ranked. Never overwrites lines the dealer has typed.
  const { data: products } = useProducts();
  const seededItems = useRef(false);
  useEffect(() => {
    if (seededItems.current || !template) return;
    if (prefill.active && prefill.loading) return;
    if (products === undefined || settingsLoading) return;
    seededItems.current = true;
    const cfgNow = template.config;
    // Seed straight from the catalog WITH each product's default price —
    // installed equipment value must always be visible and feed the adjusted
    // total. Supabase numeric columns arrive as strings, so coerce instead of
    // typeof-checking (that check is why prices used to seed as blank).
    // (mapProductsToStickerItems keeps its stricter signed-packet semantics
    // for "Load packet items".)
    const priceNum = (p: { price: number }) => {
      const n = typeof p.price === "number" ? p.price : parseFloat(String(p.price ?? ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const m = {
      installed: products.filter((p) => p.badge_type === "installed" && priceNum(p) > 0)
        .map((p) => ({ name: p.name, price: String(priceNum(p)), note: p.subtitle || "" })),
      upgrades: products.filter((p) => p.badge_type === "optional" && priceNum(p) > 0)
        .map((p) => ({ name: p.name, price: String(priceNum(p)), note: p.subtitle || "" })),
      benefits: products.filter((p) => priceNum(p) <= 0)
        .map((p) => ({ name: p.name })),
    };
    const v = prefill.vehicle;
    const factory = cfgNow.type === "window" && v && (v.options.length || v.features.length)
      ? curatePrintEquipment(cleanEquipmentList([...v.options, ...v.features]), cfgNow.maxItems.installed).shown
      : [];
    // Included-with-sale items (dealer warranty, loaner cars, …) fill the
    // benefits section alongside no-charge products.
    const suppressedIds = new Set(
      (Array.isArray(v?.raw?.suppressed_programs) ? (v!.raw.suppressed_programs as unknown[]) : []).map(String),
    );
    const programs = applicablePrograms(settings.dealer_programs, v?.condition || "", "sticker")
      .filter((p) => !suppressedIds.has(p.id));
    const programName = (p: (typeof programs)[number]) => {
      const t = termLabel(p);
      return t ? `${p.title.trim()} — ${t}` : p.title.trim();
    };
    const includedProgs = programs.filter((p) => programMode(p) === "included");
    // "Available" programs (e.g. an optional dealer CPO upgrade) belong in the
    // Available Upgrades band — offered, priced if configured, never in total.
    const availableProgs = programs.filter((p) => programMode(p) === "available");
    setData((prev) => {
      const blank = (arr: StickerLineItem[]) => arr.every((i) => !i.name.trim());
      const installedSeed = [...m.installed, ...factory.map((n) => ({ name: n }))]
        .slice(0, cfgNow.maxItems.installed);
      const benefitNames = new Set(m.benefits.map((b) => b.name.toLowerCase()));
      const benefitsSeed = [
        ...m.benefits,
        ...includedProgs.filter((p) => !benefitNames.has(p.title.trim().toLowerCase())).map((p) => ({ name: programName(p) })),
      ].slice(0, cfgNow.maxItems.benefits);
      const upgradeNames = new Set(m.upgrades.map((u) => u.name.toLowerCase()));
      const upgradesSeed = [
        ...m.upgrades,
        ...availableProgs.filter((p) => !upgradeNames.has(p.title.trim().toLowerCase()))
          .map((p) => ({ name: programName(p), price: p.price && p.price > 0 ? String(p.price) : "" })),
      ].slice(0, cfgNow.maxItems.upgrades);
      return {
        ...prev,
        installed: blank(prev.installed) && installedSeed.length ? installedSeed : prev.installed,
        upgrades: blank(prev.upgrades) && upgradesSeed.length ? upgradesSeed : prev.upgrades,
        benefits: blank(prev.benefits) && benefitsSeed.length ? benefitsSeed : prev.benefits,
      };
    });
  }, [template, products, prefill.active, prefill.loading, prefill.vehicle, settingsLoading, settings.dealer_programs]);

  // Seed dealer default benefits + addendum wording from the template
  // customization once, only into an untouched (blank) field.
  const seededDefaults = useRef(false);
  useEffect(() => {
    if (seededDefaults.current || !customization) return;
    const hasBenefits = customization.defaultBenefits.length > 0;
    const hasWording = !!customization.defaultAddendumWording;
    if (!hasBenefits && !hasWording) return;
    setData((prev) => {
      const benefitsBlank = prev.benefits.every((b) => !b.name.trim());
      return {
        ...prev,
        benefits: hasBenefits && benefitsBlank ? customization.defaultBenefits.map((n) => ({ name: n })) : prev.benefits,
        notes: hasWording && !prev.notes ? customization.defaultAddendumWording : prev.notes,
      };
    });
    seededDefaults.current = true;
  }, [customization]);

  // Point the sticker QR at the trackable /q/:token redirect (falls back to the
  // direct passport URL if QR tracking isn't available). Honors the dealer rule.
  // Latest signing packet for this vehicle — source for "load packet data" and
  // the sticker-vs-packet review (addendum templates only).
  const { addendum } = useLatestAddendum(prefill.vehicle?.vin || data.vin);

  const qrEnsured = useRef(false);
  const stickerType = template?.config.type;
  useEffect(() => {
    if (qrEnsured.current || !rules.trackQrScans || !stickerType) return;
    const v = prefill.vehicle;
    if (!v?.id || !tenant?.id) return;
    qrEnsured.current = true;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const destination = v.slug ? `${origin}/v/${v.slug}` : v.vin ? `${origin}/v/${v.vin}` : "";
    if (!destination) return;
    (async () => {
      const tracked = await ensureQrCode({ tenantId: tenant.id, vehicleId: v.id, stickerType, destinationUrl: destination });
      if (tracked) setData((prev) => ({ ...prev, qrUrl: tracked }));
    })();
  }, [prefill.vehicle, tenant?.id, rules.trackQrScans, stickerType]);

  if (!template) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Template not found.</p>
        <button onClick={() => navigate("/sticker-studio")} className="mt-3 text-sm font-semibold text-blue-600">Back to Sticker Studio</button>
      </div>
    );
  }
  const cfg = template.config;
  const setField = (k: keyof StickerData, val: string) => setData((d) => ({ ...d, [k]: val }));

  // Addendum ↔ signing-packet integration (addendum templates only).
  const isAddendum = cfg.type === "addendum";
  const loadPacketData = () => {
    if (!addendum) return;
    const m = mapProductsToStickerItems(addendum.products);
    setData((d) => ({
      ...d,
      installed: m.installed.length ? m.installed : d.installed,
      upgrades: m.upgrades.length ? m.upgrades : d.upgrades,
      benefits: m.benefits.length ? m.benefits : d.benefits,
    }));
    toast.success("Loaded items from the signing packet");
  };
  // Live consistency check vs the latest packet (used to gate publish).
  const packetCtx: PacketContext | null = isAddendum && addendum ? {
    vin: prefill.vehicle?.vin || data.vin,
    stock: data.stock,
    vehicleTitle: data.vehicleTitle,
    products: addendum.products,
    hasDisclaimer: !!branding.disclaimer,
    qrRequired: cfg.styleTags.includes("Compliance"),
    hasQr: !!(cfg.supportsQr && data.qrUrl),
    signed: !!addendum.signedAt,
    signedAfterGenerated: false,
  } : null;
  const matchBlocked = !!packetCtx && rules.blockPacketOnMismatchFail &&
    validateStickerPacketMatch(data, packetCtx).status === "blocked";

  // Asset readiness (logo resolution + QR availability) for the warning row.
  const assets = useAssetReadiness({
    logoUrl: branding.logoUrl, logoEnabled: cfg.supportsLogo && branding.showLogo,
    qrUrl: data.qrUrl, qrSupported: cfg.supportsQr, qrRequired: cfg.styleTags.includes("Compliance"),
  });

  const setItem = (key: "installed" | "upgrades" | "benefits", i: number, patch: Partial<StickerLineItem>) =>
    setData((d) => ({ ...d, [key]: d[key].map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const addItem = (key: "installed" | "upgrades" | "benefits") =>
    setData((d) => (d[key].length >= cfg.maxItems[key] ? d : { ...d, [key]: [...d[key], blankItem()] }));
  const removeItem = (key: "installed" | "upgrades" | "benefits", i: number) =>
    setData((d) => ({ ...d, [key]: d[key].filter((_, idx) => idx !== i) }));

  // ── Output ───────────────────────────────────────────────────────────
  const capture = async () => {
    const node = sheetRef.current;
    if (!node) return null;
    const { default: html2canvas } = await import("html2canvas-pro");
    const prev = node.style.transform;
    node.style.transform = "scale(1)"; // capture at true paper size
    const canvas = await html2canvas(node, {
      scale: 2, useCORS: true,
      onclone: (await import("@/lib/html2canvasInputs")).replaceInputsForCanvas as never,
    } as never);
    node.style.transform = prev;
    return canvas;
  };

  // Vector print-to-PDF: hand the resolved template + data to the chrome-free
  // /print route in a new tab, where the browser renders the real template at
  // true paper size and its native print dialog saves a pixel-perfect PDF.
  const handlePrint = () => {
    try {
      const key = `sticker-print-${crypto.randomUUID()}`;
      localStorage.setItem(key, JSON.stringify({ config: cfg, data, branding, options, calibration }));
      const w = window.open(`/print/sticker/${cfg.id}?h=${key}`, "_blank", "noopener");
      if (!w) toast.error("Allow pop-ups to open the print view");
    } catch { toast.error("Couldn't open print view"); }
  };

  const handlePdf = async () => {
    setGenerating(true);
    try {
      const canvas = await capture();
      if (!canvas) return;
      const { default: jsPDF } = await import("jspdf");
      const img = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ unit: "in", format: [cfg.widthIn, cfg.heightIn], orientation: "portrait" });
      pdf.addImage(img, "JPEG", 0, 0, cfg.widthIn, cfg.heightIn);
      pdf.save(`${cfg.id}-${data.stock || data.vin || "sticker"}.pdf`);
    } catch { toast.error("PDF failed"); } finally { setGenerating(false); }
  };

  const handlePng = async () => {
    setGenerating(true);
    try {
      const canvas = await capture();
      if (!canvas) return;
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${cfg.id}-${data.stock || data.vin || "sticker"}.png`;
      a.click();
    } catch { toast.error("PNG failed"); } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    // Quota: hard-block over the monthly cap; warn (but allow) past the soft cap.
    const qState = quota.state("stickers_generated");
    if (qState === "blocked") {
      toast.error("Monthly sticker limit reached for your plan. Contact support to upgrade.");
      return;
    }
    if (qState === "over_soft" || qState === "near") {
      toast.warning("You're near your monthly sticker limit for this plan.");
    }
    setGenerating(true);
    try {
      const r = await saveStickerToVehicle({
        tenantId: tenant?.id, vehicleId: prefill.vehicle?.id, vin: data.vin,
        templateId: cfg.id, docType: cfg.type, labelMode, qrUrl: data.qrUrl,
        snapshot: { config: cfg, data, branding, options },
      });
      if (r.ok) {
        // Dealer rule: auto-submit a freshly generated doc for manager approval.
        if (rules.autoSubmitForApproval && r.documentId) {
          await transitionDocument({
            doc: { id: r.documentId, tenant_id: tenant?.id || null, vehicle_id: prefill.vehicle?.id || null, template_id: cfg.id, document_type: cfg.type, document_status: "draft", version: r.version || 1 },
            action: "submit", actorId: user?.id,
          });
          setSavedDoc({ version: r.version, status: "pending_approval" });
        } else if (r.version) setSavedDoc({ version: r.version, status: "draft" });
        toast.success(r.version ? `Saved to vehicle file (v${r.version})` : "Saved to vehicle file");
        // Persist structured addendum state alongside, when this is an addendum.
        if (cfg.type === "addendum" && prefill.vehicle?.id) {
          const items: AddendumItemInput[] = [
            ...data.installed.filter((i) => i.name.trim()).map((i) => ({ itemType: "installed" as const, name: i.name, price: i.price, note: i.note })),
            ...data.benefits.filter((i) => i.name.trim()).map((i) => ({ itemType: "benefit" as const, name: i.name, price: i.price, note: i.note })),
            ...data.upgrades.filter((i) => i.name.trim()).map((i) => ({ itemType: "available_upgrade" as const, name: i.name, price: i.price, note: i.note, isSelected: totalMsrpMode })),
          ];
          await saveAddendumState({ tenantId: tenant?.id, vehicleId: prefill.vehicle.id, baseMsrp: data.msrp, items });
        }
      } else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to save it to the file" : "Couldn't save");
    } finally { setGenerating(false); }
  };

  const handlePublish = async () => {
    if (matchBlocked) { toast.error("Resolve the blocking sticker/packet findings before publishing"); return; }
    const r = await publishToPassport(prefill.vehicle?.id, tenant?.id);
    if (r.ok) {
      setSavedDoc((d) => ({ ...(d || {}), status: "published" }));
      toast.success(r.url ? "Published to Vehicle Passport" : "Published");
    } else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to publish" : "Couldn't publish");
  };

  const input = "w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:border-primary";
  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const fitScale = cfg.type === "addendum" ? 0.9 : 0.62;
  const previewScale = zoomPreset === "fit" ? fitScale : Number(zoomPreset) / 100;

  const ItemEditor = ({ keyName, title }: { keyName: "installed" | "upgrades" | "benefits"; title: string }) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={label}>{title} <span className="text-muted-foreground/60">({data[keyName].length}/{cfg.maxItems[keyName]})</span></label>
        <button onClick={() => addItem(keyName)} disabled={data[keyName].length >= cfg.maxItems[keyName]} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 disabled:opacity-40"><Plus className="w-3 h-3" /> Add</button>
      </div>
      {data[keyName].map((it, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={it.name} onChange={(e) => setItem(keyName, i, { name: e.target.value })} placeholder="Item name" className={`${input} flex-1 min-w-0`} />
          <input value={it.price} onChange={(e) => setItem(keyName, i, { price: e.target.value })} placeholder="$" className={`${input} !w-24 flex-none`} inputMode="decimal" />
          <button onClick={() => removeItem(keyName, i)} className="h-9 w-9 flex-shrink-0 inline-flex items-center justify-center rounded-md border border-border text-rose-600 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate("/sticker-studio")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Sticker Studio</button>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2">
            {cfg.name}
            {savedDoc && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${savedDoc.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                <CheckCircle2 className="w-3 h-3" /> {savedDoc.status === "published" ? "Published" : `Saved v${savedDoc.version}`}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">{cfg.size} · {cfg.type === "window" ? "Window sticker" : "Addendum sticker"}</p>
        </div>
        <div className="flex gap-2 no-print flex-wrap">
          <button onClick={handlePrint} title="Open a print-perfect, vector PDF in a new tab" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
          <button onClick={handlePng} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><ImageIcon className="w-3.5 h-3.5" /> PNG</button>
          <button onClick={handlePdf} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> {generating ? "Generating…" : "PDF"}</button>
          <button onClick={handleSave} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save to vehicle</button>
          <button onClick={handlePublish} disabled={matchBlocked} title={matchBlocked ? "Blocked by sticker/packet review" : undefined} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><Globe className="w-3.5 h-3.5" /> Publish passport</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Config panel */}
        <div className="lg:col-span-2 space-y-4 no-print">
          <CfgCard title="Vehicle">
            <div className="space-y-2">
              <div><label className={label}>Vehicle title</label><input value={data.vehicleTitle} onChange={(e) => setField("vehicleTitle", e.target.value)} placeholder="2027 INFINITI QX60 LUXE" className={input} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={label}>VIN</label><input value={data.vin} onChange={(e) => setField("vin", e.target.value.toUpperCase())} className={`${input} font-mono`} /></div>
                <div><label className={label}>Stock #</label><input value={data.stock} onChange={(e) => setField("stock", e.target.value)} className={input} /></div>
                <div><label className={label}>Mileage</label><input value={data.mileage} onChange={(e) => setField("mileage", e.target.value)} className={input} /></div>
                <div><label className={label}>{cfg.type === "addendum" ? "Base MSRP" : "MSRP"}</label><input value={data.msrp} onChange={(e) => setField("msrp", e.target.value)} className={input} /></div>
                {cfg.type === "window" && <div className="col-span-2"><label className={label}>Price</label><input value={data.price} onChange={(e) => setField("price", e.target.value)} className={input} /></div>}
              </div>
            </div>
          </CfgCard>

          {isAddendum && addendum && (
            <CfgCard title="Addendum packet">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground capitalize">{addendum.signedAt ? "Signed" : addendum.status || "Draft"}</span>
                    {" · "}{addendum.products.length} product{addendum.products.length === 1 ? "" : "s"}
                    {addendum.customerName ? ` · ${addendum.customerName}` : ""}
                  </div>
                  <button onClick={loadPacketData} className="h-8 px-2.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-blue-700"><FileCheck2 className="w-3.5 h-3.5" /> Load packet items</button>
                </div>
                {addendum.signedAt && <p className="text-[10px] text-amber-700">This packet is signed. Material changes require a new addendum version and customer re-review.</p>}
              </div>
            </CfgCard>
          )}

          {packetCtx && <StickerPacketReviewPanel sticker={data} ctx={packetCtx} />}

          <CfgCard title="Line items">
            <div className="space-y-3">
              {cfg.sections.includes("installed") && <ItemEditor keyName="installed" title="Installed equipment" />}
              {cfg.sections.includes("upgrades") && <ItemEditor keyName="upgrades" title="Available upgrades" />}
              {cfg.sections.includes("benefits") && <ItemEditor keyName="benefits" title="Included benefits" />}
            </div>
          </CfgCard>

          <CfgCard title="Branding">
            <div className="space-y-2.5">
              {cfg.supportsLogo && (
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={branding.showLogo} onChange={(e) => setBranding((b) => ({ ...b, showLogo: e.target.checked }))} /> Show dealer logo</label>
              )}
              {/* Asset readiness — warns before print on a missing/low-res logo or a required-but-missing QR. */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {cfg.supportsLogo && branding.showLogo && (
                  <span className={`inline-flex items-center gap-1 ${assets.logo === "ready" ? "text-emerald-600" : assets.logo === "low_res" ? "text-amber-600" : "text-muted-foreground"}`}>
                    <ImageIcon className="w-3 h-3" /> Logo: {assets.logo === "ready" ? "ready" : assets.logo === "low_res" ? `low-res (${assets.logoWidth}px)` : "fallback to name"}
                  </span>
                )}
                {cfg.supportsQr && (
                  <span className={`inline-flex items-center gap-1 ${assets.qr === "ready" ? "text-emerald-600" : assets.qrBlocking ? "text-rose-600" : "text-muted-foreground"}`}>
                    <QrIcon className="w-3 h-3" /> QR: {assets.qr === "ready" ? "ready" : assets.qrBlocking ? "required — missing" : "open this from a vehicle"}
                  </span>
                )}
              </div>
              {assets.qrBlocking && (
                <p className="text-[10px] text-rose-600 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> This compliance template requires a QR destination. Open it from a vehicle so the passport URL is set.</p>
              )}
              <div><label className={label}>Value proposition</label><input value={branding.valueProp} onChange={(e) => setBranding((b) => ({ ...b, valueProp: e.target.value }))} placeholder="Lifetime powertrain · Free maintenance" className={input} /></div>
              <div><label className={label}>Disclaimer</label><textarea value={branding.disclaimer} onChange={(e) => setBranding((b) => ({ ...b, disclaimer: e.target.value }))} rows={2} className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y" /></div>
              {cfg.supportsAccent && (
                <div>
                  <label className={label}>Accent color</label>
                  <div className="flex gap-1.5 mt-1">
                    {ACCENTS.map((c) => (
                      <button key={c} onClick={() => setBranding((b) => ({ ...b, accentColor: c }))} className={`w-7 h-7 rounded-full border-2 ${branding.accentColor === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CfgCard>

          <CfgCard title="Output options">
            <div className="space-y-3">
              <div>
                <label className={label}>Label stock</label>
                <div className="mt-1 inline-flex rounded-md border border-border bg-card p-0.5">
                  <button onClick={() => setLabelMode("white")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${labelMode === "white" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}><Sun className="w-3.5 h-3.5" /> White label</button>
                  <button onClick={() => setLabelMode("black")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${labelMode === "black" ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground"}`}><Moon className="w-3.5 h-3.5" /> Black label</button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={totalMsrpMode} onChange={(e) => setTotalMsrpMode(e.target.checked)} /> Show true Total MSRP roll-up</label>
              {cfg.type === "addendum" && (
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={showAddendumTotal} onChange={(e) => setShowAddendumTotal(e.target.checked)} /> Show addendum totals block</label>
              )}
              {(calibration.xOffsetIn !== 0 || calibration.yOffsetIn !== 0 || calibration.scalePct !== 100) && (
                <p className="text-[11px] text-muted-foreground">Print calibration active: offset {calibration.xOffsetIn}in / {calibration.yOffsetIn}in · scale {calibration.scalePct}%. Adjust in Print settings.</p>
              )}
            </div>
          </CfgCard>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2 no-print">
            <p className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground">Live preview — {cfg.size}</p>
            <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
              {(["fit", "50", "75", "100"] as const).map((z) => (
                <button key={z} onClick={() => setZoomPreset(z)} className={`px-2 h-7 rounded text-[11px] font-semibold transition-colors ${zoomPreset === z ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {z === "fit" ? "Fit" : `${z}%`}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex justify-center rounded-2xl border border-border p-4 overflow-auto ${labelMode === "black" ? "bg-slate-800" : "bg-slate-100"}`}>
            <TemplateRenderer template={template} data={data} branding={branding} scale={previewScale} capture={sheetRef} options={options} />
          </div>
        </div>
      </div>
    </div>
  );
};

const CfgCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <h3 className="text-sm font-bold text-foreground mb-3">{title}</h3>
    {children}
  </div>
);

export default StickerStudioGenerator;

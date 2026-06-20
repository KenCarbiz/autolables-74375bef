import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVehiclePrefill } from "@/lib/vehiclePrefill";
import { getStudioTemplate, TemplateRenderer, type StickerData, type StickerLineItem } from "@/lib/stickerStudio/templates";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { brandingFromSettings } from "@/pages/StickerStudio";
import { saveStickerToVehicle, publishToPassport } from "@/lib/stickerStudio/api";
import { ArrowLeft, Printer, Download, Image as ImageIcon, Plus, Trash2, Save, Globe } from "lucide-react";
import { toast } from "sonner";

const ACCENTS = ["#2563EB", "#0B2041", "#7c5c1e", "#0f766e", "#9333ea", "#b91c1c"];
const blankItem = (): StickerLineItem => ({ name: "", price: "", note: "" });

const StickerStudioGenerator = () => {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  const { byId } = useStickerCatalog();
  const template = byId(templateId) || getStudioTemplate(templateId);
  const { settings } = useDealerSettings();
  const { tenant } = useTenant();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [zoomPreset, setZoomPreset] = useState<"fit" | "50" | "75" | "100">("fit");

  // Branding (seeded from dealer settings, editable here).
  const seed = useMemo(() => brandingFromSettings(settings, tenant?.name), [settings, tenant?.name]);
  const [branding, setBranding] = useState(seed);
  useEffect(() => { setBranding(seed); }, [seed]);
  useEffect(() => {
    if (template?.config.supportsAccent) setBranding((b) => ({ ...b, accentColor: template.config.defaultAccent }));
  }, [template?.config.supportsAccent, template?.config.defaultAccent]);

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
      qrUrl: v.slug ? `${origin}/v/${v.slug}` : v.vin ? `${origin}/vehicle/${v.vin}` : prev.qrUrl,
      installed: (v.options.length || v.features.length)
        ? [...v.options, ...v.features].slice(0, 12).map((n) => ({ name: n }))
        : prev.installed,
    }));
  });

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

  const handlePrint = () => window.print();

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
    setGenerating(true);
    try {
      const r = await saveStickerToVehicle({ vehicleId: prefill.vehicle?.id, vin: data.vin, templateId: cfg.id, docType: cfg.type });
      if (r.ok) toast.success("Saved to vehicle file");
      else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to save it to the file" : "Couldn't save");
    } finally { setGenerating(false); }
  };

  const handlePublish = async () => {
    const r = await publishToPassport(prefill.vehicle?.id);
    if (r.ok) toast.success(r.url ? "Published to Vehicle Passport" : "Published");
    else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to publish" : "Couldn't publish");
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
          <input value={it.name} onChange={(e) => setItem(keyName, i, { name: e.target.value })} placeholder="Item name" className={`${input} flex-1`} />
          <input value={it.price} onChange={(e) => setItem(keyName, i, { price: e.target.value })} placeholder="$" className={`${input} w-20`} />
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
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">{cfg.name}</h1>
          <p className="text-xs text-muted-foreground">{cfg.size} · {cfg.type === "window" ? "Window sticker" : "Addendum sticker"}</p>
        </div>
        <div className="flex gap-2 no-print flex-wrap">
          <button onClick={handlePrint} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><Printer className="w-3.5 h-3.5" /> Print</button>
          <button onClick={handlePng} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><ImageIcon className="w-3.5 h-3.5" /> PNG</button>
          <button onClick={handlePdf} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> {generating ? "Generating…" : "PDF"}</button>
          <button onClick={handleSave} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save to vehicle</button>
          <button onClick={handlePublish} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><Globe className="w-3.5 h-3.5" /> Publish passport</button>
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
          <div className="flex justify-center rounded-2xl border border-border bg-slate-100 p-4 overflow-auto">
            <TemplateRenderer template={template} data={data} branding={branding} scale={previewScale} capture={sheetRef} />
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

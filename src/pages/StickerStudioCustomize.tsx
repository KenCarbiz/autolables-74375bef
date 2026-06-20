import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { getStudioTemplate, TemplateRenderer, type StickerData } from "@/lib/stickerStudio/templates";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useTemplateCustomization } from "@/lib/stickerStudio/useTemplateCustomization";
import { applyCustomization, qrRequired } from "@/lib/stickerStudio/customization";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import { brandingFromSettings } from "@/pages/StickerStudio";
import { ArrowLeft, Save, RotateCcw, Star, Sun, Moon } from "lucide-react";
import { toast } from "sonner";

const ACCENTS = ["#2563EB", "#0B2041", "#7c5c1e", "#0f766e", "#9333ea", "#b91c1c"];
const SAMPLE: StickerData = {
  vehicleTitle: "2027 INFINITI QX60 LUXE", vin: "5N1AL1F87VC331335", stock: "I21567",
  mileage: "17", msrp: "62335", price: "58835",
  installed: [{ name: "Ceramic Protection Package", price: "1495" }, { name: "Street Smart VIN Etch", price: "349" }],
  upgrades: [{ name: "Extended Warranty" }],
  benefits: [{ name: "Lifetime Car Washes" }, { name: "State Inspections" }],
  qrUrl: "https://autolabels.io/v/demo",
};

const StickerStudioCustomize = () => {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  const { byId } = useStickerCatalog();
  const baseTemplate = byId(templateId) || getStudioTemplate(templateId);
  const { settings } = useDealerSettings();
  const { tenant } = useTenant();
  const { customization, setCustomization, save, reset, loading } = useTemplateCustomization(templateId);
  const { defaults, setDefault } = useStickerPrefs();
  const [saving, setSaving] = useState(false);

  const seedBranding = useMemo(() => brandingFromSettings(settings, tenant?.name), [settings, tenant?.name]);

  if (!baseTemplate) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Template not found.</p>
        <button onClick={() => navigate("/sticker-studio")} className="mt-3 text-sm font-semibold text-blue-600">Back to Sticker Studio</button>
      </div>
    );
  }

  const applied = applyCustomization(baseTemplate, seedBranding, customization);
  const cfg = baseTemplate.config;
  const qrLocked = qrRequired(baseTemplate);
  const set = (p: Partial<typeof customization>) => setCustomization({ ...customization, ...p });
  const setLabel = (k: "installed" | "benefits" | "upgrades", v: string) =>
    setCustomization({ ...customization, sectionLabels: { ...customization.sectionLabels, [k]: v || undefined } });

  const onSave = async () => {
    setSaving(true);
    const r = await save(customization);
    setSaving(false);
    if (r.ok) toast.success("Customization saved");
    else toast.error("Couldn't save customization");
  };
  const onReset = async () => {
    const r = await reset();
    if (r.ok) toast.success("Reset to template default");
    else toast.error("Couldn't reset");
  };
  const onSetDefault = () => {
    setDefault(cfg.type, cfg.id);
    toast.success(`Set as default ${cfg.type === "window" ? "window sticker" : "addendum"}`);
  };
  const isDefault = defaults[cfg.type] === cfg.id;

  const input = "w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:border-primary";
  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const previewScale = cfg.type === "addendum" ? 0.82 : 0.56;

  if (loading) return <p className="p-8 text-sm text-muted-foreground">Loading customization…</p>;

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate("/sticker-studio")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Sticker Studio</button>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">Customize · {cfg.name}</h1>
          <p className="text-xs text-muted-foreground">{cfg.size} · {cfg.type === "window" ? "Window sticker" : "Addendum"}. Brand it for your store — the locked layout, dimensions, and required fields stay intact.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onSetDefault} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium ${isDefault ? "border-blue-500 text-blue-700 bg-blue-50" : "border-border hover:bg-muted"}`}><Star className="w-3.5 h-3.5" fill={isDefault ? "currentColor" : "none"} /> {isDefault ? "Default" : "Set as default"}</button>
          <button onClick={onReset} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Controls */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="Brand colors">
            <div className="space-y-3">
              {cfg.supportsAccent ? (
                <>
                  <Swatches label="Accent color" value={customization.accentColor || cfg.defaultAccent} onPick={(c) => set({ accentColor: c })} />
                  <Swatches label="Secondary color (section labels)" value={customization.secondaryColor || ""} onPick={(c) => set({ secondaryColor: c })} clearable onClear={() => set({ secondaryColor: undefined })} />
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">This template uses a fixed compliance color scheme; accent editing is disabled.</p>
              )}
            </div>
          </Card>

          <Card title="Visibility">
            <div className="space-y-2">
              {cfg.supportsLogo && (
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={customization.logoEnabled} onChange={(e) => set({ logoEnabled: e.target.checked })} /> Show dealer logo</label>
              )}
              <label className={`flex items-center gap-2 text-sm ${qrLocked ? "text-muted-foreground" : "text-foreground"}`}>
                <input type="checkbox" disabled={qrLocked} checked={cfg.supportsQr && (customization.qrEnabled || qrLocked)} onChange={(e) => set({ qrEnabled: e.target.checked })} /> Show QR code
                {qrLocked && <span className="text-[10px] font-semibold text-amber-600">Required on compliance templates</span>}
              </label>
            </div>
          </Card>

          <Card title="Label preference">
            <div className="inline-flex rounded-md border border-border bg-card p-0.5">
              <button onClick={() => set({ preferredLabelMode: "white" })} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${customization.preferredLabelMode !== "black" ? "bg-blue-600 text-white" : "text-muted-foreground"}`}><Sun className="w-3.5 h-3.5" /> White</button>
              <button onClick={() => set({ preferredLabelMode: "black" })} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${customization.preferredLabelMode === "black" ? "bg-slate-900 text-white" : "text-muted-foreground"}`}><Moon className="w-3.5 h-3.5" /> Black</button>
            </div>
          </Card>

          <Card title="Copy overrides">
            <div className="space-y-2.5">
              <div><label className={label}>Value proposition</label><input className={input} value={customization.valuePropOverride ?? ""} onChange={(e) => set({ valuePropOverride: e.target.value })} placeholder={seedBranding.valueProp || "Lifetime powertrain · Free maintenance"} /></div>
              <div>
                <label className={label}>Disclaimer override</label>
                <textarea className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y" rows={2} value={customization.disclaimerOverride ?? ""} onChange={(e) => set({ disclaimerOverride: e.target.value })} placeholder={seedBranding.disclaimer} />
                <p className="mt-1 text-[10px] text-muted-foreground">Leave blank to keep the standard compliance disclaimer. It can be reworded but not removed.</p>
              </div>
            </div>
          </Card>

          <Card title="Section labels">
            <div className="grid grid-cols-1 gap-2">
              <div><label className={label}>Installed equipment</label><input className={input} value={customization.sectionLabels.installed ?? ""} onChange={(e) => setLabel("installed", e.target.value)} placeholder="Installed Equipment" /></div>
              <div><label className={label}>Included benefits</label><input className={input} value={customization.sectionLabels.benefits ?? ""} onChange={(e) => setLabel("benefits", e.target.value)} placeholder="Included Benefits" /></div>
              <div><label className={label}>Available upgrades</label><input className={input} value={customization.sectionLabels.upgrades ?? ""} onChange={(e) => setLabel("upgrades", e.target.value)} placeholder="Available Upgrades" /></div>
            </div>
          </Card>

          <Card title="Default content">
            <div className="space-y-2.5">
              <div>
                <label className={label}>Default included benefits (one per line)</label>
                <textarea className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y" rows={3} value={customization.defaultBenefits.join("\n")} onChange={(e) => set({ defaultBenefits: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} placeholder={"Lifetime Car Washes\nState Inspections"} />
                <p className="mt-1 text-[10px] text-muted-foreground">Pre-fills the benefits list when a new sticker opens from this template.</p>
              </div>
              {cfg.type === "addendum" && (
                <div><label className={label}>Default addendum wording</label><input className={input} value={customization.defaultAddendumWording ?? ""} onChange={(e) => set({ defaultAddendumWording: e.target.value })} placeholder="Market-based supplemental pricing" /></div>
              )}
            </div>
          </Card>
        </div>

        {/* Live preview (customization applied) */}
        <div className="lg:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground mb-2">Preview — customization applied</p>
          <div className={`flex justify-center rounded-2xl border border-border p-4 overflow-auto ${customization.preferredLabelMode === "black" ? "bg-slate-800" : "bg-slate-100"}`}>
            <TemplateRenderer template={applied.template} data={{ ...SAMPLE, benefits: customization.defaultBenefits.length ? customization.defaultBenefits.map((n) => ({ name: n })) : SAMPLE.benefits }} branding={applied.branding} options={applied.options} scale={previewScale} />
          </div>
        </div>
      </div>
    </div>
  );
};

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <h3 className="text-sm font-bold text-foreground mb-3">{title}</h3>
    {children}
  </div>
);

const Swatches = ({ label, value, onPick, clearable, onClear }: { label: string; value: string; onPick: (c: string) => void; clearable?: boolean; onClear?: () => void }) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
    <div className="flex gap-1.5 mt-1 items-center">
      {ACCENTS.map((c) => (
        <button key={c} onClick={() => onPick(c)} className={`w-7 h-7 rounded-full border-2 ${value === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label={c} />
      ))}
      {clearable && <button onClick={onClear} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground ml-1">None</button>}
    </div>
  </div>
);

export default StickerStudioCustomize;

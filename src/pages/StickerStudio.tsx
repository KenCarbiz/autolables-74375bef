import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  TemplateRenderer, type StickerType, type StyleTag,
  type StickerData, type StickerBranding,
} from "@/lib/stickerStudio/templates";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import { LayoutTemplate, Check, Star, Paintbrush } from "lucide-react";

// Demo data used only for the gallery thumbnails.
const SAMPLE: StickerData = {
  vehicleTitle: "2027 INFINITI QX60 LUXE", vin: "5N1AL1F87VC331335", stock: "I21567",
  mileage: "17", msrp: "62335", price: "58835",
  installed: [{ name: "Ceramic Protection Package", price: "1495" }, { name: "Street Smart VIN Etch", price: "349" }],
  upgrades: [{ name: "Extended Warranty" }],
  benefits: [{ name: "Lifetime Car Washes" }, { name: "State Inspections" }],
  qrUrl: "https://autolabels.io/v/demo",
};

export function brandingFromSettings(
  settings: { dealer_name?: string; dealer_address?: string; dealer_phone?: string; dealer_logo_url?: string; why_buy_here?: string; dealer_city?: string; dealer_state?: string; used_inventory_url?: string },
  tenantName?: string
): StickerBranding {
  return {
    dealerName: settings.dealer_name || tenantName || "Your Dealership",
    address: [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", "),
    phone: settings.dealer_phone || "",
    website: settings.used_inventory_url || "",
    logoUrl: settings.dealer_logo_url || "",
    showLogo: true,
    valueProp: settings.why_buy_here || "",
    disclaimer: "Prices exclude tax, title, registration, and dealer documentary fees. See dealer for complete details.",
    accentColor: "#2563EB",
  };
}

const TYPES: { id: StickerType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "window", label: "Window Sticker · 8.5×11" },
  { id: "addendum", label: "Addendum · 4.5×11" },
];
const TAGS: StyleTag[] = ["Modern", "Classic", "Luxury", "SaaS", "Compliance"];

const StickerStudio = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const vehicleId = params.get("vehicleId") || "";
  const { settings } = useDealerSettings();
  const { tenant } = useTenant();
  const branding = useMemo(() => brandingFromSettings(settings, tenant?.name), [settings, tenant?.name]);

  const [type, setType] = useState<StickerType | "all">("all");
  const [tag, setTag] = useState<StyleTag | "all">("all");

  const { templates: catalog, byId } = useStickerCatalog();
  const { defaults, setDefault, clearDefault } = useStickerPrefs();
  const templates = catalog
    .filter((t) => (type === "all" || t.config.type === type) && (tag === "all" || t.config.styleTags.includes(tag)))
    .sort((a, b) => {
      const ad = defaults[a.config.type] === a.config.id ? 0 : 1;
      const bd = defaults[b.config.type] === b.config.id ? 0 : 1;
      return ad - bd;
    });

  const open = (id: string) => navigate(`/sticker-studio/${id}${vehicleId ? `?vehicleId=${vehicleId}` : ""}`);
  const toggleDefault = (cfgType: StickerType, key: string) => {
    if (defaults[cfgType] === key) clearDefault(cfgType);
    else setDefault(cfgType, key);
  };

  // Dealer's saved defaults, resolved to live templates for the quick-start row.
  const quickStart = (["window", "addendum"] as StickerType[])
    .map((ty) => ({ ty, template: defaults[ty] ? byId(defaults[ty]) : undefined }))
    .filter((q): q is { ty: StickerType; template: NonNullable<ReturnType<typeof byId>> } => !!q.template);

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2">
          <LayoutTemplate className="w-5 h-5 text-primary" /> Sticker Studio
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Pick a template, apply your branding, and generate a window sticker (8.5×11) or addendum (4.5×11) from any vehicle.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {TYPES.map((t) => (
            <button key={t.id} onClick={() => setType(t.id)} className={`px-3 h-8 rounded-md text-xs font-semibold transition-colors ${type === t.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          <button onClick={() => setTag("all")} className={`px-3 h-8 rounded-md text-xs font-semibold ${tag === "all" ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground"}`}>All styles</button>
          {TAGS.map((g) => (
            <button key={g} onClick={() => setTag(g)} className={`px-3 h-8 rounded-md text-xs font-semibold ${tag === g ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground"}`}>{g}</button>
          ))}
        </div>
      </div>

      {/* Quick start — jump straight into the dealer's saved default per type */}
      {quickStart.length > 0 && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-label text-blue-700 mb-2 inline-flex items-center gap-1">
            <Star className="w-3.5 h-3.5" fill="currentColor" /> Quick start with your defaults
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quickStart.map(({ ty, template }) => (
              <button
                key={ty}
                type="button"
                onClick={() => open(template.config.id)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left hover:border-primary hover:shadow-premium transition"
              >
                <div className="rounded-md bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0" style={{ width: 64, height: 64 }}>
                  <TemplateRenderer template={template} data={SAMPLE} branding={branding} scale={ty === "addendum" ? 0.12 : 0.072} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ty === "window" ? "Window Sticker" : "Addendum"}</p>
                  <p className="text-sm font-semibold text-foreground truncate">{template.config.name}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 flex-shrink-0 pr-1">Generate <Check className="w-3.5 h-3.5" /></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Gallery grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {templates.map((t) => {
          const isDefault = defaults[t.config.type] === t.config.id;
          return (
            <div
              key={t.config.id}
              className={`group relative text-left rounded-2xl border bg-card p-3 hover:shadow-premium transition ${isDefault ? "border-blue-500 ring-1 ring-blue-500/30" : "border-border hover:border-primary"}`}
            >
              <button
                type="button"
                onClick={() => toggleDefault(t.config.type, t.config.id)}
                title={isDefault ? "Default for this type — click to unset" : "Set as default for this type"}
                className={`absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded-full border transition ${isDefault ? "bg-blue-600 border-blue-600 text-white" : "bg-card/90 border-border text-muted-foreground hover:text-amber-500"}`}
              >
                <Star className="w-3.5 h-3.5" fill={isDefault ? "currentColor" : "none"} />
              </button>
              <button type="button" onClick={() => open(t.config.id)} className="block w-full text-left">
                {/* Thumbnail — a true-scale render shrunk to fit the card */}
                <div className="rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center" style={{ height: 220 }}>
                  <TemplateRenderer template={t} data={SAMPLE} branding={branding} scale={t.config.type === "addendum" ? 0.42 : 0.24} />
                </div>
                <div className="mt-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{t.config.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.config.size} · {t.config.type === "window" ? "Window" : "Addendum"}</p>
                  </div>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 flex-shrink-0">Use <Check className="w-3 h-3" /></span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {isDefault && <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Default</span>}
                  {t.config.styleTags.map((g) => (
                    <span key={g} className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{g}</span>
                  ))}
                </div>
              </button>
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                <button type="button" onClick={() => navigate(`/sticker-studio/customize/${t.config.id}`)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"><Paintbrush className="w-3 h-3" /> Customize</button>
                <button type="button" onClick={() => open(t.config.id)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600">Use template <Check className="w-3 h-3" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {templates.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">No templates match these filters yet.</p>
      )}
    </div>
  );
};

export default StickerStudio;

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  STUDIO_TEMPLATES, TemplateRenderer, type StickerType, type StyleTag,
  type StickerData, type StickerBranding,
} from "@/lib/stickerStudio/templates";
import { LayoutTemplate, Check } from "lucide-react";

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

  const templates = STUDIO_TEMPLATES.filter(
    (t) => (type === "all" || t.config.type === type) && (tag === "all" || t.config.styleTags.includes(tag))
  );

  const open = (id: string) => navigate(`/sticker-studio/${id}${vehicleId ? `?vehicleId=${vehicleId}` : ""}`);

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

      {/* Gallery grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {templates.map((t) => (
          <button
            key={t.config.id}
            onClick={() => open(t.config.id)}
            className="group text-left rounded-2xl border border-border bg-card p-3 hover:border-primary hover:shadow-premium transition"
          >
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
              {t.config.styleTags.map((g) => (
                <span key={g} className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{g}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {templates.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">No templates match these filters yet.</p>
      )}
    </div>
  );
};

export default StickerStudio;

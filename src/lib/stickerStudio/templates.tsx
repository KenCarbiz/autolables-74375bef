import { QRCodeSVG } from "qrcode.react";

// ──────────────────────────────────────────────────────────────────────
// Sticker Studio — a template-based rendering system for dealer window
// stickers (8.5x11) and addendum stickers (4.5x11). Templates are reusable
// React/HTML+CSS layouts driven by a JSON-style config object (NOT static
// images). At print time the locked layout is populated with dealer branding,
// vehicle data, and accessory line items, and rendered to PDF / PNG / print.
//
// To add a template: write a config + (reuse or add) a Render component, then
// register it in STUDIO_TEMPLATES. The gallery + generator pick it up.
// ──────────────────────────────────────────────────────────────────────

export type StickerType = "window" | "addendum";
export type StickerSize = "8.5x11" | "4.5x11";
export type StyleTag = "Modern" | "Classic" | "Luxury" | "SaaS" | "Compliance";

export interface StickerTemplateConfig {
  id: string;
  name: string;
  type: StickerType;
  size: StickerSize;
  widthIn: number;
  heightIn: number;
  styleTags: StyleTag[];
  supportsLogo: boolean;
  supportsQr: boolean;
  supportsAccent: boolean;
  defaultAccent: string;
  // Sections this template can render, in order.
  sections: ("specs" | "installed" | "upgrades" | "benefits" | "notes" | "totals" | "qr")[];
  maxItems: { installed: number; upgrades: number; benefits: number };
  requiredFields: string[];
  optionalFields: string[];
  marginsIn: number;
}

export interface StickerLineItem {
  name: string;
  price?: string;
  note?: string;
}

export interface StickerData {
  vehicleTitle: string; // "2027 INFINITI QX60 LUXE"
  vin: string;
  stock: string;
  mileage?: string;
  msrp?: string;
  price?: string;
  installed: StickerLineItem[];
  upgrades: StickerLineItem[];
  benefits: StickerLineItem[];
  notes?: string;
  qrUrl?: string;
}

export interface StickerBranding {
  dealerName: string;
  address: string;
  phone: string;
  website: string;
  logoUrl?: string;
  showLogo: boolean;
  valueProp: string;
  disclaimer: string;
  accentColor: string;
}

export interface TemplateRenderProps {
  config: StickerTemplateConfig;
  data: StickerData;
  branding: StickerBranding;
}

export interface StudioTemplate {
  config: StickerTemplateConfig;
  Render: (props: TemplateRenderProps) => JSX.Element;
}

const money = (v?: string) => {
  if (!v) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : String(v);
};
const sum = (items: StickerLineItem[]) =>
  items.reduce((s, i) => s + (Number(String(i.price || "").replace(/[^0-9.]/g, "")) || 0), 0);

// ── Shared building blocks ────────────────────────────────────────────
const ItemRows = ({ items, accent }: { items: StickerLineItem[]; accent: string }) => (
  <div className="space-y-1">
    {items.filter((i) => i.name.trim()).map((i, idx) => (
      <div key={idx} className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="text-slate-800">
          {i.name}
          {i.note ? <span className="text-slate-400"> · {i.note}</span> : null}
        </span>
        {i.price ? <span className="font-semibold tabular-nums" style={{ color: accent }}>{money(i.price)}</span> : null}
      </div>
    ))}
  </div>
);

const SectionLabel = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <p className="text-[9px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: accent }}>{children}</p>
);

// ── Window sticker layout (8.5 x 11) ──────────────────────────────────
function WindowSheet({ config, data, branding }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const classic = config.styleTags.includes("Classic");
  const installedTotal = sum(data.installed);
  const total = (Number(String(data.price || data.msrp || "").replace(/[^0-9.]/g, "")) || 0) + installedTotal;
  return (
    <div className="flex h-full flex-col bg-white text-slate-900" style={{ padding: `${config.marginsIn}in` }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b-2 pb-3" style={{ borderColor: accent }}>
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo && branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.dealerName} className="h-12 w-auto object-contain" crossOrigin="anonymous" />
          ) : null}
          <div className="min-w-0">
            <p className={`font-bold leading-tight ${classic ? "font-serif text-xl" : "text-lg"}`}>{branding.dealerName}</p>
            <p className="text-[10px] text-slate-500 truncate">{[branding.address, branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: accent }}>
          {config.type === "window" ? "Window Sticker" : "Addendum"}
        </span>
      </div>

      {/* Vehicle title */}
      <div className="mt-3">
        <p className={`font-black leading-none tracking-tight ${classic ? "font-serif text-3xl" : "text-3xl"}`}>{data.vehicleTitle || "Vehicle"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
          {data.stock && <span>Stock # <span className="font-semibold text-slate-800">{data.stock}</span></span>}
          {data.vin && <span>VIN <span className="font-mono text-slate-800">{data.vin}</span></span>}
          {data.mileage && <span>Mileage <span className="font-semibold text-slate-800">{Number(data.mileage).toLocaleString()}</span></span>}
        </div>
      </div>

      {/* Price band */}
      <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-3" style={{ backgroundColor: `${accent}10` }}>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Total Price</span>
        <span className="font-black text-2xl tabular-nums" style={{ color: accent }}>{money(String(total))}</span>
      </div>

      {/* Body sections */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        {config.sections.includes("installed") && data.installed.some((i) => i.name.trim()) && (
          <div className="col-span-2"><SectionLabel accent={accent}>Installed Equipment</SectionLabel><ItemRows items={data.installed} accent={accent} /></div>
        )}
        {config.sections.includes("benefits") && data.benefits.some((i) => i.name.trim()) && (
          <div><SectionLabel accent={accent}>Included Benefits</SectionLabel><ItemRows items={data.benefits} accent={accent} /></div>
        )}
        {config.sections.includes("upgrades") && data.upgrades.some((i) => i.name.trim()) && (
          <div><SectionLabel accent={accent}>Available Upgrades</SectionLabel><ItemRows items={data.upgrades} accent={accent} /></div>
        )}
        {config.sections.includes("notes") && data.notes ? (
          <div className="col-span-2"><SectionLabel accent={accent}>Notes</SectionLabel><p className="text-[11px] leading-relaxed text-slate-700">{data.notes}</p></div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-end justify-between gap-4 border-t border-slate-200 pt-3">
        <div className="min-w-0">
          {branding.valueProp && <p className="text-[11px] font-semibold" style={{ color: accent }}>{branding.valueProp}</p>}
          {branding.disclaimer && <p className="mt-1 text-[8px] leading-snug text-slate-400">{branding.disclaimer}</p>}
        </div>
        {config.supportsQr && data.qrUrl ? (
          <div className="text-center">
            <div className="border border-slate-200 p-1 bg-white"><QRCodeSVG value={data.qrUrl} size={64} level="M" /></div>
            <p className="mt-0.5 text-[7px] font-bold uppercase tracking-wider text-slate-400">Scan for details</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Addendum strip layout (4.5 x 11) ──────────────────────────────────
function AddendumStrip({ config, data, branding }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const luxury = config.styleTags.includes("Luxury");
  const installedTotal = sum(data.installed);
  const base = Number(String(data.msrp || "").replace(/[^0-9.]/g, "")) || 0;
  const total = base + installedTotal;
  return (
    <div className="flex h-full flex-col bg-white text-slate-900" style={{ padding: `${config.marginsIn}in` }}>
      <div className={`text-center ${luxury ? "text-white" : ""} rounded-t-md px-2 py-2`} style={{ backgroundColor: luxury ? accent : "transparent" }}>
        {config.supportsLogo && branding.showLogo && branding.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.dealerName} className="mx-auto h-10 w-auto object-contain" crossOrigin="anonymous" />
        ) : (
          <p className={`font-bold ${luxury ? "" : ""} ${luxury ? "font-serif text-lg" : "text-base"}`}>{branding.dealerName}</p>
        )}
        <p className={`text-[8px] ${luxury ? "text-white/70" : "text-slate-500"}`}>{[branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-2 border-y-2 py-1.5 text-center" style={{ borderColor: accent }}>
        <p className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>Supplemental Addendum</p>
        <p className={`font-black leading-tight ${luxury ? "font-serif text-base" : "text-sm"}`}>{data.vehicleTitle || "Vehicle"}</p>
        <p className="text-[8px] text-slate-500">{[data.stock && `Stock ${data.stock}`, data.vin && `VIN ${data.vin}`].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-2 space-y-2.5">
        {config.sections.includes("installed") && data.installed.some((i) => i.name.trim()) && (
          <div><SectionLabel accent={accent}>Installed Equipment</SectionLabel><ItemRows items={data.installed} accent={accent} /></div>
        )}
        {config.sections.includes("upgrades") && data.upgrades.some((i) => i.name.trim()) && (
          <div><SectionLabel accent={accent}>Available Upgrades</SectionLabel><ItemRows items={data.upgrades} accent={accent} /></div>
        )}
        {config.sections.includes("benefits") && data.benefits.some((i) => i.name.trim()) && (
          <div><SectionLabel accent={accent}>Included Benefits</SectionLabel><ItemRows items={data.benefits} accent={accent} /></div>
        )}
      </div>

      {config.sections.includes("totals") && (
        <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-1.5 text-[11px]">
          {base > 0 && <div className="flex justify-between"><span className="text-slate-600">Base MSRP</span><span className="tabular-nums">{money(String(base))}</span></div>}
          {installedTotal > 0 && <div className="flex justify-between"><span className="text-slate-600">Installed equipment</span><span className="tabular-nums">{money(String(installedTotal))}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Total Addendum Price</span><span className="tabular-nums" style={{ color: accent }}>{money(String(total))}</span></div>
        </div>
      )}

      <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
        {config.supportsQr && data.qrUrl ? (
          <>
            <div className="border border-slate-200 p-1 bg-white"><QRCodeSVG value={data.qrUrl} size={72} level="M" /></div>
            <p className="text-[7px] font-bold uppercase tracking-wider text-slate-400">Scan for the full vehicle packet</p>
          </>
        ) : null}
        {branding.disclaimer && <p className="text-center text-[7px] leading-snug text-slate-400">{branding.disclaimer}</p>}
      </div>
    </div>
  );
}

// ── Template registry ─────────────────────────────────────────────────
const baseWindow = (over: Partial<StickerTemplateConfig>): StickerTemplateConfig => ({
  id: "", name: "", type: "window", size: "8.5x11", widthIn: 8.5, heightIn: 11,
  styleTags: ["Modern"], supportsLogo: true, supportsQr: true, supportsAccent: true, defaultAccent: "#2563EB",
  sections: ["specs", "totals", "installed", "benefits", "upgrades", "notes", "qr"],
  maxItems: { installed: 14, upgrades: 8, benefits: 8 },
  requiredFields: ["vehicleTitle", "vin"], optionalFields: ["mileage", "msrp", "price", "notes"], marginsIn: 0.5,
  ...over,
});
const baseAddendum = (over: Partial<StickerTemplateConfig>): StickerTemplateConfig => ({
  id: "", name: "", type: "addendum", size: "4.5x11", widthIn: 4.5, heightIn: 11,
  styleTags: ["Modern"], supportsLogo: true, supportsQr: true, supportsAccent: true, defaultAccent: "#0B2041",
  sections: ["installed", "upgrades", "benefits", "totals", "qr"],
  maxItems: { installed: 12, upgrades: 6, benefits: 6 },
  requiredFields: ["vehicleTitle", "vin"], optionalFields: ["stock", "msrp"], marginsIn: 0.35,
  ...over,
});

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { config: baseWindow({ id: "window-modern", name: "Modern Window Sheet", styleTags: ["Modern", "SaaS"], defaultAccent: "#2563EB" }), Render: WindowSheet },
  { config: baseWindow({ id: "window-classic", name: "Classic Monroney", styleTags: ["Classic", "Compliance"], defaultAccent: "#0B2041", supportsAccent: false }), Render: WindowSheet },
  { config: baseWindow({ id: "window-luxury", name: "Luxury Showcase", styleTags: ["Luxury"], defaultAccent: "#7c5c1e" }), Render: WindowSheet },
  { config: baseAddendum({ id: "addendum-modern", name: "Modern Addendum Strip", styleTags: ["Modern", "SaaS"], defaultAccent: "#2563EB" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-luxury", name: "Luxury Addendum", styleTags: ["Luxury"], defaultAccent: "#7c5c1e" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-compliance", name: "Compliance Addendum", styleTags: ["Compliance", "Classic"], defaultAccent: "#0B2041", supportsAccent: false }), Render: AddendumStrip },
];

export const getStudioTemplate = (id: string) => STUDIO_TEMPLATES.find((t) => t.config.id === id);

// Render a template at its true paper size. `scale` shrinks the whole sheet
// (used for gallery thumbnails) via CSS transform without changing the layout.
export function TemplateRenderer({
  template, data, branding, scale = 1, capture,
}: {
  template: StudioTemplate;
  data: StickerData;
  branding: StickerBranding;
  scale?: number;
  capture?: React.Ref<HTMLDivElement>;
}) {
  const { config, Render } = template;
  return (
    <div style={{ width: `${config.widthIn * scale}in`, height: `${config.heightIn * scale}in` }} className="overflow-hidden">
      <div
        ref={capture}
        style={{ width: `${config.widthIn}in`, height: `${config.heightIn}in`, transform: `scale(${scale})`, transformOrigin: "top left" }}
        className="bg-white shadow-sm ring-1 ring-slate-200"
      >
        <Render config={config} data={data} branding={branding} />
      </div>
    </div>
  );
}

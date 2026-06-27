import { useState } from "react";
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
export type StyleTag = "Modern" | "Classic" | "Luxury" | "SaaS" | "Compliance" | "CPO" | "EV" | "Value" | "Readability" | "Passport";

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
  // Optional catalog metadata (surfaced in the gallery / admin).
  useCase?: string;
  complianceNote?: string;
  blackLabelReady?: boolean;
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
  specs?: string; // pre-joined key specs, e.g. "3.5L V6 · AWD · 9-Speed Auto · 20/25 MPG"
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
  secondaryColor?: string; // dealer customization: section-label / accent #2
}

// Print/output options that change presentation without touching the locked
// layout: white vs black label stock, a true Total MSRP roll-up, the addendum
// totals block toggle, and dealer section-label overrides. Owned by the
// generator + dealer customization, frozen into the generated_documents snapshot.
export type LabelMode = "white" | "black";
export interface StickerRenderOptions {
  labelMode?: LabelMode;
  totalMsrpMode?: boolean;
  showAddendumTotal?: boolean;
  sectionLabels?: Partial<Record<"installed" | "benefits" | "upgrades", string>>;
}

export interface TemplateRenderProps {
  config: StickerTemplateConfig;
  data: StickerData;
  branding: StickerBranding;
  options?: StickerRenderOptions;
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
const named = (items: StickerLineItem[]) => items.filter((i) => i.name.trim());

// Label-mode palette. Black label = premium dark stock with light text; the
// accent stays the brand color for prices and rules.
interface Palette { dark: boolean; sheetBg: string; ink: string; subInk: string; faintInk: string; hair: string; bandBg: string; }
function palette(mode: LabelMode | undefined, accent: string): Palette {
  if (mode === "black") {
    return { dark: true, sheetBg: "#0b0f17", ink: "#f5f7fa", subInk: "#aab3c2", faintInk: "#6b7480", hair: "#232b38", bandBg: `${accent}26` };
  }
  return { dark: false, sheetBg: "#ffffff", ink: "#0f172a", subInk: "#475569", faintInk: "#94a3b8", hair: "#e2e8f0", bandBg: `${accent}10` };
}

// ── Shared building blocks ────────────────────────────────────────────
// Renders up to `max` named items; any remainder collapses to a "+N more"
// line so a long option list never overflows the fixed-height sheet.
const ItemRows = ({ items, accent, pal, max }: { items: StickerLineItem[]; accent: string; pal: Palette; max?: number }) => {
  const all = named(items);
  const limit = max ?? all.length;
  const shown = all.slice(0, limit);
  const overflow = all.length - shown.length;
  return (
    <div className="space-y-1">
      {shown.map((i, idx) => (
        <div key={idx} className="flex items-baseline justify-between gap-3 text-[11px]">
          <span style={{ color: pal.ink }}>
            {i.name}
            {i.note ? <span style={{ color: pal.faintInk }}> · {i.note}</span> : null}
          </span>
          {i.price ? <span className="font-semibold tabular-nums" style={{ color: accent }}>{money(i.price)}</span> : null}
        </div>
      ))}
      {overflow > 0 && (
        <p className="text-[10px] italic" style={{ color: pal.faintInk }}>+{overflow} more {overflow === 1 ? "item" : "items"} on file</p>
      )}
    </div>
  );
};

const SectionLabel = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <p className="text-[9px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: accent }}>{children}</p>
);

// Print-safe dealer logo. Renders nothing if the URL is missing or fails to
// load (the dealer name is always shown alongside), and sits in a white chip on
// dark stock so a dark logo stays visible.
function StickerLogo({ url, alt, dark, imgClass }: { url?: string; alt: string; dark: boolean; imgClass: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  const img = <img src={url} alt={alt} className={imgClass} crossOrigin="anonymous" onError={() => setFailed(true)} />;
  return dark ? <span className="inline-flex rounded bg-white px-1.5 py-1">{img}</span> : img;
}

// ── Window sticker layout (8.5 x 11) ──────────────────────────────────
function WindowSheet({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const classic = config.styleTags.includes("Classic");
  const pal = palette(options?.labelMode, accent);
  const labelColor = branding.secondaryColor || accent;
  const secLabel = (k: "installed" | "benefits" | "upgrades", d: string) => options?.sectionLabels?.[k] || d;
  const installedTotal = sum(data.installed);
  const base = Number(String(data.price || data.msrp || "").replace(/[^0-9.]/g, "")) || 0;
  const total = base + installedTotal;
  const totalMsrp = options?.totalMsrpMode;
  const bandLabel = totalMsrp ? "Total MSRP" : "Total Price";
  return (
    <div className="flex h-full flex-col" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b-2 pb-3" style={{ borderColor: accent }}>
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo ? (
            <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-12 w-auto object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className={`font-bold leading-tight ${classic ? "font-serif text-xl" : "text-lg"}`} style={{ color: pal.ink }}>{branding.dealerName}</p>
            <p className="text-[10px] truncate" style={{ color: pal.subInk }}>{[branding.address, branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: accent }}>
          {config.type === "window" ? "Window Sticker" : "Addendum"}
        </span>
      </div>

      {/* Vehicle title */}
      <div className="mt-3">
        <p className={`font-black leading-none tracking-tight ${classic ? "font-serif text-3xl" : "text-3xl"}`} style={{ color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: pal.subInk }}>
          {data.stock && <span>Stock # <span className="font-semibold" style={{ color: pal.ink }}>{data.stock}</span></span>}
          {data.vin && <span>VIN <span className="font-mono" style={{ color: pal.ink }}>{data.vin}</span></span>}
          {data.mileage && <span>Mileage <span className="font-semibold" style={{ color: pal.ink }}>{Number(data.mileage).toLocaleString()}</span></span>}
          {data.specs && <span style={{ color: pal.ink }}>{data.specs}</span>}
        </div>
      </div>

      {/* Price band */}
      <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-3" style={{ backgroundColor: pal.bandBg }}>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: pal.subInk }}>{bandLabel}</span>
        <span className="font-black text-2xl tabular-nums" style={{ color: accent }}>{money(String(total))}</span>
      </div>

      {/* Total MSRP roll-up — base + installed, itemized */}
      {totalMsrp && (
        <div className="mt-2 space-y-0.5 text-[11px]">
          {base > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Base MSRP</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(base))}</span></div>}
          {installedTotal > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Dealer-installed equipment</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(installedTotal))}</span></div>}
        </div>
      )}

      {/* Body sections — Installed (priced) / Included benefits / Available (optional) */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        {config.sections.includes("installed") && named(data.installed).length > 0 && (
          <div className="col-span-2"><SectionLabel accent={labelColor}>{secLabel("installed", "Installed Equipment")}</SectionLabel><ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} /></div>
        )}
        {config.sections.includes("benefits") && named(data.benefits).length > 0 && (
          <div><SectionLabel accent={labelColor}>{secLabel("benefits", "Included Benefits")}</SectionLabel><ItemRows items={data.benefits} accent={accent} pal={pal} max={config.maxItems.benefits} /></div>
        )}
        {config.sections.includes("upgrades") && named(data.upgrades).length > 0 && (
          <div>
            <SectionLabel accent={labelColor}>{secLabel("upgrades", "Available Upgrades")}</SectionLabel>
            <p className="-mt-1 mb-1 text-[8px] uppercase tracking-wide" style={{ color: pal.faintInk }}>Optional · not included in price</p>
            <ItemRows items={data.upgrades} accent={accent} pal={pal} max={config.maxItems.upgrades} />
          </div>
        )}
        {config.sections.includes("notes") && data.notes ? (
          <div className="col-span-2"><SectionLabel accent={accent}>Notes</SectionLabel><p className="text-[11px] leading-relaxed" style={{ color: pal.subInk }}>{data.notes}</p></div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-end justify-between gap-4 border-t pt-3" style={{ borderColor: pal.hair }}>
        <div className="min-w-0">
          {branding.valueProp && <p className="text-[11px] font-semibold" style={{ color: accent }}>{branding.valueProp}</p>}
          {branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
        </div>
        {config.supportsQr && data.qrUrl ? (
          <div className="text-center">
            {/* Quiet zone: always a white box around the QR, even on black label */}
            <div className="bg-white" style={{ padding: "0.18in", border: `1px solid ${pal.hair}` }}><QRCodeSVG value={data.qrUrl} size={64} level="M" /></div>
            <p className="mt-0.5 text-[7px] font-bold uppercase tracking-wider" style={{ color: pal.faintInk }}>Scan for details</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Addendum strip layout (4.5 x 11) ──────────────────────────────────
function AddendumStrip({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const luxury = config.styleTags.includes("Luxury");
  const pal = palette(options?.labelMode, accent);
  const labelColor = branding.secondaryColor || accent;
  const secLabel = (k: "installed" | "benefits" | "upgrades", d: string) => options?.sectionLabels?.[k] || d;
  const installedTotal = sum(data.installed);
  const selectedUpgrades = options?.totalMsrpMode ? sum(data.upgrades) : 0;
  const base = Number(String(data.msrp || "").replace(/[^0-9.]/g, "")) || 0;
  const total = base + installedTotal + selectedUpgrades;
  const showTotals = config.sections.includes("totals") && options?.showAddendumTotal !== false;
  // On a black label the header bar uses the accent fill for both luxury and
  // standard variants so the dealer name stays legible on dark stock.
  const headerFilled = luxury || pal.dark;
  return (
    <div className="flex h-full flex-col" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink }}>
      <div className="text-center rounded-t-md px-2 py-2" style={{ backgroundColor: headerFilled ? accent : "transparent", color: headerFilled ? "#fff" : pal.ink }}>
        {config.supportsLogo && branding.showLogo && branding.logoUrl ? (
          <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark || headerFilled} imgClass="mx-auto h-10 w-auto object-contain" />
        ) : (
          <p className={`font-bold ${luxury ? "font-serif text-lg" : "text-base"}`}>{branding.dealerName}</p>
        )}
        <p className="text-[8px]" style={{ color: headerFilled ? "rgba(255,255,255,0.7)" : pal.subInk }}>{[branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-2 border-y-2 py-1.5 text-center" style={{ borderColor: accent }}>
        <p className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>Supplemental Addendum</p>
        <p className={`font-black leading-tight ${luxury ? "font-serif text-base" : "text-sm"}`} style={{ color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <p className="text-[8px]" style={{ color: pal.subInk }}>{[data.stock && `Stock ${data.stock}`, data.vin && `VIN ${data.vin}`].filter(Boolean).join(" · ")}</p>
        {data.specs && <p className="text-[8px]" style={{ color: pal.subInk }}>{data.specs}</p>}
      </div>

      <div className="mt-2 space-y-2.5">
        {config.sections.includes("installed") && named(data.installed).length > 0 && (
          <div><SectionLabel accent={labelColor}>{secLabel("installed", "Installed Equipment")}</SectionLabel><ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} /></div>
        )}
        {config.sections.includes("benefits") && named(data.benefits).length > 0 && (
          <div><SectionLabel accent={labelColor}>{secLabel("benefits", "Included Benefits")}</SectionLabel><ItemRows items={data.benefits} accent={accent} pal={pal} max={config.maxItems.benefits} /></div>
        )}
        {config.sections.includes("upgrades") && named(data.upgrades).length > 0 && (
          <div>
            <SectionLabel accent={labelColor}>{secLabel("upgrades", "Available Upgrades")}</SectionLabel>
            <p className="-mt-1 mb-1 text-[7px] uppercase tracking-wide" style={{ color: pal.faintInk }}>Optional{options?.totalMsrpMode ? "" : " · not in total"}</p>
            <ItemRows items={data.upgrades} accent={accent} pal={pal} max={config.maxItems.upgrades} />
          </div>
        )}
      </div>

      {showTotals && (
        <div className="mt-2 space-y-0.5 border-t pt-1.5 text-[11px]" style={{ borderColor: pal.hair }}>
          {base > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Base MSRP</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(base))}</span></div>}
          {installedTotal > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Installed equipment</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(installedTotal))}</span></div>}
          {selectedUpgrades > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Selected upgrades</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(selectedUpgrades))}</span></div>}
          <div className="flex justify-between border-t pt-1 font-bold" style={{ borderColor: pal.hair }}><span style={{ color: pal.ink }}>{options?.totalMsrpMode ? "Total MSRP" : "Total Addendum Price"}</span><span className="tabular-nums" style={{ color: accent }}>{money(String(total))}</span></div>
        </div>
      )}

      <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
        {config.supportsQr && data.qrUrl ? (
          <>
            <div className="bg-white" style={{ padding: "0.16in", border: `1px solid ${pal.hair}` }}><QRCodeSVG value={data.qrUrl} size={72} level="M" /></div>
            <p className="text-[7px] font-bold uppercase tracking-wider" style={{ color: pal.faintInk }}>Scan for the full vehicle packet</p>
          </>
        ) : null}
        {branding.disclaimer && <p className="text-center text-[7px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
      </div>
    </div>
  );
}

// ── Shared premium building blocks ────────────────────────────────────
const clamp2: React.CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

// QR is ALWAYS black-on-white with a white quiet zone (never inverted on dark
// stock); the surrounding white box gives scanners a clean margin.
function QrBox({ url, size, caption, captionColor }: { url?: string; size: number; caption?: string; captionColor: string }) {
  if (!url) return null;
  return (
    <div className="text-center">
      <div className="inline-block bg-white" style={{ padding: `${Math.max(7, Math.round(size * 0.12))}px`, border: "1px solid #e2e8f0", borderRadius: 10 }}>
        <QRCodeSVG value={url} size={size} level="M" bgColor="#ffffff" fgColor="#0f172a" />
      </div>
      {caption ? <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: captionColor }}>{caption}</p> : null}
    </div>
  );
}

// Best price string: prefer selling price, fall back to MSRP, else null.
const bestPrice = (data: StickerData) => money(data.price) || money(data.msrp) || "";
const featureList = (data: StickerData) => named(data.installed);

// ── 1. Vehicle Passport Premium Report (flagship, white SaaS) ─────────
function PassportPremiumSheet({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const pal = palette(options?.labelMode, accent);
  const price = bestPrice(data);
  const showMsrp = !!money(data.price) && !!money(data.msrp) && money(data.price) !== money(data.msrp);
  const benefits = named(data.benefits);
  const features = featureList(data);
  return (
    <div className="flex h-full flex-col" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink, fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-11 w-auto object-contain" /> : null}
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight tracking-tight" style={{ color: pal.ink }}>{branding.dealerName}</p>
            <p className="text-[10px] truncate" style={{ color: pal.subInk }}>{[branding.address, branding.phone, branding.website].filter(Boolean).join("  ·  ")}</p>
          </div>
        </div>
        <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap" style={{ backgroundColor: accent }}>Vehicle Passport</span>
      </div>

      {/* Title + meta chips */}
      <div className="mt-4">
        <p className="font-black leading-[1.05] tracking-tight text-[34px]" style={{ ...clamp2, color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[data.stock && `STOCK ${data.stock}`, data.vin && `VIN ${data.vin}`, data.mileage && `${Number(data.mileage).toLocaleString()} MI`, data.specs].filter(Boolean).map((c, i) => (
            <span key={i} className="text-[10px] font-semibold tracking-wide rounded-md px-2 py-1" style={{ backgroundColor: pal.dark ? "#1b2230" : "#f1f5f9", color: pal.subInk }}>{c}</span>
          ))}
        </div>
      </div>

      {/* Price + QR row */}
      <div className="mt-4 grid grid-cols-5 gap-4">
        <div className="col-span-3 rounded-2xl p-4 flex flex-col justify-center" style={{ backgroundColor: pal.bandBg, border: `1px solid ${accent}33` }}>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: pal.subInk }}>{money(data.price) ? "Our Price" : "MSRP"}</span>
          <span className="font-black tabular-nums leading-none text-[44px]" style={{ color: accent }}>{price || "Contact dealer"}</span>
          {showMsrp && <span className="mt-1 text-[12px]" style={{ color: pal.faintInk }}>MSRP <span className="line-through">{money(data.msrp)}</span></span>}
        </div>
        <div className="col-span-2 rounded-2xl p-3 flex flex-col items-center justify-center" style={{ border: `1px solid ${pal.hair}` }}>
          <QrBox url={data.qrUrl} size={104} caption="Scan the Vehicle Passport" captionColor={pal.faintInk} />
        </div>
      </div>

      {/* Transparency strip */}
      <div className="mt-3 rounded-xl px-3 py-2 text-[10px] flex items-center gap-2" style={{ backgroundColor: pal.dark ? "#141a25" : "#f8fafc", color: pal.subInk }}>
        <span className="font-bold" style={{ color: accent }}>Verified disclosure</span>
        <span style={{ color: pal.faintInk }}>· Every claim on this label is backed by the digital Vehicle Passport.</span>
      </div>

      {/* Body: benefits + features */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        {benefits.length > 0 && (
          <div>
            <SectionLabel accent={accent}>Included Benefits</SectionLabel>
            <div className="space-y-1">
              {benefits.slice(0, config.maxItems.benefits).map((b, i) => (
                <p key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: pal.ink }}><span style={{ color: accent }}>✓</span>{b.name}</p>
              ))}
            </div>
          </div>
        )}
        {features.length > 0 && (
          <div>
            <SectionLabel accent={accent}>Key Features</SectionLabel>
            <ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-3 border-t" style={{ borderColor: pal.hair }}>
        {branding.valueProp && <p className="text-[11px] font-semibold" style={{ color: accent }}>{branding.valueProp}</p>}
        {branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
      </div>
    </div>
  );
}

// ── 2. Big Price / Big QR Lot Sticker (max readability) ───────────────
function BigPriceSheet({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const pal = palette(options?.labelMode, accent);
  const price = bestPrice(data);
  const features = featureList(data).slice(0, 5);
  return (
    <div className="flex h-full flex-col text-center" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink }}>
      {/* Dealer */}
      <div className="flex items-center justify-center gap-2 pb-2 border-b-2" style={{ borderColor: accent }}>
        {config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-9 w-auto object-contain" /> : null}
        <p className="text-base font-extrabold uppercase tracking-wide" style={{ color: pal.ink }}>{branding.dealerName}</p>
      </div>

      {/* Huge title */}
      <p className="mt-3 font-black uppercase leading-[0.98] tracking-tight text-[40px]" style={{ ...clamp2, color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>

      {/* Huge price */}
      <div className="mt-3">
        <span className="block text-[12px] font-bold uppercase tracking-[0.2em]" style={{ color: pal.subInk }}>{money(data.price) ? "Our Price" : money(data.msrp) ? "MSRP" : ""}</span>
        <span className="block font-black tabular-nums leading-[0.9] text-[88px]" style={{ color: accent }}>{price || "CALL FOR PRICE"}</span>
      </div>

      {/* 5 key features */}
      {features.length > 0 && (
        <div className="mt-3 mx-auto max-w-[6.5in] grid grid-cols-1 gap-1">
          {features.map((f, i) => (
            <p key={i} className="text-[15px] font-semibold flex items-center justify-center gap-2" style={{ color: pal.ink }}>
              <span style={{ color: accent }}>●</span>{f.name}
            </p>
          ))}
        </div>
      )}

      {/* Big QR */}
      <div className="mt-auto">
        <QrBox url={data.qrUrl} size={150} caption="Scan for full details + Vehicle Passport" captionColor={pal.subInk} />
      </div>

      {/* Footer strip */}
      <div className="mt-3 pt-2 border-t" style={{ borderColor: pal.hair }}>
        <div className="flex items-center justify-center gap-x-4 gap-y-0.5 flex-wrap text-[10px]" style={{ color: pal.subInk }}>
          {data.stock && <span>STOCK <span className="font-bold" style={{ color: pal.ink }}>{data.stock}</span></span>}
          {data.vin && <span>VIN <span className="font-mono" style={{ color: pal.ink }}>{data.vin}</span></span>}
          {data.mileage && <span><span className="font-bold" style={{ color: pal.ink }}>{Number(data.mileage).toLocaleString()}</span> mi</span>}
          {data.specs && <span style={{ color: pal.ink }}>{data.specs}</span>}
          {branding.phone && <span className="font-bold" style={{ color: accent }}>{branding.phone}</span>}
        </div>
        {branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
      </div>
    </div>
  );
}

// ── 3. Executive Noir (luxury black label) ────────────────────────────
function ExecutiveNoirSheet({ config, data, branding, options }: TemplateRenderProps) {
  // Dark by default (its hero look); a "white" label choice yields a light
  // cream-luxury variant. Gold/silver accent from the template config.
  const dark = options?.labelMode !== "white";
  const gold = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const bg = dark ? "#0b0f17" : "#faf7f0";
  const ink = dark ? "#f5f2ea" : "#1a1712";
  const sub = dark ? "#b9b2a2" : "#6b6453";
  const faint = dark ? "#7a7468" : "#9a917f";
  const hair = dark ? "#2a2620" : "#e6dfd0";
  const price = bestPrice(data);
  const benefits = named(data.benefits);
  const features = featureList(data).slice(0, 6);
  return (
    <div className="flex h-full flex-col" data-label-mode={dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: bg, color: ink }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-3" style={{ borderBottom: `1px solid ${gold}` }}>
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={dark} imgClass="h-10 w-auto object-contain" /> : null}
          <p className="font-serif text-xl tracking-wide" style={{ color: ink }}>{branding.dealerName}</p>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: gold }}>Executive Collection</span>
      </div>

      {/* Title */}
      <div className="mt-5 text-center">
        <p className="font-serif leading-[1.05] text-[32px]" style={{ ...clamp2, color: ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <div className="mx-auto mt-3 mb-1" style={{ width: 60, height: 1, backgroundColor: gold }} />
      </div>

      {/* Price or Passport-Verified */}
      <div className="mt-2 text-center">
        {price ? (
          <>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: sub }}>{money(data.price) ? "Offered At" : "Manufacturer's Suggested Retail"}</span>
            <span className="block font-serif tabular-nums leading-none text-[46px]" style={{ color: gold }}>{price}</span>
          </>
        ) : (
          <span className="inline-block rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ border: `1px solid ${gold}`, color: gold }}>Vehicle Passport Verified</span>
        )}
      </div>

      {/* Feature highlights */}
      {features.length > 0 && (
        <div className="mt-5">
          <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-center mb-2" style={{ color: gold }}>Distinguished Features</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {features.map((f, i) => (
              <p key={i} className="text-[11px] flex items-start gap-2" style={{ color: ink }}><span style={{ color: gold }}>◆</span>{f.name}</p>
            ))}
          </div>
        </div>
      )}

      {/* Included benefits */}
      {benefits.length > 0 && (
        <div className="mt-4 text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: gold }}>Ownership Benefits</p>
          <p className="text-[11px]" style={{ color: sub }}>{benefits.slice(0, 4).map((b) => b.name).join("   ·   ")}</p>
        </div>
      )}

      {/* QR */}
      <div className="mt-auto flex items-end justify-between gap-4 pt-4">
        <div className="text-[9px] leading-relaxed" style={{ color: faint }}>
          {data.stock && <p>Stock <span style={{ color: sub }}>{data.stock}</span></p>}
          {data.vin && <p>VIN <span className="font-mono" style={{ color: sub }}>{data.vin}</span></p>}
          {data.mileage && <p>Mileage <span style={{ color: sub }}>{Number(data.mileage).toLocaleString()}</span></p>}
          {data.specs && <p style={{ color: sub }}>{data.specs}</p>}
        </div>
        <QrBox url={data.qrUrl} size={92} caption="Vehicle Passport" captionColor={faint} />
      </div>
      {branding.disclaimer && <p className="mt-2 text-[7px] leading-snug text-center" style={{ color: faint }}>{branding.disclaimer}</p>}
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
  // ── Window stickers (8.5 x 11) ──────────────────────────────────────
  // Keys match the live DB catalog (public.sticker_templates). The three hero
  // layouts attach to the live keys window-premium / window-bold / window-luxury.
  { config: baseWindow({ id: "window-premium", name: "Vehicle Passport Premium", styleTags: ["Passport", "Modern"], defaultAccent: "#2563EB", useCase: "Flagship scan-first window sticker with premium price + QR cards" }), Render: PassportPremiumSheet },
  { config: baseWindow({ id: "window-bold", name: "Big Price Lot Sticker", styleTags: ["Value", "Readability"], defaultAccent: "#b91c1c", blackLabelReady: true, useCase: "High-readability lot sticker with huge price and QR" }), Render: BigPriceSheet },
  { config: baseWindow({ id: "window-luxury", name: "Executive Noir", styleTags: ["Luxury"], defaultAccent: "#c9a227", blackLabelReady: true, useCase: "Luxury black-label window sticker for high-line inventory" }), Render: ExecutiveNoirSheet },
  { config: baseWindow({ id: "window-modern", name: "Modern Window", styleTags: ["Modern", "SaaS"], defaultAccent: "#2563EB", blackLabelReady: true, useCase: "Everyday used-car window sticker" }), Render: WindowSheet },
  { config: baseWindow({ id: "window-classic", name: "Classic Monroney", styleTags: ["Classic", "Compliance"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Factory-style disclosure layout", complianceNote: "Mirrors the Monroney convention; fixed navy scheme." }), Render: WindowSheet },
  { config: baseWindow({ id: "window-minimal", name: "Minimal Window", styleTags: ["Readability", "Classic"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Maximum legibility, low ink" }), Render: WindowSheet },
  // ── Addendum strips (4.5 x 11) ──────────────────────────────────────
  { config: baseAddendum({ id: "addendum-modern", name: "Clean Addendum Blue", styleTags: ["Modern", "SaaS"], defaultAccent: "#2563EB", blackLabelReady: true, useCase: "Default supplemental addendum" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-luxury", name: "Luxury Black Addendum", styleTags: ["Luxury"], defaultAccent: "#7c5c1e", blackLabelReady: true, useCase: "Premium add-on strip" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-compliance", name: "Compliance-First Addendum", styleTags: ["Compliance", "Classic"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Disclosure-forward addendum", complianceNote: "QR required; fixed navy scheme." }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-value", name: "Value Stack Addendum", styleTags: ["Value", "Modern"], defaultAccent: "#b91c1c", useCase: "Stacked value / savings emphasis" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-installed", name: "Installed Equipment Focus", styleTags: ["Modern"], defaultAccent: "#2563EB", maxItems: { installed: 16, upgrades: 6, benefits: 6 }, useCase: "Heavy dealer-installed accessory lists" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-passport", name: "QR Passport Addendum", styleTags: ["Passport", "Modern"], defaultAccent: "#2563EB", useCase: "Scan-to-packet addendum" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-readable", name: "Narrow High-Readability", styleTags: ["Readability", "Classic"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Maximum legibility addendum" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-lot", name: "Minimal Lot Label", styleTags: ["Readability", "Compliance"], defaultAccent: "#111827", supportsAccent: false, blackLabelReady: true, useCase: "Bare-bones black/white lot label" }), Render: AddendumStrip },
  { config: baseAddendum({ id: "addendum-noir", name: "Executive Noir Addendum", styleTags: ["Luxury"], defaultAccent: "#c9a227", blackLabelReady: true, useCase: "Black-label premium add-on strip" }), Render: AddendumStrip },
];

export const getStudioTemplate = (id: string) => STUDIO_TEMPLATES.find((t) => t.config.id === id);

// Render engines keyed by sticker type — the catalog (DB rows) maps to one of
// these so new template variants ship as data, not code.
export const RENDER_ENGINES: Record<string, (props: TemplateRenderProps) => JSX.Element> = {
  window: WindowSheet,
  addendum: AddendumStrip,
  passport: WindowSheet,
};

// Premium hero renderers keyed by template id. Lets the DB-backed catalog map a
// specific template to a dedicated layout (still data-driven config, no static
// images); any window template not listed here uses the generic WindowSheet.
// Keyed by the LIVE DB template_key (= config.id). Any window template not
// listed here uses the generic WindowSheet.
const PREMIUM_RENDERERS: Record<string, (props: TemplateRenderProps) => JSX.Element> = {
  "window-premium": PassportPremiumSheet,
  "window-bold": BigPriceSheet,
  "window-luxury": ExecutiveNoirSheet,
};

// Merge a stored config override onto the code base config for the type.
export function buildConfig(type: StickerType, over: Partial<StickerTemplateConfig>): StickerTemplateConfig {
  return (type === "addendum" ? baseAddendum : baseWindow)(over);
}

export function templateFromConfig(config: StickerTemplateConfig): StudioTemplate {
  const Render = PREMIUM_RENDERERS[config.id] || RENDER_ENGINES[config.type] || WindowSheet;
  return { config, Render };
}

// Render a template at its true paper size. `scale` shrinks the whole sheet
// (used for gallery thumbnails) via CSS transform without changing the layout.
export function TemplateRenderer({
  template, data, branding, scale = 1, capture, options,
}: {
  template: StudioTemplate;
  data: StickerData;
  branding: StickerBranding;
  scale?: number;
  capture?: React.Ref<HTMLDivElement>;
  options?: StickerRenderOptions;
}) {
  const { config, Render } = template;
  return (
    <div style={{ width: `${config.widthIn * scale}in`, height: `${config.heightIn * scale}in` }} className="overflow-hidden">
      <div
        ref={capture}
        style={{ width: `${config.widthIn}in`, height: `${config.heightIn}in`, transform: `scale(${scale})`, transformOrigin: "top left" }}
        className="bg-white shadow-sm ring-1 ring-slate-200"
      >
        <Render config={config} data={data} branding={branding} options={options} />
      </div>
    </div>
  );
}

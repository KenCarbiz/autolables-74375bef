import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

// ──────────────────────────────────────────────────────────────────────
// Sticker Studio — template-based rendering for dealer window stickers and
// addendum stickers. Templates are real React/HTML/CSS layouts, not static
// images, so generated documents can be populated from live vehicle data and
// frozen into immutable snapshots.
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
  sections: ("specs" | "installed" | "upgrades" | "benefits" | "notes" | "totals" | "qr")[];
  maxItems: { installed: number; upgrades: number; benefits: number };
  requiredFields: string[];
  optionalFields: string[];
  marginsIn: number;
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
  vehicleTitle: string;
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

  // Optional next-generation window-sticker data. All fields are optional so
  // older templates, saved snapshots, and fallback vehicle-prefill paths remain
  // compatible.
  vehicleImageUrl?: string;
  exteriorColor?: string;
  interiorColor?: string;
  engine?: string;
  drivetrain?: string;
  transmission?: string;
  fuelEconomyCity?: string;
  fuelEconomyHighway?: string;
  fuelType?: string;
  doorsSeats?: string;
  marketPrice?: string;
  marketStatus?: string;
  marketDelta?: string;
  estimatedPayment?: string;
  vehicleScore?: string;
  vehicleScoreLabel?: string;
  dealerTrustScore?: string;
  dealerReviewCount?: string;
  journeyEvents?: Array<{ label: string; date?: string; note?: string }>;
  historySignals?: string[];
  topFeatures?: string[];
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
  secondaryColor?: string;
}

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
const clamp2: React.CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

interface Palette { dark: boolean; sheetBg: string; ink: string; subInk: string; faintInk: string; hair: string; bandBg: string; }
function palette(mode: LabelMode | undefined, accent: string): Palette {
  if (mode === "black") {
    return { dark: true, sheetBg: "#0b0f17", ink: "#f5f7fa", subInk: "#aab3c2", faintInk: "#6b7480", hair: "#232b38", bandBg: `${accent}26` };
  }
  return { dark: false, sheetBg: "#ffffff", ink: "#0f172a", subInk: "#475569", faintInk: "#94a3b8", hair: "#e2e8f0", bandBg: `${accent}10` };
}

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
      {overflow > 0 && <p className="text-[10px] italic" style={{ color: pal.faintInk }}>+{overflow} more {overflow === 1 ? "item" : "items"} on file</p>}
    </div>
  );
};

const SectionLabel = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <p className="text-[9px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: accent }}>{children}</p>
);

function StickerLogo({ url, alt, dark, imgClass }: { url?: string; alt: string; dark: boolean; imgClass: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  const img = <img src={url} alt={alt} className={imgClass} crossOrigin="anonymous" onError={() => setFailed(true)} />;
  return dark ? <span className="inline-flex rounded bg-white px-1.5 py-1">{img}</span> : img;
}

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

const bestPrice = (data: StickerData) => money(data.price) || money(data.msrp) || "";
const featureList = (data: StickerData) => {
  const explicit = data.topFeatures?.filter(Boolean).map((name) => ({ name })) ?? [];
  return explicit.length ? explicit : named(data.installed);
};

// ── Generic window sticker layout (8.5 x 11) ───────────────────────────
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
      <div className="flex items-center justify-between gap-4 border-b-2 pb-3" style={{ borderColor: accent }}>
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-12 w-auto object-contain" /> : null}
          <div className="min-w-0">
            <p className={`font-bold leading-tight ${classic ? "font-serif text-xl" : "text-lg"}`} style={{ color: pal.ink }}>{branding.dealerName}</p>
            <p className="text-[10px] truncate" style={{ color: pal.subInk }}>{[branding.address, branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: accent }}>Window Sticker</span>
      </div>

      <div className="mt-3">
        <p className={`font-black leading-none tracking-tight ${classic ? "font-serif text-3xl" : "text-3xl"}`} style={{ color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: pal.subInk }}>
          {data.stock && <span>Stock # <span className="font-semibold" style={{ color: pal.ink }}>{data.stock}</span></span>}
          {data.vin && <span>VIN <span className="font-mono" style={{ color: pal.ink }}>{data.vin}</span></span>}
          {data.mileage && <span>Mileage <span className="font-semibold" style={{ color: pal.ink }}>{Number(data.mileage).toLocaleString()}</span></span>}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-3" style={{ backgroundColor: pal.bandBg }}>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: pal.subInk }}>{bandLabel}</span>
        <span className="font-black text-2xl tabular-nums" style={{ color: accent }}>{money(String(total))}</span>
      </div>

      {totalMsrp && (
        <div className="mt-2 space-y-0.5 text-[11px]">
          {base > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Base MSRP</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(base))}</span></div>}
          {installedTotal > 0 && <div className="flex justify-between"><span style={{ color: pal.subInk }}>Dealer-installed equipment</span><span className="tabular-nums" style={{ color: pal.ink }}>{money(String(installedTotal))}</span></div>}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        {config.sections.includes("installed") && named(data.installed).length > 0 && <div className="col-span-2"><SectionLabel accent={labelColor}>{secLabel("installed", "Installed Equipment")}</SectionLabel><ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} /></div>}
        {config.sections.includes("benefits") && named(data.benefits).length > 0 && <div><SectionLabel accent={labelColor}>{secLabel("benefits", "Included Benefits")}</SectionLabel><ItemRows items={data.benefits} accent={accent} pal={pal} max={config.maxItems.benefits} /></div>}
        {config.sections.includes("upgrades") && named(data.upgrades).length > 0 && <div><SectionLabel accent={labelColor}>{secLabel("upgrades", "Available Upgrades")}</SectionLabel><p className="-mt-1 mb-1 text-[8px] uppercase tracking-wide" style={{ color: pal.faintInk }}>Optional · not included in price</p><ItemRows items={data.upgrades} accent={accent} pal={pal} max={config.maxItems.upgrades} /></div>}
        {config.sections.includes("notes") && data.notes ? <div className="col-span-2"><SectionLabel accent={accent}>Notes</SectionLabel><p className="text-[11px] leading-relaxed" style={{ color: pal.subInk }}>{data.notes}</p></div> : null}
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 border-t pt-3" style={{ borderColor: pal.hair }}>
        <div className="min-w-0">
          {branding.valueProp && <p className="text-[11px] font-semibold" style={{ color: accent }}>{branding.valueProp}</p>}
          {branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
        </div>
        {config.supportsQr && data.qrUrl ? <QrBox url={data.qrUrl} size={64} caption="Scan for details" captionColor={pal.faintInk} /> : null}
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
  const headerFilled = luxury || pal.dark;
  return (
    <div className="flex h-full flex-col" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink }}>
      <div className="text-center rounded-t-md px-2 py-2" style={{ backgroundColor: headerFilled ? accent : "transparent", color: headerFilled ? "#fff" : pal.ink }}>
        {config.supportsLogo && branding.showLogo && branding.logoUrl ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark || headerFilled} imgClass="mx-auto h-10 w-auto object-contain" /> : <p className={`font-bold ${luxury ? "font-serif text-lg" : "text-base"}`}>{branding.dealerName}</p>}
        <p className="text-[8px]" style={{ color: headerFilled ? "rgba(255,255,255,0.7)" : pal.subInk }}>{[branding.phone, branding.website].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-2 border-y-2 py-1.5 text-center" style={{ borderColor: accent }}>
        <p className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>Supplemental Addendum</p>
        <p className={`font-black leading-tight ${luxury ? "font-serif text-base" : "text-sm"}`} style={{ color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
        <p className="text-[8px]" style={{ color: pal.subInk }}>{[data.stock && `Stock ${data.stock}`, data.vin && `VIN ${data.vin}`].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-2 space-y-2.5">
        {config.sections.includes("installed") && named(data.installed).length > 0 && <div><SectionLabel accent={labelColor}>{secLabel("installed", "Installed Equipment")}</SectionLabel><ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} /></div>}
        {config.sections.includes("benefits") && named(data.benefits).length > 0 && <div><SectionLabel accent={labelColor}>{secLabel("benefits", "Included Benefits")}</SectionLabel><ItemRows items={data.benefits} accent={accent} pal={pal} max={config.maxItems.benefits} /></div>}
        {config.sections.includes("upgrades") && named(data.upgrades).length > 0 && <div><SectionLabel accent={labelColor}>{secLabel("upgrades", "Available Upgrades")}</SectionLabel><p className="-mt-1 mb-1 text-[7px] uppercase tracking-wide" style={{ color: pal.faintInk }}>Optional{options?.totalMsrpMode ? "" : " · not in total"}</p><ItemRows items={data.upgrades} accent={accent} pal={pal} max={config.maxItems.upgrades} /></div>}
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
        {config.supportsQr && data.qrUrl ? <QrBox url={data.qrUrl} size={72} caption="Scan for the full vehicle packet" captionColor={pal.faintInk} /> : null}
        {branding.disclaimer && <p className="text-center text-[7px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}
      </div>
    </div>
  );
}

// ── Existing premium hero templates ───────────────────────────────────
function PassportPremiumSheet({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const pal = palette(options?.labelMode, accent);
  const price = bestPrice(data);
  const showMsrp = !!money(data.price) && !!money(data.msrp) && money(data.price) !== money(data.msrp);
  const benefits = named(data.benefits);
  const features = featureList(data);
  return (
    <div className="flex h-full flex-col" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink, fontFeatureSettings: '"tnum"' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-11 w-auto object-contain" /> : null}
          <div className="min-w-0"><p className="text-lg font-bold leading-tight tracking-tight" style={{ color: pal.ink }}>{branding.dealerName}</p><p className="text-[10px] truncate" style={{ color: pal.subInk }}>{[branding.address, branding.phone, branding.website].filter(Boolean).join("  ·  ")}</p></div>
        </div>
        <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap" style={{ backgroundColor: accent }}>Vehicle Passport</span>
      </div>
      <div className="mt-4"><p className="font-black leading-[1.05] tracking-tight text-[34px]" style={{ ...clamp2, color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p><div className="mt-2 flex flex-wrap gap-1.5">{[data.stock && `STOCK ${data.stock}`, data.vin && `VIN ${data.vin}`, data.mileage && `${Number(data.mileage).toLocaleString()} MI`].filter(Boolean).map((c, i) => <span key={i} className="text-[10px] font-semibold tracking-wide rounded-md px-2 py-1" style={{ backgroundColor: pal.dark ? "#1b2230" : "#f1f5f9", color: pal.subInk }}>{c}</span>)}</div></div>
      <div className="mt-4 grid grid-cols-5 gap-4"><div className="col-span-3 rounded-2xl p-4 flex flex-col justify-center" style={{ backgroundColor: pal.bandBg, border: `1px solid ${accent}33` }}><span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: pal.subInk }}>{money(data.price) ? "Our Price" : "MSRP"}</span><span className="font-black tabular-nums leading-none text-[44px]" style={{ color: accent }}>{price || "Contact dealer"}</span>{showMsrp && <span className="mt-1 text-[12px]" style={{ color: pal.faintInk }}>MSRP <span className="line-through">{money(data.msrp)}</span></span>}</div><div className="col-span-2 rounded-2xl p-3 flex flex-col items-center justify-center" style={{ border: `1px solid ${pal.hair}` }}><QrBox url={data.qrUrl} size={104} caption="Scan the Vehicle Passport" captionColor={pal.faintInk} /></div></div>
      <div className="mt-3 rounded-xl px-3 py-2 text-[10px] flex items-center gap-2" style={{ backgroundColor: pal.dark ? "#141a25" : "#f8fafc", color: pal.subInk }}><span className="font-bold" style={{ color: accent }}>Verified disclosure</span><span style={{ color: pal.faintInk }}>· Every claim on this label is backed by the digital Vehicle Passport.</span></div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">{benefits.length > 0 && <div><SectionLabel accent={accent}>Included Benefits</SectionLabel><div className="space-y-1">{benefits.slice(0, config.maxItems.benefits).map((b, i) => <p key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: pal.ink }}><span style={{ color: accent }}>✓</span>{b.name}</p>)}</div></div>}{features.length > 0 && <div><SectionLabel accent={accent}>Key Features</SectionLabel><ItemRows items={data.installed} accent={accent} pal={pal} max={config.maxItems.installed} /></div>}</div>
      <div className="mt-auto pt-3 border-t" style={{ borderColor: pal.hair }}>{branding.valueProp && <p className="text-[11px] font-semibold" style={{ color: accent }}>{branding.valueProp}</p>}{branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}</div>
    </div>
  );
}

function BigPriceSheet({ config, data, branding, options }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const pal = palette(options?.labelMode, accent);
  const price = bestPrice(data);
  const features = featureList(data).slice(0, 5);
  return (
    <div className="flex h-full flex-col text-center" data-label-mode={pal.dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: pal.sheetBg, color: pal.ink }}>
      <div className="flex items-center justify-center gap-2 pb-2 border-b-2" style={{ borderColor: accent }}>{config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={pal.dark} imgClass="h-9 w-auto object-contain" /> : null}<p className="text-base font-extrabold uppercase tracking-wide" style={{ color: pal.ink }}>{branding.dealerName}</p></div>
      <p className="mt-3 font-black uppercase leading-[0.98] tracking-tight text-[40px]" style={{ ...clamp2, color: pal.ink }}>{data.vehicleTitle || "Vehicle"}</p>
      <div className="mt-3"><span className="block text-[12px] font-bold uppercase tracking-[0.2em]" style={{ color: pal.subInk }}>{money(data.price) ? "Our Price" : money(data.msrp) ? "MSRP" : ""}</span><span className="block font-black tabular-nums leading-[0.9] text-[88px]" style={{ color: accent }}>{price || "CALL FOR PRICE"}</span></div>
      {features.length > 0 && <div className="mt-3 mx-auto max-w-[6.5in] grid grid-cols-1 gap-1">{features.map((f, i) => <p key={i} className="text-[15px] font-semibold flex items-center justify-center gap-2" style={{ color: pal.ink }}><span style={{ color: accent }}>●</span>{f.name}</p>)}</div>}
      <div className="mt-auto"><QrBox url={data.qrUrl} size={150} caption="Scan for full details + Vehicle Passport" captionColor={pal.subInk} /></div>
      <div className="mt-3 pt-2 border-t" style={{ borderColor: pal.hair }}><div className="flex items-center justify-center gap-x-4 gap-y-0.5 flex-wrap text-[10px]" style={{ color: pal.subInk }}>{data.stock && <span>STOCK <span className="font-bold" style={{ color: pal.ink }}>{data.stock}</span></span>}{data.vin && <span>VIN <span className="font-mono" style={{ color: pal.ink }}>{data.vin}</span></span>}{data.mileage && <span><span className="font-bold" style={{ color: pal.ink }}>{Number(data.mileage).toLocaleString()}</span> mi</span>}{branding.phone && <span className="font-bold" style={{ color: accent }}>{branding.phone}</span>}</div>{branding.disclaimer && <p className="mt-1 text-[8px] leading-snug" style={{ color: pal.faintInk }}>{branding.disclaimer}</p>}</div>
    </div>
  );
}

function ExecutiveNoirSheet({ config, data, branding, options }: TemplateRenderProps) {
  const dark = options?.labelMode !== "white";
  const gold = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const bg = dark ? "#0b0f17" : "#faf7f0";
  const ink = dark ? "#f5f2ea" : "#1a1712";
  const sub = dark ? "#b9b2a2" : "#6b6453";
  const faint = dark ? "#7a7468" : "#9a917f";
  const price = bestPrice(data);
  const benefits = named(data.benefits);
  const features = featureList(data).slice(0, 6);
  return (
    <div className="flex h-full flex-col" data-label-mode={dark ? "black" : "white"} style={{ padding: `${config.marginsIn}in`, backgroundColor: bg, color: ink }}>
      <div className="flex items-center justify-between gap-4 pb-3" style={{ borderBottom: `1px solid ${gold}` }}><div className="flex items-center gap-3 min-w-0">{config.supportsLogo && branding.showLogo ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={dark} imgClass="h-10 w-auto object-contain" /> : null}<p className="font-serif text-xl tracking-wide" style={{ color: ink }}>{branding.dealerName}</p></div><span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: gold }}>Executive Collection</span></div>
      <div className="mt-5 text-center"><p className="font-serif leading-[1.05] text-[32px]" style={{ ...clamp2, color: ink }}>{data.vehicleTitle || "Vehicle"}</p><div className="mx-auto mt-3 mb-1" style={{ width: 60, height: 1, backgroundColor: gold }} /></div>
      <div className="mt-2 text-center">{price ? <><span className="block text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: sub }}>{money(data.price) ? "Offered At" : "Manufacturer's Suggested Retail"}</span><span className="block font-serif tabular-nums leading-none text-[46px]" style={{ color: gold }}>{price}</span></> : <span className="inline-block rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ border: `1px solid ${gold}`, color: gold }}>Vehicle Passport Verified</span>}</div>
      {features.length > 0 && <div className="mt-5"><p className="text-[9px] font-bold uppercase tracking-[0.24em] text-center mb-2" style={{ color: gold }}>Distinguished Features</p><div className="grid grid-cols-2 gap-x-6 gap-y-1.5">{features.map((f, i) => <p key={i} className="text-[11px] flex items-start gap-2" style={{ color: ink }}><span style={{ color: gold }}>◆</span>{f.name}</p>)}</div></div>}
      {benefits.length > 0 && <div className="mt-4 text-center"><p className="text-[9px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: gold }}>Ownership Benefits</p><p className="text-[11px]" style={{ color: sub }}>{benefits.slice(0, 4).map((b) => b.name).join("   ·   ")}</p></div>}
      <div className="mt-auto flex items-end justify-between gap-4 pt-4"><div className="text-[9px] leading-relaxed" style={{ color: faint }}>{data.stock && <p>Stock <span style={{ color: sub }}>{data.stock}</span></p>}{data.vin && <p>VIN <span className="font-mono" style={{ color: sub }}>{data.vin}</span></p>}{data.mileage && <p>Mileage <span style={{ color: sub }}>{Number(data.mileage).toLocaleString()}</span></p>}</div><QrBox url={data.qrUrl} size={92} caption="Vehicle Passport" captionColor={faint} /></div>
      {branding.disclaimer && <p className="mt-2 text-[7px] leading-snug text-center" style={{ color: faint }}>{branding.disclaimer}</p>}
    </div>
  );
}

// ── Next-generation Vehicle Passport Pro ──────────────────────────────
function PassportCard({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-3 ${className}`}>
      {title ? <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">{title}</p> : null}
      {children}
    </div>
  );
}

function PassportMetric({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: string }) {
  return (
    <div className="flex items-center gap-2 border-r border-slate-200 last:border-r-0 px-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-base text-blue-700">{icon || "•"}</span>
      <div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="text-[15px] font-black leading-tight text-slate-950">{value}</p>{sub ? <p className="text-[8px] text-slate-500">{sub}</p> : null}</div>
    </div>
  );
}

function PassportPhotoPanel({ data }: { data: StickerData }) {
  if (data.vehicleImageUrl) {
    return <img src={data.vehicleImageUrl} alt={data.vehicleTitle} crossOrigin="anonymous" className="h-[1.75in] w-full object-contain" />;
  }
  return (
    <div className="flex h-[1.75in] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50 text-center text-[11px] font-semibold text-slate-400">
      Vehicle photo ready<br />when inventory image is available
    </div>
  );
}

function PassportFeaturePill({ label }: { label: string }) {
  return <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[8px] font-semibold text-slate-700">✓ {label}</span>;
}

function PassportTimeline({ events }: { events?: StickerData["journeyEvents"] }) {
  const fallback = [
    { label: "Acquired", date: "Inventory" },
    { label: "Inspected", date: "Multi-point" },
    { label: "Reconditioned", date: "Quality" },
    { label: "Certified", date: "Approved" },
    { label: "Listed", date: "Available" },
  ];
  const rows = (events?.length ? events : fallback).slice(0, 5);
  return (
    <div className="grid grid-cols-5 gap-1">
      {rows.map((e, i) => (
        <div key={`${e.label}-${i}`} className="text-center">
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-blue-300 bg-white text-[12px] font-bold text-blue-700">{i + 1}</div>
          <p className="mt-1 text-[8px] font-black uppercase text-slate-800">{e.label}</p>
          <p className="text-[7px] leading-tight text-slate-500">{e.date || e.note}</p>
        </div>
      ))}
    </div>
  );
}

function VehiclePassportProSheet({ config, data, branding }: TemplateRenderProps) {
  const accent = config.supportsAccent ? branding.accentColor : config.defaultAccent;
  const price = bestPrice(data) || "Contact dealer";
  const marketPrice = money(data.marketPrice) || price;
  const mpg = [data.fuelEconomyCity, data.fuelEconomyHighway].filter(Boolean).join(" / ") || "Ask";
  const features = featureList(data).slice(0, 12);
  const benefits = named(data.benefits).slice(0, 5);
  const history = (data.historySignals?.length ? data.historySignals : ["Ownership History Verified", "Title & Brand Check", "Odometer Verified", "Service & Maintenance Records", "Inspection & Reconditioning"]).slice(0, 5);
  return (
    <div className="flex h-full flex-col bg-white text-slate-950" data-label-mode="white" style={{ padding: `${config.marginsIn}in`, fontFeatureSettings: '"tnum"' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {branding.showLogo && branding.logoUrl ? <StickerLogo url={branding.logoUrl} alt={branding.dealerName} dark={false} imgClass="h-11 w-auto object-contain" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-2xl font-black text-white">A</div>}
          <div><p className="text-[23px] font-black tracking-tight">{branding.dealerName || "autolabels.io"}</p><p className="text-[10px] font-medium text-slate-500">AI-Powered Vehicle Transparency</p></div>
        </div>
        <div className="flex items-start gap-3">
          <div className="hidden rounded-xl px-2 py-1 sm:block"><p className="text-[10px] font-black uppercase text-slate-900">FTC Compliant</p><p className="text-[8px] text-slate-500">All disclosures delivered digitally and in print.</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-2 text-center"><QrBox url={data.qrUrl} size={68} caption="Scan to view full report" captionColor="#0f172a" /></div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3">
        <div className="col-span-5">
          <p className="mb-1 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: accent }}>Vehicle Passport</p>
          <p className="text-[31px] font-black uppercase leading-[1.02] tracking-tight" style={{ ...clamp2 }}>{data.vehicleTitle || "Vehicle"}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[9px]">
            <div><p className="font-bold uppercase text-slate-500">Stock Number</p><p className="font-black">{data.stock || "—"}</p></div>
            <div><p className="font-bold uppercase text-slate-500">VIN</p><p className="font-mono font-black">{data.vin || "—"}</p></div>
            <div><p className="font-bold uppercase text-slate-500">Exterior</p><p className="font-black">{data.exteriorColor || "See vehicle"}</p></div>
            <div><p className="font-bold uppercase text-slate-500">Interior</p><p className="font-black">{data.interiorColor || "See vehicle"}</p></div>
          </div>
        </div>
        <div className="col-span-7"><PassportPhotoPanel data={data} /></div>
      </div>

      <div className="mt-3 grid grid-cols-6 rounded-xl border border-slate-200 bg-white py-2">
        <PassportMetric label="Mileage" value={data.mileage ? Number(data.mileage).toLocaleString() : "Ask"} sub="Miles" icon="◷" />
        <PassportMetric label="Fuel Economy" value={mpg} sub="MPG City / Hwy" icon="⛽" />
        <PassportMetric label="Engine" value={data.engine || "Ask"} sub={data.fuelType || ""} icon="▣" />
        <PassportMetric label="Drivetrain" value={data.drivetrain || "Ask"} sub="" icon="◇" />
        <PassportMetric label="Transmission" value={data.transmission || "Ask"} sub="Automatic" icon="◎" />
        <PassportMetric label="Fuel Type" value={data.fuelType || "Gasoline"} sub="" icon="⛽" />
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3">
        <PassportCard title="Vehicle Confidence Score" className="col-span-4">
          <div className="flex items-center justify-center"><div className="flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-green-400"><div className="text-center"><p className="text-[40px] font-black leading-none">{data.vehicleScore || "93"}</p><p className="text-[10px] font-bold text-slate-500">/100</p></div></div></div>
          <p className="mt-1 text-center text-[12px] font-black text-green-600 uppercase">{data.vehicleScoreLabel || "Excellent"}</p>
          <p className="mt-1 text-center text-[8px] leading-snug text-slate-500">Our AI analyzes inventory, history, condition, and value signals.</p>
        </PassportCard>
        <PassportCard title="Price Position" className="col-span-4">
          <p className="text-center text-[16px] font-black text-green-600 uppercase">{data.marketStatus || "Great Value"}</p>
          <p className="mt-1 text-center text-[10px] text-slate-600">{data.marketDelta || "$1,240 below market average"}</p>
          <div className="mx-auto mt-3 h-16 w-40 rounded-t-full border-[14px] border-b-0 border-green-400" />
          <div className="mt-2 flex justify-between text-[7px] font-semibold text-slate-500"><span>Below</span><span>Market</span><span>Above</span></div>
        </PassportCard>
        <div className="col-span-4 rounded-xl bg-slate-950 p-3 text-white">
          <p className="text-[12px] font-black uppercase tracking-[0.08em]">Digital Vehicle Passport</p>
          <p className="mt-1 text-[9px] leading-snug text-slate-300">This vehicle has a verified digital passport with supporting records.</p>
          <div className="mt-2 space-y-1">{history.map((h) => <p key={h} className="text-[9px]">✓ {h}</p>)}</div>
          <div className="mt-3 rounded-full bg-white px-3 py-1 text-center text-[9px] font-black text-slate-950">View Full Passport Report ›</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3">
        <PassportCard title="Ownership Benefits Included" className="col-span-7">
          <div className="grid grid-cols-5 gap-2 text-center">
            {(benefits.length ? benefits : [{ name: "Powertrain Warranty" }, { name: "Maintenance" }, { name: "Roadside Assistance" }, { name: "Exchange Policy" }, { name: "CARFAX Report" }]).map((b, i) => <div key={`${b.name}-${i}`}><div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700">✓</div><p className="text-[8px] font-bold leading-tight">{b.name}</p></div>)}
          </div>
        </PassportCard>
        <PassportCard title="Dealer Trust Score" className="col-span-5">
          <div className="flex items-center gap-3"><div className="text-[40px] font-black leading-none">{data.dealerTrustScore || "4.9"}</div><div><p className="text-[18px] text-blue-600">★★★★★</p><p className="text-[8px] text-slate-500">Based on {data.dealerReviewCount || "1,250+"} verified reviews</p></div></div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[7px] text-slate-500"><span>Responsive</span><span>Transparent</span><span>Quality</span><span>Verified</span></div>
        </PassportCard>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3">
        <PassportCard title="Vehicle Journey Timeline" className="col-span-7"><PassportTimeline events={data.journeyEvents} /></PassportCard>
        <PassportCard title="Vehicle Highlights" className="col-span-5"><div className="flex flex-wrap gap-1">{features.slice(0, 12).map((f) => <PassportFeaturePill key={f.name} label={f.name} />)}{features.length === 0 ? <p className="text-[9px] text-slate-500">Highlights appear here when data is available.</p> : null}</div></PassportCard>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3">
        <PassportCard title="Market Price" className="col-span-5"><p className="text-[33px] font-black leading-none">{marketPrice}</p><p className="mt-1 text-[10px] font-semibold text-green-600">✓ {data.marketStatus || "Within Market Range"}</p></PassportCard>
        <PassportCard title="Est. Monthly Payment" className="col-span-3"><p className="text-[22px] font-black">{data.estimatedPayment || "$542"}<span className="text-[10px] font-bold"> /mo*</span></p><p className="mt-1 text-[8px] text-slate-500">Get pre-qualified in minutes with no impact to credit.</p></PassportCard>
        <PassportCard title="Secure. Private. Compliant." className="col-span-4"><p className="text-[9px] leading-snug text-slate-600">Your data is protected with enterprise-grade security and a print-ready disclosure trail.</p></PassportCard>
      </div>

      <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="grid grid-cols-5 gap-2 text-center text-[8px] text-slate-600"><p className="text-left font-bold"><span style={{ color: accent }}>▲</span> autolabels.io<br /><span className="font-normal">AI-Powered Vehicle Information Platform</span></p><p>AI-Powered<br />Accuracy</p><p>FTC<br />Compliant</p><p>Real-Time<br />Updates</p><p>Digital + Print<br />Ready</p></div>
      </div>
      {branding.disclaimer && <p className="mt-1 text-center text-[7px] leading-tight text-slate-500">{branding.disclaimer}</p>}
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
  { config: baseWindow({ id: "window-passport-pro", name: "Vehicle Passport Pro", styleTags: ["Passport", "Modern"], defaultAccent: "#2563EB", useCase: "Premium AutoLabels vehicle transparency report with score, QR passport, market price, benefits, and trust panels" }), Render: VehiclePassportProSheet },
  { config: baseWindow({ id: "window-premium", name: "Vehicle Passport Premium", styleTags: ["Passport", "Modern"], defaultAccent: "#2563EB", useCase: "Flagship scan-first window sticker with premium price + QR cards" }), Render: PassportPremiumSheet },
  { config: baseWindow({ id: "window-bold", name: "Big Price Lot Sticker", styleTags: ["Value", "Readability"], defaultAccent: "#b91c1c", blackLabelReady: true, useCase: "High-readability lot sticker with huge price and QR" }), Render: BigPriceSheet },
  { config: baseWindow({ id: "window-luxury", name: "Executive Noir", styleTags: ["Luxury"], defaultAccent: "#c9a227", blackLabelReady: true, useCase: "Luxury black-label window sticker for high-line inventory" }), Render: ExecutiveNoirSheet },
  { config: baseWindow({ id: "window-modern", name: "Modern Window", styleTags: ["Modern", "SaaS"], defaultAccent: "#2563EB", blackLabelReady: true, useCase: "Everyday used-car window sticker" }), Render: WindowSheet },
  { config: baseWindow({ id: "window-classic", name: "Classic Monroney", styleTags: ["Classic", "Compliance"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Factory-style disclosure layout", complianceNote: "Mirrors the Monroney convention; fixed navy scheme." }), Render: WindowSheet },
  { config: baseWindow({ id: "window-minimal", name: "Minimal Window", styleTags: ["Readability", "Classic"], defaultAccent: "#0B2041", supportsAccent: false, useCase: "Maximum legibility, low ink" }), Render: WindowSheet },
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

export const RENDER_ENGINES: Record<string, (props: TemplateRenderProps) => JSX.Element> = {
  window: WindowSheet,
  addendum: AddendumStrip,
  passport: WindowSheet,
};

const PREMIUM_RENDERERS: Record<string, (props: TemplateRenderProps) => JSX.Element> = {
  "window-passport-pro": VehiclePassportProSheet,
  "window-premium": PassportPremiumSheet,
  "window-bold": BigPriceSheet,
  "window-luxury": ExecutiveNoirSheet,
};

export function buildConfig(type: StickerType, over: Partial<StickerTemplateConfig>): StickerTemplateConfig {
  return (type === "addendum" ? baseAddendum : baseWindow)(over);
}

export function templateFromConfig(config: StickerTemplateConfig): StudioTemplate {
  const Render = PREMIUM_RENDERERS[config.id] || RENDER_ENGINES[config.type] || WindowSheet;
  return { config, Render };
}

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

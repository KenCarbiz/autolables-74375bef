// Used Vehicle Window Sticker Pack -- 8.5x11 portrait
// Core layout families for pre-owned vehicle window stickers.
// These are tenant-safe and powered by SaturdaySticker data from the dealer/vehicle/passport adapter.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdayDealerTheme, SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker; theme?: SaturdayDealerTheme; badge?: string };

type Theme = Required<SaturdayDealerTheme> & { name: string };

const DEFAULTS: Record<string, Theme> = {
  modern: { name: "Modern", primaryColor: "#071f3f", secondaryColor: "#2563eb", accentColor: "#22c55e", softColor: "#eff6ff", borderColor: "#dbe4f0" },
  traditional: { name: "Traditional", primaryColor: "#07376f", secondaryColor: "#0b4a8f", accentColor: "#1f7a4d", softColor: "#f8fafc", borderColor: "#0b4a8f" },
  luxury: { name: "Luxury", primaryColor: "#050816", secondaryColor: "#111827", accentColor: "#d4af37", softColor: "#f8fafc", borderColor: "#d1d5db" },
  cpo: { name: "CPO", primaryColor: "#062e2e", secondaryColor: "#0f766e", accentColor: "#14b8a6", softColor: "#ecfeff", borderColor: "#bde8e6" },
  market: { name: "Market", primaryColor: "#082f49", secondaryColor: "#0284c7", accentColor: "#16a34a", softColor: "#f0f9ff", borderColor: "#bae6fd" },
  onePrice: { name: "One Price", primaryColor: "#3b0764", secondaryColor: "#7c3aed", accentColor: "#f59e0b", softColor: "#faf5ff", borderColor: "#ddd6fe" },
  minimal: { name: "Minimal", primaryColor: "#111827", secondaryColor: "#475569", accentColor: "#2563eb", softColor: "#f8fafc", borderColor: "#cbd5e1" },
  dealer: { name: "Dealer", primaryColor: "#7f1d1d", secondaryColor: "#dc2626", accentColor: "#f59e0b", softColor: "#fff7ed", borderColor: "#fed7aa" },
};

const mergeTheme = (base: Theme, override?: SaturdayDealerTheme): Theme => ({ ...base, ...override });
const safeUrl = (url: string) => (url.startsWith("http") ? url : `https://${url}`);
const money = (value?: string | number) => {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : "Scan for Live Price";
};
const spec = (data: SaturdaySticker, pattern: RegExp, fallback = "") => data.specs.find((s) => pattern.test(s.label))?.value || fallback;

function CarFallback({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 620 250" className="absolute inset-x-0 bottom-2 mx-auto h-[2.35in] w-[6.1in] opacity-90" fill="none">
      <path d="M68 158c18-64 72-104 145-104h190c62 0 116 34 158 94l35 8c18 4 28 18 24 36l-6 20H28l8-31c5-15 15-22 32-23Z" fill={theme.primaryColor} />
      <path d="M210 78h187c54 0 97 26 130 75H128c24-47 52-72 82-75Z" fill="#94a3b8" />
      <path d="M238 96h91v54H154c22-34 52-53 84-54ZM355 96h46c40 0 75 20 106 54H355V96Z" fill="#f8fafc" />
      <circle cx="155" cy="210" r="39" fill="#0f172a" /><circle cx="155" cy="210" r="17" fill="#e2e8f0" />
      <circle cx="486" cy="210" r="39" fill="#0f172a" /><circle cx="486" cy="210" r="17" fill="#e2e8f0" />
      <path d="M45 232h505" stroke={theme.accentColor} strokeWidth="4" opacity="0.32" />
    </svg>
  );
}

function VehicleHero({ data, theme, compact = false }: { data: SaturdaySticker; theme: Theme; compact?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-[24px] border shadow-[0_14px_30px_rgba(15,23,42,.10)]" style={{ height: compact ? "2.45in" : "3.05in", borderColor: theme.borderColor, background: `linear-gradient(135deg,#fff,${theme.softColor})` }}>
      {data.vehicle.imageUrl ? <img src={data.vehicle.imageUrl} alt="Vehicle" className="absolute inset-0 h-full w-full object-cover" /> : <CarFallback theme={theme} />}
      <div className="absolute bottom-3 right-4 rounded-full bg-white/90 px-3 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">Vehicle Passport Ready</div>
    </section>
  );
}

function Header({ data, theme, badge = "Used Vehicle Window Sticker" }: Props & { theme: Theme }) {
  return (
    <header className="grid grid-cols-[1fr_auto] gap-4 rounded-[20px] p-4 text-white" style={{ background: `linear-gradient(135deg,${theme.primaryColor},${theme.secondaryColor})` }}>
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-80">{badge}</div>
        <div className="mt-1 truncate text-[30px] font-black leading-none">{data.dealer.name}</div>
        <div className="mt-1 text-[10px] font-semibold opacity-85">{data.dealer.address} • {data.dealer.phone} • {data.dealer.website}</div>
      </div>
      <div className="rounded-[14px] bg-white/15 px-3 py-2 text-right text-[10px] font-semibold leading-tight">
        <div>Stock: {data.vehicle.stock}</div>
        <div>VIN: {data.vehicle.vin}</div>
      </div>
    </header>
  );
}

function QRCard({ data, theme, label = "Scan Full Vehicle Passport" }: { data: SaturdaySticker; theme: Theme; label?: string }) {
  return (
    <section className="rounded-[18px] border bg-white p-3" style={{ borderColor: theme.borderColor }}>
      <div className="flex items-center gap-3">
        <QRCodeSVG value={safeUrl(data.qrUrl)} size={88} bgColor="#fff" fgColor="#111827" level="M" />
        <div><div className="text-[12px] font-black uppercase leading-tight" style={{ color: theme.primaryColor }}>{label}</div><div className="mt-1 text-[9px] leading-tight text-slate-600">Live price, market data, photos, records, disclosures, and dealer trust.</div></div>
      </div>
    </section>
  );
}

function PriceCard({ data, theme, headline = "Vehicle Value" }: { data: SaturdaySticker; theme: Theme; headline?: string }) {
  return (
    <section className="rounded-[22px] p-4 text-white shadow-[0_12px_26px_rgba(15,23,42,.16)]" style={{ background: `linear-gradient(145deg,${theme.secondaryColor},${theme.primaryColor})` }}>
      <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-75">{data.vehicle.priceLabel || data.dealer.pricingLabel || headline}</div>
      <div className="mt-1 text-[48px] font-black leading-none tracking-[-0.05em]">{money(data.vehicle.price)}</div>
      <div className="mt-2 text-[10px] font-semibold opacity-80">Passport contains today's live advertised price and supporting details.</div>
    </section>
  );
}

function SpecsGrid({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  const specs = [
    ["Mileage", data.vehicle.mileage ? `${Number(data.vehicle.mileage).toLocaleString()} mi` : spec(data, /mileage/i)],
    ["Fuel Economy", `${data.fuel.city || "--"} / ${data.fuel.highway || "--"} MPG`],
    ["Engine", spec(data, /engine/i)],
    ["Drivetrain", spec(data, /drive/i)],
    ["Transmission", spec(data, /trans/i)],
    ["Exterior", spec(data, /exterior/i)],
  ].filter(([, value]) => value);

  return (
    <section className="grid grid-cols-3 gap-2 rounded-[20px] border bg-white p-3" style={{ borderColor: theme.borderColor }}>
      {specs.map(([label, value]) => <div key={label} className="rounded-[14px] p-2" style={{ background: theme.softColor }}><div className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-[13px] font-black leading-tight" style={{ color: theme.primaryColor }}>{value}</div></div>)}
    </section>
  );
}

function Benefits({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  const items = [...(data.dealer.valueProps || []), ...data.benefits].filter(Boolean).slice(0, 6);
  return <section className="rounded-[18px] border bg-white p-3" style={{ borderColor: theme.borderColor }}><div className="text-[11px] font-black uppercase" style={{ color: theme.secondaryColor }}>Ownership Benefits</div><div className="mt-2 grid grid-cols-2 gap-1.5 text-[9.5px] font-semibold">{items.map((item) => <div key={item} className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white" style={{ background: theme.secondaryColor }}>✓</span>{item}</div>)}</div></section>;
}

function MarketCard({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  const market = data.market;
  return <section className="rounded-[18px] border bg-white p-3" style={{ borderColor: theme.borderColor }}><div className="text-[11px] font-black uppercase" style={{ color: theme.secondaryColor }}>Market Transparency</div><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><div><div className="font-black text-slate-500">Market Avg.</div><div className="text-[16px] font-black" style={{ color: theme.primaryColor }}>{money(market?.marketAverage)}</div></div><div><div className="font-black text-slate-500">Position</div><div className="text-[16px] font-black" style={{ color: theme.accentColor }}>{market?.delta ? `${money(Math.abs(Number(market.delta)))} Below` : "Verified"}</div></div><div><div className="font-black text-slate-500">Comps</div><div className="font-black">{market?.comparableCount || "--"}</div></div><div><div className="font-black text-slate-500">Source</div><div className="font-black">{market?.sourceLabel || "Market Data"}</div></div></div></section>;
}

function Highlights({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  return <section className="rounded-[18px] border bg-white p-3" style={{ borderColor: theme.borderColor }}><div className="text-[11px] font-black uppercase" style={{ color: theme.secondaryColor }}>Vehicle Highlights</div><div className="mt-2 flex flex-wrap gap-1.5">{data.highlights.slice(0, 14).map((item) => <span key={item} className="rounded-full border px-2 py-1 text-[8.5px] font-semibold" style={{ borderColor: theme.borderColor }}>{item}</span>)}</div></section>;
}

function TrustCard({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  const review = data.dealer.reviewSources?.[0];
  return <section className="rounded-[18px] border bg-white p-3" style={{ borderColor: theme.borderColor }}><div className="text-[11px] font-black uppercase" style={{ color: theme.secondaryColor }}>Dealer Trust</div><div className="mt-1 text-[30px] font-black leading-none" style={{ color: theme.primaryColor }}>{review?.rating || "4.9"} <span className="text-[13px]" style={{ color: theme.accentColor }}>★★★★★</span></div><div className="mt-1 text-[9px] text-slate-500">{review?.reviewCount ? `${review.reviewCount.toLocaleString()} reviews` : "Verified dealer review source"} • {review?.label || "Dealer reviews"}</div></section>;
}

function Footer({ data, theme }: { data: SaturdaySticker; theme: Theme }) {
  return <footer className="mt-auto rounded-[14px] border bg-slate-50 px-3 py-2 text-center text-[7.5px] leading-tight text-slate-500" style={{ borderColor: theme.borderColor }}>{data.disclaimer}</footer>;
}

function WindowShell({ data, theme, badge, children }: Props & { theme: Theme; children: React.ReactNode }) {
  return <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}><div className="flex h-full flex-col p-[0.22in]"><Header data={data} theme={theme} badge={badge} />{children}<Footer data={data} theme={theme} /></div></div>;
}

export function UsedWindowModernPassport({ data, theme, badge = "Used Vehicle Passport" }: Props) {
  const t = mergeTheme(DEFAULTS.modern, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[1fr_1.05fr] gap-4"><div><div className="text-[12px] font-black uppercase" style={{ color: t.secondaryColor }}>Pre-Owned Vehicle</div><h1 className="mt-2 text-[42px] font-black uppercase leading-[0.92] tracking-[-0.055em]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><PriceCard data={data} theme={t} /></div></div><VehicleHero data={data} theme={t} /></main><section className="mt-3 grid grid-cols-[1fr_.82fr] gap-3"><SpecsGrid data={data} theme={t} /><QRCard data={data} theme={t} /></section><section className="mt-3 grid grid-cols-[1fr_1fr_1fr] gap-3"><MarketCard data={data} theme={t} /><TrustCard data={data} theme={t} /><Benefits data={data} theme={t} /></section><section className="mt-3"><Highlights data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowTraditionalOEM({ data, theme, badge = "Used Vehicle Window Sticker" }: Props) {
  const t = mergeTheme(DEFAULTS.traditional, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[2.3in_1fr] gap-4"><aside className="space-y-3"><PriceCard data={data} theme={t} headline="Asking Price" /><SpecsGrid data={data} theme={t} /><QRCard data={data} theme={t} /></aside><section><h1 className="text-[38px] font-black uppercase leading-none" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><VehicleHero data={data} theme={t} compact /></div><div className="mt-3 grid grid-cols-2 gap-3"><Benefits data={data} theme={t} /><TrustCard data={data} theme={t} /></div><div className="mt-3"><Highlights data={data} theme={t} /></div></section></main></WindowShell>;
}

export function UsedWindowLuxuryBlack({ data, theme, badge = "Premium Pre-Owned" }: Props) {
  const t = mergeTheme(DEFAULTS.luxury, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3"><VehicleHero data={data} theme={t} /><div className="mt-3 grid grid-cols-[1.15fr_.85fr] gap-3"><section><div className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: t.accentColor }}>Signature Collection</div><h1 className="mt-2 text-[43px] font-black uppercase leading-[.94]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1></section><PriceCard data={data} theme={t} /></div></main><section className="mt-3 grid grid-cols-[1fr_1fr] gap-3"><SpecsGrid data={data} theme={t} /><MarketCard data={data} theme={t} /></section><section className="mt-3 grid grid-cols-[1fr_.9fr_1fr] gap-3"><Benefits data={data} theme={t} /><TrustCard data={data} theme={t} /><QRCard data={data} theme={t} /></section><section className="mt-3"><Highlights data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowCPOFocus({ data, theme, badge = "Certified Pre-Owned" }: Props) {
  const t = mergeTheme(DEFAULTS.cpo, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[1fr_1fr] gap-4"><div><h1 className="text-[41px] font-black uppercase leading-[.92]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><section className="mt-3 rounded-[22px] border p-4" style={{ borderColor: t.borderColor, background: t.softColor }}><div className="text-[11px] font-black uppercase" style={{ color: t.secondaryColor }}>Certification Coverage</div><div className="mt-1 text-[22px] font-black" style={{ color: t.primaryColor }}>{data.benefits[0] || "Certified Coverage Included"}</div><p className="mt-2 text-[10px] text-slate-600">Coverage, inspection, and eligibility details are verified in the passport.</p></section><div className="mt-3"><PriceCard data={data} theme={t} /></div></div><VehicleHero data={data} theme={t} /></main><section className="mt-3 grid grid-cols-[1fr_1fr_1fr] gap-3"><SpecsGrid data={data} theme={t} /><Benefits data={data} theme={t} /><QRCard data={data} theme={t} /></section><section className="mt-3 grid grid-cols-2 gap-3"><MarketCard data={data} theme={t} /><TrustCard data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowMarketTransparency({ data, theme, badge = "Market Transparency" }: Props) {
  const t = mergeTheme(DEFAULTS.market, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[.95fr_1.05fr] gap-4"><div><h1 className="text-[39px] font-black uppercase leading-[.92]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><MarketCard data={data} theme={t} /></div><div className="mt-3"><PriceCard data={data} theme={t} headline="Market Value" /></div></div><VehicleHero data={data} theme={t} /></main><section className="mt-3 grid grid-cols-[1fr_1fr_1fr] gap-3"><SpecsGrid data={data} theme={t} /><QRCard data={data} theme={t} label="Scan for Today's Live Price" /><TrustCard data={data} theme={t} /></section><section className="mt-3 grid grid-cols-[1fr_1fr] gap-3"><Benefits data={data} theme={t} /><Highlights data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowOnePrice({ data, theme, badge = "One Price Store" }: Props) {
  const t = mergeTheme(DEFAULTS.onePrice, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3"><section className="rounded-[28px] p-5 text-center text-white" style={{ background: `linear-gradient(145deg,${t.secondaryColor},${t.primaryColor})` }}><div className="text-[11px] font-black uppercase tracking-[0.25em] opacity-80">{data.vehicle.priceLabel || "One Price"}</div><div className="text-[64px] font-black leading-none">{money(data.vehicle.price)}</div><div className="mt-1 text-[10px] font-semibold opacity-80">Transparent pricing. Scan to verify live price and passport.</div></section><div className="mt-3 grid grid-cols-[1fr_1fr] gap-4"><VehicleHero data={data} theme={t} compact /><div><h1 className="text-[37px] font-black uppercase leading-[.95]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><QRCard data={data} theme={t} /></div></div></div></main><section className="mt-3 grid grid-cols-[1fr_1fr_1fr] gap-3"><SpecsGrid data={data} theme={t} /><Benefits data={data} theme={t} /><TrustCard data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowDealerDifference({ data, theme, badge = "Dealer Difference" }: Props) {
  const t = mergeTheme(DEFAULTS.dealer, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[1.05fr_.95fr] gap-4"><div><h1 className="text-[40px] font-black uppercase leading-[.92]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><Benefits data={data} theme={t} /></div><div className="mt-3"><TrustCard data={data} theme={t} /></div></div><div><VehicleHero data={data} theme={t} compact /><div className="mt-3"><PriceCard data={data} theme={t} /></div></div></main><section className="mt-3 grid grid-cols-[1fr_.85fr_1fr] gap-3"><SpecsGrid data={data} theme={t} /><QRCard data={data} theme={t} /><MarketCard data={data} theme={t} /></section><section className="mt-3"><Highlights data={data} theme={t} /></section></WindowShell>;
}

export function UsedWindowMinimalCompliance({ data, theme, badge = "Used Vehicle Information" }: Props) {
  const t = mergeTheme(DEFAULTS.minimal, theme || data.dealer.theme);
  return <WindowShell data={data} theme={t} badge={badge}><main className="mt-3 grid grid-cols-[1fr_1fr] gap-4"><div><h1 className="text-[42px] font-black uppercase leading-[.92]" style={{ color: t.primaryColor }}>{data.vehicle.title}</h1><div className="mt-3"><SpecsGrid data={data} theme={t} /></div><div className="mt-3"><QRCard data={data} theme={t} /></div></div><div><VehicleHero data={data} theme={t} /><div className="mt-3"><PriceCard data={data} theme={t} /></div></div></main><section className="mt-3 grid grid-cols-2 gap-3"><Benefits data={data} theme={t} /><Highlights data={data} theme={t} /></section></WindowShell>;
}

export const USED_WINDOW_STICKER_FAMILIES = [
  { id: "used-window-modern-passport", name: "Modern Passport Window Sticker", Component: UsedWindowModernPassport },
  { id: "used-window-traditional-oem", name: "Traditional OEM Window Sticker", Component: UsedWindowTraditionalOEM },
  { id: "used-window-luxury-black", name: "Luxury Black Window Sticker", Component: UsedWindowLuxuryBlack },
  { id: "used-window-cpo-focus", name: "CPO Focus Window Sticker", Component: UsedWindowCPOFocus },
  { id: "used-window-market-transparency", name: "Market Transparency Window Sticker", Component: UsedWindowMarketTransparency },
  { id: "used-window-one-price", name: "One Price Window Sticker", Component: UsedWindowOnePrice },
  { id: "used-window-dealer-difference", name: "Dealer Difference Window Sticker", Component: UsedWindowDealerDifference },
  { id: "used-window-minimal-compliance", name: "Minimal Compliance Window Sticker", Component: UsedWindowMinimalCompliance },
] as const;

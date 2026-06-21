// Used Vehicle Addendum Pack -- 4.5x11 supplemental stickers
// Tenant-safe visual variants powered by SaturdaySticker data.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type AddendumData = SaturdaySticker & {
  installed?: { name: string; price: string }[];
  upgrades?: { name: string; price: string }[];
};

type Props = { data: AddendumData };

type Theme = {
  name: string;
  navy: string;
  blue: string;
  accent: string;
  soft: string;
  border: string;
};

const THEMES: Record<string, Theme> = {
  modernBlue: { name: "Modern Blue", navy: "#071f3f", blue: "#2563eb", accent: "#22c55e", soft: "#eff6ff", border: "#dbe4f0" },
  traditional: { name: "Traditional OEM", navy: "#07376f", blue: "#0b4a8f", accent: "#1f7a4d", soft: "#f8fafc", border: "#0b4a8f" },
  luxuryBlack: { name: "Luxury Black", navy: "#050816", blue: "#111827", accent: "#d4af37", soft: "#f8fafc", border: "#d1d5db" },
  cpo: { name: "CPO Focus", navy: "#062e2e", blue: "#0f766e", accent: "#14b8a6", soft: "#ecfeff", border: "#bde8e6" },
  onePrice: { name: "One Price", navy: "#3b0764", blue: "#7c3aed", accent: "#f59e0b", soft: "#faf5ff", border: "#ddd6fe" },
  dealerDifference: { name: "Dealer Difference", navy: "#7f1d1d", blue: "#dc2626", accent: "#f59e0b", soft: "#fff7ed", border: "#fed7aa" },
  minimal: { name: "Minimal Compliance", navy: "#111827", blue: "#475569", accent: "#2563eb", soft: "#f8fafc", border: "#cbd5e1" },
  market: { name: "Market Transparency", navy: "#082f49", blue: "#0284c7", accent: "#16a34a", soft: "#f0f9ff", border: "#bae6fd" },
};

const parseNumber = (value?: string | number) => Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0;
const fmtMoney = (value?: string | number) => {
  const n = parseNumber(value);
  if (!n) return "Call for Price";
  return `$${Math.round(n).toLocaleString()}`;
};

const getPriceLabel = (data: AddendumData) => data.vehicle.priceLabel || data.dealer.pricingLabel || "Advertised Price";
const getInstalledTotal = (data: AddendumData) => (data.installed || []).reduce((sum, item) => sum + parseNumber(item.price), 0);
const getAdjustedTotal = (data: AddendumData) => parseNumber(data.vehicle.price) + getInstalledTotal(data);
const safeUrl = (url: string) => (url.startsWith("http") ? url : `https://${url}`);

function Shell({ data, theme, children, badge }: Props & { theme: Theme; children: React.ReactNode; badge: string }) {
  return (
    <div className="bg-white text-slate-950 shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "4.5in", height: "11in", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.16in]">
        <header className="overflow-hidden rounded-[16px] text-white" style={{ background: `linear-gradient(135deg,${theme.navy},${theme.blue})` }}>
          <div className="grid grid-cols-[1fr_auto] gap-3 p-3.5">
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-[0.24em] opacity-80">{badge}</div>
              <div className="mt-1 max-w-full truncate text-[20px] font-black leading-none tracking-[-0.02em]">{data.dealer.name}</div>
              {data.dealer.slogan ? <div className="mt-1 truncate text-[8px] font-semibold uppercase tracking-[0.12em] opacity-80">{data.dealer.slogan}</div> : null}
            </div>
            <div className="rounded-[10px] bg-white/14 px-2.5 py-2 text-right text-[8px] font-semibold leading-tight opacity-95">
              <div className="max-w-[1.55in] break-words">{data.dealer.address}</div>
              <div className="mt-1 whitespace-nowrap">{data.dealer.phone}</div>
              <div className="whitespace-nowrap">{data.dealer.website}</div>
            </div>
          </div>
          <div className="h-1.5 bg-white/20" />
        </header>
        {children}
        <footer className="mt-auto rounded-[10px] border px-3 py-2 text-[7.5px] leading-snug text-slate-500" style={{ borderColor: theme.border }}>{data.disclaimer}</footer>
      </div>
    </div>
  );
}

function VehicleBlock({ data, theme }: Props & { theme: Theme }) {
  return (
    <section className="mt-3 rounded-[14px] border bg-white p-3" style={{ borderColor: theme.border }}>
      <div className="text-[8.5px] font-black uppercase tracking-[0.18em] text-slate-500">Vehicle</div>
      <h1 className="mt-1 text-[18px] font-black uppercase leading-tight tracking-[-0.03em]" style={{ color: theme.navy }}>{data.vehicle.title}</h1>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[8.5px]">
        <div><span className="font-black uppercase text-slate-500">VIN</span><br /><span className="font-mono font-semibold">{data.vehicle.vin}</span></div>
        <div><span className="font-black uppercase text-slate-500">Stock</span><br /><span className="font-mono font-semibold">{data.vehicle.stock}</span></div>
      </div>
    </section>
  );
}

function PriceLine({ label, value, theme, strong = false }: { label: string; value: string | number; theme: Theme; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0 ${strong ? "font-black" : "font-semibold"}`} style={{ borderColor: theme.border }}>
      <span className="text-[10px] leading-tight text-slate-800">{label}</span>
      <span className="shrink-0 text-[10px]" style={{ color: strong ? theme.navy : "#0f172a" }}>{fmtMoney(value)}</span>
    </div>
  );
}

function OptionsTable({ data, theme, title = "Dealer-Installed Options" }: Props & { theme: Theme; title?: string }) {
  return (
    <section className="mt-3 overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: theme.border }}>
      <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white" style={{ background: theme.navy }}>{title}</div>
      {(data.installed || []).map((item) => <PriceLine key={item.name} label={item.name} value={item.price} theme={theme} />)}
      <PriceLine label="Installed Total" value={getInstalledTotal(data)} theme={theme} strong />
    </section>
  );
}

function Benefits({ data, theme, compact = false }: Props & { theme: Theme; compact?: boolean }) {
  const items = [...(data.dealer.valueProps || []), ...data.benefits].filter(Boolean).slice(0, compact ? 4 : 6);
  return (
    <section className="mt-3 rounded-[14px] border p-3" style={{ borderColor: theme.border, background: `linear-gradient(180deg,${theme.soft},#ffffff)` }}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: theme.blue }}>Ownership Benefits</div>
      <div className="mt-2 grid grid-cols-1 gap-1.5">
        {items.map((b) => <div key={b} className="flex items-center gap-2 text-[10px] font-semibold text-slate-800"><span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white" style={{ background: theme.blue }}>✓</span>{b}</div>)}
      </div>
    </section>
  );
}

function QRPanel({ data, theme }: Props & { theme: Theme }) {
  return (
    <section className="mt-3 grid grid-cols-[0.95in_1fr] items-center gap-3 rounded-[14px] border bg-white p-3" style={{ borderColor: theme.border }}>
      <div className="rounded-lg bg-white p-1"><QRCodeSVG value={safeUrl(data.qrUrl)} size={82} bgColor="#fff" fgColor="#111827" level="M" /></div>
      <div><div className="text-[10px] font-black uppercase leading-tight" style={{ color: theme.navy }}>Scan Full Vehicle Passport</div><div className="mt-1 text-[8.5px] leading-tight text-slate-600">Photos, disclosures, pricing support, market data, and digital signing.</div></div>
    </section>
  );
}

function TotalBlock({ data, theme, title = "Adjusted Total" }: Props & { theme: Theme; title?: string }) {
  return (
    <section className="mt-3 rounded-[16px] p-4 text-white" style={{ background: `linear-gradient(145deg,${theme.blue},${theme.navy})` }}>
      <div className="flex justify-between text-[10px] font-semibold opacity-80"><span>{getPriceLabel(data)}</span><span>{fmtMoney(data.vehicle.price)}</span></div>
      <div className="flex justify-between text-[10px] font-semibold opacity-80"><span>+ Installed Equipment</span><span>{fmtMoney(getInstalledTotal(data))}</span></div>
      <div className="mt-2 border-t border-white/30 pt-2"><div className="text-[9px] font-black uppercase tracking-[0.28em] opacity-80">{title}</div><div className="mt-1 text-[39px] font-black leading-none tracking-tight">{fmtMoney(getAdjustedTotal(data))}</div></div>
    </section>
  );
}

function MarketMini({ data, theme }: Props & { theme: Theme }) {
  const market = data.market;
  return (
    <section className="mt-3 rounded-[14px] border bg-white p-3" style={{ borderColor: theme.border }}>
      <div className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: theme.blue }}>Market Transparency</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[9px]">
        <div><div className="font-black text-slate-500">Market Avg.</div><div className="text-[14px] font-black" style={{ color: theme.navy }}>{fmtMoney(market?.marketAverage)}</div></div>
        <div><div className="font-black text-slate-500">Position</div><div className="text-[14px] font-black" style={{ color: theme.accent }}>{market?.delta ? `${fmtMoney(Math.abs(Number(String(market.delta).replace(/[^\d.-]/g, ""))))} Below` : "Verified"}</div></div>
        <div><div className="font-black text-slate-500">Comps</div><div className="font-black">{market?.comparableCount || "--"}</div></div>
        <div><div className="font-black text-slate-500">Source</div><div className="font-black">{market?.sourceLabel || "Market Data"}</div></div>
      </div>
    </section>
  );
}

export function UsedAddendumModernBlue({ data }: Props) {
  const theme = THEMES.modernBlue;
  return <Shell data={data} theme={theme} badge="Used Vehicle Addendum"><VehicleBlock data={data} theme={theme} /><OptionsTable data={data} theme={theme} /><Benefits data={data} theme={theme} /><TotalBlock data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumTraditionalOEM({ data }: Props) {
  const theme = THEMES.traditional;
  return <Shell data={data} theme={theme} badge="OEM-Style Addendum"><VehicleBlock data={data} theme={theme} /><OptionsTable data={data} theme={theme} /><section className="mt-3 rounded-[14px] border-2 p-3 text-center" style={{ borderColor: theme.blue }}><div className="text-[10px] font-black uppercase" style={{ color: theme.navy }}>{getPriceLabel(data)}</div><div className="text-[44px] font-black leading-none">{fmtMoney(data.vehicle.price)}</div></section><TotalBlock data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumLuxuryBlack({ data }: Props) {
  const theme = THEMES.luxuryBlack;
  return <Shell data={data} theme={theme} badge="Premium Vehicle Addendum"><VehicleBlock data={data} theme={theme} /><TotalBlock data={data} theme={theme} title="Premium Total" /><OptionsTable data={data} theme={theme} title="Protection & Equipment" /><Benefits data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumCPOFocus({ data }: Props) {
  const theme = THEMES.cpo;
  return <Shell data={data} theme={theme} badge="Certified Vehicle Addendum"><VehicleBlock data={data} theme={theme} /><section className="mt-3 rounded-[14px] border p-3" style={{ borderColor: theme.border, background: theme.soft }}><div className="text-[10px] font-black uppercase" style={{ color: theme.blue }}>Certification Coverage</div><div className="mt-1 text-[18px] font-black" style={{ color: theme.navy }}>{data.benefits[0] || "Dealer Certified Coverage"}</div><div className="mt-1 text-[9px] text-slate-600">Coverage details and eligibility are confirmed in the digital passport.</div></section><OptionsTable data={data} theme={theme} /><TotalBlock data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumOnePrice({ data }: Props) {
  const theme = THEMES.onePrice;
  return <Shell data={data} theme={theme} badge="One Price Store"><VehicleBlock data={data} theme={theme} /><section className="mt-3 rounded-[18px] p-4 text-center text-white" style={{ background: `linear-gradient(145deg,${theme.blue},${theme.navy})` }}><div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">{getPriceLabel(data)}</div><div className="text-[50px] font-black leading-none">{fmtMoney(data.vehicle.price)}</div><div className="mt-1 text-[9px] font-semibold opacity-80">Transparent pricing. No guessing.</div></section><OptionsTable data={data} theme={theme} /><Benefits data={data} theme={theme} compact /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumDealerDifference({ data }: Props) {
  const theme = THEMES.dealerDifference;
  return <Shell data={data} theme={theme} badge="Dealer Difference"><VehicleBlock data={data} theme={theme} /><Benefits data={data} theme={theme} /><OptionsTable data={data} theme={theme} title="Included Dealer Value" /><TotalBlock data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumMinimalCompliance({ data }: Props) {
  const theme = THEMES.minimal;
  return <Shell data={data} theme={theme} badge="Vehicle Addendum"><VehicleBlock data={data} theme={theme} /><OptionsTable data={data} theme={theme} /><TotalBlock data={data} theme={theme} /><QRPanel data={data} theme={theme} /></Shell>;
}

export function UsedAddendumMarketTransparency({ data }: Props) {
  const theme = THEMES.market;
  return <Shell data={data} theme={theme} badge="Market Transparency"><VehicleBlock data={data} theme={theme} /><MarketMini data={data} theme={theme} /><OptionsTable data={data} theme={theme} /><TotalBlock data={data} theme={theme} title="Verified Price" /><QRPanel data={data} theme={theme} /></Shell>;
}

export const USED_ADDENDUM_TEMPLATES = [
  { id: "used-addendum-modern-blue", name: "Used Addendum Modern Blue", Component: UsedAddendumModernBlue },
  { id: "used-addendum-traditional-oem", name: "Used Addendum Traditional OEM", Component: UsedAddendumTraditionalOEM },
  { id: "used-addendum-luxury-black", name: "Used Addendum Luxury Black", Component: UsedAddendumLuxuryBlack },
  { id: "used-addendum-cpo-focus", name: "Used Addendum CPO Focus", Component: UsedAddendumCPOFocus },
  { id: "used-addendum-one-price", name: "Used Addendum One Price", Component: UsedAddendumOnePrice },
  { id: "used-addendum-dealer-difference", name: "Used Addendum Dealer Difference", Component: UsedAddendumDealerDifference },
  { id: "used-addendum-minimal-compliance", name: "Used Addendum Minimal Compliance", Component: UsedAddendumMinimalCompliance },
  { id: "used-addendum-market-transparency", name: "Used Addendum Market Transparency", Component: UsedAddendumMarketTransparency },
] as const;

// Saturday Premium Addendum — 4.5x11 supplemental sticker
// Premium companion strip for the Saturday window templates.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Addendum = SaturdaySticker & {
  installed?: { name: string; price: string }[];
  upgrades?: { name: string; price: string }[];
};

type Props = { data: Addendum };

const navy = "#071f3f";
const blue = "#2563eb";
const line = "#dbe4f0";

const fmtMoney = (n: string | number) => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-[14px] border bg-white ${className}`} style={{ borderColor: line }}>
      <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white" style={{ background: navy }}>{title}</div>
      {children}
    </section>
  );
}

function PriceLine({ name, price, strong = false }: { name: string; price: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0 ${strong ? "font-black" : "font-semibold"}`} style={{ borderColor: line }}>
      <span className="text-[10px] leading-tight text-slate-800">{name}</span>
      <span className="shrink-0 text-[10px]" style={{ color: strong ? navy : "#0f172a" }}>{fmtMoney(price)}</span>
    </div>
  );
}

export const SaturdayPremiumAddendum: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, installed = [], upgrades = [], benefits, qrUrl, disclaimer } = data;
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  const installedTotal = installed.reduce((s, l) => s + Number(String(l.price).replace(/[^\d.]/g, "") || 0), 0);
  const adjustedPrice = Number(String(vehicle.price).replace(/[^\d.]/g, "") || 0) + installedTotal;

  return (
    <div className="bg-white text-slate-950 shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "4.5in", height: "11in", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.16in]">
        <header className="overflow-hidden rounded-[16px] text-white" style={{ background: `linear-gradient(135deg,${navy},${blue})` }}>
          <div className="p-4">
            <div className="text-[9px] font-black uppercase tracking-[0.32em] text-blue-100">Supplemental Addendum</div>
            <div className="mt-1 text-[22px] font-black leading-none">{dealer.name}</div>
            <div className="mt-1 text-[9px] text-blue-100">{dealer.address}</div>
            <div className="mt-0.5 text-[9px] font-semibold text-blue-50">{dealer.phone} · {dealer.website}</div>
          </div>
          <div className="h-1.5 bg-white/20" />
        </header>

        <section className="mt-3 rounded-[14px] border bg-white p-3" style={{ borderColor: line }}>
          <div className="text-[8.5px] font-black uppercase tracking-[0.18em] text-slate-500">Vehicle</div>
          <h1 className="mt-1 text-[18px] font-black uppercase leading-tight tracking-[-0.03em]" style={{ color: navy }}>{vehicle.title}</h1>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[8.5px]">
            <div><span className="font-black uppercase text-slate-500">VIN</span><br /><span className="font-mono font-semibold">{vehicle.vin}</span></div>
            <div><span className="font-black uppercase text-slate-500">Stock</span><br /><span className="font-mono font-semibold">{vehicle.stock}</span></div>
          </div>
        </section>

        <Section title="Dealer-Installed Options" className="mt-3">
          <div>
            {installed.map((l) => <PriceLine key={l.name} name={l.name} price={l.price} />)}
            <PriceLine name="Installed Total" price={String(installedTotal)} strong />
          </div>
        </Section>

        {upgrades.length > 0 && (
          <Section title="Available Upgrades" className="mt-3">
            <div>
              {upgrades.map((l) => <PriceLine key={l.name} name={l.name} price={l.price} />)}
              <div className="px-3 py-1.5 text-[8px] font-semibold uppercase tracking-wide text-slate-500">Optional items shown for customer consideration.</div>
            </div>
          </Section>
        )}

        <section className="mt-3 rounded-[14px] border p-3" style={{ borderColor: "#bfdbfe", background: "linear-gradient(180deg,#eff6ff,#ffffff)" }}>
          <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: blue }}>Ownership Benefits</div>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {benefits.slice(0, 6).map((b) => (
              <div key={b} className="flex items-center gap-2 text-[10px] font-semibold text-slate-800">
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white" style={{ background: blue }}>✓</span>
                {b}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-3 rounded-[16px] p-4 text-white" style={{ background: `linear-gradient(145deg,${blue},#1d4ed8)` }}>
          <div className="flex justify-between text-[10px] font-semibold text-blue-100"><span>Asking Price</span><span>{fmtMoney(vehicle.price)}</span></div>
          <div className="flex justify-between text-[10px] font-semibold text-blue-100"><span>+ Installed Equipment</span><span>{fmtMoney(installedTotal)}</span></div>
          <div className="mt-2 border-t border-white/30 pt-2">
            <div className="text-[9px] font-black uppercase tracking-[0.28em] text-blue-100">Adjusted Total</div>
            <div className="mt-1 text-[39px] font-black leading-none tracking-tight">{fmtMoney(adjustedPrice)}</div>
          </div>
        </section>

        <section className="mt-3 grid grid-cols-[0.9in_1fr] items-center gap-3 rounded-[14px] border bg-white p-3" style={{ borderColor: line }}>
          <div className="rounded-lg bg-white p-1"><QRCodeSVG value={safeUrl} size={74} bgColor="#fff" fgColor="#111827" level="M" /></div>
          <div>
            <div className="text-[10px] font-black uppercase leading-tight" style={{ color: navy }}>Scan for full Vehicle Passport</div>
            <div className="mt-1 text-[8.5px] leading-tight text-slate-600">View digital disclosures, photos, service records, and pricing details.</div>
            <div className="mt-1 text-[8px] font-mono text-slate-500">{qrUrl}</div>
          </div>
        </section>

        <section className="mt-3 rounded-[14px] border p-3 text-center" style={{ borderColor: line }}>
          <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: navy }}>Customer Acknowledgment</div>
          <div className="mt-6 border-t border-slate-300 pt-1 text-left text-[8px] text-slate-500">Customer Signature</div>
          <div className="mt-5 border-t border-slate-300 pt-1 text-left text-[8px] text-slate-500">Date</div>
        </section>

        <footer className="mt-auto rounded-[10px] border px-3 py-2 text-[7.5px] leading-snug text-slate-500" style={{ borderColor: line }}>{disclaimer}</footer>
      </div>
    </div>
  );
};

export default SaturdayPremiumAddendum;

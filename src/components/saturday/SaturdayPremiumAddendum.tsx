// Saturday Premium Addendum — 4.5x11 supplemental sticker
// Pairs with the hero/classic window stickers. Matches brand palette.

import type { SaturdaySticker } from "./types";

type Addendum = SaturdaySticker & {
  installed?: { name: string; price: string }[];
  upgrades?: { name: string; price: string }[];
};

type Props = { data: Addendum };

const fmtMoney = (n: string | number) => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

export const SaturdayPremiumAddendum: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, installed = [], upgrades = [], benefits, qrUrl, disclaimer } = data;
  const installedTotal = installed.reduce((s, l) => s + Number(l.price || 0), 0);
  const adjustedPrice = Number(vehicle.price) + installedTotal;

  return (
    <div
      className="bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 print:shadow-none"
      style={{ width: "4.5in", height: "11in", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div className="flex h-full w-full flex-col p-4">
        {/* Header */}
        <header
          className="rounded-xl px-4 py-3 text-white"
          style={{ background: "linear-gradient(135deg,#0B2041,#2563EB)" }}
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-blue-200">
            Supplemental Addendum
          </div>
          <div className="mt-0.5 text-base font-extrabold leading-tight">{dealer.name}</div>
          <div className="text-[9px] text-blue-100">{dealer.phone} · {dealer.website}</div>
        </header>

        {/* Vehicle */}
        <div className="mt-3 border-b border-slate-300 pb-2">
          <h1 className="text-[14pt] font-extrabold leading-tight" style={{ color: "#0B2041" }}>
            {vehicle.title}
          </h1>
          <div className="mt-1 flex justify-between text-[9px] text-slate-600">
            <div>VIN <span className="font-mono">{vehicle.vin}</span></div>
            <div>Stock <span className="font-mono">{vehicle.stock}</span></div>
          </div>
        </div>

        {/* Dealer-installed */}
        <section className="mt-3">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>
            Dealer-Installed Options
          </div>
          <div className="mt-1 divide-y divide-dotted divide-slate-300">
            {installed.map((l) => (
              <div key={l.name} className="flex justify-between py-1 text-[10.5px]">
                <span className="text-slate-800">{l.name}</span>
                <span className="font-semibold text-slate-900">{fmtMoney(l.price)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-[11px] font-bold" style={{ color: "#0B2041" }}>
              <span>Installed Total</span>
              <span>{fmtMoney(installedTotal)}</span>
            </div>
          </div>
        </section>

        {/* Available upgrades */}
        {upgrades.length > 0 && (
          <section className="mt-3">
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>
              Available Upgrades
            </div>
            <div className="mt-1 divide-y divide-dotted divide-slate-300">
              {upgrades.map((l) => (
                <div key={l.name} className="flex justify-between py-1 text-[10.5px]">
                  <span className="text-slate-700">{l.name}</span>
                  <span className="text-slate-700">{fmtMoney(l.price)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Benefits */}
        <section className="mt-3 rounded-xl bg-blue-50 p-3">
          <div className="text-[9px] font-bold uppercase tracking-widest text-blue-700">
            Ownership Benefits
          </div>
          <div className="mt-1 grid grid-cols-1 gap-0.5">
            {benefits.map((b) => (
              <div key={b} className="flex items-start gap-1.5 text-[10px] text-slate-800">
                <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                {b}
              </div>
            ))}
          </div>
        </section>

        {/* Adjusted price */}
        <div
          className="mt-auto rounded-xl px-4 py-3 text-white"
          style={{ background: "linear-gradient(120deg,#2563EB,#1d4ed8)" }}
        >
          <div className="flex justify-between text-[10px] text-blue-100">
            <span>Asking</span><span>{fmtMoney(vehicle.price)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-blue-100">
            <span>+ Installed</span><span>{fmtMoney(installedTotal)}</span>
          </div>
          <div className="mt-1 border-t border-blue-300/50 pt-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-blue-100">
              Adjusted Total
            </div>
            <div className="text-[32pt] font-black leading-none tracking-tight">
              {fmtMoney(adjustedPrice)}
            </div>
          </div>
        </div>

        {/* QR */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 p-2">
          <div className="grid grid-cols-7 gap-[2px]">
            {Array.from({ length: 49 }).map((_, i) => (
              <div key={i} className={`h-1.5 w-1.5 ${(i * 13) % 3 ? "bg-slate-900" : "bg-white"}`} />
            ))}
          </div>
          <div className="text-[8.5px] leading-tight text-slate-700">
            <div className="font-semibold text-slate-900">Scan for full vehicle report</div>
            <div className="font-mono">{qrUrl}</div>
          </div>
        </div>

        <footer className="mt-2 text-[7.5px] leading-snug text-slate-500">{disclaimer}</footer>
      </div>
    </div>
  );
};

export default SaturdayPremiumAddendum;

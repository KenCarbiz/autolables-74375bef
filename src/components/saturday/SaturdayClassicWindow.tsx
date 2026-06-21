// Saturday Classic Window Sticker — 8.5x11 portrait
// Tighter, traditional dealership look. White body, navy accents,
// strong vehicle title and a dominant price band.

import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const fmtMoney = (n: string | number) => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

export const SaturdayClassicWindow: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  return (
    <div
      className="bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 print:shadow-none"
      style={{ width: "8.5in", height: "11in", fontFamily: "'Source Serif 4', 'Times New Roman', serif" }}
    >
      <div className="flex h-full w-full flex-col p-5">
        {/* Header — classic banner */}
        <header
          className="border-y-4 px-5 py-3"
          style={{ borderColor: "#0B2041" }}
        >
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.4em] text-slate-500">
                Certified Window Sticker
              </div>
              <div
                className="font-extrabold tracking-tight"
                style={{ fontSize: "22pt", color: "#0B2041", lineHeight: 1.05 }}
              >
                {dealer.name}
              </div>
            </div>
            <div className="text-right text-[10px] text-slate-700">
              <div>{dealer.address}</div>
              <div className="font-semibold">{dealer.phone} · {dealer.website}</div>
            </div>
          </div>
        </header>

        {/* Vehicle title block */}
        <div className="mt-4 border-b border-slate-300 pb-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Vehicle</div>
          <h1
            className="mt-1 font-extrabold leading-tight"
            style={{ fontSize: "24pt", color: "#0B2041", letterSpacing: "-0.01em" }}
          >
            {vehicle.title}
          </h1>
          <div className="mt-1 flex justify-between text-[10px] text-slate-600">
            <div>VIN <span className="font-mono">{vehicle.vin}</span></div>
            <div>Stock <span className="font-mono">{vehicle.stock}</span></div>
            {vehicle.mileage && <div>Odometer <span className="font-mono">{Number(vehicle.mileage).toLocaleString()} mi</span></div>}
          </div>
        </div>

        {/* Photo */}
        <div
          className="mt-3 flex items-center justify-center rounded-md border border-slate-300"
          style={{ height: "2.4in", background: "repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 10px,#e2e8f0 10px,#e2e8f0 20px)" }}
        >
          <div className="rounded bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Vehicle Photo
          </div>
        </div>

        {/* Specs strip */}
        <div className="mt-3 grid grid-cols-5 divide-x divide-slate-300 border-y border-slate-300">
          {specs.map((s) => (
            <div key={s.label} className="px-2 py-2 text-center">
              <div className="text-[8.5px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>
                {s.label}
              </div>
              <div className="mt-0.5 truncate text-[12px] font-bold text-slate-900">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Two-column body */}
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>
              Equipment & Highlights
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
              {highlights.map((h) => (
                <div key={h} className="border-b border-dotted border-slate-300 py-0.5 text-[11px] text-slate-800">
                  {h}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="rounded-md border border-slate-300 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>
                EPA Fuel Economy
              </div>
              <div className="mt-2 flex justify-around">
                <div className="text-center">
                  <div className="text-3xl font-black" style={{ color: "#0B2041" }}>{fuel.city}</div>
                  <div className="text-[9px] uppercase tracking-widest text-slate-500">City</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-black" style={{ color: "#0B2041" }}>{fuel.highway}</div>
                  <div className="text-[9px] uppercase tracking-widest text-slate-500">Hwy</div>
                </div>
              </div>
              <div className="mt-2 text-center text-[10px] text-slate-600">
                {fuel.combined} MPG combined
              </div>
            </div>
            <div className="mt-3 rounded-md border border-slate-300 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0B2041" }}>Scan</div>
              <div className="mx-auto mt-1 grid grid-cols-7 gap-[2px]">
                {Array.from({ length: 49 }).map((_, i) => (
                  <div key={i} className={`h-2 w-2 ${(i * 11) % 3 ? "bg-slate-900" : "bg-white"}`} />
                ))}
              </div>
              <div className="mt-1 text-[8px] text-slate-600">{qrUrl}</div>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-3 border-y border-slate-300 py-2">
          <div className="flex flex-wrap items-center justify-around gap-x-4 gap-y-1">
            {benefits.map((b) => (
              <div key={b} className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#0B2041" }}>
                ✓ {b}
              </div>
            ))}
          </div>
        </div>

        {/* Price band */}
        <div
          className="mt-3 flex items-center justify-between rounded-md px-5 py-3 text-white"
          style={{ background: "#0B2041" }}
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-200">Asking Price</div>
            {vehicle.msrp && (
              <div className="text-[10px] text-blue-100">
                MSRP <span className="line-through">{fmtMoney(vehicle.msrp)}</span>
              </div>
            )}
          </div>
          <div className="font-black leading-none tracking-tight" style={{ fontSize: "48pt" }}>
            {fmtMoney(vehicle.price)}
          </div>
        </div>

        <footer className="mt-auto pt-3 text-[8px] leading-snug text-slate-500">{disclaimer}</footer>
      </div>
    </div>
  );
};

export default SaturdayClassicWindow;

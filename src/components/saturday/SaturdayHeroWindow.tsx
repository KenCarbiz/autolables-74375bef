// Saturday Hero Window Sticker — 8.5x11 portrait
// Self-contained presentational component. No registry, no signing,
// no DB writes. Pure visual layout for /dev/saturday-preview.

import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const Card: React.FC<React.PropsWithChildren<{ title?: string; className?: string }>> = ({
  title,
  className = "",
  children,
}) => (
  <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
    {title && (
      <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
    )}
    <div className="px-4 pb-3 pt-1">{children}</div>
  </div>
);

const fmtMoney = (n: string | number) => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

export const SaturdayHeroWindow: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;

  return (
    <div
      className="bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 print:shadow-none"
      style={{ width: "8.5in", height: "11in", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div className="flex h-full w-full flex-col p-5">
        {/* Dealer header */}
        <header
          className="flex items-center justify-between rounded-2xl px-6 py-4 text-white"
          style={{ background: "linear-gradient(135deg,#0B2041 0%,#143270 60%,#2563EB 100%)" }}
        >
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-blue-200">Window Sticker</div>
            <div className="mt-1 text-2xl font-extrabold leading-tight">{dealer.name}</div>
            <div className="text-xs text-blue-100">{dealer.address}</div>
          </div>
          <div className="text-right text-xs text-blue-100">
            <div className="font-semibold text-white">{dealer.phone}</div>
            <div>{dealer.website}</div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-blue-200">Stock {vehicle.stock}</div>
          </div>
        </header>

        {/* Vehicle title */}
        <div className="mt-4 flex items-baseline justify-between">
          <h1
            className="font-extrabold leading-[1.05] text-slate-900"
            style={{ fontSize: "26pt", letterSpacing: "-0.02em" }}
          >
            {vehicle.title}
          </h1>
          <div className="ml-3 shrink-0 text-right text-[10px] uppercase tracking-widest text-slate-500">
            VIN {vehicle.vin}
          </div>
        </div>

        {/* Photo area */}
        <div
          className="mt-3 flex items-center justify-center overflow-hidden rounded-2xl border border-slate-200"
          style={{
            height: "2.6in",
            background:
              "linear-gradient(135deg,#e2e8f0 0%,#cbd5e1 50%,#94a3b8 100%)",
          }}
        >
          <div className="flex flex-col items-center text-slate-600">
            <svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 17l3-7h12l3 7" />
              <circle cx="7.5" cy="17.5" r="1.8" />
              <circle cx="16.5" cy="17.5" r="1.8" />
              <path d="M3 17h18" />
            </svg>
            <div className="mt-2 text-xs uppercase tracking-widest">Vehicle Photo</div>
          </div>
        </div>

        {/* Specs strip */}
        <div className="mt-3 grid grid-cols-5 gap-2">
          {specs.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center"
            >
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                {s.label}
              </div>
              <div className="mt-1 truncate text-[13px] font-bold text-slate-900">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Highlights + Fuel */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Card title="Highlights" className="col-span-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {highlights.slice(0, 8).map((h) => (
                <div key={h} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                  <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                  <span className="leading-snug">{h}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Fuel Economy">
            <div className="flex items-center justify-around">
              <div className="text-center">
                <div className="text-2xl font-extrabold text-slate-900">{fuel.city}</div>
                <div className="text-[9px] uppercase tracking-widest text-slate-500">City</div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="text-center">
                <div className="text-2xl font-extrabold text-slate-900">{fuel.highway}</div>
                <div className="text-[9px] uppercase tracking-widest text-slate-500">Hwy</div>
              </div>
            </div>
            <div className="mt-2 rounded-lg bg-blue-50 py-1 text-center text-[10px] font-semibold text-blue-700">
              {fuel.combined} MPG combined
            </div>
          </Card>
        </div>

        {/* Benefits strip */}
        <div
          className="mt-3 flex items-center justify-between rounded-2xl px-4 py-2 text-white"
          style={{ background: "linear-gradient(90deg,#0B2041,#1e3a8a)" }}
        >
          {benefits.slice(0, 5).map((b) => (
            <div key={b} className="flex items-center gap-1.5 text-[10.5px] font-semibold">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-300" />
              {b}
            </div>
          ))}
        </div>

        {/* Asking price band + QR */}
        <div className="mt-3 grid flex-1 grid-cols-3 gap-3">
          <div
            className="col-span-2 flex flex-col justify-center rounded-2xl px-6 py-4 text-white"
            style={{ background: "linear-gradient(120deg,#2563EB 0%,#1d4ed8 100%)" }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-100">Asking Price</div>
            <div className="mt-1 text-[56pt] font-black leading-none tracking-tight">
              {fmtMoney(vehicle.price)}
            </div>
            {vehicle.msrp && (
              <div className="mt-1 text-xs text-blue-100">
                MSRP <span className="line-through">{fmtMoney(vehicle.msrp)}</span> · Save{" "}
                <span className="font-bold text-white">
                  {fmtMoney(Number(vehicle.msrp) - Number(vehicle.price))}
                </span>
              </div>
            )}
          </div>
          <Card title="Scan for Full Report" className="flex flex-col items-center justify-center text-center">
            <div className="grid grid-cols-8 gap-[2px] rounded-md bg-white p-2 ring-1 ring-slate-300">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-2 ${
                    [0, 1, 2, 5, 6, 7, 8, 15, 16, 23, 24, 31, 32, 39, 40, 47, 48, 55, 56, 57, 58, 61, 62, 63].includes(
                      i,
                    ) || (i * 7) % 5 === 0
                      ? "bg-slate-900"
                      : "bg-white"
                  }`}
                />
              ))}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-700">{qrUrl}</div>
          </Card>
        </div>

        {/* Disclaimer */}
        <footer className="mt-3 text-[8.5px] leading-snug text-slate-500">{disclaimer}</footer>
      </div>
    </div>
  );
};

export default SaturdayHeroWindow;

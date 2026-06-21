// Saturday Hero Window Sticker — 8.5x11 portrait
// Premium AutoLabels Vehicle Intelligence Report layout for /dev/saturday-preview.
// Presentational only: no registry, no signing, no DB writes.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const ink = "#0B1226";
const blue = "#2563EB";
const navy = "#08224A";
const line = "#E2E8F0";

const fmtMoney = (n: string | number | undefined) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

const chunk = <T,>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const Card: React.FC<React.PropsWithChildren<{ className?: string; title?: string }>> = ({ className = "", title, children }) => (
  <section className={`rounded-[18px] border bg-white ${className}`} style={{ borderColor: line }}>
    {title ? <div className="px-4 pt-3 text-[15px] font-black tracking-tight" style={{ color: ink }}>{title}</div> : null}
    {children}
  </section>
);

const MiniIcon = ({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "purple" }) => {
  const bg = tone === "green" ? "#22C55E" : tone === "purple" ? "#7C3AED" : blue;
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[22px] font-black text-white" style={{ background: bg }}>{children}</div>;
};

const QrPanel = ({ url }: { url: string }) => (
  <div className="flex items-center gap-3 rounded-2xl border bg-white p-3" style={{ borderColor: "#CBD5E1" }}>
    <div className="rounded-lg bg-white p-2">
      <QRCodeSVG value={url.startsWith("http") ? url : `https://${url}`} size={88} bgColor="#ffffff" fgColor="#111827" level="M" />
    </div>
    <div>
      <div className="text-[12px] font-black uppercase leading-tight" style={{ color: ink }}>Scan to view full report</div>
      <div className="mt-1 text-[9px] leading-snug text-slate-500">Photos, disclosures, service notes, pricing analysis & more.</div>
    </div>
  </div>
);

const VehicleImage = () => (
  <div className="relative flex h-[2.05in] items-center justify-center overflow-hidden rounded-[22px] bg-gradient-to-br from-slate-50 via-white to-blue-50">
    <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(circle at 68% 45%, #dbeafe 0%, transparent 34%), linear-gradient(135deg, transparent 0%, transparent 52%, #eff6ff 52%, #eff6ff 60%, transparent 60%)" }} />
    <svg className="relative z-10" width="390" height="155" viewBox="0 0 390 155" fill="none" aria-label="Vehicle illustration">
      <path d="M64 94c13-34 38-51 78-51h98c29 0 56 15 78 45l31 5c13 2 21 13 18 26l-2 11H31l3-14c3-13 14-22 30-22Z" fill="#1F2937" opacity="0.88" />
      <path d="M132 52h101c24 0 44 12 60 36H90c11-22 25-36 42-36Z" fill="#CBD5E1" />
      <path d="M143 60h48v28H101c10-16 23-26 42-28ZM202 60h31c19 0 36 9 51 28h-82V60Z" fill="#F8FAFC" />
      <path d="M72 101h269" stroke="#F8FAFC" strokeWidth="8" strokeLinecap="round" opacity="0.65" />
      <circle cx="103" cy="121" r="25" fill="#0F172A" />
      <circle cx="103" cy="121" r="11" fill="#E2E8F0" />
      <circle cx="291" cy="121" r="25" fill="#0F172A" />
      <circle cx="291" cy="121" r="11" fill="#E2E8F0" />
      <path d="M27 132h338" stroke="#94A3B8" strokeWidth="3" opacity="0.35" />
    </svg>
  </div>
);

export const SaturdayHeroWindow: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "9-Speed Auto";
  const mileage = vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString()} miles` : specs.find((s) => /mileage/i.test(s.label))?.value || "18,426 miles";

  const topFeatures = highlights.slice(0, 10);
  const featureColumns = chunk(topFeatures, 5);

  return (
    <div
      className="bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 print:shadow-none"
      style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="flex h-full flex-col p-[0.24in]">
        {/* Top brand / compliance / QR */}
        <header className="grid grid-cols-[1.35fr_0.8fr_1.05fr] items-start gap-5">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-[34px] font-black text-white" style={{ background: `linear-gradient(135deg,${blue},#60A5FA)` }}>A</div>
            <div>
              <div className="text-[28px] font-black leading-none tracking-tight" style={{ color: ink }}>autolabels<span style={{ color: blue }}>.io</span></div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">AI-powered vehicle information</div>
            </div>
          </div>
          <div className="flex items-start gap-2 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
            <div>
              <div className="text-[12px] font-black uppercase" style={{ color: ink }}>FTC Compliant</div>
              <div className="text-[10px] leading-snug text-slate-500">All disclosures delivered digitally and in print.</div>
            </div>
          </div>
          <QrPanel url={qrUrl} />
        </header>

        {/* Hero */}
        <section className="mt-5 grid grid-cols-[0.92fr_1.08fr] gap-5">
          <div>
            <div className="text-[23px] font-black leading-none" style={{ color: blue }}>2024</div>
            <h1 className="mt-1 text-[39px] font-black uppercase leading-[0.98] tracking-[-0.04em]" style={{ color: ink }}>{vehicle.title.replace(/^2024\s+/i, "")}</h1>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-[10px]">
              <div><div className="font-bold uppercase tracking-wide text-slate-500">Stock Number</div><div className="mt-1 font-black" style={{ color: ink }}>{vehicle.stock}</div></div>
              <div><div className="font-bold uppercase tracking-wide text-slate-500">VIN</div><div className="mt-1 font-black" style={{ color: ink }}>{vehicle.vin}</div></div>
              <div><div className="font-bold uppercase tracking-wide text-slate-500">Exterior Color</div><div className="mt-1 font-black" style={{ color: ink }}>{exterior}</div></div>
              <div><div className="font-bold uppercase tracking-wide text-slate-500">Interior Color</div><div className="mt-1 font-black" style={{ color: ink }}>{interior}</div></div>
            </div>
          </div>
          <VehicleImage />
        </section>

        {/* Snapshot row */}
        <section className="mt-4 grid grid-cols-[0.82fr_repeat(5,1fr)] items-center rounded-[18px] border bg-white px-4 py-3" style={{ borderColor: line }}>
          <div className="text-[15px] font-black leading-tight" style={{ color: ink }}>Overall<br />Vehicle<br />Snapshot</div>
          {[['One Owner', 'Verified', 'blue'], ['Clean History', 'No Accidents', 'green'], ['Dealer Certified', 'Inspected', 'blue'], ['Well Maintained', 'Service Records', 'purple']].map(([a, b, tone]) => (
            <div key={a} className="flex flex-col items-center border-l px-3 text-center" style={{ borderColor: line }}>
              <MiniIcon tone={tone as 'blue' | 'green' | 'purple'}>{a.charAt(0)}</MiniIcon>
              <div className="mt-2 text-[10px] font-black" style={{ color: ink }}>{a}</div>
              <div className="text-[9px] text-slate-500">{b}</div>
            </div>
          ))}
          <div className="border-l px-3 text-center" style={{ borderColor: line }}>
            <div className="text-[27px] tracking-[0.08em]" style={{ color: blue }}>★★★★★</div>
            <div className="mt-1 text-[13px] font-black" style={{ color: ink }}>4.8 OUT OF 5</div>
            <div className="text-[9px] text-slate-500">1,250+ Customer Reviews</div>
          </div>
        </section>

        {/* Specs row */}
        <section className="mt-3 grid grid-cols-5 rounded-[18px] border bg-white py-3" style={{ borderColor: line }}>
          {[
            ['Mileage', mileage, 'M'],
            ['Fuel Economy', `${fuel.city} / ${fuel.highway}`, 'F'],
            ['Engine', engine, 'E'],
            ['Drivetrain', drivetrain, 'D'],
            ['Transmission', trans, 'T'],
          ].map(([label, value, icon]) => (
            <div key={label} className="flex items-center gap-3 border-r px-4 last:border-r-0" style={{ borderColor: line }}>
              <div className="text-[30px] font-black" style={{ color: ink }}>{icon}</div>
              <div><div className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="text-[18px] font-black leading-none" style={{ color: ink }}>{value}</div></div>
            </div>
          ))}
        </section>

        {/* Core report cards */}
        <section className="mt-4 grid grid-cols-[1.05fr_1fr_1.18fr] gap-4">
          <Card className="overflow-hidden text-white" title="">
            <div className="-m-px rounded-[18px] p-5 text-white" style={{ background: `linear-gradient(145deg,${blue},${navy})` }}>
              <div className="text-[14px] font-black uppercase tracking-wide">Vehicle Quality Score</div>
              <div className="mt-4 flex items-end gap-2"><span className="text-[62px] font-black leading-none">93</span><span className="pb-2 text-[18px]">/100</span></div>
              <div className="mt-2 inline-block rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase text-white">Excellent</div>
              <div className="mt-3 text-[10px] leading-snug text-blue-100">Scores are based on data analysis of history, condition, and value.</div>
              {['Ownership History', 'Condition', 'Service History', 'Market Value'].map((x, i) => (
                <div key={x} className="mt-3 grid grid-cols-[1fr_80px] items-center gap-2 text-[9px]"><span>{x}</span><div className="h-1.5 rounded-full bg-white/30"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${92 - i * 5}%` }} /></div></div>
              ))}
            </div>
          </Card>

          <Card title="Included Ownership Benefits">
            <div className="space-y-2 p-4 pt-3">
              {benefits.slice(0, 4).map((b, i) => (
                <div key={b} className="flex items-center gap-3 rounded-xl border p-2.5" style={{ borderColor: line }}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg text-[18px] font-black" style={{ color: blue, background: '#EFF6FF' }}>{i + 1}</div>
                  <div><div className="text-[11px] font-black" style={{ color: ink }}>{b}</div><div className="text-[8px] text-slate-500">Included with this vehicle.</div></div>
                </div>
              ))}
              <div className="pt-1 text-center text-[10px] font-semibold" style={{ color: blue }}>See dealer for complete details.</div>
            </div>
          </Card>

          <Card title="Top Features">
            <div className="grid grid-cols-2 gap-2 p-4 pt-3">
              {featureColumns.flat().map((h) => (
                <div key={h} className="rounded-xl border px-3 py-2 text-[10px] font-semibold leading-tight" style={{ borderColor: line, color: ink }}>
                  <span style={{ color: blue }}>▣</span> {h}
                </div>
              ))}
              <div className="col-span-2 text-center text-[10px] font-semibold text-slate-500">... and more</div>
            </div>
          </Card>
        </section>

        {/* Bottom report row */}
        <section className="mt-4 grid grid-cols-[2.05fr_0.95fr] gap-4">
          <Card title="Ownership Snapshot (Estimates)">
            <div className="grid grid-cols-4 gap-0 p-4 pt-3 text-[10px]">
              {[['Fuel Type', 'Gasoline', 'Annual fuel est. $1,850'], ['Insurance Category', 'Mid-Range', 'Annual estimate $1,450 - $1,750'], ['Warranty Status', 'Powertrain Coverage', 'Expires 09/03/2033 or 100,000 mi'], ['Market Value', 'Great Value', 'Within market range']].map(([a, b, c]) => (
                <div key={a} className="border-r px-3 last:border-r-0" style={{ borderColor: line }}>
                  <div className="font-black uppercase tracking-wide text-slate-500">{a}</div><div className="mt-1 font-black" style={{ color: ink }}>{b}</div><div className="mt-3 text-[8px] font-semibold text-slate-500">{c}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Market Price</div>
              <div className="mt-1 text-[40px] font-black leading-none" style={{ color: ink }}>{fmtMoney(vehicle.price)}</div>
              <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-emerald-600"><span>✓</span> Within Market Range</div>
              <div className="mt-2 text-[9px] text-slate-500">Pricing updated today</div>
            </div>
          </Card>
        </section>

        {/* Footer */}
        <footer className="mt-auto grid grid-cols-[1.1fr_repeat(4,0.72fr)_1fr] items-center rounded-[16px] border bg-slate-50 text-center" style={{ borderColor: line }}>
          <div className="flex items-center gap-2 px-4 py-3 text-left"><div className="text-[34px] font-black" style={{ color: blue }}>A</div><div><div className="text-[15px] font-black" style={{ color: ink }}>autolabels.io</div><div className="text-[9px] text-slate-500">AI-Powered Vehicle Information</div></div></div>
          {['AI-Powered Accuracy', 'FTC Compliant', 'Real-Time Updates', 'Digital + Print Ready'].map((x) => <div key={x} className="border-l px-2 text-[9px] font-semibold" style={{ borderColor: line, color: ink }}>{x}</div>)}
          <div className="border-l px-3 text-left text-[9px]" style={{ borderColor: line }}><div className="font-black" style={{ color: blue }}>Questions?</div><div>{dealer.phone}</div><div>{dealer.website}</div></div>
        </footer>
        <div className="mt-1 text-[7.5px] leading-tight text-slate-500">{disclaimer}</div>
      </div>
    </div>
  );
};

export default SaturdayHeroWindow;

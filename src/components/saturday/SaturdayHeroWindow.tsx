// Saturday Hero Window Sticker -- 8.5x11 portrait
// Goal: closely mimic the Saturday AutoLabels Vehicle Passport Pro / Intelligence Report references.
// Presentational only: no registry, no signing, no DB writes.

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const ink = "#07142f";
const blue = "#2563eb";
const navy = "#061a35";
const line = "#dbe4f0";
const green = "#22c55e";
const pale = "#f7fbff";

const money = (n?: string | number) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  return Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : String(n);
};

function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[16px] border bg-white ${className}`} style={{ borderColor: line }}>
      {title ? <div className="px-4 pt-3 text-[13px] font-black uppercase tracking-tight" style={{ color: blue }}>{title}</div> : null}
      {children}
    </section>
  );
}

function Mark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-13 w-13 items-center justify-center rounded-[15px] text-[31px] font-black text-white" style={{ height: 52, width: 52, background: `linear-gradient(145deg,${blue},#60a5fa)` }}>A</div>
      <div>
        <div className="text-[29px] font-black leading-none tracking-[-0.045em]" style={{ color: ink }}>autolabels<span style={{ color: blue }}>.io</span></div>
        <div className="mt-1 text-[10px] font-semibold text-slate-500">AI-Powered Vehicle Transparency</div>
      </div>
    </div>
  );
}

function Header({ qrUrl }: { qrUrl: string }) {
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  return (
    <header className="grid grid-cols-[1.2fr_0.72fr_1.08fr] items-start gap-4">
      <Mark />
      <div className="flex gap-2 pt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
        <div>
          <div className="text-[12px] font-black uppercase" style={{ color: ink }}>FTC Compliant</div>
          <div className="text-[9.5px] leading-tight text-slate-500">All disclosures delivered digitally and in print.</div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-[15px] border bg-white p-2.5" style={{ borderColor: "#cbd5e1" }}>
        <QRCodeSVG value={safeUrl} size={78} bgColor="#fff" fgColor="#111827" level="M" />
        <div>
          <div className="text-[12px] font-black uppercase leading-tight" style={{ color: ink }}>Scan to view full vehicle report</div>
          <div className="mt-1 text-[8.5px] leading-tight text-slate-500">Photos, service records, pricing analysis & more.</div>
          <div className="mt-1 text-[9px] font-bold" style={{ color: blue }}>Scan Anytime</div>
        </div>
      </div>
    </header>
  );
}

function CarRender() {
  return (
    <div className="relative h-[2.18in] overflow-hidden rounded-[22px] bg-gradient-to-br from-white via-blue-50 to-slate-100">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 71% 44%, rgba(147,197,253,.55) 0, transparent 31%), linear-gradient(118deg, transparent 0 54%, rgba(37,99,235,.07) 54% 61%, transparent 61%)" }} />
      <svg className="absolute left-[0.03in] top-[0.05in] drop-shadow-2xl" width="475" height="200" viewBox="0 0 475 200" fill="none" aria-label="vehicle image placeholder">
        <path d="M50 128c11-46 50-76 104-76h142c45 0 85 24 116 68l43 9c15 3 25 15 22 29l-4 16H22l6-24c3-14 10-21 22-22Z" fill="#1f2937" />
        <path d="M149 66h143c39 0 70 19 93 55H91c15-32 34-51 58-55Z" fill="#94a3b8" />
        <path d="M168 78h69v41H112c13-23 32-38 56-41ZM256 78h38c28 0 52 14 74 41H256V78Z" fill="#eef6ff" />
        <path d="M88 134h323" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" opacity="0.58" />
        <path d="M167 60h112" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" opacity="0.75" />
        <circle cx="118" cy="163" r="31" fill="#0f172a" />
        <circle cx="118" cy="163" r="15" fill="#e2e8f0" />
        <circle cx="363" cy="163" r="31" fill="#0f172a" />
        <circle cx="363" cy="163" r="15" fill="#e2e8f0" />
        <path d="M29 182h417" stroke="#94a3b8" strokeWidth="3" opacity="0.35" />
      </svg>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[22px_1fr] gap-2">
      <span className="text-[17px]" style={{ color: navy }}>▱</span>
      <div><div className="text-[8.5px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="text-[10px] font-black" style={{ color: ink }}>{value}</div></div>
    </div>
  );
}

function Snapshot({ title, sub, color = blue }: { title: string; sub: string; color?: string }) {
  return (
    <div className="flex flex-col items-center border-l px-3 text-center" style={{ borderColor: line }}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full text-[21px] font-black text-white" style={{ background: color }}>✓</div>
      <div className="mt-1.5 text-[10px] font-black leading-tight" style={{ color: ink }}>{title}</div>
      <div className="text-[8.5px] text-slate-500">{sub}</div>
    </div>
  );
}

function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 border-r px-3 last:border-r-0" style={{ borderColor: line }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full border text-[18px] font-black" style={{ borderColor: "#bfdbfe", color: ink }}>{label[0]}</div>
      <div><div className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="text-[17px] font-black leading-none" style={{ color: ink }}>{value}</div>{sub ? <div className="text-[8px] text-slate-500">{sub}</div> : null}</div>
    </div>
  );
}

function ScorePanel() {
  return (
    <Panel className="overflow-hidden text-white">
      <div className="h-full rounded-[16px] p-4 text-white" style={{ background: `linear-gradient(150deg,${blue},${navy})` }}>
        <div className="text-[14px] font-black uppercase">Vehicle Quality Score</div>
        <div className="mt-3 flex items-end gap-2"><span className="text-[64px] font-black leading-none">93</span><span className="pb-2 text-[17px]">/100</span></div>
        <span className="mt-1 inline-block rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase">Excellent</span>
        <p className="mt-3 text-[9.5px] leading-snug text-blue-100">Scores are based on data analysis of history, condition, and value.</p>
        {['Ownership History', 'Condition', 'Service History', 'Market Value'].map((x, i) => (
          <div key={x} className="mt-3 grid grid-cols-[1fr_90px] items-center gap-2 text-[8.5px]"><span>{x}</span><div className="h-1.5 rounded-full bg-white/25"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${96 - i * 7}%` }} /></div></div>
        ))}
      </div>
    </Panel>
  );
}

function Benefit({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[13px] border p-2.5" style={{ borderColor: line }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl text-[18px] font-black" style={{ color: blue, background: "#eff6ff" }}>{icon}</div>
      <div><div className="text-[10.5px] font-black leading-tight" style={{ color: ink }}>{title}</div><div className="text-[8.5px] leading-tight text-slate-500">{detail}</div></div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-[11px] border px-2.5 py-1.5 text-[9.5px] font-semibold leading-tight" style={{ borderColor: line, color: ink }}><span style={{ color: blue }}>▣</span> {children}</span>;
}

export const SaturdayHeroWindow = ({ data }: Props) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "8-Speed";
  const mileage = vehicle.mileage ? Number(vehicle.mileage).toLocaleString() : "32,554";
  const title = vehicle.title.replace(/^\d{4}\s+/i, "").replace(/INFINITI\s+INFINITI/i, "INFINITI");
  const featureList = [...highlights, "Clean History", "No Accidents", "3rd Row Seating", "Remote Start"].slice(0, 12);

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.22in]">
        <Header qrUrl={qrUrl} />

        <section className="mt-4 grid grid-cols-[0.9fr_1.1fr] gap-5">
          <div>
            <div className="mb-2 text-[12px] font-black uppercase" style={{ color: blue }}>Vehicle Intelligence Report</div>
            <div className="text-[24px] font-black leading-none" style={{ color: blue }}>2024</div>
            <h1 className="mt-1 text-[40px] font-black leading-[0.98] tracking-[-0.045em]" style={{ color: ink }}>{title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-x-7 gap-y-3.5">
              <Meta label="Stock Number" value={vehicle.stock} />
              <Meta label="VIN" value={vehicle.vin} />
              <Meta label="Exterior Color" value={exterior} />
              <Meta label="Interior Color" value={interior} />
            </div>
          </div>
          <CarRender />
        </section>

        <section className="mt-4 grid grid-cols-[0.85fr_repeat(4,1fr)_1.4fr] items-center rounded-[18px] border bg-white px-4 py-3" style={{ borderColor: line }}>
          <div className="text-[16px] font-black leading-tight" style={{ color: ink }}>Overall<br />Vehicle<br />Snapshot</div>
          <Snapshot title="One Owner" sub="Verified" />
          <Snapshot title="Clean History" sub="No Accidents" color={green} />
          <Snapshot title="Dealer Certified" sub="Inspected" />
          <Snapshot title="Well Maintained" sub="Service Records" color="#8b5cf6" />
          <div className="border-l px-3 text-center" style={{ borderColor: line }}><div className="text-[27px] tracking-[0.06em]" style={{ color: blue }}>★★★★★</div><div className="text-[14px] font-black" style={{ color: ink }}>4.8 OUT OF 5</div><div className="text-[9px] text-slate-500">1,250+ Customer Reviews</div></div>
        </section>

        <section className="mt-3 grid grid-cols-5 rounded-[18px] border bg-white py-3" style={{ borderColor: line }}>
          <Spec label="Mileage" value={mileage} sub="miles" />
          <Spec label="Fuel Economy" value={`${fuel.city} / ${fuel.highway}`} sub="MPG City / Hwy" />
          <Spec label="Engine" value={engine} sub="Gasoline" />
          <Spec label="Drivetrain" value={drivetrain} sub="All Wheel Drive" />
          <Spec label="Transmission" value={trans} sub="Automatic" />
        </section>

        <section className="mt-3 grid grid-cols-[0.98fr_1fr_1.28fr] gap-4">
          <ScorePanel />
          <Panel title="Included Ownership Benefits">
            <div className="space-y-2 p-4 pt-3">
              <Benefit icon="S" title="10 Year / 100,000 Mile Powertrain Coverage" detail="Included at no extra cost." />
              <Benefit icon="M" title="2 Years Maintenance Program" detail="Scheduled maintenance included." />
              <Benefit icon="R" title="24/7 Roadside Assistance" detail="Nationwide coverage." />
              <Benefit icon="C" title="Free CARFAX Vehicle History Report" detail="Included with every vehicle." />
              <div className="pt-1 text-center text-[10px] font-semibold" style={{ color: blue }}>See dealer for complete details.</div>
            </div>
          </Panel>
          <Panel title="Top Features">
            <div className="grid grid-cols-2 gap-2 p-4 pt-3">
              {featureList.slice(0, 10).map((h) => <Pill key={h}>{h}</Pill>)}
              <div className="col-span-2 text-center text-[10px] font-semibold text-slate-500">... and more</div>
            </div>
          </Panel>
        </section>

        <section className="mt-3 grid grid-cols-[2.05fr_0.95fr] gap-4">
          <Panel title="Ownership Snapshot (Estimates)">
            <div className="grid grid-cols-4 p-4 pt-3 text-[10px]">
              {[
                ['Fuel Type', 'Gasoline', 'Annual fuel est.', '$1,850'],
                ['Insurance Category', 'Mid-Range', 'Annual estimate', '$1,450 - $1,750'],
                ['Warranty Status', 'Powertrain Coverage', 'Expires', '09/03/2033 or 100,000 mi'],
                ['Market Value', 'Great Value', 'Within market range', ''],
              ].map(([a, b, c, d]) => <div key={a} className="border-r px-3 last:border-r-0" style={{ borderColor: line }}><div className="text-[8px] font-black uppercase text-slate-500">{a}</div><div className="mt-1 font-black" style={{ color: ink }}>{b}</div><div className="mt-3 text-[8px] uppercase text-slate-500">{c}</div><div className="font-black" style={{ color: ink }}>{d}</div></div>)}
            </div>
          </Panel>
          <Panel>
            <div className="p-4"><div className="text-[10px] font-black uppercase text-slate-500">Market Price</div><div className="mt-1 text-[40px] font-black leading-none" style={{ color: ink }}>{money(vehicle.price)}</div><div className="mt-3 text-[11px] font-bold text-emerald-600">✓ Within Market Range</div><div className="mt-2 text-[9px] text-slate-500">Pricing updated today</div></div>
          </Panel>
        </section>

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

// Saturday Hero Window Sticker -- 8.5x11 portrait
// Premium AutoLabels Vehicle Intelligence / Passport report preview.
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

const money = (n?: string | number) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  return Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : String(n);
};

function Box({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[20px] border bg-white ${className}`} style={{ borderColor: line }}>
      {title ? <div className="px-4 pt-3 text-[15px] font-black tracking-tight" style={{ color: ink }}>{title}</div> : null}
      {children}
    </section>
  );
}

function Header({ qrUrl }: { qrUrl: string }) {
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  return (
    <header className="grid grid-cols-[1.28fr_0.72fr_0.98fr] items-start gap-5">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-[16px] text-[34px] font-black text-white" style={{ background: `linear-gradient(145deg,${blue},#60a5fa)` }}>A</div>
          <div className="text-[31px] font-black leading-none tracking-[-0.045em]" style={{ color: ink }}>AUTOLABELS<span style={{ color: blue }}>.IO</span></div>
        </div>
        <div className="mt-4 text-[27px] font-black leading-none" style={{ color: ink }}>Vehicle Intelligence Report</div>
        <div className="mt-2 text-[14px] text-slate-500">Generated from live dealer inventory</div>
      </div>
      <div className="flex items-start gap-2 pt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
        <div><div className="text-[13px] font-black uppercase" style={{ color: ink }}>FTC Compliant</div><div className="text-[10px] leading-tight text-slate-500">All disclosures delivered digitally and in print.</div></div>
      </div>
      <div className="flex items-center gap-3 rounded-[16px] border bg-white p-2.5" style={{ borderColor: "#cbd5e1" }}>
        <QRCodeSVG value={safeUrl} size={84} bgColor="#fff" fgColor="#111827" level="M" />
        <div><div className="text-[12px] font-black leading-tight" style={{ color: ink }}>Scan to view full disclosures & more</div><div className="mt-1 text-[9px] font-bold" style={{ color: blue }}>Scan Anytime</div></div>
      </div>
    </header>
  );
}

function VehiclePhoto() {
  return (
    <div className="relative h-[2.68in] overflow-hidden rounded-[24px] bg-gradient-to-br from-white via-slate-50 to-blue-50">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 72% 45%, rgba(147,197,253,.55) 0, transparent 34%), linear-gradient(115deg, transparent 0 55%, rgba(37,99,235,.055) 55% 62%, transparent 62%)" }} />
      <svg className="absolute -left-[0.12in] top-[0.03in] drop-shadow-2xl" width="585" height="255" viewBox="0 0 585 255" fill="none" aria-label="vehicle image placeholder">
        <path d="M52 166c16-64 72-106 145-106h186c61 0 116 34 159 94l32 7c16 4 26 18 21 34l-5 19H23l7-28c4-14 10-19 22-20Z" fill="#263243" />
        <path d="M190 82h185c52 0 94 26 125 74H112c22-46 48-70 78-74Z" fill="#94a3b8" />
        <path d="M215 98h91v55H134c19-34 46-52 81-55ZM330 98h45c39 0 71 19 101 55H330V98Z" fill="#f4f8fc" />
        <path d="M101 174h414" stroke="#f8fafc" strokeWidth="11" strokeLinecap="round" opacity="0.58" />
        <path d="M215 73h143" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" opacity="0.72" />
        <circle cx="143" cy="212" r="40" fill="#0f172a" />
        <circle cx="143" cy="212" r="19" fill="#e2e8f0" />
        <circle cx="458" cy="212" r="40" fill="#0f172a" />
        <circle cx="458" cy="212" r="19" fill="#e2e8f0" />
      </svg>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-[11px] font-black" style={{ color: ink }}>{value}</div></div>;
}

function Snapshot({ title, sub, color = blue }: { title: string; sub: string; color?: string }) {
  return (
    <div className="flex flex-col items-center border-l px-4 text-center" style={{ borderColor: line }}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full text-[22px] font-black text-white" style={{ background: color }}>✓</div>
      <div className="mt-2 text-[10px] font-black leading-tight" style={{ color: ink }}>{title}</div>
      <div className="text-[8.5px] text-slate-500">{sub}</div>
    </div>
  );
}

function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 border-r px-4 last:border-r-0" style={{ borderColor: line }}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full border text-[19px] font-black" style={{ borderColor: "#bfdbfe", color: ink }}>{label[0]}</div>
      <div><div className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="text-[18px] font-black leading-none" style={{ color: ink }}>{value}</div>{sub ? <div className="text-[8.5px] text-slate-500">{sub}</div> : null}</div>
    </div>
  );
}

function ScorePanel() {
  return (
    <Box className="overflow-hidden text-white">
      <div className="h-full rounded-[20px] p-5 text-white" style={{ background: `linear-gradient(150deg,${blue},${navy})` }}>
        <div className="text-[15px] font-black uppercase tracking-wide">Vehicle Quality Score</div>
        <div className="mt-4 flex items-end gap-2"><span className="text-[72px] font-black leading-none">93</span><span className="pb-2 text-[18px]">/100</span></div>
        <span className="mt-1 inline-block rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase">Excellent</span>
        <p className="mt-3 text-[10px] leading-snug text-blue-100">Scores are based on data analysis of history, condition, and value.</p>
        {['Ownership History', 'Condition', 'Service History', 'Market Value'].map((x, i) => <div key={x} className="mt-3 grid grid-cols-[1fr_96px] items-center gap-2 text-[9px]"><span>{x}</span><div className="h-1.5 rounded-full bg-white/25"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${96 - i * 7}%` }} /></div></div>)}
      </div>
    </Box>
  );
}

function Benefit({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border p-3" style={{ borderColor: line }}>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl text-[19px] font-black" style={{ color: blue, background: "#eff6ff" }}>{icon}</div>
      <div><div className="text-[11px] font-black leading-tight" style={{ color: ink }}>{title}</div><div className="text-[8.5px] leading-tight text-slate-500">{detail}</div></div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <div className="rounded-[13px] border px-3 py-2 text-[10px] font-semibold leading-tight" style={{ borderColor: line, color: ink }}><span style={{ color: blue }}>▣</span> {children}</div>;
}

export const SaturdayHeroWindow = ({ data }: Props) => {
  const { dealer, vehicle, specs, highlights, fuel, qrUrl, disclaimer } = data;
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "8-Speed";
  const mileage = vehicle.mileage ? Number(vehicle.mileage).toLocaleString() : "32,554";
  const title = vehicle.title.replace(/^\d{4}\s+/i, "").replace(/INFINITI\s+INFINITI/i, "INFINITI");
  const featureList = [...highlights, "Clean History", "No Accidents", "3rd Row Seating", "Remote Start"].slice(0, 10);

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.24in]">
        <Header qrUrl={qrUrl} />

        <section className="mt-5 grid grid-cols-[0.86fr_1.14fr] gap-5">
          <div>
            <div className="text-[28px] font-black leading-none" style={{ color: blue }}>2024</div>
            <h1 className="mt-2 text-[44px] font-black leading-[0.96] tracking-[-0.05em]" style={{ color: ink }}>{title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4">
              <Meta label="Stock Number" value={vehicle.stock} />
              <Meta label="VIN" value={vehicle.vin} />
              <Meta label="Exterior Color" value={exterior} />
              <Meta label="Interior Color" value={interior} />
            </div>
          </div>
          <VehiclePhoto />
        </section>

        <section className="mt-4 grid grid-cols-[0.9fr_repeat(4,1fr)_1.42fr] items-center rounded-[18px] border bg-white px-4 py-3.5" style={{ borderColor: line }}>
          <div className="text-[16px] font-black leading-tight" style={{ color: ink }}>Overall<br />Vehicle<br />Snapshot</div>
          <Snapshot title="One Owner" sub="Verified" />
          <Snapshot title="Clean History" sub="No Accidents" color={green} />
          <Snapshot title="Dealer Certified" sub="Inspected" />
          <Snapshot title="Well Maintained" sub="Service Records" color="#8b5cf6" />
          <div className="border-l px-3 text-center" style={{ borderColor: line }}><div className="text-[28px] tracking-[0.06em]" style={{ color: blue }}>★★★★★</div><div className="text-[14px] font-black" style={{ color: ink }}>4.8 OUT OF 5</div><div className="text-[9px] text-slate-500">1,250+ Customer Reviews</div></div>
        </section>

        <section className="mt-3 grid grid-cols-5 rounded-[18px] border bg-white py-3.5" style={{ borderColor: line }}>
          <Spec label="Mileage" value={mileage} sub="miles" />
          <Spec label="Fuel Economy" value={`${fuel.city} / ${fuel.highway}`} sub="MPG City / Hwy" />
          <Spec label="Engine" value={engine} sub="Gasoline" />
          <Spec label="Drivetrain" value={drivetrain} sub="All Wheel Drive" />
          <Spec label="Transmission" value={trans} sub="Automatic" />
        </section>

        <section className="mt-4 grid grid-cols-[1fr_1.05fr_1.25fr] gap-4">
          <ScorePanel />
          <Box title="Included Ownership Benefits">
            <div className="space-y-2.5 p-4 pt-3">
              <Benefit icon="S" title="10 Year / 100,000 Mile Powertrain Coverage" detail="Included at no extra cost." />
              <Benefit icon="M" title="2 Years Maintenance Program" detail="Scheduled maintenance included." />
              <Benefit icon="R" title="24/7 Roadside Assistance" detail="Nationwide coverage." />
              <Benefit icon="C" title="Free CARFAX Vehicle History Report" detail="Included with every vehicle." />
              <div className="pt-1 text-center text-[10px] font-semibold" style={{ color: blue }}>See dealer for complete details.</div>
            </div>
          </Box>
          <Box title="Top Features">
            <div className="grid grid-cols-2 gap-2.5 p-4 pt-3">
              {featureList.map((h) => <Pill key={h}>{h}</Pill>)}
              <div className="col-span-2 text-center text-[10px] font-semibold text-slate-500">... and more</div>
            </div>
          </Box>
        </section>

        <section className="mt-4 grid grid-cols-[2.05fr_0.95fr] gap-4">
          <Box title="Ownership Snapshot (Estimates)">
            <div className="grid grid-cols-4 p-4 pt-3 text-[10px]">
              {[
                ['Fuel Type', 'Gasoline', 'Annual fuel est.', '$1,850'],
                ['Insurance Category', 'Mid-Range', 'Annual estimate', '$1,450 - $1,750'],
                ['Warranty Status', 'Powertrain Coverage', 'Expires', '09/03/2033 or 100,000 mi'],
                ['Market Value', 'Great Value', 'Within market range', ''],
              ].map(([a, b, c, d]) => <div key={a} className="border-r px-3 last:border-r-0" style={{ borderColor: line }}><div className="text-[8px] font-black uppercase text-slate-500">{a}</div><div className="mt-1 font-black" style={{ color: ink }}>{b}</div><div className="mt-3 text-[8px] uppercase text-slate-500">{c}</div><div className="font-black" style={{ color: ink }}>{d}</div></div>)}
            </div>
          </Box>
          <Box>
            <div className="p-4"><div className="text-[10px] font-black uppercase text-slate-500">Market Price</div><div className="mt-1 text-[41px] font-black leading-none" style={{ color: ink }}>{money(vehicle.price)}</div><div className="mt-3 text-[11px] font-bold text-emerald-600">✓ Within Market Range</div><div className="mt-2 text-[9px] text-slate-500">Pricing updated today</div></div>
          </Box>
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

// Saturday Hero Window Sticker -- 8.5x11 portrait
// AutoLabels Vehicle Intelligence Report target layout.
// Presentational only: no registry, no signing, no DB writes.

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const ink = "#07142f";
const blue = "#2563eb";
const navy = "#08224a";
const line = "#dbe4f0";
const green = "#22c55e";
const pale = "#f7fbff";

const fmtMoney = (n: string | number | undefined) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[18px] border bg-white ${className}`} style={{ borderColor: line }}>
      {title ? <h3 className="px-4 pt-3 text-[16px] font-black tracking-tight" style={{ color: ink }}>{title}</h3> : null}
      {children}
    </section>
  );
}

function AutoLabelsHeader({ qrUrl }: { qrUrl: string }) {
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  return (
    <header className="grid grid-cols-[1.25fr_0.72fr_0.92fr] items-start gap-5">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-[15px] text-[34px] font-black text-white" style={{ background: `linear-gradient(145deg,${blue},#60a5fa)` }}>A</div>
          <div>
            <p className="text-[29px] font-black leading-none tracking-[-0.04em]" style={{ color: ink }}>AUTOLABELS<span style={{ color: blue }}>.IO</span></p>
          </div>
        </div>
        <p className="mt-4 text-[23px] font-black leading-tight" style={{ color: ink }}>Vehicle Intelligence Report</p>
        <p className="mt-1 text-[13px] text-slate-500">Generated from live dealer inventory</p>
      </div>

      <div className="flex items-start gap-2 pt-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
        <div>
          <p className="text-[13px] font-black uppercase" style={{ color: ink }}>FTC Compliant</p>
          <p className="mt-0.5 text-[10px] leading-tight text-slate-500">All disclosures delivered digitally and in print.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-[15px] border bg-white p-2.5" style={{ borderColor: "#cbd5e1" }}>
        <div className="rounded-lg bg-white p-1.5">
          <QRCodeSVG value={safeUrl} size={74} bgColor="#ffffff" fgColor="#111827" level="M" />
        </div>
        <div>
          <p className="text-[11px] font-black leading-tight" style={{ color: ink }}>Scan to view full disclosures & more</p>
        </div>
      </div>
    </header>
  );
}

function PremiumVehicleArt() {
  return (
    <div className="relative h-[2.05in] overflow-hidden rounded-[22px] bg-gradient-to-br from-white via-blue-50 to-slate-100">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 66% 45%, rgba(147,197,253,.55) 0, transparent 30%), linear-gradient(120deg, transparent 0 56%, rgba(37,99,235,.06) 56% 63%, transparent 63%)" }} />
      <svg className="absolute left-[0.15in] top-[0.1in] drop-shadow-xl" width="445" height="185" viewBox="0 0 445 185" fill="none" aria-label="Vehicle photo placeholder">
        <path d="M53 120c9-41 44-68 93-68h132c42 0 78 22 107 62l39 8c15 3 24 15 20 30l-3 14H26l5-22c3-14 11-22 22-24Z" fill="#202938" />
        <path d="M141 64h132c37 0 65 17 86 50H88c14-28 31-45 53-50Z" fill="#94a3b8" />
        <path d="M158 75h64v37H108c12-21 29-34 50-37ZM240 75h35c26 0 47 13 67 37H240V75Z" fill="#eef6ff" />
        <path d="M91 125h295" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" opacity="0.55" />
        <path d="M158 58h103" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
        <circle cx="115" cy="150" r="29" fill="#0f172a" />
        <circle cx="115" cy="150" r="14" fill="#e2e8f0" />
        <circle cx="345" cy="150" r="29" fill="#0f172a" />
        <circle cx="345" cy="150" r="14" fill="#e2e8f0" />
        <path d="M27 170h390" stroke="#94a3b8" strokeWidth="3" opacity="0.35" />
      </svg>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[0.24in_1fr] items-start gap-2">
      <div className="mt-0.5 text-[18px] leading-none" style={{ color: navy }}>▱</div>
      <div>
        <p className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-0.5 text-[10.5px] font-black" style={{ color: ink }}>{value}</p>
      </div>
    </div>
  );
}

function SnapshotBadge({ label, sub, tone = blue }: { label: string; sub: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center border-l px-4 text-center" style={{ borderColor: line }}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full text-[22px] font-black text-white" style={{ background: tone }}>✓</div>
      <p className="mt-2 text-[10px] font-black leading-tight" style={{ color: ink }}>{label}</p>
      <p className="text-[9px] leading-tight text-slate-500">{sub}</p>
    </div>
  );
}

function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 border-r px-4 last:border-r-0" style={{ borderColor: line }}>
      <div className="text-[30px] leading-none" style={{ color: ink }}>◷</div>
      <div>
        <p className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-[18px] font-black leading-none" style={{ color: ink }}>{value}</p>
        {sub ? <p className="text-[8.5px] leading-tight text-slate-500">{sub}</p> : null}
      </div>
    </div>
  );
}

function ScoreCard() {
  return (
    <Card className="overflow-hidden text-white">
      <div className="h-full rounded-[18px] p-5 text-white" style={{ background: `linear-gradient(145deg,${blue},${navy})` }}>
        <p className="text-[15px] font-black uppercase tracking-wide">Vehicle Quality Score</p>
        <div className="mt-5 flex items-end gap-2"><span className="text-[64px] font-black leading-none">93</span><span className="pb-2 text-[18px]">/100</span></div>
        <p className="mt-2 inline-block rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase">Excellent</p>
        <p className="mt-3 text-[10px] leading-snug text-blue-100">Scores are based on data analysis of history, condition, and value.</p>
        {['Ownership History', 'Condition', 'Service History', 'Market Value'].map((x, idx) => (
          <div key={x} className="mt-3 grid grid-cols-[1fr_82px] items-center gap-2 text-[9px]"><span>{x}</span><div className="flex gap-0.5 text-[10px] text-emerald-400">{'★★★★★'.slice(0, 5 - (idx === 3 ? 1 : 0))}<span className="text-white/30">{'★★★★★'.slice(0, idx === 3 ? 1 : 0)}</span></div></div>
        ))}
      </div>
    </Card>
  );
}

function BenefitRow({ title, detail, icon }: { title: string; detail: string; icon: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[13px] border p-3" style={{ borderColor: line }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl text-[20px] font-black" style={{ color: blue, background: "#eff6ff" }}>{icon}</div>
      <div><p className="text-[11px] font-black leading-tight" style={{ color: ink }}>{title}</p><p className="text-[8.5px] leading-tight text-slate-500">{detail}</p></div>
    </div>
  );
}

function FeaturePill({ text }: { text: string }) {
  return <div className="rounded-[12px] border px-3 py-2 text-[10px] font-semibold leading-tight" style={{ borderColor: line, color: ink }}><span style={{ color: blue }}>▣</span> {text}</div>;
}

export const SaturdayHeroWindow = ({ data }: Props) => {
  const { vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "8-Speed";
  const mileage = vehicle.mileage ? Number(vehicle.mileage).toLocaleString() : "32,554";
  const title = vehicle.title.replace(/^2024\s+/i, "").replace(/QX60 LUXE AWD/i, "INFINITI QX60 LUXE AWD");
  const featureList = [...highlights, "Leather Seats", "Navigation System", "Apple CarPlay", "Android Auto", "360 Camera", "Remote Start"].slice(0, 10);

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.24in]">
        <AutoLabelsHeader qrUrl={qrUrl} />

        <section className="mt-4 grid grid-cols-[0.92fr_1.08fr] gap-5">
          <div>
            <p className="text-[24px] font-black leading-none" style={{ color: blue }}>2024</p>
            <h1 className="mt-1 text-[39px] font-black leading-[0.98] tracking-[-0.045em]" style={{ color: ink }}>{title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-x-7 gap-y-4">
              <MetaItem label="Stock Number" value={vehicle.stock} />
              <MetaItem label="VIN" value={vehicle.vin} />
              <MetaItem label="Exterior Color" value={exterior} />
              <MetaItem label="Interior Color" value={interior} />
            </div>
          </div>
          <PremiumVehicleArt />
        </section>

        <section className="mt-4 grid grid-cols-[0.9fr_repeat(4,1fr)_1.45fr] items-center rounded-[18px] border bg-white px-4 py-3" style={{ borderColor: line }}>
          <p className="text-[16px] font-black leading-tight" style={{ color: ink }}>Overall<br />Vehicle<br />Snapshot</p>
          <SnapshotBadge label="One Owner" sub="Verified" />
          <SnapshotBadge label="Clean History" sub="No Accidents" tone={green} />
          <SnapshotBadge label="Dealer Certified" sub="Inspected" />
          <SnapshotBadge label="Well Maintained" sub="Service Records" tone="#8b5cf6" />
          <div className="border-l px-4 text-center" style={{ borderColor: line }}><p className="text-[27px] tracking-[0.08em]" style={{ color: blue }}>★★★★★</p><p className="mt-1 text-[14px] font-black" style={{ color: ink }}>4.8 OUT OF 5</p><p className="text-[9px] text-slate-500">1,250+ Customer Reviews</p></div>
        </section>

        <section className="mt-3 grid grid-cols-5 rounded-[18px] border bg-white py-3" style={{ borderColor: line }}>
          <Spec label="Mileage" value={mileage} sub="miles" />
          <Spec label="Fuel Economy" value={`${fuel.city} / ${fuel.highway}`} sub="MPG City / Hwy" />
          <Spec label="Engine" value={engine} sub="Gasoline" />
          <Spec label="Drivetrain" value={drivetrain} sub="All Wheel Drive" />
          <Spec label="Transmission" value={trans} sub="Automatic" />
        </section>

        <section className="mt-3 grid grid-cols-[1fr_1fr_1.28fr] gap-4">
          <ScoreCard />
          <Card title="Included Ownership Benefits">
            <div className="space-y-2 p-4 pt-3">
              <BenefitRow title="10 Year / 100,000 Mile Powertrain Coverage" detail="Included at no extra cost." icon="S" />
              <BenefitRow title="2 Years Maintenance Program" detail="Scheduled maintenance included." icon="M" />
              <BenefitRow title="24/7 Roadside Assistance" detail="Nationwide coverage." icon="R" />
              <BenefitRow title="Free CARFAX Vehicle History Report" detail="Included with every vehicle." icon="C" />
              <p className="pt-1 text-center text-[10px] font-semibold" style={{ color: blue }}>See dealer for complete details.</p>
            </div>
          </Card>
          <Card title="Top Features">
            <div className="grid grid-cols-2 gap-2 p-4 pt-3">
              {featureList.map((h) => <FeaturePill key={h} text={h} />)}
              <p className="col-span-2 pt-1 text-center text-[10px] font-semibold text-slate-500">... and more</p>
            </div>
          </Card>
        </section>

        <section className="mt-3 grid grid-cols-[2.05fr_0.95fr] gap-4">
          <Card title="Ownership Snapshot (Estimates)">
            <div className="grid grid-cols-4 p-4 pt-3 text-[10px]">
              {[
                ['Fuel Type', 'Gasoline', 'Annual fuel est.', '$1,850'],
                ['Insurance Category', 'Mid-Range', 'Annual estimate', '$1,450 - $1,750'],
                ['Warranty Status', 'Powertrain Coverage', 'Expires', '09/03/2033 or 100,000 mi'],
                ['Market Value', 'Great Value', 'Within market range', ''],
              ].map(([a, b, c, d]) => <div key={a} className="border-r px-3 last:border-r-0" style={{ borderColor: line }}><p className="text-[8px] font-black uppercase text-slate-500">{a}</p><p className="mt-1 font-black" style={{ color: ink }}>{b}</p><p className="mt-3 text-[8px] uppercase text-slate-500">{c}</p><p className="font-black" style={{ color: ink }}>{d}</p></div>)}
            </div>
          </Card>
          <Card>
            <div className="p-4"><p className="text-[10px] font-black uppercase text-slate-500">Market Price</p><p className="mt-1 text-[40px] font-black leading-none" style={{ color: ink }}>{fmtMoney(vehicle.price)}</p><p className="mt-3 text-[11px] font-bold text-emerald-600">✓ Within Market Range</p><p className="mt-2 text-[9px] text-slate-500">Pricing updated today</p></div>
          </Card>
        </section>

        <footer className="mt-auto grid grid-cols-[1.1fr_repeat(4,0.72fr)_1fr] items-center rounded-[16px] border bg-slate-50 text-center" style={{ borderColor: line }}>
          <div className="flex items-center gap-2 px-4 py-3 text-left"><div className="text-[34px] font-black" style={{ color: blue }}>A</div><div><p className="text-[15px] font-black" style={{ color: ink }}>autolabels.io</p><p className="text-[9px] text-slate-500">AI-Powered Vehicle Information</p></div></div>
          {['AI-Powered Accuracy', 'FTC Compliant', 'Real-Time Updates', 'Digital + Print Ready'].map((x) => <div key={x} className="border-l px-2 text-[9px] font-semibold" style={{ borderColor: line, color: ink }}>{x}</div>)}
          <div className="border-l px-3 text-left text-[9px]" style={{ borderColor: line }}><p className="font-black" style={{ color: blue }}>Questions?</p><p>(888) 555-0123</p><p>support@autolabels.io</p></div>
        </footer>
        <p className="mt-1 text-[7.5px] leading-tight text-slate-500">{disclaimer}</p>
      </div>
    </div>
  );
};

export default SaturdayHeroWindow;

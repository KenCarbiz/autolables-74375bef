// Saturday Hero Window Sticker -- 8.5x11 portrait
// Premium AutoLabels Vehicle Passport Pro preview.
// Presentational only: no registry, no signing, no DB writes.

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const ink = "#07142f";
const blue = "#2563eb";
const navy = "#071f3f";
const line = "#dbe4f0";
const green = "#22c55e";

const money = (n?: string | number) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  return Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : String(n);
};

function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[18px] border bg-white ${className}`} style={{ borderColor: line }}>
      {title ? <div className="px-4 pt-3 text-[13px] font-black uppercase tracking-tight" style={{ color: blue }}>{title}</div> : null}
      {children}
    </section>
  );
}

function Header({ qrUrl }: { qrUrl: string }) {
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  return (
    <header className="grid grid-cols-[1.18fr_0.72fr_1.06fr] items-start gap-5">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-[16px] text-[34px] font-black text-white" style={{ background: `linear-gradient(145deg,${blue},#60a5fa)` }}>A</div>
        <div>
          <div className="text-[30px] font-black leading-none tracking-[-0.045em]" style={{ color: ink }}>autolabels<span style={{ color: blue }}>.io</span></div>
          <div className="mt-1 text-[11px] text-slate-500">AI-Powered Vehicle Transparency</div>
        </div>
      </div>
      <div className="flex items-start gap-2 pt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
        <div><div className="text-[13px] font-black uppercase" style={{ color: ink }}>FTC Compliant</div><div className="text-[10px] leading-tight text-slate-500">All disclosures delivered digitally and in print.</div></div>
      </div>
      <div className="flex items-center gap-3 rounded-[16px] border bg-white p-2.5" style={{ borderColor: "#cbd5e1" }}>
        <QRCodeSVG value={safeUrl} size={82} bgColor="#fff" fgColor="#111827" level="M" />
        <div><div className="text-[12px] font-black uppercase leading-tight" style={{ color: ink }}>Scan to view full vehicle report</div><div className="mt-1 text-[9px] leading-tight text-slate-500">Photos, records, pricing & more.</div><div className="mt-1 text-[9px] font-bold" style={{ color: blue }}>Scan Anytime</div></div>
      </div>
    </header>
  );
}

function VehiclePhoto() {
  return (
    <div className="relative h-[2.36in] overflow-hidden rounded-[24px] bg-gradient-to-br from-white via-slate-50 to-blue-50">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 70% 42%, rgba(147,197,253,.45) 0, transparent 36%), linear-gradient(115deg, transparent 0 55%, rgba(37,99,235,.05) 55% 62%, transparent 62%)" }} />
      <svg className="absolute left-[0.04in] top-[0.14in] drop-shadow-2xl" width="460" height="190" viewBox="0 0 460 190" fill="none" aria-label="vehicle image placeholder">
        <path d="M45 118c12-45 52-75 106-75h148c45 0 86 25 118 68l28 6c13 3 22 14 19 27l-4 16H23l6-23c3-12 8-18 16-19Z" fill="#273243" />
        <path d="M150 58h146c39 0 70 19 94 55H91c17-34 37-52 59-55Z" fill="#9aa8b8" />
        <path d="M170 72h72v40H111c16-25 36-38 59-40ZM264 72h36c30 0 55 15 78 40H264V72Z" fill="#f4f8fc" />
        <path d="M80 124h335" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" opacity="0.58" />
        <path d="M170 51h112" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" opacity="0.72" />
        <circle cx="111" cy="155" r="32" fill="#0f172a" />
        <circle cx="111" cy="155" r="15" fill="#e2e8f0" />
        <circle cx="372" cy="155" r="32" fill="#0f172a" />
        <circle cx="372" cy="155" r="15" fill="#e2e8f0" />
        <path d="M32 174h390" stroke="#94a3b8" strokeWidth="3" opacity="0.35" />
      </svg>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[8.5px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-0.5 text-[10.5px] font-black" style={{ color: ink }}>{value}</div></div>;
}

function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 border-r px-3 last:border-r-0" style={{ borderColor: line }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full border text-[18px] font-black" style={{ borderColor: "#bfdbfe", color: ink }}>{label[0]}</div>
      <div><div className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="text-[17px] font-black leading-none" style={{ color: ink }}>{value}</div>{sub ? <div className="text-[8px] text-slate-500">{sub}</div> : null}</div>
    </div>
  );
}

function ScoreGauge() {
  return (
    <Card title="Vehicle Confidence Score">
      <div className="p-4 pt-3 text-center">
        <div className="relative mx-auto h-[1.34in] w-[1.55in]">
          <div className="absolute left-1/2 top-0 h-[1.35in] w-[1.35in] -translate-x-1/2 rounded-full border-[13px]" style={{ borderColor: green, borderBottomColor: "transparent", transform: "translateX(-50%) rotate(45deg)" }} />
          <div className="absolute inset-x-0 top-[0.42in] text-center"><div className="text-[46px] font-black leading-none" style={{ color: ink }}>93</div><div className="text-[12px] font-bold text-slate-500">/100</div></div>
        </div>
        <div className="mt-1 text-[14px] font-black uppercase" style={{ color: green }}>Excellent</div>
        <div className="mx-auto mt-1 max-w-[1.7in] text-[9px] leading-tight text-slate-500">Our AI analyzes 50+ data points to rate this vehicle.</div>
      </div>
    </Card>
  );
}

function PricePosition() {
  return (
    <Card title="Price Position">
      <div className="p-4 pt-3 text-center">
        <div className="text-[19px] font-black uppercase" style={{ color: green }}>Great Value</div>
        <div className="mt-1 text-[10px] font-semibold text-slate-500">$1,240 below market average</div>
        <div className="relative mx-auto mt-4 h-[0.95in] w-[1.85in] overflow-hidden">
          <div className="absolute bottom-0 left-1/2 h-[1.65in] w-[1.65in] -translate-x-1/2 rounded-full border-[18px]" style={{ borderColor: "#d8e1ee", borderBottomColor: green, borderLeftColor: green, borderRightColor: "#7aa2ff", transform: "translateX(-50%) rotate(-45deg)" }} />
          <div className="absolute bottom-0 left-1/2 h-[0.75in] w-[2px] origin-bottom bg-slate-900" style={{ transform: "rotate(-3deg)" }} />
        </div>
        <div className="grid grid-cols-3 text-[8px] text-slate-500"><span>Below</span><span>Market</span><span>Above</span></div>
      </div>
    </Card>
  );
}

function PassportPanel() {
  return (
    <section className="rounded-[18px] p-4 text-white" style={{ background: `linear-gradient(145deg,${navy},#061326)` }}>
      <div className="text-[16px] font-black uppercase">Digital Vehicle Passport</div>
      <p className="mt-2 text-[10px] leading-snug text-blue-100">Verified digital passport with blockchain-secured records.</p>
      <div className="mt-3 space-y-1.5 text-[10.5px] font-semibold">
        {['Ownership History Verified', 'Title & Brand Check', 'Odometer Verified', 'Service & Maintenance Records', 'Inspection & Reconditioning'].map((x) => <div key={x}><span style={{ color: green }}>✓</span> {x}</div>)}
      </div>
      <div className="mt-3 rounded-full bg-white px-4 py-2 text-center text-[10px] font-black" style={{ color: navy }}>View Full Passport Report</div>
    </section>
  );
}

function BenefitIcon({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="border-r px-3 text-center last:border-r-0" style={{ borderColor: line }}>
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[19px] font-black" style={{ color: blue, background: "#eff6ff" }}>{icon}</div>
      <div className="mt-1 text-[9.5px] font-black leading-tight" style={{ color: ink }}>{title}</div>
      <div className="mt-0.5 text-[8px] leading-tight text-slate-500">{sub}</div>
    </div>
  );
}

function TrustScore() {
  return (
    <Card title="Dealer Trust Score">
      <div className="grid grid-cols-[0.45fr_1fr] items-center gap-3 p-4 pt-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-[34px] font-black" style={{ color: blue, background: "#eff6ff" }}>★</div>
        <div><div className="text-[38px] font-black leading-none" style={{ color: ink }}>4.9 <span className="text-[18px]" style={{ color: blue }}>★★★★★</span></div><div className="mt-1 text-[10px] text-slate-500">Based on 1,250+ verified reviews</div></div>
      </div>
    </Card>
  );
}

function Timeline() {
  return (
    <Card title="Vehicle Journey Timeline">
      <div className="grid grid-cols-5 gap-1 p-4 pt-3 text-center">
        {['Acquired', 'Inspected', 'Reconditioned', 'Certified', 'Listed'].map((x, i) => <div key={x}><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-[11px] font-black" style={{ borderColor: i === 4 ? green : blue, color: i === 4 ? green : blue }}>{i + 1}</div><div className="mt-1 text-[8.5px] font-black uppercase" style={{ color: ink }}>{x}</div><div className="text-[7.5px] leading-tight text-slate-500">03/0{i + 2}/2024</div></div>)}
      </div>
    </Card>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border px-2.5 py-1 text-[8.5px] font-semibold leading-none" style={{ borderColor: line, color: ink }}>{children}</span>;
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
  const featureList = [...highlights, "Clean History", "No Accidents", "3rd Row Seating", "Remote Start"].slice(0, 12);

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.22in]">
        <Header qrUrl={qrUrl} />

        <section className="mt-4 grid grid-cols-[0.9fr_1.1fr] gap-5">
          <div>
            <div className="text-[12px] font-black uppercase" style={{ color: blue }}>Vehicle Passport</div>
            <div className="mt-3 text-[27px] font-black leading-none" style={{ color: blue }}>2024</div>
            <h1 className="mt-2 text-[43px] font-black uppercase leading-[0.95] tracking-[-0.05em]" style={{ color: ink }}>{title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4"><Meta label="Stock Number" value={vehicle.stock} /><Meta label="VIN" value={vehicle.vin} /><Meta label="Exterior" value={exterior} /><Meta label="Interior" value={interior} /></div>
          </div>
          <VehiclePhoto />
        </section>

        <section className="mt-3 grid grid-cols-6 rounded-[18px] border bg-white py-3" style={{ borderColor: line }}>
          <Spec label="Mileage" value={mileage} sub="Miles" />
          <Spec label="Fuel Economy" value={`${fuel.city} / ${fuel.highway}`} sub="MPG City / Hwy" />
          <Spec label="Engine" value={engine} sub="Gasoline" />
          <Spec label="Drivetrain" value={drivetrain} sub="All Wheel Drive" />
          <Spec label="Transmission" value={trans} sub="Automatic" />
          <Spec label="Fuel Type" value="Gasoline" />
        </section>

        <section className="mt-3 grid grid-cols-[1fr_1fr_1.12fr] gap-3">
          <ScoreGauge />
          <PricePosition />
          <PassportPanel />
        </section>

        <section className="mt-3 grid grid-cols-[1.25fr_0.95fr] gap-3">
          <Card title="Ownership Benefits Included">
            <div className="grid grid-cols-5 p-3 pt-2">
              <BenefitIcon icon="S" title="10 Year / 100,000 Mile" sub="Powertrain warranty" />
              <BenefitIcon icon="M" title="2 Years" sub="Maintenance" />
              <BenefitIcon icon="R" title="24/7" sub="Roadside assistance" />
              <BenefitIcon icon="E" title="3 Day / 300 Mile" sub="Exchange policy" />
              <BenefitIcon icon="C" title="Free CARFAX" sub="Vehicle report" />
            </div>
          </Card>
          <TrustScore />
        </section>

        <section className="mt-3 grid grid-cols-[1.18fr_0.82fr] gap-3">
          <Timeline />
          <Card title="Vehicle Highlights">
            <div className="flex flex-wrap gap-1.5 p-3 pt-2">
              {featureList.map((h) => <Pill key={h}>{h}</Pill>)}
            </div>
          </Card>
        </section>

        <section className="mt-3 grid grid-cols-[1.25fr_0.62fr_0.82fr] gap-3">
          <Card>
            <div className="grid grid-cols-[0.82fr_1fr] items-center p-4"><div><div className="text-[10px] font-black uppercase text-slate-500">Market Price</div><div className="text-[36px] font-black leading-none" style={{ color: ink }}>{money(vehicle.price)}</div><div className="mt-2 text-[10px] font-bold text-emerald-600">✓ Within Market Range</div></div><svg viewBox="0 0 180 55" className="h-[0.62in] w-full"><polyline fill="none" stroke={blue} strokeWidth="3" points="5,40 30,36 52,27 78,29 103,18 130,21 160,10" /><circle cx="160" cy="10" r="5" fill={blue} /></svg></div>
          </Card>
          <Card><div className="p-4"><div className="text-[10px] font-black uppercase text-slate-500">Est. Monthly Payment</div><div className="mt-1 text-[26px] font-black" style={{ color: ink }}>$542 <span className="text-[10px]">/mo*</span></div><div className="text-[9px] text-slate-500">Get pre-qualified in minutes.</div></div></Card>
          <Card><div className="p-4"><div className="text-[13px] font-black uppercase" style={{ color: blue }}>Secure. Private. Compliant.</div><div className="mt-2 text-[10px] leading-snug text-slate-500">Your data is protected with enterprise-grade security.</div></div></Card>
        </section>

        <footer className="mt-auto grid grid-cols-[1.05fr_repeat(4,0.72fr)_1fr] items-center rounded-[14px] border bg-slate-50 text-center" style={{ borderColor: line }}>
          <div className="flex items-center gap-2 px-3 py-2 text-left"><div className="text-[28px] font-black" style={{ color: blue }}>A</div><div><div className="text-[14px] font-black" style={{ color: ink }}>autolabels.io</div><div className="text-[8px] text-slate-500">AI-Powered Vehicle Information Platform</div></div></div>
          {['AI-Powered', 'FTC Compliant', 'Real-Time', 'Digital + Print'].map((x) => <div key={x} className="border-l px-2 text-[8.5px] font-semibold" style={{ borderColor: line, color: ink }}>{x}</div>)}
          <div className="border-l px-2 text-left text-[8.5px]" style={{ borderColor: line }}><div className="font-black" style={{ color: blue }}>Questions?</div><div>{dealer.phone}</div><div>{dealer.website}</div></div>
        </footer>
        <div className="mt-1 text-center text-[7px] leading-tight text-slate-500">{disclaimer}</div>
      </div>
    </div>
  );
};

export default SaturdayHeroWindow;

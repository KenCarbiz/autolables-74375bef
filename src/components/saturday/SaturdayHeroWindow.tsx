// Saturday Hero Window Sticker -- 8.5x11 portrait
// Premium AutoLabels Vehicle Passport Pro / Intelligence Report layout.
// Presentational only: no registry, no signing, no DB writes.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const ink = "#07142f";
const blue = "#2563eb";
const navy = "#071f3f";
const soft = "#f8fbff";
const line = "#dbe4f0";
const green = "#22c55e";

const fmtMoney = (n: string | number | undefined) => {
  if (!n) return "Call for Price";
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

const Card: React.FC<React.PropsWithChildren<{ className?: string; title?: string }>> = ({ className = "", title, children }) => (
  <section className={`rounded-[16px] border bg-white ${className}`} style={{ borderColor: line }}>
    {title ? <div className="px-4 pt-3 text-[13px] font-black uppercase tracking-tight" style={{ color: blue }}>{title}</div> : null}
    {children}
  </section>
);

const QrReport = ({ url }: { url: string }) => (
  <div className="flex items-center gap-3 rounded-[14px] border bg-white p-2.5" style={{ borderColor: "#cbd5e1" }}>
    <div className="rounded-lg bg-white p-1.5">
      <QRCodeSVG value={url.startsWith("http") ? url : `https://${url}`} size={78} bgColor="#ffffff" fgColor="#111827" level="M" />
    </div>
    <div className="min-w-0">
      <p className="text-[12px] font-black uppercase leading-[1.05]" style={{ color: ink }}>Scan to view full vehicle report</p>
      <p className="mt-1 text-[8.5px] leading-tight text-slate-500">Photos, records, pricing analysis & disclosures.</p>
      <p className="mt-1 text-[9px] font-bold" style={{ color: blue }}>Scan Anytime</p>
    </div>
  </div>
);

const AutoLabelsMark = () => (
  <div className="flex items-center gap-3">
    <div className="relative flex h-12 w-12 items-center justify-center rounded-[14px] text-[30px] font-black text-white" style={{ background: `linear-gradient(145deg,${blue},#60a5fa)` }}>A</div>
    <div>
      <p className="text-[28px] font-black leading-none tracking-[-0.04em]" style={{ color: ink }}>autolabels<span style={{ color: blue }}>.io</span></p>
      <p className="mt-1 text-[10px] font-semibold text-slate-500">AI-Powered Vehicle Transparency</p>
    </div>
  </div>
);

const VehicleArt = () => (
  <div className="relative flex h-[1.95in] items-center justify-center overflow-hidden rounded-[22px] bg-gradient-to-br from-white via-blue-50 to-slate-100">
    <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 70% 45%, #dbeafe 0, transparent 32%), linear-gradient(120deg, transparent 0 55%, rgba(37,99,235,.07) 55% 61%, transparent 61%)" }} />
    <svg className="relative z-10 drop-shadow-xl" width="390" height="158" viewBox="0 0 390 158" fill="none" aria-label="Vehicle illustration">
      <path d="M48 102c8-33 37-55 76-55h111c36 0 67 18 91 51l34 7c13 3 21 13 18 25l-3 12H25l4-18c3-12 9-19 19-22Z" fill="#202938" />
      <path d="M119 57h112c31 0 55 14 73 41H74c12-23 26-37 45-41Z" fill="#94a3b8" />
      <path d="M133 66h54v31H91c10-17 24-28 42-31ZM202 66h30c22 0 40 10 57 31h-87V66Z" fill="#eef6ff" />
      <path d="M77 107h254" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" opacity="0.55" />
      <path d="M135 52h88" stroke="#f8fafc" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      <circle cx="100" cy="127" r="25" fill="#0f172a" />
      <circle cx="100" cy="127" r="13" fill="#e2e8f0" />
      <circle cx="296" cy="127" r="25" fill="#0f172a" />
      <circle cx="296" cy="127" r="13" fill="#e2e8f0" />
      <path d="M26 143h338" stroke="#94a3b8" strokeWidth="3" opacity="0.35" />
    </svg>
  </div>
);

const Spec = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="flex items-center gap-3 border-r px-3 last:border-r-0" style={{ borderColor: line }}>
    <div className="flex h-9 w-9 items-center justify-center rounded-full border text-[18px] font-black" style={{ borderColor: "#bfdbfe", color: ink }}>{label[0]}</div>
    <div>
      <p className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-[16px] font-black leading-none" style={{ color: ink }}>{value}</p>
      {sub ? <p className="text-[8px] text-slate-500">{sub}</p> : null}
    </div>
  </div>
);

const BenefitIcon = ({ label, detail, icon }: { label: string; detail: string; icon: string }) => (
  <div className="border-r px-3 text-center last:border-r-0" style={{ borderColor: line }}>
    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[18px] font-black" style={{ color: blue, background: "#eff6ff" }}>{icon}</div>
    <p className="mt-1 text-[10px] font-black leading-tight" style={{ color: ink }}>{label}</p>
    <p className="mt-0.5 text-[8px] leading-tight text-slate-500">{detail}</p>
  </div>
);

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full border bg-white px-2.5 py-1 text-[9px] font-semibold leading-none" style={{ borderColor: line, color: ink }}>{children}</span>
);

export const SaturdayHeroWindow: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "9-Speed";
  const mileage = vehicle.mileage ? Number(vehicle.mileage).toLocaleString() : "18,426";
  const title = vehicle.title.replace(/^2024\s+/i, "");
  const featurePills = [...highlights, "Clean History", "No Accidents", "3rd Row Seating", "Remote Start"].slice(0, 14);

  return (
    <div
      className="bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 print:shadow-none"
      style={{ width: "8.5in", height: "11in", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="flex h-full flex-col p-[0.22in]">
        <header className="grid grid-cols-[1.25fr_0.7fr_1.05fr] items-start gap-4">
          <AutoLabelsMark />
          <div className="flex items-start gap-2 pt-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border text-[14px] font-black" style={{ borderColor: blue, color: blue }}>✓</div>
            <div>
              <p className="text-[12px] font-black uppercase" style={{ color: ink }}>FTC Compliant</p>
              <p className="text-[9px] leading-tight text-slate-500">All disclosures delivered digitally and in print.</p>
            </div>
          </div>
          <QrReport url={qrUrl} />
        </header>

        <section className="mt-4 grid grid-cols-[0.98fr_1.02fr] gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-black uppercase" style={{ color: blue }}><span className="rounded-full border px-2 py-0.5" style={{ borderColor: "#bfdbfe" }}>Vehicle Passport</span></div>
            <h1 className="text-[41px] font-black uppercase leading-[0.98] tracking-[-0.045em]" style={{ color: ink }}>{title}</h1>
            <div className="mt-4 grid grid-cols-2 gap-x-7 gap-y-3 text-[9.5px]">
              <div><p className="font-black uppercase text-slate-500">Stock Number</p><p className="mt-0.5 font-black" style={{ color: ink }}>{vehicle.stock}</p></div>
              <div><p className="font-black uppercase text-slate-500">VIN</p><p className="mt-0.5 font-black" style={{ color: ink }}>{vehicle.vin}</p></div>
              <div><p className="font-black uppercase text-slate-500">Exterior</p><p className="mt-0.5 font-black" style={{ color: ink }}>{exterior}</p></div>
              <div><p className="font-black uppercase text-slate-500">Interior</p><p className="mt-0.5 font-black" style={{ color: ink }}>{interior}</p></div>
            </div>
          </div>
          <VehicleArt />
        </section>

        <section className="mt-3 grid grid-cols-6 rounded-[16px] border bg-white py-3" style={{ borderColor: line }}>
          <Spec label="Mileage" value={mileage} sub="Miles" />
          <Spec label="Fuel Economy" value={`${fuel.city} / ${fuel.highway}`} sub="MPG City / Hwy" />
          <Spec label="Engine" value={engine} sub="Gasoline" />
          <Spec label="Drivetrain" value={drivetrain} sub="All Wheel Drive" />
          <Spec label="Transmission" value={trans} sub="Automatic" />
          <Spec label="Fuel Type" value="Gasoline" />
        </section>

        <section className="mt-3 grid grid-cols-[1fr_1fr_1.08fr] gap-3">
          <Card title="Vehicle Confidence Score">
            <div className="p-4 pt-3 text-center">
              <div className="mx-auto flex h-[1.18in] w-[1.18in] items-center justify-center rounded-full border-[10px]" style={{ borderColor: green }}>
                <div><p className="text-[45px] font-black leading-none" style={{ color: ink }}>93</p><p className="text-[12px] font-bold text-slate-500">/100</p></div>
              </div>
              <p className="mt-2 text-[13px] font-black uppercase" style={{ color: green }}>Excellent</p>
              <p className="mx-auto mt-1 max-w-[1.7in] text-[9px] leading-tight text-slate-500">Our AI analyzes 50+ data points to rate this vehicle.</p>
            </div>
          </Card>

          <Card title="Price Position">
            <div className="p-4 pt-3 text-center">
              <p className="text-[18px] font-black uppercase" style={{ color: green }}>Great Value</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">$1,240 below market average</p>
              <div className="relative mx-auto mt-5 h-[0.8in] w-[1.75in] overflow-hidden">
                <div className="absolute bottom-0 left-0 h-[1.55in] w-[1.55in] rounded-full border-[17px]" style={{ borderColor: "#dbe4f0", borderBottomColor: green, borderLeftColor: green, transform: "rotate(-45deg)" }} />
                <div className="absolute bottom-0 left-[0.82in] h-[0.65in] w-[2px] origin-bottom bg-slate-800" style={{ transform: "rotate(-2deg)" }} />
              </div>
              <div className="mt-1 grid grid-cols-3 text-[8px] text-slate-500"><span>Below</span><span>Market</span><span>Above</span></div>
            </div>
          </Card>

          <Card className="overflow-hidden text-white">
            <div className="h-full rounded-[16px] p-4" style={{ background: `linear-gradient(145deg,${navy},#061326)` }}>
              <p className="text-[15px] font-black uppercase tracking-tight">Digital Vehicle Passport</p>
              <p className="mt-2 text-[10px] leading-snug text-blue-100">Verified digital passport with blockchain-secured records.</p>
              <div className="mt-3 space-y-1.5 text-[10.5px] font-semibold">
                {['Ownership History Verified', 'Title & Brand Check', 'Odometer Verified', 'Service & Maintenance Records', 'Inspection & Reconditioning'].map((x) => <p key={x}><span style={{ color: green }}>✓</span> {x}</p>)}
              </div>
              <div className="mt-3 rounded-full bg-white px-4 py-2 text-center text-[10px] font-black" style={{ color: navy }}>View Full Passport Report</div>
            </div>
          </Card>
        </section>

        <section className="mt-3 grid grid-cols-[1.25fr_0.95fr] gap-3">
          <Card title="Ownership Benefits Included">
            <div className="grid grid-cols-5 p-3 pt-2">
              <BenefitIcon icon="S" label="10 Year / 100,000 Mile" detail="Powertrain warranty" />
              <BenefitIcon icon="M" label="2 Years" detail="Maintenance" />
              <BenefitIcon icon="R" label="24/7" detail="Roadside assistance" />
              <BenefitIcon icon="E" label="3 Day / 300 Mile" detail="Exchange policy" />
              <BenefitIcon icon="C" label="Free CARFAX" detail="Vehicle report" />
            </div>
          </Card>
          <Card title="Dealer Trust Score">
            <div className="grid grid-cols-[0.42fr_1fr] items-center gap-3 p-4 pt-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-[35px] font-black" style={{ color: blue, background: "#eff6ff" }}>★</div>
              <div><p className="text-[39px] font-black leading-none" style={{ color: ink }}>4.9 <span className="text-[19px]" style={{ color: blue }}>★★★★★</span></p><p className="mt-1 text-[10px] text-slate-500">Based on 1,250+ verified reviews</p></div>
            </div>
          </Card>
        </section>

        <section className="mt-3 grid grid-cols-[1.18fr_0.82fr] gap-3">
          <Card title="Vehicle Journey Timeline">
            <div className="grid grid-cols-5 gap-1 p-4 pt-3 text-center">
              {['Acquired', 'Inspected', 'Reconditioned', 'Certified', 'Listed'].map((x, i) => <div key={x} className="relative"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-[11px] font-black" style={{ borderColor: i === 4 ? green : blue, color: i === 4 ? green : blue }}>{i + 1}</div><p className="mt-1 text-[9px] font-black uppercase" style={{ color: ink }}>{x}</p><p className="text-[8px] leading-tight text-slate-500">03/0{i + 2}/2024</p></div>)}
            </div>
          </Card>
          <Card title="Vehicle Highlights">
            <div className="flex flex-wrap gap-1.5 p-3 pt-2">
              {featurePills.map((h) => <Pill key={h}>{h}</Pill>)}
            </div>
          </Card>
        </section>

        <section className="mt-3 grid grid-cols-[1.25fr_0.62fr_0.82fr] gap-3">
          <Card>
            <div className="grid grid-cols-[0.82fr_1fr] items-center p-4">
              <div><p className="text-[10px] font-black uppercase text-slate-500">Market Price</p><p className="text-[36px] font-black leading-none" style={{ color: ink }}>{fmtMoney(vehicle.price)}</p><p className="mt-2 text-[10px] font-bold text-emerald-600">✓ Within Market Range</p></div>
              <svg viewBox="0 0 180 55" className="h-[0.62in] w-full"><polyline fill="none" stroke={blue} strokeWidth="3" points="5,40 30,36 52,27 78,29 103,18 130,21 160,10" /><circle cx="160" cy="10" r="5" fill={blue} /></svg>
            </div>
          </Card>
          <Card>
            <div className="p-4"><p className="text-[10px] font-black uppercase text-slate-500">Est. Monthly Payment</p><p className="mt-1 text-[26px] font-black" style={{ color: ink }}>$542 <span className="text-[10px]">/mo*</span></p><p className="text-[9px] text-slate-500">Get pre-qualified in minutes.</p></div>
          </Card>
          <Card>
            <div className="p-4"><p className="text-[13px] font-black uppercase" style={{ color: blue }}>Secure. Private. Compliant.</p><p className="mt-2 text-[10px] leading-snug text-slate-500">Your data is protected with enterprise-grade security.</p></div>
          </Card>
        </section>

        <footer className="mt-auto grid grid-cols-[1.05fr_repeat(4,0.72fr)_1fr] items-center rounded-[14px] border bg-slate-50 text-center" style={{ borderColor: line }}>
          <div className="flex items-center gap-2 px-3 py-2 text-left"><div className="text-[28px] font-black" style={{ color: blue }}>A</div><div><p className="text-[14px] font-black" style={{ color: ink }}>autolabels.io</p><p className="text-[8px] text-slate-500">AI-Powered Vehicle Information Platform</p></div></div>
          {['AI-Powered', 'FTC Compliant', 'Real-Time', 'Digital + Print'].map((x) => <div key={x} className="border-l px-2 text-[8.5px] font-semibold" style={{ borderColor: line, color: ink }}>{x}</div>)}
          <div className="border-l px-2 text-left text-[8.5px]" style={{ borderColor: line }}><p className="font-black" style={{ color: blue }}>Questions?</p><p>{dealer.phone}</p><p>{dealer.website}</p></div>
        </footer>
        <p className="mt-1 text-center text-[7px] leading-tight text-slate-500">{disclaimer}</p>
      </div>
    </div>
  );
};

export default SaturdayHeroWindow;

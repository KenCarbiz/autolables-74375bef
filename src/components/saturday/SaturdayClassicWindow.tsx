// Saturday Classic Window Sticker — 8.5x11 portrait
// Traditional blue-outline dealer sticker inspired by the Saturday reference.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";

type Props = { data: SaturdaySticker };

const navy = "#07376f";
const line = "#0b4a8f";

const fmtMoney = (n: string | number) => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v)) return String(n);
  return `$${Math.round(v).toLocaleString()}`;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="rounded-t-[8px] px-3 py-1 text-[14px] font-black uppercase tracking-wide text-white" style={{ background: navy }}>{children}</div>;
}

function CarSilhouette() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-slate-50 to-slate-100">
      <svg width="410" height="170" viewBox="0 0 410 170" fill="none" className="opacity-55">
        <path d="M48 102c12-36 42-58 84-58h116c34 0 66 18 91 51l38 7c13 2 21 13 18 26l-3 14H25l4-18c3-13 9-20 19-22Z" fill="#64748b" />
        <path d="M129 55h116c28 0 52 14 71 42H83c12-25 27-39 46-42Z" fill="#cbd5e1" />
        <path d="M142 64h53v32H101c10-19 24-30 41-32ZM212 64h32c21 0 40 11 56 32h-88V64Z" fill="#f8fafc" />
        <circle cx="101" cy="135" r="25" fill="#475569" />
        <circle cx="101" cy="135" r="11" fill="#f8fafc" />
        <circle cx="306" cy="135" r="25" fill="#475569" />
        <circle cx="306" cy="135" r="11" fill="#f8fafc" />
      </svg>
      <div className="absolute bottom-7 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500">Vehicle Photo</div>
    </div>
  );
}

export const SaturdayClassicWindow: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, specs, highlights, fuel, benefits, qrUrl, disclaimer } = data;
  const safeUrl = qrUrl.startsWith("http") ? qrUrl : `https://${qrUrl}`;
  const mileage = vehicle.mileage ? Number(vehicle.mileage).toLocaleString() : specs.find((s) => /mileage/i.test(s.label))?.value || "18,426";
  const engine = specs.find((s) => /engine/i.test(s.label))?.value || "3.5L V6";
  const drivetrain = specs.find((s) => /drive/i.test(s.label))?.value || "AWD";
  const trans = specs.find((s) => /trans/i.test(s.label))?.value || "9-Speed Auto";
  const exterior = specs.find((s) => /exterior/i.test(s.label))?.value || "Graphite Shadow";
  const interior = specs.find((s) => /interior/i.test(s.label))?.value || "Graphite Leather";

  return (
    <div className="bg-white text-slate-950 shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "8.5in", height: "11in", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="flex h-full flex-col p-[0.18in]">
        <header className="grid grid-cols-[2fr_1.05fr] gap-3">
          <div className="rounded-[13px] border-[3px] p-3" style={{ borderColor: line }}>
            <div className="flex items-center gap-5">
              <div className="flex h-[0.78in] w-[1.8in] items-center justify-center border-2 border-dashed border-slate-300 text-center text-[18px] font-black uppercase leading-tight text-slate-400">Dealership<br />Logo</div>
              <div>
                <div className="text-[30px] font-black uppercase tracking-wide" style={{ color: navy }}>{dealer.name}</div>
                <div className="mt-1 text-[13px] font-semibold text-slate-800">● {dealer.address}</div>
                <div className="mt-1 text-[13px] font-semibold text-slate-800">☎ {dealer.phone} &nbsp;&nbsp; | &nbsp;&nbsp; 🌐 {dealer.website}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center rounded-[13px] px-4 text-white" style={{ background: navy }}>
            <div className="text-center text-[20px] font-black uppercase leading-tight">Certified<br />Pre-Owned<br />Vehicle</div>
          </div>
        </header>

        <div className="mt-4 flex items-end justify-between border-b-[3px] pb-2" style={{ borderColor: line }}>
          <h1 className="text-[36px] font-black uppercase leading-none tracking-[-0.03em]">{vehicle.title}</h1>
          <div className="text-[18px] font-black uppercase">Stock #: {vehicle.stock}</div>
        </div>

        <main className="mt-3 grid grid-cols-[2.35in_1fr] gap-4">
          <aside className="space-y-3">
            <section className="overflow-hidden rounded-[12px] border-2" style={{ borderColor: line }}>
              <SectionTitle>Vehicle Highlights</SectionTitle>
              {[
                ['Mileage', `${mileage} Miles`],
                ['Engine', engine],
                ['Transmission', trans],
                ['Drivetrain', drivetrain],
                ['Exterior Color', exterior],
                ['Interior Color', interior],
                ['Fuel Type', 'Gasoline'],
                ['Doors / Seats', '4 / 7'],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[0.55in_1fr] items-center border-b px-3 py-2 last:border-b-0">
                  <div className="text-[26px] font-black" style={{ color: navy }}>◉</div>
                  <div><div className="text-[11px] font-black uppercase" style={{ color: navy }}>{label}</div><div className="text-[16px] font-bold leading-tight">{value}</div></div>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-[12px] border-2" style={{ borderColor: line }}>
              <SectionTitle>Vehicle Highlights</SectionTitle>
              <div className="space-y-1 p-3 text-[14px] font-semibold">
                {['One Owner', 'Clean History', 'Non-Smoker', 'Local Trade', 'Well Maintained', 'Dealer Inspected'].map((x) => <div key={x}><span style={{ color: navy }}>●</span> {x}</div>)}
              </div>
            </section>

            <section className="rounded-[12px] border-2 p-3" style={{ borderColor: line }}>
              <div className="flex items-center gap-3">
                <QRCodeSVG value={safeUrl} size={82} bgColor="#fff" fgColor="#111827" level="M" />
                <div><div className="text-[13px] font-black uppercase leading-tight">Scan QR code for more details!</div><div className="mt-1 text-[10px] leading-tight text-slate-600">View full details, photos, and more online.</div></div>
              </div>
            </section>
          </aside>

          <section>
            <div className="h-[2.85in] rounded-[12px] border-2" style={{ borderColor: line }}><CarSilhouette /></div>

            <div className="mt-3 grid grid-cols-[1fr_2.05in] gap-3">
              <section className="overflow-hidden rounded-[12px] border-2" style={{ borderColor: line }}>
                <SectionTitle>Features & Equipment</SectionTitle>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-[13px]">
                  {highlights.slice(0, 16).map((h) => <div key={h}>• {h}</div>)}
                </div>
              </section>
              <section className="overflow-hidden rounded-[12px] border-2 text-center" style={{ borderColor: line }}>
                <SectionTitle>Fuel Economy</SectionTitle>
                <div className="p-4">
                  <div className="text-[56px] font-black leading-none">{fuel.city}</div><div className="text-[16px] font-black">MPG CITY</div>
                  <div className="my-3 border-t" style={{ borderColor: line }} />
                  <div className="text-[56px] font-black leading-none">{fuel.highway}</div><div className="text-[16px] font-black">MPG HWY</div>
                  <div className="mt-3 text-[11px] text-slate-600">Fuel economy estimates based on EPA ratings.</div>
                </div>
              </section>
            </div>

            <section className="mt-3 overflow-hidden rounded-[12px] border-2" style={{ borderColor: line }}>
              <SectionTitle>Included Benefits</SectionTitle>
              <div className="grid grid-cols-4 p-4 text-center text-[13px]">
                {benefits.slice(0, 4).map((b) => <div key={b} className="border-r px-2 last:border-r-0"><div className="text-[32px] font-black" style={{ color: navy }}>✓</div><div className="font-semibold leading-tight">{b}</div></div>)}
              </div>
            </section>

            <section className="mt-3 rounded-[12px] border-2 p-3" style={{ borderColor: line }}>
              <div className="mx-auto w-[5.3in] rounded-[10px] border-2 bg-white text-center" style={{ borderColor: line }}>
                <div className="mx-auto -mt-1 w-[1.5in] rounded-b-[8px] px-3 py-1 text-[13px] font-black uppercase text-white" style={{ background: navy }}>Asking Price</div>
                <div className="pb-2 text-[66px] font-black leading-none tracking-tight">{fmtMoney(vehicle.price)}</div>
              </div>
            </section>
          </section>
        </main>

        <footer className="mt-auto rounded-[10px] border-2 px-4 py-2 text-center text-[10px] leading-tight text-slate-700" style={{ borderColor: line }}>{disclaimer}</footer>
      </div>
    </div>
  );
};

export default SaturdayClassicWindow;

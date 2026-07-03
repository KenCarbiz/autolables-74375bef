// Saturday Premium Addendum — 4.25" x 11" vertical addendum matching the
// approved AutoLabels.io printed goal: branded header, VEHICLE PASSPORT
// badge, bold ADDENDUM title, iconed vehicle info grid, upper-third QR
// block, green Installed Equipment, blue Included Benefits, navy Available
// Upgrades, transparent totals, trust badge row, dark branded footer. All
// icons come from the AutoLabels icon system — no generic imports.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";
import { AL_PRINT_ICONS, type AutoLabelsPrintIconKey } from "@/components/icons/AutoLabelsToolIcons";
import { getEquipmentIcon } from "@/lib/equipmentIcons";

type Line = { name: string; price: string; description?: string };
type Addendum = SaturdaySticker & { installed?: Line[]; upgrades?: Line[] };
type Props = { data: Addendum };

const T = {
  navy: "#0D1B2A", text: "#10202B", muted: "#64748B", border: "#DDE5EE",
  blue: "#0B6FEA", blueSoft: "#EAF4FF", green: "#1F7A4D", greenSoft: "#EAF6EF",
};

const money = (n: string | number): string | null => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v) || v <= 0) return null;
  return `$${Math.round(v).toLocaleString()}`;
};

const PIcon = ({ k, size = 13, color = T.blue, accent }: { k: AutoLabelsPrintIconKey; size?: number; color?: string; accent?: string }) => {
  const Icon = AL_PRINT_ICONS[k];
  return (
    <span style={{ color, ["--al-icon-accent" as string]: accent ?? color, display: "inline-flex" }}>
      <Icon width={size} height={size} />
    </span>
  );
};

// Section header bar: colored label strip with a small status tag.
const SectionBar = ({ icon, title, tag, bg, fg }: { icon: AutoLabelsPrintIconKey; title: string; tag?: string; bg: string; fg: string }) => (
  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-t-[10px]" style={{ background: bg }}>
    <span className="inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.16em]" style={{ color: fg }}>
      <PIcon k={icon} size={11} color={fg} /> {title}
    </span>
    {tag && <span className="text-[6.5px] font-black uppercase tracking-[0.12em] rounded-full px-1.5 py-0.5" style={{ background: "#ffffff", color: fg, border: `1px solid ${fg}33` }}>{tag}</span>}
  </div>
);

export const SaturdayPremiumAddendum: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, installed = [], upgrades = [], benefits, qrUrl, disclaimer } = data;
  const safeUrl = qrUrl && qrUrl.startsWith("http") ? qrUrl : qrUrl ? `https://${qrUrl}` : "https://autolabels.io";
  const num = (v: string | number) => Number(String(v).replace(/[^\d.]/g, "") || 0);
  const installedTotal = installed.reduce((s, l) => s + num(l.price), 0);
  const upgradesTotal = upgrades.reduce((s, l) => s + num(l.price), 0);
  const basePrice = num(vehicle.msrp ?? "") || num(vehicle.price);
  const priceLabel = (vehicle.msrp ? "TOTAL MSRP" : (vehicle.priceLabel || dealer.pricingLabel || "Selling Price")).toUpperCase();
  const baseDisplay = money(basePrice);
  // Vehicle title on two uppercase lines: "2027 INFINITI" / "QX60 LUXE".
  const words = (vehicle.title || "").trim().split(/\s+/);
  const line1 = words.slice(0, 2).join(" ");
  const line2 = words.slice(2).join(" ");
  const today = new Date().toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });

  const infoCell = (icon: AutoLabelsPrintIconKey, label: string, value: string | null) => (
    <div className="flex items-start gap-1.5 px-2 py-1.5">
      <span className="mt-0.5 shrink-0"><PIcon k={icon} size={12} /></span>
      <span className="min-w-0">
        <span className="block text-[6.5px] font-black uppercase tracking-[0.14em]" style={{ color: T.muted }}>{label}</span>
        <span className="block text-[9px] font-extrabold leading-tight break-all" style={{ color: T.text }}>{value || "—"}</span>
      </span>
    </div>
  );

  const lineRow = (l: Line, tone: "green" | "navy") => {
    const EqIcon = getEquipmentIcon(l.name).icon;
    const priceStr = money(l.price);
    return (
      <div key={l.name} className="flex items-center gap-1.5 px-2.5 py-[3px] border-b last:border-b-0" style={{ borderColor: "#EDF2F8" }}>
        <span className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] shrink-0" style={{ background: tone === "green" ? T.greenSoft : T.blueSoft }}>
          {tone === "green"
            ? <EqIcon width={10} height={10} style={{ color: T.green }} strokeWidth={2} />
            : <PIcon k="upgrade" size={10} color={T.navy} accent={T.blue} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[8px] font-extrabold leading-tight" style={{ color: T.text }}>{l.name}</span>
          {l.description && <span className="block text-[6.4px] leading-tight" style={{ color: T.muted }}>{l.description}</span>}
        </span>
        {priceStr && <span className="shrink-0 text-[8.5px] font-black" style={{ color: tone === "green" ? T.green : T.navy }}>{priceStr}</span>}
      </div>
    );
  };

  const TRUST: { icon: AutoLabelsPrintIconKey; t: string; s: string }[] = [
    { icon: "quality", t: "Quality Products", s: "Professionally installed for long-lasting protection" },
    { icon: "install", t: "Expert Installation", s: "Factory-trained technicians you can trust" },
    { icon: "value", t: "Added Value", s: "Enhances your driving experience and vehicle value" },
    { icon: "peace", t: "Peace of Mind", s: "Backed by our warranty and support" },
  ];
  const FOOTER_BADGES: { icon: AutoLabelsPrintIconKey; t: string }[] = [
    { icon: "ai", t: "AI Powered" }, { icon: "ftc", t: "FTC Compliant" },
    { icon: "updates", t: "Real-Time Updates" }, { icon: "print", t: "Print Ready" },
  ];
  const QR_BULLETS = ["Photos", "Service History", "Ownership Information", "Benefits", "Documents", "Protection Products"];

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "4.25in", height: "11in", fontFamily: "Inter, system-ui, sans-serif", color: T.text, boxSizing: "border-box", overflow: "hidden" }}>
      <div className="flex h-full flex-col" style={{ padding: "0.16in" }}>
        {/* Header — AutoLabels brand left, dealer info right */}
        <header className="flex items-start justify-between gap-2 pb-2 border-b" style={{ borderColor: T.border }}>
          <div className="min-w-0">
            <div className="text-[13px] font-black tracking-tight leading-none"><span style={{ color: T.blue }}>auto</span><span style={{ color: T.navy }}>labels.io</span></div>
            <div className="mt-0.5 text-[5.8px] font-bold uppercase tracking-[0.18em]" style={{ color: T.muted }}>AI-Powered Vehicle Transparency</div>
          </div>
          <div className="text-right text-[6.6px] font-semibold leading-[1.35] min-w-0" style={{ color: T.muted }}>
            <div className="text-[8px] font-black uppercase tracking-wide truncate" style={{ color: T.navy }}>{dealer.name}</div>
            {dealer.address && <div className="break-words">{dealer.address}</div>}
            {dealer.phone && <div>{dealer.phone}</div>}
            {dealer.website && <div>{dealer.website}</div>}
          </div>
        </header>

        {/* Passport badge + title block */}
        <div className="mt-2 inline-flex items-center gap-1.5">
          <PIcon k="passport" size={12} accent={T.blue} color={T.navy} />
          <span className="text-[7.5px] font-black uppercase tracking-[0.22em]" style={{ color: T.blue }}>Vehicle Passport™</span>
        </div>
        <h1 className="mt-1 text-[30px] font-black leading-none tracking-[-0.02em]" style={{ color: T.navy }}>ADDENDUM</h1>
        <div className="mt-1 text-[13px] font-black uppercase leading-[1.1] tracking-[-0.01em]" style={{ color: T.text }}>
          {line1 || "VEHICLE DETAILS"}<br />{line2 || (line1 ? "" : "PENDING")}
        </div>

        {/* Vehicle info grid */}
        <section className="mt-2 grid grid-cols-2 rounded-[10px] border" style={{ borderColor: T.border }}>
          <div className="border-b border-r" style={{ borderColor: T.border }}>{infoCell("stock", "Stock Number", vehicle.stock || null)}</div>
          <div className="border-b" style={{ borderColor: T.border }}>{infoCell("vin", "VIN", vehicle.vin || null)}</div>
          <div className="border-r" style={{ borderColor: T.border }}>{infoCell("date", "Date", today)}</div>
          {infoCell("price", priceLabel, baseDisplay ?? "See Dealer")}
        </section>

        {/* QR block — upper third */}
        <section className="mt-2 grid grid-cols-[0.82in_1fr] items-center gap-2.5 rounded-[10px] border p-2" style={{ borderColor: "#B9D4F8", background: "#F7FAFF" }}>
          <div className="rounded-[6px] bg-white p-1 border" style={{ borderColor: T.border }}>
            <QRCodeSVG value={safeUrl} size={68} bgColor="#ffffff" fgColor={T.navy} level="M" />
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] font-black uppercase leading-tight tracking-wide" style={{ color: T.blue }}>Scan to View<br />Vehicle Passport</div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-[2px]">
              {QR_BULLETS.map((b) => (
                <span key={b} className="inline-flex items-center gap-1 text-[6.6px] font-bold" style={{ color: T.text }}>
                  <PIcon k="benefit" size={8} color={T.blue} /> {b}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Installed Equipment — green */}
        <section className="mt-2 rounded-[10px] border overflow-hidden" style={{ borderColor: "#BFE3CD" }}>
          <SectionBar icon="install" title="Installed Equipment" tag="Included" bg={T.greenSoft} fg={T.green} />
          {installed.length ? installed.map((l) => lineRow(l, "green")) : (
            <div className="px-2.5 py-1.5 text-[7px] font-semibold" style={{ color: T.muted }}>No installed equipment configured.</div>
          )}
        </section>

        {/* Included Benefits — blue */}
        <section className="mt-2 rounded-[10px] border overflow-hidden" style={{ borderColor: "#BBD8F5" }}>
          <SectionBar icon="benefit" title="Included Benefits" bg={T.blueSoft} fg={T.blue} />
          {benefits.length ? (
            <div className="px-2.5 py-1.5 grid grid-cols-1 gap-[3px]">
              {benefits.slice(0, 6).map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5 text-[7.6px] font-bold leading-tight" style={{ color: T.text }}>
                  <PIcon k="benefit" size={10} color={T.blue} /> {b}
                </span>
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-1.5 text-[7px] font-semibold" style={{ color: T.muted }}>No configured benefits.</div>
          )}
        </section>

        {/* Available Upgrades — navy, NOT INSTALLED */}
        {upgrades.length > 0 && (
          <section className="mt-2 rounded-[10px] border overflow-hidden" style={{ borderColor: T.border }}>
            <SectionBar icon="upgrade" title="Available Upgrades" tag="Not Installed" bg="#F2F5FA" fg={T.navy} />
            {upgrades.map((l) => lineRow(l, "navy"))}
          </section>
        )}

        {/* Totals — transparent, no giant hero $0 */}
        <section className="mt-2 grid grid-cols-[1fr_1.2fr] rounded-[10px] border overflow-hidden" style={{ borderColor: T.border }}>
          <div className="p-2 border-r" style={{ borderColor: T.border }}>
            <div className="text-[6.8px] font-black uppercase tracking-[0.14em]" style={{ color: T.muted }}>{priceLabel}</div>
            <div className="mt-0.5 font-black leading-none tracking-tight" style={{ color: T.navy, fontSize: baseDisplay ? "20px" : "11px" }}>{baseDisplay ?? "See Dealer for Pricing"}</div>
          </div>
          <div className="p-2">
            <div className="flex justify-between text-[7.6px] font-bold" style={{ color: T.text }}>
              <span>Total Installed Value</span><span style={{ color: T.green }}>{money(installedTotal) ?? "$0"}</span>
            </div>
            {upgrades.length > 0 && (
              <div className="flex justify-between text-[7.6px] font-bold mt-[2px]" style={{ color: T.text }}>
                <span>Total Available Upgrades</span><span style={{ color: T.navy }}>{money(upgradesTotal) ?? "$0"}</span>
              </div>
            )}
            <div className="mt-1 text-[6px] font-semibold" style={{ color: T.muted }}>Available upgrades not included in total.</div>
          </div>
        </section>

        {/* Disclaimer */}
        {disclaimer && <p className="mt-1.5 text-[5.9px] leading-snug" style={{ color: T.muted }}>{disclaimer}</p>}

        {/* Trust badge row */}
        <section className="mt-auto grid grid-cols-4 gap-1.5 pt-2">
          {TRUST.map((t) => (
            <div key={t.t} className="flex flex-col items-center text-center gap-0.5">
              <PIcon k={t.icon} size={16} color={T.navy} accent={T.blue} />
              <span className="text-[6px] font-black uppercase tracking-wide leading-tight" style={{ color: T.navy }}>{t.t}</span>
              <span className="text-[5.4px] leading-[1.25]" style={{ color: T.muted }}>{t.s}</span>
            </div>
          ))}
        </section>

        {/* Dark branded footer */}
        <footer className="mt-2 flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5" style={{ background: T.navy }}>
          <span className="text-[7px] font-bold text-white/90">Powered by <span className="font-black text-white">autolabels.io</span></span>
          <span className="flex items-center gap-2.5">
            {FOOTER_BADGES.map((b) => (
              <span key={b.t} className="flex flex-col items-center gap-[1px]">
                <PIcon k={b.icon} size={10} color="#ffffff" accent="#9DBDF8" />
                <span className="text-[4.8px] font-bold text-white/85 whitespace-nowrap">{b.t}</span>
              </span>
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
};

export default SaturdayPremiumAddendum;

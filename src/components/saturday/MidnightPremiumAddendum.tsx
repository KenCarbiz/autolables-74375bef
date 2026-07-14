// Saturday Premium Addendum — 4.25" x 11" vertical addendum matching the
// approved AutoLabels.io printed goal: branded header, VEHICLE PASSPORT
// badge, bold ADDENDUM title, iconed vehicle info grid, upper-third QR
// block, green Installed Equipment, blue Included Benefits, purple
// Available Upgrades, weighted totals, trust badge band, dark branded
// footer. All icons come from the AutoLabels Addendum Icon Library.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";
import {
  AutoLabelsAddendumIcon, resolveAddendumProductIcon, getAddendumIconColor,
  type AddendumIconKey,
} from "@/components/icons/AutoLabelsAddendumIcons";

type Line = { name: string; price: string; description?: string; iconKey?: string };
type Addendum = SaturdaySticker & { installed?: Line[]; upgrades?: Line[] };
type Props = { data: Addendum };

const T = {
  navy: "#0D1B2A", text: "#10202B", muted: "#64748B", border: "#DDE5EE",
  blue: "#0B6FEA", blueSoft: "#EAF4FF", green: "#1F7A4D", greenSoft: "#EAF6EF",
  purple: "#6D28D9", purpleSoft: "#F4ECFF", gold: "#B45309",
};

const money = (n: string | number): string | null => {
  const v = typeof n === "string" ? parseFloat(n.replace(/[^\d.]/g, "")) : n;
  if (!Number.isFinite(v) || v <= 0) return null;
  return `$${Math.round(v).toLocaleString()}`;
};

// Section header band: tinted strip with a white icon badge, status tag,
// and an optional right-aligned section total.
const SectionBar = ({ icon, title, tag, total, bg, fg }: { icon: AddendumIconKey; title: string; tag?: string; total?: string | null; bg: string; fg: string }) => (
  <div className="flex items-center justify-between gap-1.5 px-2.5 py-[7px] rounded-t-[10px]" style={{ background: bg }}>
    <span className="inline-flex items-center gap-1.5 min-w-0 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: fg }}>
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white shrink-0" style={{ border: `1px solid ${fg}2e` }}>
        <AutoLabelsAddendumIcon iconKey={icon} size={11} color={fg} />
      </span>
      <span className="truncate">{title}</span>
      {tag && <span className="shrink-0 text-[6.4px] font-black uppercase tracking-[0.1em] rounded-full px-1.5 py-[2px]" style={{ background: "#ffffff", color: fg, border: `1px solid ${fg}33` }}>{tag}</span>}
    </span>
    {total && <span className="shrink-0 text-[8.6px] font-black uppercase tracking-wide" style={{ color: fg }}><span className="text-[6.6px] tracking-[0.12em] mr-1">Total</span>{total}</span>}
  </div>
);

export const MidnightPremiumAddendum: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, installed = [], upgrades = [], benefits, qrUrl, disclaimer } = data;
  // Accent follows the dealer theme (populated by toSaturdaySticker from
  // branding.accentColor). Neutrals (navy, slate) stay fixed; installed
  // green and upgrades purple keep their semantic meaning.
  const accent = dealer.theme?.accentColor || "#0B6FEA";
  const accentSoft = `${accent}14`;
  const accentBorder = `${accent}40`;
  const safeUrl = qrUrl && qrUrl.startsWith("http") ? qrUrl : qrUrl ? `https://${qrUrl}` : "https://autolabels.io";
  const num = (v: string | number) => Number(String(v).replace(/[^\d.]/g, "") || 0);
  const installedTotal = installed.reduce((s, l) => s + num(l.price), 0);
  const upgradesTotal = upgrades.reduce((s, l) => s + num(l.price), 0);
  const basePrice = num(vehicle.msrp ?? "") || num(vehicle.price);
  const priceLabel = (vehicle.msrp ? "MSRP (Base Price)" : (vehicle.priceLabel || dealer.pricingLabel || "Selling Price")).toUpperCase();
  const baseDisplay = money(basePrice);
  // Pricing rule: installed equipment always adds to vehicle value. The
  // adjusted total is base + installed, every time; available upgrades stay
  // out of the total because they are optional and not on the vehicle.
  const adjustedTotal = basePrice > 0 ? basePrice + installedTotal : 0;
  const adjustedDisplay = money(adjustedTotal);
  // Vehicle title on two uppercase lines: "2027 INFINITI" / "QX60 LUXE".
  const words = (vehicle.title || "").trim().split(/\s+/);
  const line1 = words.slice(0, 2).join(" ");
  const line2 = words.slice(2).join(" ");
  const today = new Date().toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });

  const infoCell = (icon: AddendumIconKey, label: string, value: string | null, mono = false) => (
    <div className="flex items-center gap-2 px-2.5 py-[9px]">
      <span className="flex h-[24px] w-[24px] items-center justify-center rounded-[7px] shrink-0" style={{ background: accentSoft }}>
        <AutoLabelsAddendumIcon iconKey={icon} size={15} color={T.navy} />
      </span>
      <span className="min-w-0">
        <span className="block text-[6.8px] font-black uppercase tracking-[0.13em]" style={{ color: T.muted }}>{label}</span>
        <span className={`block font-extrabold leading-tight break-all ${mono ? "text-[9px]" : "text-[10.5px]"}`} style={{ color: T.text }}>{value || "—"}</span>
      </span>
    </div>
  );

  const lineRow = (l: Line, tone: "green" | "purple") => {
    const ctx = tone === "green" ? "installed" as const : "upgrade" as const;
    const iconKey = resolveAddendumProductIcon(l.name, l.iconKey);
    const fg = getAddendumIconColor(iconKey, ctx);
    const priceStr = money(l.price);
    return (
      <div key={l.name} className="flex items-center gap-2 px-2.5 py-[6px] border-b last:border-b-0" style={{ borderColor: "#EDF2F8" }}>
        <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] shrink-0" style={{ background: tone === "green" ? T.greenSoft : T.purpleSoft }}>
          <AutoLabelsAddendumIcon iconKey={iconKey} size={13} color={fg} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9.5px] font-extrabold leading-tight" style={{ color: T.text }}>{l.name}</span>
          {l.description && <span className="block text-[7px] font-medium leading-tight mt-[1px]" style={{ color: T.muted }}>{l.description}</span>}
        </span>
        {priceStr && <span className="shrink-0 text-[10px] font-black" style={{ color: tone === "green" ? T.green : T.purple }}>{priceStr}</span>}
      </div>
    );
  };

  const TRUST: { icon: AddendumIconKey; t: string; s: string }[] = [
    { icon: "quality-products", t: "Quality Products", s: "Professionally installed for long-lasting protection" },
    { icon: "expert-installation", t: "Expert Installation", s: "Factory-trained technicians you can trust" },
    { icon: "added-value", t: "Added Value", s: "Enhances your driving experience and vehicle value" },
    { icon: "peace-of-mind", t: "Peace of Mind", s: "Backed by our warranty and support" },
  ];
  const FOOTER_BADGES: { icon: AddendumIconKey; t: string }[] = [
    { icon: "ai-powered", t: "AI Powered" }, { icon: "ftc-aligned", t: "FTC Aligned" },
    { icon: "real-time-updates", t: "Real-Time Updates" }, { icon: "print-ready", t: "Print Ready" },
  ];
  const QR_BULLETS = ["Photos", "Service History", "Ownership Information", "Benefits", "Documents", "Protection Products"];

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "4.25in", height: "11in", fontFamily: "Inter, system-ui, sans-serif", color: T.text, boxSizing: "border-box", overflow: "hidden" }}>
      <div className="flex h-full flex-col" style={{ padding: "0.17in" }}>
        {/* Header — anchored AutoLabels lockup left, dealer block right of a vertical divider */}
        <header className="flex items-stretch justify-between gap-2.5 pb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <AutoLabelsAddendumIcon iconKey="autolabels-powered" size={20} color={accent} />
            <span>
              <span className="block text-[15px] font-black tracking-tight leading-none"><span style={{ color: accent }}>auto</span><span style={{ color: T.navy }}>labels.io</span></span>
              <span className="block mt-[3px] text-[6px] font-bold uppercase tracking-[0.16em]" style={{ color: T.muted }}>AI-Powered Vehicle Transparency</span>
            </span>
          </div>
          <div className="text-right text-[7.2px] font-semibold leading-[1.4] min-w-0 pl-2.5" style={{ color: T.muted, borderLeft: `1px solid ${T.border}` }}>
            <div className="text-[9px] font-black uppercase tracking-wide truncate" style={{ color: T.navy }}>{dealer.name}</div>
            {dealer.address && <div className="break-words">{dealer.address}</div>}
            {dealer.phone && <div>{dealer.phone}</div>}
            {dealer.website && <div>{dealer.website}</div>}
          </div>
        </header>

        {/* Passport badge + hero title stack */}
        <div className="mt-2.5 inline-flex items-center gap-1.5">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full shrink-0" style={{ background: accentSoft }}>
            <AutoLabelsAddendumIcon iconKey="vehicle-passport" size={12} color={T.navy} />
          </span>
          <span className="text-[8.5px] font-black uppercase tracking-[0.2em]" style={{ color: accent }}>Vehicle Passport™</span>
        </div>
        <h1 className="mt-1 text-[34px] font-black leading-[0.95] tracking-[-0.02em]" style={{ color: T.navy }}>ADDENDUM</h1>
        <div className="mt-1.5 text-[15px] font-black uppercase leading-[1.12] tracking-[-0.01em]" style={{ color: T.text }}>
          {line1 || "VEHICLE DETAILS"}<br />{line2 || (line1 ? "" : "PENDING")}
        </div>

        {/* Vehicle info grid */}
        <section className="mt-2.5 grid grid-cols-2 rounded-[10px] border" style={{ borderColor: T.border }}>
          <div className="border-b border-r" style={{ borderColor: T.border }}>{infoCell("stock-number", "Stock Number", vehicle.stock || null)}</div>
          <div className="border-b" style={{ borderColor: T.border }}>{infoCell("vin", "VIN", vehicle.vin || null, true)}</div>
          <div className="border-r" style={{ borderColor: T.border }}>{infoCell("date", "Date", today)}</div>
          {infoCell("price-msrp", priceLabel, baseDisplay ?? "See Dealer")}
        </section>

        {/* QR block — a major engagement point in the upper third */}
        <section className="mt-2.5 grid grid-cols-[1in_1fr] items-center gap-3 rounded-[10px] border p-2.5" style={{ borderColor: accentBorder, background: accentSoft }}>
          <div className="rounded-[7px] bg-white p-1.5 border" style={{ borderColor: T.border }}>
            <QRCodeSVG value={safeUrl} size={84} bgColor="#ffffff" fgColor={T.navy} level="M" style={{ width: "100%", height: "auto" }} />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-black uppercase leading-[1.15] tracking-wide" style={{ color: accent }}>Scan to View<br />Vehicle Passport</div>
            <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-[5px]">
              {QR_BULLETS.map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5 text-[7.4px] font-bold leading-tight" style={{ color: T.text }}>
                  <AutoLabelsAddendumIcon iconKey="ftc-aligned" size={10} color={accent} /> {b}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Installed Equipment — green */}
        <section className="mt-2.5 rounded-[10px] border overflow-hidden" style={{ borderColor: "#BFE3CD" }}>
          <SectionBar icon="protection-products" title="Installed Equipment" tag="Included" total={money(installedTotal)} bg={T.greenSoft} fg={T.green} />
          {installed.length ? installed.map((l) => lineRow(l, "green")) : (
            <div className="px-2.5 py-2 text-[7.6px] font-semibold" style={{ color: T.muted }}>No installed equipment configured.</div>
          )}
        </section>

        {/* Included Benefits — blue */}
        <section className="mt-2.5 rounded-[10px] border overflow-hidden" style={{ borderColor: "#BBD8F5" }}>
          <SectionBar icon="benefits" title="Included Benefits" bg={accentSoft} fg={accent} />
          {benefits.length ? (
            <div className="px-2.5 py-2 grid grid-cols-1 gap-[5px]">
              {benefits.slice(0, 6).map((b) => (
                <span key={b} className="inline-flex items-center gap-2 text-[8.6px] font-bold leading-tight" style={{ color: T.text }}>
                  <AutoLabelsAddendumIcon iconKey="ftc-aligned" size={11} color={accent} /> {b}
                </span>
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[7.6px] font-semibold" style={{ color: T.muted }}>No configured benefits.</div>
          )}
        </section>

        {/* Available Upgrades — purple, NOT INSTALLED */}
        {upgrades.length > 0 && (
          <section className="mt-2.5 rounded-[10px] border overflow-hidden" style={{ borderColor: "#DCCBF5" }}>
            <SectionBar icon="remote-start" title="Available Upgrades" tag="Not Installed" total={money(upgradesTotal)} bg={T.purpleSoft} fg={T.purple} />
            {upgrades.map((l) => lineRow(l, "purple"))}
          </section>
        )}

        {/* Totals — installed equipment always adds to vehicle value. Left:
            the adjusted total with real gravity; right: the arithmetic a
            customer can follow line by line. */}
        <section className="mt-2.5 grid grid-cols-[1fr_1.3fr] rounded-[10px] border-2 overflow-hidden" style={{ borderColor: T.navy }}>
          <div className="px-2.5 py-2.5 border-r flex flex-col justify-center" style={{ borderColor: T.border }}>
            <div className="text-[7.4px] font-black uppercase tracking-[0.14em]" style={{ color: T.gold }}>Adjusted Total</div>
            <div className="mt-1 font-black leading-none tracking-tight" style={{ color: T.gold, fontSize: adjustedDisplay ? "24px" : "11px" }}>{adjustedDisplay ?? "See Dealer for Pricing"}</div>
            <div className="mt-1 text-[6.2px] font-bold" style={{ color: T.muted }}>Base Price + Installed Equipment</div>
          </div>
          <div className="px-2.5 py-2 flex flex-col justify-center">
            <div className="flex justify-between text-[8.2px] font-bold" style={{ color: T.text }}>
              <span>Base Vehicle Price</span><span>{baseDisplay ?? "See Dealer"}</span>
            </div>
            <div className="flex justify-between text-[8.2px] font-bold mt-[3px]" style={{ color: T.text }}>
              <span>Installed Equipment Value</span><span style={{ color: T.green }}>+ {money(installedTotal) ?? "$0"}</span>
            </div>
            <div className="flex justify-between text-[8.6px] font-black mt-[3px] pt-[3px] border-t" style={{ color: T.text, borderColor: T.border }}>
              <span>Adjusted Total <span className="font-bold text-[6.4px]" style={{ color: T.muted }}>(Includes Installed)</span></span>
              <span style={{ color: T.gold }}>{adjustedDisplay ?? "—"}</span>
            </div>
            {upgrades.length > 0 && (
              <div className="flex justify-between text-[8.2px] font-bold mt-[4px]" style={{ color: T.text }}>
                <span>Available Upgrades Total</span><span style={{ color: T.purple }}>{money(upgradesTotal) ?? "$0"}</span>
              </div>
            )}
            <div className="mt-1 text-[6.2px] font-semibold italic" style={{ color: T.muted }}>Available upgrades not included in total.</div>
          </div>
        </section>

        {/* Disclaimer */}
        {disclaimer && <p className="mt-2 text-[6.4px] leading-snug" style={{ color: T.muted }}>{disclaimer}</p>}

        {/* Trust badge band — a meaningful benefit row above the footer */}
        <section className="mt-auto grid grid-cols-4 pt-2.5 pb-1.5">
          {TRUST.map((t, i) => (
            <div key={t.t} className="flex flex-col items-center text-center gap-1 px-1.5" style={i > 0 ? { borderLeft: `1px solid ${T.border}` } : undefined}>
              <AutoLabelsAddendumIcon iconKey={t.icon} size={20} color={T.navy} />
              <span className="text-[6.8px] font-black uppercase tracking-wide leading-tight" style={{ color: T.navy }}>{t.t}</span>
              <span className="text-[5.8px] font-medium leading-[1.3]" style={{ color: T.muted }}>{t.s}</span>
            </div>
          ))}
        </section>

        {/* Dark branded footer */}
        <footer className="mt-2 flex items-center justify-between gap-2.5 rounded-[9px] px-3 py-2.5" style={{ background: T.navy }}>
          <span className="flex items-center gap-1.5 min-w-0">
            <AutoLabelsAddendumIcon iconKey="autolabels-powered" size={15} variant="light" />
            <span className="min-w-0">
              <span className="block text-[5.4px] font-bold uppercase tracking-[0.18em] text-white/70">Powered by</span>
              <span className="block text-[9.5px] font-black leading-tight text-white">autolabels.io</span>
            </span>
          </span>
          <span className="flex items-center gap-3.5">
            {FOOTER_BADGES.map((b) => (
              <span key={b.t} className="flex flex-col items-center gap-[2px]">
                <AutoLabelsAddendumIcon iconKey={b.icon} size={12} variant="light" />
                <span className="text-[5.2px] font-bold text-white/85 whitespace-nowrap">{b.t}</span>
              </span>
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
};

export default MidnightPremiumAddendum;

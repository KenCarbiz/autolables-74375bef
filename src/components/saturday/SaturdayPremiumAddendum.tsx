// Saturday Premium Addendum (V2) — 4.5" x 11" vertical addendum.
//
// Top to bottom: dealership masthead, VEHICLE PASSPORT badge, ADDENDUM beside
// the vehicle identity on one band, iconed vehicle grid, upper-third QR panel,
// green installed equipment, purple available upgrades, dealer value
// propositions, weighted totals, trust band, dark branded footer. All icons
// come from the AutoLabels Addendum Icon Library.
//
// V2 dropped the standalone benefits panel; see v2Sections below.

import { QRCodeSVG } from "qrcode.react";
import type { SaturdaySticker } from "./types";
import {
  AutoLabelsAddendumIcon, resolveAddendumProductIcon, getAddendumIconColor,
  type AddendumIconKey,
} from "@/components/icons/AutoLabelsAddendumIcons";
import { resolveAddendumSections, valuePropImageCeiling, addendumDensity } from "./addendumSections";
import { AddendumDealerMasthead, AddendumPoweredBy, addendumDealerName, mastheadShowsLogo } from "./AddendumBrandBlocks";
import { AddendumIconTileV2, AddendumIconV2, AddendumCheckV2 } from "@/components/icons/AddendumIconSystemV2";

type Line = { name: string; price: string; description?: string; iconKey?: string };
type Addendum = SaturdaySticker & { installed?: Line[]; upgrades?: Line[] };
type Props = { data: Addendum };

// Widths for the value-proposition artwork. The HEIGHT is no longer fixed
// here: a fixed height meant a tall promotional image claimed its inches
// before the equipment, benefit and upgrade rows were laid out, and on an
// 11-inch page with `overflow: hidden` whatever did not fit was cropped in
// silence. Height is now a ceiling (see valuePropImageCeiling) inside a flex
// track that can hand the image less.
const VP_IMAGE_WIDTH: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "max-w-[1.1in]",
  md: "max-w-[1.6in]",
  lg: "max-w-[2.2in]",
  xl: "max-w-[2.9in]",
};


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

export const SaturdayPremiumAddendum: React.FC<Props> = ({ data }) => {
  const { dealer, vehicle, qrUrl, disclaimer } = data;
  // Section visibility is resolved once, from stored data only, and shared with
  // the print and PDF paths so a section cannot appear in one and not another.
  const sections = resolveAddendumSections(data);
  const { installed, upgrades, valueProps } = sections;
  // Spacing tightens before anything is cropped; see addendumDensity.
  // V2 drops the standalone Included Benefits panel: the one benefit it carried
  // for most dealers — lifetime powertrain — is already the subject of its own
  // value-proposition panel below, and printing it twice cost an inch of a
  // sheet with a hard ceiling. Stored benefit data is untouched; only this
  // template stops rendering the box. Density is recomputed without those rows
  // so the artwork and spacing are not still budgeting for them.
  const v2Sections = { ...sections, benefits: [], hasBenefits: false };
  const density = addendumDensity(v2Sections);
  // Accent follows the dealer theme (populated by toSaturdaySticker from
  // branding.accentColor). Neutrals (navy, slate) stay fixed; installed
  // green and upgrades purple keep their semantic meaning.
  // The masthead prints the dealership's logo when they have one; the contact
  // block then drops the name so it is not stated twice.
  const showLogo = mastheadShowsLogo(dealer);
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
  // The vehicle sits beside ADDENDUM on one band, so its type has to answer to
  // the longest of the two lines rather than to a fixed size. Steps down, never
  // truncates: a trim the customer cannot read is not a shorter title.
  const titleSize = (() => {
    const longest = Math.max(line1.length, line2.length);
    const steps = ["text-[10px]", "text-[11px]", "text-[13px]", "text-[15.5px]"];
    const i = (longest > 22 ? 1 : longest > 17 ? 2 : 3) - (density.compact ? 1 : 0);
    return steps[Math.max(0, i)];
  })();


  const infoCell = (icon: AddendumIconKey, label: string, value: string | null, mono = false) => (
    <div className={`flex items-center gap-2 px-2.5 ${density.compact ? "py-[6px]" : "py-[9px]"}`}>
      <AddendumIconTileV2 iconKey={icon} tone="info" size={density.compact ? 26 : 32} />
      <span className="min-w-0">
        <span className="block text-[6.8px] font-black uppercase tracking-[0.13em]" style={{ color: T.muted }}>{label}</span>
        <span className={`block font-extrabold leading-tight break-all ${mono ? "text-[9px]" : "text-[10.5px]"}`} style={{ color: T.text }}>{value || "—"}</span>
      </span>
    </div>
  );

  const lineRow = (l: Line, tone: "green" | "purple") => {
    const iconKey = resolveAddendumProductIcon(l.name, l.iconKey);
    const priceStr = money(l.price);
    return (
      <div key={l.name} className={`flex items-center gap-2 px-2.5 border-b last:border-b-0 ${density.compact ? "py-[3.5px]" : "py-[6px]"}`} style={{ borderColor: "#EDF2F8" }}>
        <AddendumIconTileV2 iconKey={iconKey} tone={tone === "green" ? "included" : "upgrade"} size={density.compact ? 20 : 24} />
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
    { icon: "real-time-updates", t: "Real-Time Updates" },
  ];
  const QR_BULLETS = ["Photos", "Service History", "Ownership Information", "Benefits", "Documents", "Protection Products"];

  return (
    <div className="bg-white shadow-2xl ring-1 ring-slate-200 print:shadow-none" style={{ width: "4.5in", height: "11in", fontFamily: "Inter, system-ui, sans-serif", color: T.text, boxSizing: "border-box", overflow: "hidden" }}>
      <div className="flex h-full flex-col" style={{ padding: "0.17in" }}>
        {/* Masthead — the dealership's logo is the page's primary branding and
            gets the room to read as such; their contact block sits right of a
            hairline, deliberately subordinate. AutoLabels is footer-only. */}
        <header className="shrink-0 flex items-center justify-between gap-3 pb-1">
          <div className="flex items-center min-w-0 flex-1">
            <AddendumDealerMasthead dealer={dealer} navy={T.navy} muted={T.muted} size={density.compact ? "md" : "lg"} />
          </div>
          <div className="text-right text-[7.4px] font-medium leading-[1.5] shrink-0 max-w-[1.85in] pl-2.5" style={{ color: T.muted, borderLeft: `1px solid ${T.border}` }}>
            {showLogo && <div className="text-[9.2px] font-black uppercase tracking-wide leading-[1.25] break-words mb-[1px]" style={{ color: T.navy }}>{addendumDealerName(dealer)}</div>}
            {dealer.address && <div className="break-words">{dealer.address}</div>}
            {dealer.addressLine2 && <div className="break-words">{dealer.addressLine2}</div>}
            {dealer.phone && <div>{dealer.phone}</div>}
            {dealer.website && <div className="break-all">{dealer.website}</div>}
          </div>
        </header>

        {/* Vehicle Passport — the platform's branded element, given real
            presence in V2 but still second to the dealership's own logo. */}
        {/* V2's enlarged branding is the first thing to give height back. A
            dealer with 13 priced rows still gets a whole sheet: the masthead,
            this badge, the title and the QR all step down long before a row,
            the totals or the footer are allowed off the page. */}
        <div className={`shrink-0 ${density.compact ? "mt-0.5" : "mt-1"} inline-flex items-center gap-2`}>
          <span
            className={`flex items-center justify-center rounded-full shrink-0 ${density.compact ? "h-[18px] w-[18px]" : "h-[24px] w-[24px]"}`}
            style={{ background: accentSoft }}
          >
            <AutoLabelsAddendumIcon iconKey="vehicle-passport" size={density.compact ? 12 : 16} color={T.navy} />
          </span>
          <span className={`font-black uppercase tracking-[0.17em] ${density.compact ? "text-[9.9px]" : "text-[13.75px]"}`} style={{ color: accent }}>Vehicle Passport™</span>
        </div>

        {/* ADDENDUM and the vehicle share one horizontal band, split by a
            hairline. Stacked, they cost an inch of height and said no more.
            The vehicle side is dynamic, so its type steps down for a long
            name instead of forcing the divider off a 4.5-inch sheet. */}
        <div className="shrink-0 mt-1.5 flex items-stretch gap-2.5">
          <h1 className={`shrink-0 font-black leading-[0.92] tracking-[-0.03em] ${density.compact ? "text-[26px]" : "text-[33px]"}`} style={{ color: T.navy }}>ADDENDUM</h1>
          <div className="w-px shrink-0 self-stretch" style={{ background: T.border }} />
          <div className={`min-w-0 flex flex-col justify-center font-black uppercase leading-[1.06] tracking-[-0.015em] ${titleSize}`} style={{ color: T.text }}>
            <span className="block break-words">{line1 || "VEHICLE DETAILS"}</span>
            {(line2 || !line1) && <span className="block break-words">{line2 || "PENDING"}</span>}
          </div>
        </div>

        {/* Vehicle info grid */}
        <section className={`shrink-0 ${density.sectionGap} grid grid-cols-2 rounded-[10px] border`} style={{ borderColor: T.border }}>
          <div className="border-b border-r" style={{ borderColor: T.border }}>{infoCell("stock-number", "Stock Number", vehicle.stock || null)}</div>
          <div className="border-b" style={{ borderColor: T.border }}>{infoCell("vin", "VIN", vehicle.vin || null, true)}</div>
          <div className="border-r" style={{ borderColor: T.border }}>{infoCell("date", "Date", today)}</div>
          {infoCell("price-msrp", priceLabel, baseDisplay ?? "See Dealer")}
        </section>

        {/* QR block — a major engagement point in the upper third */}
        <section
          className={`shrink-0 ${density.sectionGap} grid items-center gap-3 rounded-[10px] border p-2.5 ${density.compact ? "grid-cols-[0.92in_1fr]" : "grid-cols-[1.18in_1fr]"}`}
          style={{ borderColor: accentBorder, background: accentSoft }}
        >
          {/* The QR is the point of this panel: it has to survive being read
              through glass from arm's length, so it takes the extra width the
              wider sheet freed up rather than the copy beside it. */}
          <div className="rounded-[7px] bg-white p-1.5 border" style={{ borderColor: T.border }}>
            <QRCodeSVG value={safeUrl} size={density.compact ? 78 : 100} bgColor="#ffffff" fgColor={T.navy} level="M" style={{ width: "100%", height: "auto" }} />
          </div>
          <div className="min-w-0">
            <div className={`font-black uppercase leading-[1.1] tracking-[0.01em] ${density.compact ? "text-[11px]" : "text-[14px]"}`} style={{ color: accent }}>Scan to View<br />Your Vehicle Passport</div>
            <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-[5px]">
              {QR_BULLETS.map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5 text-[7.4px] font-bold leading-tight" style={{ color: T.text }}>
                  <AddendumCheckV2 size={10} color={accent} /> {b}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Installed Equipment — green. Absent, not empty, when unconfigured:
            a heading-only box is dead weight on a page with a hard ceiling. */}
        {sections.hasInstalled && (
          <section className={`shrink-0 ${density.sectionGap} rounded-[10px] border overflow-hidden`} style={{ borderColor: "#BFE3CD" }}>
            <SectionBar icon="protection-products" title="Installed Equipment" tag="Included" total={money(installedTotal)} bg={T.greenSoft} fg={T.green} />
            {installed.map((l) => lineRow(l, "green"))}
          </section>
        )}


        {/* Available Upgrades — purple, NOT INSTALLED */}
        {sections.hasUpgrades && (
          <section className={`shrink-0 ${density.sectionGap} rounded-[10px] border overflow-hidden`} style={{ borderColor: "#DCCBF5" }}>
            <SectionBar icon="remote-start" title="Available Upgrades" tag="Not Installed" total={money(upgradesTotal)} bg={T.purpleSoft} fg={T.purple} />
            {upgrades.map((l) => lineRow(l, "purple"))}
          </section>
        )}


        {/* Value propositions — the dealership's own programs, merchandised.
            The claim and its disclosure travel together so the disclosure can
            never be dropped from a printed document. */}
        {sections.hasValueProps && density.artworkFits && (
          // flex-1 with min-h-0: this block takes the slack the structured
          // sections leave, and — crucially — is the only thing that gives
          // space back when they need more. Centred, not top-anchored: when the
          // page is light the leftover height splits above and below the
          // artwork instead of becoming one dead band above the totals.
          <section className={`${density.sectionGap} space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col justify-center`} data-overflow-risk={density.overflowRisk || undefined}>
            {valueProps.map((vp) => (
              <div key={vp.id} className={`rounded-[10px] border-2 px-2.5 py-2 min-h-0 ${vp.displayStyle === "image" ? "block" : "flex items-center gap-2.5"}`} style={{ borderColor: T.navy }}>
                {vp.imageUrl && vp.displayStyle !== "banner" ? (
                  <img
                    src={vp.imageUrl}
                    alt=""
                    crossOrigin="anonymous"
                    // h-auto + a max-height ceiling: the artwork keeps its
                    // aspect ratio and is never stretched, cropped, or allowed
                    // to push a priced row off the sheet.
                    style={{ maxHeight: valuePropImageCeiling(vp.imageScale, v2Sections) }}
                    className={`h-auto w-auto object-contain ${VP_IMAGE_WIDTH[vp.imageScale || "sm"]} ${vp.displayStyle === "image" ? "mx-auto max-w-full" : "shrink"}`}
                  />
                ) : null}
                {vp.displayStyle !== "image" && (
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-black uppercase leading-tight tracking-[-0.01em]" style={{ color: T.navy }}>{vp.headline}</div>
                    {vp.supportingLine && <div className="text-[8px] font-semibold leading-tight" style={{ color: T.muted }}>{vp.supportingLine}</div>}
                    {vp.showAskForDetails && <div className="mt-[2px] text-[7px] font-black uppercase tracking-[0.14em]" style={{ color: accent }}>Ask for details</div>}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Totals — installed equipment always adds to vehicle value. Left:
            the adjusted total with real gravity; right: the arithmetic a
            customer can follow line by line. */}
        <section className="shrink-0 mt-2.5 grid grid-cols-[1fr_1.3fr] rounded-[10px] border-2 overflow-hidden" style={{ borderColor: T.navy }}>
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
        {valueProps.some((vp) => vp.disclosure) && (
          <p className="mt-1.5 text-[6.4px] leading-snug" style={{ color: T.muted }}>
            {valueProps.map((vp) => vp.disclosure).filter(Boolean).join(" ")}
          </p>
        )}


        {/* Trust badge band — a meaningful benefit row above the footer */}
        <section className={`shrink-0 mt-auto grid grid-cols-4 ${density.compact ? "pt-1.5 pb-1" : "pt-2.5 pb-1.5"}`}>
          {TRUST.map((t, i) => (
            <div key={t.t} className="flex flex-col items-center text-center gap-1 px-1.5" style={i > 0 ? { borderLeft: `1px solid ${T.border}` } : undefined}>
              <AddendumIconV2 iconKey={t.icon} size={20} color={T.navy} />
              <span className="text-[6.8px] font-black uppercase tracking-wide leading-tight" style={{ color: T.navy }}>{t.t}</span>
              <span className="text-[5.8px] font-medium leading-[1.3]" style={{ color: T.muted }}>{t.s}</span>
            </div>
          ))}
        </section>

        {/* Dark branded footer */}
        <footer className={`shrink-0 ${density.compact ? "mt-1 py-1.5" : "mt-2 py-2.5"} flex items-center justify-between gap-2.5 rounded-[9px] px-3`} style={{ background: T.navy }}>
          <AddendumPoweredBy />
          <span className="flex flex-1 items-center justify-evenly gap-2 pl-2">
            {FOOTER_BADGES.map((b) => (
              <span key={b.t} className="inline-flex items-center gap-[3px]">
                <AddendumIconV2 iconKey={b.icon} size={9} color="#FFFFFF" />
                <span className="text-[5.6px] font-bold text-white/85 whitespace-nowrap">{b.t}</span>
              </span>
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
};

export default SaturdayPremiumAddendum;

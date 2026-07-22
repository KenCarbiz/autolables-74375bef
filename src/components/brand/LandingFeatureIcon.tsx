// ──────────────────────────────────────────────────────────────────────
// LandingFeatureIcon — the single, consistent icon system for the public
// landing page. Replaces the glossy AI-generated blue tile artwork.
//
// One softly-rounded #EFF6FF tile with a 1px #BFDBFE border and a crisp
// stroke glyph (#2563EB, ~1.9px on a 24 grid, round caps/joins). No gradient,
// glow, bevel, or 3D. Every glyph is drawn on the same 24 viewBox with the
// same stroke so the whole family reads as one illustrator's set. Glyph
// compositions follow the approved reference sheet (2026-07-22).
//
// Sizes are explicit (never inherited) so an icon never shrinks when its
// adjoining label wraps:
//   hero      → 56×56 tile / 32 glyph desktop · 50×50 / 28 mobile
//   card      → 52×52 tile / 30 glyph desktop · 48×48 / 28 mobile
//   workflow  → 52×52 tile / 30 glyph desktop · 48×48 / 28 mobile
// ──────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";

export type LandingGlyphName =
  | "qrPassport" | "routedLead" | "digitalSignature" | "priceReconciliation"
  | "ftcAddendum" | "tamperEvident" | "sellAddons" | "ownYourPrice"
  | "auditDefense" | "decode" | "stick" | "close" | "vehicleArrives"
  | "getReadyQueue" | "installProof" | "foremanSignoff" | "rightStickerOut";

type Variant = "hero" | "card" | "workflow";

const TILE: Record<Variant, string> = {
  hero: "h-[50px] w-[50px] min-h-[50px] min-w-[50px] lg:h-[56px] lg:w-[56px] lg:min-h-[56px] lg:min-w-[56px]",
  card: "h-12 w-12 min-h-[48px] min-w-[48px] lg:h-[52px] lg:w-[52px] lg:min-h-[52px] lg:min-w-[52px]",
  workflow: "h-12 w-12 min-h-[48px] min-w-[48px] lg:h-[52px] lg:w-[52px] lg:min-h-[52px] lg:min-w-[52px]",
};
const GLYPH: Record<Variant, string> = {
  hero: "h-7 w-7 lg:h-8 lg:w-8",
  card: "h-7 w-7 lg:h-[30px] lg:w-[30px]",
  workflow: "h-7 w-7 lg:h-[30px] lg:w-[30px]",
};

// ── Shared motifs so repeated ideas render identically across the family ──
// Verification-check badge (bottom-right).
const Check = ({ cx = 17.9, cy = 17.9, r = 3.85 }: { cx?: number; cy?: number; r?: number }) => (
  <>
    <circle cx={cx} cy={cy} r={r} />
    <path d={`M${cx - 1.75} ${cy}l1.15 1.15 2.35-2.55`} />
  </>
);
// Filled QR module.
const M = ({ x, y, s = 1.2 }: { x: number; y: number; s?: number }) => (
  <rect x={x} y={y} width={s} height={s} fill="currentColor" stroke="none" />
);

const GLYPHS: Record<LandingGlyphName, ReactNode> = {
  // 01 — QR vehicle passport: portrait doc + folded corner + car + QR + check.
  qrPassport: (
    <>
      <path d="M8 2.6h6.3L17.8 6.1v12.5a1.4 1.4 0 0 1-1.4 1.4H8A1.4 1.4 0 0 1 6.6 18.6V4A1.4 1.4 0 0 1 8 2.6Z" />
      <path d="M14.1 2.6v3.6h3.5" />
      <path d="M9.1 8.7h4.6M9.6 8.7l.5-1.25a.66.66 0 0 1 .6-.4h1.7a.66.66 0 0 1 .6.4l.5 1.25" />
      <M x={10.1} y={8.15} s={0.5} /><M x={12.5} y={8.15} s={0.5} />
      <rect x="8.5" y="10.9" width="2.9" height="2.9" rx=".3" />
      <M x={9.4} y={11.8} />
      <M x={12.4} y={10.9} s={1.1} /><M x={12.4} y={12.7} s={1.1} />
      <M x={8.5} y={14.9} s={1.1} /><M x={10.1} y={14.9} s={1.1} /><M x={12.4} y={14.9} s={1.1} />
      <Check />
    </>
  ),
  // 02 — Routed lead: QR in scan brackets → dotted route with nodes → person + check.
  routedLead: (
    <>
      <path d="M3.2 5V4a.8.8 0 0 1 .8-.8h1M8.4 3.2h1a.8.8 0 0 1 .8.8v1M10.2 8.2v1a.8.8 0 0 1-.8.8h-1M4.2 10.8h-1a.8.8 0 0 1-.8-.8v-1" />
      <M x={4.6} y={4.8} s={1.4} /><M x={7} y={4.8} s={1.4} /><M x={4.6} y={7.2} s={1.4} />
      <path strokeDasharray="0.1 2" d="M7.2 12.6 11.6 15" />
      <path strokeDasharray="0.1 2" d="M12.6 14.6 15.2 11.8" />
      <circle cx="7" cy="12.5" r=".95" />
      <circle cx="12" cy="15.2" r=".95" />
      <circle cx="17.2" cy="6" r="2.15" />
      <path d="M13.7 11.7a3.55 3.55 0 0 1 7 0" />
      <Check />
    </>
  ),
  // 03/09/13 — Digital signature / signed proof / sign: doc + signature + pen + check.
  digitalSignature: (
    <>
      <path d="M6.4 2.6h6.3L16.2 6.1v11a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 17.1V4A1.4 1.4 0 0 1 6.4 2.6Z" />
      <path d="M12.5 2.6v3.6h3.5" />
      <path d="M7.4 7.7h4.6M7.4 9.7h2.9" />
      <path d="M7.4 13.7c1.1-.2 1.7-1.9 2.5-1.9.7 0 .5 1.6 1.2 1.6.5 0 .9-1.1 1.6-1.1" />
      <path d="M18.9 9.5l1.6 1.6-5 5-2.1.5.5-2.1z" />
      <path d="M17.7 10.7l1.6 1.6" />
      <Check />
    </>
  ),
  // 04 — Advertised-price reconciliation: browser + $ tag + opposing arrows + check.
  priceReconciliation: (
    <>
      <rect x="3.2" y="4" width="17.6" height="13.2" rx="1.8" />
      <path d="M3.2 7.4h17.6" />
      <M x={5.1} y={5.3} s={0.5} /><M x={6.7} y={5.3} s={0.5} /><M x={8.3} y={5.3} s={0.5} />
      <path d="M5.4 9.6h2.5l2.4 2.4a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4 0L5.1 12.4V10a.4.4 0 0 1 .3-.4z" />
      <path d="M6.4 10.7h.02" />
      <path d="M12.4 11h5.4m0 0-1.6-1.6m1.6 1.6-1.6 1.6M17.8 14.2h-5.4m0 0 1.6 1.6m-1.6-1.6 1.6-1.6" />
    </>
  ),
  // 05 — FTC-aligned addendum: doc + lines + shield-check overlapping right.
  ftcAddendum: (
    <>
      <path d="M5 2.8h6.3L14.6 6v8.6a1.4 1.4 0 0 1-1.4 1.4H5A1.4 1.4 0 0 1 3.6 14.6V4.2A1.4 1.4 0 0 1 5 2.8Z" />
      <path d="M11.3 2.8v3.4h3.3" />
      <path d="M5.9 8h4.4M5.9 10.1h4.4M5.9 12.2h3" />
      <path d="M16.6 9.9 20.6 11.3v3c0 2.4-1.8 4.1-4 4.9-2.2-.8-4-2.5-4-4.9v-3z" />
      <path d="M14.9 14.2l1.3 1.3 2.4-2.6" />
    </>
  ),
  // 06 — Tamper-evident record per VIN: chain nodes + doc + lock + check.
  tamperEvident: (
    <>
      <path d="M9.4 3h5.2L17.4 5.8v8.4a1.3 1.3 0 0 1-1.3 1.3H9.4A1.3 1.3 0 0 1 8.1 14.2V4.3A1.3 1.3 0 0 1 9.4 3Z" />
      <path d="M14.4 3v2.8h3" />
      <path d="M10 8h4.6M10 10h4.6M10 12h3" />
      <circle cx="4.4" cy="6" r="1.3" /><circle cx="4.4" cy="12.4" r="1.3" />
      <path d="M4.4 7.3v3.8M5.7 6h2.4M5.7 12.4h2" />
      <rect x="14.6" y="14" width="5.6" height="4.8" rx="1" />
      <path d="M15.9 14v-1.1a1.5 1.5 0 0 1 3 0v1.1" />
      <path d="M17.4 16v.9" />
    </>
  ),
  // 07 — Add-on election: price tag ($ + plus) beside a shield-check.
  sellAddons: (
    <>
      <path d="M3.4 4.2h4.1a1.4 1.4 0 0 1 1 .42l4 4a1.4 1.4 0 0 1 0 2l-3.5 3.5a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1-.42-1V5.6a1.4 1.4 0 0 1 1.42-1.4z" />
      <path d="M5.6 6.4h.02" />
      <path d="M7 9.2c0-.6.5-1 1.1-1 .8 0 1.1.5 1.1 1s-.4.8-1.1 1c-.7.2-1.1.5-1.1 1.05 0 .5.4 1 1.1 1 .6 0 1.1-.4 1.1-1M8.1 7.6v.6M8.1 12.1v.6" />
      <path d="M6.6 15.4h2.6M7.9 14.1v2.6" />
      <path d="M16.2 9.6 20.2 11v2.9c0 2.3-1.8 4-4 4.7-2.2-.7-4-2.4-4-4.7V11z" />
      <path d="M14.5 13.8l1.3 1.3 2.4-2.6" />
    </>
  ),
  // 08 — Price integrity: listing window + $ tag + opposing arrows + check.
  ownYourPrice: (
    <>
      <rect x="3.2" y="4" width="17.6" height="13.2" rx="1.8" />
      <path d="M3.2 7.4h17.6" />
      <M x={5.1} y={5.3} s={0.5} /><M x={6.7} y={5.3} s={0.5} /><M x={8.3} y={5.3} s={0.5} />
      <path d="M5.4 9.6h2.5l2.4 2.4a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4 0L5.1 12.4V10a.4.4 0 0 1 .3-.4z" />
      <path d="M6.4 10.7h.02" />
      <path d="M12.4 11h5.4m0 0-1.6-1.6m1.6 1.6-1.6 1.6M17.8 14.2h-5.4m0 0 1.6 1.6m-1.6-1.6 1.6-1.6" />
    </>
  ),
  // 10 — Audit defense file: folder + checklist checkmarks + shield-check.
  auditDefense: (
    <>
      <path d="M3.2 6.2A1.5 1.5 0 0 1 4.7 4.7h3.1l1.6 1.8h5A1.5 1.5 0 0 1 15.9 8v6.5a1.5 1.5 0 0 1-1.5 1.5H4.7a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M6 9.6l.9.9 1.6-1.7M6 12.9l.9.9 1.6-1.7" />
      <path d="M10.2 9.9h3.2M10.2 13.2h2.2" />
      <path d="M16.4 10.2 20.4 11.6v2.9c0 2.3-1.8 4-4 4.7-2.2-.7-4-2.4-4-4.7v-2.9z" />
      <path d="M14.7 14.4l1.3 1.3 2.4-2.6" />
    </>
  ),
  // 11 — VIN decode: car front in scan brackets + barcode + check.
  decode: (
    <>
      <path d="M3.6 5V3.9a.7.7 0 0 1 .7-.7h1.1M13.9 3.2H15a.7.7 0 0 1 .7.7V5M15.7 11.2v1.1a.7.7 0 0 1-.7.7h-1.1M5.4 13H4.3a.7.7 0 0 1-.7-.7v-1.1" />
      <path d="M5.5 9.6l.7-1.7a1.1 1.1 0 0 1 1-.7h4.9a1.1 1.1 0 0 1 1 .7l.7 1.7" />
      <path d="M5 9.6h9.3a.9.9 0 0 1 .9.9v1.7a.9.9 0 0 1-.9.9H5a.9.9 0 0 1-.9-.9v-1.7a.9.9 0 0 1 .9-.9z" />
      <path d="M6.1 11h.02M13.2 11h.02" />
      <path d="M4 16.2v2.6M5.4 16.2v2.6M6.8 16.2v2.6M8.9 16.2v2.6M10.3 16.2v2.6M11.7 16.2v2.6M13.1 16.2v2.6" />
      <Check cx={18.4} cy={18} r={3.3} />
    </>
  ),
  // 12 — Apply sticker: car + windshield with a dashed sticker + placement arrow.
  stick: (
    <>
      <path d="M3 16.2v-2.4l1.8-4a1.4 1.4 0 0 1 1.3-.8h9.8a1.4 1.4 0 0 1 1.3.8l1.8 4v2.4" />
      <path d="M3 16.2a1 1 0 0 0 1 1h.6a1 1 0 0 0 1-1M18.8 16.2a1 1 0 0 1-1 1h-.6a1 1 0 0 1-1-1" />
      <path d="M5.2 9.4 6.6 6.2a1.4 1.4 0 0 1 1.3-.8h6a1.4 1.4 0 0 1 1.3.8l1.4 3.2" />
      <path strokeDasharray="1.6 1.2" d="M9.4 7.6h3.6v2.4l-1.8-.9-1.8.9z" />
      <path d="M20.6 8.4h-2.9m0 0 1.3-1.3m-1.3 1.3 1.3 1.3" />
      <path d="M5.5 12.9h1.4M15.9 12.9h1.4" />
    </>
  ),
  // 14 — Close: rising bar chart + up trend arrow + handshake + check.
  close: (
    <>
      <path d="M13.4 13.4v4.4M16.2 10.8v7M19 8.2v9.6" />
      <path d="M13 6.6l2.6 2.4 2.2-2.6 2 1.8M18.4 5.9l1.4.3-.3 1.4" />
      <path d="M3 14.6l1.9-1.3a1 1 0 0 1 1.1 0l1.4 1 1.5-1.1a1 1 0 0 1 1.2 0l1.3 1.1" />
      <path d="M3 17.4l2.1 1.5a1 1 0 0 0 1.1 0l1.2-.8 1.2.8a1 1 0 0 0 1.2 0l2-1.5" />
      <path d="M6.2 15.6l1.1.8M8 15.4l1 .7" />
    </>
  ),
  // 15 — Vehicle arrival: car passing through a gate/archway + right arrow.
  vehicleArrives: (
    <>
      <path d="M3.4 18V6.4a1 1 0 0 1 1-1h5.6a1 1 0 0 1 1 1V18" />
      <path d="M3.4 5.4 7.2 3l3.8 2.4" />
      <path d="M12.5 14.2l.7-1.7a1.1 1.1 0 0 1 1-.66h4.4a1.1 1.1 0 0 1 1 .66l.7 1.7" />
      <path d="M12.1 14.2h8.2a.85.85 0 0 1 .85.85v1.7a.85.85 0 0 1-.85.85h-8.2a.85.85 0 0 1-.85-.85v-1.7a.85.85 0 0 1 .85-.85z" />
      <path d="M13.1 16.2h.02M19.4 16.2h.02" />
      <path d="M5.6 20.2h4.4m0 0-1.4-1.4m1.4 1.4-1.4 1.4" />
    </>
  ),
  // 16 — Get-Ready queues itself: stacked task cards + checks + arrow + clock.
  getReadyQueue: (
    <>
      <rect x="3.6" y="3.4" width="11.4" height="3.6" rx="1" />
      <path d="M5.6 5.2l.8.8 1.5-1.6" />
      <rect x="3.6" y="8.6" width="11.4" height="3.6" rx="1" />
      <path d="M5.6 10.4l.8.8 1.5-1.6" />
      <rect x="3.6" y="13.8" width="11.4" height="3.6" rx="1" />
      <path d="M5.6 15.6l.8.8 1.5-1.6" />
      <path d="M10.4 10.4h5m0 0-1.5-1.5m1.5 1.5-1.5 1.5" />
      <circle cx="18.2" cy="17.4" r="3.4" />
      <path d="M18.2 15.6v1.8l1.2.8" />
    </>
  ),
  // 17 — Installer proof: camera with wrench in the lens + check.
  installProof: (
    <>
      <path d="M3.4 8.8a1.6 1.6 0 0 1 1.6-1.6h1.6l1.1-1.7h4.8l1.1 1.7h1.6A1.6 1.6 0 0 1 18.4 8.8v6.8a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 15.6z" />
      <path d="M13.2 11.6a2.6 2.6 0 1 1-4.3-2" />
      <path d="M13.7 9.2a2.6 2.6 0 0 0-1.2-.7l1.2-1.2 1.5 1.5-1.2 1.2a2.6 2.6 0 0 0-.3-.8z" />
      <Check cx={18.4} cy={18} r={3.3} />
    </>
  ),
  // 18 — Foreman approval: clipboard + person + checklist/signature + check.
  foremanSignoff: (
    <>
      <path d="M8.2 4.4H6.4A1.5 1.5 0 0 0 4.9 5.9v12.2a1.5 1.5 0 0 0 1.5 1.5h8.2a1.5 1.5 0 0 0 1.5-1.5V5.9a1.5 1.5 0 0 0-1.5-1.5h-1.8" />
      <rect x="8.2" y="3" width="4.6" height="2.8" rx=".9" />
      <circle cx="10.5" cy="9.4" r="1.7" />
      <path d="M7.9 13.6a2.9 2.9 0 0 1 5.2 0" />
      <path d="M6.8 16.4c.7-.1 1-1.1 1.5-1.1.4 0 .3 1 .8 1 .3 0 .5-.7 1-.7" />
      <Check cx={17.7} cy={17.7} r={3.5} />
    </>
  ),
  // 19 — Publish sticker: car + windshield with a verified sticker + outbound arrow + check.
  rightStickerOut: (
    <>
      <path d="M3 15.4v-2.2l1.7-3.7a1.3 1.3 0 0 1 1.2-.8h8.4a1.3 1.3 0 0 1 1.2.8l1.1 2.4" />
      <path d="M3 15.4a.95.95 0 0 0 .95.95h.5a.95.95 0 0 0 .95-.95" />
      <path d="M5 8.8 6.3 5.9a1.3 1.3 0 0 1 1.2-.8h5.2a1.3 1.3 0 0 1 1.2.8l1.2 2.9" />
      <rect x="8.4" y="6.7" width="3.4" height="3.4" rx=".5" />
      <path d="M9.2 8.4l.7.7 1.3-1.4" />
      <path d="M18.4 13.4h2.8m0 0-1.3-1.3m1.3 1.3-1.3 1.3" />
      <Check cx={18} cy={18.2} r={3.3} />
    </>
  ),
};

interface Props {
  name: LandingGlyphName;
  variant?: Variant;
  className?: string;
}

export function LandingFeatureIcon({ name, variant = "card", className = "" }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] shadow-[0_1px_2px_rgba(15,23,42,0.08)] ${TILE[variant]} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`${GLYPH[variant]} text-[#2563EB]`}
      >
        {GLYPHS[name]}
      </svg>
    </span>
  );
}

export default LandingFeatureIcon;

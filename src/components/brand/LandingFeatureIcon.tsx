// ──────────────────────────────────────────────────────────────────────
// LandingFeatureIcon — the single, consistent icon system for the public
// landing page. Replaces the glossy AI-generated blue tile PNplaceholders.
//
// One softly-rounded #EFF6FF tile with a 1px #BFDBFE border and a crisp
// stroke glyph (#2563EB, ~1.9px on a 24 grid, round caps/joins). No gradient,
// glow, bevel, or 3D. Every glyph is drawn on the same 24 viewBox with the
// same stroke so the whole family reads as one illustrator's set.
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

// Reused verification-check badge (bottom-right) so "verified" reads identically
// across the family.
const Check = () => (
  <>
    <circle cx="17.7" cy="17.8" r="3.9" />
    <path d="M16 17.9l1.15 1.15 2.35-2.5" />
  </>
);

const GLYPHS: Record<LandingGlyphName, ReactNode> = {
  // 1 — QR vehicle passport: portrait doc + fold + car + QR + check.
  qrPassport: (
    <>
      <path d="M6 2.6h6.6L16 6v6.2" />
      <path d="M16 14.4v2.1a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 16.5V4.2A1.6 1.6 0 0 1 6 2.6Z" />
      <path d="M12.5 2.6V6H16" />
      <path d="M6.9 9.1h4.2M7.3 9.1l.5-1.15a.6.6 0 0 1 .54-.35h1.44a.6.6 0 0 1 .54.35l.5 1.15" />
      <g fill="currentColor" stroke="none">
        <rect x="6.4" y="11.3" width="1.5" height="1.5" rx=".2" />
        <rect x="8.5" y="11.3" width="1.5" height="1.5" rx=".2" />
        <rect x="6.4" y="13.4" width="1.5" height="1.5" rx=".2" />
      </g>
      <Check />
    </>
  ),
  // 2 — Every scan becomes a routed lead: QR → route → person + check.
  routedLead: (
    <>
      <rect x="3.2" y="12.4" width="5.8" height="5.8" rx="1.2" />
      <g fill="currentColor" stroke="none">
        <rect x="4.5" y="13.7" width="1.3" height="1.3" />
        <rect x="6.4" y="13.7" width="1.3" height="1.3" />
        <rect x="4.5" y="15.6" width="1.3" height="1.3" />
      </g>
      <path d="M9.4 15.3h1.9a1.6 1.6 0 0 0 1.6-1.6V10.6" />
      <circle cx="17.1" cy="6" r="2.3" />
      <path d="M13.4 11.9a3.7 3.7 0 0 1 7.3-.02" />
      <Check />
    </>
  ),
  // 3/9/13 — Digital signature / signed proof / sign: doc + signature + pen + check.
  digitalSignature: (
    <>
      <path d="M6 2.6h6.6L16 6v6" />
      <path d="M16 15v1.5a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 16.5V4.2A1.6 1.6 0 0 1 6 2.6Z" />
      <path d="M12.5 2.6V6H16" />
      <path d="M6.6 7.4h4.6M6.6 9.4h2.8" />
      <path d="M6.6 13.1c1-.1 1.6-1.5 2.3-1.5.6 0 .5 1.3 1.1 1.3.5 0 .9-1 1.5-1" />
      <path d="M18.8 9.6l1.6 1.6-4.3 4.3-2 .4.4-2Z" />
      <Check />
    </>
  ),
  // 4 — Advertised-price reconciliation: browser window + $ tag + swap arrows + check.
  priceReconciliation: (
    <>
      <rect x="3.4" y="4" width="17.2" height="13" rx="1.8" />
      <path d="M3.4 7.6h17.2" />
      <path d="M5.4 5.8h.02M7.4 5.8h.02" />
      <path d="M6.3 10.1h2.1v2.6l-1.05.9-1.05-.9Z" />
      <path d="M6.9 10.9v.02" />
      <path d="M11 11.1h5.2m0 0-1.4-1.3m1.4 1.3-1.4 1.3M16 13.6h-5.2m0 0 1.4 1.3m-1.4-1.3 1.4-1.3" />
      <Check />
    </>
  ),
  // 5 — FTC-aligned addendum: doc + lines + shield behind + check.
  ftcAddendum: (
    <>
      <path d="M5 2.8h6.4L14.6 6v8.4a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 14.4V4.4A1.6 1.6 0 0 1 5 2.8Z" />
      <path d="M11.4 2.8V6h3.2" />
      <path d="M5.8 8h5.4M5.8 10.2h5.4M5.8 12.4h3.4" />
      <path d="M16.9 10.2 20.4 11.5v2.6c0 2.1-1.6 3.6-3.5 4.4-1.9-.8-3.5-2.3-3.5-4.4v-2.6Z" />
      <path d="M15.4 14.3l1.1 1.1 2-2.1" />
    </>
  ),
  // 6 — Tamper-evident record per VIN: linked docs + lock + check.
  tamperEvident: (
    <>
      <path d="M5 3h5.6L13.4 5.8v6.4a1.4 1.4 0 0 1-1.4 1.4H5A1.4 1.4 0 0 1 3.6 12.2V4.4A1.4 1.4 0 0 1 5 3Z" />
      <path d="M10.4 3v2.8h3" />
      <path d="M5.6 7.4h4.6M5.6 9.4h4.6M5.6 11.4h2.8" />
      <path d="M13.4 8.6h2.4a1.4 1.4 0 0 1 1.4 1.4v2" />
      <rect x="15.4" y="13.4" width="5.4" height="4.6" rx="1" />
      <path d="M16.7 13.4v-1.1a1.4 1.4 0 0 1 2.8 0v1.1" />
      <path d="M18.1 15.3v1" />
    </>
  ),
  // 7 — Sell add-ons without fear: price tag + plus + shield-check.
  sellAddons: (
    <>
      <path d="M3.4 4.2h6.2a1.6 1.6 0 0 1 1.13.47l4.3 4.3a1.6 1.6 0 0 1 0 2.26l-3.7 3.7a1.6 1.6 0 0 1-2.26 0l-4.3-4.3A1.6 1.6 0 0 1 4.3 9.6V5.1" />
      <path d="M6 6.6h.02" />
      <path d="M8.6 10.2h3.2M10.2 8.6v3.2" />
      <path d="M16.4 10.4 19.9 11.6v2.6c0 2.1-1.6 3.6-3.5 4.4-1.9-.8-3.5-2.3-3.5-4.4v-2.6Z" />
      <path d="M15 14.4l1.1 1.1 2-2.1" />
    </>
  ),
  // 8 — Own your price, prove you honored it: listing window + $ tag + seal.
  ownYourPrice: (
    <>
      <rect x="3.4" y="3.6" width="14" height="11.6" rx="1.6" />
      <path d="M3.4 6.8h14" />
      <path d="M5.2 5.2h.02M7 5.2h.02" />
      <path d="M6 9h3v3l-1.5 1.2L6 12Z" />
      <path d="M7.5 9.9v.02" />
      <path d="M11 10.4h4.4m0 0-1.2-1.2m1.2 1.2-1.2 1.2" />
      <circle cx="17.6" cy="17.4" r="3.9" />
      <path d="M16 17.5l1.15 1.15 2.35-2.5" />
    </>
  ),
  // 10 — Audit defense file: folder + checklist lines + shield + check.
  auditDefense: (
    <>
      <path d="M3.4 6.2A1.6 1.6 0 0 1 5 4.6h3.2l1.6 1.8h4.6A1.6 1.6 0 0 1 16 8v6.4a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z" />
      <path d="M6.2 9.4h6.8M6.2 11.5h6.8M6.2 13.6h4.2" />
      <path d="M16.9 10.4 20.4 11.6v2.6c0 2.1-1.6 3.6-3.5 4.4-1.9-.8-3.5-2.3-3.5-4.4v-2.6Z" />
      <path d="M15.4 14.4l1.1 1.1 2-2.1" />
    </>
  ),
  // 11 — Decode: vehicle front + VIN barcode + scanner corners.
  decode: (
    <>
      <path d="M4 3.4h2M3.4 4v2M20 3.4h-2M20.6 4v2M4 20.6h2M3.4 20v-2M20 20.6h-2M20.6 20v-2" />
      <path d="M6.6 10.4l.9-2a1.4 1.4 0 0 1 1.28-.82h6.44a1.4 1.4 0 0 1 1.28.82l.9 2" />
      <path d="M6 10.4h12a1 1 0 0 1 1 1v2.4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-2.4a1 1 0 0 1 1-1Z" />
      <path d="M7.2 12.4v1.4M9 12.4v1.4M10.8 12.4v1.4M13.2 12.4v1.4M15 12.4v1.4M16.8 12.4v1.4" />
    </>
  ),
  // 12 — Stick: window sticker with peeled corner over a windshield outline.
  stick: (
    <>
      <path d="M4.4 5.4A1.6 1.6 0 0 1 6 3.8h9.2a1.6 1.6 0 0 1 1.6 1.6v3.2" />
      <path d="M14.8 9.4h4.2l-2.9 2.9v9.9" />
      <path d="M8.4 8.2h7M8.4 10.6h5" />
      <path d="M14.8 13.4v6.6l1.4-1 1.4 1" />
      <path d="M9.6 20.4H7a1.6 1.6 0 0 1-1.6-1.6v-6.2" />
    </>
  ),
  // 14 — Close: rising performance chart + closing check.
  close: (
    <>
      <path d="M4 4v14a1 1 0 0 0 1 1h13" />
      <path d="M7 15l3-3.4 2.6 2 3.4-4.2" />
      <path d="M14.4 9.4h2.6v2.6" />
      <Check />
    </>
  ),
  // 15 — Vehicle arrives: car entering scan brackets + directional arrow.
  vehicleArrives: (
    <>
      <path d="M3.4 5.6V4.4a1 1 0 0 1 1-1h1.4M20.6 5.6V4.4a1 1 0 0 0-1-1h-1.4M3.4 15.4v1.2a1 1 0 0 0 1 1h1.4M20.6 15.4v1.2a1 1 0 0 1-1 1h-1.4" />
      <path d="M7.4 12.2l.85-2a1.3 1.3 0 0 1 1.2-.8h4.9a1.3 1.3 0 0 1 1.2.8l.85 2" />
      <path d="M6.8 12.2h10.4a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9H6.8a.9.9 0 0 1-.9-.9v-2.2a.9.9 0 0 1 .9-.9Z" />
      <path d="M8 14.4h.02M16 14.4h.02" />
      <path d="M12 19.6v1.6m0 0 1.4-1.4M12 21.2l-1.4-1.4" />
    </>
  ),
  // 16 — Get-Ready queues itself: stacked task cards + checks + automation arrow.
  getReadyQueue: (
    <>
      <rect x="4" y="3.6" width="12.6" height="4" rx="1" />
      <path d="M6.2 5.6l.9.9 1.7-1.8" />
      <rect x="4" y="9.2" width="12.6" height="4" rx="1" />
      <path d="M6.2 11.2l.9.9 1.7-1.8" />
      <rect x="4" y="14.8" width="12.6" height="4" rx="1" />
      <path d="M6.2 16.8l.9.9 1.7-1.8" />
      <path d="M19 8.6a4 4 0 0 1 0 7M19 15.6v-1.4M19 15.6h1.4" />
    </>
  ),
  // 17 — Installers prove the work: camera + wrench + verification check.
  installProof: (
    <>
      <path d="M4 8.8a1.6 1.6 0 0 1 1.6-1.6h1.5l1.1-1.6h4.6l1.1 1.6h1.5A1.6 1.6 0 0 1 18.4 8.8v6.6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 15.4Z" />
      <path d="M12.6 11.4a2.4 2.4 0 1 1-3.5-2.1" />
      <path d="M20.4 15.2a2.1 2.1 0 0 1-2.7 2.6l-2.3 2.3-1.5-1.5 2.3-2.3a2.1 2.1 0 0 1 2.6-2.7l-1.3 1.3.9.9Z" />
    </>
  ),
  // 18 — Foreman signs off: clipboard + person badge + approval check.
  foremanSignoff: (
    <>
      <path d="M6 4.6h2.2M6 4.6A1.6 1.6 0 0 0 4.4 6.2v12a1.6 1.6 0 0 0 1.6 1.6h8a1.6 1.6 0 0 0 1.6-1.6v-12A1.6 1.6 0 0 0 14 4.6h-2.2" />
      <rect x="8.2" y="3.2" width="3.6" height="2.8" rx=".8" />
      <circle cx="10" cy="10.6" r="1.9" />
      <path d="M6.9 16.2a3.2 3.2 0 0 1 6.2 0" />
      <circle cx="17.6" cy="17.6" r="3.8" />
      <path d="M16 17.7l1.1 1.1 2.3-2.4" />
    </>
  ),
  // 19 — The right sticker goes out: windshield + sticker + outbound arrow + check.
  rightStickerOut: (
    <>
      <path d="M4 6.6A1.6 1.6 0 0 1 5.6 5h7.8A1.6 1.6 0 0 1 15 6.6v2" />
      <path d="M8 9.4h4M8 11.6h2.6" />
      <path d="M4 12.8v3.6A1.6 1.6 0 0 0 5.6 18h4.2" />
      <path d="M13.2 13.2h4.4m0 0-1.7-1.7m1.7 1.7-1.7 1.7" />
      <circle cx="18" cy="18.4" r="3.4" />
      <path d="M16.5 18.5l1 1 2-2.1" />
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

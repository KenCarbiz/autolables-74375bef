// ──────────────────────────────────────────────────────────────────────
// AutoLabels Addendum Icon Library — the locked, print-ready icon system
// for the Saturday Premium Addendum, future addendum templates, Vehicle
// Passport panels, and PDF/PNG exports. Built exactly from the approved
// icon key: 2px stroke, 24px viewbox, rounded caps/joins, inline SVG only
// (no icon fonts, images, emoji, or CSS icons — they break in print).
//
// Color rules (getAddendumIconColor):
//   navy/blue = document, trust, specification, general information
//   green     = installed equipment / included products
//   blue      = included benefits / informational trust signals
//   purple    = available upgrades / optional / not installed
//   navy      = footer & compliance badges (variant="light" on dark)
// ──────────────────────────────────────────────────────────────────────

import type { ReactNode, SVGProps } from "react";

export const ADDENDUM_ICON_COLORS = {
  navy: "#0D1B2A",
  blue: "#0B6FEA",
  green: "#1F7A4D",
  purple: "#6D28D9",
  muted: "#64748B",
} as const;

export type AddendumIconContext = "document" | "installed" | "benefit" | "upgrade" | "spec" | "trust" | "footer";

export type AddendumIconKey =
  | "vehicle-passport" | "vin" | "stock-number" | "date" | "price-msrp" | "qr-code"
  | "protection-products" | "documents" | "benefits"
  | "window-tint" | "paint-protection-film" | "wheel-locks" | "all-weather-floor-mats"
  | "mud-flaps" | "running-boards" | "roof-rack" | "tow-hitch" | "trailer-package" | "ceramic-coating"
  | "remote-start" | "ceramic-coating-upgrade" | "roof-rack-cross-bars" | "premium-wheels"
  | "premium-audio" | "heated-seats" | "navigation-upgrade" | "camera-360" | "parking-sensors"
  | "wireless-charger" | "sunroof-upgrade" | "premium-paint"
  | "powertrain-warranty" | "scheduled-maintenance" | "roadside-assistance" | "exchange-policy"
  | "multi-point-inspection" | "rental-car-benefits" | "trip-interruption" | "customer-support" | "protection-plan"
  | "engine" | "drivetrain" | "transmission" | "horsepower" | "torque"
  | "fuel-type" | "fuel-economy" | "dimensions" | "wheels-tires" | "brakes"
  | "quality-products" | "expert-installation" | "added-value" | "peace-of-mind"
  | "autolabels-powered" | "ai-powered" | "ftc-compliant" | "real-time-updates" | "print-ready"
  | "generic-product";

type P = SVGProps<SVGSVGElement>;
const S = ({ children, ...props }: P & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
);

// ── Document & Trust ──────────────────────────────────────────────────
const ICONS: Record<AddendumIconKey, (p: P) => ReactNode> = {
  "vehicle-passport": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="m8.75 11 2.4 2.4 4.1-4.4" /></S>
  ),
  vin: (p) => (
    <S {...p}><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M6.5 9.5v5M9.5 9.5v5M12 9.5v5M15 9.5v5M17.5 9.5v5" strokeWidth={1.5} /></S>
  ),
  "stock-number": (p) => (
    <S {...p}><path d="M3.5 12.5v-7A2 2 0 0 1 5.5 3.5h7L20.5 11.5a2 2 0 0 1 0 2.85l-6.15 6.15a2 2 0 0 1-2.85 0Z" /><circle cx="8" cy="8" r="1.5" /></S>
  ),
  date: (p) => (
    <S {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><path d="M8 13.5h3M14 13.5h2.5M8 17h3" strokeWidth={1.75} /></S>
  ),
  "price-msrp": (p) => (
    <S {...p}><path d="M3.5 12.5v-7A2 2 0 0 1 5.5 3.5h7L20.5 11.5a2 2 0 0 1 0 2.85l-6.15 6.15a2 2 0 0 1-2.85 0Z" /><path d="M9.5 12.5c0-1 .8-1.5 1.75-1.5s1.75.5 1.75 1.5-.8 1.5-1.75 1.5-1.75.5-1.75 1.5.8 1.5 1.75 1.5 1.75-.5 1.75-1.5M11.25 9.75v1.25M11.25 17v1.25" strokeWidth={1.75} /></S>
  ),
  "qr-code": (p) => (
    <S {...p}><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h2.5v2.5H14ZM18 14h2.5M20.5 17v3.5M14 20.5h3.5v-2" strokeWidth={1.75} /></S>
  ),
  "protection-products": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="M12 7v5M9.5 9.5h5" /></S>
  ),
  documents: (p) => (
    <S {...p}><path d="M15 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7Z" /><path d="M15 3.5V7h3.5M9 11.5h6M9 15h6M9 18h3.5" strokeWidth={1.75} /></S>
  ),
  benefits: (p) => (
    <S {...p}><circle cx="12" cy="9" r="5.5" /><path d="m9.5 8.75 1.75 1.75 3.25-3.25" /><path d="m9 13.75-1.5 6 4.5-2.5 4.5 2.5-1.5-6" /></S>
  ),

  // ── Installed Equipment (green) ─────────────────────────────────────
  "window-tint": (p) => (
    <S {...p}><path d="M4 16.5 6.5 8.5a2 2 0 0 1 1.9-1.4h7.2a2 2 0 0 1 1.9 1.4L20 16.5Z" /><path d="m9 10-2 4.5M13 10l-2 4.5M17 10l-2 4.5" strokeWidth={1.5} /></S>
  ),
  "paint-protection-film": (p) => (
    <S {...p}><rect x="3.5" y="6" width="12" height="12" rx="1.5" /><path d="M14.5 13.5v-2.75c0-1.2 1-2.25 3-2.75 2 .5 3 1.55 3 2.75v2.75c0 2.4-1.35 4-3 5-1.65-1-3-2.6-3-5Z" fill="#fff" /></S>
  ),
  "wheel-locks": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="6.75" r="1" strokeWidth={1.5} /><circle cx="17" cy="10.4" r="1" strokeWidth={1.5} /><circle cx="15.1" cy="16.35" r="1" strokeWidth={1.5} /><circle cx="8.9" cy="16.35" r="1" strokeWidth={1.5} /><circle cx="7" cy="10.4" r="1" strokeWidth={1.5} /><rect x="10.4" y="10.4" width="3.2" height="3.2" rx="0.75" strokeWidth={1.75} /></S>
  ),
  "all-weather-floor-mats": (p) => (
    <S {...p}><path d="M6 3.5h12l1.5 15a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z" /><path d="M7.5 8h9M7.5 12h9M7.5 16h9" strokeWidth={1.5} /></S>
  ),
  "mud-flaps": (p) => (
    <S {...p}><circle cx="9" cy="10" r="5.5" /><circle cx="9" cy="10" r="1.5" strokeWidth={1.75} /><path d="M16 8.5h2.5A1.5 1.5 0 0 1 20 10v8.5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-4" /></S>
  ),
  "running-boards": (p) => (
    <S {...p}><path d="M5 9.5 6.6 6a2 2 0 0 1 1.8-1.2h7.2A2 2 0 0 1 17.4 6L19 9.5" /><rect x="3.5" y="12.5" width="17" height="3.5" rx="1.25" /><path d="M7 16v3M17 16v3" /></S>
  ),
  "roof-rack": (p) => (
    <S {...p}><path d="M4.5 15c1-4.5 3.5-7 7.5-7s6.5 2.5 7.5 7" /><path d="M3.5 15.5h17" /><path d="M8.5 8.5v-3M15.5 8.5v-3M6.5 5.5h11" /></S>
  ),
  "tow-hitch": (p) => (
    <S {...p}><circle cx="12" cy="6.5" r="3" /><path d="M12 9.5v5" /><path d="M6.5 14.5h11v3.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2Z" /></S>
  ),
  "trailer-package": (p) => (
    <S {...p}><rect x="3" y="7" width="12.5" height="8" rx="1.25" /><path d="M15.5 12.5h5M20.5 12.5v1" /><circle cx="9" cy="17.75" r="2.25" /></S>
  ),
  "ceramic-coating": (p) => (
    <S {...p}><path d="M8 10.5h5.5l2 3-3.5 6h-4l-2-3.5Z" /><path d="M10 10.5V7.5h3v3M11.5 7.5V5" /><path d="M17.5 6.5h.01M20 9h.01M19.5 4.5h.01" strokeWidth={2.5} /></S>
  ),

  // ── Available Upgrades (purple) ─────────────────────────────────────
  "remote-start": (p) => (
    <S {...p}><rect x="7.5" y="8" width="7.5" height="12.5" rx="2.5" /><circle cx="11.25" cy="12.5" r="1.6" strokeWidth={1.75} /><path d="M11.25 16.5v1.5" strokeWidth={1.75} /><path d="M16.75 5.5a6.5 6.5 0 0 1 2 2M18.75 2.75a10 10 0 0 1 2.75 2.75" /></S>
  ),
  "ceramic-coating-upgrade": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="M12 7.5v5M9.5 10h5" /></S>
  ),
  "roof-rack-cross-bars": (p) => (
    <S {...p}><path d="M4.5 7.5c0-1 .7-1.75 1.6-1.75S7.7 6.5 7.7 7.5v9c0 1-.7 1.75-1.6 1.75s-1.6-.75-1.6-1.75Z" /><path d="M16.3 7.5c0-1 .7-1.75 1.6-1.75s1.6.75 1.6 1.75v9c0 1-.7 1.75-1.6 1.75s-1.6-.75-1.6-1.75Z" /><path d="M7.7 9.5h8.6M7.7 14.5h8.6" /></S>
  ),
  "premium-wheels": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2" strokeWidth={1.75} /><path d="M12 3.5V10M19.6 9.4l-5.85 1.9M16.7 18.9 13.1 13.7M7.3 18.9l3.6-5.2M4.4 9.4l5.85 1.9" strokeWidth={1.5} /></S>
  ),
  "premium-audio": (p) => (
    <S {...p}><path d="M10.5 8.5v7l-4-2H4.5v-3h2Z" /><path d="M14 9.5a4 4 0 0 1 0 5M16.75 7.5a7.5 7.5 0 0 1 0 9" /></S>
  ),
  "heated-seats": (p) => (
    <S {...p}><path d="M7.5 4.5 9 13.5h6.5a2 2 0 0 1 2 2v.5h-9a2.4 2.4 0 0 1-2.35-2L4.9 6a1.75 1.75 0 0 1 1.7-2Z" /><path d="M13 5.5c.8 1 .8 2 0 3M16.5 5.5c.8 1 .8 2 0 3" /><path d="M8.5 19.5h9" /></S>
  ),
  "navigation-upgrade": (p) => (
    <S {...p}><path d="m20.5 3.5-8 17-2.25-7.25L3 11Z" /></S>
  ),
  "camera-360": (p) => (
    <S {...p}><path d="M8.5 6.5 10 4.5h4l1.5 2h3A1.5 1.5 0 0 1 20 8v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a1.5 1.5 0 0 1 1.5-1.5Z" /><circle cx="12" cy="12.5" r="3.5" /></S>
  ),
  "parking-sensors": (p) => (
    <S {...p}><path d="M4 15.5 5.4 11a2 2 0 0 1 1.9-1.4h5.4a2 2 0 0 1 1.9 1.4l1.4 4.5" /><path d="M3.5 15.5h13" /><circle cx="7" cy="18" r="1.4" strokeWidth={1.75} /><circle cx="13" cy="18" r="1.4" strokeWidth={1.75} /><path d="M18 8.5a5 5 0 0 1 1.5 3.5M20.5 6a9 9 0 0 1 2 6" transform="translate(-2 0)" /></S>
  ),
  "wireless-charger": (p) => (
    <S {...p}><rect x="7" y="3.5" width="10" height="17" rx="2.25" /><path d="m12.75 8.5-2.25 4h3l-2.25 4" /></S>
  ),
  "sunroof-upgrade": (p) => (
    <S {...p}><rect x="5" y="3.5" width="14" height="17" rx="4" /><rect x="8" y="6.5" width="8" height="6" rx="1.25" /><path d="M10 9.5h4" strokeWidth={1.5} /></S>
  ),
  "premium-paint": (p) => (
    <S {...p}><path d="M8 10.5h5.5l2 3-3.5 6h-4l-2-3.5Z" /><path d="M10 10.5V7.5h3v3" /><path d="m18 4 .7 1.55L20.25 6.25l-1.55.7L18 8.5l-.7-1.55-1.55-.7 1.55-.7Z" /></S>
  ),

  // ── Included Benefits (blue) ────────────────────────────────────────
  "powertrain-warranty": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><circle cx="9.75" cy="11" r="1.4" strokeWidth={1.75} /><circle cx="14.25" cy="11" r="1.4" strokeWidth={1.75} /><path d="M11.15 11h1.7" strokeWidth={1.75} /></S>
  ),
  "scheduled-maintenance": (p) => (
    <S {...p}><path d="M14.9 6a4.1 4.1 0 0 0-5.55 5.55L4 16.9 7.1 20l5.35-5.35A4.1 4.1 0 0 0 18 9.1l-2.35 2.35-2.5-.6-.6-2.5Z" /></S>
  ),
  "roadside-assistance": (p) => (
    <S {...p}><path d="M3.5 15.5V9.5h6l2.5-4h3v10" /><path d="M3.5 15.5H18M15 9.5h3.5l2 3v3h-1.5" /><circle cx="7" cy="17.5" r="1.9" /><circle cx="16" cy="17.5" r="1.9" /><path d="M12 9.5v3" strokeWidth={1.5} /></S>
  ),
  "exchange-policy": (p) => (
    <S {...p}><path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2M19.5 12a7.5 7.5 0 0 1-12.9 5.2" /><path d="M17.5 3.5v3.5H14M6.5 20.5V17H10" /></S>
  ),
  "multi-point-inspection": (p) => (
    <S {...p}><path d="M15 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7Z" /><path d="m8.5 11 1.4 1.4 2.4-2.65M8.5 16l1.4 1.4 2.4-2.65" strokeWidth={1.75} /><path d="M15 12h.5M15 17h.5" strokeWidth={1.75} /></S>
  ),
  "rental-car-benefits": (p) => (
    <S {...p}><path d="M3.5 14.5 5 10.4A2 2 0 0 1 6.85 9h6.3A2 2 0 0 1 15 10.4l.6 1.6" /><path d="M3 14.5h10.5" /><circle cx="6.5" cy="16.75" r="1.6" strokeWidth={1.75} /><circle cx="11.5" cy="16.75" r="1.6" strokeWidth={1.75} /><path d="M15.5 6.75 18.25 5.5l2.75 1.25v2.3c0 1.9-1.1 3.1-2.75 3.85-1.65-.75-2.75-1.95-2.75-3.85Z" /></S>
  ),
  "trip-interruption": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /><path d="M2.75 2.75l3 3M21.25 21.25l-3-3" strokeWidth={1.5} /></S>
  ),
  "customer-support": (p) => (
    <S {...p}><path d="M4.5 13.5v-1.75a7.5 7.5 0 0 1 15 0v1.75" /><rect x="3.5" y="12.75" width="4" height="6" rx="1.75" /><rect x="16.5" y="12.75" width="4" height="6" rx="1.75" /><path d="M18.5 18.75c0 1.5-1.5 2.5-4 2.5" /></S>
  ),
  "protection-plan": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="M8.75 9h6.5M8.75 12h6.5" strokeWidth={1.75} /></S>
  ),

  // ── Vehicle Specifications (navy/blue) ──────────────────────────────
  engine: (p) => (
    <S {...p}><path d="M8 8.5V6h5v2.5M10.5 6V4M7 4h7" /><path d="M5.5 11h2l1.5-2.5h6l2 2.5h2.5v6H17l-1.5 2h-5L9 16.5H5.5Z" /><path d="M3 12.5v3" /></S>
  ),
  drivetrain: (p) => (
    <S {...p}><circle cx="6" cy="6.5" r="2.25" /><circle cx="18" cy="6.5" r="2.25" /><circle cx="6" cy="17.5" r="2.25" /><circle cx="18" cy="17.5" r="2.25" /><path d="M8.25 6.5h7.5M8.25 17.5h7.5M12 6.5v11" /></S>
  ),
  transmission: (p) => (
    <S {...p}><circle cx="12" cy="5" r="2.25" /><path d="M12 7.25V19" /><path d="M8 19.5c0-1.25 1.75-2 4-2s4 .75 4 2" /><path d="M6.5 10.5h11" strokeWidth={1.5} /></S>
  ),
  horsepower: (p) => (
    <S {...p}><path d="M4 17.5a8.5 8.5 0 1 1 16 0" /><path d="m12 15.5 3.75-4.75" /><circle cx="12" cy="16" r="1.4" strokeWidth={1.75} /><path d="M3.5 20.5h17" /></S>
  ),
  torque: (p) => (
    <S {...p}><path d="M19.5 12a7.5 7.5 0 1 1-3-6" /><path d="M19.75 2.75 19.5 6.5l-3.75-.25" /><circle cx="12" cy="12" r="2.25" strokeWidth={1.75} /></S>
  ),
  "fuel-type": (p) => (
    <S {...p}><rect x="4.5" y="4" width="9" height="16.5" rx="1.75" /><path d="M7 7.5h4v4H7Z" strokeWidth={1.75} /><path d="M13.5 9.5h2.25a1.75 1.75 0 0 1 1.75 1.75v5a1.5 1.5 0 0 0 3 0V8.5L18 6" /></S>
  ),
  "fuel-economy": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="m12 12 3.5-3.5" /><path d="M6.5 15.5a6 6 0 0 1 11 0" strokeWidth={1.5} /></S>
  ),
  dimensions: (p) => (
    <S {...p}><rect x="2.75" y="8.75" width="18.5" height="6.5" rx="1.5" transform="rotate(-45 12 12)" /><path d="m8 12.5 1.5 1.5M10.75 9.75l1.5 1.5M13.5 7l1.5 1.5" strokeWidth={1.5} /></S>
  ),
  "wheels-tires": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" strokeWidth={1.5} /></S>
  ),
  brakes: (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><circle cx="12" cy="6.9" r="0.5" fill="currentColor" strokeWidth={1} /><circle cx="16.4" cy="14.5" r="0.5" fill="currentColor" strokeWidth={1} /><circle cx="7.6" cy="14.5" r="0.5" fill="currentColor" strokeWidth={1} /><path d="M19.5 7a8.5 8.5 0 0 1 1 5" strokeWidth={3} /></S>
  ),

  // ── Trust badge row ─────────────────────────────────────────────────
  "quality-products": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="m8.75 11 2.4 2.4 4.1-4.4" /></S>
  ),
  "expert-installation": (p) => (
    <S {...p}><circle cx="12" cy="9" r="5.5" /><path d="m9.75 9 1.6 1.6 2.9-3.1" /><path d="m9 13.75-1.5 6 4.5-2.5 4.5 2.5-1.5-6" /></S>
  ),
  "added-value": (p) => (
    <S {...p}><path d="M7.5 11.5 11 4.25a2.1 2.1 0 0 1 2 2.1V9.5h4.6a1.9 1.9 0 0 1 1.85 2.3l-1.3 6.2a2 2 0 0 1-1.95 1.6H7.5" /><rect x="3.5" y="11" width="4" height="8.5" rx="1.25" /></S>
  ),
  "peace-of-mind": (p) => (
    <S {...p}><path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" /><path d="M12 8c1.5-1.4 4-.4 4 1.6 0 1.9-2.4 3.4-4 4.4-1.6-1-4-2.5-4-4.4 0-2 2.5-3 4-1.6Z" strokeWidth={1.75} /></S>
  ),

  // ── Footer badges (support variant="light" on dark navy) ────────────
  "autolabels-powered": (p) => (
    <S {...p}><path d="m12 3 7.5 17.5h-4.1L12 12.4 8.6 20.5H4.5Z" /><path d="M9.6 16h4.8" strokeWidth={1.75} /></S>
  ),
  "ai-powered": (p) => (
    <S {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" strokeWidth={1.5} /><path d="m10 14.5 2-5 2 5M10.7 13h2.6" strokeWidth={1.5} /></S>
  ),
  "ftc-compliant": (p) => (
    <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.4 2.4 4.6-4.9" /></S>
  ),
  "real-time-updates": (p) => (
    <S {...p}><path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2M19.5 12a7.5 7.5 0 0 1-12.9 5.2" /><path d="M17.5 3.5v3.5H14M6.5 20.5V17H10" /></S>
  ),
  "print-ready": (p) => (
    <S {...p}><path d="M7 8V3.5h10V8M7 17.5H4.5V10a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5H17" /><rect x="7" y="14.5" width="10" height="6" rx="1" /></S>
  ),

  // Clean fallback for unmapped products — a simple tag, never broken UI.
  "generic-product": (p) => (
    <S {...p}><path d="M3.5 12.5v-7A2 2 0 0 1 5.5 3.5h7L20.5 11.5a2 2 0 0 1 0 2.85l-6.15 6.15a2 2 0 0 1-2.85 0Z" /><circle cx="8" cy="8" r="1.5" /></S>
  ),
};

const CONTEXT_COLOR: Record<AddendumIconContext, string> = {
  document: ADDENDUM_ICON_COLORS.navy,
  installed: ADDENDUM_ICON_COLORS.green,
  benefit: ADDENDUM_ICON_COLORS.blue,
  upgrade: ADDENDUM_ICON_COLORS.purple,
  spec: ADDENDUM_ICON_COLORS.navy,
  trust: ADDENDUM_ICON_COLORS.navy,
  footer: ADDENDUM_ICON_COLORS.navy,
};

const KEY_CONTEXT: Partial<Record<AddendumIconKey, AddendumIconContext>> = {
  "window-tint": "installed", "paint-protection-film": "installed", "wheel-locks": "installed",
  "all-weather-floor-mats": "installed", "mud-flaps": "installed", "running-boards": "installed",
  "roof-rack": "installed", "tow-hitch": "installed", "trailer-package": "installed", "ceramic-coating": "installed",
  "remote-start": "upgrade", "ceramic-coating-upgrade": "upgrade", "roof-rack-cross-bars": "upgrade",
  "premium-wheels": "upgrade", "premium-audio": "upgrade", "heated-seats": "upgrade",
  "navigation-upgrade": "upgrade", "camera-360": "upgrade", "parking-sensors": "upgrade",
  "wireless-charger": "upgrade", "sunroof-upgrade": "upgrade", "premium-paint": "upgrade",
  "powertrain-warranty": "benefit", "scheduled-maintenance": "benefit", "roadside-assistance": "benefit",
  "exchange-policy": "benefit", "multi-point-inspection": "benefit", "rental-car-benefits": "benefit",
  "trip-interruption": "benefit", "customer-support": "benefit", "protection-plan": "benefit",
  engine: "spec", drivetrain: "spec", transmission: "spec", horsepower: "spec", torque: "spec",
  "fuel-type": "spec", "fuel-economy": "spec", dimensions: "spec", "wheels-tires": "spec", brakes: "spec",
  "quality-products": "trust", "expert-installation": "trust", "added-value": "trust", "peace-of-mind": "trust",
  "autolabels-powered": "footer", "ai-powered": "footer", "ftc-compliant": "footer",
  "real-time-updates": "footer", "print-ready": "footer",
};

export function getAddendumIconColor(iconKey: AddendumIconKey, context?: AddendumIconContext): string {
  return CONTEXT_COLOR[context ?? KEY_CONTEXT[iconKey] ?? "document"];
}

export function AutoLabelsAddendumIcon({ iconKey, size = 24, color, className, title, variant }: {
  iconKey: AddendumIconKey;
  size?: number;
  color?: string;
  className?: string;
  title?: string;
  variant?: "default" | "light";
}) {
  const Icon = ICONS[iconKey] ?? ICONS["generic-product"];
  const resolved = variant === "light" ? "#FFFFFF" : color ?? (className ? undefined : getAddendumIconColor(iconKey));
  return (
    <span className={className} title={title} style={{ color: resolved, display: "inline-flex", lineHeight: 0 }}>
      <Icon width={size} height={size} />
    </span>
  );
}

const BADGE_SIZES = { sm: { box: 24, icon: 14 }, md: { box: 32, icon: 18 }, lg: { box: 40, icon: 22 } } as const;
const BADGE_BG: Record<AddendumIconContext, string> = {
  document: "#EAF4FF", installed: "#EAF6EF", benefit: "#EAF4FF",
  upgrade: "#F4ECFF", spec: "#EAF4FF", trust: "#F5F7FA", footer: "transparent",
};

export function AddendumIconBadge({ iconKey, context, size = "md" }: {
  iconKey: AddendumIconKey;
  context: AddendumIconContext;
  size?: "sm" | "md" | "lg";
}) {
  const s = BADGE_SIZES[size];
  return (
    <span className="inline-flex items-center justify-center shrink-0" style={{ width: s.box, height: s.box, borderRadius: Math.round(s.box * 0.3), background: BADGE_BG[context] }}>
      <AutoLabelsAddendumIcon iconKey={iconKey} size={s.icon} color={getAddendumIconColor(iconKey, context)} />
    </span>
  );
}

// ── Product-name → icon resolution for addendum line items ────────────
// Explicit map first (exact, case-insensitive); keyword fuzzy match only
// as a fallback; unmapped items get the clean generic tag.
const EXPLICIT_PRODUCT_ICONS: Record<string, AddendumIconKey> = {
  "window tint": "window-tint",
  "paint protection film": "paint-protection-film",
  "wheel locks": "wheel-locks",
  "all-weather floor mats": "all-weather-floor-mats",
  "mud flaps": "mud-flaps",
  "running boards": "running-boards",
  "roof rack": "roof-rack",
  "tow hitch": "tow-hitch",
  "trailer package": "trailer-package",
  "ceramic coating": "ceramic-coating",
  "remote start system": "remote-start",
  "remote start": "remote-start",
  "roof rack cross bars": "roof-rack-cross-bars",
  "premium wheels": "premium-wheels",
  "premium audio": "premium-audio",
  "heated seats": "heated-seats",
  "navigation upgrade": "navigation-upgrade",
  "360 camera system": "camera-360",
  "parking sensors": "parking-sensors",
  "wireless charger": "wireless-charger",
  "sunroof upgrade": "sunroof-upgrade",
  "premium paint": "premium-paint",
};

const FUZZY_PRODUCT_RULES: { re: RegExp; key: AddendumIconKey }[] = [
  { re: /tint/i, key: "window-tint" },
  { re: /paint protection|ppf/i, key: "paint-protection-film" },
  { re: /ceramic/i, key: "ceramic-coating" },
  { re: /wheel lock/i, key: "wheel-locks" },
  { re: /floor (mat|liner)|mats\b/i, key: "all-weather-floor-mats" },
  { re: /mud flap|splash guard/i, key: "mud-flaps" },
  { re: /running board|side step/i, key: "running-boards" },
  { re: /cross ?bar/i, key: "roof-rack-cross-bars" },
  { re: /roof rack|rack/i, key: "roof-rack" },
  { re: /hitch/i, key: "tow-hitch" },
  { re: /trailer|tow/i, key: "trailer-package" },
  { re: /remote start|key ?fob/i, key: "remote-start" },
  { re: /wheel|rim/i, key: "premium-wheels" },
  { re: /audio|speaker|sound/i, key: "premium-audio" },
  { re: /heated seat/i, key: "heated-seats" },
  { re: /navigation|gps/i, key: "navigation-upgrade" },
  { re: /360|camera/i, key: "camera-360" },
  { re: /parking sensor|park assist/i, key: "parking-sensors" },
  { re: /wireless charg/i, key: "wireless-charger" },
  { re: /sunroof|moonroof/i, key: "sunroof-upgrade" },
  { re: /paint/i, key: "premium-paint" },
  { re: /warranty/i, key: "powertrain-warranty" },
  { re: /maintenance/i, key: "scheduled-maintenance" },
  { re: /roadside/i, key: "roadside-assistance" },
  { re: /exchange|return/i, key: "exchange-policy" },
  { re: /inspection/i, key: "multi-point-inspection" },
  { re: /rental/i, key: "rental-car-benefits" },
  { re: /trip interruption/i, key: "trip-interruption" },
  { re: /support|concierge/i, key: "customer-support" },
  { re: /protection|shield|guard/i, key: "protection-products" },
];

export function resolveAddendumProductIcon(name: string, explicitKey?: string | null): AddendumIconKey {
  if (explicitKey && explicitKey in ICONS) return explicitKey as AddendumIconKey;
  const n = (name || "").trim().toLowerCase();
  if (!n) return "generic-product";
  if (EXPLICIT_PRODUCT_ICONS[n]) return EXPLICIT_PRODUCT_ICONS[n];
  for (const r of FUZZY_PRODUCT_RULES) if (r.re.test(n)) return r.key;
  return "generic-product";
}

export const ADDENDUM_ICON_KEYS = Object.keys(ICONS) as AddendumIconKey[];

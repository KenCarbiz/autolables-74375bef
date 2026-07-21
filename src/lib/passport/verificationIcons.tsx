// ── Custom verification subject icons ───────────────────────────────────────
// Recognizable, automotive-specific line icons for the mobile Data-Verified
// Report rows. One family: 24×24 viewBox, ~1.9px rounded strokes, currentColor,
// fill:none — so the caller colors them by status. Each composes its subject
// (VIN card, person+vehicle, odometer, market chart, warranty shield, …) so a
// customer recognizes the check without reading the label. Drawn at 22–24px in
// 38–40px containers.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number | string };

const Svg = ({ strokeWidth = 1.9, children, ...p }: IconProps & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);

// VIN & identity — ID card + barcode + verification check.
export const VinCardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.4" />
    <path d="M5.5 9v6M7.5 9v6M9 9v6M10.5 9v6M12 9v6" />
    <path d="M14.6 13.4l1.5 1.5 3-3" />
  </Svg>
);

// Ownership — person beside a vehicle.
export const OwnerVehicleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6.5" cy="6.6" r="2.4" />
    <path d="M2.8 18c0-2.7 1.7-4.3 3.7-4.3 1.2 0 2.2.5 2.9 1.5" />
    <path d="M12.5 17l1-2.3a1 1 0 0 1 .9-.6h4.2a1 1 0 0 1 .9.6l1 2.3" />
    <path d="M11.8 17h9.4v1.9a.7.7 0 0 1-.7.7h-8a.7.7 0 0 1-.7-.7z" />
    <path d="M14 19.6v.9M19 19.6v.9" />
  </Svg>
);

// Odometer — gauge, tick marks, needle and a mileage window.
export const OdometerGaugeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 16.5a7.6 7.6 0 1 1 15.2 0" />
    <path d="M12 4.4v1.6M5.7 8.3l1 1M18.3 8.3l-1 1" />
    <path d="M12 16.5l3.6-3.8" />
    <circle cx="12" cy="16.5" r="1.05" />
    <rect x="9" y="18.4" width="6" height="2" rx="0.6" />
  </Svg>
);

// Market comparison — ascending comparison bars with a vehicle.
export const MarketVehicleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.2 17.5h8.2" />
    <path d="M4.8 17.5v-3.4M7.5 17.5v-6M10.2 17.5v-8.6" />
    <path d="M13.4 17.6l.9-2.1a1 1 0 0 1 .9-.6h3.6a1 1 0 0 1 .9.6l.9 2.1" />
    <path d="M12.7 17.6h8.6v1.7a.6.6 0 0 1-.6.6h-7.4a.6.6 0 0 1-.6-.6z" />
    <path d="M15 19.9v.7M19 19.9v.7" />
  </Svg>
);

// Factory warranty — layered coverage shield containing a vehicle.
export const WarrantyShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.6l7.4 3.1v5.1c0 4.7-3.1 7.9-7.4 9-4.3-1.1-7.4-4.3-7.4-9V5.7z" />
    <path d="M8.6 12.6l.6-1.5a.8.8 0 0 1 .74-.5h4.12a.8.8 0 0 1 .74.5l.6 1.5" />
    <path d="M8.1 12.6h7.8v1.7a.5.5 0 0 1-.5.5h-6.8a.5.5 0 0 1-.5-.5z" />
    <path d="M9.9 14.8v.7M14.1 14.8v.7" />
  </Svg>
);

// Sources & methodology — stacked database with a verification shield.
export const SourcesShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="9.5" cy="5.6" rx="5.7" ry="2.2" />
    <path d="M3.8 5.6v7.2c0 1.15 2 2.1 4.8 2.25" />
    <path d="M15.2 5.6v3.1" />
    <path d="M3.8 9.2c0 1.15 2.2 2.1 5.2 2.2" />
    <path d="M17.5 12.4l3.3 1.15v2.15c0 1.75-1.35 2.9-3.3 3.4-1.95-.5-3.3-1.65-3.3-3.4v-2.15z" />
    <path d="M16.1 15.7l1 1 1.8-1.8" />
  </Svg>
);

// Report traceability — report document with a verification seal.
export const TraceabilityIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2.8H6.4a1.8 1.8 0 0 0-1.8 1.8v14.8a1.8 1.8 0 0 0 1.8 1.8h4" />
    <path d="M13 2.8L18 7.8v3.2" />
    <path d="M13 2.8v4.2a.8.8 0 0 0 .8.8H18" />
    <path d="M7.7 11.5h5M7.7 14.4h3.3" />
    <circle cx="16.6" cy="16.4" r="3.6" />
    <path d="M15.1 16.4l1.1 1.1 2-2" />
  </Svg>
);

// Unavailable source — history document with a minus badge.
export const HistoryMinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 2.8H6.4a1.8 1.8 0 0 0-1.8 1.8v14.8a1.8 1.8 0 0 0 1.8 1.8h5" />
    <path d="M14 2.8L18 6.8v3.4" />
    <path d="M14 2.8v3.2a.8.8 0 0 0 .8.8H18" />
    <path d="M7.7 11h5.3M7.7 13.9h3.4" />
    <circle cx="16.8" cy="16.6" r="3.4" />
    <path d="M15.1 16.6h3.4" />
  </Svg>
);

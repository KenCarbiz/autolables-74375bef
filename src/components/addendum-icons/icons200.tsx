import { type CustomIconProps } from "./customIcons";
import * as React from "react";

// 200-series custom icons — the automotive-specific concepts from the
// "Missing Addendum Icons" reference sheet that no library carries. Same
// locked style as customIcons.tsx: 24x24 viewBox, 2px stroke, round caps
// and joins, currentColor, no fills/gradients/tiny detail. All are marked
// custom_required in the manifest so final artwork review tracks them;
// swapping path data here updates every template with no code changes.

const Svg = ({ size = 24, strokeWidth = 2, children, ...rest }: CustomIconProps & { children: React.ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={rest["aria-label"] ? undefined : true}
    {...rest}
  >
    {children}
  </svg>
);

// PR202 — price tag secured by a padlock.
export const PriceLocked = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M11 3H4v7l7.5 7.5" />
    <circle cx="7.5" cy="6.5" r="1" />
    <rect x="13" y="14" width="8" height="6" rx="1.5" />
    <path d="M15 14v-2a2 2 0 0 1 4 0v2" />
  </Svg>
);

// PR203 — refresh cycle around a dollar sign.
export const PriceUpdated = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.9-6.2" />
    <path d="M17 3v3h3" />
    <path d="M12 7.5v9" />
    <path d="M14.5 9.5c0-1-1.1-1.7-2.5-1.7s-2.5.7-2.5 1.7 1 1.5 2.5 1.9 2.5.9 2.5 1.9-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.7" />
  </Svg>
);

// PR207 — wrench with completion check.
export const DealerInstalled = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M13.8 6.2a4 4 0 0 0-5.3 5.3L3 17v4h4l5.5-5.5a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.8-.7-.7-2.8 2.6-2.6z" />
    <path d="M15 19l2 2 4-4" />
  </Svg>
);

// WC201 — vehicle bracketed end to end.
export const BumperToBumper = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M6 15l1.5-4h9L18 15" />
    <path d="M5 17.5h14" />
    <circle cx="8" cy="17.5" r="0.5" />
    <circle cx="16" cy="17.5" r="0.5" />
    <path d="M3 8v9" />
    <path d="M21 8v9" />
    <path d="M3 8h2" />
    <path d="M19 8h2" />
  </Svg>
);

// WC202 — gear on a driveline between two wheels.
export const Powertrain = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 7.5V5.5" />
    <path d="M12 18.5v-2" />
    <path d="M7.5 12h-2" />
    <path d="M18.5 12h-2" />
    <path d="M15.2 8.8l1.4-1.4" />
    <path d="M7.4 16.6l1.4-1.4" />
    <path d="M15.2 15.2l1.4 1.4" />
    <path d="M7.4 7.4l1.4 1.4" />
  </Svg>
);

// WC203 — shield with a corrosion droplet.
export const CorrosionShield = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    <path d="M12 8.5s2 2.2 2 3.7A2 2 0 0 1 12 14a2 2 0 0 1-2-1.8c0-1.5 2-3.7 2-3.7z" />
  </Svg>
);

// WC207 — tire with rim and lug detail.
export const TireWheel = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 3v3" />
    <path d="M12 18v3" />
    <path d="M3 12h3" />
    <path d="M18 12h3" />
  </Svg>
);

// WC209 — windshield glass with a repaired chip.
export const Windshield = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4 17L6 7.5A2 2 0 0 1 8 6h8a2 2 0 0 1 2 1.5L20 17" />
    <path d="M4 17h16" />
    <path d="M10 10.5l1.5 1 .5-1.8" />
  </Svg>
);

// WC210 — door panel with an impact point.
export const DentDing = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M11 12a2.5 2.5 0 0 1 2-2" />
    <path d="M15.5 8.5l1.5-1.5" />
    <path d="M16.5 12H18" />
  </Svg>
);

// SR204 — tire with replacement arrows.
export const TireSwap = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="14" r="6" />
    <circle cx="10" cy="14" r="2" />
    <path d="M16.5 4.5a8 8 0 0 1 3 3" />
    <path d="M19.8 4.2v3.5h-3.5" />
  </Svg>
);

// DC201 — FTC Buyers Guide: open booklet with warranty columns.
export const BuyersGuide = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M12 5c-1.5-1.3-3.5-2-6-2H4v16h2.5c2.3 0 4.2.6 5.5 1.7 1.3-1.1 3.2-1.7 5.5-1.7H20V3h-2c-2.5 0-4.5.7-6 2z" />
    <path d="M12 5v15.7" />
    <path d="M7 9h2.5" />
    <path d="M7 13h2.5" />
    <path d="M14.5 9H17" />
    <path d="M14.5 13H17" />
  </Svg>
);

// AX201 — trailer hitch ball mount and receiver.
export const Hitch = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="6.5" r="2.5" />
    <path d="M12 9v4" />
    <path d="M8 13h8v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4z" />
    <path d="M4 15h4" />
    <path d="M16 15h4" />
  </Svg>
);

// AX202 — roof crossbars on rails.
export const Crossbars = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4 16c2.5-1.2 5.5-1.8 8-1.8s5.5.6 8 1.8" />
    <path d="M6 14.6V9" />
    <path d="M18 14.6V9" />
    <path d="M4 9.5h16" />
    <path d="M4 12.5h16" />
  </Svg>
);

// AX203 — ribbed floor mat.
export const FloorMats = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <path d="M8 8v8" />
    <path d="M12 8v8" />
    <path d="M16 8v8" />
  </Svg>
);

// AX207 — wheel secured by a lock.
export const WheelLocks = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="2.5" />
    <rect x="14" y="15" width="7" height="5.5" rx="1.5" />
    <path d="M15.8 15v-1.7a1.7 1.7 0 0 1 3.4 0V15" />
  </Svg>
);

// AX208 — fender arc with splash guard flap.
export const SplashGuards = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 0 1 16 0" />
    <path d="M20 12v6h-4" />
    <path d="M6 15.5l-1.5 2" />
    <path d="M9 16.5l-1 2.2" />
    <path d="M12 17l-.4 2.4" />
  </Svg>
);

// AX209 — molded cargo tray with raised lip.
export const CargoTray = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M3 9l3-3h12l3 3" />
    <path d="M3 9v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
    <path d="M3 9h18" />
    <path d="M7 13h10" />
  </Svg>
);

// AX210 — truck bed with flat tonneau cover.
export const TonneauCover = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M2 10h13l3-4h2a2 2 0 0 1 2 2v8h-2" />
    <path d="M2 10v6h2" />
    <path d="M2 10l1.5-1.5" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
    <path d="M9 17h6" />
    <path d="M3 12.5h11" />
  </Svg>
);

// AX211 — truck bed with liner hatch texture.
export const BedLiner = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M3 7v10h18V7" />
    <path d="M3 7h18" />
    <path d="M7 7v10" />
    <path d="M17 7v10" />
    <path d="M7 11h10" />
    <path d="M7 14h10" />
  </Svg>
);

// AX212 — remote start key fob with signal waves.
export const RemoteStartFob = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="9" width="7" height="12" rx="2.5" />
    <circle cx="12" cy="13" r="1" />
    <path d="M10.5 17.5h3" />
    <path d="M9 5.5a5 5 0 0 1 6 0" />
    <path d="M7 3a8.5 8.5 0 0 1 10 0" />
  </Svg>
);

// EV202 — charging cable with plug head.
export const ChargingCable = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M7 4v4" />
    <path d="M11 4v4" />
    <path d="M5.5 8h7a0 0 0 0 1 0 0v2a3.5 3.5 0 0 1-3.5 3.5h0A3.5 3.5 0 0 0 5.5 17v0a3.5 3.5 0 0 0 3.5 3.5h5.5a4 4 0 0 0 4-4V13" />
    <path d="M16.5 13h4" />
  </Svg>
);

// EV203 — charge port with connector pins.
export const ChargingPort = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="9" cy="10" r="1.2" />
    <circle cx="15" cy="10" r="1.2" />
    <circle cx="9" cy="15" r="1.2" />
    <circle cx="15" cy="15" r="1.2" />
  </Svg>
);

// EV204 — charging station pillar with bolt.
export const ChargingStation = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="9" height="18" rx="1.5" />
    <path d="M10.2 7.5L8 11.5h3l-2.2 4" />
    <path d="M14 9h2.5a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" />
  </Svg>
);

// EV205 — hybrid: leaf paired with a bolt.
export const HybridLeafBolt = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4 13c0-4.5 3.5-8 9-8-0.5 5.5-3 9.5-9 9.5" />
    <path d="M4 14.5C5.5 12 8 10 11 9" />
    <path d="M17.5 11l-2.5 4.5h3.5L16 21" />
  </Svg>
);

// EV206 — plug-in hybrid: leaf with charging plug.
export const PlugInHybrid = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4 13c0-4.5 3.5-8 9-8-0.5 5.5-3 9.5-9 9.5" />
    <path d="M4 14.5C5.5 12 8 10 11 9" />
    <path d="M16 11v3" />
    <path d="M20 11v3" />
    <path d="M15 14h6v1.5a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3V14z" />
    <path d="M18 18.5V21" />
  </Svg>
);

// WA202 — deployed airbag against the column.
export const Airbag = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="14" cy="13" r="6" />
    <path d="M4 3h4a2 2 0 0 1 2 2v2" />
    <path d="M4 21h3" />
    <path d="M14 10.5s1.8 1.4 1.8 2.7a1.8 1.8 0 0 1-3.6 0c0-1.3 1.8-2.7 1.8-2.7z" />
  </Svg>
);

// WA203 — odometer gauge with alert mark.
export const GaugeAlert = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M4.5 19a9 9 0 1 1 15 0" />
    <path d="M12 13l3.5-3.5" />
    <circle cx="12" cy="13" r="1" />
    <path d="M19.5 15.5v3" />
    <circle cx="19.5" cy="21" r="0.4" />
  </Svg>
);

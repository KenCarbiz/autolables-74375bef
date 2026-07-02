import * as React from "react";

// Custom SVG icons the libraries don't carry (passport identity, addendum
// documents, tint/film accessories). Every icon follows the locked style
// rules so it sits next to Lucide artwork without looking off:
//   24x24 viewBox · 2px stroke · round caps · round joins · currentColor ·
//   no fills, gradients, shadows, or sub-2px detail.
// Icons marked custom_required in the manifest render these as stand-ins
// until final artwork replaces the path data — templates never change.

export interface CustomIconProps extends Omit<React.SVGProps<SVGSVGElement>, "strokeWidth"> {
  size?: number | string;
  strokeWidth?: number | string;
}

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

// P001 — passport booklet: cover, spine, centered emblem.
export const PassportBook = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M9 16h6" />
  </Svg>
);

// P002 — shield with passport spine line.
export const PassportShield = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    <path d="M12 8v6" />
    <path d="M9 11h6" />
  </Svg>
);

// P003 — round badge with ribbon tails.
export const PassportBadge = (p: CustomIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="5" />
    <path d="M9 13.5L8 21l4-2 4 2-1-7.5" />
  </Svg>
);

// P004 — entry stamp: base, handle, impression line.
export const PassportStamp = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M9 11V7a3 3 0 0 1 6 0v4" />
    <path d="M6 11h12l1 5H5l1-5z" />
    <path d="M5 20h14" />
  </Svg>
);

// P005 — phone with shield on screen.
export const DigitalPassport = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M12 7l3 1.2v2.3c0 2-1.3 3.8-3 4.5-1.7-.7-3-2.5-3-4.5V8.2L12 7z" />
  </Svg>
);

// P006 — shield with simple vehicle silhouette.
export const VehiclePassportShield = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    <path d="M8.5 12.5l1-2.5h5l1 2.5" />
    <path d="M8 14.5h8" />
  </Svg>
);

// P007 — QR tile with passport spine.
export const PassportQr = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 8h3v3H8z" />
    <path d="M13 8h3" />
    <path d="M16 11v2" />
    <path d="M8 15h2" />
    <path d="M13 15h3v1" />
  </Svg>
);

// P008 — booklet with verification check.
export const PassportVerified = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 11l2.2 2.2L15.5 9" />
    <path d="M9 17h6" />
  </Svg>
);

// P009 — stacked passport pages.
export const PassportDocuments = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M8 3h9a2 2 0 0 1 2 2v12" />
    <rect x="5" y="7" width="11" height="14" rx="2" />
    <path d="M8 12h5" />
    <path d="M8 16h5" />
  </Svg>
);

// P010 — booklet with history clock.
export const PassportHistory = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M8 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
    <circle cx="15" cy="16" r="5" />
    <path d="M15 14v2l1.5 1.5" />
  </Svg>
);

// P011 — booklet under a protective shield corner.
export const PassportProtection = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M9 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
    <path d="M16 12l4 1.6v2.4c0 2.6-1.7 4.9-4 5.8-2.3-.9-4-3.2-4-5.8v-2.4L16 12z" />
  </Svg>
);

// P012 — booklet with benefit star.
export const PassportBenefits = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M9 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
    <path d="M16 12.5l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.9 2.6-.4 1.2-2.4z" />
  </Svg>
);

// A001 — window tint: glass pane with shading strokes.
export const WindowTint = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M8 19L18 9" />
    <path d="M5 16L15 6" />
  </Svg>
);

// A002 — paint protection film: panel with peeled corner.
export const PaintProtectionFilm = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M13 20l7-7" />
    <path d="M13 20v-5a2 2 0 0 1 2-2h5" />
  </Svg>
);

// D0xx — window sticker: hung sheet with price block.
export const WindowSticker = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M12 2v3" />
    <rect x="6" y="5" width="12" height="17" rx="2" />
    <path d="M9 10h6" />
    <path d="M9 14h6" />
    <path d="M9 18h3" />
  </Svg>
);

// D0xx — addendum sheet: page joined below a primary label.
export const AddendumSheet = (p: CustomIconProps) => (
  <Svg {...p}>
    <path d="M7 2h10v5H7z" />
    <path d="M9 7v2" />
    <path d="M15 7v2" />
    <rect x="7" y="9" width="10" height="13" rx="2" />
    <path d="M10 14h4" />
    <path d="M10 18h4" />
  </Svg>
);

// Generic stand-in for custom_required entries awaiting final artwork:
// dashed tile with a plus, unmistakably "not final".
export const PlaceholderGlyph = (p: CustomIconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
    <path d="M12 9v6" />
    <path d="M9 12h6" />
  </Svg>
);

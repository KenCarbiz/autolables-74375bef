// ──────────────────────────────────────────────────────────────────────
// AutoLabels vehicle-spec + customer-page icon set. Same locked style as
// the tool registry: 24x24 viewbox, 2px stroke, rounded caps/joins,
// automotive-specific shapes. Primary stroke inherits currentColor (navy
// in customer cards); the distinguishing detail reads
// var(--al-icon-accent) (AutoLabels blue). Each vehicle fact gets its own
// visual language — never a repeated generic gauge.
// ──────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode, SVGProps } from "react";

export type AutoLabelsSpecIconKey =
  | "odometer" | "drivetrain" | "engine" | "shifter"
  | "vin-barcode" | "copy" | "paint" | "seat"
  | "price-tag" | "camera" | "shield-check" | "clean-title"
  | "calendar" | "calendar-check" | "morning" | "afternoon" | "evening"
  | "user" | "email" | "phone" | "message" | "paper-plane"
  | "lock" | "people" | "trade" | "reserve" | "passport";

type IconProps = SVGProps<SVGSVGElement>;
const ACCENT = "var(--al-icon-accent, currentColor)";

const Svg = ({ children, ...props }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
);

// ── Vehicle spec row ──────────────────────────────────────────────────

// Mileage — odometer number window under a dial arc (not a speedometer).
const OdometerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.25 7.25a6.5 6.5 0 0 1 9.5 0" />
    <rect x="3.75" y="10.5" width="16.5" height="7.5" rx="1.5" />
    <path d="M8.25 10.5v7.5M12 10.5v7.5M15.75 10.5v7.5" stroke={ACCENT} />
  </Svg>
);

// 4WD / AWD — two axles, driveshaft, center differential.
const DrivetrainIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="3.25" height="6.25" rx="1.4" />
    <rect x="16.75" y="3.5" width="3.25" height="6.25" rx="1.4" />
    <rect x="4" y="14.25" width="3.25" height="6.25" rx="1.4" />
    <rect x="16.75" y="14.25" width="3.25" height="6.25" rx="1.4" />
    <path d="M7.25 6.6h9.5M7.25 17.4h9.5" />
    <path d="M12 6.6v10.8" stroke={ACCENT} />
    <circle cx="12" cy="12" r="1.9" stroke={ACCENT} />
  </Svg>
);

// Engine block — intake stub, block, mount, output shaft.
const EngineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4.5h5M11.5 4.5V7" />
    <rect x="5.25" y="7" width="12.5" height="9.5" rx="1.5" />
    <path d="M5.25 11.75H2.75M2.75 9.25v5" />
    <path d="M17.75 10.25h3.5v4.5" stroke={ACCENT} />
    <path d="M8.5 10.5h4M8.5 13.5h6" stroke={ACCENT} />
    <path d="M9.5 16.5v2.25M14 16.5v2.25" />
  </Svg>
);

// Transmission — H-gate shift pattern with the knob on the selected leg.
const ShifterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 5v7.5M18 5v7.5" />
    <path d="M6 8.75h12" />
    <path d="M12 5v11" />
    <circle cx="12" cy="18.75" r="2.25" stroke={ACCENT} />
    <circle cx="6" cy="4.25" r="0.4" /><circle cx="12" cy="4.25" r="0.4" /><circle cx="18" cy="4.25" r="0.4" />
  </Svg>
);

// VIN — plate with scan bars (matches the addendum VIN language).
const VinBarcodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.25" y="6" width="17.5" height="12" rx="1.5" />
    <path d="M6.5 9.25v5.5M9.25 9.25v5.5M11.75 9.25v3M14.25 9.25v5.5" stroke={ACCENT} />
    <path d="M16.75 9.25v5.5M18.5 9.25v3" />
  </Svg>
);

// Copy action — duplicate squares.
const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5.5 14.75h-.75A1.75 1.75 0 0 1 3 13V4.75A1.75 1.75 0 0 1 4.75 3H13a1.75 1.75 0 0 1 1.75 1.75v.75" stroke={ACCENT} />
  </Svg>
);

// Exterior color — paint droplet over a swatch line.
const PaintIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.25s4.75 5.3 4.75 8.5a4.75 4.75 0 0 1-9.5 0c0-3.2 4.75-8.5 4.75-8.5Z" />
    <path d="M9.9 12.25a2.1 2.1 0 0 0 1.7 2.05" stroke={ACCENT} />
    <path d="M5.5 20.5h13" stroke={ACCENT} />
  </Svg>
);

// Interior color — side-profile seat.
const SeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.1 3.75c-1.45 0-2.35 1.2-2.1 2.6l1.1 6.35c.2 1.2 1.15 2.05 2.35 2.05h6.3" />
    <path d="M9.15 14.75l-.55 4.5M15.4 14.75l.6 4.5" />
    <path d="M6.75 19.75h10.5" stroke={ACCENT} />
  </Svg>
);

// Price — hang tag with punched hole.
const PriceTagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.9 3.25h5.1a2 2 0 0 1 2 2v5.1a2 2 0 0 1-.59 1.42l-7.44 7.44a2 2 0 0 1-2.83 0l-4.75-4.75a2 2 0 0 1 0-2.83l7.44-7.44a2 2 0 0 1 1.42-.59Z" />
    <circle cx="16.1" cy="7.9" r="1.4" stroke={ACCENT} />
  </Svg>
);

// Photos — camera with accent lens.
const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7.5h2.9l1.5-2.25h6.2l1.5 2.25h2.9A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5Z" />
    <circle cx="12" cy="13" r="3.25" stroke={ACCENT} />
  </Svg>
);

// Trust / verification shield.
const ShieldCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.9 18.6 5.3v4.9c0 4-2.55 6.55-6.6 8.05-4.05-1.5-6.6-4.05-6.6-8.05V5.3Z" />
    <path d="m9 11.1 2.3 2.3 3.9-4.2" stroke={ACCENT} />
  </Svg>
);

// Clean title — document with verified check.
const CleanTitleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 21H6A1.5 1.5 0 0 1 4.5 19.5v-15A1.5 1.5 0 0 1 6 3h8.5L19.5 8v11.5A1.5 1.5 0 0 1 18 21h-2.5Z" />
    <path d="M14.5 3v5h5" />
    <path d="m8.75 13.75 2.15 2.15 3.85-4.15" stroke={ACCENT} />
  </Svg>
);

// ── Customer scheduling / contact set ─────────────────────────────────

const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="5" width="16.5" height="15" rx="2" />
    <path d="M3.75 9.5h16.5M8 3v4M16 3v4" />
    <rect x="7.25" y="12.5" width="3.25" height="3.25" rx="0.8" stroke={ACCENT} />
  </Svg>
);

const CalendarCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="5" width="16.5" height="15" rx="2" />
    <path d="M3.75 9.5h16.5M8 3v4M16 3v4" />
    <path d="m9 14.5 2.15 2.15 3.85-4.15" stroke={ACCENT} />
  </Svg>
);

// Morning — sunrise over the horizon.
const MorningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17.5h16" />
    <path d="M8.25 17.5a3.75 3.75 0 0 1 7.5 0" stroke={ACCENT} />
    <path d="M12 8.75V6M6.6 12.1 4.9 10.4M17.4 12.1l1.7-1.7" stroke={ACCENT} />
  </Svg>
);

// Afternoon — full sun.
const AfternoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.5" stroke={ACCENT} />
    <path d="M12 3.5v2.25M12 18.25v2.25M3.5 12h2.25M18.25 12h2.25M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
  </Svg>
);

// Evening — crescent moon with a spark.
const EveningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 14.25A7.75 7.75 0 1 1 9.75 4.5a6.25 6.25 0 0 0 9.75 9.75Z" />
    <path d="M17.75 4.5v3M16.25 6h3" stroke={ACCENT} />
  </Svg>
);

const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.25 20c.9-3.4 3.6-5 6.75-5s5.85 1.6 6.75 5" stroke={ACCENT} />
  </Svg>
);

const EmailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.25" y="5.25" width="17.5" height="13.5" rx="2" />
    <path d="m4.5 7.25 7.5 5.75 7.5-5.75" stroke={ACCENT} />
  </Svg>
);

const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.7 3.75c.5 0 .95.3 1.13.77l1.06 2.72c.17.44.07.94-.26 1.28l-1.3 1.3a12.5 12.5 0 0 0 5.85 5.85l1.3-1.3c.34-.33.84-.43 1.28-.26l2.72 1.06c.47.18.77.63.77 1.13v2.2c0 .97-.83 1.75-1.79 1.63C9.9 19.9 4.1 14.1 3.87 5.54 3.85 4.58 4.63 3.75 5.6 3.75Z" />
  </Svg>
);

const MessageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 11.5c0 4-3.8 7-8.5 7-1 0-2-.14-2.9-.4L4.5 19.5l1.2-3.2c-1.35-1.25-2.2-2.9-2.2-4.8 0-4 3.8-7 8.5-7s8.5 3 8.5 7Z" />
    <path d="M8.25 11.5h.01M12 11.5h.01M15.75 11.5h.01" stroke={ACCENT} strokeWidth={2.6} />
  </Svg>
);

const PaperPlaneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.6 3.4 4 9.9c-.9.35-.85 1.62.07 1.9l6.2 1.93 1.93 6.2c.28.92 1.55.97 1.9.07L20.6 3.4Z" />
    <path d="m20.6 3.4-10.3 10.3" stroke={ACCENT} />
  </Svg>
);

const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.25" y="10.5" width="13.5" height="9.5" rx="2" />
    <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" stroke={ACCENT} />
    <path d="M12 14.25v2" stroke={ACCENT} />
  </Svg>
);

// No pressure, just answers — two people.
const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8.25" r="3" />
    <path d="M3.75 19.5c.7-2.9 2.85-4.25 5.25-4.25s4.55 1.35 5.25 4.25" />
    <circle cx="16.75" cy="9.25" r="2.4" stroke={ACCENT} />
    <path d="M16 15.35c2.1.15 3.75 1.45 4.35 3.9" stroke={ACCENT} />
  </Svg>
);

// Trade value — circular exchange arrows.
const TradeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 9.5a7.5 7.5 0 0 1 12.9-3.4L20 8.5" />
    <path d="M20 4.5v4h-4" />
    <path d="M19.25 14.5a7.5 7.5 0 0 1-12.9 3.4L4 15.5" stroke={ACCENT} />
    <path d="M4 19.5v-4h4" stroke={ACCENT} />
  </Svg>
);

// Reserve — badge with hold check.
const ReserveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.25 14.3 5.1l2.9-.35 1.15 2.7 2.4 1.65-.85 2.9.85 2.9-2.4 1.65-1.15 2.7-2.9-.35L12 20.75 9.7 18.9l-2.9.35-1.15-2.7-2.4-1.65.85-2.9-.85-2.9 2.4-1.65 1.15-2.7 2.9.35Z" />
    <path d="m9.1 12.1 2.15 2.15 3.75-4.1" stroke={ACCENT} />
  </Svg>
);

// Vehicle Passport — booklet with car mark.
const PassportIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.25" width="14" height="17.5" rx="2" />
    <path d="M8.4 12.4l.85-2.15c.2-.5.65-.8 1.15-.8h3.2c.5 0 .95.3 1.15.8l.85 2.15" stroke={ACCENT} />
    <path d="M8 12.4h8v2.35H8Z" stroke={ACCENT} />
    <path d="M9 17.75h6" />
  </Svg>
);

export const AUTOLABELS_SPEC_ICONS: Record<AutoLabelsSpecIconKey, (p: IconProps) => JSX.Element> = {
  "odometer": OdometerIcon,
  "drivetrain": DrivetrainIcon,
  "engine": EngineIcon,
  "shifter": ShifterIcon,
  "vin-barcode": VinBarcodeIcon,
  "copy": CopyIcon,
  "paint": PaintIcon,
  "seat": SeatIcon,
  "price-tag": PriceTagIcon,
  "camera": CameraIcon,
  "shield-check": ShieldCheckIcon,
  "clean-title": CleanTitleIcon,
  "calendar": CalendarIcon,
  "calendar-check": CalendarCheckIcon,
  "morning": MorningIcon,
  "afternoon": AfternoonIcon,
  "evening": EveningIcon,
  "user": UserIcon,
  "email": EmailIcon,
  "phone": PhoneIcon,
  "message": MessageIcon,
  "paper-plane": PaperPlaneIcon,
  "lock": LockIcon,
  "people": PeopleIcon,
  "trade": TradeIcon,
  "reserve": ReserveIcon,
  "passport": PassportIcon,
};

export function AutoLabelsSpecIcon({
  name, accent = "#0B6FEA", className, style,
}: { name: AutoLabelsSpecIconKey; accent?: string; className?: string; style?: CSSProperties }) {
  const Cmp = AUTOLABELS_SPEC_ICONS[name];
  if (!Cmp) return null;
  return <Cmp className={className} style={{ "--al-icon-accent": accent, ...style } as CSSProperties} />;
}

// Light-blue rounded badge container used by customer support cards.
export function SpecIconBadge({ name, size = 44 }: { name: AutoLabelsSpecIconKey; size?: number }) {
  return (
    <span
      className="rounded-xl bg-[#EAF4FF] text-[#0B6FEA] flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <AutoLabelsSpecIcon name={name} accent="#0B6FEA" className="text-[#0B6FEA]" style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}

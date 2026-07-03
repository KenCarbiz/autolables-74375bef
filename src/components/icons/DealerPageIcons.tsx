// ──────────────────────────────────────────────────────────────────────
// Dealer Page icon set — the locked registry for the "Why Buy From"
// dealer trust page, drawn to the approved asset board (IDs I01–I49).
// Same locked style as the tool/spec registries: 24x24 viewbox, 2px
// stroke, rounded caps/joins. Primary stroke inherits currentColor; the
// distinguishing detail reads var(--al-icon-accent). Every board asset
// has exactly one key — never substitute generic icon sets on the page.
// ──────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode, SVGProps } from "react";

export type DealerPageIconKey =
  | "dealer-verified" | "vehicle-passport-partner"
  | "reserve-vehicle" | "schedule-test-drive" | "get-directions"
  | "up-front-pricing" | "secure-reservation" | "transparent-pricing"
  | "no-pressure" | "complete-vehicle-disclosure" | "prompt-communication" | "customer-first"
  | "factory-trained-technicians" | "genuine-oem-parts" | "warranty-support"
  | "certified-pre-owned-support" | "recall-service-support" | "luxury-ownership"
  | "customer-satisfaction" | "certified-service" | "pickup-return" | "loaner-vehicles"
  | "address-location" | "phone" | "hours" | "map-directions"
  | "complete-disclosure" | "factory-trained-staff" | "respectful-experience" | "message-team"
  | "passport-mark-1" | "passport-mark-2" | "passport-mark-3";

// Dealer page color system. Blue = passport/actions/info, green =
// verified/trust, purple = OEM expertise/premium, gold = ratings only,
// navy = neutral.
export const dealerPageIconColors = {
  navy: "#0D1B2A",
  blue: "#0B6FEA",
  blueSoft: "#EAF4FF",
  green: "#16A34A",
  greenSoft: "#EAF6EF",
  purple: "#6D28D9",
  purpleSoft: "#F4ECFF",
  gold: "#F59E0B",
  muted: "#64748B",
  border: "#DDE5EE",
} as const;

type IconProps = SVGProps<SVGSVGElement>;
const ACCENT = "var(--al-icon-accent, currentColor)";

const Svg = ({ children, ...props }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
);

// ── Trust & identity ──────────────────────────────────────────────────

// I09/I03 — Dealer Verified: trust shield with bold verification check.
const DealerVerifiedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" />
    <path d="m8.75 11 2.4 2.4 4.1-4.4" stroke={ACCENT} />
  </Svg>
);

// I10/I04 — Vehicle Passport Partner: ID/passport card with person + check.
const VehiclePassportPartnerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.75" width="18" height="14.5" rx="2" />
    <circle cx="8.25" cy="9.9" r="1.9" />
    <path d="M5.5 15.75c.5-1.6 1.5-2.4 2.75-2.4s2.25.8 2.75 2.4" />
    <path d="M14 9h4.5M14 12h3" />
    <path d="m14.25 15.4 1.15 1.15 2.1-2.25" stroke={ACCENT} />
  </Svg>
);

// ── Actions ───────────────────────────────────────────────────────────

// I06/I43 — Reserve This Vehicle: banded reservation shield with check.
const ReserveVehicleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.25 18 5.5v4.6c0 3.9-2.35 6.35-6 7.9-3.65-1.55-6-4-6-7.9V5.5Z" />
    <path d="M6.5 8.25h11" />
    <path d="m9.4 12.6 1.95 1.95 3.25-3.6" stroke={ACCENT} />
  </Svg>
);

// I07/I44 — Schedule Test Drive: appointment calendar with confirm check.
const ScheduleTestDriveIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="5" width="16.5" height="15" rx="2" />
    <path d="M3.75 9.5h16.5M8 3v4M16 3v4" />
    <path d="m9 14.5 2.15 2.15 3.85-4.15" stroke={ACCENT} />
  </Svg>
);

// I08/I46 — Get Directions: navigation arrow.
const GetDirectionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.4 3.6 12.9 20.9c-.4.9-1.7.8-1.95-.15L9.4 14.6l-6.15-1.55c-.95-.25-1.05-1.55-.15-1.95Z" />
    <path d="M9.4 14.6 20.4 3.6" stroke={ACCENT} />
  </Svg>
);

// I11 — Up-Front Pricing: hang tag with dollar detail.
const UpFrontPricingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.9 3.25h5.1a2 2 0 0 1 2 2v5.1a2 2 0 0 1-.59 1.42l-7.44 7.44a2 2 0 0 1-2.83 0l-4.75-4.75a2 2 0 0 1 0-2.83l7.44-7.44a2 2 0 0 1 1.42-.59Z" />
    <circle cx="16.1" cy="7.9" r="1.4" />
    <path d="M12 11.3c-.45-.85-1.55-1.05-2.3-.5-.85.6-.75 1.85.2 2.3l1 .5c.95.45 1.05 1.7.2 2.3-.75.55-1.85.35-2.3-.5" stroke={ACCENT} />
    <path d="M10.4 9.75v1.1M10.4 15.95v1.1" stroke={ACCENT} />
  </Svg>
);

// I12 — Secure Reservation: padlock.
const SecureReservationIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.25" y="10.5" width="13.5" height="9.5" rx="2" />
    <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" stroke={ACCENT} />
    <path d="M12 14.25v2" stroke={ACCENT} />
  </Svg>
);

// I13/I37 — Transparent Pricing: horizontal price tag with dollar detail.
const TransparentPricingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.9 5.75h8.35a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H9.9a2 2 0 0 1-1.6-.8L4.4 13.2a2 2 0 0 1 0-2.4l3.9-4.25c.38-.5.97-.8 1.6-.8Z" />
    <circle cx="9.1" cy="12" r="1.1" />
    <path d="M16.4 9.95c-.45-.85-1.6-1.1-2.4-.55-.9.6-.8 1.9.15 2.35l1.15.55c.95.45 1.05 1.75.15 2.35-.8.55-1.95.3-2.4-.55" stroke={ACCENT} />
    <path d="M14.9 8.4v1.1M14.9 15.5v1.1" stroke={ACCENT} />
  </Svg>
);

// ── Why customers choose us ───────────────────────────────────────────

// I14 — No Pressure: friendly person with an open, supportive hand.
const NoPressureIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9.5" cy="7.25" r="3.25" />
    <path d="M4 20c.8-3.2 3-4.75 5.5-4.75 1.35 0 2.6.45 3.6 1.35" />
    <path d="M15.9 12.9v-2.2M18 13.2V9.6M20.1 12.9v-2.2" stroke={ACCENT} />
    <path d="M15.9 12.9c0 2.2.95 3.6 2.1 3.6s2.1-1.4 2.1-3.6" stroke={ACCENT} />
  </Svg>
);

// I15 — Complete Vehicle Disclosure: checklist document under a magnifier.
const CompleteVehicleDisclosureIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5h9L18.5 7v4" />
    <path d="m7.5 8 1 1 1.75-2M7.5 12.5l1 1 1.75-2" />
    <path d="M12.25 8.5h3M12.25 13h1.5" />
    <circle cx="16.25" cy="16.25" r="3" stroke={ACCENT} />
    <path d="m18.5 18.5 2.75 2.75" stroke={ACCENT} />
  </Svg>
);

// I16/I41 — Prompt Communication: chat bubble with message lines.
const PromptCommunicationIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 11.5c0 4-3.8 7-8.5 7-1 0-2-.14-2.9-.4L4.5 19.5l1.2-3.2c-1.35-1.25-2.2-2.9-2.2-4.8 0-4 3.8-7 8.5-7s8.5 3 8.5 7Z" />
    <path d="M8.25 10h7.5M8.25 13.25h4.5" stroke={ACCENT} />
  </Svg>
);

// I17/I42 — Customer-First: person with heart.
const CustomerFirstIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9.75" cy="7.5" r="3.25" />
    <path d="M4.25 20c.85-3.3 3.05-4.9 5.5-4.9 1 0 1.95.2 2.8.6" />
    <path d="M17.6 13.15c1.3-1.2 3.4-.35 3.4 1.35 0 1.6-2.05 2.9-3.4 3.75-1.35-.85-3.4-2.15-3.4-3.75 0-1.7 2.1-2.55 3.4-1.35Z" stroke={ACCENT} />
  </Svg>
);

// ── OEM expertise ─────────────────────────────────────────────────────

// I18 — Factory-Trained Technicians: technician with wrench.
const FactoryTrainedTechniciansIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="7.5" r="3.25" />
    <path d="M3.5 20c.8-3.2 3.05-4.75 5.5-4.75 1.15 0 2.2.35 3.1 1" />
    <path d="M21 13.4a2.4 2.4 0 0 1-3.1 3.1l-2.15 2.15" stroke={ACCENT} />
    <path d="M17.9 10.3a2.4 2.4 0 0 0-2 2.35" stroke={ACCENT} />
  </Svg>
);

// I19 — Genuine OEM Parts: machined gear.
const GenuineOemPartsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.9 3.5h2.2l.45 2.05 1.9.8 1.75-1.15 1.55 1.55-1.15 1.75.8 1.9 2.05.45v2.2l-2.05.45-.8 1.9 1.15 1.75-1.55 1.55-1.75-1.15-1.9.8-.45 2.05h-2.2l-.45-2.05-1.9-.8-1.75 1.15-1.55-1.55 1.15-1.75-.8-1.9-2.05-.45v-2.2l2.05-.45.8-1.9-1.15-1.75L6.6 5.2l1.75 1.15 1.9-.8Z" />
    <circle cx="12" cy="12" r="3" stroke={ACCENT} />
  </Svg>
);

// I20/I31 — Warranty Support: shield-check with inner coverage keyline.
const WarrantySupportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" />
    <path d="M12 6.1 15.75 7.5v2.8c0 2.3-1.45 3.75-3.75 4.65-2.3-.9-3.75-2.35-3.75-4.65V7.5Z" stroke={ACCENT} />
    <path d="m10.4 10.35 1.25 1.25 2-2.15" stroke={ACCENT} strokeWidth={1.75} />
  </Svg>
);

// I21 — Certified Pre-Owned Support: certified ribbon seal (generic form —
// the OEM mark itself comes from the logo registry, never drawn here).
const CertifiedPreOwnedSupportIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m9.5 8.75 1.75 1.75 3.25-3.25" stroke={ACCENT} />
    <path d="m9 13.75-1.5 6 4.5-2.5 4.5 2.5-1.5-6" />
  </Svg>
);

// I22 — Recall & Service Support: repair-order clipboard with check.
const RecallServiceSupportIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="16.5" rx="1.75" />
    <rect x="8.75" y="2.5" width="6.5" height="3" rx="1" />
    <path d="m8.75 12.25 2.25 2.25 4.25-4.6" stroke={ACCENT} />
    <path d="M9 17.5h6" />
  </Svg>
);

// I23 — Luxury Ownership: crown.
const LuxuryOwnershipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 7.75 8.4 10.6 12 5.25l3.6 5.35 3.65-2.85-1.4 8.75H6.15Z" />
    <path d="M6.15 19.75h11.7" stroke={ACCENT} />
  </Svg>
);

// ── Service & ownership support ───────────────────────────────────────

// I27 — Customer Satisfaction: group of people.
const CustomerSatisfactionIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="7.25" r="3" />
    <path d="M6.75 19.5c.7-2.9 2.85-4.4 5.25-4.4s4.55 1.5 5.25 4.4" />
    <circle cx="18.35" cy="8.6" r="2.1" stroke={ACCENT} />
    <path d="M17.75 14.55c2.1.3 3.5 1.55 4 3.8" stroke={ACCENT} />
    <circle cx="5.65" cy="8.6" r="2.1" stroke={ACCENT} />
    <path d="M6.25 14.55c-2.1.3-3.5 1.55-4 3.8" stroke={ACCENT} />
  </Svg>
);

// I28 — Certified Service: technician with cross-body wrench.
const CertifiedServiceIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="14.75" cy="7" r="3" />
    <path d="M9.75 19.75c.7-2.9 2.6-4.4 5-4.4s4.3 1.5 5 4.4" />
    <path d="M10.4 5.2a3.3 3.3 0 0 0-4.45 4.45L3 12.6 5.4 15l2.95-2.95a3.3 3.3 0 0 0 4.45-4.45l-1.9 1.9-2-.5-.5-2Z" stroke={ACCENT} />
  </Svg>
);

// I29 — Pickup & Return: compact car inside circular exchange arrows.
const PickupReturnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 9.25A7.6 7.6 0 0 1 17.4 6.4L19 8" stroke={ACCENT} />
    <path d="M19 4.25V8h-3.75" stroke={ACCENT} />
    <path d="M19.25 14.75A7.6 7.6 0 0 1 6.6 17.6L5 16" stroke={ACCENT} />
    <path d="M5 19.75V16h3.75" stroke={ACCENT} />
    <path d="m8.85 12.9.85-1.75c.2-.4.6-.65 1.05-.65h2.5c.45 0 .85.25 1.05.65l.85 1.75" />
    <path d="M8.35 12.9h7.3v2H8.35Z" />
    <circle cx="10.1" cy="14" r="0.35" fill="currentColor" />
    <circle cx="13.9" cy="14" r="0.35" fill="currentColor" />
  </Svg>
);

// I30 — Loaner Vehicles: clean car outline.
const LoanerVehiclesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 16h-.75a1.25 1.25 0 0 1-1.25-1.25V12.5a2 2 0 0 1 2-2h.55L7 6.6a2 2 0 0 1 1.75-1.05h6.5A2 2 0 0 1 17 6.6l1.95 3.9h.55a2 2 0 0 1 2 2v2.25A1.25 1.25 0 0 1 20.25 16h-.75" />
    <circle cx="8" cy="16.25" r="1.9" stroke={ACCENT} />
    <circle cx="16" cy="16.25" r="1.9" stroke={ACCENT} />
    <path d="M9.9 16.25h4.2" />
  </Svg>
);

// ── Visit us ──────────────────────────────────────────────────────────

// I32 — Address & Location: map pin.
const AddressLocationIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.25s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.6" stroke={ACCENT} />
  </Svg>
);

// I33 — Phone: handset with call waves.
const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.7 3.75c.5 0 .95.3 1.13.77l1.06 2.72c.17.44.07.94-.26 1.28l-1.3 1.3a12.5 12.5 0 0 0 5.85 5.85l1.3-1.3c.34-.33.84-.43 1.28-.26l2.72 1.06c.47.18.77.63.77 1.13v2.2c0 .97-.83 1.75-1.79 1.63C9.9 19.9 4.1 14.1 3.87 5.54 3.85 4.58 4.63 3.75 5.6 3.75Z" />
    <path d="M14.4 6.9a3.6 3.6 0 0 1 2.7 2.7M15 3.5a6.9 6.9 0 0 1 5.5 5.5" stroke={ACCENT} />
  </Svg>
);

// I34 — Hours: clock.
const HoursIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.25V12l3.1 1.9" stroke={ACCENT} />
  </Svg>
);

// I35 — Map & Directions: folded map with route marker.
const MapDirectionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 4.5-5.25 1.9v13.1L9 17.6l6 1.9 5.25-1.9V4.5L15 6.4Z" />
    <path d="M9 4.5v13.1M15 6.4v13.1" />
    <path d="m14.15 9.4-2.7 5.8-.65-2.45-2.45-.65Z" stroke={ACCENT} />
  </Svg>
);

// ── Commitment band ───────────────────────────────────────────────────

// I38 — Complete Disclosure: checklist document with disclosure check.
const CompleteDisclosureIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 21H6A1.5 1.5 0 0 1 4.5 19.5v-15A1.5 1.5 0 0 1 6 3h8.5L19.5 8v11.5A1.5 1.5 0 0 1 18 21h-2.5Z" />
    <path d="M14.5 3v5h5" />
    <path d="M8 11.5h8M8 14.5h4.5M8 17.5h4.5" />
    <path d="m14.6 16.4 1.4 1.4 2.35-2.55" stroke={ACCENT} />
  </Svg>
);

// I39 — Factory-Trained Staff: staff group with certification badge.
const FactoryTrainedStaffIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="7.75" r="3" />
    <path d="M3.75 19.5c.7-2.9 2.8-4.4 5.25-4.4 1.5 0 2.8.55 3.75 1.6" />
    <circle cx="16.25" cy="6.5" r="2.25" />
    <path d="M15.4 12.15c1.9.1 3.35 1 4.1 2.6" />
    <circle cx="17.5" cy="18.1" r="2.9" stroke={ACCENT} />
    <path d="m16.3 18.1.95.95 1.55-1.7" stroke={ACCENT} />
  </Svg>
);

// I40 — Respectful Experience: heart offered in an open hand.
const RespectfulExperienceIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.75 4.85c1.35-1.25 3.5-.35 3.5 1.4 0 1.65-2.1 3-3.5 3.9-1.4-.9-3.5-2.25-3.5-3.9 0-1.75 2.15-2.65 3.5-1.4Z" stroke={ACCENT} />
    <path d="M11 15.5h2.55a1.7 1.7 0 0 0 0-3.4h-2.6c-.55 0-1.05.2-1.4.6L6 15.5" />
    <path d="m9.75 19.5 1.05-.9c.35-.35.8-.6 1.4-.6h3.35c.95 0 1.85-.35 2.5-1.05l3.2-3.1a1.72 1.72 0 0 0-2.35-2.5l-2.55 2.35" />
    <path d="m3.5 14.25 5.25 5.25" />
  </Svg>
);

// I45 — Message Team: chat bubble with typing dots.
const MessageTeamIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 11.5c0 4-3.8 7-8.5 7-1 0-2-.14-2.9-.4L4.5 19.5l1.2-3.2c-1.35-1.25-2.2-2.9-2.2-4.8 0-4 3.8-7 8.5-7s8.5 3 8.5 7Z" />
    <path d="M8.25 11.5h.01M12 11.5h.01M15.75 11.5h.01" stroke={ACCENT} strokeWidth={2.6} />
  </Svg>
);

// ── Master passport marks ─────────────────────────────────────────────

// I47 — Passport mark option 1: blue shield-check passport mark.
const PassportMark1Icon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.4 19.6 5.15v5.2c0 4.5-2.9 7.3-7.6 9.05-4.7-1.75-7.6-4.55-7.6-9.05v-5.2Z" />
    <path d="m8.4 11.6 2.5 2.5 4.7-5.1" stroke={ACCENT} />
  </Svg>
);

// I48 — Passport mark option 2: circular verified seal.
const PassportMark2Icon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.75" />
    <circle cx="12" cy="12" r="5.9" strokeDasharray="2.4 2.1" />
    <path d="m9.4 12 1.85 1.85 3.35-3.7" stroke={ACCENT} />
  </Svg>
);

// I49 — Passport mark option 3: digital vehicle record document.
const PassportMark3Icon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 21H6A1.5 1.5 0 0 1 4.5 19.5v-15A1.5 1.5 0 0 1 6 3h8.5L19.5 8v11.5A1.5 1.5 0 0 1 18 21h-2.5Z" />
    <path d="M14.5 3v5h5" />
    <path d="m8.6 13.4.8-1.65c.2-.4.55-.65 1-.65h3.2c.45 0 .8.25 1 .65l.8 1.65" stroke={ACCENT} />
    <path d="M8.2 13.4h7.6v1.9H8.2Z" stroke={ACCENT} />
    <path d="M9 18.4h6" />
  </Svg>
);

export const DEALER_PAGE_ICONS: Record<DealerPageIconKey, (p: IconProps) => JSX.Element> = {
  "dealer-verified": DealerVerifiedIcon,
  "vehicle-passport-partner": VehiclePassportPartnerIcon,
  "reserve-vehicle": ReserveVehicleIcon,
  "schedule-test-drive": ScheduleTestDriveIcon,
  "get-directions": GetDirectionsIcon,
  "up-front-pricing": UpFrontPricingIcon,
  "secure-reservation": SecureReservationIcon,
  "transparent-pricing": TransparentPricingIcon,
  "no-pressure": NoPressureIcon,
  "complete-vehicle-disclosure": CompleteVehicleDisclosureIcon,
  "prompt-communication": PromptCommunicationIcon,
  "customer-first": CustomerFirstIcon,
  "factory-trained-technicians": FactoryTrainedTechniciansIcon,
  "genuine-oem-parts": GenuineOemPartsIcon,
  "warranty-support": WarrantySupportIcon,
  "certified-pre-owned-support": CertifiedPreOwnedSupportIcon,
  "recall-service-support": RecallServiceSupportIcon,
  "luxury-ownership": LuxuryOwnershipIcon,
  "customer-satisfaction": CustomerSatisfactionIcon,
  "certified-service": CertifiedServiceIcon,
  "pickup-return": PickupReturnIcon,
  "loaner-vehicles": LoanerVehiclesIcon,
  "address-location": AddressLocationIcon,
  "phone": PhoneIcon,
  "hours": HoursIcon,
  "map-directions": MapDirectionsIcon,
  "complete-disclosure": CompleteDisclosureIcon,
  "factory-trained-staff": FactoryTrainedStaffIcon,
  "respectful-experience": RespectfulExperienceIcon,
  "message-team": MessageTeamIcon,
  "passport-mark-1": PassportMark1Icon,
  "passport-mark-2": PassportMark2Icon,
  "passport-mark-3": PassportMark3Icon,
};

// Bare icon. When `color` is given the icon renders monochrome in that
// color (accent included) — for chips, buttons, and the commitment band.
// Without it, strokes inherit currentColor and the accent defaults blue.
export function DealerPageIcon({
  iconKey, size = 24, color, className, title,
}: { iconKey: DealerPageIconKey; size?: number; color?: string; className?: string; title?: string }) {
  const Cmp = DEALER_PAGE_ICONS[iconKey];
  if (!Cmp) return null;
  const style: CSSProperties & { "--al-icon-accent"?: string } = { width: size, height: size };
  if (color) { style.color = color; style["--al-icon-accent"] = color; }
  else style["--al-icon-accent"] = dealerPageIconColors.blue;
  return <Cmp className={className} style={style} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} />;
}

export type DealerPageIconTone = "blue" | "green" | "purple" | "gold" | "navy";

const BADGE_TONES: Record<DealerPageIconTone, { bg: string; fg: string }> = {
  blue: { bg: dealerPageIconColors.blueSoft, fg: dealerPageIconColors.blue },
  green: { bg: dealerPageIconColors.greenSoft, fg: dealerPageIconColors.green },
  purple: { bg: dealerPageIconColors.purpleSoft, fg: dealerPageIconColors.purple },
  gold: { bg: "#FFF7E6", fg: dealerPageIconColors.gold },
  navy: { bg: "#EDF1F7", fg: dealerPageIconColors.navy },
};

const BADGE_SIZES: Record<"sm" | "md" | "lg", { box: number; icon: number; radius: number }> = {
  sm: { box: 32, icon: 18, radius: 10 },
  md: { box: 44, icon: 24, radius: 14 },
  lg: { box: 56, icon: 30, radius: 16 },
};

// Soft-tint rounded badge: navy primary strokes, tone accent strokes.
export function DealerPageIconBadge({
  iconKey, tone = "blue", size = "md", className,
}: { iconKey: DealerPageIconKey; tone?: DealerPageIconTone; size?: "sm" | "md" | "lg"; className?: string }) {
  const t = BADGE_TONES[tone];
  const s = BADGE_SIZES[size];
  const Cmp = DEALER_PAGE_ICONS[iconKey];
  if (!Cmp) return null;
  const style: CSSProperties & { "--al-icon-accent": string } = {
    width: s.box, height: s.box, borderRadius: s.radius,
    backgroundColor: t.bg, color: dealerPageIconColors.navy,
    border: `1px solid ${dealerPageIconColors.border}`,
    "--al-icon-accent": t.fg,
  };
  return (
    <span className={`grid place-items-center shrink-0 ${className ?? ""}`} style={style}>
      <Cmp width={s.icon} height={s.icon} />
    </span>
  );
}

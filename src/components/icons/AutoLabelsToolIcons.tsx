// ──────────────────────────────────────────────────────────────────────
// AutoLabels tool icon system — the branded, locked icon registry for the
// admin platform (per the numbered icon key sheet). Every icon: 24x24
// viewbox, 2px stroke, rounded caps/joins, automotive/compliance-specific
// shapes. Accent strokes read var(--al-icon-accent) so a category badge can
// tint them while sidebar/monochrome contexts inherit currentColor.
// Always render tool icons through this registry — no generic icon sets.
// ──────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode, SVGProps } from "react";

export type AutoLabelsToolIconKey =
  | "new-addendum" | "buyers-guide" | "used-vehicle-docs" | "cpo-info-sheet"
  | "document-review" | "compliance-center" | "audit-log"
  | "used-car-sticker" | "new-car-sticker" | "trade-up-sticker" | "sticker-studio"
  | "description-writer"
  | "recon-approvals" | "prep-install" | "service-desk" | "ready-board"
  | "home" | "inventory" | "deals" | "create" | "settings" | "setup" | "search";

export type ToolCategory = "document" | "compliance" | "sticker" | "ai" | "service" | "warning";

// Category color system — badge background, accent stroke, primary stroke.
export const TOOL_CATEGORY_STYLES: Record<ToolCategory, { bg: string; fg: string; stroke: string }> = {
  document:   { bg: "#EAF4FF", fg: "#0B6FEA", stroke: "#12324A" },
  compliance: { bg: "#EEF6FF", fg: "#0F5E8C", stroke: "#0D1B2A" },
  sticker:    { bg: "#EDF7FF", fg: "#0077C8", stroke: "#12324A" },
  ai:         { bg: "#F1EEFF", fg: "#6D5DF6", stroke: "#251A55" },
  service:    { bg: "#EAF6EF", fg: "#1F7A4D", stroke: "#123524" },
  warning:    { bg: "#FFF7E6", fg: "#F59E0B", stroke: "#5F4300" },
};

type IconProps = SVGProps<SVGSVGElement>;
const ACCENT = "var(--al-icon-accent, currentColor)";

const Svg = ({ children, ...props }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
);

// ── Documents & Compliance ────────────────────────────────────────────

// 01 — narrow addendum label + product tag + add mark
const NewAddendumIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="2.75" width="9" height="15.5" rx="1.5" />
    <path d="M8 7h3M8 10.5h3M8 14h2" />
    <rect x="14.5" y="14.5" width="6.5" height="6.5" rx="1.75" stroke={ACCENT} />
    <path d="M17.75 16.5v2.5M16.5 17.75H19" stroke={ACCENT} />
  </Svg>
);

// 02 — FTC-style window form: header bar, checkbox rows
const BuyersGuideIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="3" width="15" height="18" rx="1.5" />
    <path d="M4.5 7.5h15" />
    <rect x="7.25" y="10.25" width="2.75" height="2.75" rx="0.6" stroke={ACCENT} />
    <path d="M12.75 11.5H17" />
    <rect x="7.25" y="15.25" width="2.75" height="2.75" rx="0.6" stroke={ACCENT} />
    <path d="M12.75 16.5H17" />
  </Svg>
);

// 03 — compliance packet: folder with a sheet tucked inside
const UsedVehicleDocsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 18.5v-10A1.5 1.5 0 0 1 5 7h4l2 2.25h8a1.5 1.5 0 0 1 1.5 1.5v7.75A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M8 4h8.5" stroke={ACCENT} />
    <path d="M8 13.75h8M8 16.5h5" stroke={ACCENT} />
  </Svg>
);

// 04 — certified shield + ribbon tails
const CpoInfoSheetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.25 5v4.75c0 3.9-2.4 6.3-6.25 7.75-3.85-1.45-6.25-3.85-6.25-7.75V5Z" />
    <path d="M9.5 9.75l1.9 1.9 3.4-3.4" stroke={ACCENT} />
    <path d="m9 17.75-1.25 3.5M15 17.75l1.25 3.5" stroke={ACCENT} />
  </Svg>
);

// 05 — document + magnifier
const DocumentReviewIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5h9L18.5 7v4" />
    <path d="M8 8.5h4M8 12h3" />
    <circle cx="15.5" cy="15.5" r="3.25" stroke={ACCENT} />
    <path d="m18 18 3 3" stroke={ACCENT} />
  </Svg>
);

// 06 — shield with bold verification check
const ComplianceCenterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" />
    <path d="m8.75 11 2.4 2.4 4.1-4.4" stroke={ACCENT} />
  </Svg>
);

// 07 — small verified shield feeding a timeline
const AuditLogIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 2.75 12.75 4.3v3.1c0 2.5-1.55 4.05-4.25 5.05C5.8 11.45 4.25 9.9 4.25 7.4V4.3Z" />
    <path d="m7 7 1.2 1.2 2-2.1" stroke={ACCENT} />
    <path d="M15.5 8.5v10.5" />
    <circle cx="15.5" cy="12" r="1.4" stroke={ACCENT} />
    <path d="M15.5 16.25h3.25" />
    <circle cx="20.25" cy="16.25" r="1.4" stroke={ACCENT} />
  </Svg>
);

// ── Stickers & Labels ─────────────────────────────────────────────────

// 08 — used car silhouette with a label on the side glass
const UsedCarStickerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 17h-.75a1.25 1.25 0 0 1-1.25-1.25V13.5a2 2 0 0 1 2-2h.55L7 7.6a2 2 0 0 1 1.75-1.05h6.5A2 2 0 0 1 17 7.6l1.95 3.9h.55a2 2 0 0 1 2 2v2.25A1.25 1.25 0 0 1 20.25 17h-.75" />
    <circle cx="8" cy="17.25" r="1.9" />
    <circle cx="16" cy="17.25" r="1.9" />
    <rect x="9.75" y="8.25" width="4.5" height="3.25" rx="0.6" stroke={ACCENT} />
    <path d="M11 9.5h2M11 10.5h1.25" stroke={ACCENT} strokeWidth={1.25} />
  </Svg>
);

// 09 — Monroney-style sticker sheet + new-car sparkle
const NewCarStickerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="14" height="13.5" rx="1.5" />
    <rect x="6" y="7.75" width="4.25" height="3.25" rx="0.6" stroke={ACCENT} />
    <path d="M12.5 8.5h2.75M12.5 10.5h2.75M6 14h9.25M6 16h6" />
    <path d="M20.25 3.25l.7 1.55 1.55.7-1.55.7-.7 1.55-.7-1.55-1.55-.7 1.55-.7Z" stroke={ACCENT} />
  </Svg>
);

// 10 — car + upward value arrow + tag
const TradeUpStickerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.75 16.75h-.5a1 1 0 0 1-1-1V14a1.75 1.75 0 0 1 1.75-1.75h.4L6 8.85A1.75 1.75 0 0 1 7.55 7.9h5.4a1.75 1.75 0 0 1 1.55.95l1.6 3.4" />
    <circle cx="6.75" cy="17" r="1.7" />
    <circle cx="13.25" cy="17" r="1.7" />
    <path d="M18.75 11.5V4.75M16 7.25l2.75-2.75 2.75 2.75" stroke={ACCENT} />
    <rect x="16.75" y="14.5" width="5" height="5" rx="1.25" stroke={ACCENT} />
  </Svg>
);

// 11 — template grid + edit pencil + spark
const StickerStudioIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.25" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.25" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.25" />
    <path d="m14.5 9 4.75-4.75 2 2L16.5 11l-2.6.6Z" stroke={ACCENT} />
  </Svg>
);

// ── AI & Merchandising ────────────────────────────────────────────────

// 12 — AI sparkle + listing copy lines
const DescriptionWriterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3.5 7.6 6l2.5 1.1-2.5 1.1L6.5 10.7 5.4 8.2 2.9 7.1 5.4 6Z" stroke={ACCENT} />
    <path d="M12.5 6.5H21M8.5 12h12.5M8.5 17.5H17" />
    <path d="m5 14.5.75 1.65 1.65.75-1.65.75L5 19.3l-.75-1.65-1.65-.75 1.65-.75Z" stroke={ACCENT} />
  </Svg>
);

// ── Service / Get Ready ───────────────────────────────────────────────

// 13 — wrench + approval check
const ReconApprovalsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.9 6a4.1 4.1 0 0 0-5.55 5.55L4 16.9 7.1 20l5.35-5.35A4.1 4.1 0 0 0 18 9.1l-2.35 2.35-2.5-.6-.6-2.5Z" />
    <circle cx="18.25" cy="17.75" r="3.25" stroke={ACCENT} />
    <path d="m16.9 17.75 1 1 1.7-1.9" stroke={ACCENT} />
  </Svg>
);

// 14 — car on a lift with installed check
const PrepInstallIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 13.5 7 10.4a1.75 1.75 0 0 1 1.6-1h6.8a1.75 1.75 0 0 1 1.6 1l1.5 3.1" />
    <path d="M4.75 13.5h14.5" />
    <circle cx="8.25" cy="13.5" r="0.4" fill="currentColor" />
    <path d="M12 16v2M4 20.75h16M7 20.75V18M17 20.75V18" />
    <path d="m10 4 1.6 1.6L14.5 2.6" stroke={ACCENT} />
  </Svg>
);

// 15 — repair-order clipboard + wrench detail
const ServiceDeskIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="4" width="11.5" height="16.5" rx="1.5" />
    <rect x="7.75" y="2.5" width="5" height="3" rx="1" />
    <path d="M7.75 9.5h5M7.75 12.75h5M7.75 16h3" />
    <path d="M21 12.9a2.4 2.4 0 0 1-3.1 3.1l-2.15 2.15" stroke={ACCENT} />
    <path d="M17.9 9.8a2.4 2.4 0 0 0-2 2.35" stroke={ACCENT} />
  </Svg>
);

// 16 — vehicle lane board with status checks
const ReadyBoardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <path d="M7 8.5h5.5M7 12.5h5.5M7 16.5h5.5" />
    <path d="m15.5 8 1 1 1.75-2M15.5 12l1 1 1.75-2M15.5 16l1 1 1.75-2" stroke={ACCENT} />
  </Svg>
);

// ── Other / System ────────────────────────────────────────────────────

const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" stroke={ACCENT} />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Svg>
);

const InventoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7.5c.4-1 1-1.5 2-1.5h3c1 0 1.6.5 2 1.5" />
    <circle cx="5.75" cy="8.75" r="0.4" fill="currentColor" />
    <path d="M14 8h6.5M4 12.75h16.5M4 17.5h16.5" strokeDasharray="3.5 2.25" />
    <path d="m18 6.5 1 1 1.75-2" stroke={ACCENT} />
  </Svg>
);

const DealsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 11 4-4 3.5 1 3-2.5L20.5 9" />
    <path d="m20.5 9-3.75 5.5a2 2 0 0 1-2.9.45L11.5 13l-2 1.75a1.6 1.6 0 0 1-2.3-.2L3 11" />
    <path d="m11.5 13 2.5-2.25" stroke={ACCENT} />
  </Svg>
);

const CreateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-9.5" />
    <path d="M9 12h6M12 9v6" stroke={ACCENT} />
    <path d="m18.5 2.5.7 1.55 1.55.7-1.55.7-.7 1.55-.7-1.55-1.55-.7 1.55-.7Z" stroke={ACCENT} />
  </Svg>
);

const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" stroke={ACCENT} />
    <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.55 5.45l-1.8 1.8M7.25 16.75l-1.8 1.8M18.55 18.55l-1.8-1.8M7.25 7.25l-1.8-1.8" />
  </Svg>
);

const SetupIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.75 15.25c4.75-4.75 6-9 5.75-11.75-2.75-.25-7 1-11.75 5.75L4 12l3 .75L10 16l.75 3Z" />
    <circle cx="14.75" cy="9.25" r="1.5" stroke={ACCENT} />
    <path d="M5.75 18.25c-1 1-1.5 2.5-1.5 2.5s1.5-.5 2.5-1.5" stroke={ACCENT} />
  </Svg>
);

const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m15.75 15.75 4.75 4.75" stroke={ACCENT} />
  </Svg>
);

interface RegistryEntry {
  icon: (p: IconProps) => ReactNode;
  category: ToolCategory;
}

export const AUTOLABELS_TOOL_ICONS: Record<AutoLabelsToolIconKey, RegistryEntry> = {
  "new-addendum": { icon: NewAddendumIcon, category: "document" },
  "buyers-guide": { icon: BuyersGuideIcon, category: "compliance" },
  "used-vehicle-docs": { icon: UsedVehicleDocsIcon, category: "compliance" },
  "cpo-info-sheet": { icon: CpoInfoSheetIcon, category: "document" },
  "document-review": { icon: DocumentReviewIcon, category: "compliance" },
  "compliance-center": { icon: ComplianceCenterIcon, category: "compliance" },
  "audit-log": { icon: AuditLogIcon, category: "compliance" },
  "used-car-sticker": { icon: UsedCarStickerIcon, category: "sticker" },
  "new-car-sticker": { icon: NewCarStickerIcon, category: "sticker" },
  "trade-up-sticker": { icon: TradeUpStickerIcon, category: "sticker" },
  "sticker-studio": { icon: StickerStudioIcon, category: "sticker" },
  "description-writer": { icon: DescriptionWriterIcon, category: "ai" },
  "recon-approvals": { icon: ReconApprovalsIcon, category: "service" },
  "prep-install": { icon: PrepInstallIcon, category: "service" },
  "service-desk": { icon: ServiceDeskIcon, category: "service" },
  "ready-board": { icon: ReadyBoardIcon, category: "service" },
  home: { icon: HomeIcon, category: "document" },
  inventory: { icon: InventoryIcon, category: "document" },
  deals: { icon: DealsIcon, category: "document" },
  create: { icon: CreateIcon, category: "document" },
  settings: { icon: SettingsIcon, category: "document" },
  setup: { icon: SetupIcon, category: "document" },
  search: { icon: SearchIcon, category: "document" },
};

// Bare icon component for drop-in use wherever a Lucide-style component is
// expected (sidebar nav config, list rows). Monochrome: inherits currentColor.
export const toolIcon = (key: AutoLabelsToolIconKey) => AUTOLABELS_TOOL_ICONS[key].icon;

const BADGE_SIZE: Record<"quick" | "default" | "row", { box: number; radius: number; icon: number }> = {
  quick: { box: 48, radius: 16, icon: 26 },
  default: { box: 44, radius: 14, icon: 24 },
  row: { box: 40, radius: 12, icon: 22 },
};

// Branded badge: category-tinted container, navy primary strokes, category
// accent strokes via the CSS variable.
export const ToolIconBadge = ({ iconKey, variant = "default", category }: {
  iconKey: AutoLabelsToolIconKey;
  variant?: "quick" | "default" | "row";
  category?: ToolCategory;
}) => {
  const entry = AUTOLABELS_TOOL_ICONS[iconKey];
  const cat = TOOL_CATEGORY_STYLES[category ?? entry.category];
  const s = BADGE_SIZE[variant];
  const Icon = entry.icon;
  const style: CSSProperties & { "--al-icon-accent": string } = {
    width: s.box, height: s.box, borderRadius: s.radius,
    backgroundColor: cat.bg, color: cat.stroke,
    border: "1px solid rgba(13, 27, 42, 0.08)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
    "--al-icon-accent": cat.fg,
  };
  return (
    <span className="grid place-items-center shrink-0" style={style}>
      <Icon width={s.icon} height={s.icon} />
    </span>
  );
};

export function getAutoLabelsToolIcon(iconKey: AutoLabelsToolIconKey, options?: {
  size?: number;
  variant?: "default" | "badge" | "sidebar" | "compact";
  category?: ToolCategory;
}) {
  const entry = AUTOLABELS_TOOL_ICONS[iconKey];
  const variant = options?.variant ?? "default";
  if (variant === "badge" || variant === "default") {
    return <ToolIconBadge iconKey={iconKey} category={options?.category} />;
  }
  const Icon = entry.icon;
  const size = options?.size ?? (variant === "sidebar" ? 20 : 16);
  return <Icon width={size} height={size} />;
}

// ── Print-document icons (Saturday addendum & label templates) ────────
// Same locked style; keyed separately so print templates never import
// generic icon sets. Accent strokes follow the same CSS variable.
const VinIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M6.5 9.5v5M9.5 9.5v5M12 9.5v5M15 9.5v5M17.5 9.5v5" stroke={ACCENT} strokeWidth={1.5} />
  </Svg>
);
const StockTagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5v-7A2 2 0 0 1 5.5 3.5h7L20.5 11.5a2 2 0 0 1 0 2.85l-6.15 6.15a2 2 0 0 1-2.85 0Z" />
    <circle cx="8" cy="8" r="1.5" stroke={ACCENT} />
  </Svg>
);
const DateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="M8 13.5h3M8 17h3M14 13.5h2.5" stroke={ACCENT} strokeWidth={1.75} />
  </Svg>
);
const PriceTagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5v-7A2 2 0 0 1 5.5 3.5h7L20.5 11.5a2 2 0 0 1 0 2.85l-6.15 6.15a2 2 0 0 1-2.85 0Z" />
    <path d="M9.5 12.5c0-1 .8-1.5 1.75-1.5s1.75.5 1.75 1.5-.8 1.5-1.75 1.5-1.75.5-1.75 1.5.8 1.5 1.75 1.5 1.75-.5 1.75-1.5M11.25 9.75v1.25M11.25 17v1.25" stroke={ACCENT} strokeWidth={1.75} />
  </Svg>
);
const PassportShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" />
    <path d="m12 7 1.1 2.25 2.5.35-1.8 1.75.4 2.45L12 12.65l-2.2 1.15.4-2.45-1.8-1.75 2.5-.35Z" stroke={ACCENT} strokeWidth={1.75} />
  </Svg>
);
const RibbonQualityIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m9.5 8.75 1.75 1.75 3.25-3.25" stroke={ACCENT} />
    <path d="m9 13.75-1.5 6 4.5-2.5 4.5 2.5-1.5-6" />
  </Svg>
);
const InstallWrenchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.9 6a4.1 4.1 0 0 0-5.55 5.55L4 16.9 7.1 20l5.35-5.35A4.1 4.1 0 0 0 18 9.1l-2.35 2.35-2.5-.6-.6-2.5Z" />
    <path d="m16.5 17.75 1.1 1.1 2-2.1" stroke={ACCENT} />
  </Svg>
);
const AddedValueIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 11.5 12 4l1.5 4.5h4L14 12l1 6-3-2-3 2 .5-4.5" />
    <path d="M4 20.5h16" stroke={ACCENT} />
  </Svg>
);
const PeaceOfMindIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 18.75 5.25v5c0 4.1-2.6 6.7-6.75 8.25-4.15-1.55-6.75-4.15-6.75-8.25v-5Z" />
    <path d="M12 7.5c1.5-1.4 4-.4 4 1.6 0 1.9-2.4 3.4-4 4.4-1.6-1-4-2.5-4-4.4 0-2 2.5-3 4-1.6Z" stroke={ACCENT} strokeWidth={1.75} />
  </Svg>
);
const AiPoweredIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.6 8l4.4 1.6-4.4 1.6L12 15.6l-1.6-4.4L6 9.6 10.4 8Z" />
    <path d="m18.5 15 .8 1.95 1.95.8-1.95.8-.8 1.95-.8-1.95-1.95-.8 1.95-.8Z" stroke={ACCENT} />
  </Svg>
);
const FtcCompliantIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12 2.4 2.4 4.6-4.9" stroke={ACCENT} />
  </Svg>
);
const RealTimeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2M19.5 12a7.5 7.5 0 0 1-12.9 5.2" />
    <path d="M17.5 3.5v3.5H14M6.5 20.5V17H10" stroke={ACCENT} />
  </Svg>
);
const PrintReadyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 8V3.5h10V8M7 17.5H4.5V10a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5H17" />
    <rect x="7" y="14.5" width="10" height="6" rx="1" stroke={ACCENT} />
  </Svg>
);
const BenefitCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" stroke={ACCENT} />
    <path d="m8.5 12 2.4 2.4 4.6-4.9" />
  </Svg>
);
const UpgradePlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8.5v7M8.5 12h7" stroke={ACCENT} />
  </Svg>
);

export type AutoLabelsPrintIconKey =
  | "vin" | "stock" | "date" | "price" | "passport"
  | "quality" | "install" | "value" | "peace"
  | "ai" | "ftc" | "updates" | "print" | "benefit" | "upgrade";

export const AL_PRINT_ICONS: Record<AutoLabelsPrintIconKey, (p: IconProps) => ReactNode> = {
  vin: VinIcon, stock: StockTagIcon, date: DateIcon, price: PriceTagIcon, passport: PassportShieldIcon,
  quality: RibbonQualityIcon, install: InstallWrenchIcon, value: AddedValueIcon, peace: PeaceOfMindIcon,
  ai: AiPoweredIcon, ftc: FtcCompliantIcon, updates: RealTimeIcon, print: PrintReadyIcon,
  benefit: BenefitCheckIcon, upgrade: UpgradePlusIcon,
};

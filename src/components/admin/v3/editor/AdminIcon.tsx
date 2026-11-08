import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type SVGProps } from "react";
import {
  Activity, AlertTriangle, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, Ban, Bell, BookOpen, Building2, Calculator,
  CalendarDays, Car, ChartColumn, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Coffee, Copy, CreditCard, Database, DollarSign,
  Download, ExternalLink, Eye, FilePlus, File as FileIcon, Filter, Folder, Globe, HelpCircle, History, House, Image as ImageIcon,
  Info, Key, Layers, LayoutGrid, Link as LinkIcon, List, Lock, Mail, Maximize2, MessageSquare, Moon, Package, Paintbrush, Palette, Phone,
  Pencil, MapPin, Plug, Plus, Printer, RefreshCw, Save, Search, Settings, Shield, ShieldCheck, Star, Sun, Tag, Upload, User,
  Users, Video, Wrench, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Semantic icon names are the handoff's 84 asset ids. Where lucide-react (the
// repo's icon set) draws the same meaning the lucide glyph is used. The few
// glyphs below were drawn differently in the handoff (24px canvas, 1.75 stroke,
// round caps) and are inlined from that bundled artwork so they stay faithful.

export const ADMIN_ICON_SIZE = {
  compact: 16,
  inline: 20,
  control: 20,
  card: 24,
  metric: 32,
  empty: 48,
} as const;
export type AdminIconSize = keyof typeof ADMIN_ICON_SIZE;

const INLINE_ART: Record<string, ReactNode> = {
  drag: (
    <>
      <circle cx="9" cy="5" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="19" r="1" />
    </>
  ),
  rotate: <path d="M20 9a8 8 0 1 0 0 7M20 3v6h-6" />,
  checklist: <path d="m3 5 1 1 2-3M9 5h12M3 12l1 1 2-3m3 2h12M3 19l1 1 2-3m3 2h12" />,
  "check-square": (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m7 12 3 3 7-7" /></>),
  move: <path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3" />,
  route: (<><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9" /></>),
  qr: <path d="M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Zm6-3h-3m-6 0v3m0 4v2" />,
  "file-signature": <path d="M5 3h9l5 5v4M14 3v6h5M5 3v18h7m2-3 6-6 2 2-6 6-3 1Z" />,
  "clipboard-check": (<><path d="M8 5H4v16h16V5h-4" /><rect x="8" y="3" width="8" height="4" rx="1" /><path d="m7 13 3 3 7-7" /></>),
  "user-check": (<><circle cx="9" cy="7" r="3" /><path d="M3 21v-4a6 6 0 0 1 10-4m2 3 2 2 4-5" /></>),
  sliders: (<><path d="M6 3v5m0 4v9M12 3v11m0 4v3M18 3v3m0 4v11" /><path d="M3 8h6v4H3Zm6 6h6v4H9Zm6-8h6v4h-6Z" /></>),
};

const LUCIDE: Record<string, LucideIcon> = {
  home: House, building: Building2, car: Car, users: Users, user: User, settings: Settings, palette: Palette, phone: Phone,
  message: MessageSquare, mail: Mail, clock: Clock, calendar: CalendarDays, globe: Globe, pin: MapPin, shield: Shield,
  "shield-check": ShieldCheck, file: FileIcon, "file-plus": FilePlus, book: BookOpen, printer: Printer, wrench: Wrench,
  dollar: DollarSign, folder: Folder, image: ImageIcon, video: Video, eye: Eye, upload: Upload, download: Download, edit: Pencil,
  plus: Plus, close: X, check: Check, "check-circle": CheckCircle2, alert: AlertTriangle, info: Info, lock: Lock, history: History,
  refresh: RefreshCw, archive: Archive, star: Star, award: Award, coffee: Coffee, layers: Layers, chart: ChartColumn, plug: Plug,
  search: Search, filter: Filter, "chevron-right": ChevronRight, "chevron-down": ChevronDown, "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight, "arrow-up": ArrowUp, "arrow-down": ArrowDown, maximize: Maximize2, save: Save, bell: Bell,
  link: LinkIcon, "external-link": ExternalLink, grid: LayoutGrid, copy: Copy, moon: Moon, sun: Sun, calculator: Calculator,
  "credit-card": CreditCard, tag: Tag, database: Database, help: HelpCircle, ban: Ban, list: List, package: Package,
  paintbrush: Paintbrush, key: Key, activity: Activity,
};

export type AdminIconName = keyof typeof LUCIDE | keyof typeof INLINE_ART;
export const ADMIN_ICON_NAMES = [...Object.keys(LUCIDE), ...Object.keys(INLINE_ART)].sort() as AdminIconName[];

type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "name" | "ref"> & {
  name: AdminIconName;
  size?: AdminIconSize;
  /** Accessible name. Leave out when a visible label sits next to the icon; the glyph is then hidden from assistive tech. */
  label?: string;
};

export const AdminIcon = ({ name, size = "control", label, className, ...rest }: IconProps) => {
  const px = ADMIN_ICON_SIZE[size];
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  const art = INLINE_ART[name];
  if (art) {
    return (
      <svg {...rest} {...a11y} width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" focusable="false" className={cn("flex-shrink-0", className)}>
        <g transform="translate(2 2) scale(0.8333333333)">{art}</g>
      </svg>
    );
  }
  const Glyph = LUCIDE[name];
  return <Glyph {...rest} {...a11y} width={px} height={px} strokeWidth={1.75} focusable="false" className={cn("flex-shrink-0", className)} />;
};

export const ICON_TILE = {
  md: "w-10 h-10 rounded-[10px]",
  lg: "w-11 h-11 rounded-[10px]",
} as const;

/** Soft tinted square that holds a 20 to 24px glyph (handoff: stable 40px container). */
export const AdminIconTile = ({ name, tile = "md", tone = "primary", className }: { name: AdminIconName; tile?: keyof typeof ICON_TILE; tone?: "primary" | "neutral" | "danger"; className?: string }) => (
  <span aria-hidden="true" className={cn("inline-grid place-items-center flex-shrink-0", ICON_TILE[tile], tone === "primary" ? "bg-adm-selected text-adm-primary" : tone === "danger" ? "bg-adm-danger-bg text-adm-danger" : "bg-adm-workspace text-adm-muted", className)}>
    <AdminIcon name={name} size="card" />
  </span>
);

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  name: AdminIconName;
  /** Required: an icon-only control has no other name. */
  label: string;
  size?: AdminIconSize;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ name, label, size = "control", className, type = "button", ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-label={label}
    title={label}
    className={cn("inline-flex items-center justify-center w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-md text-adm-muted hover:bg-adm-workspace hover:text-adm-ink disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", className)}
    {...rest}
  >
    <AdminIcon name={name} size={size} />
  </button>
));
IconButton.displayName = "IconButton";

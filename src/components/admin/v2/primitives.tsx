import type { ReactNode, ButtonHTMLAttributes, AnchorHTMLAttributes, CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, XCircle, ChevronRight } from "lucide-react";
import { HEALTH_META, type HealthState, type HealthTone, type HealthVerdict, needsAttention } from "@/lib/admin/health";
import { cn } from "@/lib/utils";
import { ScrollRegion } from "./ScrollRegion";

// The Administration V2 surface vocabulary: cards, chips, tiles, tables and
// notes drawn to the reference tokens (6px panel radius, 1px #D6DFEA lines,
// 24px card padding, 12px table cells). Status is always text; colour is
// supplemental. No component here fetches anything.

export type Tone = HealthTone;

// Icon scale measured from the reference screens. The mocks never draw a
// 16px glyph: inline and table icons are 20px, status marks 22 to 24px,
// glyphs inside a 40px square are 18 to 20px, inside a 44px square 22 to
// 24px, inside a 56px circle 26 to 28px, and chevrons are 20px.
export const ICON = {
  inline: "w-5 h-5",
  status: "w-6 h-6",
  statusTight: "w-[22px] h-[22px]",
  button: "w-5 h-5",
  chevron: "w-5 h-5",
  inSquare: "w-5 h-5",
  inSquareLg: "w-6 h-6",
  inCircle: "w-7 h-7",
  panel: "w-7 h-7",
} as const;

export const ICON_BOX = {
  square: "w-10 h-10 rounded-md",
  squareLg: "w-11 h-11 rounded-[6px]",
  circle: "w-14 h-14 rounded-full",
  avatar: "w-12 h-12 rounded-full",
  avatarLg: "w-[52px] h-[52px] rounded-full",
} as const;

const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-adm-workspace text-adm-muted",
  success: "bg-adm-success-bg text-adm-success",
  warning: "bg-adm-warning-bg text-adm-warning",
  danger: "bg-adm-danger-bg text-adm-danger",
  info: "bg-adm-selected text-adm-primary",
};

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export const StatusChip = ({ tone = "neutral", children, className, icon = false }: { tone?: Tone; children: ReactNode; className?: string; icon?: boolean }) => {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-[2px] px-2 py-[3px] text-[12px] leading-[18px] font-semibold whitespace-nowrap", TONE_CHIP[tone], className)}>
      {icon && <Icon className="w-4 h-4" aria-hidden="true" />}
      {children}
    </span>
  );
};

export const HealthChip = ({ state, className }: { state: HealthState; className?: string }) => (
  <StatusChip tone={HEALTH_META[state].tone} className={className}>
    {HEALTH_META[state].label}
  </StatusChip>
);

const TITLE_SIZE = {
  sm: "text-[14px] leading-[20px]",
  md: "text-[16px] leading-[22px]",
  lg: "text-[18px] leading-[26px]",
  xl: "text-[20px] leading-[28px]",
} as const;

export const AdminCard = ({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
  flush = false,
  inset = "md",
  titleSize = "md",
  headerClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  /** Table cards: no body padding so rows run edge to edge. */
  flush?: boolean;
  /** Dense dashboard cards sit on a 16px inset; the default form card keeps 24px. */
  inset?: "sm" | "md";
  /** Measured title ink across the mocks: 14px on secondary dashboard cards, 16px by default, 18px and 20px on form and panel cards. */
  titleSize?: "sm" | "md" | "lg" | "xl";
  headerClassName?: string;
}) => {
  const sm = inset === "sm";
  const padX = sm ? "px-4" : "px-6";
  return (
    <section id={id} className={cn("rounded-[6px] border border-adm-border bg-adm-surface", className)}>
      {(title || action) && (
        <header className={cn("flex items-start justify-between gap-4", padX, sm ? "pt-3.5" : "pt-5", flush ? (sm ? "pb-3" : "pb-4") : "pb-0", headerClassName)}>
          <div className="min-w-0">
            {title && <h3 className={cn("font-semibold text-adm-ink", TITLE_SIZE[titleSize])}>{title}</h3>}
            {description && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{description}</p>}
          </div>
          {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(flush ? "" : cn(padX, sm ? "pb-4" : "pb-6"), title && !flush ? (sm ? "pt-3" : "pt-4") : !title && !flush ? (sm ? "pt-4" : "pt-6") : "", bodyClassName)}>{children}</div>
    </section>
  );
};

export const SectionTitle = ({ title, description, action, as: Tag = "h2" }: { title: ReactNode; description?: ReactNode; action?: ReactNode; as?: "h2" | "h3" }) => (
  <div className="flex items-end justify-between gap-4 flex-wrap">
    <div>
      <Tag className="text-[18px] leading-[26px] font-semibold text-adm-ink">{title}</Tag>
      {description && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{description}</p>}
    </div>
    {action}
  </div>
);

const STAT_ACCENT = {
  blue: "bg-[#E8EFFD] text-[#2457D6]",
  green: "bg-[#E3F5EB] text-[#1E8E4E]",
  purple: "bg-[#EEE9FB] text-[#6B4FC9]",
  red: "bg-[#FDE7E5] text-[#C62828]",
} as const;

export type StatAccent = keyof typeof STAT_ACCENT;

export const StatTile = ({
  icon: Icon,
  label,
  value,
  hint,
  href,
  accent = "blue",
  ariaLabel,
}: {
  icon?: typeof Info;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  accent?: StatAccent;
  ariaLabel?: string;
}) => {
  const body = (
    <>
      {Icon && (
        <span className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full", STAT_ACCENT[accent])}>
          <Icon className={ICON.inCircle} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[20px] text-adm-muted">{label}</span>
        <span className="block text-[30px] leading-[36px] font-bold tabular-nums truncate text-adm-ink">{value}</span>
        {hint && <span className="block text-[12px] leading-[18px] text-adm-muted truncate">{hint}</span>}
      </span>
      {href && <ChevronRight className={cn(ICON.chevron, "text-adm-muted flex-shrink-0")} aria-hidden="true" />}
    </>
  );
  const cls = "flex items-center gap-4 rounded-[6px] border border-adm-border bg-adm-surface px-4 py-3 min-h-[80px]";
  return href ? (
    <Link to={href} className={cn(cls, "hover:border-adm-primary/60 focus-visible:outline-2 focus-visible:outline-adm-primary")} aria-label={ariaLabel ?? `${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
};

const BANNER: Record<Tone, string> = {
  neutral: "bg-adm-workspace border-adm-border text-adm-ink",
  success: "bg-adm-success-bg border-[#BFE3CF] text-adm-success",
  warning: "bg-adm-warning-bg border-[#F1D58A] text-[#5F3F00]",
  danger: "bg-adm-danger-bg border-[#F3B4AE] text-adm-danger",
  info: "bg-adm-selected border-[#C5D4F7] text-adm-ink",
};

/** Shown only when a condition needs attention; a healthy system renders nothing. */
export const HealthBanner = ({ verdict, action, title }: { verdict: HealthVerdict | null; action?: ReactNode; title?: ReactNode }) => {
  if (!verdict || !needsAttention(verdict.state)) return null;
  const tone = HEALTH_META[verdict.state].tone;
  return <InlineNote tone={tone} title={title ?? verdict.headline} action={action}>{verdict.detail}</InlineNote>;
};

export const InlineNote = ({ tone = "info", title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) => {
  const Icon = TONE_ICON[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-center gap-4 rounded-[6px] border px-4 py-3", BANNER[tone], className)}>
      <Icon className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 flex items-baseline gap-x-6 gap-y-0 flex-wrap">
        {title && <span className="text-[15px] leading-[22px] font-semibold">{title}</span>}
        {children && <span className="text-[13px] leading-[18px] opacity-90">{children}</span>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" };

const BUTTON_BASE = "inline-flex items-center justify-center gap-2 rounded-md font-semibold text-[14px] leading-[20px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";
const BUTTON_VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-adm-primary text-white hover:bg-adm-primary-hover border border-adm-primary disabled:bg-adm-border disabled:border-adm-border disabled:text-adm-muted disabled:opacity-100",
  secondary: "bg-adm-surface text-adm-ink border border-adm-border hover:bg-adm-workspace",
  outline: "bg-adm-surface text-adm-primary border border-adm-primary hover:bg-adm-selected",
  ghost: "bg-transparent text-adm-primary hover:bg-adm-selected",
  danger: "bg-adm-surface text-adm-danger border border-[#F3B4AE] hover:bg-adm-danger-bg",
};
// A caller's min-h-* class must win through tailwind-merge, so the desktop height carries no variant prefix.
const BUTTON_SIZE = { sm: "min-h-[32px] px-3 text-[13px]", md: "min-h-[36px] px-3.5 max-sm:min-h-[44px]" };

export const AdminButton = ({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) => (
  <button type={type} className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)} {...rest} />
);

export const AdminLinkButton = ({ variant = "secondary", size = "md", className, to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) => (
  <Link to={to} className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)} {...rest} />
);

/** Table shell: 12px semibold headers on the workspace tint, 12px cells, 1px row lines. */
export const AdminTable = ({ children, className, caption, dense = false, inset = false, minWidth }: { children: ReactNode; className?: string; caption?: string; /** 7px cells for dashboard queues. */ dense?: boolean; /** Draw the table as a bordered box inside a flush card. */ inset?: boolean; /** Below 1024px the table scrolls sideways instead of squeezing columns under this width; wider layouts keep their own column widths. */ minWidth?: number }) => (
  <ScrollRegion label={caption ?? "Table"} className={cn(inset && "mx-4 mb-4 rounded-md border border-adm-border", dense && "[&_table]:text-[11.5px] [&_table]:leading-[16px] [&_th]:py-2.5 [&_td]:py-[9px] [&_tbody_tr:last-child>td]:border-b-0", className)}>
    <table className={cn("w-full border-collapse text-left text-[14px] leading-[20px] text-adm-ink", minWidth && "max-lg:min-w-[var(--adm-table-min)]")} style={minWidth ? ({ "--adm-table-min": `${minWidth}px` } as CSSProperties) : undefined}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  </ScrollRegion>
);

export const Th = ({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) => (
  <th scope="col" className={cn("bg-adm-workspace px-3 py-2.5 text-[12px] leading-[18px] font-semibold text-adm-muted border-b border-adm-border", align === "right" ? "text-right" : "text-left", className)}>
    {children}
  </th>
);

export const Td = ({ children, className, align = "left", colSpan, title }: { children?: ReactNode; className?: string; align?: "left" | "right"; colSpan?: number; title?: string }) => (
  <td colSpan={colSpan} title={title} className={cn("px-3 py-[11px] border-b border-adm-border align-middle", align === "right" ? "text-right tabular-nums" : "text-left", className)}>{children}</td>
);

export const KeyValueList = ({ rows, className, divided = false }: { rows: Array<{ label: ReactNode; value: ReactNode }>; className?: string; divided?: boolean }) => (
  <dl className={cn("grid grid-cols-[minmax(120px,160px)_1fr] text-[14px] leading-[20px]", divided ? "gap-x-0 gap-y-0" : "gap-x-6 gap-y-2", className)}>
    {rows.map((r, i) => (
      <div key={i} className="contents">
        <dt className={cn("text-adm-muted", divided && "border-b border-adm-border py-1.5 pr-4")}>{r.label}</dt>
        <dd className={cn("text-adm-ink min-w-0", divided && "border-b border-adm-border py-1.5")}>{r.value}</dd>
      </div>
    ))}
  </dl>
);

export const EmptyState = ({ title, detail, artwork, action, compact = false }: { title: string; detail?: ReactNode; artwork?: string; action?: ReactNode; compact?: boolean }) => (
  <div className={cn("flex flex-col items-center text-center", compact ? "py-6" : "py-10")}>
    {artwork && <img src={artwork} alt="" aria-hidden="true" className="w-[140px] h-auto mb-4" />}
    <p className="text-[14px] font-semibold text-adm-ink">{title}</p>
    {detail && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted max-w-md">{detail}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const SkeletonBlock = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-md bg-adm-workspace", className)} aria-hidden="true" />
);

/** Reads a value that may be unavailable; never prints 0 for a failed read. */
export const ValueOrUnknown = ({ value, unknownLabel = "Unknown" }: { value: ReactNode | null | undefined; unknownLabel?: string }) =>
  value === null || value === undefined || value === "" ? <span className="text-adm-muted">{unknownLabel}</span> : <>{value}</>;

// Shared presentation primitives for the three Command surfaces (VIN Command
// Center, Get Ready Command, Documents & Print Center). Frozen contract — the
// page-level agents import these and must not redefine them.

import * as React from "react";
import { AlertTriangle, ChevronRight, Copy, Loader2, RefreshCw, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone as DescriptionTone } from "@/lib/description/model";
import {
  hasDealerCapability, type DealerCapability, type DealerRole,
} from "@/lib/permissions/dealerRoleCapabilities";

export type Tone = DescriptionTone;

// TONE_CLASS is a compound bg/text/border string meant for tinted chips; a solid
// 3px accent rail needs its own single-purpose token per tone.
const TONE_ACCENT: Record<Tone, string> = {
  slate: "border-t-slate-400",
  blue: "border-t-blue-500",
  amber: "border-t-amber-500",
  red: "border-t-red-500",
  emerald: "border-t-emerald-500",
  violet: "border-t-violet-500",
};

const CARD = "rounded-2xl border border-border bg-card";
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none";
// Exported so the page agents share one recipe. Keeping these private is what
// let three parallel builders drift into three different button treatments.
export const BTN_PRIMARY = cn(BTN_BASE, "bg-primary text-primary-foreground hover:opacity-90");
export const BTN_SECONDARY = cn(BTN_BASE, "border border-border bg-card text-foreground hover:border-primary hover:bg-muted");
// The one in-table / in-card text link. Same disabled treatment as the buttons
// so a dead link never invents its own opacity.
export const BTN_LINK =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-[12.5px] font-semibold text-blue-700 hover:underline aria-disabled:opacity-50 aria-disabled:no-underline";

// One vehicle-condition casing rule for every surface, so the same car cannot
// read "Used" on one screen and "used" on the next.
export function conditionLabel(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^cpo$/i.test(v)) return "CPO";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/* ------------------------------------------------------------ copyWithToast */

// One clipboard recipe for all three surfaces. `navigator.clipboard` is
// undefined outside a secure context, so the call throws synchronously rather
// than rejecting — a .then(ok, err) pair never sees it.
export async function copyWithToast(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Clipboard unavailable");
  }
}

/* -------------------------------------------------------------- DisabledReason */

// BTN_BASE sets `disabled:pointer-events-none`, so a `title` on a disabled
// button is never hit-tested and the operator never learns why it is dead. The
// title has to ride on a wrapper that still receives pointer events — and a
// tooltip alone reaches nobody on a keyboard, so the reason is also published
// as text and wired to the control with aria-describedby.
export function DisabledReason({
  reason,
  className,
  children,
}: {
  reason?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const described =
    reason && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": id,
        })
      : children;
  return (
    <span title={reason ?? undefined} className={cn("inline-flex", className)}>
      {described}
      {reason ? <span id={id} className="sr-only">{reason}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------ CommandAction */

// One sentence per capability, so the same missing permission never reads two
// ways across the three surfaces — the page-level denial card and the disabled
// cross-page button quote the same line.
const CAPABILITY_DENIAL: Partial<Record<DealerCapability, string>> = {
  can_view_inventory: "Your role cannot view inventory. Ask an owner or manager to grant inventory access.",
  can_view_get_ready: "Your role cannot view Get Ready. Ask an owner or manager to grant get-ready access.",
  can_view_print_queue: "Your role cannot view the print queue. Ask an owner or manager to grant print access.",
  can_print: "Your role cannot send print jobs. Ask an owner or manager to grant print access.",
};

export function capabilityDenialReason(capability: DealerCapability): string {
  return CAPABILITY_DENIAL[capability]
    ?? "Your role does not have access to this. Ask an owner or manager to grant it.";
}

// The capability each in-app destination demands, so a cross-page CTA is
// disabled here rather than dead-ending on the target screen's denial card.
const HREF_CAPABILITY: { prefix: string; capability: DealerCapability }[] = [
  { prefix: "/get-ready-command", capability: "can_view_get_ready" },
  { prefix: "/print-center", capability: "can_view_print_queue" },
  { prefix: "/vehicle-file", capability: "can_view_inventory" },
];

export function capabilityForHref(href?: string | null): DealerCapability | undefined {
  if (!href || /^https?:\/\//i.test(href)) return undefined;
  return HREF_CAPABILITY.find((r) => href.startsWith(r.prefix))?.capability;
}

// The pages already read the member once; re-reading it per button would fire a
// query per row. They publish the resolved role here instead.
const CommandCapabilityContext = React.createContext<(c: DealerCapability) => boolean>(() => true);

export function CommandCapabilityProvider({
  role,
  isAdmin,
  children,
}: {
  role: DealerRole;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const can = React.useMemo(
    () => (c: DealerCapability) => hasDealerCapability(role, c, isAdmin),
    [role, isAdmin],
  );
  return <CommandCapabilityContext.Provider value={can}>{children}</CommandCapabilityContext.Provider>;
}

// Every cross-page CTA on the three surfaces routes through this one recipe:
// the capability decides whether it is live, the reason is always stated, and a
// blocked control stays focusable so the reason is reachable without a mouse.
export function CommandAction({
  capability,
  disabledReason,
  onClick,
  href,
  newTab,
  variant = "secondary",
  Icon,
  TrailingIcon,
  busy,
  expanded,
  className,
  wrapperClassName,
  children,
}: {
  capability?: DealerCapability;
  disabledReason?: string | null;
  onClick?: () => void;
  href?: string;
  newTab?: boolean;
  variant?: "primary" | "secondary" | "link";
  Icon?: LucideIcon;
  TrailingIcon?: LucideIcon;
  busy?: boolean;
  expanded?: boolean;
  className?: string;
  wrapperClassName?: string;
  children: React.ReactNode;
}) {
  const can = React.useContext(CommandCapabilityContext);
  const denied = capability ? !can(capability) : false;
  const reason = denied
    ? capabilityDenialReason(capability as DealerCapability)
    : busy
      ? disabledReason ?? "This action is already running"
      : disabledReason ?? null;
  const blocked = reason != null;

  const base = variant === "primary" ? BTN_PRIMARY : variant === "link" ? BTN_LINK : BTN_SECONDARY;
  const cls = cn(base, blocked && "opacity-50 cursor-not-allowed", className);
  const body = (
    <>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="w-4 h-4" aria-hidden="true" /> : null}
      {children}
      {TrailingIcon ? <TrailingIcon className="w-4 h-4" aria-hidden="true" /> : null}
    </>
  );

  // `aria-disabled` rather than `disabled`: a disabled button is not focusable,
  // and an unfocusable control cannot announce why it is dead.
  const control =
    href && !blocked ? (
      <a
        href={href}
        {...(newTab ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        className={cls}
      >
        {body}
      </a>
    ) : (
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-expanded={expanded}
        onClick={() => {
          if (blocked) return;
          if (href) window.open(href, newTab ? "_blank" : "_self", "noopener,noreferrer");
          else onClick?.();
        }}
        className={cls}
      >
        {body}
      </button>
    );

  return (
    <DisabledReason reason={reason} className={wrapperClassName}>
      {control}
    </DisabledReason>
  );
}

/* ----------------------------------------------------------- CommandCallout */

// The tinted note box shared by all three surfaces (§3's blocking issue, §4's
// bottom info bar, §5's bundle note). One recipe, so the same amber box cannot
// wear three icon shades.
const CALLOUT_TONE: Record<"amber" | "blue", { box: string; icon: string; title: string; body: string }> = {
  amber: { box: "border-amber-200 bg-amber-50", icon: "text-amber-600", title: "text-amber-900", body: "text-amber-800" },
  blue: { box: "border-blue-200 bg-blue-50/70", icon: "text-blue-600", title: "text-blue-900", body: "text-blue-900" },
};

export function CommandCallout({
  tone,
  Icon,
  title,
  action,
  className,
  children,
}: {
  tone: "amber" | "blue";
  Icon: LucideIcon;
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const t = CALLOUT_TONE[tone];
  return (
    <div className={cn("rounded-xl border p-3", t.box, className)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", t.icon)} aria-hidden="true" />
        <div className="min-w-0">
          {title ? <p className={cn("text-[12.5px] font-bold", t.title)}>{title}</p> : null}
          <div className={cn("text-[11.5px]", t.body, title && "mt-0.5")}>{children}</div>
        </div>
      </div>
      {action ? <div className="flex justify-end">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- CommandMenu */

export interface CommandMenuItem {
  label: string;
  onSelect: () => void;
}

// The kebab menu for both tables. It implements the APG menu-button keyboard
// model — focus moves in on open, arrows/Home/End move between items, Escape
// and Tab close and hand focus back to the trigger — because the role="menu"
// it renders promises exactly that.
export function CommandMenu({
  trigger,
  items,
  label,
  onClose,
}: {
  trigger: HTMLElement | null;
  items: CommandMenuItem[];
  label: string;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !trigger) return;
    const r = trigger.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = window.innerHeight - r.bottom > h + 12;
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - h - 4),
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
    });
  }, [trigger]);

  React.useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  React.useEffect(() => {
    const dismiss = () => onClose();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [onClose]);

  const closeToTrigger = () => {
    trigger?.focus();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const at = itemRefs.current.findIndex((n) => n === document.activeElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[at >= last ? 0 : at + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[at <= 0 ? last : at - 1]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[last]?.focus();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className="fixed z-40 w-52 rounded-xl border border-border bg-card shadow-lg p-1"
      >
        {items.map((item, i) => (
          <button
            key={item.label}
            ref={(n) => { itemRefs.current[i] = n; }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              item.onSelect();
              closeToTrigger();
            }}
            className="w-full text-left min-h-[44px] px-3 rounded-lg text-[12.5px] font-medium text-foreground hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ StatusPill */

export function StatusPill({
  tone,
  Icon,
  children,
}: {
  tone: Tone;
  Icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {Icon ? <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ CommandCard */

export function CommandCard({
  title,
  subtitle,
  leading,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  /** Leading badge or icon tile beside the title — screen 2's department heads. */
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || subtitle || leading || action);
  return (
    <section className={cn(CARD, "p-4", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            {leading ? <span className="shrink-0">{leading}</span> : null}
            <div className="min-w-0">
              {title ? <h2 className="text-[13px] font-bold text-foreground leading-tight">{title}</h2> : null}
              {subtitle ? <p className="text-[11.5px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- CommandStatCard */

export function CommandStatCard({
  label,
  value,
  sub,
  Icon,
  tone,
  accentTop,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  Icon: LucideIcon;
  tone: Tone;
  accentTop?: boolean;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === "function";
  const Tag = (interactive ? "button" : "div") as React.ElementType;

  const iconTile = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg border w-9 h-9 shrink-0",
        TONE_CLASS[tone],
      )}
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
    </span>
  );

  return (
    <Tag
      {...(interactive ? { type: "button", onClick } : {})}
      className={cn(
        CARD,
        "p-4 min-h-[44px] w-full text-left",
        accentTop && cn("border-t-[3px]", TONE_ACCENT[tone]),
        accentTop && "flex flex-col items-center text-center gap-1",
        interactive && "hover:bg-muted/50 transition-colors",
      )}
    >
      {accentTop ? (
        <>
          <span className="text-[11.5px] text-muted-foreground">{label}</span>
          <span className="text-[26px] font-bold leading-none text-foreground">{value}</span>
          {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
          <span className="mt-1">{iconTile}</span>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11.5px] text-muted-foreground">{label}</div>
            <div className="text-[22px] font-bold leading-none text-foreground mt-1.5">{value}</div>
            {sub ? <div className="text-[11px] text-muted-foreground mt-1">{sub}</div> : null}
          </div>
          {iconTile}
        </div>
      )}
    </Tag>
  );
}

/* --------------------------------------------------------------- CommandStepper */

export function CommandStepper({
  steps,
  current,
}: {
  steps: { n: number; title: string; caption: string }[];
  current: number;
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-stretch gap-2 min-w-max">
        {steps.map((step, i) => {
          const isCurrent = step.n === current;
          const isDone = step.n < current;
          return (
            <li key={step.n} className="flex items-center gap-2">
              <div
                className={cn(
                  CARD,
                  "flex items-center gap-3 px-3 py-2.5 min-h-[44px]",
                  isCurrent && "border-blue-200 bg-blue-50/70",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full border text-[12px] font-bold",
                    isCurrent
                      ? "bg-blue-600 border-blue-600 text-white"
                      : isDone
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-card border-border text-muted-foreground",
                  )}
                >
                  {step.n}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[12.5px] font-semibold whitespace-nowrap",
                      isCurrent ? "text-blue-700" : "text-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="block text-[10.5px] text-muted-foreground whitespace-nowrap">
                    {step.caption}
                  </span>
                </span>
              </div>
              {i < steps.length - 1 ? (
                <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- TimelineRail */

export function TimelineRail({
  entries,
}: {
  entries: { at: string | null; title: string; detail?: string; pending?: boolean }[];
}) {
  if (entries.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground">No activity recorded yet.</p>;
  }
  return (
    <ol className="relative">
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={`${entry.title}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center shrink-0">
              <span
                className={cn(
                  "mt-1 w-2.5 h-2.5 rounded-full border-2",
                  entry.pending
                    ? "border-slate-300 bg-card"
                    : "border-blue-600 bg-blue-600",
                )}
                aria-hidden="true"
              />
              {!last ? <span className="flex-1 w-px bg-border mt-1" aria-hidden="true" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              {entry.at ? (
                <div className="text-[11px] text-muted-foreground">{entry.at}</div>
              ) : null}
              <div className="text-[12.5px] font-medium text-foreground">{entry.title}</div>
              {entry.detail ? (
                <div className="text-[11px] text-muted-foreground">{entry.detail}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------- VehicleIdentityStrip */

export function VehicleIdentityStrip({
  imageUrl,
  ymm,
  trim,
  trimBelow,
  stockNumber,
  vin,
  conditionLabel: conditionRaw,
  facts,
  footer,
  meta,
  action,
  onCopyVin,
}: {
  imageUrl?: string | null;
  ymm: string;
  trim?: string | null;
  /** Screen 2 puts the trim on its own line instead of inline after the ymm. */
  trimBelow?: boolean;
  stockNumber?: string | null;
  vin: string;
  conditionLabel?: string | null;
  /**
   * When set, the identity facts render as a labeled grid — VIN, Stock #, then
   * these — instead of the inline row. Screen 2's 3-up meta.
   */
  facts?: { label: string; value: React.ReactNode }[];
  /** Block beneath the identity facts, above the fold of the card. */
  footer?: React.ReactNode;
  meta?: { label: string; value: string; sub?: string }[];
  action?: React.ReactNode;
  onCopyVin?: () => void;
}) {
  // Callers pass the raw vehicle_listings.condition, so normalize here rather
  // than trusting each page to remember.
  const condition = conditionLabel(conditionRaw);
  const copyVinButton = onCopyVin ? (
    <button
      type="button"
      onClick={onCopyVin}
      aria-label="Copy VIN"
      className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] -my-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <Copy className="w-4 h-4" aria-hidden="true" />
    </button>
  ) : null;
  return (
    <section className={cn(CARD, "p-5")}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={ymm}
            loading="lazy"
            className="w-full lg:w-[200px] shrink-0 aspect-[16/10] object-cover rounded-xl bg-muted"
          />
        ) : (
          <div className="w-full lg:w-[200px] shrink-0 aspect-[16/10] rounded-xl bg-muted flex items-center justify-center text-[11px] text-muted-foreground">
            No photo
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-bold leading-tight text-foreground min-w-0">
              {ymm}
              {trim && !trimBelow ? <span className="ml-2 font-normal text-muted-foreground">{trim}</span> : null}
            </h2>
            {condition && facts ? <StatusPill tone="emerald">{condition}</StatusPill> : null}
          </div>
          {trimBelow ? (
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{trim || "—"}</p>
          ) : null}

          {facts ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 max-w-[560px]">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">VIN</p>
                <p className="text-[12.5px] font-mono text-foreground flex items-center gap-1 min-w-0">
                  <span className="truncate">{vin}</span>
                  {copyVinButton}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Stock #</p>
                <p className="text-[12.5px] font-medium text-foreground truncate">{stockNumber || "—"}</p>
              </div>
              {facts.map((f) => (
                <div key={f.label} className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{f.label}</p>
                  <p className="text-[12.5px] font-medium text-foreground">{f.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2">
              {stockNumber ? (
                <span className="text-[12.5px] whitespace-nowrap">
                  <span className="text-muted-foreground">Stock #</span>{" "}
                  <span className="font-semibold text-foreground">{stockNumber}</span>
                </span>
              ) : null}
              <span className="text-[12.5px] flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground">VIN</span>{" "}
                <span className="font-semibold text-foreground font-mono truncate">{vin}</span>
                {copyVinButton}
              </span>
              {condition ? <StatusPill tone="emerald">{condition}</StatusPill> : null}
            </div>
          )}

          {footer ? <div className="mt-3 pt-3 border-t border-border">{footer}</div> : null}
        </div>

        {meta && meta.length > 0 ? (
          <div className="shrink-0 flex flex-row lg:flex-col flex-wrap gap-x-6 gap-y-2 lg:text-right">
            {meta.map((m) => (
              <div key={m.label}>
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="text-[12.5px] font-semibold text-foreground">{m.value}</div>
                {m.sub ? <div className="text-[11px] text-muted-foreground">{m.sub}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ EmptyState */

export function EmptyState({
  Icon,
  title,
  detail,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(CARD, "p-8 flex flex-col items-center text-center gap-2")}>
      <span className={cn("inline-flex items-center justify-center w-11 h-11 rounded-full border", TONE_CLASS.slate)}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>
      {/* h2, not h3: at page level this is the only heading under the H1, and a
          h1 -> h3 jump is a heading-order violation. */}
      <h2 className="text-[13px] font-bold text-foreground mt-1">{title}</h2>
      {detail ? <p className="text-[11.5px] text-muted-foreground max-w-sm">{detail}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- LoadingCard */

export function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className={cn(CARD, "p-4")} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-32 rounded bg-muted" />
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div key={i} className="h-10 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- ErrorCard */

export function ErrorCard({
  message, detail, onRetry,
}: { message: string; detail?: string | null; onRetry?: () => void }) {
  return (
    <div className={cn("rounded-2xl border p-4", TONE_CLASS.red)} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-red-800">Something went wrong</p>
          <p className="text-[12.5px] text-red-700 mt-0.5 break-words">{message}</p>
          {detail ? (
            <details className="mt-2">
              <summary className="text-[11.5px] text-red-700/80 cursor-pointer">
                Details for support
              </summary>
              <p className="text-[11.5px] text-red-700/80 mt-1 break-words font-mono">{detail}</p>
            </details>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={cn(BTN_SECONDARY, "mt-3")}>
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

// Shared presentation primitives for the three Command surfaces (VIN Command
// Center, Get Ready Command, Documents & Print Center). Frozen contract — the
// page-level agents import these and must not redefine them.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, Copy, ExternalLink, Loader2, MoreVertical, RefreshCw, type LucideIcon,
} from "lucide-react";
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

// The other two ways a tone is spent outside a tinted chip. Every standalone
// icon, status word and filled dot on the three surfaces reads from one of these
// two maps, so one semantic can never wear four shades of amber: TONE_TEXT is
// the same text shade TONE_CLASS already uses inside a pill, TONE_FILL is the
// solid counterpart for a filled circle or dot.
export const TONE_TEXT: Record<Tone, string> = {
  slate: "text-slate-700",
  blue: "text-blue-700",
  amber: "text-amber-800",
  red: "text-red-700",
  emerald: "text-emerald-700",
  violet: "text-violet-700",
};

export const TONE_FILL: Record<Tone, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-600",
  amber: "bg-amber-600",
  red: "bg-red-600",
  emerald: "bg-emerald-600",
  violet: "bg-violet-600",
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

// One action-group recipe for every place these surfaces put buttons side by
// side — card headers, the identity strip, empty states, page headers. It wraps:
// two 44px buttons in a strip that could not wrap compressed below 375px, and
// the pages had four spellings of this row, two of which wrapped.
export const ACTION_GROUP = "flex flex-wrap items-center gap-2";

// The em dash a LABELLED field shows when its value is missing. Exported so the
// three pages spell "no value" the same way in the few places they format one
// themselves (money, counts) as they do in the identity strip.
export const EM_DASH = "—";

/**
 * The null-field rule, in the one place every labelled field passes through: the
 * field always renders, and an absent value is an em dash. Callers hand over the
 * value they have — or null — and cannot disagree about how "missing" is spelled.
 * Four callers previously each supplied their own ("Not recorded", "Not set",
 * "Not scheduled", "—") while the primitive documented this rule and obeyed it
 * only for its own two fields.
 */
const fieldValue = (v: React.ReactNode | null | undefined): React.ReactNode =>
  v === null || v === undefined || v === "" ? EM_DASH : v;

// One vehicle-condition casing rule for every surface, so the same car cannot
// read "Used" on one screen and "used" on the next.
export function conditionLabel(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^cpo$/i.test(v)) return "CPO";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------- dates */

// One date recipe for all three surfaces, in the reader's locale. An unparseable
// stamp returns null so the caller omits the line — printing the raw ISO string
// put "2026-07-25T13:45:12.482Z" on the Get Ready card.
const fmt = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, opts);
};

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export const formatCommandDate = (iso: string | null | undefined): string | null => fmt(iso, DATE_OPTS);
export const formatCommandTime = (iso: string | null | undefined): string | null => fmt(iso, TIME_OPTS);
export const formatCommandDateTime = (iso: string | null | undefined): string | null =>
  fmt(iso, { ...DATE_OPTS, ...TIME_OPTS });

/* -------------------------------------------------------------------- hrefs */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
const HTTP_SCHEME = /^https?:/i;

/**
 * A destination this app is willing to follow. `generated_documents.pdf_url` and
 * `qr_codes.target_url` are dealer-writable and land straight in an href, so a
 * `javascript:` or `data:text/html` value would execute in our own origin.
 * Anything with a scheme must be http(s)/mailto/tel; anything else must be a
 * same-origin relative path.
 */
export function isSafeCommandHref(href?: string | null): href is string {
  const v = (href ?? "").trim();
  if (!v) return false;
  if (v.startsWith("//")) return false;
  if (HAS_SCHEME.test(v)) return SAFE_SCHEME.test(v);
  return true;
}

/** Absolute form of an internal href, for the clipboard. Handles `?x=1` and `#a`. */
export function resolveCommandHref(href: string): string {
  return HAS_SCHEME.test(href.trim())
    ? href.trim()
    : new URL(href.trim(), window.location.origin).toString();
}

const opensExternally = (href: string) => HTTP_SCHEME.test(href) || /^(mailto:|tel:)/i.test(href);

/**
 * The one internal-destination recipe. An in-app route changes the route; an
 * http(s) destination opens a tab; mailto/tel hand off to the OS. The three
 * surfaces previously did all three of these differently for the same href.
 */
export function useCommandNavigate(): (href: string, newTab?: boolean) => void {
  const navigate = useNavigate();
  return React.useCallback((href: string, newTab?: boolean) => {
    if (!isSafeCommandHref(href)) return;
    const v = href.trim();
    if (/^(mailto:|tel:)/i.test(v)) { window.location.href = v; return; }
    if (HTTP_SCHEME.test(v)) { window.open(v, "_blank", "noopener,noreferrer"); return; }
    if (newTab) { window.open(resolveCommandHref(v), "_blank", "noopener,noreferrer"); return; }
    navigate(v);
  }, [navigate]);
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

export interface DisabledReasonParts {
  /** For the blocked control's aria-describedby. Undefined when nothing blocks it. */
  describedBy: string | undefined;
  /** For the wrapper that still receives pointer events. */
  title: string | undefined;
  /** The sr-only text the id above points at. Render it beside the control. */
  reasonNode: React.ReactNode;
}

/**
 * The anatomy DisabledReason publishes, for the one control that cannot be
 * wrapped: the authorization checkbox is styled by Tailwind `peer-*`, which
 * needs the input to stay a direct sibling of the box it paints.
 */
export function useDisabledReason(reason?: string | null): DisabledReasonParts {
  const id = React.useId();
  return {
    describedBy: reason ? id : undefined,
    title: reason ?? undefined,
    reasonNode: reason ? <span id={id} className="sr-only">{reason}</span> : null,
  };
}

// BTN_BASE sets `disabled:pointer-events-none`, so a `title` on a disabled
// button is never hit-tested and the operator never learns why it is dead. The
// title has to ride on a wrapper that still receives pointer events — and a
// tooltip alone reaches nobody on a keyboard, so the reason is also published
// as text and wired to the control with aria-describedby.
export function DisabledReason({
  reason,
  busyLabel,
  className,
  children,
}: {
  reason?: string | null;
  /**
   * Pass a string (empty when idle) for a control that can be busy — the live
   * region is then always in the DOM, which is what lets a screen reader
   * announce the change. Leave undefined for a control that never goes busy.
   */
  busyLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { describedBy, title, reasonNode } = useDisabledReason(reason);
  const described =
    describedBy && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": describedBy,
        })
      : children;
  return (
    <span title={title} className={cn("inline-flex", className)}>
      {described}
      {reasonNode}
      {busyLabel !== undefined ? (
        <span role="status" aria-live="polite" className="sr-only">{busyLabel}</span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------ CommandAction */

// One sentence per capability, so the same missing permission never reads two
// ways across the three surfaces — the page-level denial card and the disabled
// cross-page button quote the same line.
const CAPABILITY_DENIAL: Partial<Record<DealerCapability, string>> = {
  can_view_dashboard: "Your role cannot view the dashboard. Ask an owner or manager to grant dashboard access.",
  can_view_inventory: "Your role cannot view inventory. Ask an owner or manager to grant inventory access.",
  can_view_get_ready: "Your role cannot view Get Ready. Ask an owner or manager to grant get-ready access.",
  can_view_print_queue: "Your role cannot view the print queue. Ask an owner or manager to grant print access.",
  can_print: "Your role cannot send print jobs. Ask an owner or manager to grant print access.",
  can_create_documents: "Your role cannot create documents. Ask an owner or manager to grant document access.",
};

export function capabilityDenialReason(capability: DealerCapability): string {
  return CAPABILITY_DENIAL[capability]
    ?? "Your role does not have access to this. Ask an owner or manager to grant it.";
}

// The capability each in-app destination demands, so a cross-page CTA is
// disabled here rather than dead-ending on the target screen's denial card.
//
// EXHAUSTIVE over every href useCommandCenter emits plus the two the pages emit
// themselves (/inventory, /dashboard). Covering only some of them is what let a
// service_advisor — who holds can_view_get_ready but not can_view_inventory —
// read three identical column footers on one screen with two behaviours, and let
// a service_manager (inventory but no can_create_documents) reach a live
// "Description" row it cannot open. Every prefix is either mapped here or listed
// as public below; a destination in neither list is a gap, not a decision.
const HREF_CAPABILITY: { prefix: string; capability: DealerCapability }[] = [
  { prefix: "/get-ready-command", capability: "can_view_get_ready" },
  { prefix: "/k208", capability: "can_view_get_ready" },
  { prefix: "/ready-board", capability: "can_view_get_ready" },
  // The capabilities RouteCapabilityGuard enforces for these prefixes, quoted
  // here so the link is disabled with a reason instead of redirect-bouncing.
  { prefix: "/service", capability: "can_view_get_ready" },
  { prefix: "/admin/exceptions", capability: "can_manage_settings" },
  { prefix: "/print-center", capability: "can_view_print_queue" },
  { prefix: "/vehicle-file", capability: "can_view_inventory" },
  { prefix: "/vin-command", capability: "can_view_inventory" },
  { prefix: "/inventory", capability: "can_view_inventory" },
  { prefix: "/description-intelligence", capability: "can_create_documents" },
  { prefix: "/used-car-sticker", capability: "can_create_documents" },
  { prefix: "/new-car-sticker", capability: "can_create_documents" },
  { prefix: "/window-sticker-studio", capability: "can_create_documents" },
  { prefix: "/inventory-intelligence", capability: "can_view_inventory" },
  { prefix: "/dashboard", capability: "can_view_dashboard" },
];

// Routes registered OUTSIDE the entitlement gate in App.tsx. Every role can
// follow these, so gating them would disable a link that works.
const PUBLIC_HREF_PREFIX = ["/print/", "/q/", "/v/", "/v3/", "/v-classic/", "/ready/", "/inspect/"];

export function capabilityForHref(href?: string | null): DealerCapability | undefined {
  const v = (href ?? "").trim();
  if (!v || HAS_SCHEME.test(v) || v.startsWith("//")) return undefined;
  if (PUBLIC_HREF_PREFIX.some((p) => v.startsWith(p))) return undefined;
  return HREF_CAPABILITY.find((r) => v === r.prefix || v.startsWith(`${r.prefix}/`) || v.startsWith(`${r.prefix}?`))
    ?.capability;
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
  hasPopup,
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
  /** In-app affordance only. A control that opens a tab gets ExternalLink here automatically. */
  TrailingIcon?: LucideIcon;
  busy?: boolean;
  expanded?: boolean;
  hasPopup?: "dialog" | "menu";
  className?: string;
  wrapperClassName?: string;
  children: React.ReactNode;
}) {
  const can = React.useContext(CommandCapabilityContext);
  const go = useCommandNavigate();
  const denied = capability ? !can(capability) : false;
  const given = (href ?? "").trim();
  const safeHref = isSafeCommandHref(given) ? given : undefined;
  const reason = denied
    ? capabilityDenialReason(capability as DealerCapability)
    : busy
      ? disabledReason ?? "This action is already running."
      : given && !safeHref
        ? "This item's link is not a web address this app can open."
        : disabledReason ?? null;
  const blocked = reason != null;

  const base = variant === "primary" ? BTN_PRIMARY : variant === "link" ? BTN_LINK : BTN_SECONDARY;
  const cls = cn(base, blocked && "opacity-50 cursor-not-allowed", className);

  // A destination is a real <a>, so it keeps link semantics (middle-click, copy
  // link address, status bar) — but an in-app route is intercepted and handed to
  // the router instead of reloading the SPA. `newTab` is an explicit opt-in used
  // only where the spec asks for one (§5's Open Passport View); everything else
  // changes the route in place.
  const external = safeHref ? opensExternally(safeHref) : false;
  const inNewTab = safeHref ? (HTTP_SCHEME.test(safeHref) || (!external && newTab === true)) : false;

  // ExternalLink means exactly one thing on these surfaces: this control leaves
  // the page for a new tab. It is derived from the destination rather than
  // passed, so a caller cannot spend it on an in-app route — §4's column footers
  // and "View Vehicle Details" wore it while changing the route in place, and
  // §5's genuine new tab wore the same icon.
  const Trailing = inNewTab ? ExternalLink : TrailingIcon;
  const body = (
    <>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="w-4 h-4" aria-hidden="true" /> : null}
      {children}
      {Trailing ? <Trailing className="w-4 h-4" aria-hidden="true" /> : null}
    </>
  );

  // `aria-disabled` rather than `disabled`: a disabled button is not focusable,
  // and an unfocusable control cannot announce why it is dead.
  const control =
    safeHref && !blocked ? (
      <a
        href={external ? safeHref : resolveCommandHref(safeHref)}
        {...(inNewTab ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        onClick={(e) => {
          if (external || inNewTab) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          go(safeHref);
        }}
        className={cls}
      >
        {body}
      </a>
    ) : (
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-busy={busy || undefined}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        onClick={() => {
          if (blocked) return;
          if (safeHref) go(safeHref, newTab);
          else onClick?.();
        }}
        className={cls}
      >
        {body}
      </button>
    );

  // Any control that can run announces that it is running, on every surface. The
  // sentence is the same one the disabled reason states, so the spinner, the
  // tooltip and the announcement cannot describe three different things.
  return (
    <DisabledReason
      reason={reason}
      busyLabel={busy === undefined ? undefined : busy ? reason ?? "" : ""}
      className={wrapperClassName}>
      {control}
    </DisabledReason>
  );
}

/* ----------------------------------------------------------- CommandCallout */

// The tinted note box shared by all three surfaces (§3's blocking issue, §4's
// bottom info bar, §5's bundle note). One recipe, so the same amber box cannot
// wear three icon shades.
// The icon takes the same TONE_TEXT shade a StatusPill icon of that tone takes,
// so one semantic is one colour wherever it is drawn.
const CALLOUT_TONE: Record<"amber" | "blue" | "red", { box: string; icon: string; title: string; body: string }> = {
  amber: { box: "border-amber-200 bg-amber-50", icon: TONE_TEXT.amber, title: "text-amber-900", body: "text-amber-800" },
  blue: { box: "border-blue-200 bg-blue-50/70", icon: TONE_TEXT.blue, title: "text-blue-900", body: "text-blue-900" },
  red: { box: "border-red-200 bg-red-50", icon: TONE_TEXT.red, title: "text-red-900", body: "text-red-700" },
};

export function CommandCallout({
  tone,
  Icon,
  title,
  action,
  className,
  children,
}: {
  tone: "amber" | "blue" | "red";
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

/* ---------------------------------------------------------- DegradedNotice */

/**
 * The sources the loader could not read. An RLS denial and an empty table
 * produce identical rows, so a page built on partial data must say so — without
 * this, a denied `generated_documents` silently reports every document as "Not
 * started" and quietly drops the automation count.
 */
export function DegradedNotice({
  degraded,
  className,
}: {
  degraded: { source: string; message: string }[];
  className?: string;
}) {
  if (degraded.length === 0) return null;
  return (
    <CommandCallout
      tone="amber"
      Icon={AlertTriangle}
      title="Some records could not be read"
      className={className}
    >
      Everything below is measured only from the sources that answered, so counts and statuses
      here may understate what this vehicle actually has. Unreadable:{" "}
      {degraded.map((d) => d.source).join(", ")}.
      <details className="mt-1.5">
        <summary className="cursor-pointer min-h-[44px] flex items-center">Details for support</summary>
        <ul className="space-y-0.5 font-mono break-words">
          {degraded.map((d) => (
            <li key={d.source}>{d.source}: {d.message}</li>
          ))}
        </ul>
      </details>
    </CommandCallout>
  );
}

/* ------------------------------------------------------------- CommandKebab */

// The row-level overflow trigger for both tables. It was the last shared control
// still copied verbatim into two pages.
export function CommandKebab({
  label,
  expanded,
  onOpen,
}: {
  label: string;
  expanded: boolean;
  onOpen: (trigger: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(e) => onOpen(e.currentTarget)}
      className="w-11 h-11 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
    >
      <MoreVertical className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

/* -------------------------------------------------------------- CommandMenu */

export interface CommandMenuItem {
  label: string;
  onSelect: () => void;
  /** Same gate a CommandAction takes, so a menu item and a row link agree. */
  capability?: DealerCapability;
  disabledReason?: string | null;
}

/**
 * The row kebab both tables render, built here rather than per page. On the VIN
 * table the same row gated "View" through `capabilityForHref` and left the
 * kebab's "Open" live, so a service_manager saw a disabled link beside a menu
 * item that navigated into a denial card. One builder means the two cannot
 * disagree — the menu's Open resolves its capability from the same href the row
 * link does, and an unfollowable href is refused with the same sentence.
 */
export function commandRowMenuItems({
  href,
  vin,
  go,
}: {
  href?: string | null;
  vin: string;
  go: (href: string) => void;
}): CommandMenuItem[] {
  const given = (href ?? "").trim();
  const safe = isSafeCommandHref(given) ? given : undefined;
  return [
    ...(given
      ? [
          {
            label: "Open",
            capability: safe ? capabilityForHref(safe) : undefined,
            disabledReason: safe ? null : "This item's link is not a web address this app can open.",
            onSelect: () => { if (safe) go(safe); },
          },
          {
            label: "Copy Link",
            disabledReason: safe ? null : "This item's link is not a web address this app can open.",
            onSelect: () => { if (safe) void copyWithToast(resolveCommandHref(safe), "Link"); },
          },
        ]
      : []),
    { label: "Copy VIN", onSelect: () => { void copyWithToast(vin, "VIN"); } },
  ];
}

// A blocked menu item stays a focusable menuitem — arrow navigation must still
// reach it, and an unfocusable item cannot announce why it is dead. Same
// aria-disabled + aria-describedby anatomy CommandAction uses.
const MenuItemButton = React.forwardRef<
  HTMLButtonElement,
  { label: string; reason: string | null; onSelect: () => void }
>(function MenuItemButton({ label, reason, onSelect }, ref) {
  const { describedBy, title, reasonNode } = useDisabledReason(reason);
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      tabIndex={-1}
      title={title}
      aria-disabled={reason ? true : undefined}
      aria-describedby={describedBy}
      onClick={onSelect}
      className={cn(
        "w-full text-left min-h-[44px] px-3 rounded-lg text-[12.5px] font-medium text-foreground focus-visible:outline-none",
        reason ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/60 focus-visible:bg-muted/60",
      )}
    >
      {label}
      {reasonNode}
    </button>
  );
});

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
  const can = React.useContext(CommandCapabilityContext);
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

  // Every close path hands focus back to the trigger. Dropping it on the scroll,
  // resize and overlay paths left focus on <body>, so the next Tab restarted at
  // the top of the document — the menu had already moved focus in on open.
  // preventScroll: the scroll path must not scroll the page back.
  //
  // A SELECTION, though, may take the trigger with it: an in-app "Open" changes
  // the route and unmounts the row, and focusing a detached node silently drops
  // focus on <body>. So the target is checked, and when it is gone focus goes to
  // the app's scroll region — the new page — instead of nowhere.
  const returnFocus = React.useCallback(() => {
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
      return;
    }
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  }, [trigger]);

  const closeToTrigger = React.useCallback(() => {
    returnFocus();
    onClose();
  }, [returnFocus, onClose]);

  React.useEffect(() => {
    window.addEventListener("scroll", closeToTrigger, true);
    window.addEventListener("resize", closeToTrigger);
    return () => {
      window.removeEventListener("scroll", closeToTrigger, true);
      window.removeEventListener("resize", closeToTrigger);
    };
  }, [closeToTrigger]);

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
      <div className="fixed inset-0 z-30" onClick={closeToTrigger} aria-hidden />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className="fixed z-40 w-52 rounded-xl border border-border bg-card shadow-lg p-1"
      >
        {items.map((item, i) => {
          const reason = item.capability && !can(item.capability)
            ? capabilityDenialReason(item.capability)
            : item.disabledReason ?? null;
          return (
            <MenuItemButton
              key={item.label}
              ref={(n) => { itemRefs.current[i] = n; }}
              label={item.label}
              reason={reason}
              onSelect={() => {
                if (reason) return;
                item.onSelect();
                onClose();
                // The selection may have changed the route, so the focus target
                // is only known after React commits it.
                requestAnimationFrame(returnFocus);
              }}
            />
          );
        })}
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

/* -------------------------------------------------------------- CommandIconTile */

// The tinted 36px icon tile. Screen 2's summary rail re-implemented this
// verbatim beside the stat card that owns it, so the same tile could drift into
// two sizes and two border treatments.
export function CommandIconTile({ Icon, tone }: { Icon: LucideIcon; tone: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg border w-9 h-9 shrink-0",
        TONE_CLASS[tone],
      )}
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
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
          {action ? <div className={cn("shrink-0", ACTION_GROUP)}>{action}</div> : null}
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

  const iconTile = <CommandIconTile Icon={Icon} tone={tone} />;

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
  // Empty-section rule for the three surfaces: a TABLE that has no rows gets an
  // EmptyState card; a LIST or rail that has no rows gets this one line. The rail
  // was the only small empty state missing the shared py-2.
  if (entries.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground py-2">No activity recorded yet.</p>;
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
  facts?: { label: string; value: React.ReactNode | null }[];
  /** Labelled field beneath the identity facts. Screen 2's Delivery Target. */
  footer?: { label: string; Icon?: LucideIcon; value: React.ReactNode | null };
  meta?: { label: string; value: React.ReactNode | null; sub?: string | null }[];
  action?: React.ReactNode;
  onCopyVin?: () => void;
}) {
  // Callers pass the raw vehicle_listings.condition, so normalize here rather
  // than trusting each page to remember.
  //
  // Null-field rule, applied HERE for every labelled field the callers pass —
  // meta, facts and the footer, not just VIN and Stock #: a LABELLED field
  // always renders and shows an em dash when empty (the field exists, its value
  // is missing); an UNLABELLED field — the trim beside or under the ymm, the
  // condition pill — is omitted when empty, because there is nothing to say it
  // is missing FROM. Callers pass values or null and never a fallback string.
  const condition = conditionLabel(conditionRaw);
  const FooterIcon = footer?.Icon;
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
          {trimBelow && trim ? (
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{trim}</p>
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
                <p className="text-[12.5px] font-medium text-foreground truncate">{fieldValue(stockNumber)}</p>
              </div>
              {facts.map((f) => (
                <div key={f.label} className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{f.label}</p>
                  <p className="text-[12.5px] font-medium text-foreground">{fieldValue(f.value)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2">
              <span className="text-[12.5px] whitespace-nowrap">
                <span className="text-muted-foreground">Stock #</span>{" "}
                <span className="font-semibold text-foreground">{fieldValue(stockNumber)}</span>
              </span>
              <span className="text-[12.5px] flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground">VIN</span>{" "}
                <span className="font-semibold text-foreground font-mono truncate">{vin}</span>
                {copyVinButton}
              </span>
              {condition ? <StatusPill tone="emerald">{condition}</StatusPill> : null}
            </div>
          )}

          {footer ? (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[11px] text-muted-foreground">{footer.label}</p>
              <p className="text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5 mt-0.5">
                {FooterIcon ? <FooterIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> : null}
                {fieldValue(footer.value)}
              </p>
            </div>
          ) : null}
        </div>

        {meta && meta.length > 0 ? (
          <div className="shrink-0 flex flex-row lg:flex-col flex-wrap gap-x-6 gap-y-2 lg:text-right">
            {meta.map((m) => (
              <div key={m.label}>
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="text-[12.5px] font-semibold text-foreground">{fieldValue(m.value)}</div>
                {m.sub ? <div className="text-[11px] text-muted-foreground">{m.sub}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        {action ? <div className={cn("shrink-0", ACTION_GROUP)}>{action}</div> : null}
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
      {action ? <div className={cn("mt-2 justify-center", ACTION_GROUP)}>{action}</div> : null}
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

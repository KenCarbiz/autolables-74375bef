import type { KeyboardEvent, Ref } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { AdminIcon } from "@/components/design/AdminIcon";
import { AdminBrandLockup } from "@/components/design/AdminBrandLockup";
import { ADMIN_ICON_PATHS } from "@/lib/design/adminIconPaths";
import { cn } from "@/lib/utils";
import {
  FRAME_LINKS,
  badgeAriaLabel,
  findActiveNavItem,
  formatBadgeCount,
  groupBadgeAriaLabel,
  groupBadgeCount,
  groupHref,
  groupLabel,
  isGroupActive,
  type AdminNavItem,
  type AdminNavSection,
} from "@/components/layout/adminNav";

// The global left rail, drawn to mock 01: a 229px navy column, the reverse
// wordmark, one row per section and the Platform console pinned at the bottom.
// Presentational: it receives the already permission-filtered sections and the
// current location, and decides only what is lit. The
// mobile drawer is this same element translated off-canvas, so there is one
// Primary navigation in the document at every width.

export interface AppRailProps {
  sections: AdminNavSection[];
  pathname: string;
  search?: string;
  /** Called when a destination is followed; the mobile drawer closes on it. */
  onNavigate?: () => void;
  /** Shows a close button below lg, for the drawer. */
  onClose?: () => void;
  /** Open below lg: the rail is a modal dialog and keeps Tab inside itself. */
  modal?: boolean;
  closeButtonRef?: Ref<HTMLButtonElement>;
  /** Design fixture only: draw the rail at a mock's own width. The product rail is 229px. */
  width?: number;
  id?: string;
  className?: string;
}

const ROW =
  "flex shrink-0 items-center gap-[21px] pl-4 pr-3 rounded-[6px] text-white transition-colors duration-hover ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70";
const GLYPH_SLOT = "relative flex h-6 w-6 shrink-0 items-center justify-center";
const GLYPH = "h-[22px] w-[22px]";
// The mock's active block, measured at #1253DD. The rail's own colour: the
// adm-primary token the Admin body uses is a lighter blue.
const ACTIVE_FILL = "bg-[#1253DD]";

// Glyphs are 22px with a 1.75 stroke except where the mock's ink measured
// otherwise: the car and the cog draw larger, the tag smaller, the wrench lighter.
const GLYPH_TUNING: Record<string, { className?: string; strokeWidth?: number }> = {
  vehicles: { className: "h-6 w-6" },
  merchandising: { className: "h-5 w-5" },
  administration: { className: "h-6 w-6" },
  getready: { strokeWidth: 1.5 },
};

// A queue count sits on the glyph's corner, so it never takes room from the
// label (mock 01 draws no counts; the label positions stay the mock's).
const CornerCount = ({ count }: { count: number | undefined }) => {
  const text = formatBadgeCount(count);
  if (!text) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-2.5 -top-1.5 hidden h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none tabular-nums text-adm-sidebar"
    >
      {text}
    </span>
  );
};

const CountLabel = ({ count, label }: { count: number | undefined; label: string }) =>
  formatBadgeCount(count) ? <span className="sr-only">{` ${label}`}</span> : null;

const LeafGlyph = ({ item }: { item: AdminNavItem }) => {
  const Icon = item.icon;
  return item.assetIcon && ADMIN_ICON_PATHS[item.assetIcon]
    // The technician and vendor lists have no group glyph, so each row draws
    // its own pack icon; `inherit` so it takes the rail's white.
    ? <AdminIcon id={item.assetIcon} decorative inherit size={22} />
    : <Icon className={GLYPH} strokeWidth={1.75} aria-hidden="true" />;
};

const TABBABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AppRail({
  sections,
  pathname,
  search = "",
  onNavigate,
  onClose,
  modal = false,
  closeButtonRef,
  width,
  id,
  className,
}: AppRailProps) {
  const active = findActiveNavItem(sections, pathname, search);
  const listed = sections.filter((s) => !s.pinned);
  const pinned = sections.filter((s) => s.pinned);

  // Tab and Shift+Tab wrap inside the open drawer instead of leaving it.
  const keepTabInside = (e: KeyboardEvent<HTMLElement>) => {
    if (!modal || e.key !== "Tab") return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !e.currentTarget.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !e.currentTarget.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  const groupRow = (section: AdminNavSection, size: "list" | "pinned") => {
    const href = groupHref(section);
    if (!href) return null;
    const Glyph = section.icon;
    const tuning = GLYPH_TUNING[section.key] ?? {};
    const single = section.items.length === 1;
    const lit = isGroupActive(section, active);
    const label = groupLabel(section);
    const count = single ? section.items[0].badge : groupBadgeCount(section);
    const countLabel = single ? badgeAriaLabel(section.items[0].label, count ?? 0) : groupBadgeAriaLabel(section.title, count ?? 0);
    return (
      <div key={section.key} className="flex flex-col">
        <Link
          to={href}
          onClick={onNavigate}
          // The rail lists sections only; child screens are reached from the
          // section's own page. The row is current when the page is the one
          // it opens, and otherwise marks the section the page belongs to.
          aria-current={lit ? (active === section.items[0] ? "page" : "true") : undefined}
          data-active={lit ? "true" : undefined}
          className={cn(
            ROW,
            size === "pinned" ? "h-[46px] text-[12px] leading-4" : "h-[45px] text-[13px] leading-5",
            "font-normal",
            lit ? ACTIVE_FILL : "hover:bg-white/[0.06]",
          )}
        >
          <span className={GLYPH_SLOT}>
            {Glyph ? <Glyph className={tuning.className ?? GLYPH} strokeWidth={tuning.strokeWidth ?? 1.75} aria-hidden={true} /> : null}
            <CornerCount count={count} />
          </span>
          <span className="min-w-0 truncate">{label}</span>
          <CountLabel count={count} label={countLabel} />
        </Link>
      </div>
    );
  };

  const flatRow = (item: AdminNavItem) => {
    const current = item === active;
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={onNavigate}
        aria-current={current ? "page" : undefined}
        className={cn(ROW, "h-[45px] text-[13px] leading-5 font-normal", current ? ACTIVE_FILL : "hover:bg-white/[0.06]")}
      >
        <span className={GLYPH_SLOT}>
          <LeafGlyph item={item} />
          <CornerCount count={item.badge} />
        </span>
        <span className="min-w-0 truncate">{item.label}</span>
        <CountLabel count={item.badge} label={badgeAriaLabel(item.label, item.badge ?? 0)} />
      </Link>
    );
  };

  return (
    <aside
      id={id}
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      aria-label={modal ? "Main menu" : undefined}
      onKeyDown={keepTabInside}
      style={width ? { width } : undefined}
      className={cn("flex w-[229px] shrink-0 flex-col bg-adm-sidebar text-white", className)}
    >
      {onClose && (
        // Outside the column, over the scrim, so the 229px rail keeps the
        // desktop lockup and row geometry inside the drawer too.
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute left-full top-2.5 ml-3 flex h-11 w-11 items-center justify-center rounded-full bg-adm-sidebar text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
        >
          <X className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <div className="flex h-[69px] shrink-0 items-center pl-[26px]">
        <Link
          to={FRAME_LINKS.brand}
          onClick={onNavigate}
          className="flex rounded-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70"
        >
          {/* The official reverse wordmark, admin only. brand/Logo still
              renders every public surface, including the locked passport. */}
          <AdminBrandLockup variant="wordmark" surface="dark" height={24} />
        </Link>
      </div>

      <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
        <div className="mx-2 flex min-h-0 flex-1 flex-col gap-[2.5px] overflow-y-auto pb-2 pt-[7px]">
          {listed.map((section) => (section.title ? groupRow(section, "list") : section.items.map(flatRow)))}
        </div>
        {pinned.length > 0 && (
          <div className="shrink-0 pb-[33.5px]">
            <div className="ml-[11px] mr-[10px] h-px bg-[#41546B]" aria-hidden="true" />
            <div className="mx-2 mt-[3.5px]">{pinned.map((section) => groupRow(section, "pinned"))}</div>
          </div>
        )}
      </nav>
    </aside>
  );
}

export default AppRail;

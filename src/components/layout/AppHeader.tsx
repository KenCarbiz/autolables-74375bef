import type { ReactElement, ReactNode, Ref } from "react";
import { Bell, ChevronDown, Menu, Search } from "lucide-react";
import { formatBadgeCount } from "@/components/layout/adminNav";
import { cn } from "@/lib/utils";

// The global top bar, drawn to mock 01: rooftop switcher, the search box that
// opens the command palette, the notification bell and the account menu.
// Presentational: menus and popovers arrive as render slots that wrap the
// trigger this component draws, so the shell keeps every behaviour. A control
// whose slot is absent is not drawn at all, so the bar can never show a button
// that opens nothing.

type TriggerSlot = (trigger: ReactElement) => ReactNode;

export interface AppHeaderProps {
  /** Line 1: the dealer group (or the dealership when there is no group). Empty draws no rooftop. */
  groupName: string;
  /** Line 2, left of the divider: "City, ST". Dropped below sm. */
  storeLocation?: string;
  /** Line 2, right of the divider: the rooftop. */
  storeName?: string;
  /** Wraps the rooftop trigger in the rooftop switcher. Absent: one rooftop, drawn static with no chevrons. */
  renderRooftopMenu?: TriggerSlot;
  onOpenSearch: () => void;
  /** What the palette can search for this viewer; also the box's accessible name. */
  searchLabel?: string;
  /** Shortcut hint; defaults to the platform's own modifier. */
  isMac?: boolean;
  /** Unread notifications addressed to the viewer. */
  notificationCount: number;
  renderNotifications?: TriggerSlot;
  userName: string;
  userInitials: string;
  renderUserMenu?: TriggerSlot;
  /** Below lg: opens the rail drawer. */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
  menuControls?: string;
  menuButtonRef?: Ref<HTMLButtonElement>;
  className?: string;
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";
export const MOCK_SEARCH_LABEL = "Search vehicles, customers, or anything";

const detectMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

export function AppHeader({
  groupName,
  storeLocation,
  storeName,
  renderRooftopMenu,
  onOpenSearch,
  searchLabel = MOCK_SEARCH_LABEL,
  isMac = detectMac(),
  notificationCount,
  renderNotifications,
  userName,
  userInitials,
  renderUserMenu,
  onOpenMenu,
  menuOpen,
  menuControls,
  menuButtonRef,
  className,
}: AppHeaderProps) {
  const switchable = !!renderRooftopMenu;
  const lineTwo = [storeLocation, storeName].filter(Boolean).join(" | ");
  const fullRooftop = [groupName, lineTwo].filter(Boolean).join(", ");
  // The name starts with the visible words, in reading order, so a speech
  // user can say what they see; the location is in it even where a phone
  // drops it from view.
  const rooftopName = `${[groupName, storeLocation, storeName].filter(Boolean).join(", ")}: switch rooftop`;
  const rooftopBody = (
    <>
      <span className="flex max-w-full min-w-0 items-center">
        <span className="truncate text-[14px] font-semibold leading-5 text-adm-ink">{groupName}</span>
        {switchable && <ChevronDown className="ml-1 h-5 w-5 shrink-0 text-adm-muted" strokeWidth={1.75} aria-hidden="true" />}
      </span>
      {lineTwo && (
        <span className="mt-1 flex max-w-full min-w-0 items-center text-[12px] font-normal leading-4 text-[#7C8799]">
          {storeLocation && <span className={cn("truncate", storeName && "hidden sm:inline")}>{storeLocation}</span>}
          {storeLocation && storeName && <span className="mx-[9px] hidden h-3 w-px shrink-0 bg-[#CBD1DA] sm:block" aria-hidden="true" />}
          {storeName && <span className="truncate">{storeName}</span>}
          {switchable && <ChevronDown className="ml-1 h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />}
        </span>
      )}
    </>
  );
  // One control: there is no dealer-group switching in the data layer, so both
  // lines open the same rooftop list rather than inventing a second control.
  const rooftop = !groupName
    ? null
    : switchable
      ? renderRooftopMenu(
          <button
            type="button"
            title={fullRooftop}
            aria-label={rooftopName}
            className={cn("flex min-h-11 max-w-full min-w-0 flex-col items-start justify-center rounded-[6px] text-left lg:min-h-0", FOCUS)}
          >
            {rooftopBody}
          </button>,
        )
      : <div title={fullRooftop} className="flex max-w-full min-w-0 flex-col items-start">{rooftopBody}</div>;

  const badgeText = formatBadgeCount(notificationCount);
  const bell = (
    <button
      type="button"
      aria-label={notificationCount > 0 ? `Notifications (${notificationCount} unread)` : "Notifications"}
      className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] text-adm-ink hover:bg-adm-workspace lg:h-10 lg:w-10", FOCUS)}
    >
      <span className="relative h-6 w-6">
        <Bell className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
        {badgeText && (
          <span
            aria-hidden="true"
            className="absolute -right-[9px] -top-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DA3336] px-1 text-[11px] font-bold leading-none text-white tabular-nums"
          >
            {badgeText}
          </span>
        )}
      </span>
    </button>
  );

  const account = (
    <button
      type="button"
      aria-label={`Account menu for ${userName}`}
      className={cn("ml-1 flex min-h-11 shrink-0 items-center rounded-full lg:ml-[31px] lg:min-h-0", FOCUS)}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-adm-selected text-[13px] font-semibold text-adm-primary"
      >
        {userInitials}
      </span>
      <span className="ml-3 hidden max-w-[120px] truncate text-[13px] font-semibold leading-5 text-adm-ink lg:block xl:max-w-[180px]">{userName}</span>
      <ChevronDown className="ml-1 h-5 w-5 shrink-0 text-adm-muted" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );

  return (
    <header className={cn("flex h-16 shrink-0 items-center border-b border-[#E2E7EE] bg-adm-surface px-4 lg:px-5", className)}>
      {onOpenMenu && (
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls={menuControls}
          className={cn("-ml-2 mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] text-adm-ink lg:hidden", FOCUS)}
        >
          <Menu className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {/* Below lg the rooftop takes the room and the search box yields; from
          lg both take the mock's widths. */}
      <div className="flex min-w-0 flex-1 lg:w-[260px] lg:flex-none lg:shrink-0 xl:w-[344px]">{rooftop}</div>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={searchLabel}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "ml-4 hidden h-[42px] min-w-0 shrink-0 items-center rounded-[6px] border border-[#E2E7EE] bg-adm-workspace pl-[13px] pr-2 text-left hover:border-adm-muted/40 md:flex md:w-[260px] lg:ml-0 lg:w-auto lg:max-w-[543px] lg:flex-1 lg:shrink",
          FOCUS,
        )}
      >
        <Search className="h-5 w-5 shrink-0 text-adm-ink" strokeWidth={1.5} aria-hidden="true" />
        <span className="ml-4 min-w-0 flex-1 truncate text-[14px] font-normal leading-5 text-[#6C768B]">{searchLabel}...</span>
        <kbd className="ml-2 hidden h-[23px] shrink-0 items-center gap-1.5 rounded-[4px] border border-[#E2E7EE] bg-adm-surface px-[5px] text-[14px] font-normal text-adm-muted [font-family:inherit] lg:inline-flex">
          <span>{isMac ? "⌘" : "Ctrl"}</span>
          <span>K</span>
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center pl-2 md:pl-4">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={searchLabel}
          className={cn("flex h-11 w-11 items-center justify-center rounded-[6px] text-adm-ink md:hidden", FOCUS)}
        >
          <Search className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </button>
        {renderNotifications?.(bell)}
        {renderUserMenu?.(account)}
      </div>
    </header>
  );
}

export default AppHeader;

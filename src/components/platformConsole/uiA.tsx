import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ConsoleIcon } from "./icons";
import { Chip, ViewState, type Column } from "./ui";
import type { ViewResult } from "@/lib/platformConsole/dataSource";
import type { ConsoleIconName, Tone } from "@/lib/platformConsole/types";

// Primitives for the stores, connections and data screens. Kept beside ui.tsx
// so the foundation primitives stay untouched.

const PHONE_QUERY = "(max-width: 767px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True below the md breakpoint. Used where the phone reference uses different wording, not just a different layout. */
export const useIsPhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);

const TONE_ICON: Record<Tone, ConsoleIconName> = { neutral: "info", good: "check", warn: "warning", bad: "warning", info: "info" };

/** Status chip: icon and text, never colour alone. */
export const StateChip = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <Chip tone={tone} className={cn("gap-1", className)}>
    <ConsoleIcon name={TONE_ICON[tone]} size={12} />
    {children}
  </Chip>
);

export interface GridColumn<T> extends Column<T> {
  /** Cells holding a chip sit a pixel higher than text cells. */
  chip?: boolean;
}

/** Table on wide screens, labelled cards below md. Cells are top-aligned at the reference offsets. */
export function GridTable<T>({ rows, columns, rowKey, caption, rowHeight = 66, className }: { rows: T[]; columns: GridColumn<T>[]; rowKey: (r: T) => string; caption: string; rowHeight?: number; className?: string }) {
  const template = columns.map((c) => c.width).join(" ");
  return (
    <div className={cn("overflow-hidden rounded-[6px] border border-[#D7E1ED] bg-white", className)}>
      <table className="hidden w-full md:table" aria-label={caption}>
        <thead>
          <tr className="grid h-[43px] items-center bg-[#F4F6F9] px-[15px]" style={{ gridTemplateColumns: template }}>
            {columns.map((c) => <th key={c.key} scope="col" className="text-left text-[12px] font-bold text-[#52677C]">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={cn("grid items-start px-[15px]", i < rows.length - 1 && "border-b border-[#D7E1ED]")} style={{ gridTemplateColumns: template, minHeight: rowHeight }}>
              {columns.map((c) => (
                <td key={c.key} className={cn("pr-3 text-[13px] leading-[18px] text-[#132A42]", c.chip ? "pt-[15px]" : "pt-[16px]")}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-[#D7E1ED] md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="flex flex-col gap-1.5 p-4">
            {columns.map((c) => (
              <div key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                <span className="text-[12px] font-bold text-[#52677C]">{c.cardLabel ?? c.header}</span>
                <span className="text-right text-[#132A42]">{c.render(r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

const BUTTON_BASE = "inline-flex h-11 items-center rounded-[6px] px-[14px] text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]";
const BUTTON_TONE = {
  primary: "bg-[#075BE8] text-white hover:bg-[#064fca]",
  secondary: "border border-[#D7E1ED] bg-white text-[#132A42] hover:bg-[#F4F6F9]",
};

/** A link that looks like a console button, for navigation to a review screen. */
export const LinkButton = ({ to, children, variant = "secondary", icon, className }: { to: string; children: ReactNode; variant?: "primary" | "secondary"; icon?: ConsoleIconName; className?: string }) => (
  <Link to={to} className={cn(BUTTON_BASE, BUTTON_TONE[variant], icon && "gap-[4px]", className)}>
    {icon && <ConsoleIcon name={icon} size={20} />}
    {children}
  </Link>
);

/** Filter drawn as a bordered pill; a native select keeps it keyboard and screen-reader accessible. */
export const FilterSelect = ({ label, value, options, onChange, className }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; className?: string }) => (
  <label className={cn("relative inline-flex h-11 items-center rounded-[6px] border border-[#D7E1ED] bg-white text-[13px] font-bold text-[#132A42] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#075BE8]", className)}>
    <span className="sr-only">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-full w-full cursor-pointer appearance-none rounded-[6px] bg-transparent pl-[13px] pr-8 font-bold outline-none">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ConsoleIcon name="chevron" size={14} className="pointer-events-none absolute right-3 rotate-90 text-[#52677C]" />
  </label>
);

/** Phone: fixed bar with a reassurance line and the screen's one action. */
export const StickyActionBar = ({ children, note = "Read-only monitoring by default" }: { children?: ReactNode; note?: string }) => (
  <div className="fixed inset-x-0 bottom-0 z-20 flex h-[80px] items-start justify-between border-t border-[#D7E1ED] bg-white px-4 md:hidden">
    <p className="pt-[17px] text-[11px] leading-[16px] text-[#52677C]">{note}</p>
    <div className="mt-[36px]">{children}</div>
  </div>
);

/** Spacer so the last card is not hidden behind the fixed bar. */
export const StickyBarSpacer = () => <div aria-hidden="true" className="h-[72px] md:hidden" />;

/** Plain text lines inside a panel, e.g. "Store B: view inventory only". */
export const PanelLines = ({ lines, className, small }: { lines: { text: string; strong?: boolean }[]; className?: string; small?: boolean }) => (
  <ul className={cn("flex flex-col", className)}>
    {lines.map((l) => (
      <li key={l.text} className={cn("leading-[20px] text-[#132A42]", l.strong ? (small ? "text-[14px] font-bold" : "text-[15px] font-bold") : small ? "text-[13px]" : "text-[14px]")}>{l.text}</li>
    ))}
  </ul>
);

export const FootNote = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-[13px] leading-[18px] text-[#52677C]", className)}>{children}</p>
);

/** Renders the loaded model, or the bounded loading / empty / denied / timeout / error state. */
export function ViewBoundary<T>({ view, what, children }: { view: ViewResult<T>; what: string; children: (data: T) => ReactNode }) {
  if (view.status !== "ready" || !view.data) {
    return <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what={what} />;
  }
  return <>{children(view.data)}</>;
}

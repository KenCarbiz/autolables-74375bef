import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CONSOLE_SECTIONS, sectionForPath } from "@/lib/platformConsole/sections";
import { useConsoleFixture, useConsolePath } from "@/lib/platformConsole/dataSource";
import { ConsoleIcon } from "./icons";

// Page frame for every console screen: one h1, environment and scope, the
// compact nine-section navigation, and (fixture routes only) the banner that
// says the data is synthetic. Sits inside the existing app shell; it never
// draws a second global rail or header.

export const ENVIRONMENT_LABEL = (import.meta.env.MODE === "production" ? "PRODUCTION" : import.meta.env.MODE.toUpperCase());

function SectionNav() {
  const pathname = useConsolePath();
  const active = sectionForPath(pathname);
  return (
    <nav aria-label="Platform sections" className="mt-[28px] hidden border-b border-[#D7E1ED] md:block">
      <ul className="flex flex-wrap items-end gap-x-[12px]">
        {CONSOLE_SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <Link
                to={s.path}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-[29px] items-start border-b-2 pt-[1px] text-[13px] leading-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]",
                  on ? "border-[#075BE8] font-bold text-[#075BE8]" : "border-transparent text-[#52677C] hover:text-[#132A42]",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phone/tablet: labelled section selector instead of a squeezed tab row. */
function SectionSelect({ scope, compact }: { scope: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = useConsolePath();
  const active = sectionForPath(pathname);
  const listId = useId();
  return (
    <div className={cn("mt-[14px]", !compact && "md:hidden")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-between rounded-[6px] border border-[#D7E1ED] bg-white px-3 text-left text-[13px] text-[#132A42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#075BE8]"
      >
        <span>{scope}</span>
        <ConsoleIcon name="chevron" size={20} className={cn("text-[#52677C] transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {open && (
        <ul id={listId} className="mt-2 overflow-hidden rounded-[6px] border border-[#D7E1ED] bg-white" aria-label="Platform sections">
          {CONSOLE_SECTIONS.map((s) => (
            <li key={s.id} className="border-b border-[#D7E1ED] last:border-b-0">
              <Link to={s.path} aria-current={s.id === active ? "page" : undefined} onClick={() => setOpen(false)} className={cn("flex h-11 items-center px-3 text-[14px]", s.id === active ? "font-bold text-[#075BE8]" : "text-[#132A42]")}>
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const FixtureBanner = () => (
  <p className="mt-[15px] flex min-h-[38px] items-center rounded-[5px] bg-[#EDF1F6] px-[14px] py-2 text-[12px] text-[#52677C]">
    DESIGN FIXTURE&nbsp;&nbsp;•&nbsp;&nbsp;Synthetic stores and metrics&nbsp;&nbsp;•&nbsp;&nbsp;No live actions or credentials
  </p>
);

export interface ConsoleFrameProps {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Scope text for the phone selector, e.g. "Production · All authorized stores". */
  scope?: string;
  /** Breadcrumb trail for detail pages. */
  breadcrumbs?: { label: string; to: string }[];
  /** Use the phone layout above the md breakpoint too (tablet references drawn as stacked cards). */
  compact?: boolean;
}

export function ConsoleFrame({ title, subtitle, children, onRefresh, refreshing, scope = "Production · All authorized stores", breadcrumbs, compact }: ConsoleFrameProps) {
  const fixture = useConsoleFixture();
  return (
    <div data-platform-console className={cn("min-h-full bg-[#F4F6F9] px-4 pb-10 pt-[18px] text-[#132A42]", !compact && "md:px-8 md:pt-[14px]")}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="sr-only">
          <ol>{breadcrumbs.map((b) => <li key={b.to}><Link to={b.to}>{b.label}</Link></li>)}</ol>
        </nav>
      )}
      <p className={cn("text-[11px] font-bold uppercase tracking-[0.04em] text-[#52677C]", !compact && "md:hidden")}>Platform console{fixture ? " · Design fixture" : ""}</p>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className={cn("mt-[6px] text-[26px] font-bold leading-[34px]", !compact && "md:mt-[4px] md:text-[28px] md:leading-[40px]")}>{title}</h1>
          <p className={cn("mt-[3px] hidden text-[13px] leading-[18px] text-[#52677C]", !compact && "md:block")}>{subtitle}</p>
        </div>
        <div className={cn("hidden shrink-0 items-start gap-[12px]", !compact && "md:flex")}>
          <span className="mt-[7px] inline-flex h-[26px] items-center rounded-[4px] bg-[#F4F6F9] px-[10px] text-[12px] font-bold text-[#075BE8]">{fixture?.environment ?? ENVIRONMENT_LABEL}</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh || refreshing}
            aria-label="Refresh recorded telemetry"
            className="inline-flex h-11 items-center gap-[10px] rounded-[6px] border border-[#D7E1ED] bg-white pl-[12px] pr-[17px] text-[13px] font-bold text-[#132A42] hover:bg-[#F4F6F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8] disabled:cursor-default"
          >
            <ConsoleIcon name="retry" size={20} className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
            Refresh
          </button>
        </div>
      </header>
      <SectionSelect scope={scope} compact={compact} />
      {!compact && <SectionNav />}
      {fixture && !compact && <div className="hidden md:block"><FixtureBanner /></div>}
      <div className={cn("mt-4 flex flex-col gap-[22px]", !compact && "md:mt-5")}>{children}</div>
    </div>
  );
}

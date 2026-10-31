import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ConsoleIcon } from "./icons";
import type { ConsoleIconName, MetricModel, StageModel, TelemetryState, TimelineItem, Tone } from "@/lib/platformConsole/types";
import { STATE_LABEL, STATE_TONE } from "@/lib/platformConsole/types";

// Console primitives, sized from the handoff's reference geometry (desktop
// 1600x1000: content x248-1568, cards 8px radius, controls 6px radius and 44px
// tall, 20px glyphs). They are deliberately separate from the shared product
// primitives so the console does not shift when those change.

export const PC = {
  ink: "#132A42",
  muted: "#52677C",
  blue: "#075BE8",
  line: "#D7E1ED",
  bg: "#F4F6F9",
  light: "#EDF4FF",
  green: "#11734E",
  greenbg: "#E8F5EF",
  amber: "#885608",
  amberbg: "#FFF5DE",
  red: "#B42332",
  redbg: "#FFF0F1",
  banner: "#EDF1F6",
} as const;

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-[#52677C]",
  good: "text-[#11734E]",
  warn: "text-[#885608]",
  bad: "text-[#B42332]",
  info: "text-[#075BE8]",
};

export const TONE_STRONG: Record<Tone, string> = {
  neutral: "text-[#132A42]",
  good: "text-[#11734E]",
  warn: "text-[#885608]",
  bad: "text-[#B42332]",
  info: "text-[#075BE8]",
};

export const TONE_BG: Record<Tone, string> = {
  neutral: "bg-[#F4F6F9]",
  good: "bg-[#E8F5EF]",
  warn: "bg-[#FFF5DE]",
  bad: "bg-[#FFF0F1]",
  info: "bg-[#EDF4FF]",
};

const TONE_ICON: Record<Tone, ConsoleIconName> = {
  neutral: "info",
  good: "check",
  warn: "warning",
  bad: "warning",
  info: "info",
};

export const Card = ({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-label"?: string; "aria-labelledby"?: string }) => (
  <Tag className={cn("rounded-[8px] border border-[#D7E1ED] bg-white", className)} {...rest}>
    {children}
  </Tag>
);

export const PanelHeading = ({ title, helper, id, action }: { title: ReactNode; helper?: ReactNode; id?: string; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h2 id={id} className="text-[17px] font-bold leading-[22px] text-[#132A42]">{title}</h2>
      {helper && <p className="mt-[6px] text-[12px] leading-[16px] text-[#52677C]">{helper}</p>}
    </div>
    {action}
  </div>
);

export const Panel = ({ title, helper, children, className, action, id }: { title: ReactNode; helper?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; id: string }) => (
  <Card className={cn("px-5 pb-5 pt-[19px]", className)} aria-labelledby={id}>
    <PanelHeading id={id} title={title} helper={helper} action={action} />
    {children}
  </Card>
);

/** A labelled state, always icon + text so it never relies on colour alone. */
export const StateLabel = ({ state, label, className }: { state: TelemetryState; label?: string; className?: string }) => {
  const tone = STATE_TONE[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", TONE_TEXT[tone], className)}>
      <ConsoleIcon name={TONE_ICON[tone]} size={16} />
      {label ?? STATE_LABEL[state]}
    </span>
  );
};

/** Coloured chip, e.g. "High · Store A". */
export const Chip = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex h-[26px] items-center whitespace-nowrap rounded-[4px] px-[10px] text-[12px] font-bold", TONE_BG[tone], TONE_TEXT[tone], className)}>
    {children}
  </span>
);

export const MetricCard = ({ metric }: { metric: MetricModel }) => (
  <Card as="div" className="flex min-h-[118px] flex-col px-[17px] pt-[17px]">
    <p className="flex items-center gap-[12px] text-[13px] leading-[20px] text-[#52677C]">
      <ConsoleIcon name={metric.icon} size={20} className={TONE_TEXT[metric.tone === "neutral" ? "info" : metric.tone]} />
      {metric.label}
    </p>
    <p className={cn("mt-[10px] text-[30px] font-bold leading-[36px] tabular-nums", TONE_STRONG[metric.tone])} data-dynamic="metric">{metric.value}</p>
    <p className="mt-[2px] pb-3 text-[12px] leading-[16px] text-[#52677C]">{metric.helper}</p>
    <span className="sr-only">Source: {metric.provenance.source}. Scope: {metric.provenance.scope}. State: {STATE_LABEL[metric.provenance.state]}.{metric.provenance.asOf ? ` As of ${metric.provenance.asOf}.` : " Not yet read."}</span>
  </Card>
);

export const MetricGrid = ({ metrics, label }: { metrics: MetricModel[]; label: string }) => (
  <section aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
    {metrics.map((m) => <MetricCard key={m.key} metric={m} />)}
  </section>
);

export const StageStrip = ({ stages, label, className }: { stages: StageModel[]; label: string; className?: string }) => (
  <ol aria-label={label} className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5", className)}>
    {stages.map((s) => (
      <li key={s.key} className={cn("flex h-[72px] flex-col justify-center rounded-[6px] px-3", TONE_BG[s.tone])}>
        <span className="text-[13px] font-bold leading-[18px] text-[#132A42]">{s.label}</span>
        <span className={cn("mt-[6px] text-[12px] leading-[16px]", TONE_TEXT[s.tone])}>{s.value}</span>
      </li>
    ))}
  </ol>
);

export const Timeline = ({ items, label }: { items: TimelineItem[]; label: string }) => (
  <ol aria-label={label} className="flex flex-col">
    {items.map((it, i) => (
      <li key={it.id} className="relative flex gap-[14px] pb-[26px]">
        <ConsoleIcon name={it.tone === "good" ? "check" : it.tone === "neutral" || it.tone === "info" ? "info" : "warning"} size={20} className={cn("mt-[1px] shrink-0", TONE_TEXT[it.tone])} />
        {i < items.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-[26px] h-[28px] w-[2px] bg-[#D7E1ED]" />}
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-[20px] text-[#132A42]">{it.title}</p>
          <p className="mt-[3px] text-[12px] leading-[16px] text-[#52677C]">{it.detail}</p>
        </div>
      </li>
    ))}
  </ol>
);

export interface Column<T> {
  key: string;
  header: string;
  /** Desktop column width (CSS grid track). */
  width: string;
  render: (row: T) => ReactNode;
  /** Label used in the stacked mobile card. Defaults to header. */
  cardLabel?: string;
}

/** Table on wide screens; labelled cards below md so no column is ever hidden. */
export function DataTable<T>({ rows, columns, rowKey, caption, rowHeight = 66, className, framed = true }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; caption: string; rowHeight?: number; className?: string; framed?: boolean }) {
  const template = columns.map((c) => c.width).join(" ");
  return (
    <div className={cn(framed && "rounded-[6px] border border-[#D7E1ED]", "overflow-hidden bg-white", className)}>
      <table className="hidden w-full md:table" aria-label={caption}>
        <thead>
          <tr className="grid h-[43px] items-center bg-[#F4F6F9] px-[15px]" style={{ gridTemplateColumns: template }}>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="text-left text-[12px] font-bold text-[#52677C]">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={cn("grid items-center px-[15px]", i < rows.length - 1 && "border-b border-[#D7E1ED]")} style={{ gridTemplateColumns: template, minHeight: rowHeight }}>
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-3 text-[13px] leading-[18px] text-[#132A42]">{c.render(r)}</td>
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

export const TextLink = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
  <Link to={to} className={cn("rounded-[2px] text-[13px] text-[#075BE8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]", className)}>
    {children}
  </Link>
);

export const ConsoleButton = ({ children, variant = "secondary", className, ...rest }: { children: ReactNode; variant?: "primary" | "secondary"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...rest}
    className={cn(
      "inline-flex h-11 items-center gap-2 rounded-[6px] px-[14px] text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8] disabled:cursor-not-allowed disabled:opacity-60",
      variant === "primary" ? "bg-[#075BE8] text-white hover:bg-[#064fca]" : "border border-[#D7E1ED] bg-white text-[#132A42] hover:bg-[#F4F6F9]",
      className,
    )}
  >
    {children}
  </button>
);

/** Rows of label/value pairs, e.g. action review or connection details. */
export const FactRows = ({ rows, labelWidth = 263, rowHeight = 64 }: { rows: { label: string; value: ReactNode }[]; labelWidth?: number; rowHeight?: number }) => (
  <dl className="flex flex-col">
    {rows.map((r) => (
      <div key={r.label} className="flex flex-col gap-1 border-b border-[#D7E1ED] py-3 md:flex-row md:items-center md:gap-0 md:py-0" style={{ minHeight: rowHeight }}>
        <dt className="shrink-0 text-[13px] font-bold text-[#52677C]" style={{ width: labelWidth }}>{r.label}</dt>
        <dd className="text-[14px] text-[#132A42]">{r.value}</dd>
      </div>
    ))}
  </dl>
);

/** Bounded non-ready states. "Checking" always ends in one of these. */
export const ViewState = ({ status, error, onRetry, what }: { status: "loading" | "empty" | "denied" | "timeout" | "error"; error?: string | null; onRetry?: () => void; what: string }) => {
  if (status === "loading") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4" aria-label={`Loading ${what}`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[118px] animate-pulse rounded-[8px] bg-white motion-reduce:animate-none" />)}
        </div>
        <div className="h-[358px] animate-pulse rounded-[8px] bg-white motion-reduce:animate-none" />
      </div>
    );
  }
  const copy = {
    empty: { title: `No ${what} recorded yet`, body: "Nothing has been collected for this scope. That is not the same as healthy." },
    denied: { title: "Not authorized", body: "Your account cannot view this scope. No partial data is shown." },
    timeout: { title: "Timed out", body: "The request did not finish within 15 seconds. Last known data is not shown as current." },
    error: { title: `Could not load ${what}`, body: error ?? "The request failed." },
  }[status];
  return (
    <Card className="p-6" aria-label={copy.title}>
      <p className="flex items-center gap-2 text-[15px] font-bold text-[#132A42]">
        <ConsoleIcon name={status === "denied" ? "lock" : status === "empty" ? "info" : "warning"} size={20} className={status === "empty" ? "text-[#52677C]" : "text-[#885608]"} />
        {copy.title}
      </p>
      <p className="mt-2 text-[13px] text-[#52677C]">{copy.body}</p>
      {onRetry && status !== "denied" && <ConsoleButton className="mt-4" onClick={onRetry}><ConsoleIcon name="retry" />Try again</ConsoleButton>}
    </Card>
  );
};

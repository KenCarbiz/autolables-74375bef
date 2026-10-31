import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Tone } from "@/components/admin/v2/primitives";

/** Parent / Child trail above a child page title. The last item is the current page. */
export const Crumbs = ({ items }: { items: Array<{ label: ReactNode; to?: string }> }) => (
  <nav aria-label="Breadcrumb" className="text-[13px] leading-[18px] text-adm-muted">
    <ol className="flex flex-wrap items-center gap-x-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-x-1.5 min-w-0">
          {i > 0 && <span aria-hidden="true">/</span>}
          {item.to ? (
            <Link to={item.to} className="font-semibold text-adm-primary hover:underline">{item.label}</Link>
          ) : (
            <span aria-current="page" className="text-adm-ink truncate">{item.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export interface Fact {
  label: ReactNode;
  value: ReactNode;
}

/** Label over value, in a bordered strip: the compact identity row under a child title. */
export const FactStrip = ({ facts, className, label }: { facts: Fact[]; className?: string; label: string }) => (
  <dl aria-label={label} className={cn("grid grid-cols-2 gap-x-6 gap-y-3 rounded-[6px] border border-adm-border bg-adm-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-5", className)}>
    {facts.map((f, i) => (
      <div key={i} className="min-w-0">
        <dt className="text-[12px] leading-[18px] text-adm-muted">{f.label}</dt>
        <dd className="text-[14px] leading-[20px] font-semibold text-adm-ink truncate" title={typeof f.value === "string" ? f.value : undefined}>{f.value}</dd>
      </div>
    ))}
  </dl>
);

/** Label left, value right, hairline between rows: the summary-panel list. */
export const SummaryList = ({ rows, className, dense = false }: { rows: Array<{ label: ReactNode; value: ReactNode; strong?: boolean }>; className?: string; dense?: boolean }) => (
  <dl className={cn("text-[14px] leading-[20px]", className)}>
    {rows.map((r, i) => (
      <div key={i} className={cn("flex items-baseline justify-between gap-4 border-b border-adm-border last:border-b-0", dense ? "py-1" : "py-2", r.strong && "font-semibold")}>
        <dt className="text-adm-muted">{r.label}</dt>
        <dd className="text-adm-ink text-right min-w-0 tabular-nums">{r.value}</dd>
      </div>
    ))}
  </dl>
);

const ASIDE_COLS = { default: "lg:grid-cols-[minmax(0,1fr)_340px]", wide: "lg:grid-cols-[minmax(0,1fr)_400px]", wider: "lg:grid-cols-[minmax(0,1fr)_460px]" };

/** Main column plus a 340px right panel (400 or 460 when widened); the panel stacks under the main column below 1024px. */
export const DetailLayout = ({ main, aside, width = "default" }: { main: ReactNode; aside: ReactNode; width?: keyof typeof ASIDE_COLS }) => (
  <div className={cn("grid gap-6 lg:items-start", ASIDE_COLS[width])}>
    <div className="min-w-0 flex flex-col gap-6">{main}</div>
    <aside className="min-w-0 flex flex-col gap-6">{aside}</aside>
  </div>
);

export const fmtDateTime = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown";

export const fmtDay = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown";

const COMMAND_TONE: Record<string, Tone> = { slate: "neutral", blue: "info", amber: "warning", red: "danger", emerald: "success", violet: "info" };

/** Maps the command-center tone names onto the product Tone scale. */
export const productTone = (tone: string | undefined): Tone => (tone ? COMMAND_TONE[tone] : undefined) ?? "neutral";

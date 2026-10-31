import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusText, SkeletonBlock } from "@/components/product";
import type { Tone as ChipTone } from "@/components/product";

// Compliance pieces rebuilt on the national product vocabulary. The export
// names are unchanged so every section keeps working; only the treatment
// changed: flat panels, flat metric cells, text status, no pills, no tinted
// cards. A count that has not been read yet shows a skeleton, never zero.

export const SectionHeading = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="max-w-3xl">
      <h2 className="text-[17px] leading-[24px] font-semibold text-adm-ink">{title}</h2>
      <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{description}</p>
    </div>
    {action}
  </div>
);

export type Tone = "neutral" | "critical" | "attention" | "clear";

const TONE_CHIP: Record<Tone, ChipTone> = {
  neutral: "neutral",
  critical: "danger",
  attention: "warning",
  clear: "success",
};

const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-adm-border",
  critical: "bg-adm-danger",
  attention: "bg-[#D98B00]",
  clear: "bg-adm-success",
};

/** A count plus the sentence that says exactly what population it counts. */
export const CountTile = ({
  label,
  value,
  means,
  tone = "neutral",
  active = false,
  onClick,
  loading = false,
}: {
  label: string;
  value: number | string | null;
  means: string;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) => {
  const body = (
    <>
      <span className={cn("absolute left-4 top-4 bottom-4 w-[3px] rounded-[2px]", TONE_BAR[tone])} aria-hidden="true" />
      <p className="text-[12px] leading-[18px] font-medium text-adm-muted">{label}</p>
      <p className="mt-0.5 text-[24px] leading-[32px] font-bold tabular-nums text-adm-ink">
        {loading ? <SkeletonBlock className="h-7 w-16" /> : value === null ? <span className="text-adm-muted">Unknown</span> : value}
      </p>
      <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted">{means}</p>
    </>
  );
  const shell = cn(
    "relative block min-w-0 rounded-[6px] border border-adm-border bg-adm-surface py-4 pl-8 pr-4 text-left",
    active && "outline outline-2 -outline-offset-2 outline-adm-primary",
  );
  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(shell, "hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary")}
    >
      {body}
    </button>
  );
};

/** State as icon plus text on a flat tint. Not a pill. */
export const StateBadge = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <StatusText tone={TONE_CHIP[tone]}>
    {children}
  </StatusText>
);

export const Panel = ({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title?: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface", className)}>
    {(title || action) && (
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-adm-border px-4 py-3">
        <div>
          {title && <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title}</h3>}
          {meta && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{meta}</p>}
        </div>
        {action}
      </header>
    )}
    {children}
  </section>
);

/** Deliberate empty state. Never a placeholder row, never an invented number. */
export const EmptyState = ({
  icon: Icon,
  headline,
  body,
  tone = "neutral",
}: {
  icon: LucideIcon;
  headline: string;
  body: string;
  tone?: Tone;
}) => (
  <div className="px-6 py-10 text-center">
    <Icon
      className={cn("mx-auto mb-3 h-6 w-6", tone === "clear" ? "text-adm-success" : "text-adm-muted")}
      strokeWidth={1.75}
      aria-hidden="true"
    />
    <p className="text-[14px] font-semibold text-adm-ink">{headline}</p>
    <p className="mx-auto mt-1 max-w-md text-[13px] leading-[18px] text-adm-muted">{body}</p>
  </div>
);

/** Rows here are VIN lists, so the shell scrolls inside itself on a phone. */
export const TableShell = ({ headers, children }: { headers: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table">
    <table className="w-full min-w-[860px] border-collapse text-left text-[14px] leading-[20px] text-adm-ink">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={`${h}-${i}`}
              scope="col"
              className="border-b border-adm-border bg-adm-workspace px-4 py-3 text-[12px] leading-[18px] font-semibold text-adm-muted"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-adm-border">{children}</tbody>
    </table>
  </div>
);

export const RowAction = ({
  onClick,
  children,
  href,
}: {
  onClick?: () => void;
  children: ReactNode;
  href?: string;
}) => {
  const cls =
    "inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-[13px] font-semibold text-adm-ink hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
};

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

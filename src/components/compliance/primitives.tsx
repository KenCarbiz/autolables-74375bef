import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

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
      <h2 className="text-al-section font-display text-foreground">{title}</h2>
      <p className="mt-1 text-al-body text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>
);

export type Tone = "neutral" | "critical" | "attention" | "clear";

const TONE_TILE: Record<Tone, string> = {
  neutral: "border-border bg-card",
  critical: "border-destructive/30 bg-destructive/5",
  attention: "border-amber-300 bg-amber-50",
  clear: "border-emerald-300 bg-emerald-50",
};

const TONE_VALUE: Record<Tone, string> = {
  neutral: "text-foreground",
  critical: "text-destructive",
  attention: "text-amber-800",
  clear: "text-emerald-800",
};

const TONE_LABEL: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  critical: "text-destructive",
  attention: "text-amber-800",
  clear: "text-emerald-800",
};

/** A count plus the sentence that says exactly what population it counts. */
export const CountTile = ({
  label,
  value,
  means,
  tone = "neutral",
  active = false,
  onClick,
}: {
  label: string;
  value: number | string;
  means: string;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
}) => {
  const body = (
    <>
      <p className={`text-al-meta font-bold uppercase tracking-label ${TONE_LABEL[tone]}`}>{label}</p>
      <p className={`mt-1 font-display text-3xl font-black tabular-nums ${TONE_VALUE[tone]}`}>{value}</p>
      <p className="mt-1.5 text-al-meta leading-4 text-muted-foreground">{means}</p>
    </>
  );
  const shell = `rounded-2xl border p-4 text-left ${TONE_TILE[tone]} ${active ? "ring-2 ring-ring" : ""}`;
  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={`${shell} hover:bg-muted/40`}>
      {body}
    </button>
  );
};

export const StateBadge = ({ tone, children }: { tone: Tone; children: ReactNode }) => {
  const map: Record<Tone, string> = {
    neutral: "border-border bg-muted text-muted-foreground",
    critical: "border-destructive/30 bg-destructive/10 text-destructive",
    attention: "border-amber-300 bg-amber-50 text-amber-800",
    clear: "border-emerald-300 bg-emerald-50 text-emerald-800",
  };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-al-meta font-bold ${map[tone]}`}>
      {children}
    </span>
  );
};

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
  <section className={`overflow-hidden rounded-2xl border border-border bg-card ${className}`}>
    {(title || action) && (
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          {title && <h3 className="text-al-card text-foreground">{title}</h3>}
          {meta && <p className="mt-0.5 text-al-meta text-muted-foreground">{meta}</p>}
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
  <div className="px-6 py-12 text-center">
    <Icon
      className={`mx-auto mb-3 h-7 w-7 ${tone === "clear" ? "text-emerald-600" : "text-muted-foreground"}`}
      strokeWidth={1.75}
    />
    <p className="text-al-card text-foreground">{headline}</p>
    <p className="mx-auto mt-1 max-w-md text-al-body text-muted-foreground">{body}</p>
  </div>
);

export const TableShell = ({ headers, children }: { headers: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[860px] text-left">
      <thead className="border-b border-border bg-muted/50">
        <tr>
          {headers.map((h) => (
            <th key={h} className="px-4 py-2.5 text-al-meta font-bold uppercase tracking-label text-muted-foreground">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
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
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-al-meta font-bold text-foreground hover:bg-muted";
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

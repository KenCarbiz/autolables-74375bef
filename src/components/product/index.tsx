import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ProductIcon, type ProductIconName } from "@/components/design/ProductIcon";
import {
  AdminButton,
  AdminCard,
  AdminLinkButton,
  AdminTable,
  EmptyState,
  InlineNote,
  KeyValueList,
  SkeletonBlock,
  StatusChip,
  Td,
  Th,
  ValueOrUnknown,
  type Tone,
} from "@/components/admin/v2/primitives";

// The national product vocabulary for every authenticated dealer and platform
// page: one page header, flat text tabs, a metric strip of four or fewer, and
// the Administration V2 table, panel, button and status pieces under neutral
// names. Geometry and colour come from src/styles/national-product.css.

export {
  AdminButton as Button,
  AdminLinkButton as LinkButton,
  AdminCard as Panel,
  AdminTable as WorkTable,
  Th,
  Td,
  StatusChip as StatusText,
  InlineNote,
  KeyValueList,
  EmptyState,
  SkeletonBlock,
  ValueOrUnknown,
  ProductIcon,
};
export type { Tone, ProductIconName };

/** Page body: 24px desktop padding, 16px on phones, 24px between sections. */
export const PageBody = ({ children, className, width = "full" }: { children: ReactNode; className?: string; width?: "full" | "wide" | "form" }) => (
  <div
    className={cn(
      "px-4 py-4 sm:px-6 sm:py-6 flex flex-col gap-6 text-adm-ink",
      width === "wide" && "max-w-[1600px]",
      width === "form" && "max-w-[1120px]",
      className,
    )}
  >
    {children}
  </div>
);

/**
 * Title 28/36, one sentence of purpose, an optional scope line and one primary
 * action. Secondary actions sit beside it; nothing here starts work on mount.
 */
export const PageHeader = ({
  title,
  description,
  scope,
  meta,
  actions,
  className,
  as: Tag = "h1",
}: {
  title: ReactNode;
  description?: ReactNode;
  scope?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) => (
  <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6", className)}>
    <div className="min-w-0">
      {scope && <p className="mb-1 text-[12px] leading-[18px] font-semibold text-adm-muted">{scope}</p>}
      <Tag className="text-[24px] leading-[32px] sm:text-[28px] sm:leading-[36px] font-bold tracking-[-0.01em] text-adm-ink">{title}</Tag>
      {description && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{description}</p>}
    </div>
    {(actions || meta) && (
      <div className="flex flex-col gap-2 sm:items-end flex-shrink-0">
        {meta && <div className="text-[12px] leading-[18px] text-adm-muted">{meta}</div>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
  </header>
);

/** Section heading inside a page: 17/24 semibold. */
export const SectionHeading = ({ title, description, action, as: Tag = "h2", id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; as?: "h2" | "h3"; id?: string }) => (
  <div className="flex items-end justify-between gap-4 flex-wrap">
    <div className="min-w-0">
      <Tag id={id} className="text-[17px] leading-[24px] font-semibold text-adm-ink">{title}</Tag>
      {description && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{description}</p>}
    </div>
    {action}
  </div>
);

export interface LocalTab {
  label: ReactNode;
  to: string;
  count?: number | string | null;
  /** Overrides the location match, for tabs held in component state. */
  active?: boolean;
  key?: string;
}

const tabMatches = (to: string, pathname: string, search: string) => {
  const [base, query] = to.split("?");
  if (base !== pathname) return false;
  if (!query) return true;
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
};

/**
 * Flat local navigation: text with an active underline, each tab a real link
 * so deep links, reload and back keep working. Scrolls sideways on a phone
 * instead of wrapping or clipping.
 */
export const LocalTabs = ({ tabs, label, className, defaultKey }: { tabs: LocalTab[]; label: string; className?: string; defaultKey?: string }) => {
  const { pathname, search } = useLocation();
  const matched = tabs.map((t) => t.active ?? tabMatches(t.to, pathname, search));
  // With no query-string match, the tab named as the default (or the first
  // whose path matches) is current, so a bare URL still lights a tab.
  const anyActive = matched.some(Boolean);
  return (
    <nav aria-label={label} className={cn("overflow-x-auto border-b border-adm-border print:hidden", className)}>
      <ul className="flex min-w-max items-stretch gap-6">
        {tabs.map((t, i) => {
          const key = t.key ?? t.to;
          const active = anyActive ? matched[i] : defaultKey ? key === defaultKey : i === 0 && t.to.split("?")[0] === pathname;
          return (
            <li key={key} className="flex">
              <Link
                to={t.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-[44px] lg:min-h-[40px] items-center gap-1.5 border-b-2 px-0.5 text-[14px] leading-[20px] whitespace-nowrap transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary",
                  active ? "border-adm-primary font-semibold text-adm-primary" : "border-transparent font-medium text-adm-muted hover:text-adm-ink",
                )}
              >
                {t.label}
                {t.count !== undefined && t.count !== null && <span className="tabular-nums">({t.count})</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export interface Metric {
  label: ReactNode;
  /** null renders Unknown, never a zero standing in for a failed read. */
  value: ReactNode | null;
  /** Scope, period or denominator, e.g. "of 130 active". */
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
  loading?: boolean;
  key?: string;
}

const BAR: Record<Tone, string> = {
  neutral: "bg-adm-border",
  info: "bg-adm-primary",
  success: "bg-adm-success",
  warning: "bg-[#D98B00]",
  danger: "bg-adm-danger",
};

/** Four or fewer primary metrics in one strip, each with its own denominator. */
export const MetricStrip = ({ metrics, label, className, action }: { metrics: Metric[]; label: string; className?: string; action?: ReactNode }) => {
  const shown = metrics.slice(0, 4);
  return (
    <section aria-label={label} className={cn("rounded-[6px] border border-adm-border bg-adm-surface", className)}>
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <dl className={cn("grid flex-1 grid-cols-2", shown.length >= 4 ? "lg:grid-cols-4" : shown.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {shown.map((m, i) => {
            const body = (
              <>
                <span className={cn("absolute left-4 top-4 bottom-4 w-[3px] rounded-[2px]", BAR[m.tone ?? "neutral"])} aria-hidden="true" />
                <dt className="text-[12px] leading-[18px] font-medium text-adm-muted">{m.label}</dt>
                <dd className="mt-0.5 text-[24px] leading-[32px] font-bold tabular-nums text-adm-ink">
                  {m.loading ? <SkeletonBlock className="h-7 w-16" /> : <ValueOrUnknown value={m.value} />}
                </dd>
                {m.hint && <dd className="text-[12px] leading-[18px] text-adm-muted">{m.hint}</dd>}
              </>
            );
            const cell = cn(
              "relative block py-4 pl-8 pr-4 min-w-0",
              i % 2 === 1 && "border-l border-adm-border",
              i >= 2 && "border-t border-adm-border lg:border-t-0",
              i >= 1 && "lg:border-l",
            );
            return m.href ? (
              <Link key={m.key ?? i} to={m.href} className={cn(cell, "hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary")}>
                {body}
              </Link>
            ) : (
              <div key={m.key ?? i} className={cell}>{body}</div>
            );
          })}
        </dl>
        {action && <div className="flex items-center border-t border-adm-border p-4 lg:border-l lg:border-t-0">{action}</div>}
      </div>
    </section>
  );
};

export type QueryStatus = "loading" | "error" | "empty" | "ready";

/**
 * One reading of a scoped query: a skeleton before the first read, an error
 * that keeps its retry, an empty state only after a successful read, and the
 * content otherwise. Loading or failure never renders as an empty success.
 */
export const QueryState = ({
  status,
  children,
  skeleton,
  errorTitle = "This information could not be loaded.",
  errorDetail,
  onRetry,
  emptyTitle = "Nothing to show yet.",
  emptyDetail,
  emptyArtwork,
  emptyAction,
}: {
  status: QueryStatus;
  children?: ReactNode;
  skeleton?: ReactNode;
  errorTitle?: string;
  errorDetail?: ReactNode;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDetail?: ReactNode;
  emptyArtwork?: string;
  emptyAction?: ReactNode;
}) => {
  if (status === "loading")
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-2 p-4">
        {skeleton ?? (
          <>
            <SkeletonBlock className="h-5 w-1/3" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-2/3" />
          </>
        )}
      </div>
    );
  if (status === "error")
    return (
      <div className="p-4">
        <InlineNote tone="danger" title={errorTitle} action={onRetry ? <AdminButton size="sm" onClick={onRetry}>Retry</AdminButton> : undefined}>
          {errorDetail}
        </InlineNote>
      </div>
    );
  if (status === "empty") return <EmptyState title={emptyTitle} detail={emptyDetail} artwork={emptyArtwork} action={emptyAction} compact />;
  return <>{children}</>;
};

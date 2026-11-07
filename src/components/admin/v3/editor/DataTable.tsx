import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { ScrollRegion } from "@/components/admin/v2/ScrollRegion";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { useIsNarrow } from "./useIsNarrow";
import { INPUT_CLASS } from "./EditorLayout";
import { SelectField } from "./FormControls";
import { EditorEmpty } from "./EditorArtwork";

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number] | 10;

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** The cell that opens the detail drawer by keyboard: its content is wrapped in a button. */
  primary?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: DataColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  searchText?: (row: T) => string;
  searchLabel?: string;
  filters?: ReactNode;
  loading?: boolean;
  error?: { message: ReactNode; onRetry?: () => void } | null;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** Defaults to 25, or 10 below 768px. */
  initialPageSize?: PageSize | 10;
  onOpenRow?: (row: T) => void;
  rowLabel?: (row: T) => string;
  minWidth?: number;
}

const SKELETON_ROWS = 5;

export function DataTable<T>({
  caption, columns, rows, rowKey, searchText, searchLabel = "Search", filters, loading, error, emptyTitle = "Nothing here yet",
  emptyDescription, emptyAction, initialPageSize, onOpenRow, rowLabel, minWidth = 640,
}: DataTableProps<T>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const narrow = useIsNarrow();
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize ?? (narrow ? 10 : 25));
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
  }, [rows, query, searchText]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [page, pageCount]);
  const start = page * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  const primaryColumn = columns.find((c) => c.primary) ?? columns[0];
  const state: "loading" | "error" | "empty" | "no-results" | "ready" = loading ? "loading" : error ? "error" : !rows || rows.length === 0 ? "empty" : filtered.length === 0 ? "no-results" : "ready";

  return (
    <div data-table-state={state} className="rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)]">
      {((searchText && state !== "empty") || filters) && (
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-adm-divider">
          {searchText && state !== "empty" && (
            <div className="relative flex-1 basis-[220px] max-w-md">
              <label htmlFor={`${id}-search`} className="sr-only">{searchLabel}</label>
              <AdminIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-muted pointer-events-none" />
              <input
                id={`${id}-search`}
                type="search"
                value={query}
                disabled={state === "loading" || state === "error"}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                placeholder={searchLabel}
                className={cn(INPUT_CLASS, "pl-10")}
              />
            </div>
          )}
          {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}
        </div>
      )}

      {state === "loading" && (
        <div role="status" aria-busy="true" className="px-4 py-4 space-y-3">
          <span className="sr-only">Loading {caption}</span>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <div key={i} className="h-10 rounded-md bg-adm-workspace animate-pulse motion-reduce:animate-none" aria-hidden="true" />)}
        </div>
      )}
      {state === "error" && error && (
        <EditorEmpty tone="danger" title={`Could not load ${caption.toLowerCase()}`} description={error.message} action={error.onRetry ? <AdminButton variant="secondary" onClick={error.onRetry}>Try again</AdminButton> : undefined} />
      )}
      {state === "empty" && <EditorEmpty artwork="documents" title={emptyTitle} description={emptyDescription} action={emptyAction} />}
      {state === "no-results" && (
        <EditorEmpty artwork="search" title="No matches" description={`Nothing matches "${query.trim()}".`} action={<AdminButton variant="secondary" onClick={() => setQuery("")}>Clear search</AdminButton>} />
      )}

      {state === "ready" && (
        <>
          {narrow ? (
            <ul aria-label={caption} className="divide-y divide-adm-divider">
              {visible.map((row) => {
                const primary = primaryColumn;
                const rest = columns.filter((c) => c !== primary);
                return (
                  <li key={rowKey(row)} className="px-4 py-3 space-y-2">
                    {onOpenRow ? (
                      <button type="button" aria-label={rowLabel ? `Open details for ${rowLabel(row)}` : undefined} onClick={() => onOpenRow(row)} className="w-full min-h-[44px] text-left text-[15px] font-semibold text-adm-primary rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
                        {primary.cell(row)}
                      </button>
                    ) : <p className="text-[15px] font-semibold">{primary.cell(row)}</p>}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px] leading-[20px]">
                      {rest.map((c) => (<div key={c.id} className="contents"><dt className="text-adm-muted">{c.header}</dt><dd className="min-w-0 break-words">{c.cell(row)}</dd></div>))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          ) : (
          <ScrollRegion label={caption} innerClassName="lg:overflow-visible">
            <table className="w-full border-collapse text-left text-[14px] leading-[20px] text-adm-ink max-lg:min-w-[var(--dt-min)]" style={{ "--dt-min": `${minWidth}px` } as React.CSSProperties}>
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" className={cn("sticky top-[var(--adm-sticky-top,0px)] z-10 bg-adm-workspace px-4 py-2.5 text-[13px] leading-[18px] font-semibold text-adm-muted border-b border-adm-divider", c.align === "right" ? "text-right" : "text-left")}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onOpenRow ? (e) => { if (!(e.target as Element).closest("button, a, input, select, textarea")) onOpenRow(row); } : undefined}
                    className={cn("border-b border-adm-divider last:border-b-0", onOpenRow && "cursor-pointer hover:bg-adm-workspace")}
                  >
                    {columns.map((c) => (
                      <td key={c.id} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right tabular-nums", c.className)}>
                        {onOpenRow && c === primaryColumn ? (
                          <button type="button" aria-label={rowLabel ? `Open details for ${rowLabel(row)}` : undefined} onClick={() => onOpenRow(row)} className="text-left font-semibold text-adm-primary hover:underline rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
                            {c.cell(row)}
                          </button>
                        ) : c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-adm-divider text-[14px] text-adm-muted">
            <p aria-live="polite">Showing {start + 1} to {start + visible.length} of {filtered.length}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2">
                <span>Rows per page</span>
                <SelectField value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value) as PageSize); setPage(0); }} wrapperClassName="w-auto">
                  {(narrow ? [10, ...PAGE_SIZES] : PAGE_SIZES).map((n) => <option key={n} value={n}>{n}</option>)}
                </SelectField>
              </label>
              <nav aria-label={`${caption} pages`} className="flex items-center gap-2">
                <AdminButton variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  <AdminIcon name="arrow-left" /> Previous
                </AdminButton>
                <span aria-current="page" className="px-1 tabular-nums">Page {page + 1} of {pageCount}</span>
                <AdminButton variant="secondary" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
                  Next <AdminIcon name="arrow-right" />
                </AdminButton>
              </nav>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

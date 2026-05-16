import { useMemo, useState } from "react";
import {
  ArrowUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, Download,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// tablePrimitives — shared sort + pagination + CSV helpers used
// across PlatformAdmin tables (Tenants, Members, Entitlements,
// Audit). Drop-in: each table keeps its existing filters and
// markup; the hook returns a `paginated` slice and the two
// components plug into thead / table footer.
// ──────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc";

interface UseSortPagOpts<T> {
  defaultSortKey?: string | null;
  defaultSortDir?: SortDir;
  defaultPageSize?: number;
  // Custom value getter — needed when a column sorts by a
  // resolved label (e.g. tenant name looked up from a Map) rather
  // than a raw row field.
  getSortValue?: (row: T, key: string) => unknown;
}

export function useSortAndPaginate<T>(items: T[], opts: UseSortPagOpts<T> = {}) {
  const [sortKey, setSortKey] = useState<string | null>(opts.defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(opts.defaultSortDir ?? "desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(opts.defaultPageSize ?? 50);

  const setPageSize = (n: number) => { setPageSizeRaw(n); setPage(1); };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const getter = opts.getSortValue
      ?? ((row: T, key: string) => (row as Record<string, unknown>)[key]);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = getter(a, sortKey);
      const vb = getter(b, sortKey);
      // Nulls always sort to the end regardless of direction so
      // an "empty Expires" row doesn't displace a real date.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir, opts]);

  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  return {
    sortKey,
    sortDir,
    toggleSort,
    page: currentPage,
    pageSize,
    setPage,
    setPageSize,
    paginated,
    sorted,
    totalCount,
    totalPages,
  };
}

interface SortHeaderProps {
  label: string;
  sortKey?: string;
  activeKey: string | null;
  dir: SortDir;
  onToggle: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}

export const SortHeader = ({
  label, sortKey, activeKey, dir, onToggle,
  align = "left", className = "",
}: SortHeaderProps) => {
  const sortable = !!sortKey;
  const active = sortable && activeKey === sortKey;
  return (
    <th className={`text-${align} px-3 py-2 font-semibold ${className}`}>
      {sortable ? (
        <button
          type="button"
          onClick={() => onToggle(sortKey!)}
          className={`inline-flex items-center gap-1 transition-colors ${
            active ? "text-foreground" : "hover:text-foreground"
          }`}
        >
          {label}
          {active ? (
            dir === "asc"
              ? <ArrowUp className="w-3 h-3" />
              : <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUpDown className="w-3 h-3 opacity-40" />
          )}
        </button>
      ) : (
        label
      )}
    </th>
  );
};

interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  visibleCount: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
  pageSizeOptions?: number[];
  onExportCsv?: () => void;
  exportLabel?: string;
}

export const TablePagination = ({
  page, totalPages, pageSize, totalCount, visibleCount,
  setPage, setPageSize,
  pageSizeOptions = [25, 50, 100, 250],
  onExportCsv,
  exportLabel = "CSV",
}: PaginationProps) => {
  const first = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = totalCount === 0 ? 0 : first + visibleCount - 1;
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-semibold text-foreground tabular-nums">{first}</span>
          {first !== last && (
            <>–<span className="font-semibold text-foreground tabular-nums">{last}</span></>
          )}
          {" "}of <span className="font-semibold text-foreground tabular-nums">{totalCount}</span>
        </span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
          className="h-7 px-1.5 rounded border border-border bg-background text-xs"
          aria-label="Rows per page"
        >
          {pageSizeOptions.map(n => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        {onExportCsv && (
          <button
            type="button"
            onClick={onExportCsv}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-background text-xs font-semibold text-foreground"
          >
            <Download className="w-3 h-3" />
            {exportLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 tabular-nums">
          Page <span className="font-semibold text-foreground">{page}</span> of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

// CSV helper — quotes anything with commas, quotes, or newlines;
// stringifies objects/arrays so JSON details columns export cleanly.
export interface CsvColumn<T> {
  header: string;
  get: (row: T) => unknown;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = v instanceof Date
      ? v.toISOString()
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c.header)).join(",");
  const body = rows.map(r => columns.map(c => esc(c.get(r))).join(",")).join("\r\n");
  return `${head}\r\n${body}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

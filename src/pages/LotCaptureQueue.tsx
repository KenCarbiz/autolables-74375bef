import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVinScan } from "@/contexts/VinScanContext";
import PageTabs, { VEHICLES_TABS } from "@/components/layout/PageTabs";
import { format } from "date-fns";
import {
  ScanLine, Car, Printer, Trash2, CheckCircle2,
  AlertCircle, Loader2, Search, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useVinQueue, type QueuedVehicle } from "@/hooks/useVinQueue";
import {
  SortHeader,
  TablePagination,
  useSortAndPaginate,
  useTableDensity,
  DensityToggle,
  toCsv,
  downloadCsv,
} from "@/components/admin/tablePrimitives";
import { TableEmptyState } from "@/components/admin/TableEmptyState";

// ──────────────────────────────────────────────────────────────
// LotCaptureQueue — Wave 21 · Process Dashboard FlowTile #1.
//
// The polished Lot Capture queue. Inherits the V2 (HarteCash /
// Autocurb) chrome: sortable + paginated + density-toggle table
// shared with the platform-admin tables (Wave 12), multi-select
// + bulk-action toolbar, status-tag chips that name the next
// action, illustrated empty state, CSV export.
//
// Single shared hook (useVinQueue, Wave 9 Supabase-backed) so a
// scan on the phone via /scan appears here without a refresh
// (Wave 14.6 realtime sync covers vin_queue).
// ──────────────────────────────────────────────────────────────

type QueueFilter = "all" | "queued" | "processing" | "completed";

const STATUS_TAGS: Record<QueuedVehicle["status"], { label: string; tone: string; nextAction: string }> = {
  queued:     { label: "Needs sticker",       tone: "border-amber-200 bg-amber-50 text-amber-900",       nextAction: "Send to addendum" },
  processing: { label: "Sticker in progress", tone: "border-sky-200 bg-sky-50 text-sky-900",             nextAction: "Resume work" },
  completed:  { label: "Done",                tone: "border-emerald-200 bg-emerald-50 text-emerald-900", nextAction: "Re-open" },
  error:      { label: "Error",               tone: "border-rose-200 bg-rose-50 text-rose-900",          nextAction: "Re-scan" },
};

const LotCaptureQueue = () => {
  const navigate = useNavigate();
  const { openScan } = useVinScan();
  const { queue, loading, updateItem, removeItem, clearCompleted } = useVinQueue();

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { density, setDensity, rowClass } = useTableDensity();

  // ── Filter pipeline ───────────────────────────────────────
  const rows = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return queue
      .filter(item => {
        if (filter === "all") return true;
        return item.status === filter;
      })
      .filter(item => {
        if (!lc) return true;
        const decoded = (item.decoded_data as any)?.decoded;
        const ymm = (decoded?.ymm || "").toLowerCase();
        return (
          item.vin.toLowerCase().includes(lc) ||
          item.stock_number.toLowerCase().includes(lc) ||
          ymm.includes(lc) ||
          item.notes.toLowerCase().includes(lc)
        );
      });
  }, [queue, q, filter]);

  const sortPag = useSortAndPaginate<QueuedVehicle>(rows, {
    defaultSortKey: "scanned_at",
    defaultSortDir: "desc",
    defaultPageSize: 50,
    getSortValue: (row, key) => {
      if (key === "ymm") return (row.decoded_data as any)?.decoded?.ymm || "";
      return (row as unknown as Record<string, unknown>)[key];
    },
  });

  // ── Status counts for the filter pills ─────────────────────
  const counts = useMemo(() => ({
    all: queue.length,
    queued:     queue.filter(q => q.status === "queued").length,
    processing: queue.filter(q => q.status === "processing").length,
    completed:  queue.filter(q => q.status === "completed").length,
  }), [queue]);

  // ── Bulk actions ──────────────────────────────────────────
  const toggleAll = () => {
    if (selected.size === sortPag.paginated.length && sortPag.paginated.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortPag.paginated.map(r => r.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkSendToAddendum = () => {
    // For one-vehicle bulk, jump directly. For many, open them
    // sequentially via window.open with a small stagger — that
    // way the dealer can quickly process a stack on the lot.
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const item = sortPag.paginated.find(r => r.id === ids[0]);
      if (!item) return;
      navigateToAddendum(item);
      updateItem(item.id, { status: "processing" });
      setSelected(new Set());
      return;
    }
    // Multiple — just mark them processing and show a toast
    // pointing the dealer to the addendum builder one at a time.
    // Opening N tabs would be too aggressive.
    ids.forEach(id => updateItem(id, { status: "processing" }));
    toast.success(`${ids.length} vehicle${ids.length === 1 ? "" : "s"} marked processing — open them one at a time from the queue`);
    setSelected(new Set());
  };

  const bulkComplete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    ids.forEach(id => updateItem(id, { status: "completed" }));
    toast.success(`${ids.length} vehicle${ids.length === 1 ? "" : "s"} marked completed`);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} vehicle${ids.length === 1 ? "" : "s"} from the queue?`)) return;
    ids.forEach(id => removeItem(id));
    toast.success(`${ids.length} removed`);
    setSelected(new Set());
  };

  const navigateToAddendum = (item: QueuedVehicle) => {
    const decoded = (item.decoded_data as any)?.decoded;
    const params = new URLSearchParams();
    params.set("vin", item.vin);
    if (item.stock_number) params.set("stock", item.stock_number);
    if (decoded?.ymm) params.set("ymm", decoded.ymm);
    navigate(`/?${params.toString()}`);
  };

  const handleExport = () => {
    const csv = toCsv<QueuedVehicle>(sortPag.sorted, [
      { header: "Scanned",   get: r => r.scanned_at },
      { header: "VIN",       get: r => r.vin },
      { header: "Stock",     get: r => r.stock_number },
      { header: "YMM",       get: r => (r.decoded_data as any)?.decoded?.ymm || "" },
      { header: "Condition", get: r => r.condition || "" },
      { header: "Mileage",   get: r => r.mileage || "" },
      { header: "Status",    get: r => r.status },
      { header: "Notes",     get: r => r.notes || "" },
    ]);
    downloadCsv(`lot-queue-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
      <PageTabs tabs={VEHICLES_TABS} />
      {/* Operational header — workspace, not a marketing hero. */}
      <div className="flex items-end justify-between gap-4 flex-wrap pt-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Process step 1 · Lot capture
          </p>
          <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground mt-0.5">
            Lot Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{counts.queued}</span> awaiting sticker work
            {counts.processing > 0 && (
              <> · <span className="font-semibold text-foreground">{counts.processing}</span> in progress</>
            )}
            {counts.completed > 0 && (
              <> · <span className="font-semibold text-foreground">{counts.completed}</span> done</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openScan}
            className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-sm font-semibold shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 transition-colors"
          >
            <ScanLine className="w-4 h-4 stroke-2" />
            Open Scanner
          </button>
          <button
            onClick={() => {
              if (counts.completed === 0) {
                toast.info("Nothing completed to clear");
                return;
              }
              clearCompleted();
              toast.success(`Cleared ${counts.completed} completed`);
            }}
            className="h-9 px-4 rounded-md border border-border bg-transparent hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors"
          >
            Clear completed
          </button>
        </div>
      </div>

      {/* Filter + bulk action toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterChip label="Needs sticker" count={counts.queued} active={filter === "queued"} onClick={() => setFilter("queued")} tone="amber" />
          <FilterChip label="In progress" count={counts.processing} active={filter === "processing"} onClick={() => setFilter("processing")} tone="sky" />
          <FilterChip label="Done" count={counts.completed} active={filter === "completed"} onClick={() => setFilter("completed")} tone="emerald" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="VIN, stock, YMM…"
              className="h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm w-60"
            />
          </div>
          <DensityToggle density={density} setDensity={setDensity} />
        </div>
      </div>

      {/* Bulk-action toolbar — appears only when items selected. */}
      {selected.size > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-foreground">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={bulkSendToAddendum}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110"
            >
              <Printer className="w-3 h-3" /> Send to addendum
            </button>
            <button
              onClick={bulkComplete}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-foreground text-xs font-semibold hover:bg-muted"
            >
              <CheckCircle2 className="w-3 h-3" /> Mark complete
            </button>
            <button
              onClick={bulkDelete}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center text-xs font-semibold text-muted-foreground hover:text-foreground h-8 px-2 ml-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table or empty state */}
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading queue…</div>
      ) : rows.length === 0 ? (
        <TableEmptyState
          icon={ScanLine}
          title={q || filter !== "all" ? "No vehicles match these filters" : "No vehicles in the queue yet"}
          description={
            q || filter !== "all"
              ? "Widen the filter or clear the search to see the rest of the queue."
              : "Open the scanner on your phone, walk the lot, and scan VINs to populate this queue. New scans appear here in real time."
          }
          ctaLabel="Open scanner"
          onCta={openScan}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={`${rowClass} w-10`}>
                  <input
                    type="checkbox"
                    checked={selected.size === sortPag.paginated.length && sortPag.paginated.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <SortHeader label="Status" sortKey="status" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Vehicle" sortKey="ymm" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="VIN" sortKey="vin" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Stock" sortKey="stock_number" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Scanned" sortKey="scanned_at" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Action" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortPag.paginated.map(item => {
                const decoded = (item.decoded_data as any)?.decoded;
                const ymm = decoded?.ymm || "Decoding…";
                const tag = STATUS_TAGS[item.status];
                const isDone = item.status === "completed";
                return (
                  <tr key={item.id} className={isDone ? "opacity-60" : ""}>
                    <td className={`${rowClass}`} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                      />
                    </td>
                    <td className={rowClass}>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${tag.tone}`}>
                        {item.status === "queued"     && <AlertCircle className="w-2.5 h-2.5" />}
                        {item.status === "processing" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {item.status === "completed"  && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {item.status === "error"      && <AlertCircle className="w-2.5 h-2.5" />}
                        {tag.label}
                      </span>
                    </td>
                    <td className={rowClass}>
                      <p className="font-semibold text-foreground">{ymm}</p>
                      {(item.mileage || item.condition || item.notes) && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {item.mileage && `${parseInt(item.mileage).toLocaleString()} mi`}
                          {item.mileage && item.condition && " · "}
                          {item.condition && <span className="capitalize">{item.condition}</span>}
                          {item.notes && <span className="italic ml-1">"{item.notes}"</span>}
                        </p>
                      )}
                    </td>
                    <td className={`${rowClass} font-mono text-xs`}>{item.vin}</td>
                    <td className={`${rowClass} text-xs text-muted-foreground`}>{item.stock_number || "—"}</td>
                    <td className={`${rowClass} text-xs text-muted-foreground whitespace-nowrap`}>
                      {format(new Date(item.scanned_at), "M/d/yy h:mm a")}
                    </td>
                    <td className={`${rowClass} text-right`}>
                      <button
                        onClick={() => {
                          navigateToAddendum(item);
                          if (item.status === "queued") updateItem(item.id, { status: "processing" });
                        }}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-foreground text-background text-[11px] font-semibold hover:opacity-90"
                      >
                        {tag.nextAction}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination
            page={sortPag.page}
            totalPages={sortPag.totalPages}
            pageSize={sortPag.pageSize}
            totalCount={sortPag.totalCount}
            visibleCount={sortPag.paginated.length}
            setPage={sortPag.setPage}
            setPageSize={sortPag.setPageSize}
            onExportCsv={handleExport}
            exportLabel="Export CSV"
          />
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// FilterChip — compact pill with active state + count.
// ──────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "amber" | "sky" | "emerald";
}

const FilterChip = ({ label, count, active, onClick, tone }: FilterChipProps) => {
  const activeTone =
    tone === "amber"   ? "bg-amber-600 text-white"   :
    tone === "sky"     ? "bg-sky-600 text-white"     :
    tone === "emerald" ? "bg-emerald-600 text-white" :
                         "bg-foreground text-background";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors border ${
        active
          ? `${activeTone} border-transparent`
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      {label}
      <span className={`text-[10px] font-bold tabular-nums px-1 py-0.5 rounded ${active ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>
        {count}
      </span>
    </button>
  );
};

export default LotCaptureQueue;

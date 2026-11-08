import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminButton, InlineNote } from "@/components/admin/v2/primitives";
import { ScrollRegion } from "@/components/admin/v2/ScrollRegion";
import { AdminIcon, EditorEmpty, SelectField, useIsNarrow, INPUT_CLASS } from "@/components/admin/v3/editor";
import { cn } from "@/lib/utils";
import {
  BLOCKER_LABEL,
  BLOCKER_OPTIONS,
  CONDITION_LABEL,
  CONDITION_OPTIONS,
  DEFAULT_HUB_FILTERS,
  DOC_LABEL,
  DOC_OPTIONS,
  HUB_PAGE_SIZES,
  STATUS_LABEL,
  STATUS_OPTIONS,
  pageCount,
  parseHubFilters,
  writeHubFilters,
  type HubFilters,
  type HubPageSize,
} from "@/lib/admin/documentsHubModel";
import type { HubRow } from "./hubData";
import { useHubTable } from "./useHubData";
import { DocCellChip, FieldLabel, ReadinessChip, ServiceCellChip } from "./hubUi";
import { VehicleDrawer } from "./VehicleDrawer";

const stickyTh = "sticky top-[var(--adm-sticky-top,0px)] z-10 bg-adm-workspace px-4 py-2.5 text-left text-[13px] leading-[18px] font-semibold text-adm-muted border-b border-adm-divider";

const vehicleTitle = (r: HubRow): string => r.listing.ymm?.trim() || `VIN ${r.listing.vin}`;

function VehicleCell({ row }: { row: HubRow }) {
  return (
    <span className="block text-left">
      <span className="block font-semibold">{vehicleTitle(row)}</span>
      <span className="block text-[13px] leading-[18px] font-normal text-adm-muted">VIN {row.listing.vin}{row.stock ? ` . Stock ${row.stock}` : ""}</span>
    </span>
  );
}

export default function HubReadiness() {
  const [params, setParams] = useSearchParams();
  const filters = parseHubFilters(params);
  const vehicleId = params.get("vehicle");
  const narrow = useIsNarrow();
  const baseId = useId();
  const table = useHubTable(filters, true);
  const [qInput, setQInput] = useState(filters.q);

  useEffect(() => setQInput(filters.q), [filters.q]);
  useEffect(() => {
    if (qInput === filters.q) return;
    const t = setTimeout(() => setParams((p) => writeHubFilters(p, { ...parseHubFilters(p), q: qInput.slice(0, 64), page: 1 }), { replace: true }), 300);
    return () => clearTimeout(t);
  }, [qInput, filters.q, setParams]);

  const patch = (next: Partial<HubFilters>, resetPage = true) => setParams((p) => writeHubFilters(p, { ...parseHubFilters(p), ...next, ...(resetPage ? { page: 1 } : {}) }), { replace: true });
  const clear = () => {
    setQInput("");
    setParams((p) => writeHubFilters(p, { ...DEFAULT_HUB_FILTERS, size: filters.size }), { replace: true });
  };
  const openRow = (r: HubRow) => setParams((p) => { const n = new URLSearchParams(p); n.set("vehicle", r.listing.id); return n; });
  const closeRow = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("vehicle"); return n; }, { replace: false });

  const page = table.page;
  const total = page?.total ?? 0;
  const pages = pageCount(total, filters.size);
  const current = page?.page ?? filters.page;
  const start = total === 0 ? 0 : (current - 1) * filters.size + 1;
  const end = page ? (current - 1) * filters.size + page.rows.length : 0;
  const filtered = filters.q !== "" || filters.condition !== "all" || filters.doc !== "any" || filters.status !== "any" || filters.blocker !== "any";
  const k208Conflict = (filters.doc === "k208" && filters.condition === "new");
  const selected = vehicleId && page ? page.rows.find((r) => r.listing.id === vehicleId) ?? null : null;
  const goPage = (n: number) => {
    patch({ page: Math.min(Math.max(1, n), pages) }, false);
  };

  const state = table.loading && !page ? "loading" : table.error && !page ? "error" : page && page.total === 0 ? (filtered ? "no-results" : "empty") : "ready";

  return (
    <div className="space-y-4">
      <div data-hub-filters="" className="rounded-xl bg-adm-surface border border-adm-divider p-4">
        <form role="search" aria-label="Filter vehicles" onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(140px,1fr))]">
          <div>
            <FieldLabel htmlFor={`${baseId}-q`}>VIN or stock number</FieldLabel>
            <div className="relative">
              <AdminIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-muted pointer-events-none" />
              <input id={`${baseId}-q`} type="search" value={qInput} maxLength={64} onChange={(e) => setQInput(e.target.value)} placeholder="Search VIN, stock or vehicle" className={cn(INPUT_CLASS, "pl-10")} />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-c`}>Condition</FieldLabel>
            <SelectField id={`${baseId}-c`} value={filters.condition} onChange={(e) => patch({ condition: e.target.value as HubFilters["condition"] })}>
              {CONDITION_OPTIONS.map((o) => <option key={o} value={o}>{CONDITION_LABEL[o]}</option>)}
            </SelectField>
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-d`}>Document</FieldLabel>
            <SelectField id={`${baseId}-d`} value={filters.doc} onChange={(e) => patch({ doc: e.target.value as HubFilters["doc"] })}>
              {DOC_OPTIONS.map((o) => <option key={o} value={o}>{DOC_LABEL[o]}</option>)}
            </SelectField>
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-s`}>Status</FieldLabel>
            <SelectField id={`${baseId}-s`} value={filters.status} onChange={(e) => patch({ status: e.target.value as HubFilters["status"] })}>
              {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{STATUS_LABEL[o]}</option>)}
            </SelectField>
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-b`}>Blocker</FieldLabel>
            <SelectField id={`${baseId}-b`} value={filters.blocker} onChange={(e) => patch({ blocker: e.target.value as HubFilters["blocker"] })}>
              {BLOCKER_OPTIONS.map((o) => <option key={o} value={o}>{BLOCKER_LABEL[o]}</option>)}
            </SelectField>
          </div>
        </form>
        {filtered && (
          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] leading-[18px] text-adm-muted">Filters are saved in the page address, so a reload or a shared link shows the same list.</p>
            <AdminButton size="sm" onClick={clear}>Clear filters</AdminButton>
          </div>
        )}
      </div>

      {k208Conflict && <InlineNote tone="warning" title="K-208 does not apply to New">New vehicles are exempt from the K-208 inspection, so this combination matches nothing by design. Choose Used or CPO, or All conditions.</InlineNote>}
      {table.error && page && <InlineNote tone="danger" title="Showing the last list that loaded" action={<AdminButton size="sm" onClick={table.refetch}>Try again</AdminButton>}>{table.error.message}</InlineNote>}

      <div data-table-state={state} data-total={page ? total : undefined} className="rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)]">
        {state === "loading" && (
          <div role="status" aria-busy="true" className="px-4 py-4 space-y-3">
            <span className="sr-only">Loading vehicles</span>
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 rounded-md bg-adm-workspace animate-pulse motion-reduce:animate-none" aria-hidden="true" />)}
          </div>
        )}
        {state === "error" && table.error && (
          <EditorEmpty tone="danger" title={table.error.reason === "incomplete" ? "Too many records to filter exactly" : "Vehicles could not be read"} description={table.error.message} action={<AdminButton variant="secondary" onClick={table.refetch}>Try again</AdminButton>} />
        )}
        {state === "empty" && <EditorEmpty artwork="documents" title="No active vehicles" description="Vehicles appear here once inventory is imported or added. Nothing is hidden by a filter." />}
        {state === "no-results" && <EditorEmpty artwork="search" title="No vehicles match" description="No vehicle matches these filters. The total is read from the server, not estimated." action={<AdminButton variant="secondary" onClick={clear}>Clear filters</AdminButton>} />}

        {state === "ready" && page && (
          <>
            {narrow ? (
              <ul aria-label="Vehicle readiness" className="divide-y divide-adm-divider">
                {page.rows.map((r) => (
                  <li key={r.key} className="px-4 py-3 space-y-2">
                    <button type="button" aria-label={`Open details for ${vehicleTitle(r)}`} onClick={() => openRow(r)} className="w-full min-h-[44px] text-left text-[15px] text-adm-primary rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary"><VehicleCell row={r} /></button>
                    <div className="space-y-1.5">
                      {r.facts.documents.map((d) => <div key={d.key}><DocCellChip cell={d} short /></div>)}
                      <div><ServiceCellChip service={r.facts.service} /></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2"><ReadinessChip value={r.facts.readiness} /></div>
                    <p className="text-[14px] leading-[20px]"><span className="text-adm-muted">Next: </span>{r.facts.nextAction}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <ScrollRegion label="Vehicle readiness" innerClassName="lg:overflow-visible">
                <table className="w-full border-collapse text-left text-[14px] leading-[20px] text-adm-ink max-lg:min-w-[860px]">
                  <caption className="sr-only">Vehicle readiness</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={stickyTh}>Vehicle</th>
                      <th scope="col" className={stickyTh}>Documents</th>
                      <th scope="col" className={stickyTh}>Service</th>
                      <th scope="col" className={stickyTh}>Readiness</th>
                      <th scope="col" className={stickyTh}>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((r) => (
                      <tr key={r.key} onClick={(e) => { if (!(e.target as Element).closest("button, a")) openRow(r); }} className="border-b border-adm-divider last:border-b-0 cursor-pointer hover:bg-adm-workspace">
                        <td className="px-4 py-3 align-middle">
                          <button type="button" aria-label={`Open details for ${vehicleTitle(r)}`} onClick={() => openRow(r)} className="text-left text-adm-primary rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary"><VehicleCell row={r} /></button>
                        </td>
                        <td className="px-4 py-3 align-middle"><div className="space-y-1">{r.facts.documents.map((d) => <div key={d.key}><DocCellChip cell={d} short /></div>)}</div></td>
                        <td className="px-4 py-3 align-middle"><ServiceCellChip service={r.facts.service} /></td>
                        <td className="px-4 py-3 align-middle"><ReadinessChip value={r.facts.readiness} /></td>
                        <td className="px-4 py-3 align-middle text-[14px]">{r.facts.nextAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-adm-divider text-[14px] text-adm-muted">
              <p aria-live="polite">Showing {start} to {end} of {total.toLocaleString()} {total === 1 ? "vehicle" : "vehicles"}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <SelectField aria-label="Rows per page" value={filters.size} onChange={(e) => patch({ size: Number(e.target.value) as HubPageSize })} wrapperClassName="w-auto">
                    {HUB_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </SelectField>
                </label>
                <nav aria-label="Vehicle pages" className="flex items-center gap-2">
                  <AdminButton variant="secondary" onClick={() => goPage(current - 1)} disabled={current <= 1}><AdminIcon name="arrow-left" /> Previous</AdminButton>
                  <span aria-current="page" className="px-1 tabular-nums">Page {current} of {pages}</span>
                  <AdminButton variant="secondary" onClick={() => goPage(current + 1)} disabled={current >= pages}>Next <AdminIcon name="arrow-right" /></AdminButton>
                </nav>
              </div>
            </div>
          </>
        )}
      </div>

      <VehicleDrawer row={selected} open={!!selected} onClose={closeRow} />
      {vehicleId && page && !selected && !table.loading && (
        <InlineNote tone="neutral" title="That vehicle is not on this page" action={<AdminButton size="sm" onClick={closeRow}>Dismiss</AdminButton>}>It may be on another page or hidden by a filter. The side panel opens from a row.</InlineNote>
      )}
    </div>
  );
}

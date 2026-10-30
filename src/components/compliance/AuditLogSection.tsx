import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import { activityLabel, entityKindLabel } from "@/lib/admin/integrations/activity";
import { formatDateTime } from "./primitives";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_email: string | null;
  created_at: string;
  content_hash: string | null;
  row_hash: string | null;
  details: Record<string, unknown> | null;
}

const WINDOWS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];
const PAGE_SIZES = [25, 50, 100];

const selectCls = "h-10 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary";

const detailText = (r: AuditRow): string => {
  const d = r.details;
  if (d && typeof d.summary === "string" && d.summary) return d.summary;
  return (r.content_hash || r.row_hash || "").slice(0, 16) || "No details recorded";
};

const outcomeOf = (r: AuditRow): "Success" | "Failed" => {
  const d = r.details;
  const status = typeof d?.status === "string" ? d.status.toLowerCase() : "";
  return d?.error || status === "failed" || status === "error" || /(^|[._])(fail|failed|error|denied|rejected)/.test(r.action) ? "Failed" : "Success";
};

const entityRef = (r: AuditRow): string => {
  const vin = typeof r.details?.vin === "string" ? r.details.vin : "";
  if (vin) return `#${vin.slice(-6)}`;
  return r.entity_id ? `#${r.entity_id.replace(/-/g, "").slice(0, 8)}` : "";
};

const FilterField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
    {label}
    {children}
  </label>
);

export const AuditLogSection = ({ tenantId }: { tenantId: string | null }) => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(30);
  const [draft, setDraft] = useState({ days: 30, actor: "all", action: "all", entity: "all", outcome: "all" });
  const [applied, setApplied] = useState({ actor: "all", action: "all", entity: "all", outcome: "all" });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await sb()
        .from("audit_log")
        .select("id, action, entity_type, entity_id, user_email, created_at, content_hash, row_hash, details")
        .eq("store_id", tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data as AuditRow[]) || []);
    } catch {
      setRows([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, days]);

  useEffect(() => { void load(); }, [load]);

  const options = useMemo(() => {
    const uniq = (f: (r: AuditRow) => string | null) => [...new Set(rows.map(f).filter((v): v is string => !!v))].sort();
    return { actors: uniq((r) => r.user_email), actions: uniq((r) => r.action), entities: uniq((r) => r.entity_type) };
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (applied.actor === "all" || (r.user_email || "System") === applied.actor) &&
          (applied.action === "all" || r.action === applied.action) &&
          (applied.entity === "all" || r.entity_type === applied.entity) &&
          (applied.outcome === "all" || outcomeOf(r) === applied.outcome),
      ),
    [rows, applied],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize);
  const status = loading ? "loading" : failed ? "error" : filtered.length === 0 ? "empty" : "ready";

  const apply = () => {
    setDays(draft.days);
    setApplied({ actor: draft.actor, action: draft.action, entity: draft.entity, outcome: draft.outcome });
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-end gap-4">
          <FilterField label="Date range">
            <select className={selectCls} value={draft.days} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}>
              {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
            </select>
          </FilterField>
          <FilterField label="Actor">
            <select className={selectCls} value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })}>
              <option value="all">All</option>
              {options.actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FilterField>
          <FilterField label="Action">
            <select className={selectCls} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              <option value="all">All</option>
              {options.actions.map((a) => <option key={a} value={a}>{activityLabel(a)}</option>)}
            </select>
          </FilterField>
          <FilterField label="Entity">
            <select className={selectCls} value={draft.entity} onChange={(e) => setDraft({ ...draft, entity: e.target.value })}>
              <option value="all">All</option>
              {options.entities.map((a) => <option key={a} value={a}>{entityKindLabel(a)}</option>)}
            </select>
          </FilterField>
          <FilterField label="Outcome">
            <select className={selectCls} value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}>
              <option value="all">All</option>
              <option value="Success">Success</option>
              <option value="Failed">Failed</option>
            </select>
          </FilterField>
          <div className="flex items-center gap-4">
            <span className="whitespace-nowrap text-[13px] leading-[18px] text-adm-muted">{loading ? "Loading events" : `${rows.length.toLocaleString()} events (${filtered.length.toLocaleString()} after filters)`}</span>
            <Button variant="primary" onClick={apply}>Apply filters</Button>
          </div>
        </div>
      </div>

      <Panel flush inset="sm">
        <QueryState
          status={status}
          onRetry={() => void load()}
          errorTitle="Audit events could not be loaded"
          emptyTitle="No audit events match"
          emptyDetail="Nothing was recorded for these filters. Widen the date range or clear a filter."
        >
          <WorkTable caption="Audit log" minWidth={820}>
            <thead>
              <tr>
                <Th>Date / Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Outcome</Th>
                <Th>Details</Th>
                <Th><span className="sr-only">Expand</span></Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <Td className="whitespace-nowrap text-adm-muted">{formatDateTime(r.created_at)}</Td>
                    <Td className="max-w-[230px] truncate">{r.user_email || "System"}</Td>
                    <Td className="whitespace-nowrap">{activityLabel(r.action)}</Td>
                    <Td className="max-w-[200px] truncate">{entityKindLabel(r.entity_type)} <span className="font-mono text-[13px] text-adm-muted">{entityRef(r)}</span></Td>
                    <Td className="whitespace-nowrap"><StatusText tone={outcomeOf(r) === "Failed" ? "danger" : "success"}>{outcomeOf(r)}</StatusText></Td>
                    <Td className="max-w-[260px] truncate text-adm-muted">{detailText(r)}</Td>
                    <Td align="right">
                      <button type="button" aria-expanded={open === r.id} aria-label="Show event detail" onClick={() => setOpen(open === r.id ? null : r.id)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-adm-primary hover:bg-adm-selected">
                        <ChevronDown className={`h-5 w-5 transition-transform ${open === r.id ? "rotate-180" : ""}`} aria-hidden="true" />
                      </button>
                    </Td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7} className="border-b border-adm-border bg-adm-workspace px-3 py-3 text-[13px] leading-[18px] text-adm-muted">
                        <p>Record reference <span className="font-mono text-adm-ink">{r.entity_id || "Unknown"}</span></p>
                        <p>Hash <span className="font-mono text-adm-ink">{r.content_hash || r.row_hash || "Unknown"}</span></p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </WorkTable>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] leading-[18px] text-adm-muted">
            <label className="flex items-center gap-2">
              Rows per page
              <select className="h-9 rounded-md border border-adm-border bg-adm-surface px-2 text-adm-ink" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span>Showing {(current - 1) * pageSize + 1}-{Math.min(current * pageSize, filtered.length)} of {filtered.length.toLocaleString()} filtered</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-adm-border text-adm-ink disabled:opacity-40"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)} className={`h-9 min-w-9 rounded-md border px-2 text-[14px] font-semibold ${n === current ? "border-adm-primary bg-adm-primary text-white" : "border-adm-border text-adm-ink"}`}>{n}</button>
              ))}
              <button type="button" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-adm-border text-adm-ink disabled:opacity-40"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
            </div>
          </div>
        </QueryState>
      </Panel>
    </div>
  );
};

export default AuditLogSection;

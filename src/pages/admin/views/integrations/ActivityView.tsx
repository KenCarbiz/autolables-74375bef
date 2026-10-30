import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ACTIVITY_KIND_META, activityTone, actorLabel, classifyAuditAction, activityLabel, entityKindLabel, type ActivityKind, type AuditRow } from "@/lib/admin/integrations/activity";
import { pageSlice, pageWindow } from "@/lib/admin/integrations/feed";
import { loadActivityExport, loadActivityPage, verifyAuditChain, type ChainVerification } from "@/lib/admin/integrations/queries";
import { AdminButton, AdminCard, AdminTable, InlineNote, SectionTitle, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { Pager, useFormatAt, useViewer } from "./common";

// Activity: the operational ledger for this rooftop, typed as configuration
// changes or provider and job events, paginated from the server. The chain
// verification and the CSV export are explicit clicks; opening the page reads
// one page and writes nothing.

export interface ActivityViewFixture {
  rows: AuditRow[];
  total: number | null;
  failed?: boolean;
}

const KINDS: Array<{ id: ActivityKind | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "configuration", label: "Configuration" },
  { id: "provider_job", label: "Provider & jobs" },
];

const csvCell = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function activityCsv(rows: AuditRow[]): string {
  const header = "Timestamp,Kind,Action,Entity Type,Entity ID,Actor,Details";
  return [header, ...rows.map((r) => [r.created_at, classifyAuditAction(r.action), r.action, r.entity_type ?? "", r.entity_id ?? "", actorLabel(r), JSON.stringify(r.details ?? {})].map(csvCell).join(","))].join("\n");
}

export default function ActivityView() {
  const fixture = useViewFixture<ActivityViewFixture>("activity");
  const viewer = useViewer();
  const tenantId = fixture ? null : viewer.tenantId;
  const formatAt = useFormatAt(viewer.timeZone);
  const [params, setParams] = useSearchParams();
  const kindParam = params.get("kind");
  const kind: ActivityKind | "all" = kindParam === "configuration" || kindParam === "provider_job" ? kindParam : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [size, setSize] = useState(25);
  const [chain, setChain] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "done"; result: ChainVerification } | { kind: "error"; message: string }>({ kind: "idle" });
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");

  const live = useQuery({
    queryKey: ["admin-v2", "activity", tenantId, kind, page, size],
    enabled: !fixture && !!tenantId,
    staleTime: 30_000,
    queryFn: () => loadActivityPage(tenantId as string, page, size, kind),
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const verify = async () => {
    const storeId = viewer.storeId;
    if (!storeId) return;
    setChain({ kind: "loading" });
    const { result, error } = await verifyAuditChain(storeId);
    setChain(result ? { kind: "done", result } : { kind: "error", message: error ?? "Verification failed" });
  };

  const exportCsv = async () => {
    if (!tenantId) return;
    setExporting("busy");
    const rows = await loadActivityExport(tenantId);
    if (!rows) { setExporting("failed"); return; }
    const blob = new Blob([activityCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting("idle");
  };

  const loading = !fixture && (live.isLoading || !tenantId);
  const failed = fixture ? !!fixture.failed : live.isError || !!live.data?.failed;
  const rows: AuditRow[] = fixture ? fixture.rows : live.data?.rows ?? [];
  const total = fixture ? fixture.total : live.data?.total ?? null;
  const slice = fixture ? pageSlice(rows, page, size) : pageWindow(rows, page, size, total);

  const chainLabel = chain.kind === "loading" ? "Verifying…" : chain.kind === "done" ? (chain.result.firstBreakId ? `Break at ${formatAt(chain.result.firstBreakAt)}` : `Chain verified, ${chain.result.verified} of ${chain.result.total}`) : chain.kind === "error" ? "Check failed" : "Verify chain";

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Activity"
        description="Immutable record of configuration changes and provider or job events for this rooftop."
        action={
          <div className="flex items-center gap-2">
            <AdminButton variant="secondary" size="sm" onClick={verify} disabled={chain.kind === "loading" || !viewer.storeId} title="Runs the server-side hash chain check over every audit row for this store">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              {chainLabel}
            </AdminButton>
            <AdminButton variant="secondary" size="sm" onClick={exportCsv} disabled={exporting === "busy" || !tenantId} title="Downloads the newest 2,000 events as CSV">
              <Download className="w-4 h-4" aria-hidden="true" />
              {exporting === "busy" ? "Exporting…" : "Export CSV"}
            </AdminButton>
          </div>
        }
      />
      {chain.kind === "done" && chain.result.firstBreakId && (
        <InlineNote tone="danger" title="Audit chain break detected">The first altered row is {chain.result.firstBreakId.slice(0, 8)} at {formatAt(chain.result.firstBreakAt, { withYear: true })}. {chain.result.verified} of {chain.result.total} rows verified.</InlineNote>
      )}
      {chain.kind === "error" && <InlineNote tone="warning" title="Chain check failed">{chain.message}</InlineNote>}
      {exporting === "failed" && <InlineNote tone="warning" title="Export failed">The activity rows could not be read for export.</InlineNote>}

      <div role="tablist" aria-label="Activity kind" className="flex items-center gap-2 flex-wrap">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => { setParam("kind", k.id === "all" ? null : k.id); setParam("page", null); }}
            className={cn("h-8 px-3 rounded-md text-[13px] font-semibold border", kind === k.id ? "bg-adm-selected text-adm-primary border-adm-primary/40" : "bg-adm-surface text-adm-muted border-adm-border hover:text-adm-ink")}
          >
            {k.label}
          </button>
        ))}
      </div>

      <AdminCard title="Events" flush>
        {loading ? (
          <div className="px-6 pb-6"><SkeletonBlock className="h-48 w-full" /></div>
        ) : failed ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted" role="status">The activity ledger could not be read.</p>
        ) : rows.length === 0 ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">No events recorded for this rooftop{kind === "all" ? "" : " in this category"}.</p>
        ) : (
          <>
            <AdminTable caption="Activity ledger">
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Kind</Th>
                  <Th>Event</Th>
                  <Th>Entity</Th>
                  <Th>Actor</Th>
                </tr>
              </thead>
              <tbody>
                {slice.rows.map((r) => {
                  const k = classifyAuditAction(r.action);
                  const tone = activityTone(r.action);
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatAt(r.created_at, { withSeconds: true })}</Td>
                      <Td><StatusChip tone={ACTIVITY_KIND_META[k].tone}>{ACTIVITY_KIND_META[k].label}</StatusChip></Td>
                      <Td><span className={cn("font-semibold", tone === "warning" ? "text-adm-warning" : tone === "success" ? "text-adm-success" : "text-adm-ink")}>{activityLabel(r.action)}</span></Td>
                      <Td className="text-adm-muted text-[13px]">{entityKindLabel(r.entity_type)}</Td>
                      <Td className="text-adm-muted">{actorLabel(r)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </AdminTable>
            <Pager page={slice.page} pages={slice.pages} from={slice.from} to={slice.to} total={total} noun="events" size={size} onPage={(p) => setParam("page", p <= 1 ? null : String(p))} onSize={(s) => { setSize(s); setParam("page", null); }} loaded={slice.rows.length} />
          </>
        )}
      </AdminCard>
    </div>
  );
}

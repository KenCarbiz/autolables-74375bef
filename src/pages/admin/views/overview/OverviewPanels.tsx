import { useEffect, useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AdminLinkButton } from "@/components/admin/v2/primitives";
import { AdminIcon, DataTable, SectionCard, StatusBadge, type DataColumn } from "@/components/admin/v3/editor";
import { formatDateTime } from "@/lib/admin/integrations/format";
import { adminTabHref } from "@/lib/admin/sections";
import { cn } from "@/lib/utils";
import { plural } from "./OverviewParts";
import { DOCUMENTS_ATTENTION_HREF, exceptionsHref, overviewHref, severityCounts, SEVERITY_ORDER, type ExceptionRow, type ExceptionStats, type PolicyConcept, type SetupItem, type SetupProgress } from "./overviewModel";
import { loadAdminEvents, type ActivityEvent } from "./useOverviewData";

const TEXT_LINK = "text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px] rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";

export const PanelBack = ({ title, description }: { title: string; description: ReactNode }) => (
  <div className="space-y-2">
    <Link to={overviewHref()} className={cn(TEXT_LINK, "inline-flex items-center gap-1.5")}>
      <AdminIcon name="arrow-left" size="inline" />
      Back to overview
    </Link>
    <h2 className="text-[22px] leading-[30px] font-bold text-adm-ink">{title}</h2>
    <p className="text-[14px] leading-[20px] text-adm-muted max-w-3xl">{description}</p>
  </div>
);

const SEVERITY_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };

export function ExceptionsPanel({ stats, failed }: { stats: ExceptionStats | null; failed: boolean }) {
  const [params] = useSearchParams();
  const severity = params.get("severity");
  const activeSeverity = severity && (SEVERITY_ORDER as readonly string[]).includes(severity) ? severity : null;
  const rows = stats?.rows ?? null;
  const filtered = useMemo(() => (rows ? rows.filter((r) => !activeSeverity || r.severity === activeSeverity) : undefined), [rows, activeSeverity]);
  const breakdown = rows ? severityCounts(rows) : [];
  const unavailable = failed || !stats || stats.instances.kind === "failed";
  const columns: DataColumn<ExceptionRow>[] = [
    { id: "vehicle", header: "Vehicle", primary: true, cell: (r) => <span className="font-mono text-[13px]">{r.vin}</span> },
    { id: "issue", header: "Issue", cell: (r) => r.title },
    { id: "severity", header: "Severity", cell: (r) => SEVERITY_LABEL[r.severity] ?? r.severity },
    { id: "queue", header: "Queue", cell: (r) => <Link to={exceptionsHref({ severity: r.severity, type: r.type })} className={TEXT_LINK}>Open in queue</Link> },
  ];
  return (
    <div className="space-y-4">
      <PanelBack
        title="Open exceptions"
        description={
          unavailable
            ? "The exceptions queue could not be read. No count is shown, and that is not the same as zero."
            : `${plural(stats!.instances.kind === "known" ? stats!.instances.value : 0, "open issue", "open issues")} across ${stats!.vehicles.kind === "known" ? plural(stats!.vehicles.value, "vehicle", "vehicles") : "an unknown number of vehicles"}${stats!.vehicles.kind === "known" && stats!.vehicles.capped ? " or more" : ""}. A vehicle with several issues counts once as a vehicle and once per issue.`
        }
      />
      {!unavailable && (
        <SectionCard title="By severity" description="Issues and the vehicles they sit on. Select a severity to filter." icon="filter">
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <li>
              <Link to={overviewHref("exceptions")} aria-current={!activeSeverity ? "true" : undefined} className={cn("block rounded-lg border px-3 py-3 min-h-[44px]", !activeSeverity ? "border-adm-primary bg-adm-selected" : "border-adm-divider hover:bg-adm-workspace")}>
                <span className="block text-[13px] text-adm-muted">All severities</span>
                <span className="block text-[18px] font-semibold tabular-nums">{plural(rows?.length ?? 0, "issue", "issues")}</span>
              </Link>
            </li>
            {breakdown.map((b) => (
              <li key={b.severity}>
                <Link to={`${overviewHref("exceptions")}&severity=${b.severity}`} aria-current={activeSeverity === b.severity ? "true" : undefined} className={cn("block rounded-lg border px-3 py-3 min-h-[44px]", activeSeverity === b.severity ? "border-adm-primary bg-adm-selected" : "border-adm-divider hover:bg-adm-workspace")}>
                  <span className="block text-[13px] text-adm-muted">{SEVERITY_LABEL[b.severity]}</span>
                  <span className="block text-[18px] font-semibold tabular-nums">{plural(b.issues, "issue", "issues")}</span>
                  <span className="block text-[13px] text-adm-muted">{plural(b.vehicles, "vehicle", "vehicles")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      <DataTable
        caption="Open exceptions"
        columns={columns}
        rows={unavailable ? undefined : filtered}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.vin} ${r.title} ${r.type}`}
        searchLabel="Search by VIN or issue"
        error={unavailable ? { message: "The exceptions queue could not be read for this account." } : null}
        emptyTitle="No open exceptions"
        emptyDescription="Nothing in the queue matches this filter."
      />
      <AdminLinkButton to={exceptionsHref(activeSeverity ? { severity: activeSeverity } : {})} variant="primary" className="max-sm:w-full justify-center">Work the queue</AdminLinkButton>
    </div>
  );
}

export function SetupPanel({ items, progress }: { items: SetupItem[]; progress: SetupProgress }) {
  return (
    <div className="space-y-4">
      <PanelBack title="Setup checklist" description={`${progress.done} of ${progress.total} steps complete. Each step opens the one editor that owns the setting.`} />
      <SectionCard title="Steps" icon="checklist">
        <ol className="-my-2 divide-y divide-adm-divider">
          {items.map((i) => (
            <li key={i.key} className="py-3 flex items-start gap-3">
              <StatusBadge state={i.done ? "enabled" : "setup_required"} label={i.done ? "Done" : "To do"} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-[21px] font-semibold text-adm-ink">{i.label}</p>
                <p className="text-[14px] leading-[20px] text-adm-muted">{i.detail}</p>
              </div>
              <Link to={i.href} aria-label={`${i.done ? "Review" : "Set up"}: ${i.label}`} className={cn(TEXT_LINK, "whitespace-nowrap")}>{i.done ? "Review" : "Set up"}</Link>
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}

export function PolicyPanel({ concepts }: { concepts: PolicyConcept[] }) {
  const [params] = useSearchParams();
  const target = params.get("concept");
  useEffect(() => {
    if (!target) return;
    document.getElementById(`concept-${target}`)?.scrollIntoView?.({ block: "start" });
  }, [target]);
  return (
    <div className="space-y-4">
      <PanelBack title="Current policy" description="Listing visibility, document publication, retail readiness and customer routing are four separate rules. Each is read from its own setting; none is inferred from another." />
      {concepts.map((c) => (
        <SectionCard key={c.key} id={`concept-${c.key}`} title={c.title} description={c.value} actions={<StatusBadge state={c.state === "unknown" ? "unknown" : c.state === "attention" ? "setup_required" : "enabled"} label={c.stateLabel} />} className={target === c.key ? "ring-2 ring-adm-primary/40" : undefined}>
          <p className="text-[14px] leading-[20px] text-adm-ink">{c.detail}</p>
          {c.byClass.length > 0 && (
            <dl className="divide-y divide-adm-divider border border-adm-divider rounded-lg">
              {c.byClass.map((b) => (
                <div key={b.cls} className="px-3 py-3 grid sm:grid-cols-[110px_1fr] gap-x-4 gap-y-0.5">
                  <dt className="text-[14px] font-semibold text-adm-ink">{b.label}</dt>
                  <dd className="text-[14px] leading-[20px]">
                    <span className="font-medium">{b.cell.label}.</span> <span className="text-adm-muted">{b.cell.detail}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {c.tiers && (
            <p className="text-[14px] leading-[20px] text-adm-muted">{c.tiers.ready} of {c.tiers.total} routing steps are ready. Steps are listed in the saved order on the Routing page.</p>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <Link to={c.href} className={TEXT_LINK}>{c.editLabel}</Link>
            {c.key === "retail_readiness" || c.key === "document_publication" ? <Link to={DOCUMENTS_ATTENTION_HREF} className={TEXT_LINK}>Vehicles needing document attention</Link> : null}
            {c.key === "listing_visibility" ? <Link to={adminTabHref("data-quality")} className={TEXT_LINK}>Data quality</Link> : null}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

export function ActivityPanel({ tenantId, fixtureEvents, timeZone }: { tenantId: string | null; fixtureEvents: ActivityEvent[] | null | undefined; timeZone: string | null }) {
  const live = useQuery({
    queryKey: ["admin-v3", "overview-activity", tenantId],
    enabled: fixtureEvents === undefined && !!tenantId,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await loadAdminEvents(tenantId as string, 500);
      if (rows === null) throw new Error("activity unavailable");
      return rows;
    },
  });
  const rows = fixtureEvents !== undefined ? fixtureEvents ?? undefined : live.data;
  const failed = fixtureEvents !== undefined ? fixtureEvents === null : live.isError;
  const columns: DataColumn<ActivityEvent>[] = [
    { id: "when", header: "When", cell: (e) => <time dateTime={e.at}>{formatDateTime(e.at, { timeZone, withYear: true })}</time> },
    { id: "event", header: "Event", primary: true, cell: (e) => e.action },
    { id: "record", header: "Record", cell: (e) => e.kind },
    { id: "actor", header: "Actor", cell: (e) => e.actor },
  ];
  return (
    <div className="space-y-4">
      <PanelBack title="Administration activity" description="Changes made in Administration and system events for this account, newest first. Customer listing views are not included." />
      <DataTable
        caption="Administration activity"
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        loading={!failed && rows === undefined}
        error={failed ? { message: "Activity could not be read. That is not the same as no activity.", onRetry: () => void live.refetch() } : null}
        searchText={(e) => `${e.action} ${e.kind} ${e.actor}`}
        searchLabel="Search activity"
        emptyTitle="No administration activity yet"
        emptyDescription="Changes made in Administration appear here."
      />
    </div>
  );
}

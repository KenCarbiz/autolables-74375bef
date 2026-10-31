import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { needsAttention } from "@/lib/admin/health";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { deriveJobRow, describeCron, JOB_CATALOG } from "@/lib/admin/integrations/jobs";
import { loadCrawlFacts, loadJobLedgers, loadJobStatus, loadLedgerHeads, type JobLedgers, type JobStatusResult } from "@/lib/admin/integrations/queries";
import { AdminCard, AdminTable, HealthChip, InlineNote, SectionTitle, SkeletonBlock, Td, Th } from "@/components/admin/v2/primitives";
import { useFormatAt, useViewer } from "./common";

// Jobs & Pipelines: every scheduled job that affects a dealer output, with
// health derived from this rooftop's own ledgers and, where readable, the
// scheduler. A schedule row proves intent, never execution.

export interface JobsViewFixture {
  status: JobStatusResult;
  ledgers: JobLedgers;
}

const CRON_NAMES = Array.from(new Set(JOB_CATALOG.map((j) => j.cronName)));

export function useJobsData() {
  const fixture = useViewFixture<JobsViewFixture>("jobs");
  const now = useAdminNow();
  const viewer = useViewer();
  const tenantId = fixture ? null : viewer.tenantId;
  const formatAt = useFormatAt(viewer.timeZone);

  const live = useQuery({
    queryKey: ["admin-v2", "jobs", tenantId, viewer.isAdmin],
    enabled: !fixture && !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [status, heads, crawl] = await Promise.all([loadJobStatus(tenantId as string, CRON_NAMES, viewer.isAdmin), loadLedgerHeads(tenantId as string), loadCrawlFacts(tenantId as string)]);
      const ledgers = await loadJobLedgers(tenantId as string, heads, crawl);
      return { status, ledgers };
    },
  });

  const data: JobsViewFixture | null = fixture ?? live.data ?? (live.isError ? { status: { cron: Object.fromEntries(CRON_NAMES.map((n) => [n, "unavailable" as const])), serverLedger: {}, source: "unavailable" }, ledgers: {} } : null);

  const rows = useMemo(() => {
    if (!data) return [];
    return JOB_CATALOG.map((spec) => {
      // A scheduler "succeeded" only proves the cron request was delivered, not
      // that the work ran, so a job with its own work ledger is judged by that
      // ledger alone. Scheduler run history speaks only for jobs with no ledger.
      const ledger = spec.ledger ? data.ledgers[spec.ledger] ?? null : null;
      const ledgerLoadFailed = spec.ledger ? data.ledgers[spec.ledger] === null : false;
      const schedulerLastSuccessAt = data.status.serverLedger[spec.cronName]?.lastSuccessAt ?? null;
      const cron = spec.cronName in data.status.cron ? data.status.cron[spec.cronName] : "unavailable";
      return deriveJobRow({ spec, cron, ledger, ledgerLoadFailed, schedulerLastSuccessAt, now });
    });
  }, [data, now]);

  return { data, rows, formatAt, now };
}

export default function JobsView() {
  const { data, rows, formatAt } = useJobsData();

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading jobs">
        <SkeletonBlock className="h-8 w-64" />
        <SkeletonBlock className="h-96 w-full" />
      </div>
    );
  }

  const attention = rows.filter((r) => needsAttention(r.verdict.state) && r.verdict.state !== "unknown").length;
  const sourceNote = data.status.source === "admin_job_status"
    ? "Schedules and run history come from the scheduler through the tenant-safe status function."
    : data.status.source === "get_cron_job_status"
      ? "Schedules come from the platform scheduler read, available to platform admins. Execution evidence comes from this rooftop's ledgers."
      : "The scheduler status is not readable for this role, so schedules show as Unknown. Execution evidence comes from this rooftop's own ledgers only.";

  return (
    <div className="space-y-4">
      <SectionTitle title="Jobs & Pipelines" description={`${rows.length} scheduled jobs. ${attention} need attention. A schedule proves intent; only a recorded run proves execution.`} />
      <InlineNote tone="info">{sourceNote}</InlineNote>
      <AdminCard title="Scheduled jobs" flush>
        <AdminTable caption="Scheduled jobs and pipelines">
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Health</Th>
              <Th>Schedule</Th>
              <Th>Last attempt</Th>
              <Th>Last success</Th>
              <Th>Scope</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.spec.id}>
                <Td>
                  <Link to={ADMIN_CHILD_ROUTES.jobDetail(row.spec.id)} className="font-semibold text-adm-primary hover:underline">{row.spec.label}</Link>
                  <p className="text-[12px] leading-[18px] text-adm-muted">{row.verdict.headline} · Affects: {row.spec.affectedOutput}</p>
                </Td>
                <Td><HealthChip state={row.verdict.state} /></Td>
                <Td className="text-adm-muted">{row.schedule ? describeCron(row.schedule) : "Unknown"}</Td>
                <Td>{row.lastAttemptAt ? formatAt(row.lastAttemptAt) : <span className="text-adm-muted">None recorded</span>}</Td>
                <Td>{row.lastSuccessAt ? <>{formatAt(row.lastSuccessAt)}{row.evidence === "scheduler" && <span className="block text-[11px] text-adm-muted">Scheduler record, all rooftops</span>}</> : <span className="text-adm-muted">None recorded</span>}</Td>
                <Td className="text-adm-muted">{row.spec.scope}</Td>
                <Td><Link to={row.spec.drillIn} className="font-semibold text-adm-primary hover:underline">{row.spec.drillInLabel}</Link></Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminCard>
    </div>
  );
}

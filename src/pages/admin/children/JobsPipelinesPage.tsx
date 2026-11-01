import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { getDeliveryTimeline } from "@/lib/inventoryNetwork/api";
import { catalogPipelineRow, filesWorkerRow, type FilesWorkerFacts, type PipelineChip, type PipelineRow } from "@/lib/admin/integrations/pipelines";
import JobsView, { useJobsData } from "@/pages/admin/views/integrations/JobsView";
import { formatClock } from "@/pages/admin/children/inventoryNetwork/overviewModel";
import { Al97Frame, Banner, Card, Glyph, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";
import safePause from "@/assets/al97/safe-pause.svg";

// Jobs & pipelines: the operations that move inventory, prices and customer
// contact, each with schedule, request delivery and completed work apart.
// Read-only: Refresh status re-reads; nothing here resumes, pauses or runs a
// job. Every scheduled job stays listed below in the full jobs table.

export interface JobsPipelinesFixture {
  account: string;
  store: string | null;
  /** Null means the delivery timeline was not readable. */
  filesWorker: FilesWorkerFacts | null;
}

const PIPELINES: Array<{ id: string; label: string }> = [
  { id: "inventory_sync", label: "MarketCheck inventory" },
  { id: "files_com_worker", label: "Files.com import worker" },
  { id: "price_crawl", label: "Dealer-site price crawl" },
  { id: "description_reconcile", label: "Description reconcile" },
  { id: "lead_escalation", label: "Lead escalation" },
];

const SOURCE: Record<string, string> = {
  admin_job_status: "tenant-safe scheduler status",
  get_cron_job_status: "platform scheduler read",
  unavailable: "rooftop ledgers only; scheduler not readable",
};

const Chip = ({ chip }: { chip: PipelineChip }) => <span className={`chip ${chip.tone}`}>{chip.label}</span>;

export default function JobsPipelinesPage() {
  const fx = useViewFixture<JobsPipelinesFixture>("al97-jobs");
  const now = useAdminNow();
  const copy = useFixtureCopy();
  const { isAdmin } = useAuth();
  const { tenant, currentStore } = useTenant();
  const { data, rows, checkedAt, refetch } = useJobsData();
  const timelineQ = useQuery({ queryKey: ["inv-net", "deliveries"], queryFn: () => getDeliveryTimeline(50), enabled: !fx && isAdmin, staleTime: 60_000 });

  const filesFacts = useMemo<FilesWorkerFacts | null>(() => {
    if (fx) return fx.filesWorker;
    const t = timelineQ.data;
    if (!t) return null;
    const timing = t.timing.find((x) => x.integration === "filescom_inventory") ?? null;
    const run = [...t.filescom_runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null;
    return { timing, lastRun: run ? { at: run.finished_at ?? run.started_at, status: run.status, kind: run.kind } : null };
  }, [fx, timelineQ.data]);

  const table = useMemo<PipelineRow[]>(() => {
    if (!data) return [];
    return PIPELINES.flatMap((p) => {
      if (p.id === "files_com_worker") return [filesWorkerRow(filesFacts, "/admin/integrations/files-com")];
      const row = rows.find((r) => r.spec.id === p.id);
      if (!row) return [];
      const cron = row.spec.cronName in data.status.cron ? data.status.cron[row.spec.cronName] : "unavailable";
      return [catalogPipelineRow(row, cron, data.ledgers, p.label, ADMIN_CHILD_ROUTES.jobDetail(p.id))];
    });
  }, [data, rows, filesFacts]);

  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };
  const title = "Jobs & pipelines";
  const subtitle = "Execution permission, request delivery and completed work have separate outcomes.";
  const more = (
    <div className="mt-6">
      <JobsView />
    </div>
  );

  if (!data) {
    return <Al97Frame crumb={title} title={title} subtitle={subtitle} scopeLabel={scopeLabel} main={<div className="work" aria-busy="true"><Banner tone="blue" icon="info" title="Reading job status" detail="Schedules, deliveries and work ledgers show once they answer." /></div>} />;
  }

  const inv = rows.find((r) => r.spec.id === "inventory_sync") ?? null;
  const invCron = inv && inv.spec.cronName in data.status.cron ? data.status.cron[inv.spec.cronName] : "unavailable";
  const invPaused = inv?.verdict.state === "disabled";
  const lastRequest = invCron && invCron !== "unavailable" ? invCron.last_start : null;
  const successOlder = !!inv?.lastSuccessAt && !!lastRequest && Date.parse(inv.lastSuccessAt) < Date.parse(lastRequest);
  const bannerDetail = invPaused
    ? `MarketCheck sync is intentionally paused.${successOlder ? " Its last business success is older than its last cron request." : ""}`
    : "Each job is judged by its own work ledger, not by the scheduler's record of a delivered request.";
  const note = copy("jobs.note", `Source: ${SOURCE[data.status.source] ?? data.status.source}. Checked ${checkedAt ? formatClock(checkedAt, now) : "just now"}.`);
  const refresh = () => { if (!fx) { void refetch(); if (isAdmin) void timelineQ.refetch(); } };

  const main = (
    <div className="work">
      <Banner tone="blue" icon="info" title="A delivered request is not a successful inventory update" detail={bannerDetail} />
      <Card id="jp-ops" title="Scheduled operations" description={note}>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Last delivery</th><th scope="col">Last work result</th><th scope="col">Health</th><th scope="col"><span className="sr-only">Inspect</span></th></tr></thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{r.schedule}</td>
                  <td>{r.delivery}</td>
                  <td>{r.work}</td>
                  <td><Chip chip={r.health} /></td>
                  <td><Link to={r.href} aria-label={`Inspect ${r.label}`}>Inspect</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div>
          <Card id="jp-derivation" title="Health derivation">
            <KeyVals rows={[["Scheduler", "Exists / paused / active / unreadable"], ["Delivery", "Database request accepted"], ["Execution", "Worker actually started and completed"], ["Business outcome", "Tenant rows applied / held / failed"]]} />
          </Card>
        </div>
        <div>
          <Card id="jp-paused" title="Paused by design">
            <img className="art" src={safePause} alt="" />
            <p>Keep paused jobs paused. Recovery never silently resumes a provider or enables paid work.</p>
          </Card>
        </div>
      </div>
      <Savebar title="Read-only diagnostics" detail="Show source and checked-at time for every status."
        action={<button type="button" className="btn" onClick={refresh}><Glyph name="retry" />Refresh status</button>} />
    </div>
  );
  return <Al97Frame crumb={title} title={title} subtitle={subtitle} scopeLabel={scopeLabel} main={main}>{more}</Al97Frame>;
}

import { useParams } from "react-router-dom";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { HEALTH_META, describeAge, type HealthTone } from "@/lib/admin/health";
import { describeCron, JOB_CATALOG } from "@/lib/admin/integrations/jobs";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { EmptyState, KeyValueList, LinkButton, Panel, SkeletonBlock, StatusText } from "@/components/product";
import { cn } from "@/lib/utils";
import { useJobsData } from "@/pages/admin/views/integrations/JobsView";

// One scheduled job. The scheduler state, the last invocation, the result and
// the last usable output are four separate facts, each read from its own
// source; a green invocation does not imply a usable output.

const DOT: Record<HealthTone, string> = { neutral: "bg-adm-muted", success: "bg-adm-success", warning: "bg-[#D98B00]", danger: "bg-adm-danger", info: "bg-adm-primary" };

const Step = ({ tone, title, children, last = false }: { tone: HealthTone; title: string; children: React.ReactNode; last?: boolean }) => (
  <li className="relative pl-6 pb-4 last:pb-0">
    {!last && <span aria-hidden="true" className="absolute left-[3px] top-3 bottom-0 w-px bg-adm-border" />}
    <span aria-hidden="true" className={cn("absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full", DOT[tone])} />
    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
    <div className="text-[13px] leading-[18px] text-adm-muted">{children}</div>
  </li>
);

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, rows, formatAt, now } = useJobsData();
  const row = rows.find((r) => r.spec.id === jobId) ?? null;
  const spec = JOB_CATALOG.find((j) => j.id === jobId) ?? null;
  const jobsHref = adminTabHref("jobs");
  const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: jobsHref }, { label: "Jobs and pipelines", href: jobsHref }, { label: spec?.label ?? "Job" }];

  if (!data) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title="Job">
        <div className="space-y-4" aria-busy="true" aria-label="Loading job">
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </ChildPageFrame>
    );
  }

  if (!row || !spec) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title="Job not found">
        <Panel>
          <EmptyState title="Job not found" detail="No scheduled job with this id is in the catalog." action={<LinkButton to={jobsHref}>Back to jobs</LinkButton>} compact />
        </Panel>
      </ChildPageFrame>
    );
  }

  const cron = spec.cronName in data.status.cron ? data.status.cron[spec.cronName] : "unavailable";
  const cronRow = cron === "unavailable" ? null : cron;
  const meta = HEALTH_META[row.verdict.state];
  const scheduler: { label: string; tone: HealthTone } = cron === "unavailable" ? { label: "Unknown", tone: "neutral" } : !cronRow ? { label: "Not scheduled", tone: "warning" } : cronRow.active === false ? { label: "Paused", tone: "warning" } : cronRow.active ? { label: "Enabled", tone: "success" } : { label: "Unknown", tone: "neutral" };
  const succeeded = row.lastOutcome?.toLowerCase() === "ok" || row.lastOutcome?.toLowerCase() === "succeeded" || row.lastOutcome?.toLowerCase() === "success";
  const outcomeTone: HealthTone = !row.lastOutcome ? "neutral" : succeeded ? "success" : "danger";

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={spec.label}
      subtitle={row.verdict.headline}
      backHref={jobsHref}
      backLabel="Back to jobs"
      actions={<LinkButton variant="primary" to={spec.drillIn}>{spec.drillInLabel}</LinkButton>}
    >
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <Panel title="Job configuration" titleSize="md" inset="sm">
          <KeyValueList
            rows={[
              { label: "Job name", value: spec.label },
              { label: "Scheduler", value: <StatusText tone={scheduler.tone}>{scheduler.label}</StatusText> },
              { label: "Schedule", value: row.schedule ? describeCron(row.schedule) : <span className="text-adm-muted">Unknown</span> },
              { label: "Expected cadence", value: spec.cadenceHours >= 24 ? `${Math.round(spec.cadenceHours / 24)} day${spec.cadenceHours >= 48 ? "s" : ""}` : `${spec.cadenceHours} hour${spec.cadenceHours === 1 ? "" : "s"}` },
              { label: "Scope", value: spec.scope },
              { label: "Affects", value: spec.affectedOutput },
              { label: "Last invocation", value: row.lastAttemptAt ? formatAt(row.lastAttemptAt) : <span className="text-adm-muted">None recorded</span> },
              { label: "Scheduler task", value: <span className="font-mono text-[13px] break-all">{spec.cronName}</span> },
            ]}
          />
        </Panel>
        <Panel title="Run timeline" titleSize="md" inset="sm">
          <ol>
            <Step tone={scheduler.tone} title="Scheduler">
              {scheduler.label}{row.schedule ? `, ${describeCron(row.schedule)}` : ""}
            </Step>
            <Step tone={row.lastAttemptAt ? "success" : "neutral"} title="Last invocation">
              {row.lastAttemptAt ? `${formatAt(row.lastAttemptAt)} (${describeAge(row.lastAttemptAt, now)})` : "No invocation recorded"}
            </Step>
            <Step tone={outcomeTone} title="Provider or job result">
              {row.lastOutcome ? row.lastOutcome.replace(/_/g, " ") : "No result recorded"}
            </Step>
            <Step tone={row.lastSuccessAt ? "success" : "neutral"} title="Last usable output" last>
              {row.lastSuccessAt ? `${formatAt(row.lastSuccessAt)}${row.evidence === "scheduler" ? ", scheduler record for all rooftops" : ""}` : "No successful output recorded"}
            </Step>
          </ol>
        </Panel>
        <Panel title="Outcome" titleSize="md" inset="sm">
          <KeyValueList
            rows={[
              { label: "Health", value: <StatusText tone={meta.tone}>{meta.label}</StatusText> },
              { label: "Last outcome", value: row.lastOutcome ? row.lastOutcome.replace(/_/g, " ") : <span className="text-adm-muted">None recorded</span> },
              { label: "Last success", value: row.lastSuccessAt ? formatAt(row.lastSuccessAt) : <span className="text-adm-muted">None recorded</span> },
              { label: "Evidence", value: row.evidence === "rooftop_ledger" ? "This rooftop's ledger" : row.evidence === "scheduler" ? "Scheduler record" : "None" },
              { label: "Retained data", value: row.verdict.inventoryPreserved === "unknown" ? "Unknown" : row.verdict.inventoryPreserved ? "Last good data kept" : "Not kept" },
            ]}
          />
          <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">{row.verdict.detail}</p>
        </Panel>
      </div>
    </ChildPageFrame>
  );
}

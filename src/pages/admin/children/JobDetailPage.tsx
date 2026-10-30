import { useParams } from "react-router-dom";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { HEALTH_META, describeAge, needsAttention, type HealthTone } from "@/lib/admin/health";
import { describeCron, JOB_CATALOG } from "@/lib/admin/integrations/jobs";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { EmptyState, InlineNote, KeyValueList, LinkButton, Panel, SkeletonBlock, StatusText } from "@/components/product";
import { cn } from "@/lib/utils";
import { useJobsData } from "@/pages/admin/views/integrations/JobsView";

// One scheduled job. The scheduler state, the last invocation, the result and
// the last usable output are four separate facts, each read from its own
// source; a green invocation does not imply a usable output.

const DOT: Record<HealthTone, string> = { neutral: "bg-adm-muted", success: "bg-adm-success", warning: "bg-[#D98B00]", danger: "bg-adm-danger", info: "bg-adm-primary" };

const Step = ({ n, tone, title, time, children, last = false }: { n: number; tone: HealthTone; title: string; time?: string; children: React.ReactNode; last?: boolean }) => (
  <li className="relative pl-9 pb-5 last:pb-0">
    {!last && <span aria-hidden="true" className="absolute left-[9px] top-5 bottom-0 w-0.5 bg-adm-border" />}
    <span aria-hidden="true" className={cn("absolute left-[3px] top-[4px] h-3.5 w-3.5 rounded-full ring-4 ring-white", DOT[tone])} />
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{n}. {title}</p>
      {time && <p className="text-[13px] leading-[18px] text-adm-muted whitespace-nowrap">{time}</p>}
    </div>
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
  const outcomeText = row.lastOutcome ? row.lastOutcome.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
  const outcomeTone: HealthTone = !row.lastOutcome ? "neutral" : succeeded ? "success" : "danger";

  const banner = scheduler.label === "Paused" || needsAttention(row.verdict.state);
  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={row.lastOutcome ? (succeeded ? "Invocation completed" : "Invocation failed") : row.verdict.headline}
      subtitle={`${spec.label}, scheduled job detail${row.lastAttemptAt ? `. Last invocation ${formatAt(row.lastAttemptAt)}` : ""}`}
      actions={banner ? undefined : <LinkButton variant="primary" to={spec.drillIn}>{spec.drillInLabel}</LinkButton>}
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
            <Step n={1} tone={scheduler.tone} title="Scheduler">
              {scheduler.label}{row.schedule ? `, ${describeCron(row.schedule)}` : ""}
            </Step>
            <Step n={2} tone={row.lastAttemptAt ? "success" : "neutral"} title="Last invocation">
              {row.lastAttemptAt ? `${formatAt(row.lastAttemptAt)} (${describeAge(row.lastAttemptAt, now)})` : "No invocation recorded"}
            </Step>
            <Step n={3} tone={outcomeTone} title="Provider or job result">
              {row.lastOutcome ? outcomeText : "No result recorded"}
            </Step>
            <Step n={4} tone={row.lastSuccessAt ? "success" : "neutral"} title="Last usable output" last>
              {row.lastSuccessAt ? `${formatAt(row.lastSuccessAt)}${row.evidence === "scheduler" ? ", scheduler record for all rooftops" : ""}` : succeeded ? "Run completed; no output confirmed for this rooftop" : "No successful output recorded"}
            </Step>
          </ol>
        </Panel>
        <Panel title="Outcome" titleSize="md" inset="sm">
          <KeyValueList
            className="grid-cols-[minmax(96px,112px)_1fr] gap-x-4"
            rows={[
              { label: "Last outcome", value: row.lastOutcome ? <>{outcomeText}{row.lastOutcome && !row.lastSuccessAt && succeeded ? " (scheduler run)" : ""}</> : <span className="text-adm-muted">None recorded</span> },
              { label: "Last success", value: row.lastSuccessAt ? formatAt(row.lastSuccessAt) : <span className="text-adm-muted">{succeeded ? "None confirmed" : "None recorded"}</span> },
              { label: "Evidence", value: row.evidence === "rooftop_ledger" ? "This rooftop's ledger" : row.evidence === "scheduler" ? "Scheduler record" : "None" },
              { label: "Retained data", value: row.verdict.inventoryPreserved === "unknown" ? "Unknown" : row.verdict.inventoryPreserved ? "Last good data kept" : "Not kept" },
            ]}
          />
          <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">{row.verdict.detail}</p>
        </Panel>
      </div>
      {banner && (
        <InlineNote
          tone="warning"
          className="mt-4"
          title={scheduler.label === "Paused" ? "This scheduled job is paused." : row.verdict.headline}
          action={<LinkButton variant="outline" to={spec.drillIn}>{spec.drillInLabel}</LinkButton>}
        >
          {row.verdict.detail}
        </InlineNote>
      )}
    </ChildPageFrame>
  );
}

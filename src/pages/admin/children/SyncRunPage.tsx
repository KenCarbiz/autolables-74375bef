import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChartNoAxesColumn, Check, ChevronUp, CircleCheck, CircleX, Clock, CodeXml, Copy, FileText, Info, TriangleAlert, Wrench, Zap } from "lucide-react";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { describeAge, RUN_OUTCOME_META, type HealthTone } from "@/lib/admin/health";
import { buildRunTimeline, diagnosisFor, httpReason, inventoryWrites, nextStepFor, outcomeForRun, redactEvidence, runImpact, sourceHost, type SyncErrorRow, type SyncRunRow } from "@/lib/admin/integrations/runs";
import { formatTime, zoneLabel } from "@/lib/admin/integrations/format";
import { loadLastSuccessAt, loadRun } from "@/lib/admin/integrations/queries";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, EmptyState, ICON, InlineNote, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { useFormatAt, useViewer } from "@/pages/admin/views/integrations/common";
import { cn } from "@/lib/utils";

// One inventory sync run, read from its immutable ledger row. The outcome,
// diagnosis, next safe action, timeline and impact are all derived from the
// row; the technical evidence is redacted before it is shown. Nothing on this
// page starts a run.

export interface SyncRunFixture {
  run: SyncRunRow | null;
  errors: SyncErrorRow[];
  lastSuccessAt: string | null;
  failed?: boolean;
}

const BADGE_LABEL: Partial<Record<keyof typeof RUN_OUTCOME_META, string>> = {
  provider_rate_limited: "Provider rate limited",
  provider_auth_failed: "Provider rejected credential",
  identity_hold: "Source identity on hold",
};

const EVENT_ICON: Record<HealthTone, { icon: typeof Info; fill: string }> = {
  neutral: { icon: Clock, fill: "fill-adm-muted" },
  success: { icon: CircleCheck, fill: "fill-adm-success" },
  warning: { icon: TriangleAlert, fill: "fill-adm-warning" },
  danger: { icon: CircleX, fill: "fill-adm-danger" },
  info: { icon: Info, fill: "fill-adm-primary" },
};

const DIAGNOSIS_ICON: Record<HealthTone, typeof Info> = { neutral: Clock, success: CircleCheck, warning: TriangleAlert, danger: TriangleAlert, info: Info };
const DIAGNOSIS_COLOR: Record<HealthTone, string> = { neutral: "text-adm-muted", success: "text-adm-success", warning: "text-adm-warning", danger: "text-adm-danger", info: "text-adm-primary" };
const DIAGNOSIS_PANEL: Record<HealthTone, string> = {
  neutral: "border-adm-border",
  success: "border-[#BFE3CF] bg-adm-success-bg",
  warning: "border-[#F1D58A] bg-adm-warning-bg",
  // The reference frames a refusal in a saturated rose line, stronger than the chip tint.
  danger: "border-[#F7848E] bg-adm-danger-bg",
  info: "border-[#C5D4F7] bg-adm-selected",
};

const TITLE = "Inventory sync run";
// Measured on the reference: 12px timeline headers over 13/17 cells, rule
// lines inset 20px from the card edges, and 16px card titles.
const CARD_TITLE = "text-[16px] leading-[22px] font-semibold text-adm-ink";
const TL_TH = "bg-transparent px-3 pt-[5px] pb-[6px] text-[12px] leading-[18px] font-normal text-adm-muted";
const TL_TD = "px-3 py-0 text-[13px] leading-[17px] align-middle";
const INSET_RULE = "mx-5 border-b border-adm-border";

export default function SyncRunPage() {
  const fixture = useViewFixture<SyncRunFixture>("sync-run");
  const { runId } = useParams<{ runId: string }>();
  const now = useAdminNow();
  const viewer = useViewer();
  const tenantId = fixture ? null : viewer.tenantId;
  const formatAt = useFormatAt(viewer.timeZone);
  const [retryOpen, setRetryOpen] = useState(false);

  const live = useQuery({
    queryKey: ["admin-v2", "sync-run", runId, tenantId],
    enabled: !fixture && !!runId && !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [detail, success] = await Promise.all([loadRun(runId as string), loadLastSuccessAt(tenantId as string)]);
      return { ...detail, lastSuccessAt: success.at };
    },
  });

  const data: SyncRunFixture | null = fixture ?? (live.data ? { run: live.data.run, errors: live.data.errors, lastSuccessAt: live.data.lastSuccessAt, failed: live.data.failed } : live.isError ? { run: null, errors: [], lastSuccessAt: null, failed: true } : null);
  const run = data?.run ?? null;

  const model = useMemo(() => {
    if (!run) return null;
    const outcome = outcomeForRun(run);
    const host = sourceHost(run, null);
    return {
      outcome,
      meta: RUN_OUTCOME_META[outcome],
      host,
      diagnosis: diagnosisFor(outcome, run),
      next: nextStepFor(outcome, run.http_status),
      timeline: buildRunTimeline(run, outcome, host),
      impact: runImpact(run, outcome),
      // The headline facts first; the full redacted row follows for anyone who needs it.
      summary: { http_status: run.http_status, reason: outcome, source: host, timestamp: run.finished_at ?? run.started_at },
      evidence: redactEvidence({
        run_id: run.id,
        status: run.status,
        http_status: run.http_status,
        reason: httpReason(run.http_status),
        source: host,
        started_at: run.started_at,
        finished_at: run.finished_at,
        matched_dealer: run.matched_dealer,
        error_summary: run.error_summary,
        raw: run.raw,
      }),
    };
  }, [run]);

  const runSucceeded = !!model && (model.outcome === "success" || model.outcome === "partial") && !!run;
  const lastSuccessAt = data?.lastSuccessAt ?? (runSucceeded && run ? run.finished_at ?? run.started_at : null);

  const crumbs = [
    { label: "Administration", href: "/admin" },
    { label: "Integrations", href: adminTabHref("inventory-feed") },
    { label: "Inventory feed", href: adminTabHref("inventory-feed") },
    { label: "Run details" },
  ];
  const feedHref = adminTabHref("inventory-feed");

  if (!data) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title={TITLE}>
        <div className="space-y-4" aria-busy="true" aria-label="Loading run">
          <SkeletonBlock className="h-[113px] w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </ChildPageFrame>
    );
  }

  if (!run || !model) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title={TITLE}>
        <AdminCard>
          <EmptyState title={data.failed ? "This run could not be read" : "Run not found"} detail={data.failed ? "The ledger did not answer. Nothing here is current." : "No run with this id is recorded for your rooftop."} action={<AdminLinkButton to={feedHref}>Back to feed</AdminLinkButton>} compact />
        </AdminCard>
      </ChildPageFrame>
    );
  }

  const { outcome, meta, diagnosis, next, timeline, impact, evidence, summary, host } = model;
  const refusal = outcome === "provider_rate_limited" || outcome === "provider_auth_failed" || outcome === "provider_error" || outcome === "transport_error";
  const badgeTone: HealthTone = refusal ? "danger" : meta.tone;
  const writes = inventoryWrites(impact);
  const pinRetained = meta.inventoryPreserved === true;
  const zone = zoneLabel(viewer.timeZone, now);
  const DiagnosisIcon = DIAGNOSIS_ICON[diagnosis.tone];
  const BadgeIcon = DIAGNOSIS_ICON[badgeTone];
  const evidenceText = JSON.stringify(summary, null, 2);

  return (
    <ChildPageFrame section="integrations"
      crumbs={crumbs}
      title={TITLE}
      badge={
        <StatusChip tone={badgeTone} className={cn("h-[38px] rounded-lg border px-2.5 text-[15px] leading-[22px]", refusal ? "border-[#F3B4AE] bg-[#FFF1F2]" : "border-transparent")}>
          <BadgeIcon className="w-[22px] h-[22px] mr-1.5 flex-shrink-0" aria-hidden="true" />
          {BADGE_LABEL[outcome] ?? meta.label}
        </StatusChip>
      }
      subtitle={<>{formatAt(run.started_at, { withYear: true, withZone: true })} · Run {run.id.slice(0, 8)}</>}
    >
      <div>
        <AdminCard id="run-summary" flush>
          <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[324fr_317fr_323fr_340fr]">
            <SummaryCell label="HTTP status" value={run.http_status === null ? "—" : String(run.http_status)} hint={httpReason(run.http_status) ?? "No response recorded"} />
            <SummaryCell label="Source" value={host ?? "Unknown"} hint="Inventory feed" text mask="host" />
            <SummaryCell label="Inventory writes" value={writes === null ? "Unknown" : String(writes)} hint="New, updated, or retired" />
            <SummaryCell label="Rooftop pin" value={pinRetained ? "Retained" : "Unknown"} hint={pinRetained ? "No changes made" : "Not recorded for this run"} text />
          </dl>
        </AdminCard>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_561px] gap-4 xl:gap-x-[23px] items-start">
          <AdminCard id="run-diagnosis" className={cn("xl:min-h-[209px]", DIAGNOSIS_PANEL[diagnosis.tone])} bodyClassName="px-[22px] pt-[22px] pb-6">
            <div className="flex items-start gap-[15px]">
              <DiagnosisIcon className={cn("w-[34px] h-[34px] flex-shrink-0", DIAGNOSIS_COLOR[diagnosis.tone])} aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="mt-[2px] text-[23px] leading-[30px] font-bold text-adm-ink">{diagnosis.title}</h2>
                <p className="mt-4 text-[15px] leading-[23px] text-adm-ink">{diagnosis.detail}</p>
              </div>
            </div>
          </AdminCard>

          <AdminCard id="run-next-step" className="border-[#C5D4F7] bg-adm-selected" bodyClassName="px-[23px] pt-[14px] pb-3">
            <div className="flex items-start gap-[13px]">
              <Wrench className="w-8 h-8 flex-shrink-0 -ml-[3px] text-adm-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[16px] leading-[22px] font-semibold text-adm-primary">Next step</p>
                <h3 className="mt-[2px] text-[18px] leading-[26px] font-bold text-adm-ink">{next.title}</h3>
                <p className="mt-1.5 text-[14px] leading-[22px] text-adm-ink">{next.detail}</p>
              </div>
            </div>
            <div className="mt-[14px] grid grid-cols-1 sm:grid-cols-[1.18fr_1fr] xl:grid-cols-[259px_minmax(0,1fr)] divide-y sm:divide-y-0 sm:divide-x divide-[#C5D4F7] border-t border-[#C5D4F7] pt-[10px]">
              <div className="min-w-0 pb-2.5 sm:pb-0 sm:pr-6">
                <p className="text-[14px] leading-[20px] text-adm-muted">Last successful run</p>
                {lastSuccessAt ? (
                  <p data-parity="timestamp" className="mt-0.5 text-[16px] leading-[22px] font-semibold text-adm-ink" title={describeAge(lastSuccessAt, now)}>{formatAt(lastSuccessAt, { withYear: true, withZone: true })}</p>
                ) : (
                  <p className="mt-0.5 text-[16px] leading-[22px] font-semibold text-adm-muted">None recorded</p>
                )}
              </div>
              <div className="min-w-0 pt-2.5 sm:pt-0 sm:pl-8">
                <p className="text-[14px] leading-[20px] text-adm-muted">Existing identity</p>
                <p className="mt-[2px] text-[16px] leading-[22px] font-semibold text-adm-ink">{pinRetained ? "Retained" : "Unknown"}</p>
                <p className="text-[13px] leading-[16px] text-adm-muted">{pinRetained ? "Rooftop pin remains unchanged" : "Not recorded for this run"}</p>
              </div>
            </div>
          </AdminCard>
        </div>

        <div className="mt-4 xl:mt-[15px] grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_554px] gap-4 xl:gap-x-[15px] items-start">
          <div className="space-y-[7px] min-w-0">
            <AdminCard id="run-timeline" flush className="xl:mt-px">
              <div className="flex items-center gap-[17px] pl-[17px] pr-5 pt-[9px] pb-2">
                <FileText className="w-[22px] h-[22px] flex-shrink-0 text-adm-primary" aria-hidden="true" />
                <h3 className={CARD_TITLE}>Event timeline</h3>
              </div>
              <div className={INSET_RULE} aria-hidden="true" />
              {/* Below md the three columns would wrap every cell, so each event is a stacked card there instead. */}
              <ol className="md:hidden mx-5 divide-y divide-adm-border" aria-label="Run event timeline">
                {timeline.map((ev, i) => (
                  <li key={`${ev.label}-${i}`} className="flex items-start gap-3 py-3">
                    <EventIcon tone={ev.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{ev.label}</p>
                      <p className="text-[13px] leading-[18px] tabular-nums text-adm-muted">
                        {ev.at ? <time dateTime={ev.at} data-parity="timestamp">{formatTime(ev.at, viewer.timeZone)}{zone ? ` ${zone}` : ""}</time> : "Time not recorded"}
                      </p>
                      <p className="mt-1 text-[13px] leading-[19px] text-adm-ink [overflow-wrap:anywhere]">{ev.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {/* Row heights follow the reference rhythm (32, 45 and 51px, then a 55px last row); they are minimums, so longer copy still grows. */}
              <AdminTable caption="Run event timeline" className="hidden md:block mx-5 xl:[&_table]:table-fixed [&_tbody_tr:first-child]:h-[31px] [&_tbody_tr:nth-child(2)]:h-[45px] [&_tbody_tr:nth-child(3)]:h-[51px] [&_tbody_tr:last-child]:h-[55px] [&_tbody_tr:last-child>td]:border-b-0">
                <colgroup>
                  <col className="w-[114px]" />
                  <col className="w-[231px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <Th className={cn(TL_TH, "pl-1")}>Time{zone ? ` (${zone})` : ""}</Th>
                    <Th className={cn(TL_TH, "pl-[49px]")}>Event</Th>
                    <Th className={TL_TH}>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((ev, i) => (
                    <tr key={`${ev.label}-${i}`}>
                      <Td className={cn(TL_TD, "pl-1 whitespace-nowrap tabular-nums text-adm-ink")}><span data-parity="timestamp">{ev.at ? formatTime(ev.at, viewer.timeZone) : "—"}</span></Td>
                      <Td className={cn(TL_TD, "pl-0")}>
                        <span className="flex items-center gap-[23px] text-adm-ink">
                          <EventIcon tone={ev.tone} />
                          <span className="min-w-0">{ev.label}</span>
                        </span>
                      </Td>
                      <Td className={cn(TL_TD, "text-adm-ink")}>{ev.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </AdminCard>

            <AdminCard id="run-evidence" flush>
              {/* The copy control stays outside the summary so it is not nested inside the toggle; from sm it sits in the corner of the evidence block, beside the short opening lines. */}
              <details open className="group">
                <summary className="flex cursor-pointer list-none items-center gap-[15px] pl-[17px] pr-[22px] pt-[7px] pb-[7px] [&::-webkit-details-marker]:hidden">
                  <CodeXml className="w-6 h-6 flex-shrink-0 text-adm-ink" aria-hidden="true" />
                  <h3 className={cn(CARD_TITLE, "flex-1")}>Technical evidence</h3>
                  <ChevronUp className="w-[22px] h-[22px] text-adm-ink transition-transform rotate-180 group-open:rotate-0" aria-hidden="true" />
                </summary>
                <div className="relative px-5 pb-[4px]">
                  <CopyButton text={evidenceText} label="Copy technical evidence" className="flex w-fit ml-auto mb-1.5 sm:absolute sm:m-0 sm:right-[26px] sm:top-[3px] sm:bg-adm-workspace" />
                  <pre data-parity="evidence" className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-adm-workspace px-3 sm:px-[18px] py-1.5 font-mono text-[12px] leading-[18px] sm:leading-[13px] text-adm-ink">{evidenceText}</pre>
                </div>
              </details>
            </AdminCard>
            <details className="px-1">
              <summary className="cursor-pointer text-[12px] leading-[18px] font-semibold text-adm-primary">Full redacted payload</summary>
              <pre data-parity="evidence" tabIndex={0} role="region" aria-label="Full redacted payload" className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-adm-border bg-adm-surface p-3 font-mono text-[12px] leading-[18px] text-adm-ink">{JSON.stringify(evidence, null, 2)}</pre>
              <p className="mt-2 text-[11px] text-adm-muted">Credential-like fields are removed before display. Run id {run.id}.</p>
            </details>

            {(data.errors.length > 0 || outcome === "partial") && (
              <AdminCard title="Per-vehicle errors" description={`${data.errors.length} recorded for this run.`} flush>
                {data.errors.length === 0 ? (
                  <p className="px-6 pb-6 text-[13px] text-adm-muted">No per-vehicle errors were recorded.</p>
                ) : (
                  <AdminTable caption="Per-vehicle errors">
                    <thead>
                      <tr>
                        <Th>Time</Th>
                        <Th>VIN</Th>
                        <Th>Code</Th>
                        <Th>Message</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.errors.map((e) => (
                        <tr key={e.id}>
                          <Td className="whitespace-nowrap tabular-nums text-adm-muted">{formatAt(e.created_at, { withSeconds: true })}</Td>
                          <Td className="font-mono text-[12px]">{e.vin ?? "(no VIN)"}</Td>
                          <Td className="text-adm-muted">{e.code ?? "error"}</Td>
                          <Td className="text-adm-muted">{e.message ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                )}
              </AdminCard>
            )}
          </div>

          <div className="space-y-5 xl:space-y-[19px]">
            <AdminCard id="run-impact" flush>
              <div className="flex items-center gap-[13px] pl-[14px] pr-5 pt-[11px] pb-[9px]">
                <ChartNoAxesColumn className="w-8 h-8 flex-shrink-0 text-adm-ink" aria-hidden="true" />
                <h3 className={CARD_TITLE}>Impact</h3>
              </div>
              <div className={INSET_RULE} aria-hidden="true" />
              <div className="mt-5 mb-[25px] grid grid-cols-3 xl:grid-cols-[179px_187px_minmax(0,1fr)] divide-x divide-adm-border">
                <ImpactStat value={impact.newVehicles} label="New vehicles" zero="No vehicles imported" some="Vehicles added" />
                <ImpactStat value={impact.updated} label="Updated vehicles" zero="No vehicles updated" some="Vehicles changed" />
                <ImpactStat value={impact.retired} label="Retired vehicles" zero="No vehicles retired" some="Vehicles removed" />
              </div>
            </AdminCard>

            <AdminCard id="run-actions" flush>
              <div className="flex items-center gap-[13px] pl-4 pr-5 pt-[15px] pb-[13px]">
                <Zap className="w-7 h-7 flex-shrink-0 text-adm-ink" aria-hidden="true" />
                <h3 className={CARD_TITLE}>Actions</h3>
              </div>
              <div className={INSET_RULE} aria-hidden="true" />
              <div className="pl-[18px] pr-[22px] pt-[14px] pb-[19px]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AdminLinkButton to={feedHref} variant="outline" className="min-h-[44px] sm:min-h-[44px] text-[15px] font-medium gap-3">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                    Back to feed
                  </AdminLinkButton>
                  <AdminButton variant={meta.retryable ? "primary" : "outline"} className="min-h-[44px] sm:min-h-[44px] text-[15px]" onClick={() => setRetryOpen((o) => !o)} aria-expanded={retryOpen}>Review retry options</AdminButton>
                </div>
                {retryOpen && (
                  <InlineNote tone="info" title="Retry options" className="mt-3">
                    {meta.retryable
                      ? "The next scheduled run retries automatically. A manual run can be started from the Inventory feed tab by a settings manager after a confirmation that states its cost; it is disabled while the provider is rate limiting."
                      : "This outcome is not retried automatically. Review the source identity from the Inventory feed tab before any change."}
                    {" "}Nothing on this page starts a run or changes the source identity.{" "}
                    <Link to={feedHref} className="font-semibold text-adm-primary hover:underline">Open inventory feed</Link>
                  </InlineNote>
                )}
              </div>
            </AdminCard>
          </div>
        </div>
      </div>
    </ChildPageFrame>
  );
}

const SummaryCell = ({ label, value, hint, text = false, mask }: { label: string; value: string; hint: string; text?: boolean; mask?: string }) => (
  <div className="relative min-w-0 px-5 sm:pl-[32px] sm:first:pl-[26px] sm:pr-5 pt-[15px] pb-[19px] border-t border-adm-border first:border-t-0 sm:border-t-0 before:absolute before:left-0 before:inset-y-[17px] before:w-px before:bg-adm-border before:hidden sm:[&:nth-child(even)]:before:block xl:[&:nth-child(3)]:before:block">
    <dt className="text-[14px] leading-[20px] font-semibold text-adm-muted">{label}</dt>
    <dd data-parity={mask} className={cn("mt-[5px] break-words font-bold text-adm-ink", text ? "text-[25px] leading-[33px]" : "text-[28px] leading-[33px] tabular-nums")}>{value}</dd>
    <dd className="text-[14px] leading-[20px] text-adm-muted">{hint}</dd>
  </div>
);

/** Copies exactly the text already shown on the page; nothing hidden is added. */
const CopyButton = ({ text, label, className }: { text: string; label: string; className?: string }) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={label} className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-md px-2 text-[13px] leading-[18px] font-semibold text-adm-primary hover:bg-adm-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary", className)}>
      {state === "copied" ? <Check className={ICON.button} aria-hidden="true" /> : <Copy className={ICON.button} aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
};

// Filled marks lose a stroke width of visible fill, so the box is drawn larger than the mark it shows.
const EventIcon = ({ tone }: { tone: HealthTone }) => {
  const { icon: Icon, fill } = EVENT_ICON[tone];
  return <Icon className={cn("w-[26px] h-[26px] flex-shrink-0 text-white", fill)} aria-hidden="true" />;
};

/** A count that is never shown as zero when it is not known. */
const ImpactStat = ({ value, label, zero, some }: { value: number | null; label: string; zero: string; some: string }) => (
  <div className="min-w-0 px-2 pt-0.5 pb-[13px] text-center">
    <p className="text-[33px] leading-[40px] font-bold text-adm-ink tabular-nums">{value === null ? "Unknown" : String(value)}</p>
    <p className="text-[15px] leading-[20px] font-medium text-adm-ink">{label}</p>
    <p className="mt-[3px] text-[13px] leading-[18px] text-adm-muted">{value === null ? "Not recorded" : value === 0 ? zero : some}</p>
  </div>
);

export const syncRunHref = (runId: string) => ADMIN_CHILD_ROUTES.syncRun(runId);

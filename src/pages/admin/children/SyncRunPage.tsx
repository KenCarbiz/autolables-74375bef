import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Info, ShieldCheck, XCircle } from "lucide-react";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { describeAge, RUN_OUTCOME_META, type HealthTone } from "@/lib/admin/health";
import { sourceHost } from "@/lib/admin/integrations/runs";
import { buildRunTimeline, diagnosisFor, httpReason, inventoryWrites, nextStepFor, outcomeForRun, redactEvidence, runImpact, type SyncErrorRow, type SyncRunRow } from "@/lib/admin/integrations/runs";
import { zoneLabel } from "@/lib/admin/integrations/format";
import { loadLastSuccessAt, loadRun } from "@/lib/admin/integrations/queries";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, EmptyState, InlineNote, KeyValueList, SkeletonBlock, StatTile, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { BigNumber, TextValue, useFormatAt, useViewer } from "@/pages/admin/views/integrations/common";

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

const TIMELINE_ICON: Record<HealthTone, typeof Info> = { neutral: Clock, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info };
const TIMELINE_COLOR: Record<HealthTone, string> = { neutral: "text-adm-muted", success: "text-adm-success", warning: "text-adm-warning", danger: "text-adm-danger", info: "text-adm-primary" };

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

  const crumbs = [
    { label: "Administration", href: "/admin" },
    { label: "Integrations", href: adminTabHref("inventory-feed") },
    { label: "Inventory feed", href: adminTabHref("inventory-feed") },
    { label: "Run details" },
  ];
  const feedHref = adminTabHref("inventory-feed");

  if (!data) {
    return (
      <ChildPageFrame crumbs={crumbs} title="Inventory sync run" backHref={feedHref} backLabel="Back to feed">
        <div className="space-y-4" aria-busy="true" aria-label="Loading run">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-[76px]" />)}</div>
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </ChildPageFrame>
    );
  }

  if (!run || !model) {
    return (
      <ChildPageFrame crumbs={crumbs} title="Inventory sync run" backHref={feedHref} backLabel="Back to feed">
        <AdminCard>
          <EmptyState title={data.failed ? "This run could not be read" : "Run not found"} detail={data.failed ? "The ledger did not answer. Nothing here is current." : "No run with this id is recorded for your rooftop."} action={<AdminLinkButton to={feedHref}>Back to feed</AdminLinkButton>} compact />
        </AdminCard>
      </ChildPageFrame>
    );
  }

  const { outcome, meta, diagnosis, next, timeline, impact, evidence, host } = model;
  const refusal = outcome === "provider_rate_limited" || outcome === "provider_auth_failed" || outcome === "provider_error" || outcome === "transport_error";
  const badgeTone: HealthTone = refusal ? "danger" : meta.tone;
  const writes = inventoryWrites(impact);
  const pinRetained = meta.inventoryPreserved === true;
  const zone = zoneLabel(viewer.timeZone, now);
  const diagnosisBorder = diagnosis.tone === "danger" ? "border-[#F3B4AE]" : diagnosis.tone === "warning" ? "border-[#F1D58A]" : diagnosis.tone === "success" ? "border-[#BFE3CF]" : "border-adm-border";

  return (
    <ChildPageFrame
      crumbs={crumbs}
      title="Inventory sync run"
      badge={<StatusChip tone={badgeTone} icon className={refusal ? "border border-[#F3B4AE] bg-adm-surface" : undefined}>{BADGE_LABEL[outcome] ?? meta.label}</StatusChip>}
      subtitle={<>{formatAt(run.started_at, { withYear: true, withZone: true })} · Run {run.id.slice(0, 8)}</>}
      backHref={feedHref}
      backLabel="Back to feed"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatTile label="HTTP status" value={run.http_status ?? "—"} hint={httpReason(run.http_status) ?? "No response recorded"} tone={refusal ? "danger" : "neutral"} />
          <StatTile label="Source domain" value={<TextValue>{host ?? "Unknown"}</TextValue>} hint="Inventory feed" tone="info" />
          <StatTile label="Inventory writes" value={writes === null ? "Unknown" : writes} hint="New, updated, or retired" tone="neutral" />
          <StatTile label="Rooftop pin" value={pinRetained ? "Retained" : "Unknown"} hint={pinRetained ? "No changes made" : "Not recorded for this run"} tone={pinRetained ? "success" : "neutral"} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4 items-start">
          <AdminCard className={diagnosisBorder}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 ${TIMELINE_COLOR[diagnosis.tone]}`} aria-hidden="true">{(() => { const Icon = TIMELINE_ICON[diagnosis.tone]; return <Icon className="w-5 h-5" />; })()}</span>
              <div className="min-w-0 space-y-2">
                <h2 className="text-[18px] leading-[26px] font-semibold text-adm-ink">{diagnosis.title}</h2>
                <p className="text-[14px] leading-[20px] text-adm-ink">{diagnosis.detail}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted">
                  Inventory preserved: {meta.inventoryPreserved === "unknown" ? "unknown" : meta.inventoryPreserved ? "yes" : "no"}. {meta.nextSafeAction}
                </p>
              </div>
            </div>
          </AdminCard>
          <AdminCard className="border-[#C5D4F7] bg-adm-selected" title={`Next step: ${next.title}`}>
            <div className="space-y-3">
              <p className="text-[13px] leading-[18px] text-adm-ink">{next.detail}</p>
              <KeyValueList rows={[
                { label: "Last successful run", value: data.lastSuccessAt ? <>{formatAt(data.lastSuccessAt)}<span className="block text-[11px] text-adm-muted">{describeAge(data.lastSuccessAt, now)}</span></> : <span className="text-adm-muted">None recorded</span> },
                { label: "Existing identity", value: <>{pinRetained ? "Retained" : "Unknown"}<span className="block text-[11px] text-adm-muted">{pinRetained ? "Rooftop pin remains unchanged" : "Not recorded for this run"}</span></> },
              ]} />
            </div>
          </AdminCard>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <AdminCard title="Event timeline" description="Derived from the run record; times are the ledger's own." flush>
              <AdminTable caption="Run event timeline">
                <thead>
                  <tr>
                    <Th>Time{zone ? ` (${zone})` : ""}</Th>
                    <Th>Event</Th>
                    <Th>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((ev, i) => {
                    const Icon = TIMELINE_ICON[ev.tone];
                    return (
                      <tr key={`${ev.label}-${i}`}>
                        <Td className="whitespace-nowrap tabular-nums text-adm-muted">{ev.at ? formatAt(ev.at, { withSeconds: true }) : "—"}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-2 font-semibold text-adm-ink">
                            <Icon className={`w-4 h-4 ${TIMELINE_COLOR[ev.tone]}`} aria-hidden="true" />
                            {ev.label}
                          </span>
                        </Td>
                        <Td className="text-adm-muted">{ev.detail}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTable>
              <details className="px-6 py-4 border-t border-adm-border">
                <summary className="cursor-pointer text-[13px] font-semibold text-adm-primary">Technical evidence</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-adm-workspace p-3 text-[12px] leading-[18px] text-adm-ink font-mono">{JSON.stringify(evidence, null, 2)}</pre>
                <p className="mt-2 text-[11px] text-adm-muted">Credential-like fields are removed before display. Run id {run.id}.</p>
              </details>
            </AdminCard>

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

          <div className="space-y-4">
            <AdminCard title="Impact">
              <div className="grid grid-cols-3 gap-3">
                <BigNumber label="New" value={impact.newVehicles === null ? "Unknown" : String(impact.newVehicles)} hint="Vehicles added" />
                <BigNumber label="Updated" value={impact.updated === null ? "Unknown" : String(impact.updated)} hint="Vehicles changed" />
                <BigNumber label="Retired" value={impact.retired === null ? "Unknown" : String(impact.retired)} hint="Vehicles removed" />
              </div>
            </AdminCard>
            <AdminCard title="Actions">
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <AdminLinkButton to={feedHref} variant="secondary">Back to feed</AdminLinkButton>
                  <AdminButton variant="primary" onClick={() => setRetryOpen((o) => !o)} aria-expanded={retryOpen}>Review retry options</AdminButton>
                </div>
                {retryOpen && (
                  <InlineNote tone="info" title="Retry options">
                    {meta.retryable
                      ? "The next scheduled run retries automatically. A manual run can be started from the Inventory feed tab by a settings manager after a confirmation that states its cost; it is disabled while the provider is rate limiting."
                      : "This outcome is not retried automatically. Review the source identity from the Inventory feed tab before any change."}
                    {" "}
                    <Link to={feedHref} className="font-semibold text-adm-primary hover:underline">Open inventory feed</Link>
                  </InlineNote>
                )}
                <p className="flex items-center gap-2 text-[12px] leading-[18px] text-adm-muted">
                  <ShieldCheck className="w-4 h-4 text-adm-success" aria-hidden="true" />
                  Nothing on this page starts a run or changes the source identity.
                </p>
              </div>
            </AdminCard>
          </div>
        </div>
      </div>
    </ChildPageFrame>
  );
}

export const syncRunHref = (runId: string) => ADMIN_CHILD_ROUTES.syncRun(runId);

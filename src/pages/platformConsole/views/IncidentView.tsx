import { Link } from "react-router-dom";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { Card, Chip, Panel, Timeline, ViewState } from "@/components/platformConsole/ui";
import { PhoneActionBar, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadIncident, type IncidentAction, type IncidentModel, type IncidentRecord } from "@/lib/platformConsole/live/incident";
import { consolePath } from "@/lib/platformConsole/sections";
import type { Severity, Tone } from "@/lib/platformConsole/types";
import { cn } from "@/lib/utils";
import { useConsoleParams } from "../PlatformConsole";

const SEVERITY_TONE: Record<Severity, Tone> = { high: "bad", medium: "warn", low: "info" };

const ACTION_COPY: Record<IncidentAction, { label: string; title: string; summary: string; width: string }> = {
  assign: { label: "Assign owner", title: "Assign an owner", summary: "Records who is responsible. It does not change the data fault or replay anything.", width: "w-[210px]" },
  acknowledge: { label: "Acknowledge", title: "Acknowledge incident", summary: "Acknowledging records that someone has seen it. It does not resolve the fault.", width: "w-[236px]" },
  snooze: { label: "Snooze", title: "Snooze notifications", summary: "Pauses repeat alerts for a fixed window. The incident stays open.", width: "w-[210px]" },
  resolve: { label: "Resolve", title: "Resolve incident", summary: "Resolution needs fresh evidence: a validated replay and publication.", width: "w-[210px]" },
  reopen: { label: "Reopen", title: "Reopen incident", summary: "Returns the incident to open so it is tracked again.", width: "w-[210px]" },
};

export default function IncidentView() {
  const { incidentId = "" } = useConsoleParams();
  const view = useConsoleView<IncidentModel>("incident", () => loadIncident(incidentId), { key: [incidentId] });
  const data = view.data;
  const title = `Incident ${data?.id ?? incidentId}`;
  return (
    <ConsoleFrame
      title={title}
      subtitle={data?.kind === "incident" ? data.subtitle : "Incident records are not monitored yet"}
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Overview", to: consolePath.overview() }]}
    >
      {view.status !== "ready" || !data ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="incident" />
      ) : data.kind === "not_monitored" ? (
        <Card className="p-6" aria-label="Incident not monitored">
          <p className="flex items-center gap-2 text-[15px] font-bold"><ConsoleIcon name="info" size={20} className="text-[#52677C]" />Not monitored</p>
          <p className="mt-2 max-w-[640px] text-[13px] text-[#52677C]">{data.reason}</p>
          <Link to={consolePath.overview()} className="mt-4 inline-flex min-h-11 items-center text-[13px] font-bold text-[#075BE8] hover:underline">Back to overview</Link>
        </Card>
      ) : (
        <IncidentBody m={data} />
      )}
    </ConsoleFrame>
  );
}

function IncidentBody({ m }: { m: IncidentRecord }) {
  const scope = `incident:${m.id}`;
  const importHref = m.importId ? consolePath.importRun(m.importId) : null;
  return (
    <>
      <div className="flex flex-wrap max-md:-mb-[6px] md:min-h-[44px] items-start justify-between gap-3">
        <Chip tone={SEVERITY_TONE[m.severity]} className="h-[26px] px-[10px]">{m.badge}</Chip>
        <div className="relative -top-[6px] hidden gap-3 md:flex">
          {m.actions.map((a) => (
            <ReviewAction key={a} kind={`incident_${a}`} scope={scope} label={ACTION_COPY[a].label} title={ACTION_COPY[a].title} summary={ACTION_COPY[a].summary} facts={[{ label: "Incident", value: m.id }, { label: "Status", value: m.status }]} className={cn("justify-start", ACTION_COPY[a].width)} />
          ))}
        </div>
      </div>

      {/* Phone */}
      <div className="flex flex-col gap-4 pb-24 md:hidden">
        <Card className="px-4 pb-5 pt-[19px]" aria-label="Customer impact">
          <h2 className="px-1 text-[17px] font-bold leading-[22px]">Customer impact</h2>
          <p className="mt-[24px] text-[15px] font-bold leading-[20px]">{m.scope}</p>
          <p className="mt-[19px] text-[12px] leading-[16px]">{m.impactHelper}</p>
          {m.owner && <p className="mt-[22px] text-[13px] leading-[18px]">{m.owner}</p>}
          <p className="mt-[22px] text-[12px] leading-[16px]">{m.next}</p>
          <p className="mt-[20px] text-[12px] font-bold leading-[16px] text-[#885608]">{m.note}</p>
        </Card>
        <Card className="px-4 pb-[34px] pt-[19px]" aria-label="Timeline">
          <h2 className="px-1 text-[17px] font-bold leading-[22px]">Timeline</h2>
          <div className="mt-[41px]"><Timeline items={m.timeline} label="Incident timeline" /></div>
          {importHref && <Link to={importHref} className="-mt-[3px] flex h-11 items-center rounded-[6px] bg-[#075BE8] px-[14px] text-[13px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]">{m.importLabel}</Link>}
        </Card>
        <PhoneActionBar note="Read-only monitoring by default" detailsTitle={`Incident ${m.id}`} detailsSummary="Actions are reviewed, need a reason and are recorded. Acknowledging does not resolve the fault.">
          {m.actions.map((a) => (
            <ReviewAction key={a} kind={`incident_${a}`} scope={scope} label={ACTION_COPY[a].label} title={ACTION_COPY[a].title} summary={ACTION_COPY[a].summary} facts={[{ label: "Incident", value: m.id }, { label: "Status", value: m.status }]} className="w-full justify-start" />
          ))}
        </PhoneActionBar>
      </div>

      {/* Desktop and tablet */}
      <div className="hidden grid-cols-1 gap-x-[22px] gap-y-[22px] md:grid xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
        <div className="flex flex-col gap-[22px]">
          <Panel id="pc-inc-impact" title="Customer impact" helper={m.impactHelper} className="min-h-[260px]">
            <p className="mt-[26px] text-[15px] font-bold leading-[20px]">{m.scope}</p>
            {m.cause && <p className="mt-[25px] text-[13px] leading-[18px]">{m.cause}</p>}
            <p className="mt-[25px] text-[13px] leading-[18px]">{m.next}</p>
            <p className="mt-[20px] text-[12px] leading-[16px] text-[#52677C]">{m.note}</p>
          </Panel>
          <Panel id="pc-inc-evidence" title="Investigation and evidence" helper={m.evidenceHelper} className="min-h-[306px]">
            <div className="mt-[26px] flex flex-wrap gap-3">
              {importHref && <Link to={importHref} className="inline-flex h-11 w-[220px] max-w-full items-center rounded-[6px] bg-[#075BE8] px-[14px] text-[13px] font-bold text-white hover:bg-[#064fca] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]">{m.importLabel}</Link>}
              <ReviewAction kind="incident_view_evidence" scope={scope} label="Inspect sanitized evidence" title="Inspect sanitized evidence" summary="Evidence reads are audited. Private payloads stay redacted." facts={[{ label: "Incident", value: m.id }]} className="w-[240px] justify-start" submitLabel="Request access" />
            </div>
            <p id="pc-inc-note" className="mt-[41px] text-[13px] font-bold leading-[18px]">Internal note</p>
            <p className="mt-[5px] flex h-11 items-center rounded-[6px] border border-[#D7E1ED] px-3 text-[13px]" aria-labelledby="pc-inc-note">{m.internalNote || "No note recorded"}</p>
          </Panel>
        </div>
        <Panel id="pc-inc-timeline" title="Incident timeline" className="min-h-[378px]">
          <div className="mt-[34px]"><Timeline items={m.timeline} label="Incident timeline" /></div>
        </Panel>
      </div>
    </>
  );
}

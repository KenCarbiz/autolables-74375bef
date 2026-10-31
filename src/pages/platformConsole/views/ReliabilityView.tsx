import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { Pill, RefTable, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadReliability, type JourneyRow, type ReliabilityModel } from "@/lib/platformConsole/live/reliability";
import { consolePath } from "@/lib/platformConsole/sections";

const columns: Column<JourneyRow>[] = [
  { key: "name", header: "Customer journey", width: "350px", render: (r) => r.name },
  { key: "result", header: "Last result", width: "140px", render: (r) => <Pill tone={r.result.tone}>{r.result.label}</Pill> },
  { key: "impact", header: "Observed impact", width: "minmax(0,1fr)", render: (r) => r.impact },
];

export default function ReliabilityView() {
  const view = useConsoleView<ReliabilityModel>("reliability", () => loadReliability());
  const m = view.data;
  return (
    <ConsoleFrame title="Reliability & recovery" subtitle="Customer journeys, deployed versions and recovery evidence." onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="reliability" />
      ) : (
        <>
          <MetricGrid metrics={m.metrics} label="Reliability" />
          <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
            <RefTable rows={m.journeys} columns={columns} rowKey={(r) => r.id} caption="Customer journeys" rowHeight={70} className="self-start" />
            <Panel id="pc-rel-recovery" title="Recovery coverage" helper={m.recoveryHelper} className="min-h-[324px]">
              <ul className="mt-[24px] flex flex-col gap-[21px] text-[13px] leading-[18px]">
                {m.recoveryLines.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <div className="mt-[39px]">
                <ReviewAction kind="recovery_evidence_view" scope="recovery-evidence" label="Inspect recovery evidence" title="Inspect recovery evidence" summary="Recovery evidence reads are audited. Backups and restore results are shown as recorded, never inferred." className="w-[270px] justify-start" submitLabel="Request access" />
              </div>
            </Panel>
          </div>
          <Panel id="pc-rel-release" title="Release timeline" helper={m.releaseHelper} className="mt-[10px] min-h-[174px]" action={<TextLink to={consolePath.monitoring()} className="mt-1 inline-flex min-h-11 items-center">Monitoring coverage</TextLink>}>
            <p className="mt-[17px] whitespace-pre-wrap text-[13px] leading-[18px]">{m.releaseText}</p>
          </Panel>
        </>
      )}
    </ConsoleFrame>
  );
}

import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, TextLink } from "@/components/platformConsole/ui";
import { FootNote, GridTable, LinkButton, PanelLines, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadRatings, type RatingsModel } from "@/lib/platformConsole/live/data";
import { consolePath } from "@/lib/platformConsole/sections";

type Reason = RatingsModel["reasons"][number];

const columns: GridColumn<Reason>[] = [
  { key: "reason", header: "Reason", width: "370px", render: (r) => r.reason },
  { key: "vehicles", header: "Vehicles", width: "100px", render: (r) => r.vehicles },
  { key: "next", header: "Next action", width: "minmax(0,1fr)", render: (r) => (r.href ? <TextLink to={r.href}>{r.next}</TextLink> : r.next) },
];

export default function RatingsView() {
  const view = useConsoleView<RatingsModel>("ratings", () => loadRatings());
  return (
    <ConsoleFrame
      title="Calculations & ratings"
      subtitle="Track eligibility, input freshness and published calculation versions."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <ViewBoundary view={view} what="ratings">
        {(m) => (
          <>
            <MetricGrid metrics={m.metrics} label="Rating status" />
            <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
              <Panel id="pc-rate-why" title="Why ratings are withheld" helper="Do not invent confidence or score when evidence is insufficient" className="min-h-[350px]">
                {m.reasons.length === 0 ? (
                  <FootNote className="mt-6">{m.reasonsNote}</FootNote>
                ) : (
                  <GridTable className="mt-[15px]" rows={m.reasons} columns={columns} rowKey={(r) => r.id} caption="Withheld rating reasons" rowHeight={66} />
                )}
              </Panel>
              <Panel id="pc-rate-release" title="Algorithm release" helper={m.releaseNote} className="min-h-[350px]">
                <PanelLines small className="mt-[22px] gap-[19px]" lines={m.release} />
                <LinkButton to={consolePath.quality()} className="mt-[52px] w-[270px] max-w-full">Inspect calculation version</LinkButton>
              </Panel>
            </div>
            <p className="mt-[36px] text-[14px] leading-[20px] text-[#52677C]">{m.footnote}</p>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

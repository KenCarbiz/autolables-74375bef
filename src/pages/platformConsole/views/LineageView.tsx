import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Panel, StageStrip, TextLink } from "@/components/platformConsole/ui";
import { GridTable, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadLineage, type LineageModel, type LineageRow } from "@/lib/platformConsole/live/data";
import { consolePath } from "@/lib/platformConsole/sections";
import { useConsoleParams } from "../PlatformConsole";

const columns: GridColumn<LineageRow>[] = [
  { key: "field", header: "Field", width: "190px", render: (r) => r.field },
  { key: "observation", header: "Source observation", width: "300px", render: (r) => r.observation },
  { key: "effective", header: "Effective value", width: "230px", render: (r) => r.effective },
  { key: "basis", header: "Basis / freshness", width: "400px", render: (r) => r.basis },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function LineageView() {
  const { vehicleId = "" } = useConsoleParams();
  const view = useConsoleView<LineageModel>("lineage", () => loadLineage(vehicleId), { key: [vehicleId] });
  return (
    <ConsoleFrame
      title={view.data?.title ?? "Vehicle data inspection"}
      subtitle={view.data?.subtitle ?? "Trace each customer-facing value back to its source."}
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Data quality", to: consolePath.quality() }]}
    >
      <ViewBoundary view={view} what="vehicle lineage">
        {(m) => (
          <>
            <StageStrip stages={m.stages} label="Data lineage" />
            <GridTable className="mt-[2px]" rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Field lineage" rowHeight={76} />
            <Panel id="pc-lineage-trace" title="Trace this customer display" helper={m.traceNote} className="mt-[4px] min-h-[130px]">
              <span className="sr-only">Each value above shows its source observation and effective value separately.</span>
            </Panel>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, StageStrip } from "@/components/platformConsole/ui";
import { GridTable, LinkButton, PanelLines, StateChip, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadStore, type StoreConnectionRow, type StoreModel } from "@/lib/platformConsole/live/stores";
import { consolePath } from "@/lib/platformConsole/sections";
import { useConsoleParams } from "../PlatformConsole";

const columns: GridColumn<StoreConnectionRow>[] = [
  { key: "name", header: "Connection", width: "200px", render: (r) => r.name },
  { key: "state", header: "State", width: "140px", chip: true, render: (r) => <StateChip tone={r.state.tone}>{r.state.label}</StateChip> },
  { key: "work", header: "Last successful work", width: "minmax(0,1fr)", render: (r) => r.lastWork },
];

export default function StoreView() {
  const { storeId = "" } = useConsoleParams();
  const view = useConsoleView<StoreModel>("store", () => loadStore(storeId), { key: [storeId] });
  return (
    <ConsoleFrame
      title={view.data?.title ?? "Store"}
      subtitle={view.data?.subtitle ?? "Store ownership and sharing are explicit."}
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Stores", to: consolePath.stores() }]}
    >
      <ViewBoundary view={view} what="store">
        {(m) => (
          <>
            <MetricGrid metrics={m.metrics} label="Store status" />
            <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,760fr)_minmax(0,538fr)]">
              <Panel id="pc-store-conn" title="Store connections" helper="Source health and data freshness" className="min-h-[328px]">
                <GridTable className="mt-[13px]" rows={m.connections} columns={columns} rowKey={(r) => r.id} caption="Store connections" rowHeight={65} />
              </Panel>
              <Panel id="pc-store-assoc" title="Associated inventory" helper={m.sharingNote} className="min-h-[328px]">
                <PanelLines className="mt-[20px] gap-[17px]" lines={m.sharing} />
                <LinkButton to={consolePath.action(`review-sharing:${storeId}`)} className="mt-[60px] w-[300px] max-w-full">Review sharing permissions</LinkButton>
              </Panel>
            </div>
            <Panel id="pc-store-onboarding" title="Onboarding checklist" helper="Store identity → feed mapping → first import → price validation → publish authorization" className="min-h-[180px]">
              <StageStrip className="mt-[15px]" stages={m.checklist} label="Onboarding checklist" />
            </Panel>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, TextLink } from "@/components/platformConsole/ui";
import { GridTable, LinkButton, StateChip, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadStores, type StoreRowModel, type StoresModel } from "@/lib/platformConsole/live/stores";
import { consolePath } from "@/lib/platformConsole/sections";

const columns: GridColumn<StoreRowModel>[] = [
  { key: "store", header: "Store / group", width: "270px", render: (r) => r.name },
  { key: "account", header: "Account", width: "120px", chip: true, render: (r) => <StateChip tone={r.account.tone}>{r.account.label}</StateChip> },
  { key: "health", header: "Health", width: "140px", chip: true, render: (r) => <StateChip tone={r.health.tone}>{r.health.label}</StateChip> },
  { key: "published", header: "Published inventory", width: "200px", render: (r) => r.published },
  { key: "import", header: "Last successful import", width: "350px", render: (r) => r.lastImport },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function StoresView() {
  const view = useConsoleView<StoresModel>("stores", () => loadStores());
  return (
    <ConsoleFrame
      title="Stores & groups"
      subtitle="Account status, operating health and data access are separate."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <ViewBoundary view={view} what="stores">
        {(m) => (
          <>
            <MetricGrid metrics={m.metrics} label="Store summary" />
            <div className="flex justify-end">
              <LinkButton to={consolePath.action("add-store")} variant="primary" icon="plus" className="w-full justify-start md:w-[200px]">Add store / group</LinkButton>
            </div>
            {m.rows.length === 0 ? (
              <p className="text-[13px] text-[#52677C]">{m.rowsNote}</p>
            ) : (
              <GridTable className="-mt-[2px]" rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Stores and groups" rowHeight={72} />
            )}
            <Panel id="pc-ownership" title="Ownership and viewing permissions" helper="A shared vehicle remains owned by its source store; viewing does not authorize paid enrichment." className="-mt-[2px] min-h-[115px]">
              <span className="sr-only">Sharing is default deny; each relation is explicit.</span>
            </Panel>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

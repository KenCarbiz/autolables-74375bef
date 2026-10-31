import { useState } from "react";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Panel, TextLink } from "@/components/platformConsole/ui";
import { FilterSelect, FootNote, GridTable, StateChip, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadFeeds, type FeedActivityRow, type FeedsModel } from "@/lib/platformConsole/live/data";

const columns: GridColumn<FeedActivityRow>[] = [
  { key: "import", header: "Import / store", width: "255px", render: (r) => r.label },
  { key: "received", header: "File received", width: "215px", render: (r) => r.received },
  { key: "stage", header: "Stage", width: "170px", chip: true, render: (r) => <StateChip tone={r.stage.tone}>{r.stage.label}</StateChip> },
  { key: "rows", header: "Rows", width: "230px", render: (r) => r.rows },
  { key: "publication", header: "Publication", width: "270px", render: (r) => r.publication },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>Open import</TextLink> },
];

const WINDOWS = [
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
];

export default function FeedsView() {
  const [hours, setHours] = useState("24");
  const [store, setStore] = useState("all");
  const view = useConsoleView<FeedsModel>("feeds", () => loadFeeds(Number(hours)), { key: [hours] });
  return (
    <ConsoleFrame
      title="Feed activity"
      subtitle="Arrival, validation, import and publication have separate outcomes."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <div className="-mt-[2px] flex flex-wrap items-start gap-3">
        <FilterSelect label="Time window" value={hours} options={WINDOWS} onChange={setHours} className="w-[180px]" />
        <FilterSelect label="Store" value={store} options={[{ value: "all", label: "All stores" }, ...(view.data?.stores ?? []).map((s) => ({ value: s.id, label: s.name }))]} onChange={setStore} className="w-[180px]" />
        <span className="mt-[10px] inline-flex h-[26px] w-[260px] items-center rounded-[4px] bg-[#F4F6F9] px-[10px] text-[12px] font-bold text-[#075BE8] md:ml-auto md:mr-[48px]">No paid calls on refresh</span>
      </div>
      <ViewBoundary view={view} what="feed activity">
        {(m) => {
          const rows = store === "all" ? m.rows : m.rows.filter((r) => r.storeId === store);
          return (
            <>
              {rows.length === 0 ? <FootNote>{m.rowsNote}</FootNote> : <GridTable className="-mt-[2px]" rows={rows} columns={columns} rowKey={(r) => r.id} caption="Imports" rowHeight={76} />}
              <Panel id="pc-feeds-recon" title="Reconciliation" helper="File receipt and webhook acknowledgement are not completed imports." className="mt-[14px] min-h-[150px]">
                <p className="mt-[14px] text-[14px] leading-[20px] text-[#132A42]">{m.reconciliation}</p>
              </Panel>
            </>
          );
        }}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

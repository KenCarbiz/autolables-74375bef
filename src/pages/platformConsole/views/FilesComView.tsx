import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, StageStrip, TextLink, Timeline } from "@/components/platformConsole/ui";
import { FootNote, GridTable, LinkButton, StateChip, StickyActionBar, StickyBarSpacer, useIsCompact, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadFilesCom, type FeedRowModel, type FilesComModel } from "@/lib/platformConsole/live/connections";
import { consolePath } from "@/lib/platformConsole/sections";

const columns: GridColumn<FeedRowModel>[] = [
  { key: "folder", header: "Folder / feed", width: "355px", render: (r) => r.folder },
  { key: "owner", header: "Inventory owner", width: "190px", render: (r) => r.owner },
  { key: "viewers", header: "Allowed viewers", width: "310px", render: (r) => r.viewers },
  { key: "enrichment", header: "Enrichment", width: "300px", render: (r) => r.enrichment },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>Open mapping</TextLink> },
];

export default function FilesComView() {
  const compact = useIsCompact();
  const view = useConsoleView<FilesComModel>("files-com", () => loadFilesCom());
  return (
    <ConsoleFrame
      title={compact ? "Files.com" : "Files.com / Inventory feeds"}
      compact={compact}
      subtitle="Follow file receipt through published inventory. No secret values are displayed."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Connections", to: consolePath.connections() }]}
    >
      <ViewBoundary view={view} what="Files.com feed">
        {(m) => <FilesComBody m={m} compact={compact} />}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

function FilesComBody({ m, compact }: { m: FilesComModel; compact: boolean }) {
  const importHref = m.journey.importId ? consolePath.importRun(m.journey.importId) : consolePath.feeds();
  return (
    <>
      {compact ? (
        <div className="flex flex-col gap-[16px]">
          <Panel id="pc-fc-state" title="Connection state" helper="Configuration ≠ completed processing" className="min-h-[234px]">
            <ul className="-mx-1">
              {m.connectionState.map((c) => (
                <li key={c.label} className="flex h-[48px] items-center justify-between text-[13px]">
                  <span>{c.label}</span>
                  <StateChip tone={c.state.tone} className="w-[108px]">{c.state.label}</StateChip>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel id="pc-fc-journey" title="Latest file journey" helper={m.journey.subtitle} className="min-h-[420px]">
            <div className="-ml-1 mt-[13px]"><Timeline items={m.journey.steps} label="Latest file journey" /></div>
            <LinkButton to={importHref} variant="primary" className="-mx-1 mt-[22px] w-[calc(100%+8px)]">Open import</LinkButton>
          </Panel>
          <FootNote className="mt-[8px] text-[12px]">Secrets hidden · no paid calls on refresh</FootNote>
          <StickyBarSpacer compact />
          <StickyActionBar compact><LinkButton to={importHref} className="w-[174px]">View details</LinkButton></StickyActionBar>
        </div>

      ) : (
        <>
          <MetricGrid metrics={m.metrics} label="Files.com status" />
          <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
            <Panel id="pc-fc-details" title="Connection details" helper={m.details.site} className="min-h-[180px]">
              <p className="mt-[22px] text-[14px] leading-[20px] text-[#132A42]">{m.details.credential}</p>
              <p className="mt-[16px] text-[13px] leading-[18px] text-[#52677C]">{m.details.schedule}</p>
            </Panel>
            <Panel id="pc-fc-controls" title="Safe controls" helper="Running and promoting data are separate" className="min-h-[180px]">
              <LinkButton to={consolePath.action("diagnostic.filescom")} className="mt-[20px] w-[184px]">Review diagnostic</LinkButton>
              <p className="mt-[14px] text-[12px] leading-[16px] text-[#52677C]">{m.controlsNote}</p>
            </Panel>
          </div>
          <StageStrip stages={m.stages} label="File path stages" />
          {m.feeds.length === 0 ? (
            <FootNote>{m.feedsNote}</FootNote>
          ) : (
            <GridTable className="mt-[4px]" rows={m.feeds} columns={columns} rowKey={(r) => r.id} caption="Folders and feeds" rowHeight={66} />
          )}
        </>
      )}
    </>
  );
}

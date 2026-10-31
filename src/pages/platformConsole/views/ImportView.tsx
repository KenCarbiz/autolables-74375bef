import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Panel, StageStrip } from "@/components/platformConsole/ui";
import { FootNote, GridTable, LinkButton, PanelLines, StateChip, StickyActionBar, StickyBarSpacer, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadImport, type FindingRow, type ImportModel } from "@/lib/platformConsole/live/data";
import { consolePath } from "@/lib/platformConsole/sections";
import { useConsoleParams } from "../PlatformConsole";

const columns: GridColumn<FindingRow>[] = [
  { key: "finding", header: "Finding", width: "280px", render: (r) => r.finding },
  { key: "field", header: "Source field", width: "250px", render: (r) => r.field },
  { key: "effect", header: "Effect", width: "minmax(0,1fr)", render: (r) => r.effect },
];

export default function ImportView() {
  const { importId = "" } = useConsoleParams();
  const view = useConsoleView<ImportModel>("import", () => loadImport(importId), { key: [importId] });
  return (
    <ConsoleFrame
      title={view.data?.title ?? "Import"}
      subtitle={view.data?.subtitle ?? "Arrival, validation, import and publication have separate outcomes."}
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Feed activity", to: consolePath.feeds() }]}
    >
      <ViewBoundary view={view} what="import">
        {(m) => <ImportBody m={m} />}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

function ImportBody({ m }: { m: ImportModel }) {
  const replay = consolePath.action(`replay-import.${m.runId}`);
  const evidenceLink = consolePath.audit();
  const phoneEvidence = m.phoneEvidence ?? m.evidence;
  return (
    <>
      {/* Phone reference: findings and evidence as cards, actions stacked. */}
      <div className="flex flex-col gap-[16px] md:hidden">
        {m.banner && <StateChip tone={m.banner.tone} className="w-fit">{m.banner.text}</StateChip>}
        <Panel id="pc-imp-find-m" title="Validation findings" className="min-h-[251px]">
          {m.findings.length === 0 ? (
            <p className="-mx-1 mt-[18px] text-[13px] text-[#52677C]">{m.findingsNote}</p>
          ) : (
            <ul className="-mx-1 mt-[20px]">
              {m.findings.map((f) => (
                <li key={f.id} className="border-b border-[#D7E1ED] pb-[20px] pt-[0px] [&:not(:first-child)]:mt-[33px] last:border-b-0">
                  <p className="text-[14px] font-bold leading-[20px] text-[#132A42]">{f.phoneTitle ?? f.finding}</p>
                  <p className="mt-[6px] text-[13px] leading-[18px] text-[#52677C]">{f.phoneDetail ?? `${f.field} · ${f.effect}`}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="pc-imp-evid-m" title="Impact and evidence" className="min-h-[275px]">
          <PanelLines small className="-mx-1 mt-[26px] gap-[19px]" lines={phoneEvidence.map((t) => ({ text: t }))} />
          <LinkButton to={evidenceLink} className="-mx-1 mt-[22px] w-[calc(100%+8px)]">Inspect sanitized evidence</LinkButton>
        </Panel>
        <div className="mt-[8px] flex flex-col gap-3">
          <LinkButton to={consolePath.mapping()} variant="primary">Review mapping</LinkButton>
          <LinkButton to={replay} className="-mt-1">Preview replay</LinkButton>
        </div>
        <StickyBarSpacer />
        <StickyActionBar><LinkButton to={consolePath.feeds()} className="w-[174px]">View details</LinkButton></StickyActionBar>
      </div>

      <div className="hidden md:contents">
        <StageStrip stages={m.stages} label="Import stages" />
        <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
          <Panel id="pc-imp-find" title="Validation findings" helper={m.findingsNote} className="min-h-[305px]">
            {m.findings.length === 0 ? (
              <FootNote className="mt-6">No findings are recorded for this run.</FootNote>
            ) : (
              <GridTable className="mt-[13px]" rows={m.findings} columns={columns} rowKey={(r) => r.id} caption="Validation findings" rowHeight={72} />
            )}
          </Panel>
          <Panel id="pc-imp-evid" title="Import evidence" helper={m.evidenceNote} className="min-h-[305px]">
            <PanelLines small className="mt-[28px] gap-[17px]" lines={m.evidence.map((t) => ({ text: t }))} />
            <LinkButton to={evidenceLink} className="mt-[32px] w-[280px] max-w-full">Inspect sanitized evidence</LinkButton>
          </Panel>
        </div>
        <Panel id="pc-imp-next" title="Next action" helper="Correct the mapping, validate the retained file, then review a replay." className="min-h-[240px]">
          <div className="mt-[17px] flex flex-wrap gap-3">
            <LinkButton to={consolePath.mapping()} variant="primary" icon="edit" className="w-[190px]">Review mapping</LinkButton>
            <LinkButton to={replay} icon="retry" className="w-[210px]">Preview replay</LinkButton>
          </div>
          <FootNote className="mt-[40px]">Replay requires current permissions, idempotency and a fresh impact preview.</FootNote>
        </Panel>
      </div>
    </>
  );
}

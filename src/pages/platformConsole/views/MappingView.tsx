import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Panel, StageStrip, TextLink } from "@/components/platformConsole/ui";
import { FootNote, GridTable, LinkButton, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadMapping, type MappingModel, type MappingRule } from "@/lib/platformConsole/live/connections";
import { consolePath } from "@/lib/platformConsole/sections";

const columns: GridColumn<MappingRule>[] = [
  { key: "source", header: "Source column", width: "260px", render: (r) => r.source },
  { key: "normalized", header: "Normalized field", width: "260px", render: (r) => r.normalized },
  { key: "transform", header: "Transform / validation", width: "440px", render: (r) => r.transform },
  { key: "required", header: "Required", width: "190px", render: (r) => r.required },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: () => <TextLink to={consolePath.action("mapping-draft.rule")}>Inspect rule</TextLink> },
];

export default function MappingView() {
  const view = useConsoleView<MappingModel>("mapping", () => loadMapping());
  return (
    <ConsoleFrame
      title="Feed routing & mappings"
      subtitle="Source folder → inventory owner → authorized viewers → enrichment scope."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
      breadcrumbs={[{ label: "Connections", to: consolePath.connections() }]}
    >
      <ViewBoundary view={view} what="feed mapping">
        {(m) => (
          <>
            <Panel id="pc-map-own" title="Source ownership" helper="Unknown or conflicting rooftop IDs are quarantined; never infer ownership from a filename alone." className="min-h-[190px]">
              <StageStrip className="mt-[11px]" stages={m.ownership} label="Source ownership chain" />
            </Panel>
            {m.rules.length === 0 ? (
              <Card note={m.rulesNote} />
            ) : (
              <GridTable rows={m.rules} columns={columns} rowKey={(r) => r.id} caption="Column mapping rules" rowHeight={72} />
            )}
            <div className="flex flex-wrap gap-3">
              <LinkButton to={consolePath.action("validate-sample.mapping")} className="w-[230px]">Validate sample locally</LinkButton>
              <LinkButton to={consolePath.action("mapping-draft.draft")} variant="primary" className="w-[220px]">Review mapping draft</LinkButton>
            </div>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

const Card = ({ note }: { note: string }) => <FootNote className="rounded-[6px] border border-[#D7E1ED] bg-white p-5">{note}</FootNote>;

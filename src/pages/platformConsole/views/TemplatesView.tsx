import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Panel, StageStrip, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { Pill, RefTable } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadTemplates, type TemplateRow, type TemplatesModel } from "@/lib/platformConsole/live/templates";

const columns: Column<TemplateRow>[] = [
  { key: "name", header: "Template", width: "360px", render: (r) => r.name },
  { key: "version", header: "Published version", width: "220px", render: (r) => r.version },
  { key: "validation", header: "Validation", width: "200px", render: (r) => <Pill tone={r.validation.tone}>{r.validation.label}</Pill> },
  { key: "failures", header: "Recent failures", width: "340px", render: (r) => r.failures },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function TemplatesView() {
  const view = useConsoleView<TemplatesModel>("templates", () => loadTemplates());
  const m = view.data;
  return (
    <ConsoleFrame title="Documents & templates" subtitle="Versioned publishing with output validation and QR destination checks." onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="templates" />
      ) : (
        <>
          <RefTable rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Templates and validation" rowHeight={82} emptyNote={m.rowsNote} />
          <Panel id="pc-tpl-safe" title="Publishing safeguards" helper={m.safeguardsHelper} className="mt-[22px] min-h-[250px]">
            <StageStrip className="mt-[16px]" stages={m.stages} label="Publishing steps" />
          </Panel>
        </>
      )}
    </ConsoleFrame>
  );
}

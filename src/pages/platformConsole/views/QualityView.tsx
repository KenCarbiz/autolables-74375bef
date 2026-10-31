import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, TextLink } from "@/components/platformConsole/ui";
import { FootNote, GridTable, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadQuality, type QualityIssue, type QualityModel } from "@/lib/platformConsole/live/data";

const columns: GridColumn<QualityIssue>[] = [
  { key: "issue", header: "Issue", width: "290px", render: (r) => r.issue },
  { key: "store", header: "Store", width: "160px", render: (r) => r.store },
  { key: "affected", header: "Affected", width: "170px", render: (r) => r.affected },
  { key: "impact", header: "Downstream impact", width: "490px", render: (r) => r.impact },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function QualityView() {
  const view = useConsoleView<QualityModel>("quality", () => loadQuality());
  return (
    <ConsoleFrame
      title="Data quality"
      subtitle="Show missing data, conflicts and schema changes before calculations use them."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <ViewBoundary view={view} what="data quality">
        {(m) => (
          <>
            <MetricGrid metrics={m.metrics} label="Data quality" />
            {m.issues.length === 0 ? <FootNote className="rounded-[6px] border border-[#D7E1ED] bg-white p-5">{m.issuesNote}</FootNote> : <GridTable rows={m.issues} columns={columns} rowKey={(r) => r.id} caption="Data quality issues" rowHeight={76} />}
            <FootNote className="mt-[12px]">{m.footnote}</FootNote>
          </>
        )}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

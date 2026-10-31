import { useState } from "react";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { TextLink } from "@/components/platformConsole/ui";
import { FootNote, GridTable, LinkButton, StateChip, ViewBoundary, type GridColumn } from "@/components/platformConsole/uiA";
import { cn } from "@/lib/utils";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadConnections, type ConnectionRow, type ConnectionsModel } from "@/lib/platformConsole/live/connections";
import { consolePath } from "@/lib/platformConsole/sections";

const columns: GridColumn<ConnectionRow>[] = [
  { key: "name", header: "Connection / purpose", width: "280px", render: (r) => r.name },
  { key: "config", header: "Configuration", width: "160px", chip: true, render: (r) => <StateChip tone={r.configuration.tone}>{r.configuration.label}</StateChip> },
  { key: "op", header: "Observed operation", width: "220px", chip: true, render: (r) => <StateChip tone={r.operation.tone}>{r.operation.label}</StateChip> },
  { key: "scope", header: "Scope", width: "260px", render: (r) => r.scope },
  { key: "checked", header: "Last checked", width: "235px", render: (r) => r.lastChecked },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

const needsAttention = (r: ConnectionRow) => r.operation.tone === "warn" || r.operation.tone === "bad" || r.configuration.tone === "bad" || r.operation.label === "Not monitored" || r.operation.label === "Unknown";

type Filter = "all" | "attention";
const FILTERS: { id: Filter; label: string; width: string }[] = [
  { id: "all", label: "All connections", width: "w-[200px]" },
  { id: "attention", label: "Needs attention", width: "w-[180px]" },
];

export default function ConnectionsView() {
  const view = useConsoleView<ConnectionsModel>("connections", () => loadConnections());
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <ConsoleFrame
      title="Connections"
      subtitle="Configuration is not proof of successful data delivery."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <ViewBoundary view={view} what="connections">
        {(m) => {
          const rows = filter === "attention" ? m.rows.filter(needsAttention) : m.rows;
          return (
            <>
              <div className="-mt-[2px] flex flex-wrap items-start justify-between gap-3">
                <div role="group" aria-label="Connection filter" className="flex gap-3">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={filter === f.id}
                      onClick={() => setFilter(f.id)}
                      className={cn("h-11 rounded-[6px] border bg-white px-[14px] text-left text-[13px] font-bold text-[#132A42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]", filter === f.id ? "border-[#075BE8]" : "border-[#D7E1ED]", f.width)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <LinkButton to={consolePath.action("add-connection.new")} variant="primary" icon="plus" className="w-[190px]">Add connection</LinkButton>
              </div>
              {rows.length === 0 ? <FootNote>No connections need attention.</FootNote> : <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Connections" rowHeight={66} />}
              <FootNote className="-mt-[3px]">{m.note}</FootNote>
            </>
          );
        }}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

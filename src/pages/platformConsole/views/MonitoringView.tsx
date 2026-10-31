import { useEffect, useState } from "react";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { FootNote, Pill, RefTable, StateBanner } from "@/components/platformConsole/uiB";
import { useConsoleFixture, useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadMonitoring, type MonitoringModel, type MonitoringRow } from "@/lib/platformConsole/live/monitoring";

const columns: Column<MonitoringRow>[] = [
  { key: "workflow", header: "Workflow", width: "420px", render: (r) => r.workflow },
  { key: "coverage", header: "Coverage", width: "240px", render: (r) => <Pill tone={r.coverage.tone}>{r.coverage.label}</Pill> },
  { key: "signal", header: "Last signal", width: "300px", render: (r) => r.lastSignal },
  { key: "next", header: "Next action", width: "minmax(0,1fr)", render: (r) => (r.next.href ? <TextLink to={r.next.href}>{r.next.label}</TextLink> : r.next.label) },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export default function MonitoringView() {
  const view = useConsoleView<MonitoringModel>("monitoring", () => loadMonitoring());
  const fixture = useConsoleFixture();
  const online = useOnline();
  const disconnected = fixture ? fixture.connection === "disconnected" : !online;
  const m = view.data;
  return (
    <ConsoleFrame title="Monitoring coverage" subtitle="Unknown and not monitored are visible states, never green by default." onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="monitoring" />
      ) : (
        <>
          {disconnected ? (
            <StateBanner tone="warn" icon="warning" title="Live updates disconnected">Last verified state {m.lastVerified}. Reconnecting; values may be stale.</StateBanner>
          ) : m.unavailable ? (
            <StateBanner tone="info" icon="info" title="Monitoring not available">No successful measurement. This is unknown, not healthy.</StateBanner>
          ) : (
            <MetricGrid metrics={m.metrics} label="Monitoring coverage" />
          )}
          <RefTable rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Workflow monitoring coverage" rowHeight={74} />
          <FootNote className="mt-[10px]">{m.note}</FootNote>
        </>
      )}
    </ConsoleFrame>
  );
}

import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Chip, DataTable, MetricGrid, Panel, StageStrip, TextLink, Timeline, ViewState, type Column } from "@/components/platformConsole/ui";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { useConsoleNow, useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadOverview, type OverviewModel } from "@/lib/platformConsole/live/overview";
import { relativeAge } from "@/lib/platformConsole/live/read";
import type { AttentionRow, Severity, Tone } from "@/lib/platformConsole/types";
import { Link } from "react-router-dom";

const SEVERITY_TONE: Record<Severity, Tone> = { high: "bad", medium: "warn", low: "info" };
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

const columns: Column<AttentionRow>[] = [
  { key: "impact", header: "Impact / store", width: "190px", render: (r) => <Chip tone={SEVERITY_TONE[r.severity]}>{SEVERITY_LABEL[r.severity]} · {r.store}</Chip> },
  { key: "issue", header: "Issue", width: "minmax(0,1fr)", render: (r) => r.issue },
  { key: "age", header: "Age", width: "95px", render: (r) => r.age },
  { key: "action", header: "Action", width: "124px", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function OverviewView() {
  const now = useConsoleNow();
  const view = useConsoleView<OverviewModel>("overview", () => loadOverview());
  const updated = view.updatedAt ? relativeAge(new Date(view.updatedAt).toISOString(), now) : null;

  return (
    <ConsoleFrame
      title="Platform overview"
      subtitle="Customer impact first. Every warning opens the affected store, run or vehicle."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      {view.status !== "ready" || !view.data ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="platform overview" />
      ) : (
        <OverviewBody model={view.data} updated={view.isFixture ? "12 seconds ago" : updated === "Just now" ? "just now" : `${updated} ago`} />
      )}
    </ConsoleFrame>
  );
}

function OverviewBody({ model, updated }: { model: OverviewModel; updated: string }) {
  const channel = model.liveChannel === "connected" ? "connected" : model.liveChannel === "polling" ? "refreshes on request" : "disconnected; showing last known data";
  return (
    <>
      <MetricGrid metrics={model.metrics} label="Platform status" />

      {/* Phone: compact cards replace the table. */}
      <section aria-labelledby="pc-attn-m" className="rounded-[8px] border border-[#D7E1ED] bg-white px-5 pb-5 pt-[19px] md:hidden">
        <h2 id="pc-attn-m" className="text-[17px] font-bold leading-[22px]">Needs attention</h2>
        <p className="mt-[6px] text-[12px] text-[#52677C]">Highest customer impact first</p>
        {model.attention.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#52677C]">{model.attentionNote}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-[22px]">
            {model.attention.map((r) => (
              <li key={r.id} className="flex gap-[10px]">
                <ConsoleIcon name="warning" size={20} className={r.severity === "high" ? "text-[#B42332]" : "text-[#885608]"} />
                <div>
                  <p className="text-[13px] font-bold">{r.store} · {r.issue}</p>
                  <p className="mt-1 text-[12px] text-[#52677C]">{r.detail ?? r.age}</p>
                  <Link to={r.href} className="mt-2 inline-flex min-h-[24px] items-center text-[12px] font-bold text-[#075BE8]">Inspect issue →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
        <Panel id="pc-attn" title="Needs attention" helper="Sorted by customer impact · acknowledging does not resolve the fault" className="hidden min-h-[358px] md:block">
          {model.attention.length === 0 ? (
            <p className="mt-6 text-[13px] text-[#52677C]">{model.attentionNote}</p>
          ) : (
            <DataTable className="mt-[13px]" rows={model.attention} columns={columns} rowKey={(r) => r.id} caption="Needs attention" />
          )}
        </Panel>
        <Panel id="pc-live" title="Live operations" helper={`Updated ${updated} · ${channel}`} className="min-h-[358px]">
          <div className="mt-[24px] pl-[10px]">
            {model.operations.length === 0 ? <p className="text-[13px] text-[#52677C]">{model.operationsNote}</p> : <Timeline items={model.operations} label="Recent operations" />}
          </div>
        </Panel>
      </div>

      <Panel id="pc-path" title="Data path health" helper={model.stagesNote} className="hidden min-h-[160px] !pb-[18px] md:block">
        <StageStrip className="mt-[6px]" stages={model.stages} label="Data path stages" />
      </Panel>
    </>
  );
}

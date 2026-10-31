import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Chip, DataTable, MetricCard, MetricGrid, Panel, StageStrip, TextLink, Timeline, ViewState, type Column } from "@/components/platformConsole/ui";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { PhoneActionBar } from "@/components/platformConsole/uiB";
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
  const phoneAttention = model.phone?.attention ?? model.attention.map((r) => ({ id: r.id, title: `${r.store} · ${r.issue}`, detail: r.detail ?? r.age, tone: (r.severity === "high" ? "bad" : "warn") as Tone, href: r.href }));
  const phoneOperations = model.phone?.operations ?? model.operations;
  const lead = model.metrics[0];
  return (
    <>
      {/* Phone: one lead metric and compact cards; the full grid and table start at md. */}
      <div className="flex flex-col gap-4 pb-24 md:hidden">
        <MetricCard metric={model.phone ? { ...lead, helper: model.phone.metricHelper } : lead} />
        <section aria-labelledby="pc-attn-m" className="rounded-[8px] border border-[#D7E1ED] bg-white px-4 pb-[35px] pt-[15px]">
          <h2 id="pc-attn-m" className="px-1 text-[17px] font-bold leading-[22px]">Needs attention</h2>
          <p className="mt-[6px] px-1 text-[12px] leading-[16px] text-[#52677C]">Highest customer impact first</p>
          {phoneAttention.length === 0 ? (
            <p className="mt-4 text-[13px] text-[#52677C]">{model.attentionNote}</p>
          ) : (
            <ul className="mt-[11px] flex flex-col gap-[14px]">
              {phoneAttention.map((r) => (
                <li key={r.id} className="flex gap-[10px]">
                  <ConsoleIcon name="warning" size={20} className={r.tone === "bad" ? "text-[#B42332]" : "text-[#885608]"} />
                  <div>
                    <p className="text-[13px] font-bold leading-[18px]">{r.title}</p>
                    <p className="mt-[7px] text-[12px] leading-[16px] text-[#52677C]">{r.detail}</p>
                    <Link to={r.href} className="-mb-[10px] mt-[5px] inline-flex min-h-[44px] items-start pt-[4px] text-[12px] font-bold text-[#075BE8]">Inspect issue →</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="pc-live-m" className="rounded-[8px] border border-[#D7E1ED] bg-white px-4 pb-3 pt-[15px]">
          <h2 id="pc-live-m" className="px-1 text-[17px] font-bold leading-[22px]">Live operations</h2>
          <p className="mt-[6px] px-1 text-[12px] leading-[16px] text-[#52677C]">Updated {updated}</p>
          <div className="mt-[17px]">
            {phoneOperations.length === 0 ? <p className="text-[13px] text-[#52677C]">{model.operationsNote}</p> : <Timeline items={phoneOperations} label="Recent operations" />}
          </div>
        </section>
        <PhoneActionBar note="Read-only monitoring by default" detailsTitle="Platform overview" detailsSummary="Open an affected record. Nothing here changes data.">
          {phoneAttention.map((r) => <Link key={r.id} to={r.href} className="flex min-h-11 items-center rounded-[6px] border border-[#D7E1ED] px-3 text-[13px] font-bold text-[#075BE8]">{r.title}</Link>)}
        </PhoneActionBar>
      </div>

      <div className="hidden md:block"><MetricGrid metrics={model.metrics} label="Platform status" /></div>

      <div className="hidden grid-cols-1 gap-[22px] md:grid xl:grid-cols-[minmax(0,860fr)_minmax(0,438fr)]">
        <Panel id="pc-attn" title="Needs attention" helper="Sorted by customer impact · acknowledging does not resolve the fault" className="min-h-[358px]">
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

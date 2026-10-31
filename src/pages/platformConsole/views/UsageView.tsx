import { Link } from "react-router-dom";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { Card, MetricCard, MetricGrid, Panel, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { PhoneActionBar, Pill, RefTable, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadUsage, type UsageModel, type UsageRow } from "@/lib/platformConsole/live/usage";

const columns: Column<UsageRow>[] = [
  { key: "provider", header: "Provider / purpose", width: "330px", render: (r) => r.provider },
  { key: "usage", header: "Month usage", width: "210px", render: (r) => r.usage },
  { key: "budget", header: "Budget state", width: "200px", render: (r) => <Pill tone={r.budget.tone} plain={r.budget.plain}>{r.budget.label}</Pill> },
  { key: "basis", header: "Cost basis", width: "370px", render: (r) => r.basis },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function UsageView() {
  const view = useConsoleView<UsageModel>("usage", () => loadUsage());
  const m = view.data;
  return (
    <ConsoleFrame title={m?.title ?? "Usage & billing"} subtitle={m?.subtitle ?? "Measured usage, cost estimates and invoices are separate records."} onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="usage" />
      ) : (
        <UsageBody m={m} />
      )}
    </ConsoleFrame>
  );
}

function UsageBody({ m }: { m: UsageModel }) {
  const lead = m.metrics[0];
  return (
    <>
      {/* Phone */}
      <div className="flex flex-col gap-4 pb-24 md:hidden">
        <MetricCard metric={{ ...lead, helper: m.phone.metricHelper }} />
        <Card className="px-4 pb-[30px] pt-[15px]" aria-label="Provider budgets">
          <h2 className="px-1 text-[17px] font-bold leading-[22px]">Provider budgets</h2>
          <p className="mt-[6px] px-1 text-[12px] leading-[16px] text-[#52677C]">{m.phone.budgetsHelper}</p>
          {m.rows.length === 0 ? (
            <p className="mt-4 text-[13px] text-[#52677C]">{m.rowsNote}</p>
          ) : (
            <ul className="mt-[11px] flex flex-col gap-[9px]">
              {m.rows.map((r) => (
                <li key={r.id}>
                  <p className="text-[14px] font-bold leading-[20px]">{r.phoneName ?? r.provider}</p>
                  <div className="mt-[11px]"><Pill tone={r.budget.tone} plain={r.budget.plain}>{r.budget.label}</Pill></div>
                  <Link to={r.href} className="-my-[14px] mt-[0px] flex min-h-[44px] items-center text-[12px] text-[#075BE8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#075BE8]">Inspect usage and limit →</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="px-4 pb-5 pt-[15px]" aria-label="Unmeasured is not zero">
          <h2 className="px-1 text-[17px] font-bold leading-[22px]">Unmeasured is not zero</h2>
          <p className="mt-[6px] px-1 text-[12px] leading-[16px] text-[#52677C]">{m.phone.unmeasuredHelper}</p>
          <p className="mt-[34px] text-[12px] leading-[16px]">{m.phone.unmeasuredLines[0]}</p>
          <p className="mt-[24px] text-[12px] leading-[16px] text-[#52677C]">{m.phone.unmeasuredLines[1]}</p>
        </Card>
        <PhoneActionBar note="Read-only monitoring by default" detailsTitle="Usage and limits" detailsSummary="Limits and alerts are reviewed before any change. Refresh never starts a paid request.">
          <ReviewAction kind="budget_review" scope="provider-budgets" label="Review limits & alerts" title="Review limits and alerts" summary="Review the caps and alert thresholds for provider budgets. Nothing is changed by this review." className="w-full justify-start" />
        </PhoneActionBar>
      </div>

      {/* Desktop and tablet */}
      <div className="hidden flex-col gap-[22px] md:flex">
        <MetricGrid metrics={m.metrics} label="Usage and cost" />
        <RefTable rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Provider usage and budgets" rowHeight={72} emptyNote={m.rowsNote} />
        <Panel id="pc-usage-policy" title="Budget policy" helper={m.policyHelper} className="min-h-[180px]">
          <p className="mt-[17px] text-[14px] leading-[20px]">{m.policyText}</p>
          <div className="mt-[11px] flex justify-end pr-2">
            <ReviewAction kind="budget_review" scope="provider-budgets" label="Review limits & alerts" title="Review limits and alerts" summary="Review the caps and alert thresholds for provider budgets. Nothing is changed by this review." className="w-[270px] justify-start" />
          </div>
        </Panel>
      </div>
    </>
  );
}

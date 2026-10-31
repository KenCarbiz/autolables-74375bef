import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { MetricGrid, Panel, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { Pill, RefTable, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadBilling, type BillingModel, type BillingRow } from "@/lib/platformConsole/live/billing";

const columns: Column<BillingRow>[] = [
  { key: "store", header: "Store", width: "220px", render: (r) => r.store },
  { key: "billing", header: "Billing state", width: "200px", render: (r) => <Pill tone={r.billing.tone} plain={r.billing.plain}>{r.billing.label}</Pill> },
  { key: "entitlement", header: "Effective entitlement", width: "300px", render: (r) => r.entitlement },
  { key: "override", header: "Override", width: "390px", render: (r) => r.override },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function BillingView() {
  const view = useConsoleView<BillingModel>("billing", () => loadBilling());
  const m = view.data;
  return (
    <ConsoleFrame title="Billing & effective access" subtitle="AutoCurb billing authority · AutoLabels effective entitlements" onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="billing" />
      ) : (
        <>
          <MetricGrid metrics={m.metrics} label="Billing and entitlements" />
          <RefTable rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Subscription state and effective entitlements" rowHeight={82} emptyNote={m.rowsNote} />
          <Panel id="pc-bill-safe" title="Reconciliation safeguards" helper={m.safeguardsHelper} className="mt-[16px] min-h-[200px]">
            <p className="mt-[17px] text-[14px] leading-[20px]">{m.safeguardsText}</p>
            <div className="mt-[21px] flex justify-end pr-2">
              <ReviewAction kind="entitlement_reconcile" scope="billing-reconciliation" label="Preview reconciliation" title="Preview reconciliation" summary="Compares the billing authority with effective entitlements. The preview changes nothing; applying a change needs a separate reviewed action with an override reason and expiration." className="w-[310px] justify-start" submitLabel="Request preview" />
            </div>
          </Panel>
        </>
      )}
    </ConsoleFrame>
  );
}

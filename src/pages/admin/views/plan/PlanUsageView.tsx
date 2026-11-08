import { useSearchParams } from "react-router-dom";
import { ScopeLabel } from "@/components/admin/v3/editor";
import { CompareDrawer, CurrentPlanCard, FeatureGroups, LimitsAndQuotas, MetricCards, MetricDrawer } from "./PlanParts";
import { usePlanData } from "./usePlanData";

export type { PlanFixture } from "./usePlanData";

// Plan & Usage. Read only: it shows the entitlement and the usage events the
// app already holds. It starts no checkout, calls no provider and writes nothing.

export default function PlanUsageView() {
  const state = usePlanData();
  const [params, setParams] = useSearchParams();
  const panel = params.get("panel");
  const metricKey = panel?.startsWith("metric-") ? panel.slice(7) : null;
  const metric = metricKey ? state.metrics.find((m) => m.spec.key === metricKey) ?? null : null;

  const setPanel = (next: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (next) n.set("panel", next);
      else n.delete("panel");
      return n;
    }, { replace: true });

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
      </div>
      <CurrentPlanCard
        plan={state.plan}
        unreadable={state.entitlementUnreadable}
        loading={state.loading}
        canManageBilling={state.canManageBilling}
        canManageInvoices={state.canManageInvoices}
        timeZone={state.timeZone}
        onCompare={() => setPanel("compare")}
      />
      <MetricCards metrics={state.metrics} usage={state.usage} plan={state.plan} onOpen={(k) => setPanel(`metric-${k}`)} />
      <LimitsAndQuotas metrics={state.metrics} />
      <FeatureGroups groups={state.features} />
      <CompareDrawer open={panel === "compare"} onClose={() => setPanel(null)} current={state.plan} />
      <MetricDrawer metric={metric} usage={state.usage} onClose={() => setPanel(null)} />
    </div>
  );
}

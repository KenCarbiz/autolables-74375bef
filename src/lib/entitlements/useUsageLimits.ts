import { useCallback, useEffect, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useFeatureGate } from "./useFeatureGate";
import { getTenantUsage, quotaState, limitFor, type MetricKey, type QuotaState } from "./usage";

// Tenant usage this month + quota interpretation against the active plan.
export function useUsageLimits() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const { plan } = useFeatureGate();
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    const u = await getTenantUsage(tenantId);
    setUsage(u);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const used = useCallback((m: MetricKey) => usage[m] || 0, [usage]);
  const state = useCallback((m: MetricKey): QuotaState => quotaState(plan, m, usage[m] || 0), [plan, usage]);
  // True when the action is allowed (not hard-blocked).
  const canUseQuotaFeature = useCallback((m: MetricKey) => state(m) !== "blocked", [state]);

  return { plan, usage, used, state, canUseQuotaFeature, limitFor: (m: MetricKey) => limitFor(plan, m), loading, reload: load };
}

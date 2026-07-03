import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Sidebar worklist counts. Fetched once on mount and re-read on every route
// change (mirrors AppShell's MarketCheck refresh pattern). Every query fails
// silent to 0 so a missing table/migration never breaks navigation.

export interface NavBadgeCounts {
  workQueue: number;
  leads: number;
  reconApprovals: number;
  priceChangeReview: number;
  complianceTasks: number;
  returns: number;
}

const ZERO: NavBadgeCounts = {
  workQueue: 0,
  leads: 0,
  reconApprovals: 0,
  priceChangeReview: 0,
  complianceTasks: 0,
  returns: 0,
};

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

const safeCount = async (build: () => PromiseLike<{ count: number | null }>): Promise<number> => {
  try {
    const { count } = await build();
    return count || 0;
  } catch {
    return 0;
  }
};

export const useNavBadges = (): NavBadgeCounts => {
  const { tenant, currentStore } = useTenant();
  const location = useLocation();
  const [counts, setCounts] = useState<NavBadgeCounts>(ZERO);
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const storeId = currentStore?.id || null;

  const load = useCallback(async () => {
    if (!tenantId) {
      setCounts(ZERO);
      return;
    }
    const [vinQueue, workItems, leads, reconApprovals, priceChangeReview, returns, complianceTasks] = await Promise.all([
      // RLS scopes vin_queue to the tenant.
      safeCount(() => sb().from("vin_queue").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"])),
      safeCount(() =>
        sb()
          .from("dealer_work_items")
          .select("id", { count: "exact", head: true })
          .or(`tenant_id.eq.${tenantId},store_id.eq.${tenantId}`)
          .in("status", ["open", "needs_approval"])
      ),
      storeId
        ? safeCount(() => sb().from("leads").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "new"))
        : Promise.resolve(0),
      safeCount(() => sb().from("recon_estimates").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "submitted")),
      safeCount(() => sb().from("stale_document_flags").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open")),
      safeCount(() => sb().from("addendum_signings").select("id", { count: "exact", head: true }).eq("return_status", "requested")),
      // Latest certification run per vehicle, counted not-ready. Bounded read
      // (3 columns, recent rows) rather than the action center's full 750-row
      // pull, since this runs on every route change.
      (async () => {
        try {
          const { data } = await sb()
            .from("ct_mvp_certification_runs")
            .select("vehicle_id, vin, ready")
            .eq("tenant_id", tenantId)
            .order("certified_at", { ascending: false })
            .limit(300);
          const seen = new Set<string>();
          let open = 0;
          for (const row of (data || []) as { vehicle_id: string | null; vin: string | null; ready: boolean | null }[]) {
            const key = row.vehicle_id || row.vin || "";
            if (!key || seen.has(key)) continue;
            seen.add(key);
            if (!row.ready) open += 1;
          }
          return open;
        } catch {
          return 0;
        }
      })(),
    ]);
    setCounts({ workQueue: vinQueue + workItems, leads, reconApprovals, priceChangeReview, complianceTasks, returns });
  }, [tenantId, storeId]);

  useEffect(() => {
    load();
  }, [load, location.pathname]);

  return counts;
};

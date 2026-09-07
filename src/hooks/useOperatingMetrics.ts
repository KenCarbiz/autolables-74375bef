import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// useOperatingMetrics — the one source for tenant operating counts.
//
// Every screen used to derive its own, which is how the dashboard came to
// claim 196 vehicles in recon against 134 active vehicles: it counted
// get_ready_records, whose rows are write-once in practice and so accumulate
// every vehicle that ever entered Get Ready, sold ones included.
//
// The server function counts UNIQUE VEHICLES against vehicle_lifecycle, the
// canonical 22-state machine. Do not add a competing derivation here; add the
// metric to public.operating_metrics so every screen inherits it.

export interface OperatingMetrics {
  /** Still on the lot: status <> 'archived'. Never published_at, which stays set on sold cars. */
  activeInventory: number;
  /** Live on the shopper site. Separate concept from active inventory. */
  publishedInventory: number;
  newInventory: number;
  usedInventory: number;
  /** Used/CPO vehicles inside the physical Get Ready lifecycle. */
  inGetReady: number;
  getReadyIntake: number;
  getReadyService: number;
  getReadyPrep: number;
  getReadyVerified: number;
  getReadyRecon: number;
  /** Sitting at the manager gate, which recompute cannot advance on its own. */
  awaitingAuthorization: number;
  retailReady: number;
  gated: number;
  /** Non-zero means a used vehicle is missing its lifecycle row — a real defect. */
  usedMissingLifecycle: number;
}

const EMPTY: OperatingMetrics = {
  activeInventory: 0, publishedInventory: 0, newInventory: 0, usedInventory: 0,
  inGetReady: 0, getReadyIntake: 0, getReadyService: 0, getReadyPrep: 0,
  getReadyVerified: 0, getReadyRecon: 0, awaitingAuthorization: 0,
  retailReady: 0, gated: 0, usedMissingLifecycle: 0,
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function useOperatingMetrics(tenantId?: string | null) {
  const [metrics, setMetrics] = useState<OperatingMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) { setMetrics(EMPTY); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await (supabase as any)
      .rpc("operating_metrics", { p_tenant_id: tenantId });
    if (err) {
      // Surface the failure rather than rendering zeros as if the lot were
      // empty: a silent 0 here reads as "nothing to do today".
      setError(err.message ?? "metrics unavailable");
      setMetrics(EMPTY);
      setLoading(false);
      return;
    }
    const d = (data || {}) as Record<string, unknown>;
    setError(null);
    setMetrics({
      activeInventory: n(d.active_inventory),
      publishedInventory: n(d.published_inventory),
      newInventory: n(d.new_inventory),
      usedInventory: n(d.used_inventory),
      inGetReady: n(d.in_get_ready),
      getReadyIntake: n(d.get_ready_intake),
      getReadyService: n(d.get_ready_service),
      getReadyPrep: n(d.get_ready_prep),
      getReadyVerified: n(d.get_ready_verified),
      getReadyRecon: n(d.get_ready_recon),
      awaitingAuthorization: n(d.awaiting_authorization),
      retailReady: n(d.retail_ready),
      gated: n(d.gated),
      usedMissingLifecycle: n(d.used_missing_lifecycle),
    });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  return { metrics, loading, error, reload: load };
}

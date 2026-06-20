import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface StaleFlag {
  id: string;
  vehicle_id: string;
  generated_document_id: string | null;
  severity: "info" | "warning" | "compliance_block";
  reason: string;
  changed_field: string | null;
  old_value: unknown;
  new_value: unknown;
  status: "open" | "reviewed" | "resolved" | "ignored" | "superseded";
  created_at: string;
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

// Tenant-wide open review queue.
export function useStaleQueue() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [flags, setFlags] = useState<StaleFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await sb()
        .from("stale_document_flags")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .order("severity", { ascending: false })
        .order("created_at", { ascending: false });
      setLoading(false);
      if (error) { setAvailable(false); return; }
      setAvailable(true);
      setFlags((data || []) as StaleFlag[]);
    } catch { setLoading(false); setAvailable(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);
  return { flags, loading, available, reload: load };
}

// Per-vehicle open flags (for the Vehicle File banner).
export function useVehicleStaleFlags(vehicleId?: string | null) {
  const [flags, setFlags] = useState<StaleFlag[]>([]);
  const load = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { data } = await sb().from("stale_document_flags").select("*").eq("vehicle_id", vehicleId).eq("status", "open");
      setFlags(Array.isArray(data) ? data : []);
    } catch { /* table absent */ }
  }, [vehicleId]);
  useEffect(() => { load(); }, [load]);
  return { flags, reload: load };
}

export async function resolveFlag(id: string, status: StaleFlag["status"], userId?: string | null): Promise<boolean> {
  try {
    const { error } = await sb().from("stale_document_flags")
      .update({ status, reviewed_by: userId || null, reviewed_at: new Date().toISOString() }).eq("id", id);
    return !error;
  } catch { return false; }
}

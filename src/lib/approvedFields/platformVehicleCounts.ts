import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readOptional, type Optional } from "./optionalSchema";

type DbClient = SupabaseClient<Database>;

// Aggregate active-inventory counts per dealership for platform admins. The
// server refuses every other caller; no vehicle row is ever returned.
export function fetchPlatformVehicleCounts(client: DbClient): Promise<Optional<Map<string, number>>> {
  return readOptional(
    () => client.rpc("platform_vehicle_counts"),
    (rows) => {
      const out = new Map<string, number>();
      for (const r of rows ?? []) {
        if (r?.tenant_id) out.set(r.tenant_id, Number(r.active_vehicles) || 0);
      }
      return out;
    },
  );
}

export const vehicleCountLabel = (counts: Optional<Map<string, number>> | undefined, tenantId: string): string => {
  if (!counts || counts.status !== "available") return "—";
  const n = counts.data.get(tenantId) ?? 0;
  return `${n.toLocaleString("en-US")} active`;
};

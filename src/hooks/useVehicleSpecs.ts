import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface VehicleSpecsResult {
  ok: boolean;
  options: string[];
  features: string[];
  optionCount: number;
  build: Record<string, unknown>;
}

// On-demand full factory-options decode for a single VIN via the
// marketcheck-specs edge function. The nightly sync only carries a partial
// option set; this pulls the complete installed-options + standard-equipment
// list and persists it into mc_attributes for the file and the window sticker.
export function useVehicleSpecs() {
  const [loading, setLoading] = useState(false);

  const fetchSpecs = useCallback(
    async (args: { vin: string; tenantId?: string | null; vehicleId?: string | null }): Promise<VehicleSpecsResult | null> => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("marketcheck-specs", {
          body: { vin: args.vin, tenant_id: args.tenantId || null, vehicle_id: args.vehicleId || null },
        });
        if (error) {
          // A 404/non-2xx here usually means the edge function isn't deployed yet.
          toast.error("Factory-options service isn't available yet — deploy the marketcheck-specs function.");
          return null;
        }
        const res = data as { ok?: boolean; options?: string[]; features?: string[]; optionCount?: number; build?: Record<string, unknown>; error?: string };
        if (!res?.ok) {
          toast.error(res?.error === "not_configured" ? "MarketCheck specs not configured" : "No factory options found for this VIN");
          return null;
        }
        const options = res.options || [];
        const features = res.features || [];
        const optionCount = res.optionCount ?? options.length + features.length;
        toast.success(optionCount > 0 ? `Pulled ${optionCount} factory options` : "Decode complete — no options listed");
        return { ok: true, options, features, optionCount, build: res.build || {} };
      } catch {
        toast.error("Couldn't pull factory options");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { fetchSpecs, loading };
}

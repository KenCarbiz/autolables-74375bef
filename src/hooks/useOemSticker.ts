import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Pull the rendered OEM Monroney window sticker for a VIN via the
// oem-window-sticker edge function, which caches it in the public oem-stickers
// bucket and stores the URL on the listing.
export function useOemSticker() {
  const [loading, setLoading] = useState(false);

  const fetchSticker = useCallback(
    async (args: { vin: string; tenantId?: string | null; vehicleId?: string | null }): Promise<string | null> => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("oem-window-sticker", {
          body: { vin: args.vin, tenant_id: args.tenantId || null, vehicle_id: args.vehicleId || null },
        });
        if (error) {
          toast.error("OEM sticker service isn't available yet — deploy the oem-window-sticker function.");
          return null;
        }
        const res = data as { ok?: boolean; url?: string; error?: string };
        if (!res?.ok || !res.url) {
          toast.error(
            res?.error === "not_configured"
              ? "OEM window sticker provider not configured (set the API key)."
              : "No OEM window sticker found for this VIN."
          );
          return null;
        }
        toast.success("OEM window sticker pulled");
        return res.url;
      } catch {
        toast.error("Couldn't pull the OEM window sticker");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { fetchSticker, loading };
}

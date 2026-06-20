import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { DEFAULT_CALIBRATION, normalizeCalibration, type PrintCalibration } from "./printConfig";

// Reads/writes the dealer's print calibration (dealer_print_settings, one row
// per tenant for the default location). Resilient: returns defaults if the
// table isn't deployed, so the generator's print path always has a calibration.
export function useDealerPrintSettings() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [calibration, setCalibration] = useState<PrintCalibration>(DEFAULT_CALIBRATION);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) { setLoading(false); return; }
      try {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase as any)
          .from("dealer_print_settings")
          .select("label_mode, x_offset_inches, y_offset_inches, scale_percentage, printer_name")
          .eq("tenant_id", tenantId)
          .is("location_id", null)
          .maybeSingle();
        if (cancelled) return;
        setLoading(false);
        if (error || !data) return;
        setCalibration(normalizeCalibration({
          labelMode: data.label_mode,
          xOffsetIn: Number(data.x_offset_inches),
          yOffsetIn: Number(data.y_offset_inches),
          scalePct: Number(data.scale_percentage),
          printerName: data.printer_name || undefined,
        }));
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const save = useCallback(async (next: PrintCalibration) => {
    const cal = normalizeCalibration(next);
    setCalibration(cal); // optimistic
    if (!tenantId) return { ok: false };
    try {
      // deno-lint-ignore no-explicit-any
      const { error } = await (supabase as any).from("dealer_print_settings").upsert({
        tenant_id: tenantId,
        location_id: null,
        label_mode: cal.labelMode,
        x_offset_inches: cal.xOffsetIn,
        y_offset_inches: cal.yOffsetIn,
        scale_percentage: cal.scalePct,
        printer_name: cal.printerName || null,
      }, { onConflict: "tenant_id,location_id" });
      return { ok: !error, error: error?.message };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "save_failed" }; }
  }, [tenantId]);

  return { calibration, setCalibration, save, loading };
}

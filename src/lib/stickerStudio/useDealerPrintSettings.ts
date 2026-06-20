import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { DEFAULT_CALIBRATION, normalizeCalibration, type PrintCalibration } from "./printConfig";

// Reads/writes the dealer's print calibration (dealer_print_settings, one row
// per tenant for the default location). Resilient: select("*") so a not-yet-
// migrated column never breaks the read, and the save falls back to the base
// column set when the calibration-extras migration (20260620070000) is absent.
export function useDealerPrintSettings() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [calibration, setCalibration] = useState<PrintCalibration>(DEFAULT_CALIBRATION);
  const [loading, setLoading] = useState(true);

  // deno-lint-ignore no-explicit-any
  const sb = () => supabase as any;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) { setLoading(false); return; }
      try {
        const { data, error } = await sb()
          .from("dealer_print_settings")
          .select("*")
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
          topSafeMarginIn: data.top_safe_margin_inches != null ? Number(data.top_safe_margin_inches) : undefined,
          leftSafeMarginIn: data.left_safe_margin_inches != null ? Number(data.left_safe_margin_inches) : undefined,
          showCropMarks: data.show_crop_marks ?? undefined,
          showSafeArea: data.show_safe_area ?? undefined,
          printerName: data.printer_name || undefined,
        }));
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const save = useCallback(async (next: PrintCalibration) => {
    const cal = normalizeCalibration(next);
    setCalibration(cal); // optimistic
    if (!tenantId) return { ok: false, error: "no_tenant" };
    const base = {
      tenant_id: tenantId,
      location_id: null,
      window_label_size: "8.5x11",
      addendum_label_size: "4.5x11",
      label_mode: cal.labelMode,
      x_offset_inches: cal.xOffsetIn,
      y_offset_inches: cal.yOffsetIn,
      scale_percentage: cal.scalePct,
      printer_name: cal.printerName || null,
    };
    const extras = {
      top_safe_margin_inches: cal.topSafeMarginIn,
      left_safe_margin_inches: cal.leftSafeMarginIn,
      show_crop_marks: cal.showCropMarks,
      show_safe_area: cal.showSafeArea,
    };
    try {
      let { error } = await sb().from("dealer_print_settings").upsert({ ...base, ...extras }, { onConflict: "tenant_id,location_id" });
      if (error) {
        // Calibration-extras migration not applied yet — persist the base set.
        ({ error } = await sb().from("dealer_print_settings").upsert(base, { onConflict: "tenant_id,location_id" }));
      }
      return { ok: !error, error: error?.message };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "save_failed" }; }
  }, [tenantId]);

  return { calibration, setCalibration, save, loading };
}

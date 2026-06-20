import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  EMPTY_CUSTOMIZATION, customizationFromRow, customizationToRow, customizationExtrasRow,
  type TemplateCustomization,
} from "./customization";

// Loads/saves a dealer's customization for one template (dealer_template_
// customizations, tenant-scoped). Resilient: select("*") so a not-yet-migrated
// column never breaks the read; save falls back to the base column set when the
// extras migration (20260620080000) is absent. reset() deletes the row so the
// template returns to its catalog default.
export function useTemplateCustomization(templateId: string) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [customization, setCustomization] = useState<TemplateCustomization>(EMPTY_CUSTOMIZATION);
  const [hasRow, setHasRow] = useState(false);
  const [loading, setLoading] = useState(true);

  // deno-lint-ignore no-explicit-any
  const sb = () => supabase as any;

  const load = useCallback(async () => {
    if (!tenantId || !templateId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await sb()
        .from("dealer_template_customizations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("template_id", templateId)
        .maybeSingle();
      setLoading(false);
      if (error) return;
      setHasRow(!!data);
      setCustomization(data ? customizationFromRow(data) : EMPTY_CUSTOMIZATION);
    } catch { setLoading(false); }
  }, [tenantId, templateId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (c: TemplateCustomization) => {
    setCustomization(c); // optimistic
    if (!tenantId) return { ok: false, error: "no_tenant" };
    const base = customizationToRow(tenantId, templateId, c);
    try {
      let { error } = await sb().from("dealer_template_customizations")
        .upsert({ ...base, ...customizationExtrasRow(c) }, { onConflict: "tenant_id,template_id" });
      if (error) {
        ({ error } = await sb().from("dealer_template_customizations").upsert(base, { onConflict: "tenant_id,template_id" }));
      }
      if (!error) {
        setHasRow(true);
        const { recordUsageEvent } = await import("@/lib/entitlements/usage");
        await recordUsageEvent({ tenantId, featureKey: "template_customization", metric: "template_customizations", entityType: "template", entityId: templateId });
      }
      return { ok: !error, error: error?.message };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "save_failed" }; }
  }, [tenantId, templateId]);

  const reset = useCallback(async () => {
    setCustomization(EMPTY_CUSTOMIZATION);
    setHasRow(false);
    if (!tenantId) return { ok: false };
    try {
      const { error } = await sb().from("dealer_template_customizations")
        .delete().eq("tenant_id", tenantId).eq("template_id", templateId);
      return { ok: !error, error: error?.message };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "reset_failed" }; }
  }, [tenantId, templateId]);

  return { customization, setCustomization, save, reset, hasRow, loading };
}

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { StickerType } from "./templates";

// Per-dealer default template, one per sticker type (UNIQUE(tenant_id, type)).
// Backed by dealer_sticker_template_prefs; resilient to the table being absent
// (migration 20260620050000) — reads/writes are best-effort and the studio
// works without a stored default.
export interface StickerPrefs {
  defaults: Record<string, string>; // type -> template_key
  setDefault: (type: StickerType, templateKey: string) => Promise<void>;
  clearDefault: (type: StickerType) => Promise<void>;
  loading: boolean;
}

export function useStickerPrefs(): StickerPrefs {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any)
        .from("dealer_sticker_template_prefs")
        .select("type, template_id, sticker_templates(template_key)")
        .eq("tenant_id", tenantId);
      setLoading(false);
      if (error || !Array.isArray(data)) return;
      const next: Record<string, string> = {};
      for (const r of data) {
        const key = r.sticker_templates?.template_key;
        if (r.type && key) next[r.type] = key;
      }
      setDefaults(next);
    } catch { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const setDefault = useCallback(async (type: StickerType, templateKey: string) => {
    setDefaults((d) => ({ ...d, [type]: templateKey })); // optimistic
    if (!tenantId) return;
    try {
      // deno-lint-ignore no-explicit-any
      const { data: tpl } = await (supabase as any)
        .from("sticker_templates").select("id").eq("template_key", templateKey).maybeSingle();
      if (!tpl?.id) return;
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from("dealer_sticker_template_prefs").upsert(
        { tenant_id: tenantId, type, template_id: tpl.id, is_favorite: true },
        { onConflict: "tenant_id,type" }
      );
    } catch { /* best-effort */ }
  }, [tenantId]);

  const clearDefault = useCallback(async (type: StickerType) => {
    setDefaults((d) => { const n = { ...d }; delete n[type]; return n; });
    if (!tenantId) return;
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from("dealer_sticker_template_prefs")
        .delete().eq("tenant_id", tenantId).eq("type", type);
    } catch { /* best-effort */ }
  }, [tenantId]);

  return { defaults, setDefault, clearDefault, loading };
}

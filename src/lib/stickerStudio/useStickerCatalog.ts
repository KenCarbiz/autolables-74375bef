import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STUDIO_TEMPLATES, buildConfig, templateFromConfig, type StudioTemplate, type StickerType } from "./templates";

// Database-backed template catalog with a resilient code fallback. Reads active
// rows from sticker_templates (the archive) and rebuilds each template's config
// from its stored override + the code base config for its type. Until the
// migration is applied (or on any error) it returns the built-in registry, so
// the Sticker Studio always works.
export function useStickerCatalog(): { templates: StudioTemplate[]; loading: boolean; byId: (id: string) => StudioTemplate | undefined } {
  const [templates, setTemplates] = useState<StudioTemplate[]>(STUDIO_TEMPLATES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase as any)
          .from("sticker_templates")
          .select("template_key, name, type, size, style_tags, config, is_active")
          .eq("is_active", true);
        if (!cancelled) setLoading(false);
        if (error || !Array.isArray(data) || data.length === 0) return; // keep fallback
        // deno-lint-ignore no-explicit-any
        const built: StudioTemplate[] = data.map((r: any) => {
          const over = (r.config || {}) as Partial<{ id: string; name: string }>;
          const cfg = buildConfig(r.type as StickerType, { ...(r.config || {}), id: over.id || r.template_key, name: over.name || r.name });
          return templateFromConfig(cfg);
        });
        if (!cancelled && built.length) setTemplates(built);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { templates, loading, byId: (id: string) => templates.find((t) => t.config.id === id) };
}

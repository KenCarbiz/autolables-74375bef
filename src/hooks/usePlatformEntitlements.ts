import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// usePlatformEntitlements
//
// Fetches the cross-app product_ids for the current tenant from
// AutoCurb (via the platform-entitlements edge function, which
// proxies the AutoCurb dealers-api so the API token stays server
// side). Result is cached in-memory for the session — the hook
// exposes `load()` for lazy fetch-on-open (e.g. when the user
// dropdown is first opened) and re-uses the cached array on every
// subsequent open.
// ──────────────────────────────────────────────────────────────

let cache: { productIds: string[]; loadedAt: number } | null = null;
let inFlight: Promise<string[]> | null = null;

export function usePlatformEntitlements() {
  const [productIds, setProductIds] = useState<string[]>(cache?.productIds ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (cache) {
      setProductIds(cache.productIds);
      return cache.productIds;
    }
    if (inFlight) {
      const ids = await inFlight;
      if (mounted.current) setProductIds(ids);
      return ids;
    }
    setLoading(true);
    setError(null);
    inFlight = (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("platform-entitlements", {
          body: {},
        });
        if (fnErr) throw fnErr;
        const ids = Array.isArray((data as { product_ids?: string[] })?.product_ids)
          ? (data as { product_ids: string[] }).product_ids
          : [];
        cache = { productIds: ids, loadedAt: Date.now() };
        return ids;
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : "load_failed");
        // Fall back to AutoLabels-only so the current app still renders unlocked.
        return ["autolabels"];
      } finally {
        inFlight = null;
        if (mounted.current) setLoading(false);
      }
    })();
    const ids = await inFlight;
    if (mounted.current) setProductIds(ids);
    return ids;
  }, []);

  return { productIds, loading, error, load };
}

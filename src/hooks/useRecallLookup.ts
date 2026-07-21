import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Recall {
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  reportReceivedDate: string;
  manufacturer: string;
}

export interface RecallResult {
  recalls: Recall[];
  hasOpenRecall: boolean;
  hasStopSale: boolean;
  hasTakata: boolean;
  lastChecked: string;
}

// The shared Normalized recall shape returned by marketcheck-recalls (single
// VIN). Only the fields we map are typed.
interface McNormalRecall {
  campaignId?: string;
  nhtsaCampaignNumber?: string;
  status?: "open" | "closed" | "unknown";
  title?: string;
  description?: string;
  consequence?: string;
  remedy?: string;
  manufacturer?: string;
  reportDate?: string;
  component?: string;
}
interface McNormalized {
  recalls?: McNormalRecall[];
  recallStatus?: string;
  openRecallCount?: number;
  checkedAt?: string;
}

const DND_RE = /do not drive|stop sale|park outside|fire risk/i;
const TAKATA_RE = /takata|air ?bag inflator/i;

// Query MarketCheck AutoRecalls for a VIN and map to RecallResult. Returns null
// when the function could not produce an authoritative recall list (no `recalls`
// array — e.g. error/preserved/no-source), so the caller falls back to NHTSA.
async function lookupMarketCheck(vin: string, tenantId: string): Promise<RecallResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { vin, tenant_id: tenantId } });
    if (error) return null;
    const d = data as McNormalized | null;
    if (!d || !Array.isArray(d.recalls)) return null;

    // Only OPEN campaigns belong on the sticker banner (its copy counts "open
    // recalls"); closed campaigns are dropped.
    const open = d.recalls.filter((r) => r.status !== "closed");
    const recalls: Recall[] = open.map((r) => ({
      campaignNumber: r.nhtsaCampaignNumber || r.campaignId || "",
      component: r.component || "",
      summary: r.title || r.description || "",
      consequence: r.consequence || "",
      remedy: r.remedy || "",
      reportReceivedDate: r.reportDate || "",
      manufacturer: r.manufacturer || "",
    }));
    const text = (r: McNormalRecall) => `${r.title || ""} ${r.description || ""} ${r.consequence || ""} ${r.component || ""}`;
    return {
      recalls,
      hasOpenRecall: recalls.length > 0 || d.recallStatus === "open_recalls" || (d.openRecallCount ?? 0) > 0,
      hasStopSale: open.some((r) => DND_RE.test(text(r))),
      hasTakata: open.some((r) => TAKATA_RE.test(text(r))),
      lastChecked: d.checkedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export const useRecallLookup = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, { at: number; data: RecallResult }>>({});

  const lookup = useCallback(
    async (input: {
      vin?: string;
      make: string;
      model: string;
      year: string;
      // When the tenant is known, MarketCheck AutoRecalls is queried first
      // (it self-falls-back to NHTSA server-side). Without it we hit NHTSA
      // directly, exactly as before.
      tenantId?: string | null;
    }): Promise<RecallResult | null> => {
      const cacheKey = `${input.year}-${input.make}-${input.model}-${input.vin || ""}-${input.tenantId || ""}`;
      const cached = cacheRef.current[cacheKey];
      const now = Date.now();
      const ttl = 24 * 60 * 60 * 1000; // 24 hours

      if (cached && now - cached.at < ttl) {
        return cached.data;
      }

      setLoading(true);
      setError(null);

      try {
        // ── Primary: MarketCheck AutoRecalls (VIN + tenant). Returns the shared
        // Normalized shape; map it to RecallResult. marketcheck-recalls already
        // falls back to NHTSA server-side, so a null here means it truly could
        // not answer (bad VIN, no tenant, transient) → try NHTSA directly.
        const mc = input.tenantId && input.vin
          ? await lookupMarketCheck(input.vin, input.tenantId)
          : null;
        if (mc) {
          cacheRef.current[cacheKey] = { at: now, data: mc };
          return mc;
        }

        // ── Fallback: NHTSA model-level lookup (the original path).
        const { data, error: invokeError } = await supabase.functions.invoke(
          "nhtsa-recall",
          { body: { vin: input.vin, make: input.make, model: input.model, year: input.year } }
        );

        if (invokeError) {
          setError(invokeError.message || "Failed to fetch recalls");
          return null;
        }

        const result = data as RecallResult;
        cacheRef.current[cacheKey] = { at: now, data: result };
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { lookup, loading, error };
};

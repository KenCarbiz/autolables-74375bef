import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { VehicleIdentity } from "@/lib/factorySticker/vehicleIdentity";

export interface NhtsaSafetyRatings {
  vehicleDescription: string;
  overall: number | null;
  frontal: number | null;
  side: number | null;
  rollover: number | null;
  complaintsCount: number | null;
  recallsCount: number | null;
  investigationCount: number | null;
}

export interface NhtsaComplaintSummary {
  count: number;
  crashes: number;
  fires: number;
  topComponents: { component: string; count: number }[];
  recent: { components: string; dateFiled: string; summary: string }[];
}

export interface NhtsaSafetyResult {
  ratings: NhtsaSafetyRatings | null;
  complaints: NhtsaComplaintSummary | null;
  lastChecked: string;
}

const CACHE_KEY = "al_nhtsa_safety_v1";

const readCache = (): Record<string, NhtsaSafetyResult> => {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
};

// Fetches NHTSA 5-star safety ratings + owner complaints for the panel's
// vehicle. Government data changes slowly, so a session cache is enough.
export const useNhtsaSafety = (identity: VehicleIdentity | null | undefined, enabled: boolean) => {
  // NHTSA is a provider: it is asked with the structured identity the caller
  // resolved, never with a re-split of the display string those fields were
  // concatenated into.
  const year = identity?.year ?? "";
  const make = identity?.make ?? "";
  const model = identity?.model ?? "";
  const [data, setData] = useState<NhtsaSafetyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!year || !make || !model) return;
    const key = `${year}-${make}-${model}`.toLowerCase();
    const cached = readCache()[key];
    if (cached) { setData(cached); return; }
    if (inFlight.current === key) return;
    inFlight.current = key;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("nhtsa-safety", { body: { year, make, model } });
      if (!error && res && (res.ratings || res.complaints)) {
        const result = res as NhtsaSafetyResult;
        setData(result);
        try {
          const all = readCache();
          all[key] = result;
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
        } catch { /* storage full or unavailable — skip caching */ }
      }
    } catch { /* network error — panel simply omits government data */ }
    finally {
      setLoading(false);
      inFlight.current = null;
    }
  }, [year, make, model]);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  return { data, loading };
};

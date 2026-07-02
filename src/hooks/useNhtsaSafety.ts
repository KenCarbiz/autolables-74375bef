import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

const MULTIWORD_MAKES = /^(land rover|alfa romeo|aston martin|mercedes benz)\b/i;

// "2023 Nissan Altima" → { year, make, model }; handles two-word makes.
export const parseYmm = (ymm: string | null | undefined): { year: string; make: string; model: string } | null => {
  const parts = String(ymm || "").trim().split(/\s+/);
  if (parts.length < 3 || !/^\d{4}$/.test(parts[0])) return null;
  const rest = parts.slice(1).join(" ");
  const mw = rest.match(MULTIWORD_MAKES);
  const make = mw ? mw[0] : parts[1];
  const model = rest.slice(make.length).trim();
  if (!make || !model) return null;
  return { year: parts[0], make, model };
};

const CACHE_KEY = "al_nhtsa_safety_v1";

const readCache = (): Record<string, NhtsaSafetyResult> => {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
};

// Fetches NHTSA 5-star safety ratings + owner complaints for the panel's
// vehicle. Government data changes slowly, so a session cache is enough.
export const useNhtsaSafety = (ymm: string | null | undefined, enabled: boolean) => {
  const [data, setData] = useState<NhtsaSafetyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<string | null>(null);

  const load = useCallback(async () => {
    const parsed = parseYmm(ymm);
    if (!parsed) return;
    const key = `${parsed.year}-${parsed.make}-${parsed.model}`.toLowerCase();
    const cached = readCache()[key];
    if (cached) { setData(cached); return; }
    if (inFlight.current === key) return;
    inFlight.current = key;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("nhtsa-safety", { body: parsed });
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
  }, [ymm]);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  return { data, loading };
};

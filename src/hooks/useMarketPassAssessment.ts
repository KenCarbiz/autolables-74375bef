import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MARKETPASS_PUBLIC_CONTRACT_VERSION, type MarketPassPublicContract } from "@/lib/intelligence/marketPass/contracts";

/** Accepts only a public contract of the version this page renders; anything else renders nothing. */
export function asPublicMarketPass(body: unknown): MarketPassPublicContract | null {
  if (!body || typeof body !== "object") return null;
  const c = body as Partial<MarketPassPublicContract>;
  if (c.audience !== "public" || c.contractVersion !== MARKETPASS_PUBLIC_CONTRACT_VERSION) return null;
  if (!c.priceFairness || !c.vehicleConfidence) return null;
  return c as MarketPassPublicContract;
}

/**
 * Fetches the public MarketPass contract for a published listing. Off unless
 * `enabled`; a 404 (flag off for the dealer) or any error yields null.
 */
export function useMarketPassAssessment(slug: string, enabled: boolean): MarketPassPublicContract | null {
  const [contract, setContract] = useState<MarketPassPublicContract | null>(null);
  useEffect(() => {
    setContract(null);
    if (!enabled || !slug) return;
    let cancelled = false;
    supabase.functions
      .invoke(`marketpass-assessment?slug=${encodeURIComponent(slug)}`, { method: "GET" })
      .then(({ data, error }) => { if (!cancelled) setContract(error ? null : asPublicMarketPass(data)); })
      .catch(() => { if (!cancelled) setContract(null); });
    return () => { cancelled = true; };
  }, [slug, enabled]);
  return contract;
}

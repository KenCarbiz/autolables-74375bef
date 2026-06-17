import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "./useRealtimeInvalidate";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────
// useAdvertisedPrices — Wave 20.
//
// Reads the LATEST advertised price per VIN for the current
// tenant. Writes new snapshots via captureSnapshot — every
// capture appends a new row (history is the audit artifact).
//
// Backed by the latest_advertised_prices view (Wave 20 migration)
// so the read is one row per VIN with no DISTINCT ON in the
// client. Realtime-invalidated so capturing in one tab updates
// the price band in another.
// ──────────────────────────────────────────────────────────────

export type AdvertisedSource =
  | "website"
  | "autotrader"
  | "cars_com"
  | "facebook"
  | "cargurus"
  | "truecar"
  | "carfax"
  | "capital_one"
  | "manual"
  | "other";

export const SOURCE_LABELS: Record<AdvertisedSource, string> = {
  website:     "Dealer website",
  autotrader:  "AutoTrader",
  cars_com:    "Cars.com",
  facebook:    "Facebook",
  cargurus:    "CarGurus",
  truecar:     "TrueCar",
  carfax:      "CARFAX",
  capital_one: "Capital One",
  manual:      "Manual entry",
  other:       "Other",
};

export interface AdvertisedPrice {
  id: string;
  vin: string;
  source_url: string;
  source_label: AdvertisedSource;
  advertised_price: number;
  snapshot_at: string;
  captured_by: string;
  notes: string;
}

const cacheKey = (tenantId: string | null) => ["advertised_prices", tenantId] as const;

export const useAdvertisedPrices = (storeId: string = "") => {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;

  const q = useQuery({
    queryKey: cacheKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<AdvertisedPrice[]> => {
      // Read the real table (the latest_advertised_prices view isn't in the
      // live schema) and alias the live column names (captured_at,
      // source_channel) to the shape the rest of the app expects, then
      // dedupe to the latest row per VIN.
      const { data } = await (supabase as any)
        .from("advertised_prices")
        .select("id, vin, source_url, source_label:source_channel, advertised_price, snapshot_at:captured_at, captured_by, notes")
        .order("captured_at", { ascending: false })
        .limit(2000);
      // Keep the latest snapshot per (VIN, source) — one canonical price per
      // site so the dealer can verify every marketplace lists the same number.
      // Rows arrive newest-first, so the first time we see a (vin, channel) it
      // is the current value for that site.
      const rows = (data as AdvertisedPrice[]) || [];
      const seen = new Set<string>();
      const latest: AdvertisedPrice[] = [];
      for (const r of rows) {
        const v = (r.vin || "").toUpperCase();
        if (!v) continue;
        const key = `${v}|${r.source_label}`;
        if (!seen.has(key)) { seen.add(key); latest.push(r); }
      }
      return latest;
    },
    staleTime: 60_000,
  });

  // Subscribe to the writable table (not the view) — Realtime
  // fires on row writes, not on view recomputes.
  useRealtimeInvalidate({
    table: "advertised_prices",
    queryKey: cacheKey(tenantId),
    enabled: !!tenantId,
  });

  // Map vin → canonical latest price (one entry per VIN) for cheap O(1) lookup
  // from row renderers in /inventory etc. Prefer the dealer's own website as
  // authoritative; otherwise the newest snapshot across sites. q.data is
  // newest-first, so the first website row (or first row) per VIN wins.
  const byVin = useMemo(() => {
    const m = new Map<string, AdvertisedPrice>();
    for (const p of q.data || []) {
      const v = (p.vin || "").toUpperCase();
      const existing = m.get(v);
      if (!existing || (p.source_label === "website" && existing.source_label !== "website")) {
        if (!existing) m.set(v, p);
        else if (p.source_label === "website") m.set(v, p);
      }
    }
    return m;
  }, [q.data]);

  // Map vin → every site's latest price, so a panel can show the cross-site
  // spread and flag a marketplace that is out of step with the sticker.
  const crossSiteByVin = useMemo(() => {
    const m = new Map<string, AdvertisedPrice[]>();
    for (const p of q.data || []) {
      const v = (p.vin || "").toUpperCase();
      const arr = m.get(v) || [];
      arr.push(p);
      m.set(v, arr);
    }
    return m;
  }, [q.data]);

  const captureMutation = useMutation({
    mutationFn: async (args: {
      vin: string;
      advertised_price: number;
      source_label?: AdvertisedSource;
      source_url?: string;
      captured_by?: string;
      notes?: string;
    }) => {
      const { error } = await (supabase as any)
        .from("advertised_prices")
        .insert({
          store_id: storeId,
          vin: args.vin.toUpperCase().trim(),
          source_channel: args.source_label || "manual",
          source_url: args.source_url || "",
          advertised_price: args.advertised_price,
          captured_by: args.captured_by || "",
          notes: args.notes || "",
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKey(tenantId) }),
  });

  const captureSnapshot = useCallback(
    (args: Parameters<typeof captureMutation.mutateAsync>[0]) =>
      captureMutation.mutateAsync(args),
    [captureMutation],
  );

  return {
    prices: q.data ?? [],
    byVin,
    crossSiteByVin,
    loading: q.isLoading,
    captureSnapshot,
    capturing: captureMutation.isPending,
    SOURCE_LABELS,
  };
};

// Cross-site price agreement for one VIN. Returns the per-site latest prices,
// the min/max spread, and whether any site disagrees beyond tolerance — the
// "are all my listings showing the right price" check.
export interface SiteSpread {
  prices: AdvertisedPrice[];
  min: number;
  max: number;
  spread: number;
  inAgreement: boolean;
  sites: number;
}

export const assessSiteSpread = (
  rows: AdvertisedPrice[] | undefined,
  tolerance: number = TOLERANCE_DOLLARS,
): SiteSpread | null => {
  const prices = (rows || []).filter((r) => r.advertised_price > 0);
  if (prices.length === 0) return null;
  const vals = prices.map((p) => p.advertised_price);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const spread = max - min;
  return {
    prices,
    min,
    max,
    spread,
    inAgreement: spread <= tolerance,
    sites: prices.length,
  };
};

// ──────────────────────────────────────────────────────────────
// Drift assessment — pure, testable. Returns the comparison
// shape the AdvertisedPriceBand renders. Configurable tolerance:
// $50 by default (covers rounding + price-label units that may
// or may not include doc fee).
// ──────────────────────────────────────────────────────────────

export interface DriftAssessment {
  status: "match" | "drift" | "untracked";
  advertised?: number;
  sticker: number;
  delta: number;        // sticker - advertised (positive = sticker higher)
  abs_delta: number;
  pct_delta: number;    // delta / advertised
  source?: AdvertisedSource;
  snapshot_at?: string;
  reason: string;       // human-readable
}

export const TOLERANCE_DOLLARS = 50;

export const assessDrift = (
  sticker: number,
  ap: AdvertisedPrice | undefined,
): DriftAssessment => {
  if (!ap) {
    return {
      status: "untracked",
      sticker,
      delta: 0,
      abs_delta: 0,
      pct_delta: 0,
      reason: "No advertised price on file. Capture one from your website / AutoTrader / Cars.com to enable drift detection.",
    };
  }
  const delta = sticker - ap.advertised_price;
  const abs = Math.abs(delta);
  const pct = ap.advertised_price > 0 ? delta / ap.advertised_price : 0;
  if (abs <= TOLERANCE_DOLLARS) {
    return {
      status: "match",
      advertised: ap.advertised_price,
      sticker,
      delta,
      abs_delta: abs,
      pct_delta: pct,
      source: ap.source_label,
      snapshot_at: ap.snapshot_at,
      reason: `Sticker matches advertised within $${TOLERANCE_DOLLARS} tolerance.`,
    };
  }
  return {
    status: "drift",
    advertised: ap.advertised_price,
    sticker,
    delta,
    abs_delta: abs,
    pct_delta: pct,
    source: ap.source_label,
    snapshot_at: ap.snapshot_at,
    reason: delta > 0
      ? `Sticker is $${abs.toLocaleString()} HIGHER than the price you're advertising. FTC §5 enforcement hook (March 2026 97-dealer warning letters cited this).`
      : `Sticker is $${abs.toLocaleString()} LOWER than the price you're advertising. Less risky, but still a mismatch the audit trail will record.`,
  };
};

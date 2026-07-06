import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildShopperActivity,
  emptyShopperActivity,
  rangeSince,
  type RawCrossVehicleEventRow,
  type RawEngagementEventRow,
  type RawLeadRow,
  type RawPassportEngagementRow,
  type RawQrScanRow,
  type ShopperActivityRange,
  type ShopperActivitySummary,
} from "@/lib/shopperActivity";

// ──────────────────────────────────────────────────────────────────────
// useShopperActivity — client-side (tenant RLS) loader for the internal
// Shopper Activity slide-out. Fetches the summary-critical tables first
// (passport dwell, engagement events, QR scans, leads), builds the summary
// so the drawer paints immediately, then augments it with the cross-vehicle
// "similar vehicles" join (keyed on visitor_id) as a lazy second phase.
//
// Every table is tenant-scoped via RLS; empty tables are normal (thin data
// today) and produce an honest empty/partial summary, never fabricated rows.
// ──────────────────────────────────────────────────────────────────────

interface Options {
  vin: string | null;
  tenantId: string | null;
  vehicleId: string | null;
  viewCount?: number | null;
  enabled?: boolean;
}

interface Result {
  summary: ShopperActivitySummary;
  loading: boolean;
  error: string | null;
  range: ShopperActivityRange;
  setRange: (r: ShopperActivityRange) => void;
  refresh: () => void;
}

const EVENT_COLS =
  "id, session_id, visitor_id, vin, source, surface, event_type, document_type, document_title, referrer, landing_url, device_type, browser, os, country, region, city, metadata, occurred_at";

// deno-lint-ignore no-explicit-any -- supabase generated types don't include these tables
const db = supabase as unknown as { from: (t: string) => any };

export function useShopperActivity({ vin, tenantId, vehicleId, viewCount, enabled = true }: Options): Result {
  const [range, setRange] = useState<ShopperActivityRange>("all");
  const [summary, setSummary] = useState<ShopperActivitySummary>(() => emptyShopperActivity(viewCount));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    if (!vin || !tenantId) {
      setSummary(emptyShopperActivity(viewCount));
      return;
    }
    const id = ++reqId.current;
    let cancelled = false;
    const upper = vin.toUpperCase();
    const since = rangeSince(range);

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // ── Phase 1: summary-critical tables, in parallel. ──
        const engQ = db
          .from("passport_engagement")
          .select("session_id, module, seconds, first_at, last_at")
          .eq("tenant_id", tenantId)
          .eq("vin", upper)
          .limit(5000);
        if (since) engQ.gte("last_at", since);

        const evQ = db
          .from("customer_engagement_events")
          .select(EVENT_COLS)
          .eq("tenant_id", tenantId)
          .eq("vin", upper)
          .order("occurred_at", { ascending: false })
          .limit(3000);
        if (since) evQ.gte("occurred_at", since);

        const leadsQ = db
          .from("leads")
          // Only the count is used downstream — don't pull shopper PII (name)
          // into the browser for an internal analytics aggregate.
          .select("vehicle_vin, captured_at")
          .eq("tenant_id", tenantId)
          .eq("vehicle_vin", upper)
          .order("captured_at", { ascending: false })
          .limit(500);
        if (since) leadsQ.gte("captured_at", since);

        // qr_scan_events is keyed on vehicle_id (uuid), not vin.
        const qrQ = vehicleId
          ? (() => {
              const q = db
                .from("qr_scan_events")
                .select("user_agent, referrer, country, region, city, scanned_at")
                .eq("tenant_id", tenantId)
                .eq("vehicle_id", vehicleId)
                .order("scanned_at", { ascending: false })
                .limit(2000);
              if (since) q.gte("scanned_at", since);
              return q;
            })()
          : Promise.resolve({ data: [] });

        const [engRes, evRes, leadsRes, qrRes] = await Promise.all([engQ, evQ, leadsQ, qrQ]);
        if (cancelled || id !== reqId.current) return;

        const engagement = (engRes.data || []) as RawPassportEngagementRow[];
        const events = (evRes.data || []) as RawEngagementEventRow[];
        const leads = (leadsRes.data || []) as RawLeadRow[];
        const qrScans = (qrRes.data || []) as RawQrScanRow[];

        // Surface the most severe transport error, but still render what loaded.
        const firstErr = [engRes, evRes, leadsRes, qrRes].find((r) => (r as { error?: unknown }).error);
        if (firstErr && (firstErr as { error?: { message?: string } }).error) {
          setError((firstErr as { error: { message?: string } }).error.message || "Some activity failed to load");
        }

        const base = buildShopperActivity({ currentVin: upper, viewCount, engagement, events, qrScans, leads });
        setSummary(base);
        setLoading(false);

        // ── Phase 2: cross-vehicle activity (lazy). ──
        const visitorIds = [...new Set(events.map((e) => e.visitor_id).filter((v): v is string => !!v))].slice(0, 100);
        if (!visitorIds.length) return;
        const crossRes = await db
          .from("customer_engagement_events")
          .select("visitor_id, vin, event_type, occurred_at, metadata")
          .eq("tenant_id", tenantId)
          .in("visitor_id", visitorIds)
          .neq("vin", upper)
          .order("occurred_at", { ascending: false })
          .limit(2000);
        if (cancelled || id !== reqId.current) return;
        const crossVehicleEvents = (crossRes.data || []) as RawCrossVehicleEventRow[];
        if (!crossVehicleEvents.length) return;
        setSummary(buildShopperActivity({ currentVin: upper, viewCount, engagement, events, qrScans, leads, crossVehicleEvents }));
      } catch (e) {
        if (cancelled || id !== reqId.current) return;
        setError(e instanceof Error ? e.message : "Failed to load shopper activity");
        setSummary(emptyShopperActivity(viewCount));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, vin, tenantId, vehicleId, viewCount, range, nonce]);

  return { summary, loading, error, range, setRange, refresh };
}

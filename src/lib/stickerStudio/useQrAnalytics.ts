import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface ScanEvent {
  id: string;
  vehicle_id?: string | null;
  sticker_type?: string | null;
  device_type?: string | null;
  browser?: string | null;
  referrer?: string | null;
  scanned_at: string;
}

export interface QrAnalytics {
  total: number;
  byType: Record<string, number>;
  byDay: { day: string; count: number }[];
  topVehicles: { vehicle_id: string; count: number }[];
  latest: ScanEvent[];
  available: boolean;
  loading: boolean;
}

// Tenant-scoped QR scan analytics over a trailing window (default 30 days).
export function useQrAnalytics(days = 30): QrAnalytics {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [state, setState] = useState<QrAnalytics>({ total: 0, byType: {}, byDay: [], topVehicles: [], latest: [], available: true, loading: true });

  useEffect(() => {
    if (!tenantId) { setState((s) => ({ ...s, loading: false })); return; }
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      try {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase as any)
          .from("qr_scan_events")
          .select("id, vehicle_id, qr_code_id, referrer, user_agent, scanned_at")
          .eq("tenant_id", tenantId)
          .gte("scanned_at", since)
          .order("scanned_at", { ascending: false });
        if (cancelled) return;
        if (error) { setState((s) => ({ ...s, available: false, loading: false })); return; }
        const rows: any[] = data || [];
        // Resolve sticker_type from parent qr_codes rows (column doesn't exist on qr_scan_events).
        const qrIds = Array.from(new Set(rows.map((r) => r.qr_code_id).filter(Boolean)));
        let typeById: Record<string, string> = {};
        if (qrIds.length) {
          const { data: qrRows } = await (supabase as any)
            .from("qr_codes").select("id, sticker_type").in("id", qrIds);
          for (const q of (qrRows || [])) typeById[q.id] = q.sticker_type || "unknown";
        }
        const events: ScanEvent[] = rows.map((r) => ({
          id: r.id,
          vehicle_id: r.vehicle_id,
          sticker_type: r.qr_code_id ? (typeById[r.qr_code_id] || "unknown") : "unknown",
          device_type: uaDevice(r.user_agent),
          browser: uaBrowser(r.user_agent),
          referrer: r.referrer,
          scanned_at: r.scanned_at,
        }));
        const byType: Record<string, number> = {};
        const byVehicle: Record<string, number> = {};
        const byDayMap: Record<string, number> = {};
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          byDayMap[d] = 0;
        }
        for (const e of events) {
          byType[e.sticker_type || "unknown"] = (byType[e.sticker_type || "unknown"] || 0) + 1;
          if (e.vehicle_id) byVehicle[e.vehicle_id] = (byVehicle[e.vehicle_id] || 0) + 1;
          const day = e.scanned_at.slice(0, 10);
          if (day in byDayMap) byDayMap[day] += 1;
        }
        const topVehicles = Object.entries(byVehicle).map(([vehicle_id, count]) => ({ vehicle_id, count })).sort((a, b) => b.count - a.count).slice(0, 10);
        const byDay = Object.entries(byDayMap).map(([day, count]) => ({ day, count }));
        setState({ total: events.length, byType, byDay, topVehicles, latest: events.slice(0, 25), available: true, loading: false });
      } catch { if (!cancelled) setState((s) => ({ ...s, available: false, loading: false })); }
    })();
    return () => { cancelled = true; };
  }, [tenantId, days]);

  return state;
}

// Per-vehicle scan summary for the Vehicle File.
export function useVehicleQrScans(vehicleId?: string | null) {
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [byType, setByType] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any)
          .from("qr_scan_events")
          .select("sticker_type, scanned_at")
          .eq("vehicle_id", vehicleId)
          .order("scanned_at", { ascending: false });
        if (cancelled || !Array.isArray(data)) return;
        const t: Record<string, number> = {};
        for (const e of data) t[e.sticker_type || "unknown"] = (t[e.sticker_type || "unknown"] || 0) + 1;
        setCount(data.length);
        setLast(data[0]?.scanned_at || null);
        setByType(t);
      } catch { /* table absent — leave zeros */ }
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  return { count, last, byType };
}

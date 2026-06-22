import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type InventoryCtMvpStatus = {
  vehicleId: string | null;
  vin: string | null;
  ready: boolean;
  certifiedAt: string;
  openIssueCount: number;
  missingLabels: string[];
};

type CertificationCheck = {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
  detail?: string;
};

type CertificationRunRow = {
  vehicle_id: string | null;
  vin: string | null;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string;
};

const normalizeVin = (vin?: string | null) => String(vin || "").trim().toUpperCase();

export const useInventoryCtMvpStatus = (
  tenantId?: string | null,
  vehicles: Array<{ id: string; vin?: string | null }> = [],
) => {
  const [rows, setRows] = useState<CertificationRunRow[]>([]);
  const [loading, setLoading] = useState(false);

  const vehicleIds = useMemo(() => vehicles.map((v) => v.id).filter(Boolean), [vehicles]);
  const vins = useMemo(() => vehicles.map((v) => normalizeVin(v.vin)).filter(Boolean), [vehicles]);

  useEffect(() => {
    if (!tenantId || vehicles.length === 0) {
      setRows([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ors: string[] = [];
        if (vehicleIds.length) ors.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
        if (vins.length) ors.push(`vin.in.(${vins.join(",")})`);

        const { data, error } = await (supabase as any)
          .from("ct_mvp_certification_runs")
          .select("vehicle_id,vin,ready,checks,certified_at")
          .eq("tenant_id", tenantId)
          .or(ors.join(","))
          .order("certified_at", { ascending: false })
          .limit(Math.max(vehicles.length * 3, 25));

        if (error) throw error;
        if (!cancelled) setRows((data || []) as CertificationRunRow[]);
      } catch (err) {
        console.warn("Could not load CT MVP inventory status", err);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, vehicleIds.join("|"), vins.join("|"), vehicles.length]);

  const byVehicleId = useMemo(() => {
    const map = new Map<string, InventoryCtMvpStatus>();
    const seen = new Set<string>();

    for (const row of rows) {
      const checks = Array.isArray(row.checks) ? row.checks : [];
      const missing = checks.filter((check) => check.status && check.status !== "pass");
      const status: InventoryCtMvpStatus = {
        vehicleId: row.vehicle_id,
        vin: normalizeVin(row.vin) || null,
        ready: !!row.ready,
        certifiedAt: row.certified_at,
        openIssueCount: missing.length,
        missingLabels: missing.map((check) => check.label || check.key || "Compliance check").slice(0, 4),
      };

      const keys = [row.vehicle_id || "", normalizeVin(row.vin)].filter(Boolean);
      for (const key of keys) {
        if (!seen.has(key)) {
          map.set(key, status);
          seen.add(key);
        }
      }
    }

    return map;
  }, [rows]);

  const getStatus = (vehicle: { id: string; vin?: string | null }) =>
    byVehicleId.get(vehicle.id) || byVehicleId.get(normalizeVin(vehicle.vin)) || null;

  return { loading, getStatus, byVehicleId };
};

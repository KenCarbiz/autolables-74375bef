import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { canonicalCondition } from "@/lib/vehicleCondition";

// ──────────────────────────────────────────────────────────────
// useVehicleCompliance — Phase 3 Command Center data hook.
// Derives per-VIN compliance status from real Phase-2 signals:
//   • vehicle_listings          (active inventory, condition, price)
//   • vehicle_exceptions        (open critical/high/medium counts)
//   • stale_document_flags      (reprint_required, via vehicle_files.vin)
//   • prep_sign_offs            (physical verification, listing_unlocked)
//
// Signals not yet reliably tracked per-VIN are OMITTED from the
// status computation (and surfaced as "—" in the UI) rather than
// fabricated:
//   • per-VIN "missing required Buyers Guide" flag — no clean column
//   • per-VIN "missing required addendum" flag — no clean column
// If/when those become computable, add them below without changing
// the precedence order.
// ──────────────────────────────────────────────────────────────

export type ComplianceStatus =
  | "sold"
  | "exempt"
  | "critical"
  | "action_required"
  | "verification_needed"
  | "compliant";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface VehicleComplianceRow {
  vehicle_id: string;
  tenant_id: string | null;
  vin: string;
  store_id: string | null;
  stock_number: string | null;
  ymm: string | null;
  trim: string | null;
  is_used: boolean;
  listing_status: string | null;      // 'published' | 'draft' | 'archived'
  inventory_age_days: number | null;
  last_verified_at: string | null;
  price: number | null;
  open_exceptions: number;
  open_by_severity: Record<Severity, number>;
  top_open_exception: { type: string; severity: Severity; title: string } | null;
  reprint_required: boolean;
  price_parse_status: string | null;
  price_mismatch: boolean;
  verified: boolean;                  // prep_sign_off.listing_unlocked===true
  compliance_status: ComplianceStatus;
}

interface ExRow {
  vin: string;
  exception_type: string;
  severity: Severity;
  title: string;
  status: string;
}

interface StaleRow {
  vehicle_id: string;
  status: string;
}

interface VfRow {
  id: string;
  vin: string;
}

interface PrepRow {
  vin: string;
  listing_unlocked: boolean | null;
  signed_at: string | null;
}

export function useVehicleCompliance() {
  const { tenant } = useTenant();
  const currentTenantId = tenant?.id ?? null;
  const [rows, setRows] = useState<VehicleComplianceRow[]>([]);
  const [latestSync, setLatestSync] = useState<{
    status: string | null; finished_at: string | null; error_summary: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentTenantId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [
        listingsRes,
        exceptionsRes,
        vehicleFilesRes,
        staleRes,
        prepRes,
        syncRes,
      ] = await Promise.all([
        supabase.from("vehicle_listings")
          .select("id, vin, store_id, ymm, trim, condition, price, status, created_at, published_at, price_parse_status, price_last_verified_at, sticker_snapshot")
          .eq("tenant_id", currentTenantId)
          .in("status", ["published", "draft"])
          .limit(5000),
        supabase.from("vehicle_exceptions")
          .select("vin, exception_type, severity, title, status")
          .eq("tenant_id", currentTenantId)
          .in("status", ["open", "in_progress"])
          .limit(10000),
        supabase.from("vehicle_files")
          .select("id, vin")
          .eq("tenant_id", currentTenantId)
          .limit(10000),
        supabase.from("stale_document_flags")
          .select("vehicle_id, status")
          .eq("tenant_id", currentTenantId)
          .eq("status", "open")
          .limit(10000),
        supabase.from("prep_sign_offs")
          .select("vin, listing_unlocked, signed_at")
          .eq("tenant_id", currentTenantId)
          .limit(10000),
        supabase.from("inventory_sync_runs")
          .select("status, finished_at, error_summary")
          .eq("tenant_id", currentTenantId)
          .order("started_at", { ascending: false })
          .limit(1),
      ]);

      if (listingsRes.error) throw listingsRes.error;

      const listings = listingsRes.data || [];
      const exceptions = (exceptionsRes.data || []) as ExRow[];
      const vfs = (vehicleFilesRes.data || []) as VfRow[];
      const stale = (staleRes.data || []) as StaleRow[];
      const preps = (prepRes.data || []) as PrepRow[];

      // Build lookup: exceptions by VIN.
      const exByVin = new Map<string, ExRow[]>();
      for (const e of exceptions) {
        if (!e.vin) continue;
        const key = e.vin.toUpperCase();
        const arr = exByVin.get(key) || [];
        arr.push(e);
        exByVin.set(key, arr);
      }

      // Build lookup: stale flags → VIN via vehicle_files.id.
      const vfIdToVin = new Map<string, string>();
      for (const v of vfs) if (v.vin) vfIdToVin.set(v.id, v.vin.toUpperCase());
      const staleVins = new Set<string>();
      for (const s of stale) {
        const vin = vfIdToVin.get(s.vehicle_id);
        if (vin) staleVins.add(vin);
      }

      // Latest prep sign-off per VIN.
      const prepByVin = new Map<string, PrepRow>();
      for (const p of preps) {
        if (!p.vin) continue;
        const k = p.vin.toUpperCase();
        const prev = prepByVin.get(k);
        if (!prev || (p.signed_at && (!prev.signed_at || p.signed_at > prev.signed_at))) {
          prepByVin.set(k, p);
        }
      }

      const severityRank: Record<Severity, number> = {
        critical: 5, high: 4, medium: 3, low: 2, info: 1,
      };

      const out: VehicleComplianceRow[] = listings.map((l: any) => {
        const vin = String(l.vin || "").toUpperCase();
        const canon = canonicalCondition(l.condition);
        const isUsed = canon === "used" || canon === "cpo";
        const isNew = canon === "new";
        const listingStatus = l.status as string | null;
        const isArchived = listingStatus === "archived";

        const listedAt = l.published_at || l.created_at;
        const invAgeDays = listedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(listedAt).getTime()) / 86_400_000))
          : null;

        const openEx = exByVin.get(vin) || [];
        const bySev: Record<Severity, number> = {
          critical: 0, high: 0, medium: 0, low: 0, info: 0,
        };
        for (const e of openEx) bySev[e.severity] = (bySev[e.severity] || 0) + 1;
        const top = [...openEx].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0] || null;

        const reprintRequired = staleVins.has(vin);
        const priceMismatch = l.price_parse_status === "mismatch" || l.price_parse_status === "stale";

        const prep = prepByVin.get(vin);
        const verified = prep?.listing_unlocked === true;
        const lastVerifiedAt = prep?.signed_at ?? null;

        // ── Status precedence (first match wins) ────────────
        let status: ComplianceStatus;
        if (isArchived) status = "sold";
        else if (isNew) status = "exempt";
        else if (bySev.critical > 0) status = "critical";
        else if (
          bySev.high > 0 ||
          bySev.medium > 0 ||
          priceMismatch ||
          reprintRequired
        ) status = "action_required";
        else if (isUsed && listingStatus === "published" && !verified) status = "verification_needed";
        else status = "compliant";

        return {
          vehicle_id: l.id,
          tenant_id: currentTenantId,
          vin,
          store_id: l.store_id,
          stock_number: l.sticker_snapshot?.stock_number ?? null,
          ymm: l.ymm,
          trim: l.trim,
          is_used: isUsed,
          listing_status: listingStatus,
          inventory_age_days: invAgeDays,
          last_verified_at: lastVerifiedAt || l.price_last_verified_at || null,
          price: l.price ?? null,
          open_exceptions: openEx.length,
          open_by_severity: bySev,
          top_open_exception: top ? { type: top.exception_type, severity: top.severity, title: top.title } : null,
          reprint_required: reprintRequired,
          price_parse_status: l.price_parse_status ?? null,
          price_mismatch: priceMismatch,
          verified,
          compliance_status: status,
        };
      });

      setRows(out);
      setLatestSync(syncRes.data?.[0] ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load compliance data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.compliance_status !== "sold");
    const used = active.filter((r) => r.is_used);
    const by = (s: ComplianceStatus) => active.filter((r) => r.compliance_status === s).length;
    const compliant = by("compliant");
    const complianceScore = used.length > 0
      ? Math.round(100 * used.filter((r) => r.compliance_status === "compliant").length / used.length)
      : null;
    return {
      total_active: active.length,
      used: used.length,
      compliant,
      action_required: by("action_required"),
      critical: by("critical"),
      verification_needed: by("verification_needed"),
      exempt: by("exempt"),
      reprints_required: active.filter((r) => r.reprint_required).length,
      price_mismatches: active.filter((r) => r.price_mismatch).length,
      // Uncomputable-yet — surface honestly.
      missing_buyers_guides: null as number | null,
      compliance_score: complianceScore,
    };
  }, [rows]);

  return { rows, summary, latestSync, loading, error, refresh: load };
}

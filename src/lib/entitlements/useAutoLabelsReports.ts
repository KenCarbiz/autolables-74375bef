import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────────────
// Dealer ROI + operations reporting. Aggregates server-side, tenant-scoped
// (RLS) data from generated_documents, qr_scan_events, and addendums
// (products_snapshot + optional_selections). Read-only — never mutates signing
// data. Resilient: a missing table just yields zeros for that section.
// ──────────────────────────────────────────────────────────────────────

export interface AddonStat { id: string; name: string; shown: number; accepted: number; declined: number; rate: number; revenue: number; avgPrice: number }

export interface AutoLabelsReport {
  loading: boolean;
  // Document activity
  generated: number;
  printed: number;
  published: number;
  pendingApproval: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  genByDay: { day: string; count: number }[];
  // QR
  qrScans: number;
  qrByDay: { day: string; count: number }[];
  // Signing / add-ons
  packetsSigned: number;
  acceptedAddonRevenue: number;
  addons: AddonStat[];
}

const empty: AutoLabelsReport = {
  loading: true, generated: 0, printed: 0, published: 0, pendingApproval: 0,
  byStatus: {}, byType: {}, genByDay: [], qrScans: 0, qrByDay: [],
  packetsSigned: 0, acceptedAddonRevenue: 0, addons: [],
};

const dayBuckets = (days: number) => {
  const m: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) m[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
  return m;
};

export function useAutoLabelsReports(days = 30): AutoLabelsReport & { reload: () => void } {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [report, setReport] = useState<AutoLabelsReport>(empty);

  const load = useCallback(async () => {
    if (!tenantId) { setReport((r) => ({ ...r, loading: false })); return; }
    setReport((r) => ({ ...r, loading: true }));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;

    const [docsRes, qrRes, addRes] = await Promise.all([
      sb.from("generated_documents").select("document_type, document_status, created_at, printed_at, published_at").eq("tenant_id", tenantId).gte("created_at", since).then((r: any) => r).catch(() => ({ data: null })),
      sb.from("qr_scan_events").select("scanned_at").eq("tenant_id", tenantId).gte("scanned_at", since).then((r: any) => r).catch(() => ({ data: null })),
      sb.from("addendums").select("status, customer_signed_at, products_snapshot, optional_selections, created_at").gte("created_at", since).then((r: any) => r).catch(() => ({ data: null })),
    ]);

    // Documents
    const docs = Array.isArray(docsRes?.data) ? docsRes.data : [];
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const genDay = dayBuckets(days);
    let printed = 0, published = 0, pendingApproval = 0;
    for (const d of docs) {
      byStatus[d.document_status] = (byStatus[d.document_status] || 0) + 1;
      byType[d.document_type] = (byType[d.document_type] || 0) + 1;
      if (d.printed_at) printed += 1;
      if (d.document_status === "published") published += 1;
      if (d.document_status === "pending_approval") pendingApproval += 1;
      const day = (d.created_at || "").slice(0, 10);
      if (day in genDay) genDay[day] += 1;
    }

    // QR
    const qr = Array.isArray(qrRes?.data) ? qrRes.data : [];
    const qrDay = dayBuckets(days);
    for (const e of qr) { const day = (e.scanned_at || "").slice(0, 10); if (day in qrDay) qrDay[day] += 1; }

    // Add-on acceptance from products_snapshot + optional_selections
    const adds = Array.isArray(addRes?.data) ? addRes.data : [];
    let packetsSigned = 0, acceptedAddonRevenue = 0;
    const stat: Record<string, { name: string; shown: number; accepted: number; declined: number; revenue: number }> = {};
    for (const a of adds) {
      if (a.signed_at || a.status === "signed") packetsSigned += 1;
      const products = Array.isArray(a.products_snapshot) ? a.products_snapshot : [];
      const sel = (a.optional_selections || {}) as Record<string, string>;
      for (const p of products) {
        if (p.badge_type !== "optional") continue;
        const k = p.id || p.name;
        if (!stat[k]) stat[k] = { name: p.name, shown: 0, accepted: 0, declined: 0, revenue: 0 };
        stat[k].shown += 1;
        if (sel[p.id] === "accept") { stat[k].accepted += 1; stat[k].revenue += Number(p.price) || 0; acceptedAddonRevenue += Number(p.price) || 0; }
        else if (sel[p.id] === "decline") stat[k].declined += 1;
      }
    }
    const addons: AddonStat[] = Object.entries(stat).map(([id, s]) => ({
      id, name: s.name, shown: s.shown, accepted: s.accepted, declined: s.declined,
      rate: (s.accepted + s.declined) > 0 ? Math.round((s.accepted / (s.accepted + s.declined)) * 100) : 0,
      revenue: s.revenue, avgPrice: s.accepted > 0 ? Math.round(s.revenue / s.accepted) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    setReport({
      loading: false,
      generated: docs.length, printed, published, pendingApproval,
      byStatus, byType,
      genByDay: Object.entries(genDay).map(([day, count]) => ({ day, count })),
      qrScans: qr.length,
      qrByDay: Object.entries(qrDay).map(([day, count]) => ({ day, count })),
      packetsSigned, acceptedAddonRevenue, addons,
    });
  }, [tenantId, days]);

  useEffect(() => { load(); }, [load]);
  return { ...report, reload: load };
}

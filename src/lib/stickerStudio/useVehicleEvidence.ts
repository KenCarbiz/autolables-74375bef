import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// Vehicle evidence timeline. Aggregates a vehicle's full document + compliance
// history from the domain tables (generated_documents milestones, qr_scan_events,
// addendums) plus the canonical audit_log rows that reference it. Read-only;
// reuses existing data — no new audit store. Tenant-scoped by RLS.
// ──────────────────────────────────────────────────────────────────────

export type EvidenceCategory = "document" | "signing" | "qr" | "vehicle" | "compliance" | "other";

export interface EvidenceEvent {
  id: string;
  at: string;                 // ISO timestamp
  category: EvidenceCategory;
  title: string;
  detail?: string;
  // deno-lint-ignore no-explicit-any
  raw?: Record<string, any>;  // surfaced in the detail drawer
  contentHash?: string | null;
}

const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "");

// Map an audit_log action to a timeline category.
function auditCategory(action: string): EvidenceCategory {
  if (action.includes("sign") || action.includes("packet")) return "signing";
  if (action.includes("scan") || action.includes("qr")) return "qr";
  if (action.includes("document") || action.includes("sticker") || action.includes("published") || action.includes("approved")) return "document";
  if (action.includes("compliance") || action.includes("override") || action.includes("recall")) return "compliance";
  return "other";
}

export function useVehicleEvidence(vehicleId?: string | null, vin?: string | null, tenantId?: string | null) {
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!vehicleId) { setLoading(false); return; }
    setLoading(true);
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;

    const [docsRes, qrRes, addRes, listRes, auditRes] = await Promise.all([
      sb.from("generated_documents").select("id, document_type, document_status, version, created_at, approved_at, printed_at, published_at, rejected_at, reject_reason, label_mode, template_id").eq("vehicle_id", vehicleId).then((r: any) => r).catch(() => ({ data: null })),
      sb.from("qr_scan_events").select("id, qr_code_id, user_agent, scanned_at").eq("vehicle_id", vehicleId).order("scanned_at", { ascending: false }).limit(25).then((r: any) => r).catch(() => ({ data: null })),
      vin ? sb.from("addendums").select("id, status, customer_signed_at, content_hash, customer_name, created_at, total_price").eq("vehicle_vin", vin).then((r: any) => r).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      sb.from("vehicle_listings").select("created_at, ymm").eq("id", vehicleId).maybeSingle().then((r: any) => r).catch(() => ({ data: null })),
      tenantId ? sb.from("audit_log").select("id, action, entity_type, entity_id, content_hash, user_email, ip_address, details, created_at").eq("store_id", tenantId).order("created_at", { ascending: false }).limit(400).then((r: any) => r).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ]);

    const ev: EvidenceEvent[] = [];

    // Documents — one event per lifecycle milestone.
    const docs = Array.isArray(docsRes?.data) ? docsRes.data : [];
    const docIds = new Set<string>();
    for (const d of docs) {
      docIds.add(d.id);
      const ty = cap(d.document_type);
      if (d.created_at) ev.push({ id: `${d.id}-gen`, at: d.created_at, category: "document", title: `${ty} v${d.version} generated`, detail: d.template_id, raw: d });
      if (d.approved_at) ev.push({ id: `${d.id}-app`, at: d.approved_at, category: "document", title: `${ty} v${d.version} approved`, raw: d });
      if (d.printed_at) ev.push({ id: `${d.id}-prt`, at: d.printed_at, category: "document", title: `${ty} v${d.version} printed`, raw: d });
      if (d.published_at) ev.push({ id: `${d.id}-pub`, at: d.published_at, category: "document", title: `${ty} v${d.version} published`, raw: d });
      if (d.rejected_at) ev.push({ id: `${d.id}-rej`, at: d.rejected_at, category: "compliance", title: `${ty} v${d.version} rejected`, detail: d.reject_reason || undefined, raw: d });
    }

    // QR scans — derive device/browser from user_agent; sticker_type not stored here.
    const uaDev = (ua?: string | null) => { const s = (ua || "").toLowerCase(); if (!s) return null; if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return "tablet"; if (/mobi|iphone|ipod|android/.test(s)) return "mobile"; return "desktop"; };
    const uaBr = (ua?: string | null) => { const s = (ua || "").toLowerCase(); if (!s) return null; if (/edg\//.test(s)) return "Edge"; if (/firefox|fxios/.test(s)) return "Firefox"; if (/chrome|crios/.test(s)) return "Chrome"; if (/safari/.test(s)) return "Safari"; return null; };
    for (const s of (Array.isArray(qrRes?.data) ? qrRes.data : [])) {
      ev.push({ id: `qr-${s.id}`, at: s.scanned_at, category: "qr", title: "QR scanned", detail: [uaDev(s.user_agent), uaBr(s.user_agent)].filter(Boolean).join(" · "), raw: s });
    }

    // Addendums / signing.
    for (const a of (Array.isArray(addRes?.data) ? addRes.data : [])) {
      if (a.created_at) ev.push({ id: `add-${a.id}`, at: a.created_at, category: "signing", title: "Addendum packet created", detail: a.total_price ? `$${Number(a.total_price).toLocaleString()}` : undefined, raw: a });
      if (a.customer_signed_at) ev.push({ id: `add-${a.id}-signed`, at: a.customer_signed_at, category: "signing", title: `Customer signed${a.customer_name ? ` — ${a.customer_name}` : ""}`, contentHash: a.content_hash, raw: a });
    }

    // Vehicle import.
    if (listRes?.data?.created_at) ev.push({ id: "veh-created", at: listRes.data.created_at, category: "vehicle", title: "Vehicle added to inventory", detail: listRes.data.ymm, raw: listRes.data });

    // Audit_log rows that reference this vehicle (by entity id, document id, or details.vehicle_id).
    for (const a of (Array.isArray(auditRes?.data) ? auditRes.data : [])) {
      const refsVehicle = a.entity_id === vehicleId || docIds.has(a.entity_id) || a.details?.vehicle_id === vehicleId;
      if (!refsVehicle) continue;
      ev.push({
        id: `audit-${a.id}`, at: a.created_at, category: auditCategory(a.action),
        title: cap(a.action), detail: a.user_email || undefined, contentHash: a.content_hash,
        raw: { ...a, ip_address: a.ip_address },
      });
    }

    // De-dupe (audit + domain can both record the same publish); keep domain.
    const seen = new Set<string>();
    const merged = ev
      .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
      .filter((e) => { const k = `${e.title}|${e.at.slice(0, 16)}`; if (seen.has(k)) return false; seen.add(k); return true; });

    setEvents(merged);
    setLoading(false);
  }, [vehicleId, vin, tenantId]);

  useEffect(() => { load(); }, [load]);
  return { events, loading, reload: load };
}

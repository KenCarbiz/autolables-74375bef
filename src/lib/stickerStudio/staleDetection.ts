import { supabase } from "@/integrations/supabase/client";
import type { DocumentRules } from "@/lib/documentRules";

// ──────────────────────────────────────────────────────────────────────
// Inventory change detection for generated documents. A document's
// data_snapshot froze the vehicle data when it was generated; comparing that
// against the LIVE vehicle_listings row surfaces stickers that may now be stale
// (price changed after print, VIN/stock drift, sold-but-published, etc.).
// Writes stale_document_flags for manager review. Honors the dealer's stale
// rules. Read-mostly + best-effort; never mutates signing data.
// ──────────────────────────────────────────────────────────────────────

export type Severity = "info" | "warning" | "compliance_block";

export interface StaleFinding {
  field: string;
  reason: string;
  severity: Severity;
  oldValue: unknown; // what the sticker shows
  newValue: unknown; // the live value
}

const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

// Compare a frozen sticker snapshot's data against the live vehicle row.
// deno-lint-ignore no-explicit-any
export function detectStale(snapshotData: any, live: any, rules: DocumentRules): StaleFinding[] {
  const f: StaleFinding[] = [];
  if (!snapshotData || !live) return f;
  // Live MSRP comes off the MarketCheck attribute blob; price/mileage are columns.
  const liveMsrp = live.mc_attributes?.msrp ?? live.msrp;
  const liveYmm = live.ymm;

  if (rules.staleOnPriceChange && snapshotData.price && live.price != null && num(snapshotData.price) !== num(live.price))
    f.push({ field: "price", reason: "Vehicle price changed after this sticker was generated.", severity: "warning", oldValue: num(snapshotData.price), newValue: num(live.price) });

  if (rules.staleOnMsrpChange && snapshotData.msrp && liveMsrp != null && num(snapshotData.msrp) !== num(liveMsrp))
    f.push({ field: "msrp", reason: "MSRP changed after this sticker was generated.", severity: "warning", oldValue: num(snapshotData.msrp), newValue: num(liveMsrp) });

  if (rules.staleOnMileageChange && snapshotData.mileage && live.mileage != null && num(snapshotData.mileage) !== num(live.mileage))
    f.push({ field: "mileage", reason: "Mileage changed after this sticker was generated.", severity: "warning", oldValue: num(snapshotData.mileage), newValue: num(live.mileage) });

  if (snapshotData.vin && live.vin && norm(snapshotData.vin) !== norm(live.vin))
    f.push({ field: "vin", reason: "VIN on the sticker no longer matches the vehicle.", severity: "compliance_block", oldValue: snapshotData.vin, newValue: live.vin });

  if (snapshotData.stock && live.stock_number && norm(snapshotData.stock) !== norm(live.stock_number))
    f.push({ field: "stock", reason: "Stock number changed.", severity: "warning", oldValue: snapshotData.stock, newValue: live.stock_number });

  // Only flag a material model-year change — a fuzzy title compare floods the
  // queue on harmless formatting/casing differences.
  const snapYear = (String(snapshotData.vehicleTitle || "").match(/\b(?:19|20)\d{2}\b/) || [])[0];
  const liveYear = (String(liveYmm || "").match(/\b(?:19|20)\d{2}\b/) || [])[0];
  if (snapYear && liveYear && snapYear !== liveYear)
    f.push({ field: "vehicle", reason: "Model year differs from the live vehicle.", severity: "warning", oldValue: snapshotData.vehicleTitle, newValue: liveYmm });

  if (rules.staleOnSoldRemoved && (live.status === "sold" || live.status === "removed" || live.is_active === false))
    f.push({ field: "status", reason: `Vehicle is ${live.status || "inactive"} but a sticker is still live.`, severity: "warning", oldValue: "active", newValue: live.status || "inactive" });

  return f;
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

// Re-check a vehicle's printed/published documents against the live row and
// upsert stale flags. Returns the number of open flags after reconciliation.
export async function reconcileVehicleStale(vehicleId: string, tenantId: string, rules: DocumentRules): Promise<number> {
  try {
    const [{ data: live }, { data: docs }] = await Promise.all([
      sb().from("vehicle_listings").select("*").eq("id", vehicleId).maybeSingle(),
      sb().from("generated_documents").select("id, data_snapshot, document_status")
        .eq("vehicle_id", vehicleId).in("document_status", ["approved", "printed", "published"]),
    ]);
    if (!live || !Array.isArray(docs)) return 0;

    let open = 0;
    for (const doc of docs) {
      const findings = detectStale(doc.data_snapshot?.data, live, rules);
      // Refresh: clear this document's OPEN flags, then re-insert current ones.
      // Reviewed/resolved/ignored flags are left intact as an audit trail.
      await sb().from("stale_document_flags").delete().eq("generated_document_id", doc.id).eq("status", "open").then((r: any) => r).catch(() => undefined);
      if (findings.length) {
        open += findings.length;
        await sb().from("stale_document_flags").insert(findings.map((fnd) => ({
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          generated_document_id: doc.id,
          severity: fnd.severity,
          reason: fnd.reason,
          changed_field: fnd.field,
          old_value: fnd.oldValue,
          new_value: fnd.newValue,
          status: "open",
        }))).then((r: any) => r).catch(() => undefined);
      }
    }
    return open;
  } catch { return 0; }
}

// Which published vehicles still lack an openable compliance form.
//
// Extracted from generate-vehicle-forms so the selection rule can be tested
// directly — index.ts calls Deno.serve at import time and cannot be loaded by
// the unit runner.
//
// The rule that matters: a document counts only when it points at a file. The
// bug this sweep exists to undo was testing row PRESENCE, which let a draft
// whose render was throttled away read as finished forever.

// deno-lint-ignore no-explicit-any
type Admin = any;

export const FORM_KINDS = ["buyers_guide", "k208"] as const;
export const FORM_CONDITIONS = ["used", "cpo", "certified"];
const RETIRED_STATUSES = '("superseded","archived","rejected")';
const CHUNK = 200;

export interface FormsSweepTarget {
  tenant_id: string;
  vin: string;
}

export async function findVehiclesNeedingForms(
  admin: Admin, tenantId: string | null, limit: number,
): Promise<FormsSweepTarget[]> {
  let q = admin.from("vehicle_listings")
    .select("id, tenant_id, vin, condition")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;

  const rows = ((data || []) as Array<{
    id: string; tenant_id: string | null; vin: string | null; condition: string | null;
  }>).filter((r) =>
    !!r.tenant_id && !!r.vin
    && FORM_CONDITIONS.includes(String(r.condition || "used").toLowerCase()));
  if (!rows.length) return [];

  // Chunked: a single `in` over a whole inventory builds a URL long enough to
  // be rejected by PostgREST.
  const filled = new Map<string, Set<string>>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    let dq = admin.from("generated_documents")
      .select("vehicle_id, document_type, online_url, pdf_url")
      .in("vehicle_id", ids)
      .in("document_type", FORM_KINDS as unknown as string[])
      .not("document_status", "in", RETIRED_STATUSES);
    if (tenantId) dq = dq.eq("tenant_id", tenantId);
    const { data: docs } = await dq;
    for (const d of (docs || []) as Array<{
      vehicle_id: string; document_type: string; online_url: string | null; pdf_url: string | null;
    }>) {
      // The whole point: an empty url is not a filed document.
      if (!d.online_url && !d.pdf_url) continue;
      if (!filled.has(d.vehicle_id)) filled.set(d.vehicle_id, new Set());
      filled.get(d.vehicle_id)!.add(String(d.document_type));
    }
  }

  return rows
    .filter((r) => {
      const have = filled.get(r.id);
      return !have || !FORM_KINDS.every((k) => have.has(k));
    })
    .map((r) => ({ tenant_id: String(r.tenant_id), vin: String(r.vin) }));
}

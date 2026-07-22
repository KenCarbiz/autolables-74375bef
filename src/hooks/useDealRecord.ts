import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// useDealRecord — assembles a vehicle's deal record live by tenant_id + vin:
// the accepted addendum, the K-208 safety inspection, the Get-Ready record, and
// the FTC Buyers Guide. There is no deals table; every source already carries
// tenant_id + vin (the Buyers Guide keys on the listing id). Returns each doc's
// completeness plus whether the deal has been processed/filed.

export interface DealRecord {
  addendum: { id: string; acceptedAt: string | null; sellingPrice: number | null; signed: boolean } | null;
  k208: { id: string; result: string | null; signedAt: string | null; certifiedAt: string | null; resultInitial: string | null } | null;
  getReady: { id: string; completeDate: string | null; detailSigned: boolean } | null;
  buyersGuide: { id: string; status: string; box: string | null } | null;
  processedAt: string | null;
  isUsed: boolean;
}

const USED = (c: string | null | undefined) => ["used", "cpo", "certified"].includes(String(c || "used").toLowerCase());

export function useDealRecord(vin?: string | null, listingId?: string | null, tenantId?: string | null) {
  const [record, setRecord] = useState<DealRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!vin || !tenantId) { setRecord(null); setLoading(false); return; }
    setLoading(true);
    const v = vin.toUpperCase().trim();
    // deno-lint-ignore no-explicit-any
    const q = supabase as any;
    const [listing, add, k208, gr, detail, bg] = await Promise.all([
      q.from("vehicle_listings").select("id, condition, deal_processed_at").eq("tenant_id", tenantId).eq("vin", v).maybeSingle(),
      q.from("addendums").select("id, accepted_at, selling_price, status, signed_at").eq("tenant_id", tenantId).eq("vehicle_vin", v).not("accepted_at", "is", null).order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
      q.from("safety_inspections").select("id, result, signed_at, result_initial, licensee_certified_at, licensee_name").eq("tenant_id", tenantId).eq("vin", v).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
      q.from("get_ready_records").select("id, get_ready_complete_date").eq("tenant_id", tenantId).eq("vin", v).limit(1).maybeSingle(),
      q.from("detail_signoffs").select("id").eq("tenant_id", tenantId).eq("vin", v).eq("status", "signed").limit(1).maybeSingle(),
      listingId
        ? q.from("generated_documents").select("id, document_status, data_snapshot").eq("tenant_id", tenantId).eq("vehicle_id", listingId).eq("document_type", "buyers_guide").order("created_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const cond = listing.data?.condition ?? null;
    setRecord({
      addendum: add.data ? { id: add.data.id, acceptedAt: add.data.accepted_at ?? null, sellingPrice: add.data.selling_price ?? null, signed: add.data.status === "signed" || !!add.data.signed_at } : null,
      k208: k208.data ? { id: k208.data.id, result: k208.data.result ?? null, signedAt: k208.data.signed_at ?? null, certifiedAt: k208.data.licensee_certified_at ?? null, resultInitial: k208.data.result_initial ?? null } : null,
      getReady: gr.data ? { id: gr.data.id, completeDate: gr.data.get_ready_complete_date ?? null, detailSigned: !!detail.data?.id } : null,
      buyersGuide: bg.data ? { id: bg.data.id, status: String(bg.data.document_status || ""), box: (bg.data.data_snapshot as { box?: string } | null)?.box ?? null } : null,
      processedAt: listing.data?.deal_processed_at ?? null,
      isUsed: USED(cond),
    });
    setLoading(false);
  }, [vin, listingId, tenantId]);

  useEffect(() => { load(); }, [load]);

  return { record, loading, reload: load };
}

// Which documents count as done for a completed deal.
export function dealDocStatus(r: DealRecord) {
  const addendum = !!r.addendum?.acceptedAt;
  const k208 = !!r.k208;
  const getReady = !!r.getReady && (!!r.getReady.completeDate || r.getReady.detailSigned);
  const buyersGuide = !!r.buyersGuide && ["approved", "printed", "published"].includes(r.buyersGuide.status);
  // Buyers Guide + K-208 only apply to used/CPO vehicles.
  const required = r.isUsed ? { addendum, k208, getReady, buyersGuide } : { addendum, getReady };
  const complete = Object.values(required).every(Boolean);
  return { addendum, k208, getReady, buyersGuide, complete };
}

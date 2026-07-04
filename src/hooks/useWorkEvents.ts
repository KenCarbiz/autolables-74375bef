import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hashPayload } from "@/lib/esign";

// Immutable work-event trail behind the QR mobile prep flow. Every submission
// INSERTS a locked row; corrections are new rows pointing back via
// correction_of. `available` goes false when the vehicle_work_events
// migration (20260705000000) hasn't been applied yet.

export type WorkEventType =
  | "initial_detail"
  | "reclean"
  | "service_install"
  | "protection_install"
  | "vendor_visit"
  | "manager_review"
  | "correction";

export type WorkEventStatus = "submitted" | "approved" | "rejected" | "corrected";

export interface WorkEventTask {
  label: string;
  done: boolean;
  photo_required: boolean;
  photo_urls: string[];
}

export interface WorkEvent {
  id: string;
  tenant_id: string;
  vin: string;
  listing_id: string | null;
  event_type: WorkEventType;
  visit_number: number | null;
  reason: string | null;
  ro_number: string | null;
  company_name: string | null;
  tech_name: string | null;
  tasks: WorkEventTask[];
  photos: string[];
  notes: string | null;
  signer_name: string | null;
  signature_data: string | null;
  signature_type: string | null;
  content_hash: string | null;
  user_agent: string | null;
  status: WorkEventStatus;
  locked: boolean;
  correction_of: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkEventInput {
  event_type: WorkEventType;
  reason?: string;
  ro_number?: string;
  company_name?: string;
  tech_name?: string;
  tasks?: WorkEventTask[];
  photos?: string[];
  notes?: string;
  signer_name: string;
  signature_data: string;
  signature_type?: string;
  status?: WorkEventStatus;
  correction_of?: string;
  listing_id?: string | null;
}

export const WORK_EVENT_LABELS: Record<WorkEventType, string> = {
  initial_detail: "Initial Inventory Detail",
  reclean: "Re-clean / Reclaim Detail",
  service_install: "Service Install",
  protection_install: "Protection / Addendum Install",
  vendor_visit: "Third-Party Vendor Visit",
  manager_review: "Manager Final Review",
  correction: "Correction Request",
};

export const workEventLabel = (e: Pick<WorkEvent, "event_type" | "visit_number">): string =>
  e.event_type === "vendor_visit" && e.visit_number
    ? `Third-Party Vendor Visit #${e.visit_number}`
    : WORK_EVENT_LABELS[e.event_type];

export const useWorkEvents = (tenantId: string | null, vin: string) => {
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId || !vin) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("vehicle_work_events")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("vin", vin.toUpperCase())
        .order("created_at", { ascending: false });
      setLoading(false);
      if (error) { setAvailable(false); return; }
      setAvailable(true);
      setEvents((data as WorkEvent[]) || []);
    } catch {
      setLoading(false);
      setAvailable(false);
    }
  }, [tenantId, vin]);

  useEffect(() => { load(); }, [load]);

  const createEvent = useCallback(
    async (input: WorkEventInput): Promise<{ event: WorkEvent | null; error: string | null }> => {
      if (!tenantId) return { event: null, error: "No dealership selected." };
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const visit_number =
        input.event_type === "vendor_visit"
          ? events.filter((e) => e.event_type === "vendor_visit").length + 1
          : null;
      const payload = {
        vin: vin.toUpperCase(),
        event_type: input.event_type,
        visit_number,
        reason: input.reason || null,
        ro_number: input.ro_number || null,
        company_name: input.company_name || null,
        tech_name: input.tech_name || null,
        tasks: input.tasks || [],
        photos: input.photos || [],
        notes: input.notes || null,
        signer_name: input.signer_name,
        signature_data: input.signature_data,
      };
      const content_hash = await hashPayload(payload);
      const { data, error } = await (supabase as any)
        .from("vehicle_work_events")
        .insert({
          tenant_id: tenantId,
          listing_id: input.listing_id || null,
          ...payload,
          signature_type: input.signature_type || "draw",
          content_hash,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          status: input.status || "submitted",
          locked: true,
          correction_of: input.correction_of || null,
          created_by: uid,
        })
        .select()
        .single();
      if (error) return { event: null, error: error.message || "Submit failed" };
      await load();
      return { event: data as WorkEvent, error: null };
    },
    [tenantId, vin, events, load]
  );

  // Client-side derivation: an event with a newer correction row pointing at
  // it reads as "needs correction" without ever mutating the locked original.
  const correctionTargets = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => { if (e.correction_of) set.add(e.correction_of); });
    return set;
  }, [events]);

  const approved = useMemo(
    () => events.some((e) => e.event_type === "manager_review" && e.status === "approved" && !correctionTargets.has(e.id)),
    [events, correctionTargets]
  );

  return { events, loading, available, reload: load, createEvent, correctionTargets, approved };
};

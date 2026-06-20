import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GeneratedDocument } from "./documentWorkflow";

// Loads generated_documents for one vehicle (tenant-scoped by RLS), newest
// first. Resilient: returns an empty list if the table isn't deployed yet, so
// the Vehicle File / Passport never hard-fail. `publicOnly` filters to the
// customer-visible statuses for the public passport.
export function useVehicleDocuments(vehicleId?: string | null, opts?: { publicOnly?: boolean }) {
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!vehicleId) { setLoading(false); return; }
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      let q = (supabase as any)
        .from("generated_documents")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false });
      if (opts?.publicOnly) q = q.in("document_status", ["approved", "printed", "published"]);
      const { data, error } = await q;
      setLoading(false);
      if (error) { setAvailable(false); return; }
      setAvailable(true);
      setDocuments((data || []) as GeneratedDocument[]);
    } catch { setLoading(false); setAvailable(false); }
  }, [vehicleId, opts?.publicOnly]);

  useEffect(() => { load(); }, [load]);

  return { documents, loading, available, reload: load };
}

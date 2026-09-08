import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "./useRealtimeInvalidate";
import type { Lead } from "@/types/tenant";

// ──────────────────────────────────────────────────────────────
// useLeads — Supabase-backed, TanStack-Query-wrapped (Wave 14.3).
//
// Was a hand-rolled useState/useEffect/load() pattern that
// refetched on every consumer mount. Now sits under TanStack
// Query so multiple consumers share one in-flight request, the
// cache survives unmount, and mutations invalidate downstream
// readers atomically. Public API shape is preserved so Admin.tsx
// doesn't need changes.
// ──────────────────────────────────────────────────────────────

const leadsKey = (storeId: string) => ["leads", storeId] as const;

export const useLeads = (storeId: string) => {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: leadsKey(storeId),
    queryFn: async (): Promise<Lead[]> => {
      const { data, error } = await (supabase as any)
        .from("leads")
        .select("*")
        .eq("store_id", storeId)
        .order("captured_at", { ascending: false });
      // supabase-js RESOLVES on a query error. Swallowing it here rendered an
      // RLS denial or a dropped connection as "no leads" — which on the
      // Customers screen reads as "nobody to call today".
      if (error) throw error;
      return ((data as Lead[]) || []);
    },
    enabled: !!storeId,
    staleTime: 30_000,
  });

  const leads = q.data ?? [];

  // The list is empty in BOTH states, so the failure has to say so out loud.
  useEffect(() => {
    if (!q.error) return;
    toast.error("Couldn't load your customer list — this is a load failure, not an empty list.", {
      id: `leads-load-error-${storeId}`,
    });
  }, [q.error, storeId]);

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: leadsKey(storeId) }),
    [qc, storeId],
  );

  // Cross-device sync: lot tablet / desktop / phone all see new
  // captures + status edits as they happen. RLS already scopes
  // the realtime stream to the tenant, and we add a store_id
  // filter so a multi-store dealer's other stores don't churn
  // this hook's cache.
  useRealtimeInvalidate({
    table: "leads",
    queryKey: leadsKey(storeId),
    filter: storeId ? `store_id=eq.${storeId}` : undefined,
    enabled: !!storeId,
  });

  const addLeadMutation = useMutation({
    mutationFn: async (
      data: Omit<Lead, "id" | "captured_at" | "updated_at">,
    ): Promise<Lead | null> => {
      const { data: row, error } = await (supabase as any)
        .from("leads")
        .insert({
          store_id: data.store_id,
          name: data.name,
          phone: data.phone,
          email: data.email,
          vehicle_interest: data.vehicle_interest,
          vehicle_vin: data.vehicle_vin,
          source: data.source,
          signing_url: data.signing_url,
          status: data.status,
          notes: data.notes,
        })
        .select()
        .single();
      if (error || !row) return null;
      return row as Lead;
    },
    onSuccess: invalidate,
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Lead> }) => {
      await (supabase as any).from("leads").update(updates).eq("id", id);
    },
    onSuccess: invalidate,
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("leads").delete().eq("id", id);
    },
    onSuccess: invalidate,
  });

  // Preserve the original API: callers expect addLead(data),
  // updateLead(id, updates), deleteLead(id). mutateAsync returns
  // the value so existing await callers keep working.
  const addLead = useCallback(
    (data: Omit<Lead, "id" | "captured_at" | "updated_at">) =>
      addLeadMutation.mutateAsync(data),
    [addLeadMutation],
  );
  const updateLead = useCallback(
    (id: string, updates: Partial<Lead>) =>
      updateLeadMutation.mutateAsync({ id, updates }),
    [updateLeadMutation],
  );
  const deleteLead = useCallback(
    (id: string) => deleteLeadMutation.mutateAsync(id),
    [deleteLeadMutation],
  );

  const exportCsv = useMemo(
    () => () => {
      const header = "Name,Phone,Email,Vehicle,VIN,Source,Status,Captured At";
      const rows = leads.map((l) =>
        `"${l.name}","${l.phone}","${l.email}","${l.vehicle_interest}","${l.vehicle_vin}","${l.source}","${l.status}","${l.captured_at}"`,
      );
      return [header, ...rows].join("\n");
    },
    [leads],
  );

  return { leads, loading: q.isLoading, error: q.error, isError: q.isError, addLead, updateLead, deleteLead, exportCsv };
};

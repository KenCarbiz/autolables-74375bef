import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
      const { data } = await (supabase as any)
        .from("leads")
        .select("*")
        .eq("store_id", storeId)
        .order("captured_at", { ascending: false });
      return ((data as Lead[]) || []);
    },
    enabled: !!storeId,
    staleTime: 30_000,
  });

  const leads = q.data ?? [];
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: leadsKey(storeId) }),
    [qc, storeId],
  );

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

  return { leads, loading: q.isLoading, addLead, updateLead, deleteLead, exportCsv };
};

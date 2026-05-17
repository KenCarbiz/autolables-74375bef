import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WarrantyRecord } from "@/types/tenant";

// ──────────────────────────────────────────────────────────────
// useWarranty — Supabase-backed (Wave 13a).
//
// Was localStorage-only. Now reads/writes public.warranty_records
// (migration 20260517020000). The WarrantyRecord shape already
// uses snake_case columns, so no field mapping is needed between
// DB and client.
//
// Mutation methods are async; existing consumers in Admin.tsx
// only read `records` and call the sync getExpiringSoon(), so
// the async surface change is invisible to them.
// ──────────────────────────────────────────────────────────────

export const useWarranty = (storeId: string) => {
  const [records, setRecords] = useState<WarrantyRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("warranty_records")
      .select("*")
      .order("created_at", { ascending: false });
    const all = (data as WarrantyRecord[]) || [];
    setRecords(storeId ? all.filter(r => r.store_id === storeId) : all);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const addRecord = async (data: Omit<WarrantyRecord, "id" | "created_at">): Promise<WarrantyRecord | null> => {
    const { data: row, error } = await (supabase as any)
      .from("warranty_records")
      .insert(data)
      .select("*")
      .single();
    if (error || !row) return null;
    await load();
    return row as WarrantyRecord;
  };

  const updateRecord = async (id: string, updates: Partial<WarrantyRecord>) => {
    await (supabase as any)
      .from("warranty_records")
      .update(updates)
      .eq("id", id);
    await load();
  };

  const deleteRecord = async (id: string) => {
    await (supabase as any)
      .from("warranty_records")
      .delete()
      .eq("id", id);
    await load();
  };

  const getExpiringSoon = (days: number = 30) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    return records.filter(r => r.status === "active" && new Date(r.warranty_end) <= cutoff);
  };

  return { records, loading, addRecord, updateRecord, deleteRecord, getExpiringSoon };
};

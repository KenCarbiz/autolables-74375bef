import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DerivedInvoice, InvoiceLine } from "@/lib/invoices";
import { nextInvoiceNumber } from "@/lib/invoices";

// Supabase-backed installer invoices (replaces the localStorage useInvoices).
// Each row freezes the line items derived from a get_ready_records row at the
// moment the dealer marks the vehicle invoiced; `available` goes false when
// the get_ready_invoices migration hasn't been applied yet.

export interface InstallerInvoiceRow {
  id: string;
  get_ready_record_id: string;
  vin: string;
  ymm: string;
  stock_number: string;
  ro_number: string;
  invoice_number: string;
  line_items: InvoiceLine[];
  total: number;
  status: "invoiced" | "paid";
  invoiced_at: string;
  paid_at: string | null;
}

export const useInstallerInvoices = (tenantId: string | null) => {
  const [rows, setRows] = useState<InstallerInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("get_ready_invoices")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      setLoading(false);
      if (error) { setAvailable(false); return; }
      setAvailable(true);
      setRows((data as InstallerInvoiceRow[]) || []);
    } catch {
      setLoading(false);
      setAvailable(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const markInvoiced = useCallback(async (derived: DerivedInvoice): Promise<boolean> => {
    if (!tenantId) return false;
    const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    const { error } = await (supabase as any).from("get_ready_invoices").insert({
      tenant_id: tenantId,
      get_ready_record_id: derived.recordId,
      vin: derived.vin,
      ymm: derived.ymm,
      stock_number: derived.stockNumber,
      ro_number: derived.roNumber,
      invoice_number: nextInvoiceNumber(derived.vin, rows.map((r) => r.invoice_number)),
      line_items: derived.lines,
      total: derived.total,
      status: "invoiced",
      created_by: uid,
    });
    if (error) return false;
    await load();
    return true;
  }, [tenantId, rows, load]);

  const markPaid = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await (supabase as any)
      .from("get_ready_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return false;
    await load();
    return true;
  }, [load]);

  return { rows, loading, available, reload: load, markInvoiced, markPaid };
};

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// usePrepSignOff — shop foreman sign-off that a vehicle has been
// prepped AND every accessory has been installed BEFORE it can be
// listed for sale. This is the compliance gate — no sign-off,
// no public listing, no sale.
// ──────────────────────────────────────────────────────────────

export interface InstalledAccessory {
  product_id: string;
  product_name: string;
  installed_date: string;
  installed_by: string;
  photo_urls: string[];
}

export interface InstallPhoto {
  url: string;
  caption?: string;
  category: "before" | "after" | "defect" | "reference";
  uploaded_at: string;
}

export type PrepSignOffStatus = "pending" | "signed" | "rejected" | "overridden";

export interface PrepSignOff {
  id: string;
  store_id: string;
  vin: string;
  stock_number: string | null;
  ymm: string | null;
  get_ready_record_id: string | null;
  accessories_installed: InstalledAccessory[];
  inspection_passed: boolean;
  inspection_form_type: string | null;
  install_photos: InstallPhoto[];
  foreman_name: string;
  foreman_signature_data: string | null;
  foreman_ip: string | null;
  signed_at: string | null;
  status: PrepSignOffStatus;
  rejection_reason: string | null;
  listing_unlocked: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const usePrepSignOff = (storeId: string) => {
  const [signOffs, setSignOffs] = useState<PrepSignOff[]>([]);
  // True until the first read settles, so counts never render as a zero.
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("prep_sign_offs")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false });
    setSignOffs((data as PrepSignOff[]) || []);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const createSignOff = useCallback(
    async (input: {
      vin: string;
      stock_number?: string;
      ymm?: string;
      get_ready_record_id?: string;
      accessories_installed: InstalledAccessory[];
      inspection_passed?: boolean;
      inspection_form_type?: string;
      install_photos?: InstallPhoto[];
      foreman_name: string;
      notes?: string;
      createdBy?: string | null;
    }) => {
      const { data, error } = await (supabase as any)
        .from("prep_sign_offs")
        .insert({
          store_id: storeId,
          vin: input.vin,
          stock_number: input.stock_number || null,
          ymm: input.ymm || null,
          get_ready_record_id: input.get_ready_record_id || null,
          accessories_installed: input.accessories_installed,
          inspection_passed: !!input.inspection_passed,
          inspection_form_type: input.inspection_form_type || null,
          install_photos: input.install_photos || [],
          foreman_name: input.foreman_name,
          status: "pending",
          notes: input.notes || null,
          created_by: input.createdBy || null,
        })
        .select()
        .single();
      if (!error) await load();
      return { data: data as PrepSignOff | null, error };
    },
    [storeId, load]
  );

  const signOff = useCallback(
    async (
      id: string,
      args: { foremanSignatureData: string; foremanIp?: string | null; notes?: string }
    ) => {
      const { error } = await (supabase as any)
        .from("prep_sign_offs")
        .update({
          foreman_signature_data: args.foremanSignatureData,
          foreman_ip: args.foremanIp || null,
          signed_at: new Date().toISOString(),
          status: "signed",
          listing_unlocked: true,
          notes: args.notes || null,
        })
        .eq("id", id);
      if (!error) await load();
      return !error;
    },
    [load]
  );

  const reject = useCallback(
    async (id: string, rejection_reason: string) => {
      const { error } = await (supabase as any)
        .from("prep_sign_offs")
        .update({ status: "rejected", rejection_reason, listing_unlocked: false })
        .eq("id", id);
      if (!error) await load();
      return !error;
    },
    [load]
  );

  const override = useCallback(
    async (id: string, args: { overriderName: string; reason: string }) => {
      const { error } = await (supabase as any)
        .from("prep_sign_offs")
        .update({
          status: "overridden",
          listing_unlocked: true,
          notes: `OVERRIDE by ${args.overriderName}: ${args.reason}`,
          signed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (!error) await load();
      return !error;
    },
    [load]
  );

  const getByVin = useCallback(
    (vin: string): PrepSignOff | null => signOffs.find((s) => s.vin === vin) || null,
    [signOffs]
  );

  // The compliance gate. Public listing creation / publication should call this first.
  const isListingAllowed = useCallback(
    (vin: string): { allowed: boolean; reason: string } => {
      const record = signOffs.find((s) => s.vin === vin);
      if (!record) {
        return { allowed: false, reason: "No prep sign-off exists for this VIN." };
      }
      if (!record.listing_unlocked) {
        return {
          allowed: false,
          reason:
            record.status === "rejected"
              ? `Sign-off rejected: ${record.rejection_reason || "see notes"}`
              : "Awaiting shop foreman sign-off.",
        };
      }
      const uninstalled = record.accessories_installed.filter((a) => !a.installed_date);
      if (uninstalled.length > 0) {
        return {
          allowed: false,
          reason: `${uninstalled.length} accessory(ies) not yet installed: ${uninstalled.map((a) => a.product_name).join(", ")}`,
        };
      }
      return { allowed: true, reason: "Prepped, installed, and signed off." };
    },
    [signOffs]
  );

  const pending = signOffs.filter((s) => s.status === "pending");
  const ready = signOffs.filter((s) => s.listing_unlocked);

  return {
    signOffs,
    pending,
    ready,
    loading,
    load,
    createSignOff,
    signOff,
    reject,
    override,
    getByVin,
    isListingAllowed,
  };
};

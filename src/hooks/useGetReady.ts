import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useGetReady — Supabase-backed (Wave 13a).
//
// Was localStorage-only. Now reads/writes public.get_ready_records
// (migration 20260517020000), mirroring the Wave 10 vehicle_files
// pattern: parent row + JSONB nested arrays (items,
// accessories_to_install) so the workflow stays close to the
// existing client shape and the timeline panel is one round-trip.
//
// Public types stay camelCase (consumer files in Admin.tsx and
// PrepSignOff.tsx read record.acquiredDate etc.); the hook maps
// to snake_case columns internally via fromDb().
// ──────────────────────────────────────────────────────────────

export type GetReadyStatus = "pending" | "in_progress" | "inspection" | "detail" | "photo" | "ready" | "inventory";

export type InstallMethod = "internal_ro" | "third_party_check_request";

export interface CheckRequest {
  id: string;
  vendorName: string;
  vendorContact: string;
  vendorPhone: string;
  vendorEmail: string;
  poNumber: string;
  amount: number;
  description: string;
  vehicleVin: string;
  vehicleYmm: string;
  stockNumber: string;
  status: "pending" | "submitted" | "approved" | "paid";
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  createdAt: string;
}

export interface GetReadyItem {
  id: string;
  label: string;
  category: "accessory" | "inspection" | "detail" | "photo" | "other";
  assignedTo: string;
  status: "pending" | "complete";
  completedAt?: string;
  completedBy?: string;
  notes?: string;
  installMethod?: InstallMethod;
  roNumber?: string;
  checkRequest?: CheckRequest;
}

export interface AccessoryToInstall {
  productId: string;
  productName: string;
  installed: boolean;
  installedDate?: string;
  installedBy?: string;
  // Wave 17 — installer proof artifact. install_photos[] holds
  // Supabase Storage public URLs (bucket: accessory-install-photos).
  // installer_signature_data is base64 PNG OR typed name (matching
  // the addendum_signings.signature_data shape). Both feed the
  // Audit-Defense Packet so a regulator can see "this dealer
  // proves the accessory was on the vehicle before sale, with
  // an installer signature and timestamp."
  install_photos?: string[];
  installer_signature_data?: string;
  installer_signature_type?: "draw" | "type";
}

export interface GetReadyRecord {
  id: string;
  storeId: string;
  vin: string;
  stockNumber: string;
  ymm: string;
  condition: "new" | "used";

  acquiredDate: string;
  getReadyStartDate: string;
  getReadyCompleteDate: string;
  inventoryDate: string;

  items: GetReadyItem[];
  accessoriesToInstall: AccessoryToInstall[];

  inspectionRequired: boolean;
  inspectionFormType?: string;
  inspectionComplete: boolean;
  inspectionDate?: string;
  inspectionBy?: string;
  inspectionSignatureData?: string;
  autocurbInspectionId?: string;

  assignedTechnician: string;
  serviceAdvisor: string;
  roNumber: string;

  status: GetReadyStatus;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// Internal DB row shape (snake_case). Kept private to this hook.
interface DbRow {
  id: string;
  store_id: string | null;
  vin: string;
  stock_number: string;
  ymm: string;
  condition: "new" | "used";
  acquired_date: string | null;
  get_ready_start_date: string | null;
  get_ready_complete_date: string | null;
  inventory_date: string | null;
  items: GetReadyItem[];
  accessories_to_install: AccessoryToInstall[];
  inspection_required: boolean;
  inspection_form_type: string | null;
  inspection_complete: boolean;
  inspection_date: string | null;
  inspection_by: string | null;
  inspection_signature_data: string | null;
  autocurb_inspection_id: string | null;
  assigned_technician: string;
  service_advisor: string;
  ro_number: string;
  status: GetReadyStatus;
  created_at: string;
  created_by: string;
  updated_at: string;
}

const fromDb = (r: DbRow): GetReadyRecord => ({
  id: r.id,
  storeId: r.store_id || "",
  vin: r.vin,
  stockNumber: r.stock_number,
  ymm: r.ymm,
  condition: r.condition,
  acquiredDate: r.acquired_date || "",
  getReadyStartDate: r.get_ready_start_date || "",
  getReadyCompleteDate: r.get_ready_complete_date || "",
  inventoryDate: r.inventory_date || "",
  items: r.items || [],
  accessoriesToInstall: r.accessories_to_install || [],
  inspectionRequired: r.inspection_required,
  inspectionFormType: r.inspection_form_type ?? undefined,
  inspectionComplete: r.inspection_complete,
  inspectionDate: r.inspection_date ?? undefined,
  inspectionBy: r.inspection_by ?? undefined,
  inspectionSignatureData: r.inspection_signature_data ?? undefined,
  autocurbInspectionId: r.autocurb_inspection_id ?? undefined,
  assignedTechnician: r.assigned_technician,
  serviceAdvisor: r.service_advisor,
  roNumber: r.ro_number,
  status: r.status,
  createdAt: r.created_at,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

export const useGetReady = (storeId: string) => {
  const [records, setRecords] = useState<GetReadyRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("get_ready_records")
      .select("*")
      .order("updated_at", { ascending: false });
    const all = ((data as DbRow[]) || []).map(fromDb);
    setRecords(storeId ? all.filter(r => r.storeId === storeId) : all);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const createGetReady = async (data: {
    vin: string;
    stockNumber: string;
    ymm: string;
    condition: "new" | "used";
    acquiredDate: string;
    accessoriesToInstall: { productId: string; productName: string }[];
    inspectionRequired: boolean;
    inspectionFormType?: string;
    assignedTechnician?: string;
    serviceAdvisor?: string;
    roNumber?: string;
    createdBy: string;
  }): Promise<GetReadyRecord | null> => {
    const now = new Date().toISOString();

    // Build default checklist — same logic the localStorage
    // version used so saved records read identically across the
    // migration boundary.
    const items: GetReadyItem[] = [];
    data.accessoriesToInstall.forEach(acc => {
      items.push({
        id: crypto.randomUUID(),
        label: `Install: ${acc.productName}`,
        category: "accessory",
        assignedTo: data.assignedTechnician || "",
        status: "pending",
      });
    });
    if (data.inspectionRequired) {
      items.push({
        id: crypto.randomUUID(),
        label: `Safety Inspection${data.inspectionFormType ? ` (${data.inspectionFormType})` : ""}`,
        category: "inspection",
        assignedTo: data.serviceAdvisor || "",
        status: "pending",
      });
    }
    items.push(
      { id: crypto.randomUUID(), label: "Detail — interior", category: "detail", assignedTo: "", status: "pending" },
      { id: crypto.randomUUID(), label: "Detail — exterior wash", category: "detail", assignedTo: "", status: "pending" },
      { id: crypto.randomUUID(), label: "Photos for listing", category: "photo", assignedTo: "", status: "pending" },
    );

    const accessories: AccessoryToInstall[] = data.accessoriesToInstall.map(a => ({
      ...a,
      installed: false,
    }));

    const { data: row, error } = await (supabase as any)
      .from("get_ready_records")
      .insert({
        store_id: storeId || null,
        vin: data.vin,
        stock_number: data.stockNumber,
        ymm: data.ymm,
        condition: data.condition,
        acquired_date: data.acquiredDate || null,
        get_ready_start_date: now,
        items,
        accessories_to_install: accessories,
        inspection_required: data.inspectionRequired,
        inspection_form_type: data.inspectionFormType || null,
        assigned_technician: data.assignedTechnician || "",
        service_advisor: data.serviceAdvisor || "",
        ro_number: data.roNumber || "",
        status: "pending",
        created_by: data.createdBy,
      })
      .select("*")
      .single();
    if (error || !row) return null;
    await load();
    return fromDb(row as DbRow);
  };

  const completeItem = async (recordId: string, itemId: string, completedBy: string) => {
    const { data: row } = await (supabase as any)
      .from("get_ready_records")
      .select("*")
      .eq("id", recordId)
      .single();
    if (!row) return;
    const items: GetReadyItem[] = (row.items as GetReadyItem[]).map(i =>
      i.id === itemId
        ? { ...i, status: "complete", completedAt: new Date().toISOString(), completedBy }
        : i
    );
    const allComplete = items.every(i => i.status === "complete");
    await (supabase as any)
      .from("get_ready_records")
      .update({
        items,
        status: allComplete ? "ready" : "in_progress",
        get_ready_complete_date: allComplete ? new Date().toISOString() : row.get_ready_complete_date,
      })
      .eq("id", recordId);
    await load();
  };

  const markInventory = async (recordId: string) => {
    const { data: row } = await (supabase as any)
      .from("get_ready_records")
      .select("status")
      .eq("id", recordId)
      .single();
    if (!row || row.status !== "ready") return;
    await (supabase as any)
      .from("get_ready_records")
      .update({
        inventory_date: new Date().toISOString(),
        status: "inventory",
      })
      .eq("id", recordId);
    await load();
  };

  const completeInspection = async (
    recordId: string,
    data: {
      inspectedBy: string;
      signatureData?: string;
      autocurbInspectionId?: string;
    },
  ) => {
    const { data: row } = await (supabase as any)
      .from("get_ready_records")
      .select("items")
      .eq("id", recordId)
      .single();
    if (!row) return;
    const items: GetReadyItem[] = (row.items as GetReadyItem[]).map(i =>
      i.category === "inspection"
        ? {
            ...i,
            status: "complete",
            completedAt: new Date().toISOString(),
            completedBy: data.inspectedBy,
          }
        : i
    );
    await (supabase as any)
      .from("get_ready_records")
      .update({
        inspection_complete: true,
        inspection_date: new Date().toISOString(),
        inspection_by: data.inspectedBy,
        inspection_signature_data: data.signatureData || null,
        autocurb_inspection_id: data.autocurbInspectionId || null,
        items,
      })
      .eq("id", recordId);
    await load();
  };

  // Wave 17 — install proof. The caller can attach photo URLs
  // (uploaded to the accessory-install-photos Storage bucket
  // before this call) and an installer signature (base64 PNG
  // or typed name). Backward-compatible: the older 3-arg call
  // still works because every new field is optional.
  const markAccessoryInstalled = async (
    recordId: string,
    productId: string,
    installedBy: string,
    proof?: {
      photos?: string[];
      signature_data?: string;
      signature_type?: "draw" | "type";
    },
  ) => {
    const { data: row } = await (supabase as any)
      .from("get_ready_records")
      .select("items, accessories_to_install")
      .eq("id", recordId)
      .single();
    if (!row) return;
    const accessories: AccessoryToInstall[] = (row.accessories_to_install as AccessoryToInstall[]) || [];
    const acc = accessories.find(a => a.productId === productId);
    if (!acc) return;
    const nextAccessories: AccessoryToInstall[] = accessories.map(a =>
      a.productId === productId
        ? {
            ...a,
            installed: true,
            installedDate: new Date().toISOString(),
            installedBy,
            // Merge photos with any previously uploaded ones so
            // a second install pass can append rather than
            // overwrite (e.g. dealer adds wheel photos after
            // initial body-protection photos).
            install_photos: [...(a.install_photos || []), ...(proof?.photos || [])],
            installer_signature_data: proof?.signature_data ?? a.installer_signature_data,
            installer_signature_type: proof?.signature_type ?? a.installer_signature_type,
          }
        : a
    );
    const items: GetReadyItem[] = (row.items as GetReadyItem[]).map(i =>
      i.category === "accessory" && i.label === `Install: ${acc.productName}`
        ? {
            ...i,
            status: "complete",
            completedAt: new Date().toISOString(),
            completedBy: installedBy,
          }
        : i
    );
    await (supabase as any)
      .from("get_ready_records")
      .update({ accessories_to_install: nextAccessories, items })
      .eq("id", recordId);
    await load();
  };

  const setInstallMethod = async (
    recordId: string,
    itemId: string,
    method: InstallMethod,
    data?: {
      roNumber?: string;
      checkRequest?: Omit<CheckRequest, "id" | "createdAt">;
    },
  ) => {
    const { data: row } = await (supabase as any)
      .from("get_ready_records")
      .select("items")
      .eq("id", recordId)
      .single();
    if (!row) return;
    const items: GetReadyItem[] = (row.items as GetReadyItem[]).map(i => {
      if (i.id !== itemId) return i;
      const next: GetReadyItem = { ...i, installMethod: method };
      if (method === "internal_ro" && data?.roNumber) {
        next.roNumber = data.roNumber;
      }
      if (method === "third_party_check_request" && data?.checkRequest) {
        next.checkRequest = {
          ...data.checkRequest,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
      }
      return next;
    });
    await (supabase as any)
      .from("get_ready_records")
      .update({ items })
      .eq("id", recordId);
    await load();
  };

  const getByVin = (vin: string): GetReadyRecord | null =>
    records.find(r => r.vin === vin) || null;

  const getPending = (): GetReadyRecord[] =>
    records.filter(r => r.status !== "inventory");

  const getPendingCheckRequests = (): { record: GetReadyRecord; item: GetReadyItem; checkRequest: CheckRequest }[] => {
    const results: { record: GetReadyRecord; item: GetReadyItem; checkRequest: CheckRequest }[] = [];
    for (const record of records) {
      for (const item of record.items) {
        if (item.checkRequest && item.checkRequest.status !== "paid") {
          results.push({ record, item, checkRequest: item.checkRequest });
        }
      }
    }
    return results;
  };

  // Timeline validation — the compliance chain.
  // Acquired -> Get-Ready Start -> Accessories Installed
  //         -> Get-Ready Complete -> Inventory.
  const validateTimeline = (record: GetReadyRecord): {
    valid: boolean;
    warnings: string[];
    chain: { step: string; date: string; ok: boolean }[];
  } => {
    const warnings: string[] = [];

    const acquired = record.acquiredDate ? new Date(record.acquiredDate) : null;
    const getReadyStart = record.getReadyStartDate ? new Date(record.getReadyStartDate) : null;
    const getReadyComplete = record.getReadyCompleteDate ? new Date(record.getReadyCompleteDate) : null;
    const inventory = record.inventoryDate ? new Date(record.inventoryDate) : null;

    const installDates = record.accessoriesToInstall
      .filter(a => a.installedDate)
      .map(a => new Date(a.installedDate!));
    const earliestInstall = installDates.length > 0
      ? new Date(Math.min(...installDates.map(d => d.getTime())))
      : null;
    const latestInstall = installDates.length > 0
      ? new Date(Math.max(...installDates.map(d => d.getTime())))
      : null;

    const chain: { step: string; date: string; ok: boolean }[] = [
      { step: "Vehicle Acquired",   date: record.acquiredDate || "Not set", ok: !!acquired },
      { step: "Get-Ready Started",  date: record.getReadyStartDate || "Not set", ok: !!getReadyStart },
    ];

    if (earliestInstall) {
      chain.push({ step: "First Accessory Installed", date: earliestInstall.toISOString(), ok: true });
    }
    if (latestInstall) {
      chain.push({ step: "Last Accessory Installed",  date: latestInstall.toISOString(),  ok: true });
    }
    if (record.inspectionDate) {
      chain.push({ step: "Safety Inspection", date: record.inspectionDate, ok: true });
    }

    chain.push({ step: "Get-Ready Complete",        date: record.getReadyCompleteDate || "Pending", ok: !!getReadyComplete });
    chain.push({ step: "Ready for Sale (Inventory)", date: record.inventoryDate || "Pending",       ok: !!inventory });

    if (acquired && getReadyStart && getReadyStart < acquired) {
      warnings.push("Get-ready start date is BEFORE acquisition date.");
    }
    if (acquired && earliestInstall && earliestInstall < acquired) {
      warnings.push("Accessories installed BEFORE vehicle was acquired.");
    }
    if (getReadyComplete && inventory && getReadyComplete > inventory) {
      warnings.push("Get-ready completed AFTER inventory date — accessories may have been installed after vehicle was listed for sale.");
    }
    if (latestInstall && inventory && latestInstall > inventory) {
      warnings.push("Accessories installed AFTER inventory date — this is a compliance risk.");
    }
    if (inventory && !getReadyComplete) {
      warnings.push("Vehicle in inventory but get-ready not marked complete.");
    }

    const uninstalled = record.accessoriesToInstall.filter(a => !a.installed);
    if (inventory && uninstalled.length > 0) {
      warnings.push(
        `${uninstalled.length} accessory(ies) not yet installed but vehicle is in inventory: ${uninstalled.map(a => a.productName).join(", ")}`,
      );
    }

    return {
      valid: warnings.length === 0,
      warnings,
      chain,
    };
  };

  return {
    records,
    loading,
    createGetReady,
    completeItem,
    markInventory,
    completeInspection,
    markAccessoryInstalled,
    getByVin,
    getPending,
    setInstallMethod,
    getPendingCheckRequests,
    validateTimeline,
  };
};

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { vinKey, vinKeys } from "@/lib/vinKeys";

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

// Routing target for a get-ready work item. "vendor" = a third-party
// aftermarket provider (door edge guards, tint, etc.); dispatch emails the
// assigned vendor. Service = shop / K-208; Detail = in-house detail + installs.
export type GetReadyDepartment = "service" | "detail" | "vendor";

export interface GetReadyItem {
  id: string;
  label: string;
  category: "accessory" | "inspection" | "detail" | "photo" | "service" | "other";
  assignedTo: string;
  status: "pending" | "complete";
  completedAt?: string;
  completedBy?: string;
  notes?: string;
  installMethod?: InstallMethod;
  roNumber?: string;
  checkRequest?: CheckRequest;
  // Which department this line routes to when the manager transmits the
  // get-ready. Used by notify-getready to fan out only to depts with work.
  department?: GetReadyDepartment;
  // For department === "vendor": the assigned third-party provider notified on
  // dispatch (a lightweight routing target; the CheckRequest carries PO/payment).
  vendorName?: string;
  vendorEmail?: string;
  // Internal (non-customer) recon/service line with its dealer cost. These
  // never appear on the customer addendum — they are the store's own cost.
  cost?: number;
  internal?: boolean;
  // Evidence photos attached from the service workspace (public storage URLs).
  photos?: string[];
}

// Default routing when an item has no explicit department (older records /
// seeded lines): inspection + service → Service, everything else → Detail.
export const defaultDepartmentFor = (category: GetReadyItem["category"]): GetReadyDepartment =>
  category === "inspection" || category === "service" ? "service" : "detail";

export const itemDepartment = (item: GetReadyItem): GetReadyDepartment =>
  item.department ?? defaultDepartmentFor(item.category);

// Whether the line is work a THIRD PARTY performs. This is the one fact behind
// both halves of vendor handling — the "Pending Proof" pill and five-business-day
// proof clock the manager reads, and the vendor work order dispatch actually
// sends — so it lives beside GetReadyItem and both sides import it. Reading
// `department === "vendor"` on the dispatch side while the display read this
// predicate meant an accessory carrying a vendorName + vendorEmail but no
// explicit department (createGetReady defaults accessories to "detail") was
// listed under Vendor Assignments with a live Contact button and a proof clock,
// and was never emailed — while the authorization it belonged to was recorded,
// so the send could never be retried.
//
// installMethod is the row's own statement about who does the work, so it wins.
// Otherwise an explicit vendor department, then an actual vendor assignment.
export function isThirdPartyItem(item: GetReadyItem): boolean {
  if (item.installMethod === "third_party_check_request") return true;
  if (item.installMethod === "internal_ro") return false;
  if (itemDepartment(item) === "vendor") return true;
  return !!(item.vendorName || item.vendorEmail || item.checkRequest);
}

// The set of departments that actually have pending work — drives the dispatch
// fan-out so only those departments (and assigned vendors) are notified.
export const departmentsWithWork = (items: GetReadyItem[]): GetReadyDepartment[] => {
  const set = new Set<GetReadyDepartment>();
  for (const it of items) if (it.status !== "complete") set.add(itemDepartment(it));
  return Array.from(set);
};

export interface GetReadyVendor {
  /** vendorName when the row carries one; every vendor still gets a name. */
  name: string;
  /** The raw GetReadyItem category; callers humanize it for display. */
  category: GetReadyItem["category"];
  email: string | null;
  /** At least one of this vendor's lines is still outstanding. */
  pending: boolean;
}

// THE vendor list for a get-ready, for the screen that DISPLAYS the assignments
// and the dispatcher that EMAILS them alike.
//
// They used to be two rules keyed on two different fields: the display required
// `vendorName.trim()`, the dispatch required `vendorEmail`. StartGetReadyModal
// renders a department select and a vendor EMAIL input and no vendorName field
// at all for accessories (:241-251), so routing an accessory to "Third-party
// vendor" printed "No vendors assigned to this vehicle" on the screen while
// authorizeAndDispatch emailed that address — displayed 0, emailed 1, and the
// authorization is one-shot so it could never be re-sent.
//
// The display name given to a vendor the record identifies only by email —
// StartGetReadyModal collects no vendorName for accessories or services. Named
// here rather than spelled as a literal on each side, because the command
// surface has to know that this string is a placeholder and not a company
// anyone can be matched by.
export const VENDOR_PLACEHOLDER_NAME = "Vendor";

// One key (email, else name, else the row itself, so two unassigned lines are
// not silently merged) and one membership test, narrowed by name at the call
// site: dispatch takes `.pending` lines that carry an email.
export function vendorsFor(items: GetReadyItem[]): GetReadyVendor[] {
  const out = new Map<string, GetReadyVendor>();
  for (const i of items) {
    if (!isThirdPartyItem(i)) continue;
    const name = (i.vendorName || "").trim();
    const email = (i.vendorEmail || "").trim();
    const key = email.toLowerCase() || name.toLowerCase() || `item:${i.id}`;
    const pending = i.status !== "complete";
    const existing = out.get(key);
    if (existing) {
      existing.pending = existing.pending || pending;
      if (!existing.email && email) existing.email = email;
      continue;
    }
    out.set(key, { name: name || VENDOR_PLACEHOLDER_NAME, category: i.category, email: email || null, pending });
  }
  return Array.from(out.values());
}

// Derive the dispatch fan-out for a vehicle from its current get-ready items:
// which departments have pending work, and the third-party vendors to notify.
// Used by the manager's Authorize & Dispatch on addendum acceptance.
export async function deriveGetReadyDispatch(
  tenantId: string,
  vin: string,
): Promise<{ depts: GetReadyDepartment[]; vendors: { name: string; email: string }[] }> {
  // Both spellings: the command surfaces read with vinKeys(), and a dispatch
  // that matched no row fell back to ["detail","service"] with no vendors,
  // dropped every vendor email, and still returned a green success toast.
  // deno-lint-ignore no-explicit-any
  const { data } = await (supabase as any)
    .from("get_ready_records")
    .select("items")
    .eq("tenant_id", tenantId).in("vin", vinKeys(vin))
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const items = ((data?.items as GetReadyItem[]) || []).filter(Boolean);
  const depts = departmentsWithWork(items);
  const vendors = vendorsFor(items)
    .filter((v) => v.pending && !!v.email)
    .map((v) => ({ name: v.name, email: v.email as string }));
  // If there's no get-ready record yet, fall back to the legacy detail+service.
  return { depts: depts.length ? depts : ["detail", "service"], vendors };
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
    accessoriesToInstall: { productId: string; productName: string; department?: GetReadyDepartment; vendorName?: string; vendorEmail?: string }[];
    // Internal recon/service the store pays for — never billed to the customer.
    serviceItems?: { label: string; cost?: number; department?: GetReadyDepartment; vendorName?: string; vendorEmail?: string }[];
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
        department: acc.department || "detail",
        vendorName: acc.vendorName,
        vendorEmail: acc.vendorEmail,
      });
    });
    (data.serviceItems || []).forEach(s => {
      if (!s.label.trim()) return;
      items.push({
        id: crypto.randomUUID(),
        label: s.label.trim(),
        category: "service",
        assignedTo: "",
        status: "pending",
        cost: s.cost,
        internal: true,
        department: s.department || "service",
        vendorName: s.vendorName,
        vendorEmail: s.vendorEmail,
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
        // Normalised at the writer. InventoryModern's "Send to Get-Ready"
        // (:95) passes vehicle_listings.vin verbatim, and dms-webhook /
        // autocurb-sync store whatever spelling the provider sent — so this was
        // the one path that could put a non-uppercase VIN in the table, while
        // StartGetReadyModal and create_draft_get_ready both uppercase.
        vin: vinKey(data.vin),
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
    // Auto-wire each accessory onto the vehicle's addendum as an installed
    // (pending proof) line — no-op unless the dealer enabled getready_drives_addendum.
    // Best-effort: never block get-ready creation on addendum sync.
    for (const acc of data.accessoriesToInstall) {
      try {
        await (supabase as any).rpc("getready_upsert_addendum_line", { p_tenant_id: storeId, p_vin: vinKey(data.vin), p_product_id: acc.productId });
      } catch { /* addendum sync best-effort */ }
    }
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

    // Self-aware addendum: when the install carries both a photo and an
    // installer signature (a verifiable proof), record it into install_proofs
    // so the addendum's install-proof regime marks THIS product Installed and
    // every other product Optional. No-op without both (never over-claims).
    const merged = nextAccessories.find(a => a.productId === productId);
    const photoPath = merged?.install_photos?.[0] || null;
    const sigData = merged?.installer_signature_data || null;
    if (photoPath && sigData) {
      await (supabase as any).rpc("record_getready_install_proof", {
        _record_id: recordId,
        _product_id: productId,
        _product_name: acc.productName,
        _photo_path: photoPath,
        _signature_data: sigData,
        _signature_type: merged?.installer_signature_type || "draw",
        _installer_name: installedBy,
      }).then(() => undefined, () => undefined);
    }
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

  const getByVin = (vin: string): GetReadyRecord | null => {
    const want = vinKey(vin);
    return records.find(r => vinKey(r.vin || "") === want) || null;
  };

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

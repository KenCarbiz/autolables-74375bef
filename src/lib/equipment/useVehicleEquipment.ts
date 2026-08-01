import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  statusFromItemType, ITEM_TYPE_BY_STATUS, nextWorkflowStatus, equipmentTotals,
  type CustomerStatus, type EquipmentItem, type WorkflowStatus,
} from "./status";

// ──────────────────────────────────────────────────────────────────────
// The one per-vehicle equipment record, keyed by stable uuid. Every module
// that shows equipment reads this hook instead of keeping its own array, so a
// status change in Sticker Studio is the same change Get Ready, the passport,
// and the signing addendum see.
//
// Writes go through set_equipment_status (tenant-scoped, permission-checked,
// audited, and the owner of the 96-hour proof deadline). The client applies the
// change optimistically using the same rules the RPC uses, so the preview and
// totals move immediately without waiting for a round trip.
// ──────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface ItemRow {
  id: string;
  item_type: string;
  customer_status?: string | null;
  workflow_status?: string | null;
  proof_due_at?: string | null;
  installer_name?: string | null;
  name: string;
  description: string | null;
  price: number | string | null;
  display_order: number;
}

const toItem = (row: ItemRow): EquipmentItem => ({
  id: row.id,
  name: row.name,
  price: row.price == null ? "" : String(row.price),
  note: row.description || undefined,
  // customer_status is authoritative once the lifecycle migration is applied;
  // before that the legacy item_type projection still answers correctly.
  customerStatus: (row.customer_status as CustomerStatus) || statusFromItemType(row.item_type),
  workflowStatus: (row.workflow_status as WorkflowStatus) || "not_applicable",
  proofDueAt: row.proof_due_at || null,
  installerName: row.installer_name || null,
  displayOrder: row.display_order ?? 0,
});

export interface UseVehicleEquipmentResult {
  items: EquipmentItem[];
  loading: boolean;
  /** True when the lifecycle migration is live and statuses persist server-side. */
  serverBacked: boolean;
  bySection: Record<CustomerStatus, EquipmentItem[]>;
  totals: ReturnType<typeof equipmentTotals>;
  setStatus: (itemId: string, status: CustomerStatus) => Promise<{ ok: boolean; previous?: CustomerStatus; error?: string }>;
  reorder: (itemId: string, direction: -1 | 1) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  duplicate: (itemId: string) => Promise<void>;
  assignInstaller: (itemId: string, installerName: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useVehicleEquipment(vehicleId?: string | null, tenantId?: string | null, basePrice?: string): UseVehicleEquipmentResult {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverBacked, setServerBacked] = useState(false);
  const [headId, setHeadId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vehicleId || !tenantId) { setItems([]); setHeadId(null); return; }
    setLoading(true);
    try {
      const { data: head } = await sb()
        .from("vehicle_addendums").select("id")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!head?.id) { setItems([]); setHeadId(null); setLoading(false); return; }
      setHeadId(head.id);
      const { data, error } = await sb()
        .from("vehicle_addendum_items").select("*")
        .eq("vehicle_addendum_id", head.id)
        .order("display_order");
      if (!error && Array.isArray(data)) {
        setItems(data.map(toItem));
        setServerBacked(data.length === 0 || data[0].customer_status !== undefined);
      }
    } catch { /* the studio still works from local state */ }
    setLoading(false);
  }, [vehicleId, tenantId]);

  useEffect(() => { load(); }, [load]);

  const patchLocal = (itemId: string, patch: Partial<EquipmentItem>) =>
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));

  const setStatus = useCallback(async (itemId: string, status: CustomerStatus) => {
    const current = items.find((i) => i.id === itemId);
    if (!current) return { ok: false, error: "not_found" };
    const previous = current.customerStatus;
    if (previous === status) return { ok: true, previous };

    // Optimistic: mirror the RPC's own rule so the preview and totals are right
    // before the write lands. A verified item stays verified when it returns to
    // pre-installed; anything else re-enters the proof window.
    const hadProof = current.workflowStatus === "verified_installed";
    patchLocal(itemId, {
      customerStatus: status,
      workflowStatus: nextWorkflowStatus(status, hadProof),
      proofDueAt: status === "pre_installed" && !hadProof ? new Date(Date.now() + 96 * 3600 * 1000).toISOString() : null,
    });

    const { data, error } = await sb().rpc("set_equipment_status", { _item_id: itemId, _status: status, _source: "sticker_studio" });
    if (error) {
      // Fall back to the legacy projection so a pre-migration database still
      // records the change rather than silently dropping it.
      const { error: legacyError } = await sb()
        .from("vehicle_addendum_items")
        .update({ item_type: ITEM_TYPE_BY_STATUS[status], is_installed: status === "pre_installed", is_included: status === "included_benefit" })
        .eq("id", itemId);
      if (legacyError) {
        patchLocal(itemId, { customerStatus: previous, workflowStatus: current.workflowStatus, proofDueAt: current.proofDueAt });
        return { ok: false, previous, error: legacyError.message };
      }
      return { ok: true, previous };
    }
    if (data) patchLocal(itemId, toItem(data as ItemRow));
    return { ok: true, previous };
  }, [items]);

  const reorder = useCallback(async (itemId: string, direction: -1 | 1) => {
    const section = items.filter((i) => i.customerStatus === items.find((x) => x.id === itemId)?.customerStatus);
    const idx = section.findIndex((i) => i.id === itemId);
    const swap = section[idx + direction];
    if (idx < 0 || !swap) return;
    const a = section[idx];
    setItems((prev) => prev.map((i) =>
      i.id === a.id ? { ...i, displayOrder: swap.displayOrder } : i.id === swap.id ? { ...i, displayOrder: a.displayOrder } : i));
    await Promise.all([
      sb().from("vehicle_addendum_items").update({ display_order: swap.displayOrder }).eq("id", a.id),
      sb().from("vehicle_addendum_items").update({ display_order: a.displayOrder }).eq("id", swap.id),
    ]);
  }, [items]);

  const remove = useCallback(async (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    await sb().from("vehicle_addendum_items").delete().eq("id", itemId);
  }, []);

  const duplicate = useCallback(async (itemId: string) => {
    const source = items.find((i) => i.id === itemId);
    if (!source || !headId) return;
    const { data } = await sb().from("vehicle_addendum_items").insert({
      vehicle_addendum_id: headId,
      item_type: ITEM_TYPE_BY_STATUS[source.customerStatus],
      customer_status: source.customerStatus,
      name: `${source.name} (copy)`,
      description: source.note || null,
      price: Number(String(source.price).replace(/[^0-9.]/g, "")) || 0,
      display_order: source.displayOrder + 1,
    }).select("*").maybeSingle();
    if (data) setItems((prev) => [...prev, toItem(data as ItemRow)]);
  }, [items, headId]);

  const assignInstaller = useCallback(async (itemId: string, installerName: string) => {
    patchLocal(itemId, { installerName });
    await sb().from("vehicle_addendum_items").update({ installer_name: installerName }).eq("id", itemId);
  }, []);

  const bySection = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);
    return {
      pre_installed: sorted.filter((i) => i.customerStatus === "pre_installed"),
      optional: sorted.filter((i) => i.customerStatus === "optional"),
      included_benefit: sorted.filter((i) => i.customerStatus === "included_benefit"),
    } as Record<CustomerStatus, EquipmentItem[]>;
  }, [items]);

  const totals = useMemo(() => equipmentTotals(items, basePrice), [items, basePrice]);

  return { items, loading, serverBacked, bySection, totals, setStatus, reorder, remove, duplicate, assignInstaller, reload: load };
}

// ──────────────────────────────────────────────────────────────────────
// Equipment status model. One record per piece of equipment
// (vehicle_addendum_items, stable uuid id); customer_status is what the
// customer reads, workflow_status is the internal proof state. Every
// destination — sticker, passport, signing addendum, get-ready, exporters —
// projects from these two fields rather than keeping its own copy.
// ──────────────────────────────────────────────────────────────────────

export type CustomerStatus = "pre_installed" | "optional" | "included_benefit";
export type WorkflowStatus = "not_applicable" | "awaiting_proof" | "verified_installed" | "verification_overdue";

export const PROOF_WINDOW_HOURS = 96;

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  pre_installed: "Pre-Installed",
  optional: "Optional",
  included_benefit: "Included Benefit",
};

export const SECTION_LABEL: Record<CustomerStatus, string> = {
  pre_installed: "Pre-Installed Equipment",
  optional: "Optional Upgrades",
  included_benefit: "Included Benefits",
};

export const CUSTOMER_STATUSES: CustomerStatus[] = ["pre_installed", "optional", "included_benefit"];

/** Legacy projection kept in step by the DB trigger; used for reads/writes of item_type. */
export const ITEM_TYPE_BY_STATUS: Record<CustomerStatus, "installed" | "benefit" | "available_upgrade"> = {
  pre_installed: "installed",
  optional: "available_upgrade",
  included_benefit: "benefit",
};

export const statusFromItemType = (itemType?: string | null): CustomerStatus =>
  itemType === "installed" ? "pre_installed" : itemType === "benefit" ? "included_benefit" : "optional";

export interface EquipmentItem {
  id: string;
  name: string;
  price: string;
  note?: string;
  customerStatus: CustomerStatus;
  workflowStatus: WorkflowStatus;
  proofDueAt?: string | null;
  installerName?: string | null;
  displayOrder: number;
}

// ── Pricing ───────────────────────────────────────────────────────────

const num = (v?: string | number | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The money rules, in one place so preview, PDF, PNG, print, passport, and the
 * signing addendum cannot drift: pre-installed equipment adds to the vehicle's
 * value, optional upgrades never do, and benefits are not a customer charge.
 */
export function equipmentTotals(items: EquipmentItem[], basePrice?: string | number) {
  const installedTotal = items.filter((i) => i.customerStatus === "pre_installed").reduce((s, i) => s + num(i.price), 0);
  const optionalTotal = items.filter((i) => i.customerStatus === "optional").reduce((s, i) => s + num(i.price), 0);
  const base = num(basePrice);
  return {
    installedTotal,
    optionalTotal,
    base,
    adjustedTotal: base > 0 ? base + installedTotal : 0,
  };
}

// ── Proof workflow ────────────────────────────────────────────────────

export interface ProofBadge {
  tone: "verified" | "awaiting" | "overdue" | "none";
  label: string;
  /** Internal-only badges must never reach a customer-facing document. */
  internalOnly: boolean;
}

/**
 * The internal badge for a row. Customer status is deliberately not part of the
 * label beyond Pre-Installed: a deadline or vendor instruction is dealership
 * information, never something a shopper sees.
 */
export function proofBadge(item: Pick<EquipmentItem, "customerStatus" | "workflowStatus" | "proofDueAt">, timeZone?: string): ProofBadge {
  if (item.customerStatus !== "pre_installed") {
    return item.workflowStatus === "verification_overdue"
      ? { tone: "overdue", label: "Verification overdue", internalOnly: true }
      : { tone: "none", label: "Not installed", internalOnly: false };
  }
  if (item.workflowStatus === "verified_installed") return { tone: "verified", label: "Verified", internalOnly: true };
  if (item.workflowStatus === "awaiting_proof") {
    const due = item.proofDueAt ? formatProofDue(item.proofDueAt, timeZone) : "";
    return { tone: "awaiting", label: due ? `Awaiting proof · Due ${due}` : "Awaiting proof", internalOnly: true };
  }
  return { tone: "none", label: "Pre-installed", internalOnly: true };
}

/** Renders the deadline in the dealership's own timezone, not the viewer's. */
export function formatProofDue(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone });
  } catch {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

/** Deadline for an item that just became Pre-Installed without proof on file. */
export const proofDeadlineFrom = (from: Date) => new Date(from.getTime() + PROOF_WINDOW_HOURS * 3600 * 1000);

/**
 * The workflow status an item should carry after a customer-status change.
 * Mirrors set_equipment_status so the optimistic client render matches the row
 * the server writes back.
 */
export function nextWorkflowStatus(status: CustomerStatus, hasVerifiedProof: boolean): WorkflowStatus {
  if (status !== "pre_installed") return "not_applicable";
  return hasVerifiedProof ? "verified_installed" : "awaiting_proof";
}

import { supabase } from "@/integrations/supabase/client";

export type NightlyComplianceVehicle = {
  id: string;
  tenant_id: string | null;
  vin: string | null;
  stock_number?: string | null;
  stock?: string | null;
  ymm?: string | null;
  condition?: "new" | "used" | "cpo" | null;
  status?: string | null;
};

export type NightlyComplianceIssue = {
  vehicleId: string;
  vin: string | null;
  stock: string | null;
  issueType: "missing_ftc" | "missing_k208" | "missing_signature" | "uncertified";
  label: string;
};

export type NightlyComplianceAuditResult = {
  tenantId: string;
  scanned: number;
  issueCount: number;
  issues: NightlyComplianceIssue[];
};

const usedLike = (condition?: string | null) => condition === "used" || condition === "cpo" || !condition;

const checkHasLifecycle = async (tenantId: string, vehicle: NightlyComplianceVehicle, eventTypes: string[]) => {
  const query = (supabase as any)
    .from("document_lifecycle_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("event_type", eventTypes)
    .limit(1);

  if (vehicle.id) query.eq("vehicle_id", vehicle.id);
  else if (vehicle.vin) query.eq("vin", vehicle.vin);

  const { data } = await query;
  return Array.isArray(data) && data.length > 0;
};

const checkHasSignature = async (tenantId: string, vehicle: NightlyComplianceVehicle) => {
  const query = (supabase as any)
    .from("signature_evidence")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);

  if (vehicle.id) query.eq("vehicle_id", vehicle.id);
  else if (vehicle.vin) query.eq("vin", vehicle.vin);

  const { data } = await query;
  return Array.isArray(data) && data.length > 0;
};

const recordMissingLifecycleIssue = async (
  tenantId: string,
  vehicle: NightlyComplianceVehicle,
  stock: string | null,
  eventType: "ftc_buyers_guide_missing" | "k208_missing" | "signature_missing",
  reason: string,
) => {
  await (supabase as any).from("document_lifecycle_events").insert({
    tenant_id: tenantId,
    vehicle_id: vehicle.id,
    vin: vehicle.vin,
    stock,
    event_type: eventType,
    source: "nightly-compliance-audit",
    metadata: { reason, missing: true },
  });
};

export const runNightlyCtMvpComplianceAudit = async (tenantId: string): Promise<NightlyComplianceAuditResult> => {
  const { data, error } = await (supabase as any)
    .from("vehicle_listings")
    .select("id,tenant_id,vin,stock,stock_number,ymm,condition,status")
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .neq("status", "archived")
    .limit(1000);

  if (error) throw error;

  const vehicles = ((data || []) as NightlyComplianceVehicle[]).filter((vehicle) => usedLike(vehicle.condition));
  const issues: NightlyComplianceIssue[] = [];

  for (const vehicle of vehicles) {
    const stock = vehicle.stock || vehicle.stock_number || null;

    const hasFtc = await checkHasLifecycle(tenantId, vehicle, ["ftc_buyers_guide_generated", "buyers_guide_generated"]);
    const hasK208 = await checkHasLifecycle(tenantId, vehicle, ["k208_generated"]);
    const hasSignature = await checkHasSignature(tenantId, vehicle);

    if (!hasFtc) {
      issues.push({ vehicleId: vehicle.id, vin: vehicle.vin, stock, issueType: "missing_ftc", label: "Missing FTC Buyers Guide" });
      await recordMissingLifecycleIssue(tenantId, vehicle, stock, "ftc_buyers_guide_missing", "No FTC Buyers Guide lifecycle event found");
    }

    if (!hasK208) {
      issues.push({ vehicleId: vehicle.id, vin: vehicle.vin, stock, issueType: "missing_k208", label: "Missing K208" });
      await recordMissingLifecycleIssue(tenantId, vehicle, stock, "k208_missing", "No K208 lifecycle event found");
    }

    if (!hasSignature) {
      issues.push({ vehicleId: vehicle.id, vin: vehicle.vin, stock, issueType: "missing_signature", label: "Missing signature evidence" });
      await recordMissingLifecycleIssue(tenantId, vehicle, stock, "signature_missing", "No signature evidence found");
    }
  }

  await (supabase as any).from("audit_log").insert({
    store_id: tenantId,
    action: "nightly_ct_mvp_compliance_audit",
    entity_type: "tenant",
    entity_id: tenantId,
    details: {
      scanned: vehicles.length,
      issue_count: issues.length,
      issues,
    },
  });

  return { tenantId, scanned: vehicles.length, issueCount: issues.length, issues };
};

// Audit engine foundation for Connecticut-first AutoLabels launch.
// Every generated sticker, FTC Buyers Guide, K-208 signoff, and packet action should write
// immutable audit events so the dealer can prove what was shown, generated, signed, and archived.

export type AuditActorRole =
  | "system"
  | "dealer_admin"
  | "salesperson"
  | "sales_manager"
  | "service_manager"
  | "service_writer"
  | "technician"
  | "customer"
  | "integration";

export type AuditEventType =
  | "inventory_ingested"
  | "vehicle_normalized"
  | "template_selected"
  | "used_window_sticker_generated"
  | "used_addendum_generated"
  | "new_addendum_generated"
  | "ftc_buyers_guide_decided"
  | "ftc_buyers_guide_rendered"
  | "ct_k208_created"
  | "ct_k208_checklist_updated"
  | "ct_k208_service_signed"
  | "ct_k208_customer_signed"
  | "passport_created"
  | "passport_price_updated"
  | "dealer_settings_updated"
  | "rule_updated"
  | "document_packet_generated"
  | "document_packet_signed"
  | "document_archived";

export type AuditDocumentType =
  | "used_window_sticker"
  | "used_addendum"
  | "new_addendum"
  | "ftc_buyers_guide"
  | "ct_k208"
  | "vehicle_passport"
  | "dealer_settings"
  | "template_rule"
  | "packet";

export type AuditActor = {
  id?: string;
  name?: string;
  role: AuditActorRole;
  email?: string;
};

export type AuditVehicleReference = {
  vehicleId?: string;
  vin?: string;
  stock?: string;
  year?: string | number;
  make?: string;
  model?: string;
};

export type AuditEvent = {
  id: string;
  dealerId: string;
  tenantId?: string;
  eventType: AuditEventType;
  actor: AuditActor;
  vehicle?: AuditVehicleReference;
  documentType?: AuditDocumentType;
  documentId?: string;
  documentVersion?: string;
  templateId?: string;
  packetId?: string;
  eventAt: string;
  ipAddress?: string;
  userAgent?: string;
  source: "app" | "api" | "system" | "integration";
  summary: string;
  payload: Record<string, unknown>;
  hash?: string;
  previousEventId?: string;
};

export type AuditPacket = {
  id: string;
  dealerId: string;
  tenantId?: string;
  vehicle: AuditVehicleReference;
  state: "CT";
  documents: Array<{
    documentType: AuditDocumentType;
    documentId: string;
    version?: string;
    status: "created" | "rendered" | "signed" | "archived";
  }>;
  createdAt: string;
  updatedAt: string;
  auditEventIds: string[];
};

const nowIso = () => new Date().toISOString();
const safe = (value?: string | number) => String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);

export const createAuditEvent = (input: Omit<AuditEvent, "id" | "eventAt"> & { eventAt?: string }): AuditEvent => {
  const eventAt = input.eventAt || nowIso();
  const vehicleKey = input.vehicle?.vin || input.vehicle?.stock || "no-vehicle";
  return {
    ...input,
    id: `audit-${safe(input.eventType)}-${safe(vehicleKey)}-${Date.now()}`,
    eventAt,
  };
};

export const createInventoryIngestedAuditEvent = (input: {
  dealerId: string;
  tenantId?: string;
  actor?: AuditActor;
  provider: string;
  accepted: number;
  rejected: number;
  warnings: string[];
}): AuditEvent => createAuditEvent({
  dealerId: input.dealerId,
  tenantId: input.tenantId,
  eventType: "inventory_ingested",
  actor: input.actor || { role: "integration", name: input.provider },
  source: "integration",
  summary: `Inventory ingested from ${input.provider}: ${input.accepted} accepted, ${input.rejected} rejected.`,
  payload: {
    provider: input.provider,
    accepted: input.accepted,
    rejected: input.rejected,
    warnings: input.warnings,
  },
});

export const createTemplateSelectedAuditEvent = (input: {
  dealerId: string;
  tenantId?: string;
  actor?: AuditActor;
  vehicle: AuditVehicleReference;
  documentType: AuditDocumentType;
  templateId: string;
  reasons: string[];
}): AuditEvent => createAuditEvent({
  dealerId: input.dealerId,
  tenantId: input.tenantId,
  eventType: "template_selected",
  actor: input.actor || { role: "system", name: "Template Rule Engine" },
  vehicle: input.vehicle,
  documentType: input.documentType,
  templateId: input.templateId,
  source: "system",
  summary: `Template selected for ${input.documentType}: ${input.templateId}`,
  payload: { reasons: input.reasons },
});

export const createFTCAuditEvent = (input: {
  dealerId: string;
  tenantId?: string;
  actor?: AuditActor;
  vehicle: AuditVehicleReference;
  documentId: string;
  decisionCode: string;
  requiredForms: string[];
  warnings: string[];
}): AuditEvent => createAuditEvent({
  dealerId: input.dealerId,
  tenantId: input.tenantId,
  eventType: "ftc_buyers_guide_decided",
  actor: input.actor || { role: "system", name: "FTC Decision Engine" },
  vehicle: input.vehicle,
  documentType: "ftc_buyers_guide",
  documentId: input.documentId,
  source: "system",
  summary: `FTC Buyers Guide decision: ${input.decisionCode}`,
  payload: {
    decisionCode: input.decisionCode,
    requiredForms: input.requiredForms,
    warnings: input.warnings,
  },
});

export const createK208AuditEvent = (input: {
  dealerId: string;
  tenantId?: string;
  actor: AuditActor;
  vehicle: AuditVehicleReference;
  documentId: string;
  eventType: Extract<AuditEventType, "ct_k208_created" | "ct_k208_checklist_updated" | "ct_k208_service_signed" | "ct_k208_customer_signed">;
  summary: string;
  payload?: Record<string, unknown>;
}): AuditEvent => createAuditEvent({
  dealerId: input.dealerId,
  tenantId: input.tenantId,
  eventType: input.eventType,
  actor: input.actor,
  vehicle: input.vehicle,
  documentType: "ct_k208",
  documentId: input.documentId,
  source: input.actor.role === "system" ? "system" : "app",
  summary: input.summary,
  payload: input.payload || {},
});

export const createConnecticutLaunchAuditPacket = (input: {
  dealerId: string;
  tenantId?: string;
  vehicle: AuditVehicleReference;
  documents: AuditPacket["documents"];
  auditEventIds?: string[];
}): AuditPacket => {
  const now = nowIso();
  return {
    id: `packet-ct-${safe(input.vehicle.vin || input.vehicle.stock)}-${Date.now()}`,
    dealerId: input.dealerId,
    tenantId: input.tenantId,
    vehicle: input.vehicle,
    state: "CT",
    documents: input.documents,
    createdAt: now,
    updatedAt: now,
    auditEventIds: input.auditEventIds || [],
  };
};

export const AUDIT_ENGINE_NEXT_STEPS = [
  "Persist audit_events table with append-only writes.",
  "Persist document_packets table linking generated documents to VIN/deal/customer.",
  "Add hashes for rendered PDFs and signed documents.",
  "Write audit events from Connecticut smoke test route.",
  "Expose vehicle file audit timeline for dealer and compliance review.",
];

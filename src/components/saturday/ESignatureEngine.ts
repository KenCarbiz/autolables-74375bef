// eSignature engine foundation for Connecticut-first AutoLabels launch.
// Shared signing workflow for FTC Buyers Guide, Connecticut K-208, packets, and future docs.
// This is not a cryptographic signature provider yet; it defines the platform contract.

import type { AuditActorRole } from "./AuditEngine";

export type ESignatureDocumentType =
  | "ftc_buyers_guide"
  | "ct_k208"
  | "used_window_sticker_acknowledgment"
  | "used_addendum_acknowledgment"
  | "new_addendum_acknowledgment"
  | "vehicle_passport_acknowledgment"
  | "document_packet";

export type ESignatureSignerRole =
  | "buyer"
  | "co_buyer"
  | "customer"
  | "salesperson"
  | "sales_manager"
  | "service_writer"
  | "service_manager"
  | "technician"
  | "dealer_principal"
  | "system_witness";

export type ESignatureStatus = "draft" | "pending" | "viewed" | "signed" | "declined" | "voided" | "expired";

export type ESignatureMethod = "typed_name" | "drawn_signature" | "click_to_sign" | "uploaded_signature" | "provider_embedded";

export type ESignatureSigner = {
  id: string;
  role: ESignatureSignerRole;
  name?: string;
  email?: string;
  phone?: string;
  status: ESignatureStatus;
  required: boolean;
  viewedAt?: string;
  signedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  method?: ESignatureMethod;
  typedName?: string;
  signatureAssetUrl?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type ESignatureRequest = {
  id: string;
  dealerId: string;
  tenantId?: string;
  vehicleId?: string;
  vin?: string;
  stock?: string;
  packetId?: string;
  documentType: ESignatureDocumentType;
  documentId: string;
  documentVersion?: string;
  title: string;
  status: ESignatureStatus;
  signers: ESignatureSigner[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  auditEventIds: string[];
  metadata: Record<string, unknown>;
};

export type ESignatureAuditIntent = {
  eventType:
    | "document_packet_signed"
    | "ct_k208_service_signed"
    | "ct_k208_customer_signed"
    | "document_archived";
  actorRole: AuditActorRole;
  summary: string;
};

const nowIso = () => new Date().toISOString();
const safe = (value?: string | number) => String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);

export const requiredSignersForDocument = (documentType: ESignatureDocumentType): ESignatureSignerRole[] => {
  switch (documentType) {
    case "ct_k208":
      return ["service_manager", "customer"];
    case "ftc_buyers_guide":
      return ["customer"];
    case "document_packet":
      return ["customer"];
    default:
      return ["customer"];
  }
};

export const createESignatureRequest = (input: {
  dealerId: string;
  tenantId?: string;
  vehicleId?: string;
  vin?: string;
  stock?: string;
  packetId?: string;
  documentType: ESignatureDocumentType;
  documentId: string;
  documentVersion?: string;
  title?: string;
  signers?: Partial<ESignatureSigner>[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}): ESignatureRequest => {
  const now = nowIso();
  const roles = input.signers?.length
    ? input.signers.map((signer) => signer.role || "customer")
    : requiredSignersForDocument(input.documentType);

  const signers: ESignatureSigner[] = roles.map((role, index) => {
    const provided = input.signers?.[index] || {};
    return {
      id: provided.id || `signer-${safe(input.documentType)}-${safe(role)}-${index + 1}`,
      role,
      name: provided.name,
      email: provided.email,
      phone: provided.phone,
      status: provided.status || "pending",
      required: provided.required ?? true,
      viewedAt: provided.viewedAt,
      signedAt: provided.signedAt,
      method: provided.method,
      typedName: provided.typedName,
      signatureAssetUrl: provided.signatureAssetUrl,
      ipAddress: provided.ipAddress,
      userAgent: provided.userAgent,
    };
  });

  return {
    id: `esign-${safe(input.documentType)}-${safe(input.vin || input.documentId)}-${Date.now()}`,
    dealerId: input.dealerId,
    tenantId: input.tenantId,
    vehicleId: input.vehicleId,
    vin: input.vin,
    stock: input.stock,
    packetId: input.packetId,
    documentType: input.documentType,
    documentId: input.documentId,
    documentVersion: input.documentVersion,
    title: input.title || input.documentType.replace(/_/g, " ").toUpperCase(),
    status: "pending",
    signers,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
    auditEventIds: [],
    metadata: input.metadata || {},
  };
};

export const markSignerViewed = (
  request: ESignatureRequest,
  signerId: string,
  meta: Pick<ESignatureSigner, "ipAddress" | "userAgent"> = {},
): ESignatureRequest => ({
  ...request,
  signers: request.signers.map((signer) => signer.id === signerId
    ? { ...signer, status: signer.status === "pending" ? "viewed" : signer.status, viewedAt: signer.viewedAt || nowIso(), ...meta }
    : signer),
  updatedAt: nowIso(),
});

export const signDocument = (
  request: ESignatureRequest,
  signerId: string,
  signature: {
    method: ESignatureMethod;
    typedName?: string;
    signatureAssetUrl?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): ESignatureRequest => {
  const updatedSigners = request.signers.map((signer) => signer.id === signerId
    ? {
        ...signer,
        status: "signed" as ESignatureStatus,
        signedAt: nowIso(),
        method: signature.method,
        typedName: signature.typedName,
        signatureAssetUrl: signature.signatureAssetUrl,
        ipAddress: signature.ipAddress || signer.ipAddress,
        userAgent: signature.userAgent || signer.userAgent,
      }
    : signer);

  const allRequiredSigned = updatedSigners.every((signer) => !signer.required || signer.status === "signed");

  return {
    ...request,
    signers: updatedSigners,
    status: allRequiredSigned ? "signed" : "pending",
    updatedAt: nowIso(),
  };
};

export const declineSignature = (
  request: ESignatureRequest,
  signerId: string,
  declineReason: string,
): ESignatureRequest => ({
  ...request,
  signers: request.signers.map((signer) => signer.id === signerId
    ? { ...signer, status: "declined", declinedAt: nowIso(), declineReason }
    : signer),
  status: "declined",
  updatedAt: nowIso(),
});

export const voidSignatureRequest = (request: ESignatureRequest, reason: string): ESignatureRequest => ({
  ...request,
  status: "voided",
  updatedAt: nowIso(),
  metadata: { ...request.metadata, voidReason: reason },
});

export const signatureAuditIntent = (
  request: ESignatureRequest,
  signer: ESignatureSigner,
): ESignatureAuditIntent => {
  if (request.documentType === "ct_k208" && signer.role !== "customer" && signer.role !== "buyer" && signer.role !== "co_buyer") {
    return {
      eventType: "ct_k208_service_signed",
      actorRole: signer.role === "technician" ? "technician" : signer.role === "service_writer" ? "service_writer" : "service_manager",
      summary: `Service signed ${request.title}.`,
    };
  }

  if (request.documentType === "ct_k208") {
    return {
      eventType: "ct_k208_customer_signed",
      actorRole: "customer",
      summary: `Customer signed ${request.title}.`,
    };
  }

  return {
    eventType: "document_packet_signed",
    actorRole: signer.role === "salesperson" ? "salesperson" : signer.role === "sales_manager" ? "sales_manager" : "customer",
    summary: `${signer.role} signed ${request.title}.`,
  };
};

export const ESIGNATURE_ENGINE_NEXT_STEPS = [
  "Add database tables for signature_requests and signature_events.",
  "Wire FTC Buyers Guide signing into this engine.",
  "Wire CT K-208 service and customer signing into this engine.",
  "Create customer/mobile signing UI for FTC and K-208 documents.",
  "Write AuditEngine events for each view/sign/decline/void action.",
];

import { certifyCtMvp, type CtMvpCertificationResult } from "./certification";
import { persistCtMvpEvidenceBundle, recordDocumentLifecycleEvent, recordSignatureEvidence, saveCtMvpCertificationRun, type CtMvpPersistenceContext } from "./persistence";
import { normalizeVehicle, type RawInventoryVehicle } from "@/lib/inventory/normalizeVehicle";
import type { DocumentLifecycleEvent, DocumentLifecycleEventType } from "@/lib/audit/documentLifecycle";
import type { SignatureEvidence } from "@/lib/audit/signatureValidation";

const nowIso = () => new Date().toISOString();

const safe = async <T>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch (error) {
    console.warn("CT MVP evidence hook failed", error);
    return null;
  }
};

export function buildPersistenceContext(args: {
  tenantId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  stock?: string | null;
}): CtMvpPersistenceContext | null {
  if (!args.tenantId) return null;
  return {
    tenantId: args.tenantId,
    vehicleId: args.vehicleId || undefined,
    vin: args.vin || undefined,
    stock: args.stock || undefined,
  };
}

export async function recordLifecycleHook(
  context: CtMvpPersistenceContext | null,
  type: DocumentLifecycleEventType,
  details: Partial<DocumentLifecycleEvent> = {},
) {
  if (!context) return null;
  return safe(() => recordDocumentLifecycleEvent(context, {
    type,
    occurredAt: details.occurredAt || nowIso(),
    actor: details.actor,
    source: details.source || "production-flow",
    metadata: details.metadata || {},
  }));
}

export async function recordStickerGenerated(args: {
  tenantId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  stock?: string | null;
  documentType?: "window" | "addendum" | string | null;
  templateId?: string | null;
  documentId?: string | null;
  actorId?: string | null;
}) {
  const context = buildPersistenceContext(args);
  const type: DocumentLifecycleEventType = args.documentType === "addendum" ? "addendum_generated" : "window_sticker_generated";
  return recordLifecycleHook(context, type, {
    actor: args.actorId || undefined,
    source: "sticker-studio",
    metadata: {
      templateId: args.templateId,
      documentId: args.documentId,
      documentType: args.documentType,
    },
  });
}

export async function recordFtcGenerated(context: CtMvpPersistenceContext | null, metadata: Record<string, unknown> = {}) {
  return recordLifecycleHook(context, "ftc_buyers_guide_generated", { source: "document-generation", metadata });
}

export async function recordK208Generated(context: CtMvpPersistenceContext | null, metadata: Record<string, unknown> = {}) {
  return recordLifecycleHook(context, "k208_generated", { source: "document-generation", metadata });
}

export async function recordPassportGenerated(context: CtMvpPersistenceContext | null, metadata: Record<string, unknown> = {}) {
  return recordLifecycleHook(context, "passport_generated", { source: "vehicle-passport", metadata });
}

export async function recordPassportViewed(context: CtMvpPersistenceContext | null, metadata: Record<string, unknown> = {}) {
  return recordLifecycleHook(context, "passport_viewed", { source: "qr-redirect", metadata });
}

export async function recordCustomerSignatureEvidence(
  context: CtMvpPersistenceContext | null,
  evidence: Omit<SignatureEvidence, "role"> & { role?: SignatureEvidence["role"] },
) {
  if (!context) return null;
  return safe(() => recordSignatureEvidence(context, {
    role: evidence.role || "customer",
    signerName: evidence.signerName,
    signerEmail: evidence.signerEmail,
    signedAt: evidence.signedAt || nowIso(),
    ipAddress: evidence.ipAddress,
    userAgent: evidence.userAgent,
    deviceLabel: evidence.deviceLabel,
    signatureImageUrl: evidence.signatureImageUrl,
    consentText: evidence.consentText,
    documentKeys: evidence.documentKeys,
  }));
}

export async function runAndSaveCtCertification(args: {
  context: CtMvpPersistenceContext | null;
  rawVehicle: RawInventoryVehicle;
  lifecycleEvents?: DocumentLifecycleEvent[];
  signatureEvidence?: SignatureEvidence[];
  source?: string;
}): Promise<CtMvpCertificationResult | null> {
  if (!args.context) return null;
  return safe(async () => {
    const certification = certifyCtMvp({
      vehicle: normalizeVehicle(args.rawVehicle),
      lifecycleEvents: args.lifecycleEvents || [],
      signatureEvidence: args.signatureEvidence || [],
    });
    await saveCtMvpCertificationRun(args.context!, certification, args.source || "production-flow");
    return certification;
  });
}

export async function persistProductionEvidenceBundle(args: {
  context: CtMvpPersistenceContext | null;
  lifecycleEvents?: DocumentLifecycleEvent[];
  signatureEvidence?: SignatureEvidence[];
  certification?: CtMvpCertificationResult;
  source?: string;
}) {
  if (!args.context) return null;
  return safe(() => persistCtMvpEvidenceBundle({
    context: args.context!,
    lifecycleEvents: args.lifecycleEvents,
    signatureEvidence: args.signatureEvidence,
    certification: args.certification,
    source: args.source || "production-flow",
  }));
}

import { supabase } from "@/integrations/supabase/client";
import type { CtMvpCertificationResult } from "./certification";
import type { DocumentLifecycleEvent } from "@/lib/audit/documentLifecycle";
import type { SignatureEvidence } from "@/lib/audit/signatureValidation";

const db = supabase as unknown as {
  from: (table: string) => {
    insert: (values: unknown) => {
      select: (columns?: string) => {
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export type CtMvpPersistenceContext = {
  tenantId: string;
  vehicleId?: string;
  vin?: string;
  stock?: string;
};

export async function recordDocumentLifecycleEvent(
  context: CtMvpPersistenceContext,
  event: DocumentLifecycleEvent,
) {
  const { data, error } = await db
    .from("document_lifecycle_events")
    .insert({
      tenant_id: context.tenantId,
      vehicle_id: context.vehicleId || null,
      vin: context.vin || null,
      stock: context.stock || null,
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_name: event.actor || null,
      source: event.source || null,
      metadata: event.metadata || {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function recordSignatureEvidence(
  context: CtMvpPersistenceContext,
  evidence: SignatureEvidence,
) {
  const { data, error } = await db
    .from("signature_evidence")
    .insert({
      tenant_id: context.tenantId,
      vehicle_id: context.vehicleId || null,
      vin: context.vin || null,
      stock: context.stock || null,
      role: evidence.role,
      signer_name: evidence.signerName || null,
      signer_email: evidence.signerEmail || null,
      signed_at: evidence.signedAt || null,
      ip_address: evidence.ipAddress || null,
      user_agent: evidence.userAgent || null,
      device_label: evidence.deviceLabel || null,
      signature_image_url: evidence.signatureImageUrl || null,
      consent_text: evidence.consentText || null,
      document_keys: evidence.documentKeys || [],
      metadata: {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function saveCtMvpCertificationRun(
  context: CtMvpPersistenceContext,
  certification: CtMvpCertificationResult,
  source = "admin-smoke-test",
) {
  const { data, error } = await db
    .from("ct_mvp_certification_runs")
    .insert({
      tenant_id: context.tenantId,
      vehicle_id: context.vehicleId || null,
      vin: context.vin || null,
      stock: context.stock || null,
      vehicle_title: certification.vehicleTitle,
      ready: certification.ready,
      required_document_keys: certification.requiredDocumentKeys,
      rule_output: certification.ruleOutput,
      lifecycle_audit: certification.lifecycleAudit,
      signature_validation: certification.signatureValidation,
      checks: certification.checks,
      source,
      certified_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function persistCtMvpEvidenceBundle(params: {
  context: CtMvpPersistenceContext;
  lifecycleEvents?: DocumentLifecycleEvent[];
  signatureEvidence?: SignatureEvidence[];
  certification?: CtMvpCertificationResult;
  source?: string;
}) {
  const lifecycleRows = [];
  for (const event of params.lifecycleEvents || []) {
    lifecycleRows.push(await recordDocumentLifecycleEvent(params.context, event));
  }

  const signatureRows = [];
  for (const evidence of params.signatureEvidence || []) {
    signatureRows.push(await recordSignatureEvidence(params.context, evidence));
  }

  const certificationRun = params.certification
    ? await saveCtMvpCertificationRun(params.context, params.certification, params.source)
    : null;

  return {
    lifecycleRows,
    signatureRows,
    certificationRun,
  };
}

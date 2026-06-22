import { supabase } from "@/integrations/supabase/client";
import { buildCtMvpComplianceDigest, renderCtMvpComplianceDigestText, type ComplianceDigest } from "@/lib/ctMvp/complianceDigest";
import { runNightlyCtMvpComplianceAudit, type NightlyComplianceAuditResult } from "@/lib/ctMvp/nightlyComplianceAudit";

export type ScheduledComplianceDigestResult = {
  tenantId: string;
  audit: NightlyComplianceAuditResult;
  digest: ComplianceDigest;
  outboxId: string | null;
  queued: boolean;
};

export type EnqueueComplianceDigestOptions = {
  tenantId: string;
  recipientEmail?: string | null;
  channel?: "manager_digest" | "email" | "in_app";
  skipAudit?: boolean;
};

const shouldQueueDigest = (digest: ComplianceDigest) =>
  digest.needsReview > 0 || digest.missingFtc > 0 || digest.missingK208 > 0 || digest.missingSignatures > 0;

export const enqueueCtMvpComplianceDigest = async ({
  tenantId,
  recipientEmail = null,
  channel = "manager_digest",
  skipAudit = false,
}: EnqueueComplianceDigestOptions): Promise<ScheduledComplianceDigestResult> => {
  const audit = skipAudit
    ? { tenantId, scanned: 0, issueCount: 0, issues: [] }
    : await runNightlyCtMvpComplianceAudit(tenantId);

  const digest = await buildCtMvpComplianceDigest(tenantId);
  const summaryText = renderCtMvpComplianceDigestText(digest);

  if (!shouldQueueDigest(digest)) {
    await (supabase as any).from("audit_log").insert({
      store_id: tenantId,
      action: "ct_mvp_compliance_digest_skipped",
      entity_type: "tenant",
      entity_id: tenantId,
      details: {
        reason: "no_open_compliance_issues",
        audit,
        digest,
      },
    });

    return { tenantId, audit, digest, outboxId: null, queued: false };
  }

  const { data, error } = await (supabase as any)
    .from("ct_mvp_compliance_digest_outbox")
    .insert({
      tenant_id: tenantId,
      subject: digest.subject,
      summary_text: summaryText,
      digest,
      status: "queued",
      channel,
      recipient_email: recipientEmail,
    })
    .select("id")
    .maybeSingle();

  if (error) throw error;

  await (supabase as any).from("audit_log").insert({
    store_id: tenantId,
    action: "ct_mvp_compliance_digest_queued",
    entity_type: "tenant",
    entity_id: tenantId,
    details: {
      outbox_id: data?.id || null,
      audit,
      digest_summary: {
        totalVehicles: digest.totalVehicles,
        certifiedVehicles: digest.certifiedVehicles,
        needsReview: digest.needsReview,
        missingFtc: digest.missingFtc,
        missingK208: digest.missingK208,
        missingSignatures: digest.missingSignatures,
      },
    },
  });

  return { tenantId, audit, digest, outboxId: data?.id || null, queued: true };
};

export const enqueueCtMvpComplianceDigestsForTenants = async (tenantIds: string[]) => {
  const results: ScheduledComplianceDigestResult[] = [];
  for (const tenantId of tenantIds.filter(Boolean)) {
    try {
      results.push(await enqueueCtMvpComplianceDigest({ tenantId }));
    } catch (err) {
      await (supabase as any).from("audit_log").insert({
        store_id: tenantId,
        action: "ct_mvp_compliance_digest_failed",
        entity_type: "tenant",
        entity_id: tenantId,
        details: { error: err instanceof Error ? err.message : "unknown" },
      });
    }
  }
  return results;
};

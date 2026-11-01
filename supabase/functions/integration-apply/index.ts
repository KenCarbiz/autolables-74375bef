// integration-apply
//
// Inbox worker. Leases due received/held rows (FOR UPDATE SKIP LOCKED, only for
// tenants whose direction flag is on) and applies each through
// integration_apply_event: one transaction that locks the per-record version row,
// checks ordering, writes the effect and bumps the watermark. Failures back off and
// dead-letter after MAX_ATTEMPTS. Dormant unless ROOFTOP_INTEGRATIONS_ENABLED === "true".

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleApply, type ApplyStore, type ClaimedRow } from "../_shared/integrations/handlers/apply.ts";
import { isServiceOrCron } from "../_shared/supabase.ts";

function supabaseStore(db: SupabaseClient): ApplyStore {
  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await db.rpc("integration_claim_inbox", { p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error("claim_failed");
      return (data ?? []) as ClaimedRow[];
    },
    async apply(inboxId, plan) {
      const { data, error } = await db.rpc("integration_apply_event", { p_inbox_id: inboxId, p_plan: plan });
      if (error) throw new Error("apply_failed");
      return data as { status: string; outcome?: string };
    },
    async fail(inboxId, errorCode, delaySeconds, dead) {
      await db.rpc("integration_fail_inbox", {
        p_inbox_id: inboxId, p_error_code: errorCode, p_delay_seconds: delaySeconds, p_dead: dead,
      });
    },
    async audit(row, status, outcome) {
      await db.from("audit_log").insert({
        action: `integration_event_${status}`,
        entity_type: "integration_inbox",
        entity_id: row.id,
        details: {
          tenant_id: row.tenant_id,
          connection_id: row.connection_id,
          event_id: row.event_id,
          event_type: row.event_type,
          source_record_id: row.source_record_id,
          source_version: row.source_version,
          outcome_code: outcome,
        },
      });
    },
  };
}

Deno.serve((req: Request) => handleApply(req, {
  enabled: () => Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") === "true",
  authorize: isServiceOrCron,
  store: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return supabaseStore(createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  },
}));

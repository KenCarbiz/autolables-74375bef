// integration-dispatch
//
// Outbox sender. Signs pending events with the connection's active key and
// POSTs them to its endpoint, only while the tenant's matching direction flag is
// on and the connection is active. With flags off it sends nothing. Connections
// whose adapter is autofilm.v1 receive AutoFilm's x-af-* format. Dormant
// unless ROOFTOP_INTEGRATIONS_ENABLED === "true".

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  handleDispatch, type DispatchConnection, type DispatchStore, type OutboxRow,
} from "../_shared/integrations/handlers/dispatch.ts";
import { isServiceOrCron } from "../_shared/supabase.ts";

function supabaseStore(db: SupabaseClient): DispatchStore {
  return {
    async listDue(limit, nowIso) {
      const { data, error } = await db
        .from("integration_outbox")
        .select("id,tenant_id,connection_id,event_id,attempts,envelope")
        .in("status", ["pending", "delivering"])
        .lte("next_attempt_at", nowIso)
        .order("next_attempt_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error("list_failed");
      return (data ?? []) as unknown as OutboxRow[];
    },
    async loadConnection(connectionId) {
      const { data } = await db
        .from("integration_connections").select("id,app,status,endpoint_url,adapter,external_rooftop_ref")
        .eq("id", connectionId).maybeSingle();
      return (data as DispatchConnection | null) ?? null;
    },
    async directionEnabled(tenantId, direction) {
      const { data } = await db
        .from("integration_direction_flags").select("enabled")
        .eq("tenant_id", tenantId).eq("direction", direction).maybeSingle();
      return (data as { enabled?: boolean } | null)?.enabled === true;
    },
    async deliveryAllowed(tenantId) {
      const { data, error } = await db.rpc("integration_delivery_allowed", { p_tenant: tenantId });
      // Unknown pause state fails closed: do not deliver.
      return !error && data === true;
    },
    async lease(rowId, nowIso, leaseUntilIso) {
      const claimed = await db.from("integration_outbox")
        .update({ status: "delivering", next_attempt_at: leaseUntilIso })
        .eq("id", rowId).in("status", ["pending", "delivering"]).lte("next_attempt_at", nowIso)
        .select("id");
      return (claimed.data?.length ?? 0) > 0;
    },
    async activeKey(connectionId) {
      const { data: keyRow } = await db
        .from("integration_connection_keys").select("key_id")
        .eq("connection_id", connectionId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const keyId = (keyRow as { key_id?: string } | null)?.key_id;
      if (!keyId) return null;
      const { data } = await db.rpc("integration_key_secret", { p_key_id: keyId });
      return typeof data === "string" && data ? { key_id: keyId, secret: data } : null;
    },
    async markDelivered(rowId, attempts, atIso, connectionId) {
      await db.from("integration_outbox")
        .update({ status: "delivered", attempts, delivered_at: atIso, last_error_code: null }).eq("id", rowId);
      await db.from("integration_connections").update({ last_success_at: atIso }).eq("id", connectionId);
    },
    async markFailure(rowId, update, connectionId) {
      await db.from("integration_outbox").update({
        status: update.dead ? "dead" : "pending",
        attempts: update.attempts,
        last_error_code: update.errorCode,
        next_attempt_at: update.nextAttemptIso,
      }).eq("id", rowId);
      await db.from("integration_connections")
        .update({ last_error_at: new Date().toISOString(), last_error_code: update.errorCode }).eq("id", connectionId);
    },
  };
}

Deno.serve((req: Request) => handleDispatch(req, {
  enabled: () => Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") === "true",
  authorize: isServiceOrCron,
  store: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return supabaseStore(createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  },
}));

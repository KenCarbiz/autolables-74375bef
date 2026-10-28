// integration-dispatch
//
// Outbox sender. Signs pending events with the connection's active key and
// POSTs them to its endpoint, only while the tenant's matching direction flag is
// on and the connection is active. With flags off it sends nothing. Dormant
// unless ROOFTOP_INTEGRATIONS_ENABLED === "true".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { json, preflight } from "../_shared/http.ts";
import { nextRetry } from "../_shared/integrations/backoff.ts";
import { outboundDirection } from "../_shared/integrations/envelope.ts";
import { sign } from "../_shared/integrations/signing.ts";
import { isServiceOrCron } from "../_shared/supabase.ts";

interface OutboxRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  event_id: string;
  attempts: number;
  envelope: unknown;
}

interface ConnectionRow {
  id: string;
  app: "autofilm" | "autocurb";
  status: string;
  endpoint_url: string | null;
}

const LEASE_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") !== "true") return json(503, { ok: false, error: "integrations_disabled" });
  if (!isServiceOrCron(req)) return json(401, { ok: false, error: "not authorized" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "unavailable" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from("integration_outbox")
    .select("id,tenant_id,connection_id,event_id,attempts,envelope")
    .in("status", ["pending", "delivering"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) return json(503, { ok: false, error: "unavailable" });

  const rows = (data ?? []) as unknown as OutboxRow[];
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  for (const row of rows) {
    try {
      const { data: conn } = await db
        .from("integration_connections").select("id,app,status,endpoint_url").eq("id", row.connection_id).maybeSingle();
      const connection = conn as ConnectionRow | null;
      if (!connection || connection.status !== "active" || !connection.endpoint_url?.startsWith("https://")) {
        bump("skipped_connection");
        continue;
      }
      const { data: flag } = await db
        .from("integration_direction_flags").select("enabled")
        .eq("tenant_id", row.tenant_id).eq("direction", outboundDirection(connection.app)).maybeSingle();
      if ((flag as { enabled?: boolean } | null)?.enabled !== true) {
        bump("skipped_flag_off");
        continue;
      }

      const claimed = await db.from("integration_outbox")
        .update({ status: "delivering", next_attempt_at: new Date(Date.now() + LEASE_MS).toISOString() })
        .eq("id", row.id).in("status", ["pending", "delivering"]).lte("next_attempt_at", nowIso)
        .select("id");
      if (!claimed.data?.length) continue;

      const attempts = row.attempts + 1;
      let httpStatus: number | null = null;
      let errorCode = "delivery_failed";

      const { data: keyRow } = await db
        .from("integration_connection_keys").select("key_id")
        .eq("connection_id", row.connection_id).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const keyId = (keyRow as { key_id?: string } | null)?.key_id;
      const { data: secretData } = keyId ? await db.rpc("integration_key_secret", { p_key_id: keyId }) : { data: null };
      const secret = typeof secretData === "string" && secretData ? secretData : null;

      if (!keyId || !secret) {
        errorCode = "no_active_key";
      } else {
        const rawBody = JSON.stringify(row.envelope);
        const ts = String(Math.floor(Date.now() / 1000));
        try {
          const res = await fetch(connection.endpoint_url, {
            method: "POST",
            redirect: "manual",
            headers: {
              "Content-Type": "application/json",
              "X-Rooftop-Key-Id": keyId,
              "X-Rooftop-Timestamp": ts,
              "X-Rooftop-Signature": await sign(secret, ts, keyId, rawBody),
            },
            body: rawBody,
            signal: AbortSignal.timeout(10_000),
          });
          httpStatus = res.status;
          errorCode = `http_${res.status}`;
          await res.body?.cancel();
        } catch (_e) {
          errorCode = "network_error";
        }
      }

      if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
        const at = new Date().toISOString();
        await db.from("integration_outbox")
          .update({ status: "delivered", attempts, delivered_at: at, last_error_code: null }).eq("id", row.id);
        await db.from("integration_connections").update({ last_success_at: at }).eq("id", connection.id);
        bump("delivered");
        continue;
      }

      const retry = nextRetry(attempts, httpStatus);
      await db.from("integration_outbox").update({
        status: retry.dead ? "dead" : "pending",
        attempts,
        last_error_code: errorCode,
        next_attempt_at: new Date(Date.now() + (retry.delaySeconds ?? 0) * 1000).toISOString(),
      }).eq("id", row.id);
      await db.from("integration_connections")
        .update({ last_error_at: new Date().toISOString(), last_error_code: errorCode }).eq("id", connection.id);
      bump(retry.dead ? "dead" : "retry");
    } catch (_err) {
      bump("error");
    }
  }

  return json(200, { ok: true, claimed: rows.length, outcomes: counts });
});

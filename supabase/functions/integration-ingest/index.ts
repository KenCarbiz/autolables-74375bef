// integration-ingest
//
// Signed receiver for RooftopOS events from sister apps (AutoFilm, AutoCurb).
// A 202 means the event is durably in integration_inbox, NOT that it
// has been applied; integration-apply does that later.
//
// Dormant unless ROOFTOP_INTEGRATIONS_ENABLED === "true". The tenant is always
// the one bound to the signing key's connection; envelope.tenant_ref is advisory.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { json, preflight } from "../_shared/http.ts";
import { inboundDirection } from "../_shared/integrations/envelope.ts";
import {
  decideIngest, type ConnectionRecord, type ExistingReceipt, type IngestDecision, type IngestInput, type KeyRecord,
} from "../_shared/integrations/ingestDecision.ts";

type Db = SupabaseClient;

interface KeyRow {
  key_id: string;
  status: KeyRecord["status"];
  connection: ConnectionRecord | ConnectionRecord[] | null;
}

const RECEIPT_COLUMNS = "id,status,payload_checksum,received_at";

async function loadKey(db: Db, keyId: string): Promise<KeyRecord | null> {
  const { data } = await db
    .from("integration_connection_keys")
    .select("key_id,status,connection:integration_connections(id,tenant_id,app,status,scopes)")
    .eq("key_id", keyId)
    .maybeSingle();
  const row = data as unknown as KeyRow | null;
  const connection = Array.isArray(row?.connection) ? row?.connection[0] : row?.connection;
  if (!row || !connection) return null;
  return { key_id: row.key_id, status: row.status, connection };
}

async function lookupExisting(db: Db, connectionId: string, eventId: string, idempotencyKey: string) {
  const [byEvent, byKey] = await Promise.all([
    db.from("integration_inbox").select(RECEIPT_COLUMNS).eq("connection_id", connectionId).eq("event_id", eventId).maybeSingle(),
    db.from("integration_inbox").select(RECEIPT_COLUMNS).eq("connection_id", connectionId).eq("idempotency_key", idempotencyKey).maybeSingle(),
  ]);
  return {
    existingByEventId: (byEvent.data ?? null) as ExistingReceipt | null,
    existingByIdempotencyKey: (byKey.data ?? null) as ExistingReceipt | null,
  };
}

function respond(decision: IngestDecision, receiptId: string | null): Response {
  const { httpStatus, code } = decision;
  if (httpStatus === 202) return json(202, { ok: true, status: code, receipt_id: receiptId });
  if (httpStatus === 200 && decision.duplicateOf) {
    return json(200, {
      ok: true,
      status: "duplicate",
      receipt_id: decision.duplicateOf.id,
      original_status: decision.duplicateOf.status,
      received_at: decision.duplicateOf.received_at,
    });
  }
  return json(httpStatus, {
    ok: false,
    error: code,
    ...(httpStatus === 401 ? {} : { detail: decision.detail }),
  });
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") !== "true") return json(503, { ok: false, error: "integrations_disabled" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "unavailable" });

  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const rawBody = await req.text();
    const keyId = req.headers.get("x-rooftop-key-id") || "";

    const keyRecord = keyId ? await loadKey(db, keyId) : null;
    let secret: string | null = null;
    let directionEnabled = false;
    if (keyRecord && keyRecord.status !== "revoked") {
      const { data } = await db.rpc("integration_key_secret", { p_key_id: keyId });
      secret = typeof data === "string" && data ? data : null;
      const direction = inboundDirection(keyRecord.connection.app);
      if (direction) {
        const { data: flag } = await db
          .from("integration_direction_flags")
          .select("enabled")
          .eq("tenant_id", keyRecord.connection.tenant_id)
          .eq("direction", direction)
          .maybeSingle();
        directionEnabled = (flag as { enabled?: boolean } | null)?.enabled === true;
      }
    }

    const base: IngestInput = {
      headers: req.headers,
      rawBody,
      nowMs: Date.now(),
      keyRecord,
      secret,
      existingByEventId: null,
      existingByIdempotencyKey: null,
      directionEnabled,
    };

    let decision = await decideIngest(base);
    let receiptId: string | null = null;

    if (decision.insert) {
      const insert = decision.insert;
      const existing = await lookupExisting(db, insert.connection_id, insert.event_id, insert.idempotency_key);
      if (existing.existingByEventId || existing.existingByIdempotencyKey) {
        decision = await decideIngest({ ...base, ...existing });
      } else {
        const { data, error } = await db.from("integration_inbox").insert(insert).select("id").single();
        if (error) {
          if (error.code !== "23505") throw new Error("inbox_insert_failed");
          const raced = await lookupExisting(db, insert.connection_id, insert.event_id, insert.idempotency_key);
          decision = await decideIngest({ ...base, ...raced });
          if (decision.insert) throw new Error("inbox_race_unresolved");
        } else {
          receiptId = (data as { id: string }).id;
        }
      }
    }

    if (keyRecord && decision.httpStatus !== 401) {
      const ok = decision.httpStatus === 200 || decision.httpStatus === 202;
      await db
        .from("integration_connections")
        .update(ok ? { last_success_at: new Date().toISOString() } : { last_error_at: new Date().toISOString(), last_error_code: decision.code })
        .eq("id", keyRecord.connection.id);
    }

    return respond(decision, receiptId);
  } catch (_err) {
    return json(503, { ok: false, error: "unavailable" });
  }
});

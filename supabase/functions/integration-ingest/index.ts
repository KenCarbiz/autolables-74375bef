// integration-ingest
//
// Signed receiver for RooftopOS events from sister apps (AutoFilm, AutoCurb).
// A 202 means the event is durably in integration_inbox, NOT that it
// has been applied; integration-apply does that later.
//
// Dormant unless ROOFTOP_INTEGRATIONS_ENABLED === "true". The tenant is always
// the one bound to the signing key's connection; envelope.tenant_ref is advisory.
// Protocol is chosen by the connection (integration_connections.adapter), never by
// the caller: rooftop.v1 is keyed by X-Rooftop-Key-Id; autofilm.v1 is AutoFilm's
// x-af-* HMAC protocol addressed with ?connection=<connection id>.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleIngest, type IngestStore } from "../_shared/integrations/handlers/ingest.ts";
import type { ConnectionRecord, ExistingReceipt, KeyRecord } from "../_shared/integrations/ingestDecision.ts";

type Db = SupabaseClient;

const CONNECTION_COLUMNS = "id,tenant_id,app,status,scopes,adapter,external_rooftop_ref";
const RECEIPT_COLUMNS = "id,status,payload_checksum,received_at";

interface KeyRow {
  key_id: string;
  status: KeyRecord["status"];
  connection: ConnectionRecord | ConnectionRecord[] | null;
}

function supabaseStore(db: Db): IngestStore {
  return {
    async loadKey(keyId) {
      const { data } = await db
        .from("integration_connection_keys")
        .select(`key_id,status,connection:integration_connections(${CONNECTION_COLUMNS})`)
        .eq("key_id", keyId)
        .maybeSingle();
      const row = data as unknown as KeyRow | null;
      const connection = Array.isArray(row?.connection) ? row?.connection[0] : row?.connection;
      if (!row || !connection) return null;
      return { key_id: row.key_id, status: row.status, connection };
    },
    async keySecret(keyId) {
      const { data } = await db.rpc("integration_key_secret", { p_key_id: keyId });
      return typeof data === "string" && data ? data : null;
    },
    async loadConnection(connectionId) {
      const { data } = await db.from("integration_connections").select(CONNECTION_COLUMNS).eq("id", connectionId).maybeSingle();
      return (data as ConnectionRecord | null) ?? null;
    },
    async connectionSecrets(connectionId) {
      const { data } = await db.rpc("integration_connection_secrets", { p_connection_id: connectionId });
      return ((data ?? []) as Array<{ key_id: string; secret: string }>).filter((r) => r.secret);
    },
    async directionEnabled(tenantId, direction) {
      const { data } = await db
        .from("integration_direction_flags").select("enabled")
        .eq("tenant_id", tenantId).eq("direction", direction).maybeSingle();
      return (data as { enabled?: boolean } | null)?.enabled === true;
    },
    async lookupExisting(connectionId, eventId, idempotencyKey) {
      const [byEvent, byKey] = await Promise.all([
        db.from("integration_inbox").select(RECEIPT_COLUMNS).eq("connection_id", connectionId).eq("event_id", eventId).maybeSingle(),
        db.from("integration_inbox").select(RECEIPT_COLUMNS).eq("connection_id", connectionId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      ]);
      return {
        existingByEventId: (byEvent.data ?? null) as ExistingReceipt | null,
        existingByIdempotencyKey: (byKey.data ?? null) as ExistingReceipt | null,
      };
    },
    async resolveVinForRo(connectionId, roKey) {
      const { data } = await db
        .from("integration_inbox").select("vin")
        .eq("connection_id", connectionId).eq("envelope->payload->>ro_key", roKey)
        .order("received_at", { ascending: false }).limit(1).maybeSingle();
      return (data as { vin?: string } | null)?.vin ?? null;
    },
    async insertInbox(rows) {
      const { data, error } = await db.from("integration_inbox").insert(rows).select("id");
      if (error) {
        if (error.code === "23505") return "conflict";
        throw new Error("inbox_insert_failed");
      }
      return { ids: ((data ?? []) as Array<{ id: string }>).map((r) => r.id) };
    },
    async touchConnection(connectionId, outcome) {
      await db.from("integration_connections")
        .update(outcome.ok
          ? { last_success_at: new Date().toISOString() }
          : { last_error_at: new Date().toISOString(), last_error_code: outcome.code })
        .eq("id", connectionId);
    },
  };
}

Deno.serve((req: Request) => handleIngest(req, {
  enabled: () => Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") === "true",
  store: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return supabaseStore(createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  },
}));

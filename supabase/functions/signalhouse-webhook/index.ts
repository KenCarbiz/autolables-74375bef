import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { toSignalHouseNumber } from "../_shared/signalhouse.ts";

// ──────────────────────────────────────────────────────────────
// signalhouse-webhook · inbound messages and delivery receipts.
//
// Contract:
//   POST /functions/v1/signalhouse-webhook
//   Header: X-Api-Key: <SIGNALHOUSE_WEBHOOK_SECRET>
//   Body:   { timestamp, event, identifier, metaData }
//   Returns: 200 {"ok":true} before any work is done.
//
// Two rules come straight from how Signal House delivers these:
//
//   • The receiver has 3 SECONDS. A delivery that exceeds it is recorded as a
//     failure and resent up to three times, so any work done before
//     responding turns a healthy handler into duplicate events. Acknowledge
//     first, persist in waitUntil.
//
//   • Payloads are UNSIGNED — no HMAC, no signature header. X-Api-Key proves
//     only that the caller knew a secret we gave out, so nothing here may take
//     an irreversible action on webhook content alone. It records what was
//     claimed; authoritative state is read back from the API.
// ──────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const INBOUND_EVENTS = /INBOUND|RECEIVED|REPLY/i;

interface WebhookPayload {
  timestamp?: string;
  event?: string;
  identifier?: string;
  metaData?: Record<string, unknown>;
}

const str = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
};

const pick = (meta: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(meta[k]);
    if (v) return v;
  }
  return null;
};

const persist = async (payload: WebhookPayload) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const meta = (payload.metaData ?? {}) as Record<string, unknown>;
  const event = str(payload.event) || "UNKNOWN";
  const identifier = str(payload.identifier)
    ?? pick(meta, "messageId", "id", "_id", "campaignId", "brandId");

  const rawFrom = pick(meta, "senderPhoneNumber", "from", "fromNumber");
  const rawTo = pick(meta, "recipientPhoneNumber", "to", "toNumber");

  const occurredAt = (() => {
    const ts = str(payload.timestamp);
    if (!ts) return null;
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  })();

  // A delivery receipt names a message we sent, so the tenant it belongs to is
  // recoverable from the row that recorded the send. Inbound messages from a
  // shopper match nothing and stay tenant-null rather than being guessed at.
  let tenantId: string | null = null;
  if (identifier) {
    const { data: verification } = await admin
      .from("passport_sms_verifications")
      .select("tenant_id")
      .eq("provider_message_id", identifier)
      .maybeSingle();
    tenantId = (verification as { tenant_id?: string } | null)?.tenant_id ?? null;

    if (!tenantId) {
      const { data: outbox } = await admin
        .from("passport_document_delivery_outbox")
        .select("tenant_id")
        .eq("provider_message_id", identifier)
        .maybeSingle();
      tenantId = (outbox as { tenant_id?: string } | null)?.tenant_id ?? null;
    }
  }

  const { error } = await admin.from("sms_events").insert({
    tenant_id: tenantId,
    provider: "signalhouse",
    event,
    identifier,
    direction: INBOUND_EVENTS.test(event) ? "INBOUND" : "OUTBOUND",
    from_number: rawFrom ? toSignalHouseNumber(rawFrom) ?? rawFrom : null,
    to_number: rawTo ? toSignalHouseNumber(rawTo) ?? rawTo : null,
    message_body: pick(meta, "messageBody", "body", "text"),
    occurred_at: occurredAt,
    meta,
  });

  // 23505 is the dedupe index doing its job on a redelivered event. The index
  // is on COALESCE() expressions, which PostgREST's on_conflict cannot name,
  // so the duplicate is swallowed here rather than upserted away.
  if (error && error.code !== "23505") throw error;
};

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("SIGNALHOUSE_WEBHOOK_SECRET");
  // Fail closed. An unset secret on a write endpoint that anyone can find is
  // worse than an endpoint that is temporarily refusing every delivery.
  if (!secret) return json({ error: "webhook not configured" }, 503);

  const presented = req.headers.get("x-api-key")
    ?? (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (presented !== secret) return json({ error: "unauthorized" }, 401);

  let payload: WebhookPayload = {};
  try { payload = await req.json(); } catch { /* empty */ }

  const work = persist(payload).catch((err) => {
    console.error("signalhouse-webhook persist failed", err);
  });

  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work);
  else await work;

  return json({ ok: true });
});

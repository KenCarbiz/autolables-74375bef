import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { MAX_NOTIFY_BYTES, parseNotifyBody, sha256Hex, verifySignatureV2 } from "../_shared/filescom/policy.ts";

// Files.com folder webhook receiver. Verifies X-Files-Signature-V2 over the
// raw body, dedups on the body digest, records the event and returns. It never
// downloads a file, follows a URL from the payload, or touches inventory.

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const authLog = (rid: string, outcome: string, req: Request) => {
  const v2 = req.headers.get("x-files-signature-v2");
  console.log(JSON.stringify({
    fn: "files-inventory-notify", rid, outcome,
    has_v2: v2 !== null, v2_format_valid: v2 !== null && /^[0-9a-f]{64}$/.test(v2),
    has_legacy: req.headers.has("x-files-signature"), has_exavault: req.headers.has("x-exavault-signature"),
  }));
};

Deno.serve(async (req) => {
  const rid = crypto.randomUUID();
  authLog(rid, "entry", req);
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_NOTIFY_BYTES) return reply(413, { error: "body_too_large" });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_NOTIFY_BYTES) return reply(413, { error: "body_too_large" });

  const secret = Deno.env.get("FILESCOM_WEBHOOK_SECRET");
  if (!secret) {
    authLog(rid, "receiver_not_configured", req);
    return reply(503, { error: "receiver_not_configured" });
  }
  if (!(await verifySignatureV2(secret, raw, req.headers.get("x-files-signature-v2")))) {
    authLog(rid, "invalid_signature", req);
    return reply(401, { error: "invalid_signature" });
  }
  authLog(rid, "signature_ok", req);

  const parsed = parseNotifyBody(raw);
  if (!parsed.ok) return reply(422, { error: parsed.reason });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const e = parsed.event;
  const { data, error } = await db.rpc("filescom_record_event", {
    p_digest: await sha256Hex(raw), p_action: e.action, p_path: e.path, p_destination: e.destination, p_event_at: e.at, p_size: e.size,
  });
  if (error) {
    console.error("filescom_record_event failed", error.code);
    return reply(500, { error: "record_failed" });
  }
  const result = (data ?? {}) as { duplicate?: boolean; status?: string };
  if (result.duplicate) return reply(200, { received: true, duplicate: true });
  return reply(202, { received: true, status: result.status ?? null });
});

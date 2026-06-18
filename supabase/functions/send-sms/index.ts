import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// send-sms · forwards a signing-link SMS to Twilio.
//
// Secrets (Supabase → Edge Function secrets):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//
// Contract:
//   POST /functions/v1/send-sms
//   Authorization: Bearer <user or service jwt>
//   Body: { to: string, body: string }
//   Returns: { success: boolean, sid?: string, error?: string }
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Normalize a US/CA number to E.164. Leaves already-prefixed numbers alone.
const toE164 = (raw: string): string | null => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "missing bearer token" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "supabase not configured" }, 500);

  const isServiceRole = jwt === serviceKey;
  let callerUserId: string | null = null;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!isServiceRole) {
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "invalid token" }, 401);
    callerUserId = userRes.user.id;
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  // For A2P 10DLC, prefer a Messaging Service tied to the registered
  // campaign; fall back to a single From number on that campaign.
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || (!messagingServiceSid && !from)) {
    return json({ success: false, error: "Twilio not configured" }, 500);
  }

  let payload: { to?: string; body?: string } = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const to = toE164(payload.to || "");
  const body = (payload.body || "").trim();
  if (!to) return json({ success: false, error: "Invalid phone number" }, 400);
  if (!body) return json({ success: false, error: "Empty message" }, 400);

  // ── Recipient allowlist for user-JWT callers ───────────────
  // Mirrors send-email: user-JWT callers may only text phone numbers
  // already stored against a tenant they are an accepted member of.
  // Service-role callers (cron, internal jobs) bypass this gate.
  if (!isServiceRole && callerUserId) {
    const { data: memberships } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", callerUserId)
      .not("accepted_at", "is", null);
    const tenantIds = (memberships || []).map((m: { tenant_id: string }) => m.tenant_id);
    if (tenantIds.length === 0) {
      return json({ success: false, error: "caller has no tenant memberships" }, 403);
    }
    const allow = new Set<string>();
    const collect = (rows: Array<Record<string, unknown>> | null, field: string) => {
      for (const r of rows || []) {
        const v = r[field];
        if (typeof v !== "string") continue;
        const norm = toE164(v);
        if (norm) allow.add(norm);
      }
    };
    const [leadsRes, signRes, dealRes] = await Promise.all([
      admin.from("leads").select("phone").in("tenant_id", tenantIds),
      admin.from("addendum_signings").select("signer_phone").in("tenant_id", tenantIds),
      admin.from("deal_signing_tokens").select("customer_phone").in("tenant_id", tenantIds),
    ]);
    collect(leadsRes.data as Array<Record<string, unknown>> | null, "phone");
    collect(signRes.data as Array<Record<string, unknown>> | null, "signer_phone");
    collect(dealRes.data as Array<Record<string, unknown>> | null, "customer_phone");

    if (!allow.has(to)) {
      return json({
        success: false,
        error: "recipient_not_allowed",
        message: "user-JWT senders may only text contacts within their tenants",
      }, 403);
    }
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from as string);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ success: false, error: data?.message || "Twilio send failed" }, res.status);
  return json({ success: true, sid: data?.sid });
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return json({ success: false, error: "Twilio not configured" }, 500);

  let payload: { to?: string; body?: string } = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const to = toE164(payload.to || "");
  const body = (payload.body || "").trim();
  if (!to) return json({ success: false, error: "Invalid phone number" }, 400);
  if (!body) return json({ success: false, error: "Empty message" }, 400);

  const form = new URLSearchParams({ From: from, To: to, Body: body });
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

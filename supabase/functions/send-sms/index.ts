import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  SignalHouseError,
  sendSignalHouseSms,
  toSignalHouseNumber,
} from "../_shared/signalhouse.ts";

// ──────────────────────────────────────────────────────────────
// send-sms · forwards a signing-link SMS to Signal House.
//
// Secrets (Supabase → Edge Function secrets):
//   SIGNALHOUSE_API_KEY, SIGNALHOUSE_FROM_NUMBER
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

  let payload: { to?: string; body?: string } = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const to = toSignalHouseNumber(payload.to || "");
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
        const norm = toSignalHouseNumber(v);
        if (norm) allow.add(norm);
      }
    };
    const [leadsRes, signRes] = await Promise.all([
      admin.from("leads").select("phone").in("tenant_id", tenantIds),
      admin.from("addendum_signings").select("signer_phone").in("tenant_id", tenantIds),
    ]);
    collect(leadsRes.data as Array<Record<string, unknown>> | null, "phone");
    collect(signRes.data as Array<Record<string, unknown>> | null, "signer_phone");

    if (!allow.has(to)) {
      return json({
        success: false,
        error: "recipient_not_allowed",
        message: "user-JWT senders may only text contacts within their tenants",
      }, 403);
    }
  }

  try {
    const sent = await sendSignalHouseSms(to, body);
    return json({ success: true, sid: sent.messageId });
  } catch (err) {
    if (err instanceof SignalHouseError) {
      return json({ success: false, error: err.message, code: err.code }, err.status);
    }
    return json({ success: false, error: (err as Error)?.message || "Signal House send failed" }, 502);
  }
});

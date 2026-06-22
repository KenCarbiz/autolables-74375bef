import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();

const sha256 = async (value: string) => {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const normalizePhone = (phone: string) => phone.replace(/[^0-9+]/g, "");
const codeSalt = () => Deno.env.get("PASSPORT_SMS_CODE_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "passport-code-salt";
const hashCode = (requestId: string, phone: string, code: string) => sha256(`${requestId}:${normalizePhone(phone)}:${code}:${codeSalt()}`);
const newCode = () => `${Math.floor(100000 + Math.random() * 900000)}`;

const sendSms = async (to: string, body: string) => {
  const provider = Deno.env.get("PASSPORT_SMS_PROVIDER") || "twilio";

  if (provider === "disabled") {
    return { provider, skipped: true };
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || !from) throw new Error("Twilio SMS credentials are not configured");

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio failed: ${response.status} ${JSON.stringify(json)}`);
  return { provider, messageId: json.sid || null };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service credentials are not configured");

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = body.action || (body.code ? "verify" : "send");
    const requestId = String(body.requestId || body.request_id || "").trim();
    if (!requestId) throw new Error("requestId is required");

    const { data: requestRow, error: requestError } = await supabase
      .from("passport_document_delivery_requests")
      .select("id,tenant_id,customer_phone,customer_email,customer_name,vehicle_of_interest,verification_required,verification_status,delivery_status")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!requestRow) throw new Error("Request not found");
    if (!requestRow.verification_required) {
      return new Response(JSON.stringify({ ok: true, requestId, verificationRequired: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = normalizePhone(requestRow.customer_phone || body.phone || "");
    if (!phone) throw new Error("Mobile number is required");

    if (action === "send" || action === "resend") {
      const code = newCode();
      const codeHash = await hashCode(requestId, phone, code);
      const smsBody = `Your AutoLabels vehicle packet verification code is ${code}. It expires in 10 minutes.`;
      const sent = await sendSms(phone, smsBody);

      const { error: insertError } = await supabase.from("passport_sms_verifications").insert({
        request_id: requestId,
        tenant_id: requestRow.tenant_id,
        phone,
        code_hash: codeHash,
        status: "pending",
        provider: sent.provider,
        provider_message_id: sent.messageId || null,
        metadata: { skipped: sent.skipped || false },
      });
      if (insertError) throw insertError;

      await supabase
        .from("passport_document_delivery_requests")
        .update({ verification_status: "pending" })
        .eq("id", requestId);

      return new Response(JSON.stringify({ ok: true, requestId, sent: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const code = String(body.code || "").replace(/\D/g, "");
      if (code.length !== 6) throw new Error("A 6-digit code is required");

      const { data: verification, error: verificationError } = await supabase
        .from("passport_sms_verifications")
        .select("id,code_hash,status,attempts,max_attempts,expires_at")
        .eq("request_id", requestId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (verificationError) throw verificationError;
      if (!verification) throw new Error("No pending verification code found");

      if (new Date(verification.expires_at).getTime() < Date.now()) {
        await supabase.from("passport_sms_verifications").update({ status: "expired" }).eq("id", verification.id);
        await supabase.from("passport_document_delivery_requests").update({ verification_status: "expired" }).eq("id", requestId);
        throw new Error("Verification code expired");
      }

      const attemptedHash = await hashCode(requestId, phone, code);
      const nextAttempts = Number(verification.attempts || 0) + 1;

      if (attemptedHash !== verification.code_hash) {
        const exhausted = nextAttempts >= Number(verification.max_attempts || 5);
        await supabase
          .from("passport_sms_verifications")
          .update({ attempts: nextAttempts, status: exhausted ? "failed" : "pending" })
          .eq("id", verification.id);
        if (exhausted) {
          await supabase.from("passport_document_delivery_requests").update({ verification_status: "failed" }).eq("id", requestId);
        }
        throw new Error(exhausted ? "Too many failed attempts" : "Invalid verification code");
      }

      await supabase
        .from("passport_sms_verifications")
        .update({ status: "verified", attempts: nextAttempts, verified_at: new Date().toISOString() })
        .eq("id", verification.id);

      await supabase
        .from("passport_document_delivery_requests")
        .update({ verification_status: "verified", verified_at: new Date().toISOString(), delivery_status: "queued" })
        .eq("id", requestId);

      const { error: outboxError } = await supabase.from("passport_document_delivery_outbox").insert({
        request_id: requestId,
        tenant_id: requestRow.tenant_id,
        channel: "email",
        status: "queued",
        recipient: requestRow.customer_email,
        payload: { purpose: "passport_document_delivery", verified_by_sms: true },
      });
      if (outboxError) throw outboxError;

      return new Response(JSON.stringify({ ok: true, requestId, verified: true, queuedEmail: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// notify-autocurb
//
// Outbound counterpart to autocurb-pull. Fired when a brand-new
// tenant signs up directly on autolabels.io (source='autolabels')
// so the Autocurb mothership knows about them and can offer the
// rest of the family.
//
// Contract:
//   POST /functions/v1/notify-autocurb
//   Headers: Authorization: Bearer <user JWT>
//   Body: { tenant_id?: string }   // defaults to caller's tenant
//   Returns: { sent: boolean, autocurb_tenant_id?: string }
//
// Sends a signed POST to <AUTOCURB_API_BASE>/api/v1/inbound/dealers
// containing the dealer's profile, plus an X-Autolabels-Signature
// HMAC header so Autocurb can verify the source.
//
// Idempotent on tenant.autocurb_tenant_id — once we receive an ID
// back from Autocurb we skip future notifications for the same
// tenant.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hmacSha256Hex = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const apiBase = Deno.env.get("AUTOCURB_API_BASE");
    const sharedSecret = Deno.env.get("AUTOCURB_NOTIFY_SECRET");
    if (!apiBase || !sharedSecret) {
      return json(200, { sent: false, reason: "AUTOCURB_API_BASE / AUTOCURB_NOTIFY_SECRET not set" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json(401, { error: "invalid token" });

    const { tenant_id: bodyTenantId } = await req.json().catch(() => ({}));

    // Resolve caller's tenant.
    let tenantId = bodyTenantId as string | undefined;
    if (tenantId) {
      // Verify caller is an accepted owner/admin of the supplied tenant.
      const { data: m } = await admin
        .from("tenant_members")
        .select("role")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .not("accepted_at", "is", null)
        .maybeSingle();
      if (!m) return json(403, { error: "not a tenant owner/admin" });
    } else {
      const { data: m } = await admin
        .from("tenant_members")
        .select("tenant_id,role")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .not("accepted_at", "is", null)
        .maybeSingle();
      tenantId = m?.tenant_id;
    }
    if (!tenantId) return json(403, { error: "no tenant to notify" });

    const { data: tenant } = await admin
      .from("tenants")
      .select("id,name,slug,domain,primary_email,source,autocurb_tenant_id")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return json(404, { error: "tenant not found" });

    if (tenant.autocurb_tenant_id) {
      // Already linked — no re-notification needed.
      return json(200, { sent: false, autocurb_tenant_id: tenant.autocurb_tenant_id, reason: "already linked" });
    }

    const { data: profile } = await admin
      .from("onboarding_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const payload = {
      autolabels_tenant_id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      primary_email: tenant.primary_email || user.email,
      source: tenant.source,
      profile: profile || null,
      notified_at: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);
    const sig = "sha256=" + (await hmacSha256Hex(sharedSecret, body));

    const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/v1/inbound/dealers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Autolabels-Signature": sig,
      },
      body,
    });

    let returned: { autocurb_tenant_id?: string } | null = null;
    try { returned = (await res.json()) as { autocurb_tenant_id?: string }; }
    catch { returned = null; }

    // Persist the link so we don't re-notify.
    if (res.ok && returned?.autocurb_tenant_id) {
      await admin
        .from("tenants")
        .update({ autocurb_tenant_id: returned.autocurb_tenant_id })
        .eq("id", tenantId);
    }

    await admin.from("audit_log").insert({
      action: "autocurb_notified",
      entity_type: "tenant",
      entity_id: tenantId,
      user_id: user.id,
      details: {
        ok: res.ok,
        status: res.status,
        autocurb_tenant_id: returned?.autocurb_tenant_id ?? null,
      },
    });

    return json(res.ok ? 200 : 502, {
      sent: res.ok,
      status: res.status,
      autocurb_tenant_id: returned?.autocurb_tenant_id ?? null,
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});

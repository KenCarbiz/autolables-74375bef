import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAllowedRedirectUrl } from "../_shared/security.ts";

// ──────────────────────────────────────────────────────────────
// stripe-checkout
//
// Caller-facing helper that creates a Stripe Checkout Session for a
// tenant to activate or upgrade an app_entitlement. The caller must
// be authenticated (bearer token) and must be an owner/admin of the
// tenant they're paying for.
//
// Contract:
//   POST /functions/v1/stripe-checkout
//   Headers: Authorization: Bearer <user JWT>
//   Body: { app_slug, plan_tier, success_url, cancel_url }
//   Returns: { url } - redirect the browser here.
//
// Price IDs live in env:
//   STRIPE_PRICE_AUTOLABELS_STICKER
//   STRIPE_PRICE_AUTOLABELS_COMPLIANCE
//   STRIPE_PRICE_AUTOLABELS_GROUP
//   (and same shape for other apps)
//
// The session's metadata carries { tenant_id, app_slug, plan_tier }
// so the webhook can apply the entitlement change on success.
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

const priceEnvKey = (app: string, plan: string) =>
  `STRIPE_PRICE_${app.toUpperCase()}_${plan.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });
    if (!stripeKey) return json(500, { error: "STRIPE_SECRET_KEY not configured" });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const { app_slug, plan_tier, success_url, cancel_url } = await req.json().catch(() => ({}));
    if (!app_slug || !plan_tier || !success_url || !cancel_url) {
      return json(400, { error: "app_slug, plan_tier, success_url, cancel_url required" });
    }
    if (!isAllowedRedirectUrl(success_url) || !isAllowedRedirectUrl(cancel_url)) {
      return json(400, { error: "invalid_redirect_url" });
    }

    const priceId = Deno.env.get(priceEnvKey(app_slug, plan_tier));
    if (!priceId) {
      return json(400, { error: `no Stripe price configured for ${app_slug}/${plan_tier}` });
    }

    // Resolve the caller's tenant + confirm owner/admin role.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json(401, { error: "invalid token" });
    const userId = userRes.user.id;

    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id,role")
      .eq("user_id", userId)
      .in("role", ["owner", "admin"])
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!membership?.tenant_id) {
      return json(403, { error: "must be tenant owner or admin" });
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select("id,stripe_customer_id,primary_email,name")
      .eq("id", membership.tenant_id)
      .maybeSingle();
    if (!tenant) return json(404, { error: "tenant not found" });

    // Find or create a Stripe customer for the tenant.
    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customerRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: tenant.primary_email || userRes.user.email || "",
          name: tenant.name || "",
          "metadata[tenant_id]": tenant.id,
        }),
      });
      const customerJson = await customerRes.json();
      if (!customerRes.ok) return json(502, { error: "stripe customer create failed", detail: customerJson });
      customerId = customerJson.id;
      await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id);
    }

    // Create the Checkout session.
    const body = new URLSearchParams({
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url,
      cancel_url,
      "metadata[tenant_id]": tenant.id,
      "metadata[app_slug]": app_slug,
      "metadata[plan_tier]": plan_tier,
      "subscription_data[metadata][tenant_id]": tenant.id,
      "subscription_data[metadata][app_slug]": app_slug,
      "subscription_data[metadata][plan_tier]": plan_tier,
    });

    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const sessionJson = await sessionRes.json();
    if (!sessionRes.ok) return json(502, { error: "stripe session create failed", detail: sessionJson });

    return json(200, { url: sessionJson.url, id: sessionJson.id });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});

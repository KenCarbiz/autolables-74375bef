import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14?target=deno";

// ──────────────────────────────────────────────────────────────
// billing-portal-session
//
// Returns a Stripe Customer Portal URL for the caller's tenant.
// Every sister app's "Manage billing" button calls this and
// redirects the browser to the returned URL. Customer Portal lets
// the dealer update payment methods, view invoices, download
// receipts, and cancel subscriptions. Plan upgrades and app
// additions are NOT handled by the Portal — those route through
// Autocurb.io's /billing page which owns the upgrade logic.
//
// Contract:
//   POST /functions/v1/billing-portal-session
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { return_url?: string }
//   Returns: { url }  -> redirect the browser here.
//
// If the tenant has no stripe_customer_id yet (invite-only onboarded
// without a checkout), we lazily create the Stripe Customer and save
// it so the Portal has something to show.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !STRIPE_KEY) {
    return json({ error: "server not configured" }, 500);
  }

  try {
    // 1. Verify caller via anon client + bearer token.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "not authenticated" }, 401);
    }
    const user = userData.user;

    // 2. Service role for the tenant lookup + customer create/update.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .order("role", { ascending: true })
      .limit(1)
      .maybeSingle();


    if (!membership) {
      return json({ error: "no tenant" }, 404);
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select(
        "id, name, stripe_customer_id, billing_email, primary_email"
      )
      .eq("id", membership.tenant_id)
      .maybeSingle();

    if (!tenant) return json({ error: "tenant not found" }, 404);

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 3. Lazy-create the Stripe Customer if the tenant was onboarded
    //    via admin invite (no checkout yet).
    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant.billing_email || tenant.primary_email || user.email,
        name: tenant.name || undefined,
        metadata: {
          tenant_id: tenant.id,
          source: "autolabels_portal_bootstrap",
        },
      });
      customerId = customer.id;
      await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id);
    }

    // 4. Parse return_url. Default to the Origin header's /admin tab.
    const body = (await req.json().catch(() => ({}))) as {
      return_url?: string;
    };
    const origin = req.headers.get("origin") || "https://autolabels.io";
    const returnUrl = body.return_url || `${origin}/admin?tab=branding`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("billing-portal-session:", msg);
    return json({ error: msg }, 500);
  }
});

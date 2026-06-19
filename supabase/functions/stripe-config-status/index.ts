// ──────────────────────────────────────────────────────────────────────
// stripe-config-status — super-admin read-only health check for the Stripe
// configuration. Reports WHICH secrets are set (booleans only — never the
// values), pings Stripe to confirm the secret key authenticates, and lists
// the configured price tiers. Secrets live in Supabase env, never in the DB
// or the browser; this function only reports presence/validity.
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

  // Super-admin gate — verify the caller and their platform admin role.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "unauthorized" });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json(403, { error: "forbidden" });

  const env = Deno.env.toObject();
  const secretKey = env.STRIPE_SECRET_KEY || "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || "";
  const priceTiers = Object.keys(env)
    .filter((k) => k.startsWith("STRIPE_PRICE_AUTOLABELS_"))
    .map((k) => k.replace("STRIPE_PRICE_AUTOLABELS_", "").toLowerCase());
  const mode = secretKey.startsWith("sk_live") ? "live" : secretKey.startsWith("sk_test") ? "test" : null;

  // Live ping so the admin knows the key actually authenticates (never logs the key).
  let stripeOk = false;
  let account: string | null = null;
  if (secretKey) {
    try {
      const res = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const a = await res.json();
        stripeOk = true;
        account = a?.business_profile?.name || a?.settings?.dashboard?.display_name || a?.email || a?.id || null;
      }
    } catch { /* network/timeout → stripeOk stays false */ }
  }

  return json(200, {
    secret_key: !!secretKey,
    webhook_secret: !!webhookSecret,
    mode,
    price_tiers: priceTiers,
    stripe_ok: stripeOk,
    account,
  });
});

// platform-entitlements
//
// Returns the product_ids array for the caller's tenant by asking
// AutoCurb (the source of truth for cross-app subscriptions) via its
// dealers-api /by-email endpoint. Called on-demand from the admin
// user-menu "Switch app" section so we can show which apps in the
// family are unlocked vs locked without leaking the AutoCurb API
// token to the browser.
//
//   POST /functions/v1/platform-entitlements
//   Headers: Authorization: Bearer <user JWT>
//   Returns: { product_ids: string[], email: string }
//
// Never returns 4xx for "no match" — that just yields product_ids:[]
// so the client renders only AutoLabels (current) as unlocked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

// AutoCurb's dealers-api lives in the AutoCurb Supabase project. The
// URL is hard-coded per the cross-app contract; the bearer token is
// the same AUTOCURB_API_TOKEN used by autocurb-pull / tenant sync.
const AUTOCURB_DEALERS_API =
  "https://ptiwdwfdckfqivoocyvp.supabase.co/functions/v1/dealers-api";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase_not_configured" });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing_token" });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json(401, { error: "invalid_token" });

    // Prefer tenant primary_email; fall back to the user's login email.
    let email = user.email || "";
    const { data: member } = await admin
      .from("tenant_members")
      .select("tenant_id, tenants:tenant_id ( primary_email )")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    const tenantEmail = (member?.tenants as { primary_email?: string } | null)?.primary_email;
    if (tenantEmail) email = tenantEmail;
    if (!email) return json(200, { product_ids: [], email: "" });

    const token = Deno.env.get("AUTOCURB_API_TOKEN");
    if (!token) return json(200, { product_ids: [], email, error: "not_configured" });

    const url = `${AUTOCURB_DEALERS_API}/by-email?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return json(200, { product_ids: [], email, error: `autocurb_${res.status}` });
    const data = await res.json().catch(() => null) as { product_ids?: string[] } | null;
    const productIds = Array.isArray(data?.product_ids) ? data!.product_ids : [];
    // AutoLabels is always implicit (the caller is currently on it).
    if (!productIds.includes("autolabels")) productIds.push("autolabels");
    return json(200, { product_ids: productIds, email });
  } catch (err) {
    return json(200, { product_ids: [], error: err instanceof Error ? err.message : "unknown_error" });
  }
});

// mint-handoff-token
//
// Mints a short-lived (5 min) one-time handoff token for the calling
// user's tenant so the browser can SSO into a sibling family app
// (AutoCurb, AutoFilm, ...) via `<host>/sso?t=<token>`. The sibling
// app exchanges the token against its own `cross-app-handoff` in the
// shared Supabase project.
//
//   POST /functions/v1/mint-handoff-token
//   Body: { targetApp: "autocurb" | "autofilm" | ... }
//   Returns: { token: string, expires_at: string }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase_not_configured" });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing_token" });

    const { targetApp } = await req.json().catch(() => ({}));
    if (!targetApp || typeof targetApp !== "string") {
      return json(400, { error: "targetApp required" });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json(401, { error: "invalid_token" });

    const { data: member } = await admin
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member?.tenant_id) return json(403, { error: "no_tenant" });

    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const { data: row, error } = await admin
      .from("handoff_tokens")
      .insert({
        tenant_id: member.tenant_id,
        user_id: user.id,
        source_app: "autolabels",
        target_app: targetApp,
        intent: "open",
        payload: { role: member.role || "staff" },
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (error || !row) return json(500, { error: error?.message || "mint_failed" });

    return json(200, { token: row.id, expires_at: row.expires_at });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown_error" });
  }
});

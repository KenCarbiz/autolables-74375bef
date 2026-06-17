// autocurb-dealer-lookup
//
// Platform-admin-only proxy to the AutoCurb dealer API so the operator can
// search and import dealers without exposing the AutoCurb token to the client.
//
//   POST { action: "search", q }      -> array of dealer summaries
//   POST { action: "by-id",  id }     -> full dealer profile
//   POST { action: "by-email", email} -> full dealer profile
//
// Gated: the caller must hold the platform 'admin' role (user_roles). Returns
// { error:"not_configured" } when AUTOCURB_API_BASE / AUTOCURB_API_TOKEN unset.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const base = Deno.env.get("AUTOCURB_API_BASE");
  const apiToken = Deno.env.get("AUTOCURB_API_TOKEN");
  if (!base || !apiToken) return json(200, { error: "not_configured" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase_not_configured" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing_token" });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userRes } = await admin.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return json(401, { error: "invalid_token" });

  // Platform-admin gate.
  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json(403, { error: "forbidden" });

  let body: { action?: string; q?: string; id?: string; email?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const root = base.replace(/\/+$/, "");
  let target = "";
  if (body.action === "search") target = `${root}/search?q=${encodeURIComponent(body.q || "")}&limit=20`;
  else if (body.action === "by-id" && body.id) target = `${root}/by-id/${encodeURIComponent(body.id)}`;
  else if (body.action === "by-email" && body.email) target = `${root}/by-email?email=${encodeURIComponent(body.email)}`;
  else return json(400, { error: "invalid_action" });

  try {
    const res = await fetch(target, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return json(200, { error: (data as { error?: string })?.error || `autocurb_${res.status}` });
    return json(200, { result: data });
  } catch (err) {
    return json(200, { error: err instanceof Error ? err.message : "unknown_error" });
  }
});

// firecrawl-scrape
//
// Renders a JS-walled dealer VDP (Team Velocity/Apollo, DealerOn, etc.) via
// Firecrawl and returns the fully-rendered HTML so the client parser can pull
// VIN / YMM / stock / price / photos that a plain fetch never sees.
//
//   POST /functions/v1/firecrawl-scrape   { url }
//   Returns: { html } on success, { error } otherwise.
//
// Requires the FIRECRAWL_API_KEY_1 (or legacy FIRECRAWL_API_KEY) secret.
// Returns { error:"not_configured" } (HTTP 200) when unset so the client
// falls back gracefully. Every scrape passes the provider budget first; a
// refusal (or a budget that cannot be read) answers { error:"budget_refused" }
// and nothing is sent to Firecrawl.
import { admitProviderCall, recordProviderCall } from "../_shared/providerBudget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Block private / metadata targets before handing the URL to Firecrawl.
const isPublicHttpUrl = (raw: string): boolean => {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "169.254.169.254") return false;
  return true;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // ── Auth gate ─ require a valid Supabase user JWT (or service role).
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing bearer token" });
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let tenantId: string | null = null;
  if (jwt !== serviceKey) {
    try {
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userRes?.user) return json(401, { error: "invalid token" });
      const { data: mem } = await admin
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", userRes.user.id)
        .not("accepted_at", "is", null)
        .limit(1);
      if (!mem || mem.length === 0) return json(403, { error: "no tenant membership" });
      tenantId = mem[0].tenant_id;
    } catch {
      return json(401, { error: "invalid token" });
    }
  }

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY_1") || Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return json(200, { error: "not_configured" });

  try {
    const { url } = await req.json().catch(() => ({ url: "" }));
    if (!url || typeof url !== "string" || !isPublicHttpUrl(url)) {
      return json(400, { error: "invalid_url" });
    }

    const gate = await admitProviderCall(admin, {
      url: "https://api.firecrawl.dev/v1/scrape", caller: "firecrawl-scrape", provider: "firecrawl", product: "scrape", tenantId,
    });
    if (!gate.admitted) return json(200, { error: "budget_refused", reason: gate.reason });
    let res: Response;
    try {
      res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false, waitFor: 3500, timeout: 30000 }),
        signal: AbortSignal.timeout(35000),
      });
    } catch (err) {
      await recordProviderCall(admin, gate.eventId, null, err instanceof Error ? err.message : String(err));
      throw err;
    }
    await recordProviderCall(admin, gate.eventId, res.status, null);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(200, { error: "firecrawl_failed", status: res.status, detail: text.slice(0, 300) });
    }

    const data = await res.json();
    const html: string = data?.data?.html || data?.html || "";
    if (!html) return json(200, { error: "no_content" });
    return json(200, { html });
  } catch (err) {
    return json(200, { error: err instanceof Error ? err.message : "unknown_error" });
  }
});

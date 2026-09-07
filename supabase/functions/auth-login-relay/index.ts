import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const allowedOrigin = (origin: string): boolean => {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && hostname !== "localhost") return false;
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "autolabels.io"
      || hostname === "www.autolabels.io"
      || hostname === "autolables.lovable.app"
      || hostname.endsWith(".lovableproject.com")
      || hostname.endsWith(".lovable.app");
  } catch {
    return false;
  }
};

serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin(origin) ? origin : "https://autolabels.io",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: corsHeaders });
  }
  if (request.method !== "POST" || !allowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "not allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const isNavigation = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ?? false;
    const body = isNavigation
      ? Object.fromEntries((await request.formData()).entries())
      : await request.json() as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !anonKey) throw new Error("authentication unavailable");

    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });

    const responseText = await response.text();
    if (isNavigation) {
      const payload = responseText.replaceAll("<", "\\u003c");
      const targetOrigin = JSON.stringify(origin);
      return new Response(
        `<!doctype html><meta charset="utf-8"><script>parent.postMessage({type:"autolabels-auth-relay",payload:${payload}},${targetOrigin})<\/script>`,
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors https://autolabels.io https://www.autolabels.io https://autolables.lovable.app https://*.lovable.app https://*.lovableproject.com http://localhost:8080",
          },
        },
      );
    }

    return new Response(responseText, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "authentication unavailable" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
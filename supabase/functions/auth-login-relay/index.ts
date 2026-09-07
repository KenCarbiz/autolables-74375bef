import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const allowedOrigin = (origin: string): boolean => {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && hostname !== "localhost") return false;
    return hostname === "autolabels.io"
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
    const body = await request.json() as { email?: unknown; password?: unknown };
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

    return new Response(await response.text(), {
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
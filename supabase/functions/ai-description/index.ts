import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth gate ────────────────────────────────────────────────
    // Block anonymous callers — this function spends Anthropic
    // credits and accepts a free-text prompt_override.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "missing bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (jwt !== serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ error: "invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { vehicle } = await req.json();
    if (!vehicle) {
      return new Response(
        JSON.stringify({ error: "vehicle data required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap prompt_override length to limit abuse via long prompts.
    if (typeof vehicle.prompt_override === "string" && vehicle.prompt_override.length > 4000) {
      return new Response(
        JSON.stringify({ error: "prompt_override too long (max 4000 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If the client sends a full prompt_override, use it (SEO Description Writer)
    // Otherwise use the default short description prompt
    const prompt = vehicle.prompt_override || `Write a professional, SEO-optimized vehicle description for a car dealership listing. Be factual, confident, and compelling. 2-3 short paragraphs, under 150 words total. Do not use exclamation marks. Do not make claims you can't verify from the data provided.

Vehicle data:
- Year: ${vehicle.year || "Unknown"}
- Make: ${vehicle.make || "Unknown"}
- Model: ${vehicle.model || "Unknown"}
- Trim: ${vehicle.trim || ""}
- Condition: ${vehicle.condition || "Pre-owned"}
- Mileage: ${vehicle.mileage || "Unknown"}
- Exterior Color: ${vehicle.color || ""}
- Engine: ${vehicle.engine || ""}
- Transmission: ${vehicle.transmission || ""}
- Drivetrain: ${vehicle.driveType || ""}
- Fuel Type: ${vehicle.fuelType || ""}
- Body Style: ${vehicle.bodyStyle || ""}
- Price: ${vehicle.price || "Contact for pricing"}

Write the description now:`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: vehicle.prompt_override ? 1500 : 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: `Claude API error: ${response.status}`, details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const description = data.content?.[0]?.text || "";

    return new Response(
      JSON.stringify({ success: true, description }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decideMarketPassResponse, type MarketPassCaller } from "../_shared/factorySticker/lib/intelligence/marketPass/handler.ts";
import type { MarketPassRow } from "../_shared/factorySticker/lib/intelligence/marketPass/rowEvidence.ts";

// ──────────────────────────────────────────────────────────────
// marketpass-assessment  ·  MarketPass V2 (PROPOSED rules, NOT deployed)
//
//   GET /functions/v1/marketpass-assessment?slug=<slug>[&audience=dealer]
//
// Reads only what is already stored on the listing and the dealer profile.
// It calls no provider: no MarketCheck, NeoVIN or Black Book request can
// start here, so serving it costs nothing against the provider budget.
//
// Every rule about who sees what lives in decideMarketPassResponse, a pure
// function tested in vitest. This file only gathers its three inputs: the
// row, the dealer settings (for the marketpass_v2 flag) and the caller's
// verified tenant memberships. A caller's own claim about its tenant is never
// read; membership comes from tenant_members under the service role.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase_not_configured" });

  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();
  if (!slug || slug.length > 120) return json(400, { error: "slug_required" });
  const audience = url.searchParams.get("audience") === "dealer" ? "dealer" : "public";

  try {
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: slug });
    if (error) return json(500, { error: "lookup_failed" });
    const row = ((Array.isArray(data) ? data[0] : data) ?? null) as MarketPassRow | null;

    let settings: unknown = {};
    if (row?.tenant_id) {
      const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
      settings = prof?.settings ?? {};
    }

    const caller: MarketPassCaller = { userId: null, memberTenantIds: [] };
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (bearer && bearer !== anonKey && bearer !== serviceKey) {
      const { data: who } = await admin.auth.getUser(bearer).catch(() => ({ data: null }));
      const userId = who?.user?.id ?? null;
      if (userId) {
        caller.userId = userId;
        if (row?.tenant_id) {
          const { data: member } = await admin.from("tenant_members")
            .select("tenant_id").eq("user_id", userId).eq("tenant_id", row.tenant_id).maybeSingle();
          if (member?.tenant_id) caller.memberTenantIds = [member.tenant_id as string];
        }
      }
    }

    const decision = decideMarketPassResponse({ row, settings, caller, audience, nowMs: Date.now() });
    return json(decision.status, decision.body);
  } catch (_e) {
    return json(500, { error: "assessment_failed" });
  }
});

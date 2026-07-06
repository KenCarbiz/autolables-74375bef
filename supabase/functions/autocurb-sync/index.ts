import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// autocurb-sync
//
// Accepts a signed vehicle-inventory push from Autocurb.io and
// upserts a draft `vehicle_listings` row so the AutoLabels dealer
// sees the VIN ready to sticker without manual entry.
//
// Contract:
//   POST /functions/v1/autocurb-sync
//   Headers: X-Autocurb-Signature: sha256=<hmac>
//   Body: {
//     autocurb_tenant_id: string,
//     vehicles: [{
//       vin, ymm, trim, mileage, condition, price,
//       stock_number, photos: string[], source_url?
//     }, ...]
//   }
//
// Returns: { upserted: N, errors: [...] }
//
// HMAC shared secret is AUTOCURB_SYNC_SECRET (env). Autocurb computes
// HMAC-SHA256 over the raw body and prefixes "sha256=". We recompute
// and timing-safe compare.
//
// Security model:
//   - The signature alone proves the push came from a party that
//     holds the shared secret. It does NOT authenticate a user.
//   - We scope all upserts to the tenant matching
//     autocurb_tenant_id, so a leaked secret cannot inject rows
//     into an unrelated tenant.
//   - Upserts are idempotent on (tenant_id, vin) — re-pushing the
//     same VIN updates the draft rather than creating duplicates.
//   - We never flip status to 'published'; dealer must still
//     complete prep sign-off and explicitly publish.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-autocurb-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hexEncode = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hmacSha256Hex = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return hexEncode(sig);
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

const makeSlug = (vin: string, ymm: string | undefined) => {
  const seed = `${(ymm || "veh").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${vin
    .slice(-6)
    .toLowerCase()}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${seed}-${rand}`;
};

interface InboundVehicle {
  vin: string;
  ymm?: string;
  trim?: string;
  mileage?: number;
  condition?: "new" | "used" | "cpo";
  price?: number;
  stock_number?: string;
  photos?: string[];
  source_url?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sharedSecret = Deno.env.get("AUTOCURB_SYNC_SECRET");
    if (!supabaseUrl || !serviceKey) {
      return json(500, { error: "supabase env not configured" });
    }
    if (!sharedSecret) {
      return json(500, { error: "AUTOCURB_SYNC_SECRET not configured" });
    }

    const raw = await req.text();
    const sigHeader = req.headers.get("x-autocurb-signature") || "";
    const expected = "sha256=" + (await hmacSha256Hex(sharedSecret, raw));
    if (!timingSafeEqual(sigHeader, expected)) {
      return json(401, { error: "invalid signature" });
    }

    let body: {
      autocurb_tenant_id?: string;
      vehicles?: InboundVehicle[];
    };
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid JSON body" });
    }
    if (!body.autocurb_tenant_id || !Array.isArray(body.vehicles)) {
      return json(400, { error: "autocurb_tenant_id and vehicles[] required" });
    }
    if (body.vehicles.length === 0) return json(200, { upserted: 0, errors: [] });
    if (body.vehicles.length > 500) {
      return json(413, { error: "max 500 vehicles per request" });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: tenant } = await admin
      .from("tenants")
      .select("id,name,slug,is_active")
      .eq("autocurb_tenant_id", body.autocurb_tenant_id)
      .maybeSingle();

    if (!tenant) {
      return json(404, {
        error: "no autolabels tenant linked to this autocurb_tenant_id",
      });
    }
    if (!tenant.is_active) return json(403, { error: "tenant is disabled" });

    const { data: profile } = await admin
      .from("onboarding_profiles")
      .select("display_name,logo_url,phone")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    const dealerSnapshot = {
      name: profile?.display_name || tenant.name,
      logo_url: profile?.logo_url || null,
      phone: profile?.phone || null,
    };

    const errors: Array<{ vin: string; error: string }> = [];
    let upserted = 0;

    for (const v of body.vehicles) {
      if (!v.vin || v.vin.length < 11) {
        errors.push({ vin: v.vin || "(missing)", error: "invalid VIN" });
        continue;
      }

      const { data: existing } = await admin
        .from("vehicle_listings")
        .select("id,slug,status")
        .eq("tenant_id", tenant.id)
        .eq("vin", v.vin)
        .maybeSingle();

      if (existing) {
        // Update ONLY the inventory fields the feed actually carries. The feed
        // is not the source of truth for the customer packet, so it must never
        // zero the dealer-curated documents / videos / value_props (or null a
        // good ymm/trim/mileage/price). Never demote a published listing either.
        const updatePatch: Record<string, unknown> = { tenant_id: tenant.id, vin: v.vin, dealer_snapshot: dealerSnapshot };
        if (v.ymm) updatePatch.ymm = v.ymm;
        if (v.trim) updatePatch.trim = v.trim;
        if (typeof v.mileage === "number") updatePatch.mileage = v.mileage;
        if (v.condition) updatePatch.condition = v.condition;
        if (typeof v.price === "number") updatePatch.price = v.price;
        const { error } = await admin
          .from("vehicle_listings")
          .update(updatePatch)
          .eq("id", existing.id);
        if (error) errors.push({ vin: v.vin, error: error.message });
        else upserted++;
      } else {
        const slug = makeSlug(v.vin, v.ymm);
        const { error } = await admin.from("vehicle_listings").insert({
          tenant_id: tenant.id,
          vin: v.vin,
          ymm: v.ymm || null,
          trim: v.trim || null,
          mileage: typeof v.mileage === "number" ? v.mileage : null,
          condition: v.condition || null,
          price: typeof v.price === "number" ? v.price : null,
          dealer_snapshot: dealerSnapshot,
          documents: v.source_url ? [{ name: "Autocurb record", url: v.source_url, type: "external" }] : [],
          videos: [],
          value_props: [],
          slug,
          status: "draft",
          sticker_snapshot: {},
        });
        if (error) errors.push({ vin: v.vin, error: error.message });
        else upserted++;
      }
    }

    await admin.from("audit_log").insert({
      action: "autocurb_sync",
      entity_type: "tenant",
      entity_id: tenant.id,
      details: {
        autocurb_tenant_id: body.autocurb_tenant_id,
        received: body.vehicles.length,
        upserted,
        errors: errors.length,
      },
    });

    return json(200, { upserted, errors });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
});
